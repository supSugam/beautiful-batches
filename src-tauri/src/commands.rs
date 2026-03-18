use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use flate2::read::ZlibDecoder;
use rfd::FileDialog;
use tauri::AppHandle;
use serde_json::json;

use crate::helpers::is_supported_image_path;
use crate::models::{
    EmbeddedMetadataEntry, EmbeddedMetadataResult, ExecuteExportPlanRequest,
    ExecuteExportPlanResult, ExportConfig, ExportInputFile, LoadSavedRootsResult, NativeRootScan,
    PickAndScanRootResult, ProcessBulkExportResult,
};
use crate::scanner::{
    list_directory_children, scan_folder_by_path, scan_single_image_path, scan_single_root,
};
use crate::storage;
use crate::watermark_sidecar;

const PICK_SCAN_PREVIEW_LIMIT: usize = 240;
static PENDING_QUICK_EDIT_PATHS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

fn pending_quick_edit_paths() -> &'static Mutex<Vec<PathBuf>> {
    PENDING_QUICK_EDIT_PATHS.get_or_init(|| Mutex::new(Vec::new()))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn enqueue_quick_edit_launch_paths(paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = pending_quick_edit_paths().lock() {
        pending.extend(paths);
    }
}

fn take_next_quick_edit_launch_path() -> Option<PathBuf> {
    pending_quick_edit_paths()
        .lock()
        .ok()
        .and_then(|mut pending| pending.pop())
}

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

fn inflate_zlib_bytes(data: &[u8]) -> Option<Vec<u8>> {
    let mut decoder = ZlibDecoder::new(data);
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).ok()?;
    Some(output)
}

fn parse_png_text_entries(bytes: &[u8]) -> Vec<EmbeddedMetadataEntry> {
    const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if bytes.len() < PNG_SIGNATURE.len() || bytes[..8] != PNG_SIGNATURE {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let mut cursor: usize = 8;

    while cursor + 12 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[cursor],
            bytes[cursor + 1],
            bytes[cursor + 2],
            bytes[cursor + 3],
        ]) as usize;
        let chunk_type = &bytes[cursor + 4..cursor + 8];
        let data_start = cursor + 8;
        let data_end = data_start + length;
        let crc_end = data_end + 4;
        if crc_end > bytes.len() {
            break;
        }

        let data = &bytes[data_start..data_end];
        match chunk_type {
            b"tEXt" => {
                if let Some(separator_index) = data.iter().position(|value| *value == 0) {
                    let key = String::from_utf8_lossy(&data[..separator_index]).to_string();
                    let value = String::from_utf8_lossy(&data[separator_index + 1..]).to_string();
                    if !key.trim().is_empty() {
                        entries.push(EmbeddedMetadataEntry {
                            key,
                            value,
                            source: "png:tEXt".to_string(),
                        });
                    }
                }
            }
            b"iTXt" => {
                if let Some(key_end) = data.iter().position(|value| *value == 0) {
                    let key = String::from_utf8_lossy(&data[..key_end]).to_string();
                    if !key.trim().is_empty() && data.len() > key_end + 3 {
                        let compression_flag = data[key_end + 1];
                        let _compression_method = data[key_end + 2];
                        let mut cursor_itxt = key_end + 3;

                        // language tag
                        if let Some(language_end) =
                            data[cursor_itxt..].iter().position(|value| *value == 0)
                        {
                            cursor_itxt += language_end + 1;
                        } else {
                            cursor_itxt = data.len();
                        }

                        // translated keyword
                        if cursor_itxt < data.len() {
                            if let Some(translated_end) =
                                data[cursor_itxt..].iter().position(|value| *value == 0)
                            {
                                cursor_itxt += translated_end + 1;
                            } else {
                                cursor_itxt = data.len();
                            }
                        }

                        if cursor_itxt <= data.len() {
                            let text_payload = &data[cursor_itxt..];
                            let value_bytes = if compression_flag == 1 {
                                inflate_zlib_bytes(text_payload)
                                    .unwrap_or_else(|| text_payload.to_vec())
                            } else {
                                text_payload.to_vec()
                            };
                            let value = String::from_utf8_lossy(&value_bytes).to_string();
                            entries.push(EmbeddedMetadataEntry {
                                key,
                                value,
                                source: "png:iTXt".to_string(),
                            });
                        }
                    }
                }
            }
            b"zTXt" => {
                if let Some(key_end) = data.iter().position(|value| *value == 0) {
                    let key = String::from_utf8_lossy(&data[..key_end]).to_string();
                    if !key.trim().is_empty() && data.len() > key_end + 2 {
                        let compressed_payload = &data[key_end + 2..];
                        let value_bytes = inflate_zlib_bytes(compressed_payload)
                            .unwrap_or_else(|| compressed_payload.to_vec());
                        let value = String::from_utf8_lossy(&value_bytes).to_string();
                        entries.push(EmbeddedMetadataEntry {
                            key,
                            value,
                            source: "png:zTXt".to_string(),
                        });
                    }
                }
            }
            _ => {}
        }

        if chunk_type == b"IEND" {
            break;
        }
        cursor = crc_end;
    }

    entries
}

