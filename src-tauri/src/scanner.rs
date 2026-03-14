use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::helpers::{is_supported_image_path, normalize_path_for_ui};
use crate::models::{NativeDirectoryChild, NativeRootScan, NativeScannedImage};
use image::image_dimensions;

/// Collect supported image file paths under `directory`.
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

/// Collect supported image files directly under `directory` (non-recursive).
fn collect_image_paths_direct(directory: &Path, collector: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if is_supported_image_path(&path) {
            collector.push(path);
        }
    }
}

/// Return true as soon as any supported image file is found under `directory`
/// (including all descendants).
fn contains_supported_image_recursive(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return false;
    };

    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };
        let path = entry.path();
        if path.is_file() {
            if is_supported_image_path(&path) {
                return true;
            }
            continue;
        }
        if path.is_dir() && contains_supported_image_recursive(&path) {
            return true;
        }
    }

    false
}

fn to_unix_timestamp_seconds(value: Result<std::time::SystemTime, std::io::Error>) -> u64 {
    value
        .ok()
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Read file metadata needed by the UI scanner.
/// Returns `None` for unreadable, empty, or invalid image files.
fn read_image_metadata(file_path: &Path) -> Option<(u64, u64, u64, u64, u32, u32)> {
    let metadata = fs::metadata(file_path).ok()?;
    let size = metadata.len();
    if size == 0 {
        return None;
    }

    let accessed_at = to_unix_timestamp_seconds(metadata.accessed());
    let created_at = to_unix_timestamp_seconds(metadata.created());
    let last_modified = to_unix_timestamp_seconds(metadata.modified());

    // Header-only parse for image dimensions; fails for corrupt/truncated files.
    let (width, height) = image_dimensions(file_path).ok()?;
    if width == 0 || height == 0 {
        return None;
    }

    Some((size, accessed_at, created_at, last_modified, width, height))
}

/// Scan a single root directory and return metadata for every image found.
///
/// This reads only lightweight metadata + image headers (for dimensions).
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
        let relative_path = normalize_path_for_ui(&Path::new(&directory_name).join(relative_tail));

        let absolute_path = normalize_path_for_ui(file_path);

        let Some((size, accessed_at, created_at, last_modified, width, height)) =
            read_image_metadata(file_path)
        else {
            continue;
        };

        images.push(NativeScannedImage {
            relative_path,
            file_name,
            absolute_path,
            size,
            accessed_at,
            created_at,
            last_modified,
            width,
            height,
        });
    }

    Ok(NativeRootScan {
        root_path: normalize_path_for_ui(&canonical_root),
        directory_name,
        images,
    })
}

/// Scan a single image file path and return it as a one-image root scan.
pub fn scan_single_image_path(
    image_path: &Path,
    directory_name_override: Option<&str>,
) -> Result<NativeRootScan, String> {
    if !image_path.exists() || !image_path.is_file() {
        return Err(format!(
            "Image path is not an accessible file: {}",
            normalize_path_for_ui(image_path)
        ));
    }
    if !is_supported_image_path(image_path) {
        return Err(format!(
            "Unsupported image file type: {}",
            normalize_path_for_ui(image_path)
        ));
    }

    let canonical_file = fs::canonicalize(image_path).unwrap_or_else(|_| image_path.to_path_buf());
    let parent_directory = canonical_file
        .parent()
        .ok_or_else(|| "Image file has no parent directory".to_string())?
        .to_path_buf();
    let canonical_parent =
        fs::canonicalize(&parent_directory).unwrap_or_else(|_| parent_directory.clone());

    let file_name = canonical_file
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| "image".to_string());

    let Some((size, accessed_at, created_at, last_modified, width, height)) =
        read_image_metadata(&canonical_file)
    else {
        return Err(format!(
            "Failed to read image metadata: {}",
            normalize_path_for_ui(&canonical_file)
        ));
    };

    let directory_name = directory_name_override
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .or_else(|| {
            canonical_parent
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.trim().is_empty())
                .map(|name| name.to_string())
        })
        .unwrap_or_else(|| "Quick Edit".to_string());

    Ok(NativeRootScan {
        root_path: normalize_path_for_ui(&canonical_parent),
        directory_name: directory_name.clone(),
        images: vec![NativeScannedImage {
            relative_path: normalize_path_for_ui(&Path::new(&directory_name).join(&file_name)),
            file_name,
            absolute_path: normalize_path_for_ui(&canonical_file),
            size,
            accessed_at,
            created_at,
            last_modified,
            width,
            height,
        }],
    })
}

fn sanitize_relative_tail(relative_tail: &str) -> Result<PathBuf, String> {
    let normalized = relative_tail.replace('\\', "/");
    let mut sanitized = PathBuf::new();

    for component in Path::new(&normalized).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => sanitized.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid relative path".to_string());
            }
        }
    }

    Ok(sanitized)
}

