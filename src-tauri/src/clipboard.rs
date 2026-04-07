use tauri::command;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Represents an image read from the clipboard.
#[derive(Debug, serde::Serialize)]
pub struct ClipboardImage {
    /// Base64-encoded PNG image data.
    pub data: String,
    /// MIME type (always "image/png" since we re-encode).
    pub mime_type: String,
}

/// Read image data from the system clipboard.
///
/// Uses the Tauri clipboard manager to read the image as raw RGBA,
/// then re-encodes it as PNG for transfer to the frontend.
#[command]
pub async fn read_clipboard_image(
    app: tauri::AppHandle,
) -> Result<Option<ClipboardImage>, String> {
    let clipboard = app.clipboard();

    match clipboard.read_image() {
        Ok(img) => {
            let width = img.width();
            let height = img.height();
            let rgba_data = img.rgba();

            if width == 0 || height == 0 || rgba_data.is_empty() {
                return Ok(None);
            }

            // The expected data length for RGBA is width * height * 4.
            // On some platforms the clipboard may include extra data.
            let expected_len = (width * height * 4) as usize;

            let img_buffer = if rgba_data.len() >= expected_len {
                &rgba_data[..expected_len]
            } else {
                return Ok(None); // Not enough data — bail out
            };

            let img: image::RgbaImage =
                match image::ImageBuffer::from_raw(width as u32, height as u32, img_buffer.to_vec()) {
                    Some(img) => img,
                    None => {
                        return Err(format!(
                            "Failed to construct image buffer: {}x{}",
                            width, height
                        ));
                    }
                };

            let dynamic_img = image::DynamicImage::ImageRgba8(img);

            let mut png_bytes: Vec<u8> = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut png_bytes);
            dynamic_img
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to encode PNG: {}", e))?;

            let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes);

            Ok(Some(ClipboardImage {
                data,
                mime_type: "image/png".to_string(),
            }))
        }
        Err(_) => {
            // No image in clipboard
            Ok(None)
        }
    }
}

/// Check if the clipboard contains an image.
#[command]
pub async fn has_clipboard_image(app: tauri::AppHandle) -> Result<bool, String> {
    match app.clipboard().read_image() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
