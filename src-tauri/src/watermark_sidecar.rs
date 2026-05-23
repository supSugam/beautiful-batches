use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Emitter};
use serde::Serialize;

use crate::models::{WatermarkSidecarStatus, WatermarkModelStatus};


const VENV_DIR_NAME: &str = "venv";

// Bridge python script is bundled as a resource in the "python" directory

// Model details with expected sizes for accurate detection
const DETECTION_MODEL_BASE: (&str, &str, &str, u64) = (
    "florence-2-base",
    "Florence-2 Base",
    "Fast and lightweight detection model (~460MB)",
    460_000_000,
);
const DETECTION_MODEL_LARGE: (&str, &str, &str, u64) = (
    "florence-2-large",
    "Florence-2 Large",
    "More accurate but slower detection model (~1.5GB)",
    1_500_000_000,
);
const INPAINTING_MODEL_LAMA: (&str, &str, &str, u64) = (
    "lama",
    "LaMa",
    "Standard high-quality inpainting model (~200MB)",
    200_000_000,
);
const BACKGROUND_REMOVAL_MODEL_REMBG: (&str, &str, &str, u64) = (
    "rembg",
    "RMBG-1.4 (isnet)",
    "Higher quality background removal model (~180MB)",
    180_000_000,
);

pub fn detect_hardware() -> String {
    #[cfg(target_os = "windows")]
    {
        // Simple check for NVIDIA on windows via nvidia-smi
        if Command::new("nvidia-smi").output().is_ok() {
            return "nvidia".to_string();
        }
        // DirectML is generally available on any modern Windows GPU (AMD/Intel/NVIDIA)
        // so we can often default to "windows_gpu" or detect specifically for AMD
        return "windows_gpu".to_string();
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Check NVIDIA on Linux
        if Command::new("nvidia-smi").output().is_ok() {
            return "nvidia".to_string();
        }
        
        // Check AMD/ROCm on Linux
        if Command::new("rocminfo").output().is_ok() || Path::new("/sys/module/amdgpu").exists() {
            return "amd".to_string();
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        "apple".to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "cpu".to_string()
    }
}

/// Centralized path management for the AI Engine.
/// Professionally organized under the standard OS application data directory.
pub struct EnginePaths {
    pub _root: PathBuf,  // The base data directory for the app
    pub engine: PathBuf, // Base directory for AI engine components (~/root/engine)
    pub venv: PathBuf,   // The python virtual environment (~/root/engine/venv)
    pub models: PathBuf, // The model weights cache (~/root/engine/models)
    pub scripts: PathBuf,// The bundled scripts (Resource path)
}

impl EnginePaths {
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let app_data = app.path().app_data_dir()
            .map_err(|e| format!("Professional FS Error: Failed to resolve system app data dir: {e}"))?;
        
        let engine = app_data.join("engine");
        
        // Resource resolution can be tricky in dev mode vs production.
        // We try the standard resource dir first, then fall back to local dev path.
        let scripts = match app.path().resource_dir() {
            Ok(dir) => {
                let p = dir.join("python");
                if p.exists() { p } else {
                    // Fallback for dev mode where resources might be in the source tree
                    PathBuf::from("python")
                }
            },
            Err(_) => PathBuf::from("python"),
        };

        // Final sanity check for scripts
        let scripts = if scripts.exists() {
            scripts
        } else {
            // Last resort: check if we are in the src-tauri folder during dev
            let dev_path = PathBuf::from("src-tauri/python");
            if dev_path.exists() { dev_path } else { scripts }
        };

        if !scripts.exists() {
            return Err(format!("AI Engine Error: Python scripts not found at {}. Please check your installation.", scripts.display()));
        }

        Ok(Self {
            _root: app_data,
            venv: engine.join(VENV_DIR_NAME),
            models: engine.join("models"),
            engine,
            scripts,
        })
    }

    pub fn ensure_dirs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.engine)
            .map_err(|e| format!("Failed to create engine directory: {e}"))?;
        fs::create_dir_all(&self.models)
            .map_err(|e| format!("Failed to create models directory: {e}"))?;
        Ok(())
    }
    
    pub fn python_executable(&self) -> PathBuf {
        #[cfg(target_os = "windows")]
        { self.venv.join("Scripts").join("python.exe") }
        #[cfg(not(target_os = "windows"))]
        { self.venv.join("bin").join("python") }
    }
}

