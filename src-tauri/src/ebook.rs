// EPUB support — working folder management (F2, scheda "Ebooks")
//
// An EPUB is not a Project: it does not use the project database or templates.
// Each ebook lives in a dedicated working folder under the app data dir:
//   <app_data>/ebook-work/<ebook-folder>/
// where the original book structure (text, styles, images, fonts, audio, video,
// misc, catalogs) is decompressed and copied byte-for-byte.
//
// These commands manage the working folders:
//   - `ebook_work_dir`: create (if needed) and return the absolute path of a
//     working folder.
//   - `ebook_work_list`: build the tree (folders + files) of a working folder.
//   - `ebook_work_delete`: delete a working folder (recursively).
//
// Security: folder names are sanitized (alphanumeric + `-` + `_` only), so no
// path separators or traversal (`..`) can escape the work root.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Root of all ebook working folders: `<app_data>/ebook-work/`.
fn work_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    Ok(app_data.join("ebook-work"))
}

/// Sanitize a folder name so it is safe to use as a sub-folder of the work
/// root. Only alphanumeric chars, `-` and `_` survive; everything else
/// (including path separators and dots) becomes `_`.
fn sanitize_folder(folder: &str) -> String {
    folder
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Resolve a working folder path from a folder name (sanitized).
fn resolve_work_dir(app: &tauri::AppHandle, folder: &str) -> Result<PathBuf, String> {
    let safe = sanitize_folder(folder);
    if safe.is_empty() {
        return Err("Invalid folder name".into());
    }
    Ok(work_root(app)?.join(safe))
}

/// One node of the ebook tree.
#[derive(Debug, Serialize, Clone)]
pub struct EbookEntry {
    /// File or folder name.
    pub name: String,
    /// Path relative to the working folder (using `/` as separator).
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<EbookEntry>,
}

/// Recursively build the tree of a directory.
fn build_tree(dir: &PathBuf, base_relative: &str) -> Result<Vec<EbookEntry>, String> {
    let mut entries = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if base_relative.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", base_relative, name)
        };
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type: {}", e))?;
        if file_type.is_dir() {
            let mut children = build_tree(&entry.path(), &relative)?;
            children.sort_by(|a, b| a.name.cmp(&b.name));
            entries.push(EbookEntry {
                name,
                relative_path: relative,
                is_dir: true,
                children,
            });
        } else if file_type.is_file() {
            entries.push(EbookEntry {
                name,
                relative_path: relative,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(entries)
}

/// Return the absolute path of the working folder
/// `<app_data>/ebook-work/<folder>`, creating it (and the work root) if needed.
#[tauri::command]
pub fn ebook_work_dir(app: tauri::AppHandle, folder: String) -> Result<String, String> {
    let dir = resolve_work_dir(&app, &folder)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create working folder: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

/// List the folders inside the work root (one per ebook). Returns folder names.
#[tauri::command]
pub fn ebook_list_all(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = work_root(&app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("Failed to read work root: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read work root entry: {}", e))?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    names.sort();
    Ok(names)
}

/// Build the tree (folders and files) of a working folder.
/// Returns an empty array if the working folder does not exist yet.
#[tauri::command]
pub fn ebook_work_list(app: tauri::AppHandle, folder: String) -> Result<Vec<EbookEntry>, String> {
    let dir = resolve_work_dir(&app, &folder)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    build_tree(&dir, "")
}

/// Delete the working folder `<app_data>/ebook-work/<folder>` (recursively).
/// Succeeds silently if it does not exist.
#[tauri::command]
pub fn ebook_work_delete(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let dir = resolve_work_dir(&app, &folder)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete working folder: {}", e))?;
    }
    Ok(())
}
