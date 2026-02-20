use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::SystemTime;
use tauri::AppHandle;
use tauri::Manager;

const THUMBNAILS_DIR: &str = "thumbnails";

/// Resolution for thumbnails.
const DEFAULT_THUMB_SIZE: u32 = 320;
const MIN_THUMB_SIZE: u32 = 96;
const MAX_THUMB_SIZE: u32 = 768;

fn normalize_thumb_size(requested: Option<u32>) -> u32 {
    let raw = requested.unwrap_or(DEFAULT_THUMB_SIZE);
    raw.clamp(MIN_THUMB_SIZE, MAX_THUMB_SIZE)
}

fn placeholder_thumbnail_bytes() -> Result<Vec<u8>, String> {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 0])));
    let mut buffer = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::WebP)
        .map_err(|e| format!("Failed to encode placeholder thumb: {}", e))?;
    Ok(buffer.into_inner())
}

/// Get the path to a cached thumbnail for the given image.
/// If it doesn't exist or is stale, generate it.
pub fn get_or_create_thumbnail(
    app: &AppHandle,
    image_path: &Path,
    requested_size: Option<u32>,
) -> Result<Vec<u8>, String> {
    let thumb_size = normalize_thumb_size(requested_size);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?
        .join(THUMBNAILS_DIR);

    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create thumb dir: {}", e))?;
    }

    // Generate a unique cache key based on path and modified time.
    let mtime = fs::metadata(image_path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    
    let mut hasher = DefaultHasher::new();
    image_path.hash(&mut hasher);
    mtime.hash(&mut hasher);
    thumb_size.hash(&mut hasher);
    let hash = hasher.finish();
    
    let thumb_path = cache_dir.join(format!("{:x}.webp", hash));

    // If cached version exists, return it.
    if thumb_path.exists() {
        return fs::read(&thumb_path).map_err(|e| format!("Failed to read cached thumb: {}", e));
    }

    // Otherwise, generate new thumbnail.
    let img = match image::open(image_path) {
        Ok(decoded) => decoded,
        Err(_) => {
            // Gracefully handle corrupt/truncated files by caching a tiny placeholder.
            let fallback = placeholder_thumbnail_bytes()?;
            let _ = fs::write(&thumb_path, &fallback);
            return Ok(fallback);
        }
    };
    
    let thumb = img.thumbnail(thumb_size, thumb_size);
    
    // Save to cache as WebP for efficiency.
    let mut buffer = std::io::Cursor::new(Vec::new());
    let bytes = match thumb.write_to(&mut buffer, ImageFormat::WebP) {
        Ok(_) => buffer.into_inner(),
        Err(_) => {
            let fallback = placeholder_thumbnail_bytes()?;
            let _ = fs::write(&thumb_path, &fallback);
            return Ok(fallback);
        }
    };
    
    // Write to disk for next time (ignore errors on write-to-cache, just serve it).
    let _ = fs::write(&thumb_path, &bytes);

    Ok(bytes)
}
