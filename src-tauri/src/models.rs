use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    pub clear_image_metadata: Option<bool>,
    pub crops: HashMap<String, CropConfig>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CropConfig {
    pub original_name: Option<String>,
    pub coordinates: Option<StoredCoordinates>,
    pub transforms: Option<TransformConfig>,
    pub output_width: Option<f64>,
    pub padding: Option<Value>,
    pub corner_radius: Option<Value>,
    pub padding_fill_type: Option<String>,
    pub padding_fill_value: Option<String>,
    pub padding_image_url: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteExportPlanRequest {
    pub destination_mode: String,
    pub base_folder: String,
    pub destination_name: String,
    pub conflict_mode: String,
    pub quality: Option<u8>,
    pub clear_metadata: Option<bool>,
    pub include_captions: Option<bool>,
    #[serde(default)]
    pub items: Vec<ExecuteExportPlanItem>,
    #[serde(default)]
    pub padding_image_assets: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteExportPlanItem {
    pub image_id: String,
    pub source_path: String,
    pub source_name: Option<String>,
    pub source_data_base64: Option<String>,
    pub output_path: String,
    pub caption: Option<String>,
    pub crop: Option<CropConfig>,
    pub skip: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteExportPlanResult {
    pub destination_path: String,
    pub written_count: usize,
    pub skipped_count: usize,
    pub caption_written_count: usize,
    pub failed_count: usize,
    pub warnings: Vec<String>,
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
    pub accessed_at: u64,
    pub created_at: u64,
    pub last_modified: u64,
    pub width: u32,
    pub height: u32,
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
pub struct NativeDirectoryChild {
    pub path: String,
    pub name: String,
    pub depth: usize,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedMetadataEntry {
    pub key: String,
    pub value: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedMetadataResult {
    pub entries: Vec<EmbeddedMetadataEntry>,
}

// ── Watermark Sidecar Status ─────────────────────────────────────────

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSidecarStatus {
    pub python_installed: bool,
    pub git_installed: bool,
    pub uv_installed: bool,
    pub repo_cloned: bool,
    pub venv_exists: bool,
    pub dependencies_installed: bool,
    pub is_bridge_active: bool,
    pub is_bridge_busy: bool,
    pub is_models_loaded: bool,
    pub is_bg_removal_loaded: bool,
    pub loaded_detection_model: Option<String>,
    pub loaded_inpainting_model: Option<String>,
    pub loaded_device: Option<String>,
    pub model_cache_path: String,
    pub repo_path: String,
    pub python_path: String,
    pub detection_models: Vec<WatermarkModelStatus>,
    pub inpainting_models: Vec<WatermarkModelStatus>,
    pub background_removal_models: Vec<WatermarkModelStatus>,
    pub total_size_bytes: u64,
    pub hardware_type: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkModelStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub downloaded: bool,
    pub size_bytes: u64,
    pub expected_size_bytes: u64,
    pub model_type: String, // "detection" or "inpainting"
}