fn check_command_exists(cmd: &str) -> bool {
    let output = if cfg!(target_os = "windows") {
        Command::new("where").arg(cmd).output()
    } else {
        Command::new("which").arg(cmd).output()
    };
    
    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Lightweight check if a library exists in venv site-packages
fn check_venv_lib_exists(paths: &EnginePaths, lib_name: &str) -> bool {
    // Walk site-packages to find folder starting with lib_name
    #[cfg(target_os = "windows")]
    let sp = paths.venv.join("Lib").join("site-packages");
    #[cfg(not(target_os = "windows"))]
    let sp = {
        // On linux/mac, it's lib/python3.x/site-packages
        let lib_dir = paths.venv.join("lib");
        if let Ok(entries) = fs::read_dir(lib_dir) {
            let mut found = None;
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("python") {
                    found = Some(entry.path().join("site-packages"));
                    break;
                }
            }
            found.unwrap_or(paths.venv.join("lib"))
        } else {
            paths.venv.join("lib")
        }
    };

    if !sp.exists() { return false; }
    
    if let Ok(entries) = fs::read_dir(sp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == lib_name.to_lowercase() || name.starts_with(&format!("{}-", lib_name.to_lowercase())) {
                return true;
            }
        }
    }
    false
}




fn check_model_files(models_dir: &Path, id: &str, name: &str, desc: &str, expected: u64, m_type: &str) -> WatermarkModelStatus {
    let p = if id.contains("florence") {
        models_dir.join("hub").join(format!("models--florence-community--{}", id.replace("florence-2-", "Florence-2-")))
    } else if id == "rembg" {
        models_dir.join("isnet-general-use.onnx")
    } else {
        models_dir.join("torch").join("hub").join("checkpoints").join("big-lama.pt")
    };
    
    let size = if p.is_file() {
        p.metadata().map(|m| m.len()).unwrap_or(0)
    } else if p.is_dir() {
        fn get_dir_size(path: &Path) -> u64 {
            let mut size = 0;
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        size += p.metadata().map(|m| m.len()).unwrap_or(0);
                    } else if p.is_dir() {
                        size += get_dir_size(&p);
                    }
                }
            }
            size
        }
        get_dir_size(&p)
    } else {
        0
    };

    let downloaded = size > 0 && (size as f64) > (expected as f64 * 0.85);

    WatermarkModelStatus {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
        downloaded,
        size_bytes: size,
        expected_size_bytes: expected,
        model_type: m_type.to_string(),
    }
}

