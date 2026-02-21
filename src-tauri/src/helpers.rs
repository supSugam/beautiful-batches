use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Forward-slash-normalize a path for consistent UI display.
pub fn normalize_path_for_ui(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Normalize a saved root path string (trim + forward slashes).
pub fn normalize_saved_root_path(value: &str) -> String {
    value.trim().replace('\\', "/")
}

/// De-duplicate a list of paths while preserving insertion order.
pub fn dedupe_preserve_order(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let normalized = normalize_saved_root_path(&value);
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        out.push(normalized);
    }
    out
}

/// Check whether a file path has a supported image extension.
pub fn is_supported_image_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp" | "avif")
}

/// Normalize an output format string to one of the supported values.
pub fn normalize_output_format(raw: Option<&str>) -> &'static str {
    let normalized = raw
        .unwrap_or("png")
        .trim()
        .to_ascii_lowercase()
        .replace("jpg", "jpeg");

    match normalized.as_str() {
        "png" => "png",
        "jpeg" => "jpeg",
        "webp" => "webp",
        _ => "png",
    }
}

/// Return the file extension (with leading dot) for an output format.
pub fn output_extension(format: &str) -> &'static str {
    match format {
        "jpeg" => ".jpg",
        "webp" => ".webp",
        _ => ".png",
    }
}

/// Generate a unique file name by appending a numeric suffix.
pub fn append_suffix_name(stem: &str, ext: &str, entries: &HashMap<String, Vec<u8>>) -> String {
    let mut index = 2usize;
    loop {
        let candidate = format!("{stem} ({index}){ext}");
        if !entries.contains_key(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

/// Clamp a floating-point coordinate to valid image bounds.
pub fn clamp_to_image_bounds(value: f64, max_inclusive: u32) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    let max = max_inclusive as f64;
    value.max(0.0).min(max).round() as u32
}
