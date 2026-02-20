use image::ImageFormat;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::SystemTime;
use tauri::AppHandle;
use tauri::Manager;

const THUMBNAILS_DIR: &str = "thumbnails";

/// Resolution for thumbnails.
const THUMB_SIZE: u32 = 512;

/// Get the path to a cached thumbnail for the given image.
/// If it doesn't exist or is stale, generate it.
pub fn get_or_create_thumbnail(
    app: &AppHandle,
    image_path: &Path,
) -> Result<Vec<u8>, String> {
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
    let hash = hasher.finish();
    
    let thumb_path = cache_dir.join(format!("{:x}.webp", hash));

    // If cached version exists, return it.
    if thumb_path.exists() {
        return fs::read(&thumb_path).map_err(|e| format!("Failed to read cached thumb: {}", e));
    }

    // Otherwise, generate new thumbnail.
    let img = image::open(image_path)
        .map_err(|e| format!("Failed to open image for thumb: {}", e))?;
    
    let thumb = img.thumbnail(THUMB_SIZE, THUMB_SIZE);
    
    // Save to cache as WebP for efficiency.
    let mut buffer = std::io::Cursor::new(Vec::new());
    thumb
        .write_to(&mut buffer, ImageFormat::WebP)
        .map_err(|e| format!("Failed to encode thumb: {}", e))?;
    
    let bytes = buffer.into_inner();
    
    // Write to disk for next time (ignore errors on write-to-cache, just serve it).
    let _ = fs::write(&thumb_path, &bytes);

    Ok(bytes)
}
