use std::path::Path;

use rfd::FileDialog;
use tauri::AppHandle;

use crate::models::{
    ExportConfig, ExportInputFile, LoadSavedRootsResult, PickAndScanRootResult,
    ProcessBulkExportResult,
};
use crate::scanner::scan_single_root;
use crate::storage;

/// Open the native folder picker and scan the selected directory.
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

    // Run the potentially slow directory scan off the main thread.
    let scan = tokio::task::spawn_blocking(move || scan_single_root(&selected_root))
        .await
        .map_err(|error| format!("Scan task failed: {error}"))??;

    let saved_root_paths = storage::add_root_path(&app, &scan.root_path)?;

    Ok(PickAndScanRootResult {
        cancelled: false,
        root: Some(scan),
        saved_root_paths,
    })
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
