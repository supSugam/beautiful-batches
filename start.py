#!/usr/bin/env python3
import subprocess
import time
import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_PORT = 8000
FRONTEND_PORT = 5173


def kill_port(port):
    """Kill any process using the given port."""
    try:
        result = subprocess.run(
            ["fuser", f"{port}/tcp"],
            capture_output=True,
            text=True,
        )
        if result.stdout.strip():
            subprocess.run(["fuser", "-k", f"{port}/tcp"], capture_output=True)
            time.sleep(0.3)
    except Exception:
        pass


def main():
    print("🚀 Starting Beautiful Datasets...\n")

    # Clean up stale processes on our ports
    kill_port(BACKEND_PORT)
    kill_port(FRONTEND_PORT)

    venv_python = os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
    python_exec = venv_python if os.path.exists(venv_python) else sys.executable

    print(f"   🔌 Backend  → http://127.0.0.1:{BACKEND_PORT}")
    backend = subprocess.Popen(
        [
            python_exec, "-m", "uvicorn", "main:app",
            "--host", "127.0.0.1",
            "--port", str(BACKEND_PORT),
            "--reload",
        ],
        cwd=os.path.join(PROJECT_ROOT, "backend"),
    )

    print(f"   🎨 Frontend → http://localhost:{FRONTEND_PORT}")
    frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=os.path.join(PROJECT_ROOT, "frontend"),
    )

    print("\n   ✨ Ready. Press Ctrl+C to stop.\n")

    try:
        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print("   ❌ Backend stopped unexpectedly.")
                break
            if frontend.poll() is not None:
                print("   ❌ Frontend stopped unexpectedly.")
                break
    except KeyboardInterrupt:
        print("\n   🛑 Shutting down...")
    finally:
        for proc in [backend, frontend]:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        print("   ✅ Done.")


if __name__ == "__main__":
    main()
