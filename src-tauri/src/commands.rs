use std::path::Path;

use rfd::FileDialog;
use tauri::AppHandle;

use crate::models::{
    ExportConfig, ExportInputFile, LoadSavedRootsResult, NativeRootScan,
    PickAndScanRootResult, ProcessBulkExportResult,
};
use crate::scanner::{list_directory_children, scan_folder_by_path, scan_single_root};
use crate::storage;

const PICK_SCAN_PREVIEW_LIMIT: usize = 240;

/// Load linked/saved root paths without scanning their contents.
#[tauri::command]
pub async fn load_saved_roots_metadata(app: AppHandle) -> Result<Vec<String>, String> {
    storage::load_saved_root_paths(&app)
}

/// Open the native folder picker and return a small initial preview scan.
///
/// Runs the blocking `rfd::FileDialog` off the main thread via async + spawn_blocking
/// to prevent the app from freezing.
#[tauri::command]
pub async fn pick_and_scan_root(app: AppHandle) -> Result<PickAndScanRootResult, String> {
    // Run the blocking folder picker on a background thread.
    let selected = tokio::task::spawn_blocking(|| FileDialog::new().pick_folder())
        .await
        .map_err(|error| format!("Folder picker task failed: {error}"))?;

    if selected.is_none() {
        let saved_root_paths = storage::load_saved_root_paths(&app).unwrap_or_default();
        return Ok(PickAndScanRootResult {
            cancelled: true,
            root: None,
            saved_root_paths,
        });
    }

    let selected_root = selected.expect("checked is_none above");

    let selected_path = selected_root.clone();
    let preview_scan = tokio::task::spawn_blocking(move || {
        let canonical_root =
            std::fs::canonicalize(&selected_path).unwrap_or_else(|_| selected_path.clone());
        let directory_name = canonical_root
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .map(|name| name.to_string())
            .unwrap_or_else(|| canonical_root.to_string_lossy().replace('\\', "/"));
        scan_folder_by_path(
            &canonical_root,
            &directory_name,
            "",
            true,
            0,
            PICK_SCAN_PREVIEW_LIMIT,
        )
    })
    .await
    .map_err(|error| format!("Preview scan task failed: {error}"))??;

    let storage_result = storage::add_root_path(&app, &preview_scan.root_path)?;

    Ok(PickAndScanRootResult {
        cancelled: false,
        root: Some(NativeRootScan {
            root_path: preview_scan.root_path,
            directory_name: preview_scan.directory_name,
            images: preview_scan.images,
        }),
        saved_root_paths: storage_result.saved_paths,
    })
}

/// Scan a single root path (without opening a picker).
#[tauri::command]
pub async fn scan_root_by_path(root_path: String) -> Result<crate::models::NativeRootScan, String> {
    let normalized = root_path.trim().to_string();
    if normalized.is_empty() {
        return Err("Root path is empty".to_string());
    }

    tokio::task::spawn_blocking(move || scan_single_root(Path::new(&normalized)))
        .await
        .map_err(|error| format!("Scan task failed: {error}"))?
}

/// Scan images for a specific folder under a linked root.
#[tauri::command]
pub async fn scan_folder_by_path_command(
    root_path: String,
    root_name: String,
    relative_path: String,
    recursive: bool,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<crate::models::NativeRootScan, String> {
    let normalized_root = root_path.trim().to_string();
    if normalized_root.is_empty() {
        return Err("Root path is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        scan_folder_by_path(
            Path::new(&normalized_root),
            root_name.trim(),
            relative_path.trim(),
            recursive,
            offset.unwrap_or(0),
            limit.unwrap_or(0),
        )
    })
    .await
    .map_err(|error| format!("Scan folder task failed: {error}"))?
}

/// List immediate child directories for a root/tail path (non-recursive).
#[tauri::command]
pub async fn list_directory_children_by_path(
    root_path: String,
    root_name: String,
    relative_path: String,
) -> Result<Vec<crate::models::NativeDirectoryChild>, String> {
    let normalized_root = root_path.trim().to_string();
    if normalized_root.is_empty() {
        return Err("Root path is empty".to_string());
    }

    tokio::task::spawn_blocking(move || {
        list_directory_children(
            Path::new(&normalized_root),
            root_name.trim(),
            relative_path.trim(),
        )
    })
    .await
    .map_err(|error| format!("Directory list task failed: {error}"))?
}

/// Load all previously saved roots from disk and scan each one.
#[tauri::command]
pub async fn load_saved_roots_and_scan(
    app: AppHandle,
) -> Result<LoadSavedRootsResult, String> {
    let saved_root_paths = storage::load_saved_root_paths(&app)?;
    if saved_root_paths.is_empty() {
        return Ok(LoadSavedRootsResult {
            roots: Vec::new(),
            saved_root_paths: Vec::new(),
        });
    }

    // Clone for the blocking closure.
    let paths_for_scan = saved_root_paths.clone();

    let (roots, remaining) = tokio::task::spawn_blocking(move || {
        let mut roots = Vec::new();
        let mut remaining_saved_paths = Vec::new();
        for root_path in &paths_for_scan {
            match scan_single_root(Path::new(root_path)) {
                Ok(scan) => {
                    remaining_saved_paths.push(root_path.clone());
                    roots.push(scan);
                }
                Err(_) => {
                    // Skip missing/inaccessible roots — they'll be pruned from the saved list.
                }
            }
        }
        roots.sort_by(|a, b| a.root_path.cmp(&b.root_path));
        (roots, remaining_saved_paths)
    })
    .await
    .map_err(|error| format!("Scan task failed: {error}"))?;

    if remaining.len() != saved_root_paths.len() {
        storage::save_root_paths(&app, &remaining)?;
    }

    Ok(LoadSavedRootsResult {
        roots,
        saved_root_paths: remaining,
    })
}

/// Remove a saved root path.
#[tauri::command]
pub async fn remove_saved_root(
    app: AppHandle,
    root_path: String,
) -> Result<bool, String> {
    storage::remove_root_path(&app, &root_path)
}

/// Clear all saved root paths.
#[tauri::command]
pub async fn clear_saved_roots(app: AppHandle) -> Result<bool, String> {
    storage::save_root_paths(&app, &[] as &[String])?;
    Ok(true)
}

/// Process a bulk image export: read images from disk, apply transforms, and
/// return a base64-encoded ZIP archive.
#[tauri::command]
pub async fn process_bulk_export(
    files: Vec<ExportInputFile>,
    config: ExportConfig,
) -> Result<ProcessBulkExportResult, String> {
    // Run the CPU-heavy image processing off the main thread.
    tokio::task::spawn_blocking(move || {
        crate::image_processing::process_bulk_export(files, config)
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?
}