pub fn get_status(app: &AppHandle) -> Result<WatermarkSidecarStatus, String> {
    let paths = EnginePaths::resolve(app)?;
    
    let python_installed = check_command_exists("python3") || check_command_exists("python");
    let uv_installed = check_command_exists("uv");
    
    let engine_assets_ready = paths.scripts.exists();
    let python_exe = paths.python_executable();
    let venv_exists = python_exe.exists();
    
    // Optimized dependency check: just check for a few key markers on disk
    let dependencies_installed = venv_exists && engine_assets_ready && 
        (check_venv_lib_exists(&paths, "iopaint") || check_venv_lib_exists(&paths, "IOPaint")) && 
        check_venv_lib_exists(&paths, "transformers") &&
        check_venv_lib_exists(&paths, "rembg");

    let mut is_bridge_active = false;
    let mut is_bridge_busy = false;
    let mut is_models_loaded = false;
    let mut is_bg_removal_loaded = false;
    let mut loaded_detection_model = None;
    let mut loaded_inpainting_model = None;
    let mut loaded_device = None;
    
    if let Ok(instance) = BRIDGE_INSTANCE.lock() {
        if let Some(bridge_arc) = instance.as_ref() {
            is_bridge_active = true;
            // Use try_lock to avoid blocking the status check if the bridge is currently processing an image
            if let Ok(bridge) = bridge_arc.try_lock() {
                is_models_loaded = bridge.is_ready;
                is_bg_removal_loaded = bridge.is_bg_removal_loaded;
                loaded_detection_model = bridge.loaded_detection_model.clone();
                loaded_inpainting_model = bridge.loaded_inpainting_model.clone();
                loaded_device = bridge.loaded_device.clone();
            } else {
                // If we can't lock it, it's busy processing
                is_bridge_busy = true;
                
                // Try to use last known status for specific details
                if let Ok(last) = LAST_STATUS.lock() {
                    if let Some(status) = last.as_ref() {
                        is_models_loaded = status.is_models_loaded;
                        is_bg_removal_loaded = status.is_bg_removal_loaded;
                        loaded_detection_model = status.loaded_detection_model.clone();
                        loaded_inpainting_model = status.loaded_inpainting_model.clone();
                        loaded_device = status.loaded_device.clone();
                    } else {
                        // Fallback if no last status
                        is_models_loaded = true; 
                    }
                } else {
                    is_models_loaded = true;
                }
            }
        }
    }

    let status = WatermarkSidecarStatus {
        python_installed,
        uv_installed,
        engine_assets_ready,
        venv_exists,
        dependencies_installed,
        is_bridge_active,
        is_bridge_busy,
        is_models_loaded,
        is_bg_removal_loaded,
        loaded_detection_model,
        loaded_inpainting_model,
        loaded_device,
        repo_path: paths.scripts.to_string_lossy().to_string(),
        python_path: paths.python_executable().to_string_lossy().to_string(),
        model_cache_path: paths.models.to_string_lossy().to_string(),
        hardware_type: detect_hardware(),
        ..Default::default()
    };

    // Cache the status for when bridge is busy
    if let Ok(mut last) = LAST_STATUS.lock() {
        *last = Some(status.clone());
    }

    let mut final_status = status;
    final_status.detection_models = vec![
        check_model_files(&paths.models, DETECTION_MODEL_BASE.0, DETECTION_MODEL_BASE.1, DETECTION_MODEL_BASE.2, DETECTION_MODEL_BASE.3, "detection"),
        check_model_files(&paths.models, DETECTION_MODEL_LARGE.0, DETECTION_MODEL_LARGE.1, DETECTION_MODEL_LARGE.2, DETECTION_MODEL_LARGE.3, "detection"),
    ];

    final_status.inpainting_models = vec![
        check_model_files(&paths.models, INPAINTING_MODEL_LAMA.0, INPAINTING_MODEL_LAMA.1, INPAINTING_MODEL_LAMA.2, INPAINTING_MODEL_LAMA.3, "inpainting"),
    ];

    final_status.background_removal_models = vec![
        check_model_files(&paths.models, BACKGROUND_REMOVAL_MODEL_REMBG.0, BACKGROUND_REMOVAL_MODEL_REMBG.1, BACKGROUND_REMOVAL_MODEL_REMBG.2, BACKGROUND_REMOVAL_MODEL_REMBG.3, "background_removal"),
    ];

    final_status.total_size_bytes = final_status.detection_models.iter().map(|m| m.size_bytes).sum::<u64>()
        + final_status.inpainting_models.iter().map(|m| m.size_bytes).sum::<u64>()
        + final_status.background_removal_models.iter().map(|m| m.size_bytes).sum::<u64>();

    Ok(final_status)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupLog {
    message: String,
    is_error: bool,
    timestamp: u64,
}

fn emit_log(app: &AppHandle, message: &str, is_error: bool) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let _ = app.emit("watermark-setup-log", SetupLog {
        message: message.to_string(),
        is_error,
        timestamp: now,
    });
}

pub struct WatermarkBridgeRuntime {
    pub _child: Child,
    stdin: ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
    pub is_ready: bool,
    pub is_bg_removal_loaded: bool,
    pub loaded_detection_model: Option<String>,
    pub loaded_inpainting_model: Option<String>,
    pub loaded_device: Option<String>,
}

impl Drop for WatermarkBridgeRuntime {
    fn drop(&mut self) {
        let _ = self._child.kill();
    }
}

pub static BRIDGE_INSTANCE: Mutex<Option<Arc<Mutex<WatermarkBridgeRuntime>>>> = Mutex::new(None);
pub static LAST_STATUS: Mutex<Option<WatermarkSidecarStatus>> = Mutex::new(None);

impl WatermarkBridgeRuntime {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let paths = EnginePaths::resolve(app)?;
        let python_exe = paths.python_executable();

        if !python_exe.exists() {
            return Err("Python environment not found. Please run setup first.".to_string());
        }

        // bridge.py lives in the bundled python resource directory
        let bridge_script = paths.scripts.join("bridge.py");

        if !bridge_script.exists() {
            return Err("bridge.py not found in bundled resources. Please check your installation.".to_string());
        }

