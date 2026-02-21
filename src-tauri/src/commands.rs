use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use rfd::FileDialog;
use tauri::AppHandle;

use crate::models::{
    ExportConfig, ExportInputFile, LoadSavedRootsResult, NativeRootScan,
    PickAndScanRootResult, ProcessBulkExportResult,
    SidecarCaptionResult,
};
use crate::scanner::{list_directory_children, scan_folder_by_path, scan_single_root};
use crate::storage;

const PICK_SCAN_PREVIEW_LIMIT: usize = 240;

fn spawn_detached(command: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn()
        .map(|_| ())
        .map_err(|error| format!("{command}: {error}"))
}

/// Load linked/saved root paths without scanning their contents.
#[tauri::command]
pub async fn load_saved_roots_metadata(app: AppHandle) -> Result<Vec<String>, String> {
    storage::load_saved_root_paths(&app)
}

#[tauri::command]
pub async fn open_folder_in_file_explorer(folder_path: String) -> Result<(), String> {
    let normalized = folder_path.trim().to_string();
    if normalized.is_empty() {
        return Err("Folder path is empty".to_string());
    }

    let input_path = PathBuf::from(&normalized);
    let target_path = std::fs::canonicalize(&input_path).unwrap_or(input_path);
    if !target_path.exists() || !target_path.is_dir() {
        return Err(format!("Folder path is not accessible: {}", target_path.display()));
    }

    let target = target_path.to_string_lossy().to_string();
    let target_ref = target.as_str();

    #[cfg(target_os = "windows")]
    {
        // Prefer the canonical executable name on Windows.
        return spawn_detached("explorer.exe", &[target_ref])
            .or_else(|_| spawn_detached("explorer", &[target_ref]))
            .map_err(|error| format!("Failed to open folder in file explorer: {error}"));
    }

    #[cfg(target_os = "macos")]
    {
        // Use absolute path first to avoid PATH collisions (e.g. adb/open shims).
        return spawn_detached("/usr/bin/open", &[target_ref])
            .or_else(|_| spawn_detached("open", &[target_ref]))
            .map_err(|error| format!("Failed to open folder in file explorer: {error}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Prefer explicit file managers to avoid bad/default MIME handlers.
        let direct_candidates: &[(&str, &[&str])] = &[
            ("/usr/bin/nautilus", &[target_ref]),
            ("nautilus", &[target_ref]),
            ("/usr/bin/dolphin", &[target_ref]),
            ("dolphin", &[target_ref]),
            ("/usr/bin/thunar", &[target_ref]),
            ("thunar", &[target_ref]),
            ("/usr/bin/nemo", &[target_ref]),
            ("nemo", &[target_ref]),
            ("/usr/bin/pcmanfm", &[target_ref]),
            ("pcmanfm", &[target_ref]),
            ("/usr/bin/xdg-open", &[target_ref]),
            ("/bin/xdg-open", &[target_ref]),
            ("xdg-open", &[target_ref]),
            ("/usr/bin/gio", &["open", target_ref]),
            ("gio", &["open", target_ref]),
        ];

        let mut last_error = String::new();
        for (command, args) in direct_candidates {
            match spawn_detached(command, args) {
                Ok(()) => return Ok(()),
                Err(error) => last_error = error,
            }
        }

        return Err(format!(
            "Failed to open folder in file explorer: {last_error}"
        ));
    }
}

#[tauri::command]
pub async fn reveal_file_in_file_explorer(file_path: String) -> Result<(), String> {
    let normalized = file_path.trim().to_string();
    if normalized.is_empty() {
        return Err("File path is empty".to_string());
    }

    let input_path = PathBuf::from(&normalized);
    let target_path = std::fs::canonicalize(&input_path).unwrap_or(input_path);
    if !target_path.exists() || !target_path.is_file() {
        return Err(format!("File path is not accessible: {}", target_path.display()));
    }

    let target = target_path.to_string_lossy().to_string();
    let target_ref = target.as_str();

    #[cfg(target_os = "windows")]
    {
        let select_arg = format!("/select,{target_ref}");
        return spawn_detached("explorer.exe", &[select_arg.as_str()])
            .or_else(|_| spawn_detached("explorer", &[select_arg.as_str()]))
            .map_err(|error| format!("Failed to reveal file in file explorer: {error}"));
    }

    #[cfg(target_os = "macos")]
    {
        return spawn_detached("/usr/bin/open", &["-R", target_ref])
            .or_else(|_| spawn_detached("open", &["-R", target_ref]))
            .map_err(|error| format!("Failed to reveal file in file explorer: {error}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut last_error = String::new();

        let select_candidates: Vec<(&str, Vec<&str>)> = vec![
            ("/usr/bin/nautilus", vec!["--select", target_ref]),
            ("nautilus", vec!["--select", target_ref]),
            ("/usr/bin/dolphin", vec!["--select", target_ref]),
            ("dolphin", vec!["--select", target_ref]),
            ("/usr/bin/thunar", vec!["--select", target_ref]),
            ("thunar", vec!["--select", target_ref]),
            ("/usr/bin/nemo", vec!["--browser", target_ref]),
            ("nemo", vec!["--browser", target_ref]),
        ];

        for (command, args) in select_candidates {
            match spawn_detached(command, &args) {
                Ok(()) => return Ok(()),
                Err(error) => last_error = error,
            }
        }

        let parent = target_path
            .parent()
            .map(|path| path.to_string_lossy().to_string())
            .filter(|path| !path.trim().is_empty())
            .unwrap_or_else(|| target.clone());
        let parent_ref = parent.as_str();

        let fallback_candidates: Vec<(&str, Vec<&str>)> = vec![
            ("/usr/bin/xdg-open", vec![parent_ref]),
            ("/bin/xdg-open", vec![parent_ref]),
            ("xdg-open", vec![parent_ref]),
            ("/usr/bin/gio", vec!["open", parent_ref]),
            ("gio", vec!["open", parent_ref]),
        ];

        for (command, args) in fallback_candidates {
            match spawn_detached(command, &args) {
                Ok(()) => return Ok(()),
                Err(error) => last_error = error,
            }
        }

        return Err(format!(
            "Failed to reveal file in file explorer: {last_error}"
        ));
    }
}

#[tauri::command]
pub async fn read_sidecar_caption_for_image(
    image_path: String,
) -> Result<SidecarCaptionResult, String> {
    let normalized = image_path.trim().to_string();
    if normalized.is_empty() {
        return Ok(SidecarCaptionResult {
            exists: false,
            content: String::new(),
        });
    }

    tokio::task::spawn_blocking(move || {
        let image_path = Path::new(&normalized);
        let mut sidecar_path = image_path.to_path_buf();
        sidecar_path.set_extension("txt");

        if !sidecar_path.exists() || !sidecar_path.is_file() {
            return Ok(SidecarCaptionResult {
                exists: false,
                content: String::new(),
            });
        }

        let bytes = std::fs::read(&sidecar_path)
            .map_err(|error| format!("Failed to read caption sidecar file: {error}"))?;
        let mut content = String::from_utf8_lossy(&bytes).to_string();
        if content.starts_with('\u{feff}') {
            content = content.trim_start_matches('\u{feff}').to_string();
        }
        content = content.replace("\r\n", "\n").replace('\r', "\n");

        Ok(SidecarCaptionResult {
            exists: true,
            content,
        })
    })
    .await
    .map_err(|error| format!("Caption sidecar task failed: {error}"))?
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
            false,
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
            false,
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