/// List immediate child directories for `root_path/relative_tail` where each
/// child is included only if it (or any descendant folder) contains at least
/// one supported image.
pub fn list_directory_children(
    root_path: &Path,
    root_name: &str,
    relative_tail: &str,
) -> Result<Vec<NativeDirectoryChild>, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!(
            "Root path is not an accessible directory: {}",
            normalize_path_for_ui(root_path)
        ));
    }

    let canonical_root = fs::canonicalize(root_path).unwrap_or_else(|_| root_path.to_path_buf());
    let safe_tail = sanitize_relative_tail(relative_tail)?;
    let target_directory = if safe_tail.as_os_str().is_empty() {
        canonical_root.clone()
    } else {
        canonical_root.join(&safe_tail)
    };

    if !target_directory.exists() || !target_directory.is_dir() {
        return Ok(Vec::new());
    }

    let ui_root_name = root_name.trim();
    let mut children = Vec::new();
    let read_dir = fs::read_dir(&target_directory)
        .map_err(|error| format!("Failed to read directory entries: {error}"))?;

    for entry_result in read_dir {
        let Ok(entry) = entry_result else {
            continue;
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !contains_supported_image_recursive(&path) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.trim().is_empty() {
            continue;
        }

        let child_tail = if safe_tail.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            safe_tail.join(&name)
        };

        let ui_path = if ui_root_name.is_empty() {
            normalize_path_for_ui(&child_tail)
        } else {
            normalize_path_for_ui(&Path::new(ui_root_name).join(&child_tail))
        };

        let depth = ui_path
            .split('/')
            .filter(|segment| !segment.trim().is_empty())
            .count()
            .saturating_sub(1);

        children.push(NativeDirectoryChild {
            path: ui_path,
            name,
            depth,
        });
    }

    children.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(children)
}

/// Scan images for a specific folder path under a linked root.
///
/// - `root_path`: absolute linked root path on disk.
/// - `root_name`: top-level UI path segment for this root.
/// - `relative_tail`: path under root (e.g. "sub/a"), or empty for root itself.
/// - `recursive`: when true, recurse into descendants; otherwise scan only direct files.
/// - `offset`: number of matched files to skip (for paging).
/// - `limit`: max images to return (`0` means no limit).
pub fn scan_folder_by_path(
    root_path: &Path,
    root_name: &str,
    relative_tail: &str,
    recursive: bool,
    offset: usize,
    limit: usize,
) -> Result<NativeRootScan, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Err(format!(
            "Root path is not an accessible directory: {}",
            normalize_path_for_ui(root_path)
        ));
    }

    let canonical_root = fs::canonicalize(root_path).unwrap_or_else(|_| root_path.to_path_buf());
    let safe_tail = sanitize_relative_tail(relative_tail)?;
    let target_directory = if safe_tail.as_os_str().is_empty() {
        canonical_root.clone()
    } else {
        canonical_root.join(&safe_tail)
    };

    let fallback_directory_name = canonical_root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(|name| name.to_string())
        .unwrap_or_else(|| normalize_path_for_ui(&canonical_root));
    let directory_name = if root_name.trim().is_empty() {
        fallback_directory_name
    } else {
        root_name.trim().to_string()
    };

    if !target_directory.exists() || !target_directory.is_dir() {
        return Ok(NativeRootScan {
            root_path: normalize_path_for_ui(&canonical_root),
            directory_name,
            images: Vec::new(),
        });
    }

    let mut file_paths = Vec::new();
    if recursive {
        collect_image_paths(&target_directory, &mut file_paths);
    } else {
        collect_image_paths_direct(&target_directory, &mut file_paths);
    }
    file_paths.sort();

    let start = offset.min(file_paths.len());
    let end = if limit == 0 {
        file_paths.len()
    } else {
        (start + limit).min(file_paths.len())
    };
    let selected_paths = &file_paths[start..end];

    let mut images = Vec::with_capacity(selected_paths.len());
    for file_path in selected_paths {
        let file_name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string();

        let relative_tail = file_path
            .strip_prefix(&canonical_root)
            .unwrap_or(file_path.as_path());
        let relative_path = normalize_path_for_ui(&Path::new(&directory_name).join(relative_tail));
        let absolute_path = normalize_path_for_ui(file_path);

        let Some((size, accessed_at, created_at, last_modified, width, height)) =
            read_image_metadata(file_path)
        else {
            continue;
        };

        images.push(NativeScannedImage {
            relative_path,
            file_name,
            absolute_path,
            size,
            accessed_at,
            created_at,
            last_modified,
            width,
            height,
        });
    }

    Ok(NativeRootScan {
        root_path: normalize_path_for_ui(&canonical_root),
        directory_name,
        images,
    })
}
