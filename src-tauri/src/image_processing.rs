use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Write};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::{self, overlay, FilterType};
use image::{codecs, DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::helpers::{
    append_suffix_name, clamp_to_image_bounds, normalize_if_exists, normalize_output_format,
    output_extension,
};
use crate::models::{ExportConfig, ExportInputFile, ProcessBulkExportResult};

/// Rotate an RGBA image by an arbitrary angle (degrees clockwise), expanding
/// the canvas so the entire rotated image is visible.
fn rotate_with_expand(source: &RgbaImage, degrees_clockwise: f32) -> RgbaImage {
    if degrees_clockwise.abs() <= f32::EPSILON {
        return source.clone();
    }

    let (width, height) = source.dimensions();
    let radians = (-degrees_clockwise).to_radians();
    let cos = radians.cos().abs();
    let sin = radians.sin().abs();

    let expanded_width = ((width as f32 * cos) + (height as f32 * sin))
        .ceil()
        .max(1.0) as u32;
    let expanded_height = ((width as f32 * sin) + (height as f32 * cos))
        .ceil()
        .max(1.0) as u32;

    let mut padded = RgbaImage::from_pixel(expanded_width, expanded_height, Rgba([0, 0, 0, 0]));
    let x_offset = ((expanded_width as i64 - width as i64) / 2).max(0);
    let y_offset = ((expanded_height as i64 - height as i64) / 2).max(0);
    overlay(&mut padded, source, x_offset, y_offset);

    rotate_about_center(&padded, radians, Interpolation::Bicubic, Rgba([0, 0, 0, 0]))
}

/// Encode a `DynamicImage` into the requested output format.
fn encode_image(image: &DynamicImage, output_format: &str, quality: u8) -> Result<Vec<u8>, String> {
    match output_format {
        "jpeg" => {
            let mut bytes = Vec::new();
            let rgb = image.to_rgb8();
            let mut encoder = codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality);
            encoder
                .encode_image(&DynamicImage::ImageRgb8(rgb))
                .map_err(|error| format!("Failed to encode JPEG: {error}"))?;
            Ok(bytes)
        }
        "webp" => {
            let mut bytes = Vec::new();
            let rgba = image.to_rgba8();
            let (width, height) = rgba.dimensions();
            let encoder = codecs::webp::WebPEncoder::new_lossless(&mut bytes);
            encoder
                .encode(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
                .map_err(|error| format!("Failed to encode WebP: {error}"))?;
            Ok(bytes)
        }
        _ => {
            let mut cursor = Cursor::new(Vec::new());
            image
                .write_to(&mut cursor, ImageFormat::Png)
                .map_err(|error| format!("Failed to encode PNG: {error}"))?;
            Ok(cursor.into_inner())
        }
    }
}

/// Process a bulk export: read images from disk, apply transforms, and return
/// a base64-encoded ZIP archive.
pub fn process_bulk_export(
    files: Vec<ExportInputFile>,
    config: ExportConfig,
) -> Result<ProcessBulkExportResult, String> {
    let output_format = normalize_output_format(config.format.as_deref());
    let quality = config.quality.unwrap_or(90).clamp(1, 100);
    let if_file_exists = normalize_if_exists(config.if_file_exists.as_deref());
    let output_ext = output_extension(output_format);

    let mut output_entries: HashMap<String, Vec<u8>> = HashMap::new();
    let mut output_order: Vec<String> = Vec::new();
    let mut skipped_count = 0usize;

    for payload in files {
        // Read image bytes from the file path on disk.
        let raw_bytes = fs::read(&payload.file_path).map_err(|error| {
            format!("Failed to read file {}: {error}", payload.file_path)
        })?;

        let mut image = image::load_from_memory(&raw_bytes)
            .map_err(|error| format!("Failed to load image {}: {error}", payload.filename))?;

        let crop_entry = config
            .crops
            .get(&payload.filename)
            .cloned()
            .unwrap_or_default();

        let transforms = crop_entry.transforms.unwrap_or_default();
        if transforms.rotate.abs() > f64::EPSILON {
            let rotated = rotate_with_expand(&image.to_rgba8(), transforms.rotate as f32);
            image = DynamicImage::ImageRgba8(rotated);
        }

        if transforms.flip.horizontal {
            image = DynamicImage::ImageRgba8(imageops::flip_horizontal(&image.to_rgba8()));
        }

        if transforms.flip.vertical {
            image = DynamicImage::ImageRgba8(imageops::flip_vertical(&image.to_rgba8()));
        }

        if let Some(coords) = crop_entry.coordinates.as_ref() {
            let (img_width, img_height) = image.dimensions();
            if img_width > 0 && img_height > 0 {
                let left = clamp_to_image_bounds(coords.left.floor(), img_width.saturating_sub(1));
                let top = clamp_to_image_bounds(coords.top.floor(), img_height.saturating_sub(1));

                let available_width = img_width.saturating_sub(left).max(1);
                let available_height = img_height.saturating_sub(top).max(1);

                let crop_width = clamp_to_image_bounds(coords.width.max(1.0), available_width);
                let crop_height = clamp_to_image_bounds(coords.height.max(1.0), available_height);

                image = image.crop_imm(left, top, crop_width.max(1), crop_height.max(1));
            }
        }

        if let Some(output_width_raw) = crop_entry.output_width {
            if output_width_raw.is_finite() && output_width_raw > 0.0 {
                let target_width = output_width_raw.round().max(1.0) as u32;
                let (source_width, source_height) = image.dimensions();
                if source_width > 0 && source_height > 0 {
                    let ratio = source_width as f64 / source_height as f64;
                    let target_height = (target_width as f64 / ratio).round().max(1.0) as u32;
                    image = image.resize_exact(target_width, target_height, FilterType::Lanczos3);

                    if target_width < source_width {
                        image = DynamicImage::ImageRgba8(imageops::unsharpen(
                            &image.to_rgba8(),
                            1.0,
                            3,
                        ));
                    }
                }
            }
        }

        let output_bytes = encode_image(&image, output_format, quality)?;
        let original_name = crop_entry
            .original_name
            .clone()
            .unwrap_or_else(|| payload.filename.clone());
        let base_stem = std::path::Path::new(&original_name)
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("image");

        let mut target_name = format!("{base_stem}{output_ext}");
        if output_entries.contains_key(&target_name) {
            match if_file_exists {
                "skip" => {
                    skipped_count += 1;
                    continue;
                }
                "overwrite" => {
                    output_entries.insert(target_name.clone(), output_bytes);
                    continue;
                }
                _ => {
                    target_name = append_suffix_name(base_stem, output_ext, &output_entries);
                }
            }
        }

        output_entries.insert(target_name.clone(), output_bytes);
        output_order.push(target_name);
    }

    let mut zip_writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let file_options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for output_name in &output_order {
        let Some(file_bytes) = output_entries.get(output_name) else {
            continue;
        };
        zip_writer
            .start_file(output_name, file_options)
            .map_err(|error| format!("Failed to write zip entry {output_name}: {error}"))?;
        zip_writer
            .write_all(file_bytes)
            .map_err(|error| format!("Failed to write zip data for {output_name}: {error}"))?;
    }

    let zip_bytes = zip_writer
        .finish()
        .map_err(|error| format!("Failed to finalize zip export: {error}"))?
        .into_inner();

    Ok(ProcessBulkExportResult {
        zip_base64: BASE64_STANDARD.encode(zip_bytes),
        file_name: "processed_images.zip".to_string(),
        processed_count: output_order.len(),
        skipped_count,
    })
}
