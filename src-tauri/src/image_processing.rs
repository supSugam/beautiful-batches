use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::{BufWriter, Cursor, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use image::imageops::{self, overlay, FilterType};
use image::{codecs, DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use rayon::prelude::*;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::helpers::{
    append_suffix_name, clamp_to_image_bounds, normalize_output_format, output_extension,
};
use crate::models::{
    CropConfig, ExecuteExportPlanItem, ExecuteExportPlanRequest, ExecuteExportPlanResult,
    ExportConfig, ExportInputFile, ProcessBulkExportResult,
};

/// Rotate an RGBA image by an arbitrary angle (degrees clockwise), expanding
/// the canvas so the entire rotated image is visible.
fn rotate_with_expand(source: &RgbaImage, degrees_clockwise: f32) -> RgbaImage {
    let degrees = ((degrees_clockwise % 360.0) + 360.0) % 360.0;
    if degrees <= f32::EPSILON || (degrees - 360.0).abs() <= f32::EPSILON {
        return source.clone();
    }

    // Optimization for 90-degree increments
    let quarter_turns = (degrees / 90.0).round() as i32 % 4;
    if (degrees - (quarter_turns as f32 * 90.0)).abs() <= 0.001 {
        return match quarter_turns {
            1 => imageops::rotate90(source),
            2 => imageops::rotate180(source),
            3 => imageops::rotate270(source),
            _ => source.clone(),
        };
    }

    let (width, height) = source.dimensions();
    let radians = (-degrees).to_radians();
    let cos = radians.cos().abs();
    let sin = radians.sin().abs();

    let expanded_width = ((width as f32 * cos) + (height as f32 * sin))
        .ceil()
        .max(1.0) as u32;
    let expanded_height = ((width as f32 * sin) + (height as f32 * cos))
        .ceil()
        .max(1.0) as u32;

    // To prevent clipping during the intermediate rotation, the padded canvas must be large
    // enough to hold the original image completely regardless of its orientation.
    // A square canvas with side = max dimension (or diagonal) is safest.
    let diagonal = ((width as f32).powi(2) + (height as f32).powi(2))
        .sqrt()
        .ceil() as u32;
    let padded_size = diagonal.max(expanded_width).max(expanded_height);

    let mut padded = RgbaImage::from_pixel(padded_size, padded_size, Rgba([0, 0, 0, 0]));
    let x_offset = (padded_size as i64 - width as i64) / 2;
    let y_offset = (padded_size as i64 - height as i64) / 2;
    overlay(&mut padded, source, x_offset, y_offset);

    let rotated_padded =
        rotate_about_center(&padded, radians, Interpolation::Bicubic, Rgba([0, 0, 0, 0]));

    // Crop the result back to the calculated expanded bounding box
    let crop_x = (padded_size.saturating_sub(expanded_width)) / 2;
    let crop_y = (padded_size.saturating_sub(expanded_height)) / 2;

    imageops::crop_imm(
        &rotated_padded,
        crop_x,
        crop_y,
        expanded_width,
        expanded_height,
    )
    .to_image()
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
                .encode(
                    rgba.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
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

fn infer_output_format_from_name(name: &str) -> Option<&'static str> {
    let extension = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match extension.as_str() {
        "jpg" | "jpeg" => Some("jpeg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        "avif" => Some("avif"),
        _ => None,
    }
}

/// Process a bulk export: read images from disk, apply transforms, and return
/// a base64-encoded ZIP archive.
pub fn process_bulk_export(
    files: Vec<ExportInputFile>,
    config: ExportConfig,
    _remover: Option<&()>,
) -> Result<ProcessBulkExportResult, String> {
    let output_format = normalize_output_format(config.format.as_deref());
    let quality = config.quality.unwrap_or(90).clamp(1, 100);
    let clear_image_metadata = config.clear_image_metadata.unwrap_or(false);
    let output_ext = output_extension(output_format);

    let mut output_entries: HashMap<String, Vec<u8>> = HashMap::new();
    let mut output_order: Vec<String> = Vec::new();
    let skipped_count = 0usize;

    for payload in files {
        // Read image bytes from the file path on disk.
        let raw_bytes = fs::read(&payload.file_path)
            .map_err(|error| format!("Failed to read file {}: {error}", payload.file_path))?;

        let mut image = image::load_from_memory(&raw_bytes)
            .map_err(|error| format!("Failed to load image {}: {error}", payload.filename))?;

        let crop_entry = config
            .crops
            .get(&payload.filename)
            .cloned()
            .unwrap_or_default();
        let mut has_visual_changes = false;

        let transforms = crop_entry.transforms.unwrap_or_default();
        if transforms.rotate.abs() > 0.001 {
            has_visual_changes = true;
            let rotated = rotate_with_expand(&image.to_rgba8(), transforms.rotate as f32);
            image = DynamicImage::ImageRgba8(rotated);
        }

        if transforms.flip.horizontal {
            has_visual_changes = true;
            image = DynamicImage::ImageRgba8(imageops::flip_horizontal(&image.to_rgba8()));
        }

        if transforms.flip.vertical {
            has_visual_changes = true;
            image = DynamicImage::ImageRgba8(imageops::flip_vertical(&image.to_rgba8()));
        }

        if let Some(coords) = crop_entry.coordinates.as_ref() {
            has_visual_changes = true;
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
                has_visual_changes = true;
                let target_width = output_width_raw.round().max(1.0) as u32;
                let (source_width, source_height) = image.dimensions();
                if source_width > 0 && source_height > 0 {
                    // Always derive ratio from the actual post-crop image dimensions.
                    // Using the stored `aspect` can cause distortion if it drifted from
                    // the real crop dimensions due to rounding or zoom bake-in.
                    let ratio = source_width as f64 / source_height as f64;
                    let target_height = (target_width as f64 / ratio).round().max(1.0) as u32;
                    image = image.resize_exact(target_width, target_height, FilterType::Lanczos3);
                }
            }
        }

        let source_format = infer_output_format_from_name(&payload.filename)
            .or_else(|| infer_output_format_from_name(&payload.file_path));
        let can_passthrough_original =
            !clear_image_metadata && !has_visual_changes && source_format == Some(output_format);
        let output_bytes = if can_passthrough_original {
            raw_bytes.clone()
        } else {
            encode_image(&image, output_format, quality)?
        };
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
            target_name = append_suffix_name(base_stem, output_ext, &output_entries);
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

const MAX_PADDING_PX: u32 = 640;
const MAX_CORNER_RADIUS_PX: u32 = 360;
const INNER_PADDING_SIDE_RATIO: f64 = 0.4;
const COORD_EQ_TOLERANCE: f64 = 0.51;
const MAX_AUTO_RENAME_ATTEMPTS: usize = 10_000;
const MAX_WARNING_MESSAGES: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DestinationMode {
    Folder,
    Zip,
}

impl DestinationMode {
    fn parse(raw: &str) -> Result<Self, String> {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "folder" => Ok(Self::Folder),
            "zip" => Ok(Self::Zip),
            _ => Err(format!("Unsupported destination mode: {raw}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConflictMode {
    AutoRename,
    Skip,
    Overwrite,
}

impl ConflictMode {
    fn parse(raw: &str) -> Result<Self, String> {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "auto_rename" => Ok(Self::AutoRename),
            "skip" => Ok(Self::Skip),
            "overwrite" => Ok(Self::Overwrite),
            _ => Err(format!("Unsupported conflict mode: {raw}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncodedFormat {
    Png,
    Jpeg,
    Webp,
    Avif,
}

impl EncodedFormat {
    fn key(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::Webp => "webp",
            Self::Avif => "avif",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PaddingValues {
    top: u32,
    right: u32,
    bottom: u32,
    left: u32,
}

#[derive(Debug, Clone, Copy)]
struct CornerRadiusValues {
    top_left: u32,
    top_right: u32,
    bottom_right: u32,
    bottom_left: u32,
}

#[derive(Debug, Clone)]
enum PaddingFillKind {
    Empty,
    Solid(Rgba<u8>),
    Gradient {
        angle_deg: f32,
        start: Rgba<u8>,
        end: Rgba<u8>,
    },
    ImageAsset(String),
}

#[derive(Debug)]
struct PreparedExportItem {
    relative_output_path: PathBuf,
    image_bytes: Vec<u8>,
    caption_text: Option<String>,
}

enum ExportSink {
    Folder {
        root: PathBuf,
    },
    Zip {
        writer: zip::ZipWriter<BufWriter<File>>,
    },
}

impl ExportSink {
    fn write_entry(&mut self, relative_path: &Path, bytes: &[u8]) -> Result<(), String> {
        match self {
            ExportSink::Folder { root } => {
                let absolute = root.join(relative_path);
                if let Some(parent) = absolute.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!(
                            "Failed to create destination directory {}: {error}",
                            parent.display()
                        )
                    })?;
                }
                fs::write(&absolute, bytes).map_err(|error| {
                    format!(
                        "Failed to write export file {}: {error}",
                        absolute.display()
                    )
                })?;
                Ok(())
            }
            ExportSink::Zip { writer } => {
                let options =
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
                let entry_name = path_key(relative_path);
                writer
                    .start_file(&entry_name, options)
                    .map_err(|error| format!("Failed to open zip entry {entry_name}: {error}"))?;
                writer
                    .write_all(bytes)
                    .map_err(|error| format!("Failed to write zip entry {entry_name}: {error}"))?;
                Ok(())
            }
        }
    }

    fn finish(self) -> Result<(), String> {
        match self {
            ExportSink::Folder { .. } => Ok(()),
            ExportSink::Zip { writer } => {
                writer
                    .finish()
                    .map_err(|error| format!("Failed to finalize zip export: {error}"))?;
                Ok(())
            }
        }
    }
}

fn push_warning(warnings: &mut Vec<String>, value: String) {
    if warnings.len() < MAX_WARNING_MESSAGES {
        warnings.push(value);
    }
}

fn sanitize_file_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            control if control.is_control() => '_',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn expand_home_path(value: &str) -> String {
    let raw = value.trim();
    if raw.is_empty() || !raw.starts_with('~') {
        return raw.to_string();
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.trim().is_empty() {
        return raw.to_string();
    }

    if raw == "~" {
        return home;
    }

    if raw.starts_with("~/") || raw.starts_with("~\\") {
        let rest = raw[2..].trim_start_matches(['/', '\\']);
        if rest.is_empty() {
            return home;
        }
        return PathBuf::from(home).join(rest).to_string_lossy().to_string();
    }

    raw.to_string()
}

fn resolve_destination_root(base_folder: &str, destination_name: &str) -> Result<PathBuf, String> {
    let expanded_base = expand_home_path(base_folder);
    if expanded_base.trim().is_empty() {
        return Err("Base destination folder is empty".to_string());
    }

    let safe_segment = sanitize_file_segment(destination_name);
    if safe_segment.is_empty() {
        return Ok(PathBuf::from(expanded_base));
    }

    Ok(PathBuf::from(expanded_base).join(safe_segment))
}

fn normalize_relative_output_path(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute() {
        return Err(format!("Output path must be relative: {raw}"));
    }

    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => cleaned.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Output path contains invalid segments: {raw}"));
            }
        }
    }

    if cleaned.as_os_str().is_empty() {
        return Err("Output path cannot be empty".to_string());
    }
    Ok(cleaned)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn with_numeric_suffix(path: &Path, index: usize) -> PathBuf {
    if index <= 1 {
        return path.to_path_buf();
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("file");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mut next = parent;
    if extension.is_empty() {
        next.push(format!("{stem}_{index}"));
    } else {
        next.push(format!("{stem}_{index}.{extension}"));
    }
    next
}

fn caption_path_for(relative_file_path: &Path) -> PathBuf {
    let mut next = relative_file_path.to_path_buf();
    next.set_extension("txt");
    next
}

fn reserve_used_paths(used: &mut HashSet<String>, image_path: &Path, caption_path: Option<&Path>) {
    used.insert(path_key(image_path));
    if let Some(path) = caption_path {
        used.insert(path_key(path));
    }
}

fn resolve_conflict_path(
    base_relative_path: &Path,
    needs_caption: bool,
    conflict_mode: ConflictMode,
    used_paths: &mut HashSet<String>,
    folder_root: Option<&Path>,
) -> Option<PathBuf> {
    if conflict_mode == ConflictMode::Overwrite {
        return Some(base_relative_path.to_path_buf());
    }

    for attempt in 1..=MAX_AUTO_RENAME_ATTEMPTS {
        let candidate = with_numeric_suffix(base_relative_path, attempt);
        let caption_candidate = if needs_caption {
            Some(caption_path_for(&candidate))
        } else {
            None
        };

        let image_key = path_key(&candidate);
        let image_used = used_paths.contains(&image_key);
        let image_exists = folder_root
            .map(|root| root.join(&candidate).exists())
            .unwrap_or(false);

        let caption_used = caption_candidate
            .as_ref()
            .map(|path| used_paths.contains(&path_key(path)))
            .unwrap_or(false);
        let caption_exists = caption_candidate
            .as_ref()
            .map(|path| {
                folder_root
                    .map(|root| root.join(path).exists())
                    .unwrap_or(false)
            })
            .unwrap_or(false);

        let is_taken = image_used || image_exists || caption_used || caption_exists;
        if !is_taken {
            reserve_used_paths(used_paths, &candidate, caption_candidate.as_deref());
            return Some(candidate);
        }

        if conflict_mode == ConflictMode::Skip {
            return None;
        }
    }

    None
}

fn parse_number_tokens(value: &str) -> Vec<f64> {
    let cleaned = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '+' {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>();

    cleaned
        .split_whitespace()
        .filter_map(|token| token.parse::<f64>().ok())
        .collect()
}

fn expand_quad(values: &[f64]) -> Option<[f64; 4]> {
    if values.is_empty() {
        return None;
    }
    let a = values.get(0).copied().unwrap_or(0.0);
    let b = values.get(1).copied().unwrap_or(a);
    let c = values.get(2).copied().unwrap_or(a);
    let d = values.get(3).copied().unwrap_or(b);

    match values.len() {
        1 => Some([a, a, a, a]),
        2 => Some([a, b, a, b]),
        3 => Some([a, b, c, b]),
        _ => Some([a, b, c, d]),
    }
}

fn clamp_rounded(value: f64, max_value: u32) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(0.0, max_value as f64) as u32
}

fn parse_padding_values(crop: &CropConfig) -> PaddingValues {
    if let Some(raw) = crop.padding.as_ref() {
        if let Some(object) = raw.as_object() {
            return PaddingValues {
                top: clamp_rounded(
                    object
                        .get("top")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_PADDING_PX,
                ),
                right: clamp_rounded(
                    object
                        .get("right")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_PADDING_PX,
                ),
                bottom: clamp_rounded(
                    object
                        .get("bottom")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_PADDING_PX,
                ),
                left: clamp_rounded(
                    object
                        .get("left")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_PADDING_PX,
                ),
            };
        }

        if let Some(text) = raw.as_str() {
            let values = parse_number_tokens(text);
            if let Some(expanded) = expand_quad(&values) {
                return PaddingValues {
                    top: clamp_rounded(expanded[0], MAX_PADDING_PX),
                    right: clamp_rounded(expanded[1], MAX_PADDING_PX),
                    bottom: clamp_rounded(expanded[2], MAX_PADDING_PX),
                    left: clamp_rounded(expanded[3], MAX_PADDING_PX),
                };
            }
        }
    }

    PaddingValues {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    }
}

fn parse_corner_radius_values(crop: &CropConfig) -> CornerRadiusValues {
    if let Some(raw) = crop.corner_radius.as_ref() {
        if let Some(object) = raw.as_object() {
            return CornerRadiusValues {
                top_left: clamp_rounded(
                    object
                        .get("topLeft")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_CORNER_RADIUS_PX,
                ),
                top_right: clamp_rounded(
                    object
                        .get("topRight")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_CORNER_RADIUS_PX,
                ),
                bottom_right: clamp_rounded(
                    object
                        .get("bottomRight")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_CORNER_RADIUS_PX,
                ),
                bottom_left: clamp_rounded(
                    object
                        .get("bottomLeft")
                        .and_then(|value| value.as_f64())
                        .unwrap_or(0.0),
                    MAX_CORNER_RADIUS_PX,
                ),
            };
        }

        if let Some(text) = raw.as_str() {
            let values = parse_number_tokens(text);
            if let Some(expanded) = expand_quad(&values) {
                return CornerRadiusValues {
                    top_left: clamp_rounded(expanded[0], MAX_CORNER_RADIUS_PX),
                    top_right: clamp_rounded(expanded[1], MAX_CORNER_RADIUS_PX),
                    bottom_right: clamp_rounded(expanded[2], MAX_CORNER_RADIUS_PX),
                    bottom_left: clamp_rounded(expanded[3], MAX_CORNER_RADIUS_PX),
                };
            }
        }
    }

    CornerRadiusValues {
        top_left: 0,
        top_right: 0,
        bottom_right: 0,
        bottom_left: 0,
    }
}

fn clamp_padding_to_reference(padding: PaddingValues, width: u32, height: u32) -> PaddingValues {
    let safe_width = width.max(1) as f64;
    let safe_height = height.max(1) as f64;
    
    // To maintain perfectly even padding, we must use the more restrictive dimension's cap
    // for all sides. Otherwise, a tall image would allow more top/bottom padding than
    // left/right, causing visible imbalance.
    let horizontal_cap = (safe_width * INNER_PADDING_SIDE_RATIO).round() as u32;
    let vertical_cap = (safe_height * INNER_PADDING_SIDE_RATIO).round() as u32;
    let global_cap = horizontal_cap.min(vertical_cap).min(MAX_PADDING_PX);

    PaddingValues {
        top: padding.top.min(global_cap),
        right: padding.right.min(global_cap),
        bottom: padding.bottom.min(global_cap),
        left: padding.left.min(global_cap),
    }
}

fn clamp_corner_radius_to_reference(
    radius: CornerRadiusValues,
    width: u32,
    height: u32,
) -> CornerRadiusValues {
    let max_radius = ((width.min(height) as f64 * 0.5).round() as u32).min(MAX_CORNER_RADIUS_PX);

    CornerRadiusValues {
        top_left: radius.top_left.min(max_radius),
        top_right: radius.top_right.min(max_radius),
        bottom_right: radius.bottom_right.min(max_radius),
        bottom_left: radius.bottom_left.min(max_radius),
    }
}

fn has_padding(padding: PaddingValues) -> bool {
    padding.top > 0 || padding.right > 0 || padding.bottom > 0 || padding.left > 0
}

fn has_corner_radius(radius: CornerRadiusValues) -> bool {
    radius.top_left > 0 || radius.top_right > 0 || radius.bottom_right > 0 || radius.bottom_left > 0
}

fn parse_hex_color(value: &str) -> Option<Rgba<u8>> {
    let token = value.trim().trim_start_matches('#');
    let parse_pair = |pair: &str| u8::from_str_radix(pair, 16).ok();

    match token.len() {
        3 => {
            let r = parse_pair(&token[0..1].repeat(2))?;
            let g = parse_pair(&token[1..2].repeat(2))?;
            let b = parse_pair(&token[2..3].repeat(2))?;
            Some(Rgba([r, g, b, 255]))
        }
        4 => {
            let r = parse_pair(&token[0..1].repeat(2))?;
            let g = parse_pair(&token[1..2].repeat(2))?;
            let b = parse_pair(&token[2..3].repeat(2))?;
            let a = parse_pair(&token[3..4].repeat(2))?;
            Some(Rgba([r, g, b, a]))
        }
        6 => {
            let r = parse_pair(&token[0..2])?;
            let g = parse_pair(&token[2..4])?;
            let b = parse_pair(&token[4..6])?;
            Some(Rgba([r, g, b, 255]))
        }
        8 => {
            let r = parse_pair(&token[0..2])?;
            let g = parse_pair(&token[2..4])?;
            let b = parse_pair(&token[4..6])?;
            let a = parse_pair(&token[6..8])?;
            Some(Rgba([r, g, b, a]))
        }
        _ => None,
    }
}

fn parse_rgb_channel(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(percent) = trimmed.strip_suffix('%') {
        let value = percent.trim().parse::<f64>().ok()?;
        return Some((value / 100.0) * 255.0);
    }

    trimmed.parse::<f64>().ok()
}

fn parse_alpha_channel(token: &str) -> Option<f64> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(percent) = trimmed.strip_suffix('%') {
        let value = percent.trim().parse::<f64>().ok()?;
        return Some((value / 100.0).clamp(0.0, 1.0));
    }

    Some(trimmed.parse::<f64>().ok()?.clamp(0.0, 1.0))
}

fn parse_rgb_function_color(value: &str) -> Option<Rgba<u8>> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    let (is_rgba, body) = if lower.starts_with("rgba(") && trimmed.ends_with(')') {
        (true, &trimmed[5..trimmed.len() - 1])
    } else if lower.starts_with("rgb(") && trimmed.ends_with(')') {
        (false, &trimmed[4..trimmed.len() - 1])
    } else {
        return None;
    };

    let parts = body.split(',').map(|part| part.trim()).collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }

    let red = parse_rgb_channel(parts[0])?.round().clamp(0.0, 255.0) as u8;
    let green = parse_rgb_channel(parts[1])?.round().clamp(0.0, 255.0) as u8;
    let blue = parse_rgb_channel(parts[2])?.round().clamp(0.0, 255.0) as u8;
    let alpha = if is_rgba {
        let token = parts.get(3).copied().unwrap_or("1");
        (parse_alpha_channel(token)?.clamp(0.0, 1.0) * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8
    } else {
        255
    };

    Some(Rgba([red, green, blue, alpha]))
}

fn parse_css_color(value: &str) -> Option<Rgba<u8>> {
    parse_hex_color(value).or_else(|| parse_rgb_function_color(value))
}

fn split_top_level_commas(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;

    for ch in value.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth = (depth - 1).max(0);
                current.push(ch);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn parse_linear_gradient(value: &str) -> Option<(f32, Rgba<u8>, Rgba<u8>)> {
    let trimmed = value.trim();
    if !trimmed.starts_with("linear-gradient(") || !trimmed.ends_with(')') {
        return None;
    }

    let inner = &trimmed["linear-gradient(".len()..trimmed.len() - 1];
    let tokens = split_top_level_commas(inner);
    if tokens.len() != 3 {
        return None;
    }

    let angle_token = tokens[0].trim().strip_suffix("deg")?.trim();
    let angle = angle_token.parse::<f32>().ok()?;
    let start = parse_css_color(tokens[1].trim())?;
    let end = parse_css_color(tokens[2].trim())?;
    Some((angle, start, end))
}

fn parse_padding_fill(crop: &CropConfig) -> PaddingFillKind {
    let fill_type = crop
        .padding_fill_type
        .as_deref()
        .unwrap_or("empty")
        .trim()
        .to_ascii_lowercase();

    match fill_type.as_str() {
        "color" => {
            let raw = crop
                .padding_fill_value
                .as_deref()
                .unwrap_or("#ffffff")
                .trim();
            if let Some((angle, start, end)) = parse_linear_gradient(raw) {
                PaddingFillKind::Gradient {
                    angle_deg: angle,
                    start,
                    end,
                }
            } else if let Some(color) = parse_css_color(raw) {
                PaddingFillKind::Solid(color)
            } else {
                PaddingFillKind::Solid(Rgba([255, 255, 255, 255]))
            }
        }
        "image" => {
            let key = crop.padding_image_url.as_deref().unwrap_or("").trim();
            if key.is_empty() {
                PaddingFillKind::Empty
            } else {
                PaddingFillKind::ImageAsset(key.to_string())
            }
        }
        _ => PaddingFillKind::Empty,
    }
}

fn decode_base64_maybe_data_url(raw: &str) -> Result<Vec<u8>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Base64 payload is empty".to_string());
    }

    let payload = if let Some(index) = trimmed.find(',') {
        let (prefix, body) = trimmed.split_at(index);
        if prefix.contains(";base64") {
            &body[1..]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    BASE64_STANDARD
        .decode(payload)
        .map_err(|error| format!("Failed to decode base64 payload: {error}"))
}

fn load_source_bytes(item: &ExecuteExportPlanItem) -> Result<Vec<u8>, String> {
    let source_path = item.source_path.trim();
    if !source_path.is_empty() {
        if let Ok(bytes) = fs::read(source_path) {
            return Ok(bytes);
        }
    }

    if let Some(encoded) = item.source_data_base64.as_deref() {
        return decode_base64_maybe_data_url(encoded);
    }

    if source_path.is_empty() {
        Err(format!(
            "Missing source path and inline bytes for image {}",
            item.image_id
        ))
    } else {
        Err(format!("Failed to read source file: {source_path}"))
    }
}

fn read_image_dimensions(raw_bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::new(Cursor::new(raw_bytes))
        .with_guessed_format()
        .map_err(|error| format!("Failed to determine image format: {error}"))?;
    reader
        .into_dimensions()
        .map_err(|error| format!("Failed to read source image dimensions: {error}"))
}

fn normalize_rotation(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    let normalized = ((value % 360.0) + 360.0) % 360.0;
    if normalized > 359.999 {
        0.0
    } else {
        normalized
    }
}

fn approx_equal(a: f64, b: f64) -> bool {
    (a - b).abs() <= COORD_EQ_TOLERANCE
}

fn has_visual_changes(crop: &CropConfig, source_width: u32, source_height: u32) -> bool {
    let rotate = normalize_rotation(
        crop.transforms
            .as_ref()
            .map(|value| value.rotate)
            .unwrap_or(0.0),
    );
    let flip_h = crop
        .transforms
        .as_ref()
        .map(|value| value.flip.horizontal)
        .unwrap_or(false);
    let flip_v = crop
        .transforms
        .as_ref()
        .map(|value| value.flip.vertical)
        .unwrap_or(false);
    if rotate > 0.001 || flip_h || flip_v {
        return true;
    }

    let output_width = crop.output_width.unwrap_or(0.0);
    if output_width.is_finite() && output_width > 0.0 {
        return true;
    }

    // Background fill now applies behind transparency even when padding is 0.
    if !matches!(parse_padding_fill(crop), PaddingFillKind::Empty) {
        return true;
    }

    let padding =
        clamp_padding_to_reference(parse_padding_values(crop), source_width, source_height);
    if has_padding(padding) {
        return true;
    }

    let corner = clamp_corner_radius_to_reference(
        parse_corner_radius_values(crop),
        source_width,
        source_height,
    );
    if has_corner_radius(corner) {
        return true;
    }

    if let Some(coords) = crop.coordinates.as_ref() {
        if !approx_equal(coords.left, 0.0) || !approx_equal(coords.top, 0.0) {
            return true;
        }
        if !approx_equal(coords.width, source_width as f64) {
            return true;
        }
        if !approx_equal(coords.height, source_height as f64) {
            return true;
        }
    }

    false
}

fn apply_primary_edits(mut image: DynamicImage, crop: &CropConfig) -> DynamicImage {
    let transforms = crop.transforms.clone().unwrap_or_default();
    if transforms.rotate.abs() > 0.001 {
        let rotated = rotate_with_expand(&image.to_rgba8(), transforms.rotate as f32);
        image = DynamicImage::ImageRgba8(rotated);
    }

    if transforms.flip.horizontal {
        image = DynamicImage::ImageRgba8(imageops::flip_horizontal(&image.to_rgba8()));
    }

    if transforms.flip.vertical {
        image = DynamicImage::ImageRgba8(imageops::flip_vertical(&image.to_rgba8()));
    }

    image
}

fn apply_crop_only(mut image: DynamicImage, crop: &CropConfig) -> DynamicImage {
    if let Some(coords) = crop.coordinates.as_ref() {
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
    image
}

fn apply_resize_only(mut image: DynamicImage, crop: &CropConfig) -> DynamicImage {
    if let Some(output_width_raw) = crop.output_width {
        if output_width_raw.is_finite() && output_width_raw > 0.0 {
            let target_width = output_width_raw.round().max(1.0) as u32;
            let (source_width, source_height) = image.dimensions();
            if source_width > 0 && source_height > 0 {
                let ratio = source_width as f64 / source_height as f64;
                let target_height = (target_width as f64 / ratio).round().max(1.0) as u32;
                image = image.resize_exact(target_width, target_height, FilterType::Lanczos3);
            }
        }
    }
    image
}

fn lerp_channel(start: u8, end: u8, t: f32) -> u8 {
    let start = start as f32;
    let end = end as f32;
    (start + (end - start) * t).round().clamp(0.0, 255.0) as u8
}

fn render_linear_gradient(
    width: u32,
    height: u32,
    angle_deg: f32,
    start: Rgba<u8>,
    end: Rgba<u8>,
) -> RgbaImage {
    let safe_width = width.max(1);
    let safe_height = height.max(1);
    let mut image = RgbaImage::new(safe_width, safe_height);

    let radians = angle_deg.to_radians();
    let dx = radians.sin();
    let dy = -radians.cos();
    let extent = ((dx.abs() + dy.abs()) * 0.5).max(0.0001);

    for y in 0..safe_height {
        let ny = ((y as f32 + 0.5) / safe_height as f32) - 0.5;
        for x in 0..safe_width {
            let nx = ((x as f32 + 0.5) / safe_width as f32) - 0.5;
            let projection = (nx * dx + ny * dy) / extent;
            let t = ((projection + 1.0) * 0.5).clamp(0.0, 1.0);
            image.put_pixel(
                x,
                y,
                Rgba([
                    lerp_channel(start[0], end[0], t),
                    lerp_channel(start[1], end[1], t),
                    lerp_channel(start[2], end[2], t),
                    lerp_channel(start[3], end[3], t),
                ]),
            );
        }
    }

    image
}

fn fit_cover_image(source: &RgbaImage, width: u32, height: u32) -> RgbaImage {
    let source_width = source.width().max(1);
    let source_height = source.height().max(1);
    let target_width = width.max(1);
    let target_height = height.max(1);

    let scale = f64::max(
        target_width as f64 / source_width as f64,
        target_height as f64 / source_height as f64,
    );
    let draw_width = (source_width as f64 * scale).ceil().max(1.0) as u32;
    let draw_height = (source_height as f64 * scale).ceil().max(1.0) as u32;

    let resized = imageops::resize(source, draw_width, draw_height, FilterType::Lanczos3);
    let offset_x = draw_width.saturating_sub(target_width) / 2;
    let offset_y = draw_height.saturating_sub(target_height) / 2;
    imageops::crop_imm(&resized, offset_x, offset_y, target_width, target_height).to_image()
}

fn get_padding_asset_image(
    key: &str,
    encoded_assets: &HashMap<String, String>,
    cache: &mut HashMap<String, RgbaImage>,
) -> Result<Option<RgbaImage>, String> {
    if let Some(cached) = cache.get(key) {
        return Ok(Some(cached.clone()));
    }

    let Some(encoded) = encoded_assets.get(key) else {
        return Ok(None);
    };
    let bytes = decode_base64_maybe_data_url(encoded)?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("Failed to decode padding image asset: {error}"))?
        .to_rgba8();

    cache.insert(key.to_string(), image.clone());
    Ok(Some(image))
}

fn render_padding_background(
    width: u32,
    height: u32,
    fill: &PaddingFillKind,
    encoded_assets: &HashMap<String, String>,
    decoded_assets: &mut HashMap<String, RgbaImage>,
) -> Result<RgbaImage, String> {
    let safe_width = width.max(1);
    let safe_height = height.max(1);

    match fill {
        PaddingFillKind::Empty => Ok(RgbaImage::from_pixel(
            safe_width,
            safe_height,
            Rgba([0, 0, 0, 0]),
        )),
        PaddingFillKind::Solid(color) => Ok(RgbaImage::from_pixel(safe_width, safe_height, *color)),
        PaddingFillKind::Gradient {
            angle_deg,
            start,
            end,
        } => Ok(render_linear_gradient(
            safe_width,
            safe_height,
            *angle_deg,
            *start,
            *end,
        )),
        PaddingFillKind::ImageAsset(key) => {
            let Some(source) = get_padding_asset_image(key, encoded_assets, decoded_assets)? else {
                return Err(format!("Missing padding image asset for key: {key}"));
            };
            Ok(fit_cover_image(&source, safe_width, safe_height))
        }
    }
}

fn apply_corner_mask_to_corner(image: &mut RgbaImage, radius: u32, corner: &'static str) {
    if radius == 0 {
        return;
    }

    let width = image.width();
    let height = image.height();
    let safe_radius = radius.min(width).min(height);
    if safe_radius == 0 {
        return;
    }

    let radius_f = safe_radius as f32;
    let radius_sq = radius_f * radius_f;

    for local_y in 0..safe_radius {
        for local_x in 0..safe_radius {
            let dx = radius_f - (local_x as f32 + 0.5);
            let dy = radius_f - (local_y as f32 + 0.5);
            if dx * dx + dy * dy <= radius_sq {
                continue;
            }

            let (pixel_x, pixel_y) = match corner {
                "top_left" => (local_x, local_y),
                "top_right" => (width - safe_radius + local_x, local_y),
                "bottom_right" => (
                    width - safe_radius + local_x,
                    height - safe_radius + local_y,
                ),
                "bottom_left" => (local_x, height - safe_radius + local_y),
                _ => continue,
            };

            if pixel_x >= width || pixel_y >= height {
                continue;
            }

            let pixel = image.get_pixel_mut(pixel_x, pixel_y);
            pixel[3] = 0;
        }
    }
}

fn apply_corner_mask(image: &mut RgbaImage, radius: CornerRadiusValues) {
    apply_corner_mask_to_corner(image, radius.top_left, "top_left");
    apply_corner_mask_to_corner(image, radius.top_right, "top_right");
    apply_corner_mask_to_corner(image, radius.bottom_right, "bottom_right");
    apply_corner_mask_to_corner(image, radius.bottom_left, "bottom_left");
}

fn apply_inner_padding_and_corner(
    image: DynamicImage,
    crop: &CropConfig,
    encoded_assets: &HashMap<String, String>,
    decoded_assets: &mut HashMap<String, RgbaImage>,
) -> Result<DynamicImage, String> {
    let (width, height) = image.dimensions();
    let safe_width = width.max(1);
    let safe_height = height.max(1);

    let padding = clamp_padding_to_reference(parse_padding_values(crop), safe_width, safe_height);

    // Content preserves aspect ratio: we scale the image uniformly to fit inside the
    // available area, then center it within the padding constraints.
    let available_width = safe_width
        .saturating_sub(padding.left.saturating_add(padding.right))
        .max(1);
    let available_height = safe_height
        .saturating_sub(padding.top.saturating_add(padding.bottom))
        .max(1);

    let scale_w = (available_width as f64) / (safe_width as f64);
    let scale_h = (available_height as f64) / (safe_height as f64);
    let scale = scale_w.max(scale_h).max(0.0);

    let content_width = ((safe_width as f64) * scale).round().max(1.0) as u32;
    let content_height = ((safe_height as f64) * scale).round().max(1.0) as u32;

    let mut content_rgba = image
        .resize_exact(content_width, content_height, FilterType::Lanczos3)
        .to_rgba8();

    // To implement "cover" with even padding, we center-crop the scaled image
    // back to the available (padded) area before overlaying.
    // Pixel-level precision: Integer division ensures we stay on the pixel grid. 
    // Symmetry is guaranteed to within 1 pixel (the smallest possible unit) 
    // if dimensions have differing parities.
    let crop_x = (content_width.saturating_sub(available_width)) / 2;
    let crop_y = (content_height.saturating_sub(available_height)) / 2;
    content_rgba = imageops::crop_imm(
        &content_rgba,
        crop_x,
        crop_y,
        available_width,
        available_height,
    )
    .to_image();

    let fill = parse_padding_fill(crop);
    let has_fill = !matches!(fill, PaddingFillKind::Empty);
    let has_padding_area = has_padding(padding);

    // Corner radius applies to the visible content area.
    let corner = clamp_corner_radius_to_reference(
        parse_corner_radius_values(crop),
        available_width,
        available_height,
    );
    let has_corner = has_corner_radius(corner);

    if !has_padding_area && !has_corner && !has_fill {
        return Ok(DynamicImage::ImageRgba8(content_rgba));
    }

    let mut composed = render_padding_background(
        safe_width,
        safe_height,
        &fill,
        encoded_assets,
        decoded_assets,
    )?;

    if has_corner {
        apply_corner_mask(&mut content_rgba, corner);
    }

    overlay(
        &mut composed,
        &content_rgba,
        padding.left as i64,
        padding.top as i64,
    );
    Ok(DynamicImage::ImageRgba8(composed))
}

fn flatten_rgba_to_rgb(image: &DynamicImage, background: Rgb<u8>) -> RgbImage {
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = RgbImage::new(width, height);

    for y in 0..height {
        for x in 0..width {
            let pixel = rgba.get_pixel(x, y);
            let alpha = pixel[3] as f32 / 255.0;
            let inv_alpha = 1.0 - alpha;
            let r = (pixel[0] as f32 * alpha + background[0] as f32 * inv_alpha)
                .round()
                .clamp(0.0, 255.0) as u8;
            let g = (pixel[1] as f32 * alpha + background[1] as f32 * inv_alpha)
                .round()
                .clamp(0.0, 255.0) as u8;
            let b = (pixel[2] as f32 * alpha + background[2] as f32 * inv_alpha)
                .round()
                .clamp(0.0, 255.0) as u8;
            rgb.put_pixel(x, y, Rgb([r, g, b]));
        }
    }

    rgb
}

fn encode_image_for_format(
    image: &DynamicImage,
    output_format: EncodedFormat,
    quality: u8,
) -> Result<Vec<u8>, String> {
    match output_format {
        EncodedFormat::Jpeg => {
            let mut bytes = Vec::new();
            let flattened = flatten_rgba_to_rgb(image, Rgb([255, 255, 255]));
            let mut encoder = codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality);
            encoder
                .encode_image(&DynamicImage::ImageRgb8(flattened))
                .map_err(|error| format!("Failed to encode JPEG: {error}"))?;
            Ok(bytes)
        }
        EncodedFormat::Webp => {
            let mut bytes = Vec::new();
            let rgba = image.to_rgba8();
            let (width, height) = rgba.dimensions();
            let encoder = codecs::webp::WebPEncoder::new_lossless(&mut bytes);
            encoder
                .encode(
                    rgba.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|error| format!("Failed to encode WebP: {error}"))?;
            Ok(bytes)
        }
        EncodedFormat::Avif => {
            let mut cursor = Cursor::new(Vec::new());
            image
                .write_to(&mut cursor, ImageFormat::Avif)
                .map_err(|error| format!("Failed to encode AVIF: {error}"))?;
            Ok(cursor.into_inner())
        }
        EncodedFormat::Png => {
            let mut cursor = Cursor::new(Vec::new());
            image
                .write_to(&mut cursor, ImageFormat::Png)
                .map_err(|error| format!("Failed to encode PNG: {error}"))?;
            Ok(cursor.into_inner())
        }
    }
}

fn infer_encoded_format_from_path(path: &Path) -> EncodedFormat {
    match infer_output_format_from_name(path.to_string_lossy().as_ref()).unwrap_or("png") {
        "jpeg" => EncodedFormat::Jpeg,
        "webp" => EncodedFormat::Webp,
        "avif" => EncodedFormat::Avif,
        _ => EncodedFormat::Png,
    }
}

fn normalize_caption_text(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

#[allow(dead_code)]
fn prepare_export_item(

    item: &ExecuteExportPlanItem,
    include_captions: bool,
    quality: u8,
    clear_metadata: bool,
    conflict_mode: ConflictMode,
    folder_root: Option<&Path>,
    used_paths: &mut HashSet<String>,
    encoded_assets: &HashMap<String, String>,
    decoded_assets: &mut HashMap<String, RgbaImage>,
    _remover: Option<&()>,
    _remove_watermarks: bool,
) -> Result<Option<PreparedExportItem>, String> {
    if let Some(skip) = item.skip {
        if skip {
            return Ok(None);
        }
    }

    let normalized_relative_path = normalize_relative_output_path(&item.output_path)?;
    let caption_text = if include_captions {
        item.caption
            .as_deref()
            .map(normalize_caption_text)
            .filter(|value| !value.trim().is_empty())
    } else {
        None
    };
    let needs_caption = caption_text.is_some();

    let Some(final_relative_path) = resolve_conflict_path(
        &normalized_relative_path,
        needs_caption,
        conflict_mode,
        used_paths,
        folder_root,
    ) else {
        return Ok(None);
    };

    let desired_format = infer_encoded_format_from_path(&final_relative_path);
    let source_bytes = load_source_bytes(item)?;
    let source_dimensions = read_image_dimensions(&source_bytes)?;
    let crop = item.crop.clone().unwrap_or_default();
    let has_changes = has_visual_changes(&crop, source_dimensions.0, source_dimensions.1);

    let source_format = item
        .source_name
        .as_deref()
        .and_then(infer_output_format_from_name)
        .or_else(|| infer_output_format_from_name(&item.source_path));
    let can_passthrough_original =
        !clear_metadata && !has_changes && source_format == Some(desired_format.key());

    let image_bytes = if can_passthrough_original {
        source_bytes
    } else {
        let image = image::load_from_memory(&source_bytes)
            .map_err(|error| format!("Failed to decode source image {}: {error}", item.image_id))?;

        // Order matters for correct padding & composition:
        // 1) Primary edits (rotate/flip) on full source
        // 2) Crop to requested region
        // 3) Background fill + inner padding + content-only corner radius (applied TO cropped result)
        // 4) Output resize (scales everything uniformly to final target width)
        let image = apply_primary_edits(image, &crop);
        let image = apply_crop_only(image, &crop);
        let image = apply_inner_padding_and_corner(image, &crop, encoded_assets, decoded_assets)?;
        let image = apply_resize_only(image, &crop);
        encode_image_for_format(&image, desired_format, quality)?
    };

    Ok(Some(PreparedExportItem {
        relative_output_path: final_relative_path,
        image_bytes,
        caption_text,
    }))
}

pub fn execute_export_plan(
    request: ExecuteExportPlanRequest,
    _remover: Option<&()>,
) -> Result<ExecuteExportPlanResult, String> {
    let destination_mode = DestinationMode::parse(&request.destination_mode)?;
    let conflict_mode = ConflictMode::parse(&request.conflict_mode)?;
    let quality = request.quality.unwrap_or(92).clamp(1, 100);
    let clear_metadata = request.clear_metadata.unwrap_or(false);
    let include_captions = request.include_captions.unwrap_or(false);

    if request.items.is_empty() {
        return Err("No planned files to export".to_string());
    }

    let destination_root =
        resolve_destination_root(&request.base_folder, &request.destination_name)?;
    if let Some(parent) = destination_root.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create destination parent directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let mut warnings: Vec<String> = Vec::new();
    let mut written_count = 0usize;
    let mut skipped_count = 0usize;
    let mut caption_written_count = 0usize;
    let mut failed_count = 0usize;
    let mut used_paths = HashSet::<String>::new();

    // ── Phase 1: Sequential path resolution ──────────────────────────
    // Resolve output paths and captions sequentially (needs &mut used_paths).
    // This is very fast compared to image processing.
    struct ResolvedItem {
        index: usize,
        relative_output_path: PathBuf,
        caption_text: Option<String>,
    }

    let folder_root_for_conflict = match destination_mode {
        DestinationMode::Folder => {
            fs::create_dir_all(&destination_root).map_err(|error| {
                format!(
                    "Failed to create destination folder {}: {error}",
                    destination_root.display()
                )
            })?;
            Some(destination_root.clone())
        }
        DestinationMode::Zip => {
            // No folder root on disk for zips
            None
        }
    };

    let mut resolved_items: Vec<ResolvedItem> = Vec::with_capacity(request.items.len());

    for (index, item) in request.items.iter().enumerate() {
        if item.skip.unwrap_or(false) {
            skipped_count += 1;
            continue;
        }

        let normalized_relative_path = match normalize_relative_output_path(&item.output_path) {
            Ok(path) => path,
            Err(error) => {
                failed_count += 1;
                push_warning(&mut warnings, format!("Failed to resolve path for {}: {error}", item.image_id));
                continue;
            }
        };

        let caption_text = if include_captions {
            item.caption
                .as_deref()
                .map(normalize_caption_text)
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        };
        let needs_caption = caption_text.is_some();

        let Some(final_relative_path) = resolve_conflict_path(
            &normalized_relative_path,
            needs_caption,
            conflict_mode,
            &mut used_paths,
            folder_root_for_conflict.as_deref(),
        ) else {
            skipped_count += 1;
            continue;
        };

        resolved_items.push(ResolvedItem {
            index,
            relative_output_path: final_relative_path,
            caption_text,
        });
    }

    // ── Phase 2: Parallel image processing ───────────────────────────
    // This is the CPU-intensive phase: decode → transform → crop → pad → resize → encode.
    // Uses Rayon par_iter for multi-core speedup.
    let decoded_assets_mutex = Mutex::new(HashMap::<String, RgbaImage>::new());

    let processed_results: Vec<(usize, Result<PreparedExportItem, String>)> = resolved_items
        .par_iter()
        .map(|resolved| {
            let item = &request.items[resolved.index];
            let crop = item.crop.clone().unwrap_or_default();
            let desired_format = infer_encoded_format_from_path(&resolved.relative_output_path);

            let source_bytes = match load_source_bytes(item) {
                Ok(bytes) => bytes,
                Err(error) => return (resolved.index, Err(error)),
            };

            let source_dimensions = match read_image_dimensions(&source_bytes) {
                Ok(dims) => dims,
                Err(error) => return (resolved.index, Err(error)),
            };

            let has_changes = has_visual_changes(&crop, source_dimensions.0, source_dimensions.1);

            let source_format = item
                .source_name
                .as_deref()
                .and_then(infer_output_format_from_name)
                .or_else(|| infer_output_format_from_name(&item.source_path));
            let can_passthrough_original =
                !clear_metadata && !has_changes && source_format == Some(desired_format.key());

            let image_bytes = if can_passthrough_original {
                source_bytes
            } else {
                let image = match image::load_from_memory(&source_bytes) {
                    Ok(img) => img,
                    Err(error) => return (resolved.index, Err(format!("Failed to decode source image {}: {error}", item.image_id))),
                };

                let image = apply_primary_edits(image, &crop);
                let image = apply_crop_only(image, &crop);

                // Lock decoded_assets only when needed for padding
                let image = {
                    let mut assets = decoded_assets_mutex.lock().unwrap();
                    match apply_inner_padding_and_corner(image, &crop, &request.padding_image_assets, &mut assets) {
                        Ok(img) => img,
                        Err(error) => return (resolved.index, Err(error)),
                    }
                };

                let image = apply_resize_only(image, &crop);
                match encode_image_for_format(&image, desired_format, quality) {
                    Ok(bytes) => bytes,
                    Err(error) => return (resolved.index, Err(error)),
                }
            };

            (resolved.index, Ok(PreparedExportItem {
                relative_output_path: resolved.relative_output_path.clone(),
                image_bytes,
                caption_text: resolved.caption_text.clone(),
            }))
        })
        .collect();

    // ── Phase 3: Sequential write ────────────────────────────────────
    // Write processed results to disk/zip in order.
    let destination_path = match destination_mode {
        DestinationMode::Folder => {
            let mut sink = ExportSink::Folder {
                root: destination_root.clone(),
            };

            for (_index, result) in processed_results {
                match result {
                    Ok(prepared) => {
                        if let Err(error) =
                            sink.write_entry(&prepared.relative_output_path, &prepared.image_bytes)
                        {
                            failed_count += 1;
                            push_warning(
                                &mut warnings,
                                format!(
                                    "Failed to write {}: {error}",
                                    prepared.relative_output_path.display()
                                ),
                            );
                            continue;
                        }

                        written_count += 1;

                        if let Some(caption) = prepared.caption_text.as_ref() {
                            let sidecar = caption_path_for(&prepared.relative_output_path);
                            if let Err(error) = sink.write_entry(&sidecar, caption.as_bytes()) {
                                failed_count += 1;
                                push_warning(
                                    &mut warnings,
                                    format!(
                                        "Failed to write caption {}: {error}",
                                        sidecar.display()
                                    ),
                                );
                            } else {
                                caption_written_count += 1;
                            }
                        }
                    }
                    Err(error) => {
                        failed_count += 1;
                        push_warning(&mut warnings, format!("Failed to process image: {error}"));
                    }
                }
            }

            sink.finish()?;
            destination_root
        }
        DestinationMode::Zip => {
            let mut zip_path = PathBuf::from(format!("{}.zip", destination_root.to_string_lossy()));
            if zip_path.exists() {
                match conflict_mode {
                    ConflictMode::Overwrite => {}
                    ConflictMode::Skip => {
                        return Ok(ExecuteExportPlanResult {
                            destination_path: zip_path.to_string_lossy().to_string(),
                            written_count: 0,
                            skipped_count: request.items.len(),
                            caption_written_count: 0,
                            failed_count: 0,
                            warnings: vec![format!(
                                "Skipped export because zip already exists: {}",
                                zip_path.display()
                            )],
                        });
                    }
                    ConflictMode::AutoRename => {
                        for index in 2..=MAX_AUTO_RENAME_ATTEMPTS {
                            let candidate = with_numeric_suffix(&zip_path, index);
                            if !candidate.exists() {
                                zip_path = candidate;
                                break;
                            }
                        }
                    }
                }
            }

            if let Some(parent) = zip_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "Failed to create zip destination directory {}: {error}",
                        parent.display()
                    )
                })?;
            }

            let zip_file = File::create(&zip_path).map_err(|error| {
                format!("Failed to create zip file {}: {error}", zip_path.display())
            })?;
            let mut sink = ExportSink::Zip {
                writer: zip::ZipWriter::new(BufWriter::new(zip_file)),
            };

            for (_index, result) in processed_results {
                match result {
                    Ok(prepared) => {
                        if let Err(error) =
                            sink.write_entry(&prepared.relative_output_path, &prepared.image_bytes)
                        {
                            failed_count += 1;
                            push_warning(
                                &mut warnings,
                                format!(
                                    "Failed to write zip entry {}: {error}",
                                    prepared.relative_output_path.display()
                                ),
                            );
                            continue;
                        }

                        written_count += 1;

                        if let Some(caption) = prepared.caption_text.as_ref() {
                            let sidecar = caption_path_for(&prepared.relative_output_path);
                            if let Err(error) = sink.write_entry(&sidecar, caption.as_bytes()) {
                                failed_count += 1;
                                push_warning(
                                    &mut warnings,
                                    format!(
                                        "Failed to write zip caption {}: {error}",
                                        sidecar.display()
                                    ),
                                );
                            } else {
                                caption_written_count += 1;
                            }
                        }
                    }
                    Err(error) => {
                        failed_count += 1;
                        push_warning(&mut warnings, format!("Failed to process image: {error}"));
                    }
                }
            }

            sink.finish()?;
            zip_path
        }
    };

    Ok(ExecuteExportPlanResult {
        destination_path: destination_path.to_string_lossy().to_string(),
        written_count,
        skipped_count,
        caption_written_count,
        failed_count,
        warnings,
    })
}

