#!/usr/bin/env bash
set -euo pipefail

REPO="${BB_REPO:-supSugam/beautiful-batches}"
APPIMAGE_TARGET_NAME="beautiful-batches.AppImage"

if [[ "${1:-}" == "--repo" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Usage: install.sh [--repo owner/name]"
    exit 1
  fi
  REPO="$2"
fi

for cmd in curl python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required dependency: $cmd"
    exit 1
  fi
done

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "$OS_RAW" in
  Darwin) OS_KIND="macos" ;;
  Linux) OS_KIND="linux" ;;
  *)
    echo "Unsupported OS: $OS_RAW"
    exit 1
    ;;
esac

case "$ARCH_RAW" in
  x86_64 | amd64) ARCH_KIND="x64" ;;
  arm64 | aarch64) ARCH_KIND="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH_RAW"
    exit 1
    ;;
esac

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

API_URL="https://api.github.com/repos/${REPO}/releases/latest"
RELEASE_JSON="$(curl -fsSL "$API_URL")"

ASSET_INFO="$(
  OS_KIND="$OS_KIND" ARCH_KIND="$ARCH_KIND" RELEASE_JSON="$RELEASE_JSON" python3 - <<'PY'
import json
import os
import sys

data = json.loads(os.environ["RELEASE_JSON"])
assets = data.get("assets", [])
os_kind = os.environ["OS_KIND"]
arch_kind = os.environ["ARCH_KIND"]

arch_tokens = {
    "x64": ["x64", "x86_64", "amd64"],
    "arm64": ["arm64", "aarch64"],
}
other_arch_tokens = {
    "x64": arch_tokens["arm64"],
    "arm64": arch_tokens["x64"],
}

if os_kind == "macos":
    allowed = [".dmg"]
elif os_kind == "linux":
    allowed = [".deb", ".appimage"]
else:
    allowed = []

def score_asset(asset):
    name = asset.get("name", "")
    lower = name.lower()

    if lower.endswith((".sig", ".asc", ".sha256", ".sha512", ".txt", ".json")):
        return None
    if "updater" in lower or "symbol" in lower:
        return None

    ext_score = None
    for idx, ext in enumerate(allowed):
        if lower.endswith(ext):
            ext_score = 100 - (idx * 10)
            break
    if ext_score is None:
        return None

    score = ext_score

    for token in arch_tokens[arch_kind]:
        if token in lower:
            score += 30
            break

    for token in other_arch_tokens[arch_kind]:
        if token in lower:
            score -= 35

    return score

ranked = []
for asset in assets:
    score = score_asset(asset)
    if score is None:
        continue
    ranked.append((score, asset.get("name", ""), asset.get("browser_download_url", "")))

if not ranked:
    names = [a.get("name", "") for a in assets]
    raise SystemExit("No matching installer asset found.\nAvailable assets:\n- " + "\n- ".join(names))

ranked.sort(key=lambda item: item[0], reverse=True)
best = ranked[0]
print(best[1])
print(best[2])
PY
)"

ASSET_NAME="$(printf '%s\n' "$ASSET_INFO" | sed -n '1p')"
ASSET_URL="$(printf '%s\n' "$ASSET_INFO" | sed -n '2p')"

if [[ -z "$ASSET_NAME" || -z "$ASSET_URL" ]]; then
  echo "Failed to resolve release asset."
  exit 1
fi

ASSET_PATH="${TMP_DIR}/${ASSET_NAME}"
echo "Downloading ${ASSET_NAME}..."
curl -fL "$ASSET_URL" -o "$ASSET_PATH"

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  echo "Need elevated permissions for: $*"
  exit 1
}

if [[ "$OS_KIND" == "macos" ]]; then
  if ! command -v hdiutil >/dev/null 2>&1; then
    echo "hdiutil is required on macOS."
    exit 1
  fi

  MOUNT_POINT="$(hdiutil attach "$ASSET_PATH" -nobrowse | awk 'END {print $NF}')"
  if [[ -z "$MOUNT_POINT" ]]; then
    echo "Failed to mount DMG."
    exit 1
  fi

  detach_dmg() {
    hdiutil detach "$MOUNT_POINT" -quiet || true
  }
  trap 'detach_dmg; cleanup' EXIT

  APP_PATH="$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "*.app" | head -n1)"
  if [[ -z "$APP_PATH" ]]; then
    echo "No .app bundle found in DMG."
    exit 1
  fi

  if [[ -w "/Applications" ]]; then
    TARGET_DIR="/Applications"
  else
    TARGET_DIR="${HOME}/Applications"
    mkdir -p "$TARGET_DIR"
  fi

  APP_NAME="$(basename "$APP_PATH")"
  rm -rf "${TARGET_DIR}/${APP_NAME}"
  cp -R "$APP_PATH" "$TARGET_DIR/"
  detach_dmg

  echo "Installed ${APP_NAME} to ${TARGET_DIR}"
  exit 0
fi

if [[ "${ASSET_NAME,,}" == *.deb ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    run_as_root apt-get install -y "$ASSET_PATH"
  elif command -v dpkg >/dev/null 2>&1; then
    run_as_root dpkg -i "$ASSET_PATH"
  else
    echo "No supported installer tool found (apt-get or dpkg)."
    exit 1
  fi
  echo "Installed ${ASSET_NAME}"
  exit 0
fi

if [[ "${ASSET_NAME,,}" == *.appimage ]]; then
  TARGET_DIR="${HOME}/.local/bin"
  mkdir -p "$TARGET_DIR"
  TARGET_PATH="${TARGET_DIR}/${APPIMAGE_TARGET_NAME}"
  cp "$ASSET_PATH" "$TARGET_PATH"
  chmod +x "$TARGET_PATH"
  echo "Installed AppImage to ${TARGET_PATH}"
  echo "Run it with: ${TARGET_PATH}"
  exit 0
fi

echo "Unsupported asset type: ${ASSET_NAME}"
exit 1
