use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, Emitter};
use serde::Serialize;

use crate::models::{WatermarkSidecarStatus, WatermarkModelStatus};


const REPO_URL: &str = "https://github.com/supSugam/WatermarkRemover-AI";
const REPO_DIR_NAME: &str = "watermark-remover-ai";
const VENV_DIR_NAME: &str = "venv";

// Bridge python script is maintained in the WatermarkRemover-AI repository directly

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
    #[cfg(target_os = "macos")]
    {
        return "apple".to_string();
    }

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

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
    
    "cpu".to_string()
}

fn sidecar_base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir: {error}"))?;
    let sidecar_dir = app_data_dir.join("watermark-ai");
    fs::create_dir_all(&sidecar_dir)
        .map_err(|error| format!("Failed to create sidecar dir: {error}"))?;
    Ok(sidecar_dir)
}

fn get_repo_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sidecar_base_dir(app)?.join(REPO_DIR_NAME))
}

fn get_venv_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sidecar_base_dir(app)?.join(VENV_DIR_NAME))
}

fn get_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = sidecar_base_dir(app)?.join("models");
    fs::create_dir_all(&dir).map_err(|e: std::io::Error| e.to_string())?;
    Ok(dir)
}

fn get_python_executable(app: &AppHandle) -> Result<PathBuf, String> {
    let venv_path = get_venv_path(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(venv_path.join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(venv_path.join("bin").join("python"))
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
fn check_venv_lib_exists(app: &AppHandle, lib_name: &str) -> bool {
    let venv_path = match get_venv_path(app) { Ok(p) => p, Err(_) => return false };
    
    // Walk site-packages to find folder starting with lib_name
    #[cfg(target_os = "windows")]
    let sp = venv_path.join("Lib").join("site-packages");
    #[cfg(not(target_os = "windows"))]
    let sp = {
        // On linux/mac, it's lib/python3.x/site-packages
        let lib_dir = venv_path.join("lib");
        if let Ok(entries) = fs::read_dir(lib_dir) {
            let mut found = None;
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("python") {
                    found = Some(entry.path().join("site-packages"));
                    break;
                }
            }
            found.unwrap_or(venv_path.join("lib"))
        } else {
            venv_path.join("lib")
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
    let repo_path = get_repo_path(app)?;
    let python_exe = get_python_executable(app)?;
    let models_dir = get_models_dir(app)?;
    
    let python_installed = check_command_exists("python3") || check_command_exists("python");
    let git_installed = check_command_exists("git");
    let uv_installed = check_command_exists("uv");
    
    let repo_cloned = repo_path.join(".git").exists();
    let venv_exists = python_exe.exists();
    
    // Optimized dependency check: just check for a few key markers on disk
    let dependencies_installed = venv_exists && repo_path.exists() && 
        (check_venv_lib_exists(app, "iopaint") || check_venv_lib_exists(app, "IOPaint")) && 
        check_venv_lib_exists(app, "transformers") &&
        check_venv_lib_exists(app, "rembg");

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
        git_installed,
        uv_installed,
        repo_cloned,
        venv_exists,
        dependencies_installed,
        is_bridge_active,
        is_bridge_busy,
        is_models_loaded,
        is_bg_removal_loaded,
        loaded_detection_model,
        loaded_inpainting_model,
        loaded_device,
        repo_path: repo_path.to_string_lossy().to_string(),
        python_path: python_exe.to_string_lossy().to_string(),
        model_cache_path: models_dir.to_string_lossy().to_string(),
        hardware_type: detect_hardware(),
        ..Default::default()
    };

    // Cache the status for when bridge is busy
    if let Ok(mut last) = LAST_STATUS.lock() {
        *last = Some(status.clone());
    }

    let mut final_status = status;
    final_status.detection_models = vec![
        check_model_files(&models_dir, DETECTION_MODEL_BASE.0, DETECTION_MODEL_BASE.1, DETECTION_MODEL_BASE.2, DETECTION_MODEL_BASE.3, "detection"),
        check_model_files(&models_dir, DETECTION_MODEL_LARGE.0, DETECTION_MODEL_LARGE.1, DETECTION_MODEL_LARGE.2, DETECTION_MODEL_LARGE.3, "detection"),
    ];

    final_status.inpainting_models = vec![
        check_model_files(&models_dir, INPAINTING_MODEL_LAMA.0, INPAINTING_MODEL_LAMA.1, INPAINTING_MODEL_LAMA.2, INPAINTING_MODEL_LAMA.3, "inpainting"),
    ];

    final_status.background_removal_models = vec![
        check_model_files(&models_dir, BACKGROUND_REMOVAL_MODEL_REMBG.0, BACKGROUND_REMOVAL_MODEL_REMBG.1, BACKGROUND_REMOVAL_MODEL_REMBG.2, BACKGROUND_REMOVAL_MODEL_REMBG.3, "background_removal"),
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
        let repo_path = get_repo_path(app)?;
        let python_exe = get_python_executable(app)?;
        let models_dir = get_models_dir(app)?;

        if !python_exe.exists() {
            return Err("Python environment not found. Please run setup first.".to_string());
        }

        // bridge.py lives in the cloned WatermarkRemover-AI repo (fetched via git pull in setup)
        let bridge_script = repo_path.join("bridge.py");

        if !bridge_script.exists() {
            return Err("bridge.py not found in repository. Please run setup to clone/update the repo.".to_string());
        }

        let mut child = Command::new(python_exe)
            .arg(&bridge_script)
            .env("HF_HOME", &models_dir)
            .env("XDG_CACHE_HOME", &models_dir)
            .env("TORCH_HOME", &models_dir)
            .env("U2NET_HOME", &models_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .current_dir(&repo_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn bridge: {e}"))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let mut reader = BufReader::new(stdout);

        // Read the startup message: {"status": "bridge_started"}
        // Our deployed bridge.py always prints this. Wait up to 30s for Python to import.
        let mut startup_line = String::new();
        reader.read_line(&mut startup_line)
            .map_err(|e| format!("Bridge failed to start (no startup message): {e}"))?;
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

    pub fn send_command(&mut self, cmd: serde_json::Value, app: Option<&AppHandle>) -> Result<serde_json::Value, String> {
        let line = format!("{}\n", cmd.to_string());
        self.stdin.write_all(line.as_bytes()).map_err(|e: std::io::Error| e.to_string())?;
        self.stdin.flush().map_err(|e: std::io::Error| e.to_string())?;

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
    if instance.is_none() {
        let bridge = WatermarkBridgeRuntime::new(app)?;
        *instance = Some(Arc::new(Mutex::new(bridge)));
    }
    Ok(instance.as_ref().unwrap().clone())
}

/// Auto-start bridge and load models if not already ready.
/// This is the main entry point for commands that need the bridge.
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

pub async fn download_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let repo_path = get_repo_path(&app)?;
    let python_exe = get_python_executable(&app)?;
    let models_dir = get_models_dir(&app)?;

    emit_log(&app, &format!("Starting download for {model_id}..."), false);

    let mut cmd = Command::new(python_exe);
    cmd.env("HF_HOME", &models_dir)
       .env("TORCH_HOME", &models_dir)
       .env("PYTHONPATH", &repo_path)
       .stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .current_dir(&repo_path)
       .args(["download_models.py", "--model", &model_id]);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

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

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if status.success() {
        emit_log(&app, &format!("Model {model_id} download completed!"), false);
        Ok(())
    } else {
        emit_log(&app, &format!("Model {model_id} download failed! Check logs above."), true);
        Err(format!("Download failed for {model_id}"))
    }
}


pub async fn delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let models_dir = get_models_dir(&app)?;
    emit_log(&app, &format!("Deleting model {}...", model_id), false);
    
    let p = if model_id.contains("florence") {
        models_dir.join("hub").join(format!("models--florence-community--{}", model_id.replace("florence-2-", "Florence-2-")))
    } else if model_id == "rembg" {
        models_dir.join("isnet-general-use.onnx")
    } else {
        models_dir.join("torch").join("hub").join("checkpoints").join("big-lama.pt")
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
    let base_dir = sidecar_base_dir(&app)?;
    let repo_path = get_repo_path(&app)?;
    let venv_path = get_venv_path(&app)?;
    let models_dir = get_models_dir(&app)?;

    emit_log(&app, "Starting Watermark AI setup...", false);

    if !repo_path.exists() {
        emit_log(&app, &format!("Cloning repository from {REPO_URL}..."), false);
        let status = Command::new("git")
            .args(["clone", REPO_URL, REPO_DIR_NAME])
            .current_dir(&base_dir)
            .status()
            .map_err(|e| format!("Failed to run git clone: {e}"))?;
        
        if !status.success() {
            return Err("Git clone failed".to_string());
        }
    } else {
        emit_log(&app, "Repository already exists, pulling latest changes...", false);
        // Note: We used to discard local modifications here to avoid merge conflicts.
        // But for development, we now attempt a clean pull and only force-discard if it fails.
        let pull_status = Command::new("git")
            .args(["pull"])
            .current_dir(&repo_path)
            .status()
            .map_err(|e| format!("Failed to run git pull: {e}"))?;
        
        if !pull_status.success() {
            emit_log(&app, "Git pull failed (likely due to local changes). Attempting to resolve...", true);
            // If pull fails, we force-discard so the user can at least get back to a working state
            let _ = Command::new("git").args(["checkout", "--", "."]).current_dir(&repo_path).status();
            let _ = Command::new("git").args(["clean", "-fd"]).current_dir(&repo_path).status();
            let _ = Command::new("git").args(["pull"]).current_dir(&repo_path).status();
            emit_log(&app, "Reset local state and pulled successfully.", false);
        } else {
            emit_log(&app, "Repository updated successfully.", false);
        }
    }

    if !venv_path.exists() || force_reinstall {
        if venv_path.exists() {
            emit_log(&app, "Removing existing virtual environment...", false);
            fs::remove_dir_all(&venv_path).map_err(|e| format!("Failed to remove venv: {e}"))?;
        }
        
        emit_log(&app, "Creating virtual environment...", false);
        let python_cmd = if check_command_exists("python3") { "python3" } else { "python" };
        let status = Command::new(python_cmd)
            .args(["-m", "venv", VENV_DIR_NAME])
            .current_dir(&base_dir)
            .status()
            .map_err(|e| format!("Failed to create venv: {e}"))?;
        
        if !status.success() {
            return Err("Venv creation failed".to_string());
        }
    }

    let python_exe = get_python_executable(&app)?;
    let uv_installed = check_command_exists("uv");
    
    let (cmd_name, base_args) = if uv_installed {
        ("uv", vec!["pip", "install"])
    } else {
        (python_exe.to_str().unwrap(), vec!["-m", "pip", "install"])
    };

    // Step 0: Detect hardware and install PyTorch/ONNX accordingly
    let hw = detect_hardware();
    emit_log(&app, &format!("Hardware detected: {}", hw.to_uppercase()), false);
    emit_log(&app, &format!("Installing PyTorch and ONNX Runtime using {}...", cmd_name), false);

    let mut hw_args = base_args.clone();
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
       .env("VIRTUAL_ENV", &venv_path)
       .env("HF_HOME", &models_dir)
       .env("TORCH_HOME", &models_dir)
       .current_dir(&repo_path);
    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Hardware dependency installation failed".to_string()); }

    // Step 1: Install remaining dependencies from requirements.txt
    emit_log(&app, &format!("Installing remaining bridge dependencies using {}...", cmd_name), false);
    let mut args = base_args.clone();
    args.extend(["--upgrade", "-r", "requirements.txt"]);
    let mut cmd = Command::new(cmd_name);
    cmd.args(&args)
       .env("VIRTUAL_ENV", &venv_path)
       .env("HF_HOME", &models_dir)
       .env("TORCH_HOME", &models_dir)
       .current_dir(&repo_path);
    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("Core dependency installation failed".to_string()); }

    // Step 2: Install iopaint separately with --no-deps to avoid resolver conflicts
    emit_log(&app, "Installing iopaint backend (--no-deps)...", false);
    let mut args = base_args.clone();
    args.extend(["iopaint", "--no-deps"]);
    let mut cmd = Command::new(cmd_name);
    cmd.args(&args)
       .env("VIRTUAL_ENV", &venv_path)
       .env("HF_HOME", &models_dir)
       .env("TORCH_HOME", &models_dir)
       .current_dir(&repo_path);
    let _status = cmd.status().map_err(|e| e.to_string())?;
    // (rembg is now installed dynamically in Step 0 based on hardware)

    emit_log(&app, "Setup completed successfully!", false);
    Ok(())
}

pub fn reset_setup(app: &AppHandle) -> Result<(), String> {
    let repo_path = get_repo_path(app)?;
    let venv_path = get_venv_path(app)?;

    if repo_path.exists() {
        emit_log(app, "Removing repository...", false);
        fs::remove_dir_all(&repo_path).map_err(|e| format!("Failed to remove repo: {e}"))?;
    }
    if venv_path.exists() {
        emit_log(app, "Removing virtual environment...", false);
        fs::remove_dir_all(&venv_path).map_err(|e| format!("Failed to remove venv: {e}"))?;
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