        let mut cmd = Command::new(&python_exe);
        cmd.arg(&bridge_script)
            .env("HF_HOME", &paths.models)
            .env("XDG_CACHE_HOME", &paths.models)
            .env("TORCH_HOME", &paths.models)
            .env("U2NET_HOME", &paths.models)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&paths.scripts);

        emit_log(app, &format!("Launching AI Engine: {} {}", python_exe.display(), bridge_script.display()), false);

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn bridge: {e}"))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;
        
        // Start streaming stderr IMMEDIATELY to catch early crash logs
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let lower_line = line.to_lowercase();
                
                // Detect log level to avoid scaring the user with "ERROR" for everything
                let is_true_error = (lower_line.contains("error") || 
                                   lower_line.contains("exception") || 
                                   lower_line.contains("traceback") ||
                                   lower_line.contains("failed")) && 
                                   !lower_line.contains("futurewarning");
                
                let is_warning = lower_line.contains("warning") || 
                                lower_line.contains("deprecated") ||
                                lower_line.contains("unsupported");
                
                let is_status = lower_line.contains("downloading") || 
                               lower_line.contains("extracting") ||
                               lower_line.contains("installing");
                
                // Format the prefix based on content
                let prefix = if is_true_error { "[bridge-err]" } 
                            else if is_warning { "[bridge-warn]" }
                            else if is_status { "[bridge-status]" }
                            else { "[bridge-info]" };

                emit_log(&app_clone, &format!("{} {}", prefix, line), is_true_error);
            }
        });

        let mut reader = BufReader::new(stdout);

        // Read the startup message with a shorter timeout or better error reporting
        let mut startup_line = String::new();
        if let Err(e) = reader.read_line(&mut startup_line) {
             return Err(format!("Bridge failed to start: {e}. Check 'Engine Streams' for details."));
        }

        if startup_line.trim().is_empty() {
             return Err("Bridge closed immediately without output. This usually indicates a Segfault or missing library. Check logs.".to_string());
        }

        eprintln!("[watermark-bridge] startup: {}", startup_line.trim());

        Ok(Self { 
            _child: child, 
            stdin, 
            reader, 
            is_ready: false,
            is_bg_removal_loaded: false,
            loaded_detection_model: None,
            loaded_inpainting_model: None,
            loaded_device: None,
        })
    }

    pub fn is_alive(&mut self, app: &AppHandle) -> bool {
        match self._child.try_wait() {
            Ok(None) => true, // Still running
            Ok(Some(status)) => {
                let reason = if let Some(code) = status.code() {
                    format!("exited with code {code}")
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::ExitStatusExt;
                        if let Some(signal) = status.signal() {
                            format!("terminated by signal {signal} (potential segfault)")
                        } else {
                            "exited unknown".to_string()
                        }
                    }
                    #[cfg(not(unix))]
                    "exited unknown".to_string()
                };
                emit_log(app, &format!("Engine process died: {reason}"), true);
                eprintln!("[watermark-bridge] process died: {reason}");
                false
            }
            Err(e) => {
                emit_log(app, &format!("Error checking engine status: {e}"), true);
                false
            }
        }
    }

    pub fn send_command(&mut self, cmd: serde_json::Value, app: Option<&AppHandle>) -> Result<serde_json::Value, String> {
        if let Some(app) = app {
            if !self.is_alive(app) {
                return Err("Engine process is not running. It may have crashed (check logs).".to_string());
            }
        }

        let line = format!("{}\n", cmd.to_string());
        self.stdin.write_all(line.as_bytes()).map_err(|e: std::io::Error| {
            format!("Failed to write to engine: {} (Is the process still running?)", e)
        })?;
        self.stdin.flush().map_err(|e: std::io::Error| {
            format!("Failed to flush engine pipe: {} (Is the process still running?)", e)
        })?;

        loop {
            let mut response = String::new();
            self.reader.read_line(&mut response).map_err(|e: std::io::Error| e.to_string())?;
            if response.trim().is_empty() { continue; }
            
            let parsed: serde_json::Value = serde_json::from_str(&response).map_err(|e: serde_json::Error| e.to_string())?;
            
            // Check if this is an intermediate status update
            if let Some(status_type) = parsed.get("type").and_then(|v| v.as_str()) {
                if status_type == "status_update" {
                    if let (Some(app), Some(msg)) = (app, parsed.get("message").and_then(|v| v.as_str())) {
                        let _ = app.emit("watermark-engine-status", msg);
                    }
                    continue; // Wait for the next line (the actual result or another status)
                }
            }

            // It's a final result
            // Track readiness and loaded models
            if let Some(cmd_val) = cmd.get("command").and_then(|v| v.as_str()) {
                if cmd_val == "load" && parsed.get("status").and_then(|s| s.as_str()) == Some("ready") {
                    self.is_ready = true;
                    self.loaded_detection_model = cmd.get("detection_model").and_then(|v| v.as_str()).map(|s| s.to_string());
                    self.loaded_inpainting_model = cmd.get("inpainting_model").and_then(|v| v.as_str()).map(|s| s.to_string());
                }

                if cmd_val == "remove_bg" && parsed.get("status").and_then(|s| s.as_str()) == Some("success") {
                    self.is_bg_removal_loaded = true;
                }

                // Update device from any successful command that reports it
                if let Some(device) = parsed.get("device_used").and_then(|v| v.as_str()) {
                    self.loaded_device = Some(device.to_string());
                } else if let Some(provider) = parsed.get("provider_used").and_then(|v| v.as_str()) {
                    self.loaded_device = Some(provider.to_string());
                }
            }
            
            return Ok(parsed);
        }
    }
}

