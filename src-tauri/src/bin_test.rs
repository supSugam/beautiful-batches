fn main() {
    let image_path = std::path::Path::new("/home/ctrlcat/Repositories/Personal/beautiful-batches/tmp_test_sidecar/1.png");
    let mut txt_path = image_path.to_path_buf();
    txt_path.set_extension("txt");
    println!("txt_path: {}", txt_path.display());
    println!("txt_path exists: {}", txt_path.exists());
    let caption = if txt_path.exists() && txt_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&txt_path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                Some(trimmed.to_string())
            } else { None }
        } else { None }
    } else { None };
    println!("caption: {:?}", caption);
}