/// Load linked/saved root paths without scanning their contents.
#[tauri::command]
pub async fn load_saved_roots_metadata(app: AppHandle) -> Result<Vec<String>, String> {
    storage::load_saved_root_paths(&app)
}

#[tauri::command]
pub async fn load_quick_edit_launch_image() -> Result<Option<NativeRootScan>, String> {
    tokio::task::spawn_blocking(|| {
        let args = std::env::args_os().skip(1);
        for arg in args {
            let candidate_path = PathBuf::from(arg);
            if !candidate_path.exists() || !candidate_path.is_file() {
                continue;
            }
            if !is_supported_image_path(&candidate_path) {
                continue;
            }
            if let Ok(scan) = scan_single_image_path(&candidate_path, Some("Quick Edit")) {
                return Ok(Some(scan));
            }
        }
        while let Some(pending_path) = take_next_quick_edit_launch_path() {
            if !pending_path.exists() || !pending_path.is_file() {
                continue;
            }
            if !is_supported_image_path(&pending_path) {
                continue;
            }
            if let Ok(scan) = scan_single_image_path(&pending_path, Some("Quick Edit")) {
                return Ok(Some(scan));
            }
        }
        Ok(None)
    })
    .await
    .map_err(|error| format!("Launch image resolution task failed: {error}"))?
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
        return Err(format!(
            "Folder path is not accessible: {}",
            target_path.display()
        ));
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
        let direct_candidates: Vec<(&str, Vec<String>)> = vec![
            ("/usr/bin/nautilus", vec![target_ref.to_string()]),
            ("nautilus", vec![target_ref.to_string()]),
            ("/usr/bin/dolphin", vec![target_ref.to_string()]),
            ("dolphin", vec![target_ref.to_string()]),
            ("/usr/bin/thunar", vec![target_ref.to_string()]),
            ("thunar", vec![target_ref.to_string()]),
            ("/usr/bin/nemo", vec![target_ref.to_string()]),
            ("nemo", vec![target_ref.to_string()]),
            ("/usr/bin/pcmanfm", vec![target_ref.to_string()]),
            ("pcmanfm", vec![target_ref.to_string()]),
            ("/usr/bin/xdg-open", vec![target_ref.to_string()]),
            ("/bin/xdg-open", vec![target_ref.to_string()]),
            ("xdg-open", vec![target_ref.to_string()]),
            (
                "/usr/bin/gio",
                vec!["open".to_string(), target_ref.to_string()],
            ),
            ("gio", vec!["open".to_string(), target_ref.to_string()]),
        ];

        let mut last_error = String::new();
        for (command, args) in &direct_candidates {
            let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            match spawn_detached(*command, &args_refs) {
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
        return Err(format!(
            "File path is not accessible: {}",
            target_path.display()
        ));
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
pub async fn read_image_embedded_metadata(
    image_path: String,
) -> Result<EmbeddedMetadataResult, String> {
    let normalized = image_path.trim().to_string();
    if normalized.is_empty() {
        return Ok(EmbeddedMetadataResult {
            entries: Vec::new(),
        });
    }

    tokio::task::spawn_blocking(move || {
        let image_path = Path::new(&normalized);
        if !image_path.exists() || !image_path.is_file() {
            return Ok(EmbeddedMetadataResult {
                entries: Vec::new(),
            });
        }

        let extension = image_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let bytes = std::fs::read(image_path)
            .map_err(|error| format!("Failed to read image for metadata: {error}"))?;

        let entries = if extension == "png" {
            parse_png_text_entries(&bytes)
        } else {
            Vec::new()
        };

        Ok(EmbeddedMetadataResult { entries })
    })
    .await
    .map_err(|error| format!("Embedded metadata task failed: {error}"))?
}

/// Open the native folder picker and return a small initial preview scan.
///
/// Runs the blocking `rfd::FileDialog` off the main thread via async + spawn_blocking
/// to prevent the app from freezing.
#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    let selected = tokio::task::spawn_blocking(|| FileDialog::new().pick_folder())
        .await
        .map_err(|error| format!("Folder picker task failed: {error}"))?;

    Ok(selected.map(|p| p.to_string_lossy().to_string()))
}

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
    recursive: Option<bool>,
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
            recursive.unwrap_or(false),
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
pub async fn load_saved_roots_and_scan(app: AppHandle) -> Result<LoadSavedRootsResult, String> {
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
pub async fn remove_saved_root(app: AppHandle, root_path: String) -> Result<bool, String> {
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
    _app: AppHandle,
    files: Vec<ExportInputFile>,
    config: ExportConfig,
) -> Result<ProcessBulkExportResult, String> {
    tokio::task::spawn_blocking(move || {
        crate::image_processing::process_bulk_export(files, config, None)
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?
}

#[tauri::command]
pub async fn execute_export_plan(
    _app: AppHandle,
    request: ExecuteExportPlanRequest,
) -> Result<ExecuteExportPlanResult, String> {
    tokio::task::spawn_blocking(move || {
        crate::image_processing::execute_export_plan(request, None)
    })
    .await
    .map_err(|error| format!("Export plan task failed: {error}"))?
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url_ref = url.as_str();
    
    #[cfg(target_os = "windows")]
    {
        return spawn_detached("cmd", &["/c", "start", "", url_ref])
            .map_err(|error| format!("Failed to open URL: {error}"));
    }

    #[cfg(target_os = "macos")]
    {
        return spawn_detached("open", &[url_ref])
            .map_err(|error| format!("Failed to open URL: {error}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return spawn_detached("xdg-open", &[url_ref])
            .map_err(|error| format!("Failed to open URL: {error}"));
    }
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetailedSystemInfo {
    pub distro: Option<String>,
    pub distro_version: Option<String>,
    pub desktop_environment: Option<String>,
}

#[tauri::command]
pub async fn get_detailed_system_info() -> Result<DetailedSystemInfo, String> {
    let mut info = DetailedSystemInfo {
        distro: None,
        distro_version: None,
        desktop_environment: None,
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Read /etc/os-release for distro info
        if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
            for line in content.lines() {
                if line.starts_with("PRETTY_NAME=") {
                    info.distro = Some(line.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string());
                } else if line.starts_with("VERSION_ID=") {
                    info.distro_version = Some(line.trim_start_matches("VERSION_ID=").trim_matches('"').to_string());
                } else if line.starts_with("NAME=") && info.distro.is_none() {
                    info.distro = Some(line.trim_start_matches("NAME=").trim_matches('"').to_string());
                }
            }
        }

        // Detect Desktop Environment
        if let Ok(de) = std::env::var("XDG_CURRENT_DESKTOP") {
            info.desktop_environment = Some(de);
        } else if let Ok(de) = std::env::var("DESKTOP_SESSION") {
            info.desktop_environment = Some(de);
        }
    }

    Ok(info)
}

// ── Watermark Sidecar ────────────────────────────────────────────────

#[tauri::command]
pub async fn get_watermark_sidecar_status(
    app: AppHandle,
) -> Result<crate::models::WatermarkSidecarStatus, String> {
    watermark_sidecar::get_status(&app)
}

#[tauri::command]
pub async fn run_watermark_setup(
    app: AppHandle,
    force_reinstall: Option<bool>,
) -> Result<(), String> {
    watermark_sidecar::run_setup(app, force_reinstall.unwrap_or(false)).await
}

#[tauri::command]
pub async fn reset_watermark_setup(app: AppHandle) -> Result<(), String> {
    watermark_sidecar::reset_setup(&app)
}

#[tauri::command]
pub async fn download_watermark_model(app: AppHandle, model_id: String) -> Result<(), String> {
    watermark_sidecar::download_model(app, model_id).await
}

#[tauri::command]
pub async fn delete_watermark_model(app: AppHandle, model_id: String) -> Result<(), String> {
    watermark_sidecar::delete_model(app, model_id).await
}

#[tauri::command]
pub async fn load_watermark_models(
    app: AppHandle,
    detection_model: String,
    inpainting_model: String,
) -> Result<(), String> {
    let bridge_arc = watermark_sidecar::get_or_create_bridge(&app)?;
    let mut bridge = bridge_arc.lock().map_err(|e| e.to_string())?;

    let response = bridge.send_command(json!({
        "command": "load",
        "detection_model": detection_model,
        "inpainting_model": inpainting_model
    }), Some(&app))?;

    if let Some(err) = response.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_watermark_models(app: AppHandle) -> Result<(), String> {
    watermark_sidecar::stop_bridge()
}

#[tauri::command]
pub async fn restart_watermark_bridge(app: AppHandle) -> Result<(), String> {
    let _ = watermark_sidecar::stop_bridge();
    // Bridge will be auto-recreated on next use or can be triggered via load_watermark_models
    Ok(())
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub image_base64: String,
    pub device_used: Option<String>,
    pub watermarks_found: Option<u32>,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn remove_watermark_single(
    app: AppHandle,
    image_path: String,
    prompt: Option<String>,
    max_bbox_percent: Option<f64>,
    auto_unload: Option<bool>,
) -> Result<RemoveResult, String> {
    let bridge_arc = watermark_sidecar::ensure_bridge_ready(&app)?;
    let mut bridge = bridge_arc.lock().map_err(|e| e.to_string())?;

    let response = bridge.send_command(json!({
        "command": "process",
        "path": image_path,
        "max_bbox_percent": max_bbox_percent.unwrap_or(10.0),
        "prompt": prompt.unwrap_or_else(|| "watermark".to_string())
    }), Some(&app))?;

    if let Some(err) = response.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    let result = if response.get("status").and_then(|s| s.as_str()) == Some("success") {
        let base64 = response.get("image_base64").and_then(|s| s.as_str()).ok_or("No image data returned")?;
        let device = response.get("device_used").and_then(|s| s.as_str()).map(|s| s.to_string());
        let watermarks_found = response.get("num_watermarks").and_then(|v| v.as_u64()).map(|v| v as u32);
        
        let description = match watermarks_found {
            Some(0) => Some("No watermarks detected".to_string()),
            Some(1) => Some("Removed 1 watermark".to_string()),
            Some(n) => Some(format!("Removed {n} watermarks")),
            None => None,
        };

        Ok(RemoveResult {
            image_base64: format!("data:image/png;base64,{base64}"),
            device_used: device,
            watermarks_found,
            description,
        })
    } else {
        Err(response.get("message").and_then(|s| s.as_str()).unwrap_or("Skipped").to_string())
    };

    if auto_unload.unwrap_or(false) {
        drop(bridge);
        let _ = watermark_sidecar::stop_bridge();
    }

    result
}

#[tauri::command]
pub async fn remove_background_single(
    app: AppHandle,
    image_path: String,
    auto_unload: Option<bool>,
) -> Result<RemoveResult, String> {
    let bridge_arc = watermark_sidecar::get_or_create_bridge(&app)?;
    let mut bridge = bridge_arc.lock().map_err(|e| e.to_string())?;

    let response = bridge.send_command(json!({
        "command": "remove_bg",
        "path": image_path
    }), Some(&app))?;

    if let Some(err) = response.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    let result = if response.get("status").and_then(|s| s.as_str()) == Some("success") {
        let base64 = response.get("image_base64").and_then(|s| s.as_str()).ok_or("No image data returned")?;
        let provider = response.get("provider_used").and_then(|s| s.as_str()).map(|s| s.to_string());
        Ok(RemoveResult {
            image_base64: format!("data:image/png;base64,{base64}"),
            device_used: provider,
            watermarks_found: None,
            description: Some("Background removed".to_string()),
        })
    } else {
        Err(response.get("message").and_then(|s| s.as_str()).unwrap_or("Background removal failed").to_string())
    };

    if auto_unload.unwrap_or(false) {
        drop(bridge);
        let _ = watermark_sidecar::stop_bridge();
    }

    result
}