pub fn get_or_create_bridge(app: &AppHandle) -> Result<Arc<Mutex<WatermarkBridgeRuntime>>, String> {
    let mut instance = BRIDGE_INSTANCE.lock().unwrap();
    
    let should_create = match instance.as_ref() {
        None => true,
        Some(arc) => {
            let mut bridge = arc.lock().map_err(|e| e.to_string())?;
            !bridge.is_alive(app)
        }
    };

    if should_create {
        let bridge = WatermarkBridgeRuntime::new(app)?;
        *instance = Some(Arc::new(Mutex::new(bridge)));
    }
    Ok(instance.as_ref().unwrap().clone())
}

pub fn ensure_bridge_ready(app: &AppHandle) -> Result<Arc<Mutex<WatermarkBridgeRuntime>>, String> {
    let bridge_arc = get_or_create_bridge(app)?;
    
    // Check if models are already loaded
    {
        let bridge = bridge_arc.lock().map_err(|e| e.to_string())?;
        if bridge.is_ready {
            return Ok(bridge_arc.clone());
        }
    }
    
    // Models not loaded yet — send load command with defaults
    eprintln!("[watermark-bridge] Auto-loading models (first use)...");
    {
        let mut bridge = bridge_arc.lock().map_err(|e| e.to_string())?;
        let response = bridge.send_command(serde_json::json!({
            "command": "load",
            "detection_model": "florence-community/Florence-2-large",
            "inpainting_model": "lama"
        }), Some(app))?;
        
        // Check for errors — Python sends {"error": null} on success, {"error": "msg"} on failure
        if let Some(err) = response.get("error").and_then(|v| v.as_str()) {
            return Err(format!("Failed to auto-load models: {err}"));
        }
        
        if response.get("status").and_then(|s| s.as_str()) != Some("ready") {
            return Err("Bridge did not report ready after loading models".to_string());
        }
    }
    
    Ok(bridge_arc)
}

pub fn send_command_with_retry(app: &AppHandle, cmd: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut retry_count = 0;
    loop {
        let bridge_arc = ensure_bridge_ready(app)?;
        let mut bridge = bridge_arc.lock().map_err(|e| e.to_string())?;
        
        match bridge.send_command(cmd.clone(), Some(app)) {
            Ok(res) => return Ok(res),
            Err(e) if e.contains("Broken pipe") || e.contains("os error 32") || e.contains("EOF") => {
                if retry_count >= 1 {
                    return Err(format!("Engine crashed repeatedly. Check logs for details. Error: {}", e));
                }
                eprintln!("[watermark-bridge] Broken pipe detected, restarting bridge...");
                emit_log(app, "Engine connection lost. Restarting and retrying...", true);
                
                // Drop the lock and clear the instance to force a fresh start
                drop(bridge);
                if let Ok(mut instance) = BRIDGE_INSTANCE.lock() {
                    *instance = None;
                }
                retry_count += 1;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}

async fn run_command_with_logs(app: AppHandle, mut cmd: Command, description: &str) -> Result<(), String> {
    emit_log(&app, &format!("Running: {}...", description), false);
    
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn {description}: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    
    let app_clone = app.clone();
    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            emit_log(&app_clone, &line, false);
        }
    });

    let app_clone_err = app.clone();
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            emit_log(&app_clone_err, &line, true);
        }
    });

    let status = child.wait().map_err(|e| format!("Wait failed for {description}: {e}"))?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if status.success() {
        Ok(())
    } else {
        let err_msg = format!("{} failed with exit code {}", description, status.code().unwrap_or(-1));
        emit_log(&app, &err_msg, true);
        Err(err_msg)
    }
}

