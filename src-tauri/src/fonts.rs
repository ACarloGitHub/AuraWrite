// fonts.rs - User fonts directory management
//
// AuraWrite supports a "user fonts" folder where users can drop .ttf,
// .otf, .woff, or .woff2 files. The app scans this folder at startup
// and exposes the fonts in Preferences. Bundled fonts (Lora, Inter,
// JetBrains Mono) are registered separately via @font-face in CSS.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const MAX_FONT_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB per file

#[derive(Debug, Clone, Serialize)]
pub struct UserFont {
    pub path: String,
    pub filename: String,
    pub family_guess: String,
    pub size_bytes: u64,
}

/// Returns the OS-specific user fonts directory, creating it if missing.
/// - Windows: %APPDATA%\aurawrite\fonts\
/// - macOS:   ~/Library/Application Support/aurawrite/fonts/
/// - Linux:   $XDG_CONFIG_HOME/aurawrite/fonts/ (fallback: ~/.config/aurawrite/fonts/)
#[tauri::command]
pub fn get_user_fonts_dir() -> Result<String, String> {
    let dir = user_fonts_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create fonts dir: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Scans the user fonts directory and returns a list of valid font files.
/// Files that are too large, have wrong magic bytes, or have wrong
/// extension are silently skipped (with a warning logged).
#[tauri::command]
pub fn list_user_fonts() -> Result<Vec<UserFont>, String> {
    let dir = user_fonts_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[fonts] cannot read user fonts dir {:?}: {}", dir, e);
            return Ok(Vec::new());
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        match process_font_file(&path) {
            Ok(Some(font)) => out.push(font),
            Ok(None) => {} // skipped, not a valid font
            Err(e) => eprintln!("[fonts] error reading {:?}: {}", path, e),
        }
    }

    out.sort_by(|a, b| a.family_guess.cmp(&b.family_guess));
    Ok(out)
}

fn user_fonts_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "Cannot determine user data directory".to_string())?;
    Ok(base.join("aurawrite").join("fonts"))
}

fn process_font_file(path: &PathBuf) -> Result<Option<UserFont>, String> {
    // Extension check
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let valid_ext = matches!(ext.as_str(), "ttf" | "otf" | "woff" | "woff2");
    if !valid_ext {
        return Ok(None);
    }

    // Size check
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FONT_SIZE_BYTES {
        eprintln!(
            "[fonts] skipping {} (size {} > {} bytes)",
            path.display(),
            metadata.len(),
            MAX_FONT_SIZE_BYTES
        );
        return Ok(None);
    }

    // Magic bytes check (read first 4 bytes)
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    use std::io::Read;
    let mut head = [0u8; 4];
    match f.read(&mut head) {
        Ok(4) => {}
        Ok(_) => return Ok(None), // file too short
        Err(e) => return Err(e.to_string()),
    }

    // TTF: 0x00010000 or 'true' (0x74727565)
    // OTF: 'OTTO' (0x4F54544F)
    // WOFF: 'wOFF' (0x774F4646)
    // WOFF2: 'wOF2' (0x774F4632)
    let is_valid_font = matches!(
        &head,
        [0x00, 0x01, 0x00, 0x00]
            | [0x74, 0x72, 0x75, 0x65]
            | [0x4F, 0x54, 0x54, 0x4F]
            | [0x77, 0x4F, 0x46, 0x46]
            | [0x77, 0x4F, 0x46, 0x32]
    );
    if !is_valid_font {
        eprintln!(
            "[fonts] skipping {} (invalid magic bytes: {:02X?})",
            path.display(),
            head
        );
        return Ok(None);
    }

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Family name guess: strip extension, replace separators with spaces,
    // title-case the words. Good enough for the Preferences dropdown.
    let stem = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    let family_guess = stem
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(title_case)
        .collect::<Vec<_>>()
        .join(" ");

    Ok(Some(UserFont {
        path: path.to_string_lossy().to_string(),
        filename,
        family_guess,
        size_bytes: metadata.len(),
    }))
}

fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
