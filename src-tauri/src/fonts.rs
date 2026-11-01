// fonts.rs - User fonts directory management
//
// AuraWrite supports a "user fonts" folder where users can drop .ttf,
// .otf, .woff, or .woff2 files. The folder belongs to the user, not to the
// program (OS config dir), so its size is the user's business: Preferences
// shows it, with a button that opens it in the file manager.
//
// Two lists, on purpose (measured 2026-11-01 on a real folder of 3471 files):
//
// - `list_user_font_files` -- names only, no file is opened: 1.5 ms. This is
//   what the font selectors need, and they ask for it when they are used.
// - `list_user_fonts` -- the files that really are fonts: each one is opened
//   to read its magic bytes and its size. The same folder costs 350-425 ms,
//   so it runs only for the Preferences folder list, off the main thread.
//
// Bundled fonts (Lora, Inter, JetBrains Mono) are registered separately via
// @font-face in CSS.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const MAX_FONT_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB per file

const FONT_EXTENSIONS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

#[derive(Debug, Clone, Serialize)]
pub struct UserFont {
    pub path: String,
    pub filename: String,
    pub family_guess: String,
    pub size_bytes: u64,
}

/// A font file the selectors can offer: the family name and the path an
/// `@font-face` rule needs. It is built without opening the file.
#[derive(Debug, Clone, Serialize)]
pub struct UserFontFile {
    pub path: String,
    pub family_guess: String,
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

/// Every file in the user fonts folder whose extension names a font format,
/// with the family name AuraWrite derives from the file name. Nothing is
/// opened: this is the list the toolbar dropdown and the Preferences font
/// selects fill themselves with, when someone asks to see them.
#[tauri::command]
pub fn list_user_font_files() -> Result<Vec<UserFontFile>, String> {
    let dir = user_fonts_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out: Vec<UserFontFile> = font_files(&dir)?
        .into_iter()
        .map(|path| UserFontFile {
            family_guess: family_guess_of(&path),
            path: path.to_string_lossy().to_string(),
        })
        .collect();
    out.sort_by(|a, b| a.family_guess.cmp(&b.family_guess));
    Ok(out)
}

/// Scans the user fonts directory and returns the files that really are fonts.
/// Files that are too large or have wrong magic bytes are silently skipped
/// (with a warning logged).
///
/// It opens every candidate, so it is the expensive list: the Preferences
/// folder view is the only caller, and it runs on a separate thread so the
/// window keeps answering while the folder is read.
#[tauri::command(async)]
pub fn list_user_fonts() -> Result<Vec<UserFont>, String> {
    let dir = user_fonts_dir().map_err(|e| e.to_string())?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for path in font_files(&dir)? {
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

/// The candidate font files in `dir`: regular files whose extension names a
/// font format. The extension test is the cheap half of validation; the magic
/// bytes belong to `list_user_fonts`, which promises to have opened the files.
fn font_files(dir: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[fonts] cannot read user fonts dir {:?}: {}", dir, e);
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if FONT_EXTENSIONS.contains(&ext.as_str()) {
            out.push(path);
        }
    }
    Ok(out)
}

fn process_font_file(path: &PathBuf) -> Result<Option<UserFont>, String> {
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

    Ok(Some(UserFont {
        path: path.to_string_lossy().to_string(),
        filename,
        family_guess: family_guess_of(path),
        size_bytes: metadata.len(),
    }))
}

/// The family name AuraWrite derives from the file name: separators become
/// spaces, the words are title-cased. It is the only name the app has for a
/// file it has not opened, so the selectors and the `@font-face` rules agree
/// on it. Good enough for the Preferences dropdown.
fn family_guess_of(path: &PathBuf) -> String {
    let stem = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    stem.replace(['-', '_'], " ")
        .split_whitespace()
        .map(title_case)
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