pub async fn download_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let paths = EnginePaths::resolve(&app)?;
    let python_exe = paths.python_executable();

    let mut cmd = Command::new(python_exe);
    cmd.env("HF_HOME", &paths.models)
       .env("TORCH_HOME", &paths.models)
       .env("PYTHONPATH", &paths.scripts)
       .current_dir(&paths.scripts)
       .args(["download_models.py", "--model", &model_id]);

    run_command_with_logs(app.clone(), cmd, &format!("download for {model_id}")).await?;
    emit_log(&app, &format!("Model {model_id} download completed!"), false);
    Ok(())
}


pub async fn delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let paths = EnginePaths::resolve(&app)?;
    emit_log(&app, &format!("Deleting model {}...", model_id), false);
    
    let p = if model_id.contains("florence") {
        paths.models.join("hub").join(format!("models--florence-community--{}", model_id.replace("florence-2-", "Florence-2-")))
    } else if model_id == "rembg" {
        paths.models.join("isnet-general-use.onnx")
    } else {
        paths.models.join("torch").join("hub").join("checkpoints").join("big-lama.pt")
    };
    
    if p.exists() {
        if p.is_dir() { std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?; }
        else { std::fs::remove_file(&p).map_err(|e| e.to_string())?; }
        emit_log(&app, &format!("Model {} deleted successfully.", model_id), false);
    } else {
        emit_log(&app, &format!("Model {} not found on disk.", model_id), false);
    }
    
    Ok(())
}

