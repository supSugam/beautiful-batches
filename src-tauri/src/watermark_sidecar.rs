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
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
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
        check_venv_lib_exists(app, "transformers");

    let mut status = WatermarkSidecarStatus {
        python_installed,
        git_installed,
        uv_installed,
        repo_cloned,
        venv_exists,
        dependencies_installed,
        repo_path: repo_path.to_string_lossy().to_string(),
        python_path: python_exe.to_string_lossy().to_string(),
        model_cache_path: models_dir.to_string_lossy().to_string(),
        ..Default::default()
    };

    let check_model = |id: &str, name: &str, desc: &str, expected: u64, m_type: &str| -> WatermarkModelStatus {
        let p = if id.contains("florence") {
            models_dir.join("hub").join(format!("models--florence-community--{}", id.replace("florence-2-", "Florence-2-")))
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

        let downloaded = size > 0;
        WatermarkModelStatus {
            id: id.to_string(),
            name: name.to_string(),
            description: desc.to_string(),
            downloaded,
            size_bytes: size,
            expected_size_bytes: expected,
            model_type: m_type.to_string(),
        }
    };

    status.detection_models = vec![
        check_model(DETECTION_MODEL_BASE.0, DETECTION_MODEL_BASE.1, DETECTION_MODEL_BASE.2, DETECTION_MODEL_BASE.3, "detection"),
        check_model(DETECTION_MODEL_LARGE.0, DETECTION_MODEL_LARGE.1, DETECTION_MODEL_LARGE.2, DETECTION_MODEL_LARGE.3, "detection"),
    ];

    status.inpainting_models = vec![
        check_model(INPAINTING_MODEL_LAMA.0, INPAINTING_MODEL_LAMA.1, INPAINTING_MODEL_LAMA.2, INPAINTING_MODEL_LAMA.3, "inpainting"),
    ];

    status.total_size_bytes = status.detection_models.iter().map(|m| m.size_bytes).sum::<u64>()
        + status.inpainting_models.iter().map(|m| m.size_bytes).sum::<u64>();

    Ok(status)
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
    _child: Child,
    stdin: ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
}

impl WatermarkBridgeRuntime {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let repo_path = get_repo_path(app)?;
        let python_exe = get_python_executable(app)?;
        let bridge_script = repo_path.join("bridge.py");
        let models_dir = get_models_dir(app)?;

        if !python_exe.exists() {
            return Err("Python environment not found. Please run setup first.".to_string());
        }

        let mut child = Command::new(python_exe)
            .arg(bridge_script)
            .env("HF_HOME", &models_dir)
            .env("XDG_CACHE_HOME", &models_dir)
            .env("TORCH_HOME", &models_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .current_dir(repo_path)
            .spawn()
            .map_err(|e| format!("Failed to spawn bridge: {e}"))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let reader = BufReader::new(stdout);

        Ok(Self { _child: child, stdin, reader })
    }

    pub fn send_command(&mut self, cmd: serde_json::Value) -> Result<serde_json::Value, String> {
        let line = format!("{}\n", cmd.to_string());
        self.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        self.stdin.flush().map_err(|e| e.to_string())?;

        let mut response = String::new();
        self.reader.read_line(&mut response).map_err(|e| e.to_string())?;
        serde_json::from_str(&response).map_err(|e| e.to_string())
    }
}

pub static BRIDGE_INSTANCE: Mutex<Option<Arc<Mutex<WatermarkBridgeRuntime>>>> = Mutex::new(None);

pub fn get_or_create_bridge(app: &AppHandle) -> Result<Arc<Mutex<WatermarkBridgeRuntime>>, String> {
    let mut instance = BRIDGE_INSTANCE.lock().unwrap();
    if instance.is_none() {
        let bridge = WatermarkBridgeRuntime::new(app)?;
        *instance = Some(Arc::new(Mutex::new(bridge)));
    }
    Ok(instance.as_ref().unwrap().clone())
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
        for line in reader.lines().flatten() {
            emit_log(&app_clone, &line, false);
        }
    });

    let app_clone_err = app.clone();
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
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
        // Discard any local modifications so pull never conflicts
        let _ = Command::new("git")
            .args(["checkout", "--", "."])
            .current_dir(&repo_path)
            .status();
        let _ = Command::new("git")
            .args(["clean", "-fd"])
            .current_dir(&repo_path)
            .status();
        let pull_status = Command::new("git")
            .args(["pull"])
            .current_dir(&repo_path)
            .status()
            .map_err(|e| format!("Failed to run git pull: {e}"))?;
        
        if !pull_status.success() {
            emit_log(&app, "Git pull failed, continuing anyway...", true);
        } else {
            emit_log(&app, "Repository updated successfully.", false);
        }
    }

    // We no longer overwrite bridge.py, we trust the python repository.

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

    // Step 1: Install all dependencies from requirements.txt (Core ML + iopaint helpers)
    // We follow setup.sh logic: install core deps first.
    emit_log(&app, &format!("Installing core dependencies (PyTorch, Transformers, etc) using {}...", cmd_name), false);
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
    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("iopaint installation failed".to_string()); }

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
    emit_log(app, "Reset completed. Models preserved.", false);
    Ok(())
}
