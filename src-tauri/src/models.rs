use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── Export pipeline input ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInputFile {
    pub file_path: String,
    pub filename: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub format: Option<String>,
    pub quality: Option<u8>,
    pub if_file_exists: Option<String>,
    pub crops: HashMap<String, CropConfig>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CropConfig {
    pub original_name: Option<String>,
    pub coordinates: Option<StoredCoordinates>,
    pub transforms: Option<TransformConfig>,
    pub output_width: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct StoredCoordinates {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TransformConfig {
    pub rotate: f64,
    pub flip: FlipConfig,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(default)]
pub struct FlipConfig {
    pub horizontal: bool,
    pub vertical: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessBulkExportResult {
    pub zip_base64: String,
    pub file_name: String,
    pub processed_count: usize,
    pub skipped_count: usize,
}

// ── Linked roots persistence ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LinkedRootsFile {
    pub roots: Vec<String>,
}

// ── Directory scanning ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScannedImage {
    pub relative_path: String,
    pub file_name: String,
    pub absolute_path: String,
    pub size: u64,
    pub last_modified: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRootScan {
    pub root_path: String,
    pub directory_name: String,
    pub images: Vec<NativeScannedImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickAndScanRootResult {
    pub cancelled: bool,
    pub root: Option<NativeRootScan>,
    pub saved_root_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSavedRootsResult {
    pub roots: Vec<NativeRootScan>,
    pub saved_root_paths: Vec<String>,
}
