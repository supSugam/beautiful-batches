use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::helpers::{dedupe_preserve_order, normalize_saved_root_path};
use crate::models::LinkedRootsFile;

const LINKED_ROOTS_FILENAME: &str = "linked_roots.json";

/// Resolve the path to the linked-roots JSON file inside the app data dir.
fn linked_roots_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data dir: {error}"))?;
    Ok(app_data_dir.join(LINKED_ROOTS_FILENAME))
}

/// Load the list of saved root paths from disk.
pub fn load_saved_root_paths(app: &AppHandle) -> Result<Vec<String>, String> {
    let file_path = linked_roots_file_path(app)?;
    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("Failed to read linked roots file: {error}"))?;
    let parsed: LinkedRootsFile = serde_json::from_str(&raw).unwrap_or_default();
    Ok(dedupe_preserve_order(parsed.roots))
}

/// Persist the list of root paths to disk.
pub fn save_root_paths(app: &AppHandle, roots: &[String]) -> Result<(), String> {
    let file_path = linked_roots_file_path(app)?;
    let payload = LinkedRootsFile {
        roots: dedupe_preserve_order(roots.to_vec()),
    };
    let raw = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize linked roots: {error}"))?;
    fs::write(file_path, raw).map_err(|error| format!("Failed to save linked roots: {error}"))
}

/// Add a root path if not already present and persist.
pub fn add_root_path(app: &AppHandle, new_root: &str) -> Result<Vec<String>, String> {
    let mut saved = load_saved_root_paths(app)?;
    let normalized = normalize_saved_root_path(new_root);
    if !saved.iter().any(|item| item == &normalized) {
        saved.push(normalized);
    }
    save_root_paths(app, &saved)?;
    Ok(saved)
}

/// Remove a root path and persist. Returns `true` if the path was found.
pub fn remove_root_path(app: &AppHandle, root_path: &str) -> Result<bool, String> {
    let normalized_target = normalize_saved_root_path(root_path);
    if normalized_target.is_empty() {
        return Ok(false);
    }

    let mut saved = load_saved_root_paths(app)?;
    let before = saved.len();
    saved.retain(|candidate| candidate != &normalized_target);
    if saved.len() == before {
        return Ok(false);
    }

    save_root_paths(app, &saved)?;
    Ok(true)
}
