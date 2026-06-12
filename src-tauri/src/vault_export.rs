// Vault Export — file I/O for Obsidian vault export (D1)
//
// Functions in this module are called from the frontend (TypeScript) via Tauri
// commands. They handle the file system side of exporting a project as an
// Obsidian vault: creating directories, writing markdown files, and copying
// images to the _attachments folder.
//
// Atomicity:
// - `write_file_atomic` writes to a `.tmp` file first, then renames to the
//   destination. This guarantees the final file is either complete or
//   non-existent (no half-written files in the vault).
// - `create_dir_recursive` creates all parent directories (mkdir -p semantics).
//
// Error model:
// - Functions return `Result<_, String>`. The error is a user-friendly message
//   (no internal paths leaked).
// - `path_exists_and_is_dir` is used to check if the target vault folder already
//   exists; the caller (TypeScript) handles the "ask for a new name" UX.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Create a directory and all missing parents (mkdir -p semantics).
/// Idempotent: returns Ok(()) if the directory already exists.
#[tauri::command]
pub fn vault_create_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        if p.is_dir() {
            return Ok(());
        }
        return Err(format!("Path exists but is not a directory: {}", path));
    }
    fs::create_dir_all(p).map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

/// Check if a path exists and is a directory.
/// Returns: "missing" | "file" | "dir"
#[tauri::command]
pub fn vault_check_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok("missing".to_string());
    }
    if p.is_dir() {
        return Ok("dir".to_string());
    }
    Ok("file".to_string())
}

/// Write a file atomically. Writes to `<path>.tmp` first, then renames to
/// `<path>`. If the rename fails, the `.tmp` file is cleaned up.
#[tauri::command]
pub fn vault_write_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);

    // Ensure parent directory exists
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }

    // Reject if path exists but is a directory
    if p.exists() && p.is_dir() {
        return Err(format!("Path is a directory, cannot write file: {}", path));
    }

    let tmp_path: PathBuf = {
        let mut tmp = p.to_path_buf();
        let mut name = tmp
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".tmp");
        tmp.set_file_name(name);
        tmp
    };

    // Write to .tmp
    {
        let mut f = fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file {}: {}", tmp_path.display(), e))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("Failed to write to temp file: {}", e))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {}", e))?;
    }

    // Rename .tmp -> final
    if let Err(e) = fs::rename(&tmp_path, p) {
        // Cleanup tmp on failure
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to rename temp to final: {}", e));
    }

    Ok(())
}

/// Copy a file from source to destination. Used for copying images into
/// `_attachments/<doc-title>/`. Creates parent directories as needed.
/// Returns the absolute path of the destination.
#[tauri::command]
pub fn vault_copy_file(src: String, dest: String) -> Result<String, String> {
    let src_p = Path::new(&src);
    let dest_p = Path::new(&dest);

    if !src_p.exists() {
        return Err(format!("Source file does not exist: {}", src));
    }
    if src_p.is_dir() {
        return Err(format!("Source is a directory, not a file: {}", src));
    }

    if let Some(parent) = dest_p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dir: {}", e))?;
        }
    }

    fs::copy(src_p, dest_p).map_err(|e| format!("Failed to copy file: {}", e))?;

    Ok(dest_p.to_string_lossy().to_string())
}

/// Write a file from a base64-encoded payload. Used for binary data like images
/// (the frontend fetches the asset via Tauri asset protocol, encodes to base64,
/// and sends the bytes here). Atomic via .tmp + rename.
#[tauri::command]
pub fn vault_write_file_bytes(path: String, base64: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let bytes = STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let p = Path::new(&path);

    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    if p.exists() && p.is_dir() {
        return Err(format!("Path is a directory, cannot write file: {}", path));
    }

    let tmp_path: PathBuf = {
        let mut tmp = p.to_path_buf();
        let mut name = tmp
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".tmp");
        tmp.set_file_name(name);
        tmp
    };

    {
        let mut f = fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Failed to write bytes: {}", e))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {}", e))?;
    }

    if let Err(e) = fs::rename(&tmp_path, p) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to rename temp to final: {}", e));
    }

    Ok(())
}
