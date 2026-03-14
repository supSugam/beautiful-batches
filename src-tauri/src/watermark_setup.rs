use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSetupStatus {
    pub python_installed: bool,
    pub git_installed: bool,
    pub uv_installed: bool,
    pub repo_cloned: bool,
    pub venv_ready: bool,
    pub deps_installed: bool,
    pub repo_path: String,
    pub python_path: String,
}

pub fn get_project_root(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap().parent().unwrap().to_path_buf()
}

pub fn get_remover_path(app: &AppHandle) -> PathBuf {
    let mut path = get_project_root(app);
    path.push("WatermarkRemover-AI");
    path
}

fn check_command(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn get_status(app: &AppHandle) -> WatermarkSetupStatus {
    let repo_path = get_remover_path(app);
    let venv_path = repo_path.join(".venv");
    
    #[cfg(windows)]
    let python_exe = venv_path.join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let python_exe = venv_path.join("bin").join("python");

    WatermarkSetupStatus {
        python_installed: check_command("python", &["--version"]) || check_command("python3", &["--version"]),
        git_installed: check_command("git", &["--version"]),
        uv_installed: check_command("uv", &["--version"]),
        repo_cloned: repo_path.exists() && repo_path.join(".git").exists(),
        venv_ready: venv_path.exists(),
        deps_installed: python_exe.exists(), 
        repo_path: repo_path.to_string_lossy().to_string(),
        python_path: python_exe.to_string_lossy().to_string(),
    }
}

pub async fn run_setup_step<F>(app: AppHandle, step: String, on_progress: F) -> Result<(), String> 
where F: Fn(String) + Send + Sync + 'static + Clone
{
    let status = get_status(&app);
    let repo_path = get_remover_path(&app);
    let on_progress = Arc::new(on_progress);
    let progress = {
        let on_progress = Arc::clone(&on_progress);
        move |msg: String| (on_progress)(msg)
    };

    match step.as_str() {
        "clone" => {
            if status.repo_cloned {
                progress("Updating repository...".to_string());
                run_command(&repo_path, "git", &["pull"], &progress)?;
            } else {
                progress("Cloning WatermarkRemover-AI...".to_string());
                let parent = repo_path.parent().ok_or("Invalid repo path")?;
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                run_command(parent, "git", &["clone", "https://github.com/supSugam/WatermarkRemover-AI"], &progress)?;
            }
        }
        "venv" => {
            if !status.repo_cloned { return Err("Repo not cloned".to_string()); }
            progress("Creating virtual environment...".to_string());
            
            if status.uv_installed {
                run_command(&repo_path, "uv", &["venv"], &progress)?;
            } else {
                let python_cmd = if check_command("python3", &["--version"]) { "python3" } else { "python" };
                run_command(&repo_path, python_cmd, &["-m", "venv", ".venv"], &progress)?;
            }
        }
        "deps" => {
            if !status.venv_ready { return Err("Venv not ready".to_string()); }
            progress("Installing dependencies...".to_string());
            
            #[cfg(windows)]
            let pip_exe = repo_path.join(".venv").join("Scripts").join("pip.exe");
            #[cfg(not(windows))]
            let pip_exe = repo_path.join(".venv").join("bin").join("pip");

            if status.uv_installed {
                run_command(&repo_path, "uv", &["pip", "install", "-r", "requirements.txt"], &progress)?;
                run_command(&repo_path, "uv", &["pip", "install", "iopaint", "--no-deps"], &progress)?;
            } else {
                let pip_str = pip_exe.to_str().ok_or("Invalid pip path")?;
                run_command(&repo_path, pip_str, &["install", "-r", "requirements.txt"], &progress)?;
                run_command(&repo_path, pip_str, &["install", "iopaint", "--no-deps"], &progress)?;
            }
        }
        _ => return Err("Unknown setup step".to_string()),
    }

    Ok(())
}

fn run_command<F>(dir: &Path, cmd: &str, args: &[&str], on_progress: &F) -> Result<(), String>
where F: Fn(String) + Send + Sync + 'static
{
    let mut child = Command::new(cmd)
        .args(args)
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start command {}: {}", cmd, e))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    std::thread::scope(|s| {
        let out_h = s.spawn(|| {
            for line in stdout_reader.lines() {
                if let Ok(l) = line {
                    on_progress(l);
                }
            }
        });

        let err_h = s.spawn(|| {
            for line in stderr_reader.lines() {
                if let Ok(l) = line {
                    on_progress(l);
                }
            }
        });

        let _ = out_h.join();
        let _ = err_h.join();
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    
    if !status.success() {
        return Err(format!("Command {} failed with status {}", cmd, status));
    }

    Ok(())
}
