use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::helpers::{is_supported_image_path, normalize_path_for_ui};
use crate::models::{NativeRootScan, NativeScannedImage};

/// Recursively collect all supported image file paths under `directory`.
fn collect_image_paths(directory: &Path, collector: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let path = entry.path();
        if path.is_dir() {
            collect_image_paths(&path, collector);
            continue;
        }
        if is_supported_image_path(&path) {
            collector.push(path);
        }
    }
}

/// Scan a single root directory and return metadata for every image found.
///
/// This does **not** read file contents — only paths, sizes, and timestamps.
pub fn scan_single_root(root_path: &Path) -> Result<NativeRootScan, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!(
            "Root path is not an accessible directory: {}",
            normalize_path_for_ui(root_path)
        ));
    }

    let canonical_root = fs::canonicalize(root_path).unwrap_or_else(|_| root_path.to_path_buf());
    let directory_name = canonical_root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| normalize_path_for_ui(&canonical_root));

    let mut file_paths = Vec::new();
    collect_image_paths(&canonical_root, &mut file_paths);
    file_paths.sort();

    let mut images = Vec::with_capacity(file_paths.len());
    for file_path in &file_paths {
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string();

        let relative_tail = file_path
            .strip_prefix(&canonical_root)
            .unwrap_or(file_path.as_path());
        let relative_path =
            normalize_path_for_ui(&Path::new(&directory_name).join(relative_tail));

        let absolute_path = normalize_path_for_ui(file_path);

        let metadata = fs::metadata(file_path).ok();
        let size = metadata.as_ref().map_or(0, |m| m.len());
        let last_modified = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        images.push(NativeScannedImage {
            relative_path,
            file_name,
            absolute_path,
            size,
            last_modified,
        });
    }

    Ok(NativeRootScan {
        root_path: normalize_path_for_ui(&canonical_root),
        directory_name,
        images,
    })
}