pub async fn run_setup(app: AppHandle, force_reinstall: bool) -> Result<(), String> {
    let paths = EnginePaths::resolve(&app)?;
    paths.ensure_dirs()?;

    emit_log(&app, &format!("Initializing AI Engine in: {}", paths.engine.display()), false);
    emit_log(&app, "Starting Watermark AI setup...", false);

    if !paths.scripts.exists() {
        return Err("Bundled python scripts not found. Please reinstall the application.".to_string());
    }

    let mut force_recreate = force_reinstall;
    if paths.venv.exists() {
        // Check if the current venv's python version is compatible (3.10 to 3.13)
        let python_exe = paths.python_executable();
        let output = Command::new(python_exe)
            .arg("--version")
            .output();
        
        let (out_str, err_str) = match output {
            Ok(o) => (
                String::from_utf8_lossy(&o.stdout).to_string(),
                String::from_utf8_lossy(&o.stderr).to_string()
            ),
            Err(_) => ("".to_string(), "".to_string()),
        };

        let version_info = format!("{} {}", out_str, err_str);
        if version_info.contains("3.14") || version_info.trim().is_empty() {
            emit_log(&app, &format!("Detected incompatible environment ({}). Forcing re-creation with Python 3.13...", version_info.trim()), true);
            force_recreate = true;
        }
    }

    if !paths.venv.exists() || force_recreate {
        if paths.venv.exists() {
            emit_log(&app, "Removing existing virtual environment...", false);
            fs::remove_dir_all(&paths.venv).map_err(|e| format!("Failed to remove venv: {e}"))?;
        }
        
        emit_log(&app, "Creating virtual environment with Python 3.13...", false);
        let uv_installed = check_command_exists("uv");
        
        let status = if uv_installed {
            // Force Python 3.13 which has stable PyTorch/ROCm wheels
            Command::new("uv")
                .args(["venv", "--python", "3.13", VENV_DIR_NAME])
                .current_dir(&paths.engine)
                .status()
        } else {
            let python_cmd = if check_command_exists("python3") { "python3" } else { "python" };
            Command::new(python_cmd)
                .args(["-m", "venv", VENV_DIR_NAME])
                .current_dir(&paths.engine)
                .status()
        }.map_err(|e| format!("Failed to create venv: {e}"))?;
        
        if !status.success() {
            return Err("Venv creation failed".to_string());
        }
    }

    let python_exe = paths.python_executable();
    let uv_installed = check_command_exists("uv");
    
    let (cmd_name, base_args) = if uv_installed {
        ("uv", vec!["pip", "install"])
    } else {
        (python_exe.to_str().unwrap(), vec!["-m", "pip", "install"])
    };

    // Step 0: Detect hardware and install PyTorch/ONNX accordingly
    let hw = detect_hardware();
    emit_log(&app, &format!("Hardware detected: {}", hw.to_uppercase()), false);

    let mut hw_args = base_args.clone();
    if uv_installed {
        // Suggested by uv to resolve index priority issues with custom whl indices
        hw_args.push("--index-strategy");
        hw_args.push("unsafe-best-match");
    }

    if hw == "nvidia" {
        hw_args.extend(["--extra-index-url", "https://download.pytorch.org/whl/cu124", "torch>=2.4.0", "torchvision>=0.19.0", "onnxruntime-gpu", "rembg[gpu]"]);
    } else if hw == "amd" {
        // ROCm (Linux specifically)
        hw_args.extend(["--extra-index-url", "https://download.pytorch.org/whl/rocm6.1", "torch>=2.4.0", "torchvision>=0.19.0", "onnxruntime-rocm", "rembg"]);
    } else if hw == "windows_gpu" {
        // Windows DirectML support
        hw_args.extend(["torch>=2.4.0", "torchvision>=0.19.0", "onnxruntime-directml", "rembg"]);
    } else if hw == "apple" {
        // macOS CoreML/MPS support
        hw_args.extend(["torch>=2.4.0", "torchvision>=0.19.0", "onnxruntime-coreml", "rembg"]);
    } else {
        hw_args.extend(["torch>=2.4.0", "torchvision>=0.19.0", "rembg"]);
    }

    // Always attempt to install OpenVINO for non-Apple systems as a high-performance CPU/iGPU fallback
    if hw != "apple" {
        hw_args.push("onnxruntime-openvino");
    }

    let mut cmd = Command::new(cmd_name);
    cmd.args(&hw_args)
       .env("VIRTUAL_ENV", &paths.venv)
       .env("HF_HOME", &paths.models)
       .env("TORCH_HOME", &paths.models)
       .current_dir(&paths.engine);
    
    run_command_with_logs(app.clone(), cmd, "hardware dependencies (torch/onnx)").await?;

    // Step 1: Install remaining dependencies from requirements.txt
    let requirements_txt = paths.scripts.join("requirements.txt");
    let mut args = base_args.clone();
    args.extend(["--upgrade", "-r", requirements_txt.to_str().unwrap()]);
    let mut cmd = Command::new(cmd_name);
    cmd.args(&args)
       .env("VIRTUAL_ENV", &paths.venv)
       .env("HF_HOME", &paths.models)
       .env("TORCH_HOME", &paths.models)
       .current_dir(&paths.engine);
    
    run_command_with_logs(app.clone(), cmd, "bridge dependencies (requirements.txt)").await?;

    // Step 2: Install iopaint separately with --no-deps to avoid resolver conflicts
    let mut args = base_args.clone();
    args.extend(["iopaint", "--no-deps"]);
    let mut cmd = Command::new(cmd_name);
    cmd.args(&args)
       .env("VIRTUAL_ENV", &paths.venv)
       .env("HF_HOME", &paths.models)
       .env("TORCH_HOME", &paths.models)
       .current_dir(&paths.engine);
    
    run_command_with_logs(app.clone(), cmd, "iopaint backend").await?;

    emit_log(&app, "Setup completed successfully!", false);
    Ok(())
}

pub fn reset_setup(app: &AppHandle) -> Result<(), String> {
    let paths = EnginePaths::resolve(app)?;

    if paths.venv.exists() {
        emit_log(app, "Removing virtual environment...", false);
        fs::remove_dir_all(&paths.venv).map_err(|e| format!("Failed to remove venv: {e}"))?;
    }

    // Also reset bridge instance
    let mut instance = BRIDGE_INSTANCE.lock().unwrap();
    *instance = None;
    if let Ok(mut last) = LAST_STATUS.lock() {
        *last = None;
    }
    emit_log(app, "Reset completed. Models preserved.", false);
    Ok(())
}

pub fn stop_bridge() -> Result<(), String> {
    let mut instance = BRIDGE_INSTANCE.lock().unwrap();
    *instance = None;
    if let Ok(mut last) = LAST_STATUS.lock() {
        *last = None;
    }
    Ok(())
}
