#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod helpers;
mod image_processing;
mod models;
mod scanner;
mod storage;
mod thumbnails;

use std::path::PathBuf;
use tauri::http::Response;
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

fn load_app_icon() -> Option<tauri::image::Image<'static>> {
    let decoded = image::load_from_memory(include_bytes!("../icons/icon.png")).ok()?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    Some(tauri::image::Image::new_owned(
        rgba.into_raw(),
        width,
        height,
    ))
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Ensure we have a cache dir ready
            let _ = app.path().app_cache_dir();

            if let Some(app_icon) = load_app_icon() {
                for window in app.webview_windows().values() {
                    if let Err(err) = window.set_icon(app_icon.clone()) {
                        eprintln!("Failed to set window icon: {err}");
                    }
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
            commands::pick_and_scan_root,
            commands::load_saved_roots_and_scan,
            commands::load_saved_roots_metadata,
            commands::load_quick_edit_launch_image,
            commands::open_folder_in_file_explorer,
            commands::reveal_file_in_file_explorer,
            commands::read_sidecar_caption_for_image,
            commands::scan_root_by_path,
            commands::scan_folder_by_path_command,
            commands::list_directory_children_by_path,
            commands::remove_saved_root,
            commands::clear_saved_roots,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
