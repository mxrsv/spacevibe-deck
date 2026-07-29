use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::Path;

/// Logos are swallowed into the app as a data URL, so keep them small — a big
/// image would bloat the store and every read of it.
const MAX_LOGO_BYTES: u64 = 1_048_576; // 1 MB

/// MIME type for an allowlisted image extension, or `None` when unsupported.
/// Case-insensitive so `Logo.PNG` is accepted. `.ico` is included for favicons.
fn mime_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

/// Read + base64-encode an image file into a `data:<mime>;base64,…` URL, with
/// the extension allowlist and 1 MB size cap. Errors are human-readable.
fn encode_image_data_url(path: &Path) -> Result<String, String> {
    let mime = mime_for(path).ok_or("Unsupported image type — use .png, .jpg, .svg or .webp")?;
    let metadata = std::fs::metadata(path).map_err(|_| "Couldn't read the image file")?;
    if metadata.len() > MAX_LOGO_BYTES {
        return Err("Image is too large (max 1 MB)".to_string());
    }
    let bytes = std::fs::read(path).map_err(|_| "Couldn't read the image file")?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}

/// Read an image file and return it as a `data:<mime>;base64,…` URL so the app
/// can display it without an `assetProtocol` scope, and so it survives the
/// original file being deleted or moved. Rejects unsupported types and files
/// over 1 MB with a human-readable message.
#[tauri::command]
pub async fn read_image_as_data_url(path: String) -> Result<String, String> {
    encode_image_data_url(Path::new(&path))
}

/// Common in-repo favicon locations, checked in order. The first that exists,
/// is a file, and encodes cleanly wins.
const FAVICON_CANDIDATES: [&str; 12] = [
    "favicon.ico",
    "favicon.png",
    "favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "public/favicon.svg",
    "src/app/favicon.ico",
    "src/favicon.ico",
    "static/favicon.ico",
    "static/favicon.png",
    "assets/favicon.ico",
    "app/favicon.ico",
];

/// Look for a project favicon under `dir` and return it as a data URL, or
/// `None` when the folder has none. Used as the default workspace logo.
#[tauri::command]
pub async fn scan_workspace_favicon(dir: String) -> Option<String> {
    let root = Path::new(&dir);
    for candidate in FAVICON_CANDIDATES {
        let path = root.join(candidate);
        if path.is_file() {
            if let Ok(url) = encode_image_data_url(&path) {
                return Some(url);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn mime_for_maps_allowlisted_extensions_case_insensitively() {
        assert_eq!(mime_for(Path::new("/a/logo.png")), Some("image/png"));
        assert_eq!(mime_for(Path::new("/a/logo.PNG")), Some("image/png"));
        assert_eq!(mime_for(Path::new("/a/pic.JPG")), Some("image/jpeg"));
        assert_eq!(mime_for(Path::new("/a/pic.jpeg")), Some("image/jpeg"));
        assert_eq!(mime_for(Path::new("/a/mark.svg")), Some("image/svg+xml"));
        assert_eq!(mime_for(Path::new("/a/mark.webp")), Some("image/webp"));
        assert_eq!(mime_for(Path::new("/a/favicon.ico")), Some("image/x-icon"));
    }

    #[test]
    fn mime_for_rejects_unknown_and_missing_extensions() {
        assert_eq!(mime_for(Path::new("/a/anim.gif")), None);
        assert_eq!(mime_for(Path::new("/a/README")), None);
    }

    #[test]
    fn encodes_a_small_png_as_a_data_url() {
        let dir = std::env::temp_dir();
        let path = dir.join("stackgrid-test-logo.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nfake").unwrap();
        let result = tauri::async_runtime::block_on(read_image_as_data_url(
            path.to_string_lossy().into_owned(),
        ));
        let _ = std::fs::remove_file(&path);
        let url = result.expect("small png should encode");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn rejects_a_file_over_the_size_limit() {
        let dir = std::env::temp_dir();
        let path = dir.join("stackgrid-test-huge.png");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(&vec![0u8; (MAX_LOGO_BYTES + 1) as usize])
            .unwrap();
        drop(file);
        let result = tauri::async_runtime::block_on(read_image_as_data_url(
            path.to_string_lossy().into_owned(),
        ));
        let _ = std::fs::remove_file(&path);
        assert_eq!(result, Err("Image is too large (max 1 MB)".to_string()));
    }

    #[test]
    fn errors_when_the_file_does_not_exist() {
        let path = std::env::temp_dir().join("stackgrid-definitely-missing.png");
        let result = tauri::async_runtime::block_on(read_image_as_data_url(
            path.to_string_lossy().into_owned(),
        ));
        assert!(result.is_err());
    }

    #[test]
    fn scans_a_folder_for_a_favicon() {
        let dir = std::env::temp_dir().join("stackgrid-fav-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("public")).unwrap();
        std::fs::write(dir.join("public/favicon.png"), b"\x89PNG\r\n\x1a\nx").unwrap();
        let found = tauri::async_runtime::block_on(scan_workspace_favicon(
            dir.to_string_lossy().into_owned(),
        ));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(found.is_some());
        assert!(found.unwrap().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn returns_none_when_no_favicon_present() {
        let dir = std::env::temp_dir().join("stackgrid-nofav-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let found = tauri::async_runtime::block_on(scan_workspace_favicon(
            dir.to_string_lossy().into_owned(),
        ));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(found, None);
    }
}
