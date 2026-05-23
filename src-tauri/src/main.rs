#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod commands;
mod helpers;
mod image_processing;
mod models;
mod scanner;
mod storage;
mod thumbnails;
mod watermark_sidecar;
mod ai_captioning;

#[cfg(target_os = "macos")]
use crate::helpers::is_supported_image_path;
use std::path::PathBuf;
use tauri::http::Response;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

fn query_value<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    for part in query.split('&') {
        let mut split = part.splitn(2, '=');
        let candidate_key = split.next().unwrap_or("");
        if candidate_key != key {
            continue;
        }
        return Some(split.next().unwrap_or(""));
    }
    None
}

use std::sync::OnceLock;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

static APP_ICON: OnceLock<Option<tauri::image::Image<'static>>> = OnceLock::new();

fn get_app_icon() -> Option<tauri::image::Image<'static>> {
    APP_ICON.get_or_init(|| {
        let decoded = image::load_from_memory(include_bytes!("../icons/icon.png")).ok()?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        Some(tauri::image::Image::new_owned(
            rgba.into_raw(),
            width,
            height,
        ))
    }).clone()
}

fn create_app_window(app: &tauri::AppHandle, label: &str) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Beautiful Batches")
        .inner_size(1440.0, 920.0)
        .resizable(true)
        .decorations(false); // Custom titlebar logic

    // On Linux, the WM_CLASS / app_id is vital for grouping and icons.
    // We set it explicitly to the identifier from tauri.conf.json.
    #[cfg(target_os = "linux")]
    {
        // This is a common trick to ensure GNOME/Wayland links the window to the correct icon/app
        builder = builder.window_classname("com.supSugam.beautifulbatches");
    }

    let window = builder.build()?;

    if let Some(icon) = get_app_icon() {
        let _ = window.set_icon(icon);
    }

    Ok(window)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Chrome-like behavior: Each launch opens a new window in the SAME process
            // This ensures they are grouped under one taskbar icon
            let label = format!("main-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
            let _ = create_app_window(app, &label);
        }))
        .setup(|app| {
            // Ensure we have a cache dir ready
            let _ = app.path().app_cache_dir();

            // Apply icon to the initial window created by tauri.conf.json
            if let Some(icon) = get_app_icon() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("localfile", move |ctx, request, responder| {
            // In Tauri v2, ctx is &UriSchemeContext. Get AppHandle from it.
            let app_handle = ctx.app_handle().clone();

            // The URL looks like: localfile://localhost/<encoded-path>?thumbnail=true
            let url_string = request.uri().to_string();

            // 1. Strip the protocol and host
            let rest = url_string
                .strip_prefix("localfile://localhost/")
                .or_else(|| url_string.strip_prefix("localfile://localhost"))
                .unwrap_or("")
                .to_string();

            // 2. Separate path and query
            let (path_part, query_part) = match rest.split_once('?') {
                Some((p, q)) => (p, Some(q)),
                Option::None => (rest.as_str(), Option::None),
            };

            // 3. URL-decode the path part
            let decoded_path = urlencoding::decode(path_part)
                .unwrap_or_else(|_| path_part.to_string().into())
                .into_owned();

            let is_thumbnail = query_part
                .and_then(|q| query_value(q, "thumbnail"))
                .is_some_and(|value| value == "true" || value == "1");
            let thumb_size = query_part
                .and_then(|q| query_value(q, "thumbSize").or_else(|| query_value(q, "size")))
                .and_then(|value| value.parse::<u32>().ok());

            std::thread::spawn(move || {
                let file_path = PathBuf::from(if decoded_path.starts_with('/') {
                    decoded_path.clone()
                } else {
                    format!("/{decoded_path}")
                });

                let result = if is_thumbnail {
                    thumbnails::get_or_create_thumbnail(&app_handle, &file_path, thumb_size)
                } else {
                    std::fs::read(&file_path).map_err(|e| e.to_string())
                };

                match result {
                    Ok(bytes) => {
                        let mime = if is_thumbnail {
                            "image/webp"
                        } else {
                            mime_from_extension(&file_path)
                        };
                        let response = Response::builder()
                            .status(200)
                            .header("Content-Type", mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Cache-Control", "max-age=3600")
                            .body(bytes)
                            .unwrap();
                        responder.respond(response);
                    }
                    Err(e) => {
                        eprintln!("Error serving file {}: {}", decoded_path, e);
                        let response = Response::builder()
                            .status(404)
                            .body(b"File not found".to_vec())
                            .unwrap();
                        responder.respond(response);
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::process_bulk_export,
            commands::execute_export_plan,
            commands::pick_folder,
            commands::pick_and_scan_root,
            commands::load_saved_roots_and_scan,
            commands::load_saved_roots_metadata,
            commands::load_quick_edit_launch_image,
            commands::open_folder_in_file_explorer,
            commands::reveal_file_in_file_explorer,
            commands::read_image_embedded_metadata,
            commands::scan_root_by_path,
            commands::scan_paths,
            commands::is_directory,
            commands::scan_folder_by_path_command,
            commands::list_directory_children_by_path,
            commands::add_root_path,
            commands::remove_saved_root,
            commands::clear_saved_roots,
            commands::get_watermark_sidecar_status,
            commands::run_watermark_setup,
            commands::reset_watermark_setup,
            commands::download_watermark_model,
            commands::delete_watermark_model,
            commands::load_watermark_models,
            commands::stop_watermark_models,
            commands::restart_watermark_bridge,
            commands::remove_watermark_single,
            commands::remove_background_single,
            commands::open_external_url,
            commands::get_detailed_system_info,
            commands::get_folder_last_modified,
            commands::generate_ai_caption,
            commands::save_secure_api_key,
            commands::get_secure_api_key,
            commands::copy_files_to_directory,

            clipboard::read_clipboard_image,
            clipboard::has_clipboard_image,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let launch_paths: Vec<PathBuf> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| path.is_file() && is_supported_image_path(path))
                .collect();
            if launch_paths.is_empty() {
                return;
            }
            commands::enqueue_quick_edit_launch_paths(launch_paths);
            let _ = _app_handle.emit("quick-edit-open-requested", true);
        }
    });
}

fn mime_from_extension(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}
