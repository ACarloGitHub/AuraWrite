// fs_tools.rs - File system tools (native MCP)
//
// Provides file_read, file_write, file_list, file_edit.
// All paths are confined to the workspace by default.
// Paths outside the workspace require permission (uses permissions.rs).
//
// Results follow the Tool Result Injection pattern:
// [INSTRUCTION: ...] prefix tells the AI how to handle the result.

use std::fs;
use std::path::Path;
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

use crate::workspace::workspace_path;
use crate::permissions::PermissionState;



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEditOperation {
    pub old_text: String,
    pub new_text: String,
}

fn check_path_allowed(
    path: &Path,
    ws_path: &Path,
    app: &AppHandle,
    perm_state: &tauri::State<'_, PermissionState>,
) -> Result<bool, String> {
    if path.starts_with(ws_path) {
        return Ok(true);
    }

    perm_state.ensure_loaded(app)?;
    let store = perm_state.store.lock().map_err(|e| format!("lock: {}", e))?;

    for entry in store.all_entries() {
        let allowed = Path::new(&entry.path);
        if path.starts_with(allowed) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}

#[tauri::command]
pub fn file_read(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
) -> Result<String, String> {
    let ws_path = workspace_path(&app)?;
    let file_path = Path::new(&path);

    let resolved = if !file_path.is_absolute() {
        ws_path.join(&path)
    } else {
        file_path.to_path_buf()
    };

    if !check_path_allowed(&resolved, &ws_path, &app, &state)? {
        return Err(format!("Permission denied: path '{}' is outside the workspace and no permission has been granted. Ask the user to grant access.", resolved.display()));
    }

    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved.display()));
    }

    if resolved.is_dir() {
        return Err(format!("Path is a directory, not a file: {}", resolved.display()));
    }

    let content = fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed to read file '{}': {}", resolved.display(), e))?;

    let total_chars = content.len();
    let total_lines = content.lines().count();

    Ok(format!(
        "[INSTRUCTION: You have the full content of this file. Use it as needed.] File '{}' ({} chars, {} lines):\n\n{}",
        resolved.display(), total_chars, total_lines, content
    ))
}

#[tauri::command]
pub fn file_write(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
    content: String,
) -> Result<String, String> {
    let ws_path = workspace_path(&app)?;
    let file_path = Path::new(&path);

    let resolved = if !file_path.is_absolute() {
        ws_path.join(&path)
    } else {
        file_path.to_path_buf()
    };

    if !check_path_allowed(&resolved, &ws_path, &app, &state)? {
        return Err(format!("Permission denied: path '{}' is outside the workspace and no permission has been granted.", resolved.display()));
    }

    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
        }
    }

    let line_count = content.lines().count();
    fs::write(&resolved, &content)
        .map_err(|e| format!("Failed to write file '{}': {}", resolved.display(), e))?;

    Ok(format!(
        "[INSTRUCTION: Confirm briefly that the file was saved. Do NOT repeat the file content.] File saved: {} ({} lines).",
        resolved.display(), line_count
    ))
}

#[tauri::command]
pub fn file_list(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
) -> Result<String, String> {
    let ws_path = workspace_path(&app)?;
    let dir_path = Path::new(&path);

    let resolved = if !dir_path.is_absolute() {
        ws_path.join(&path)
    } else {
        dir_path.to_path_buf()
    };

    if !check_path_allowed(&resolved, &ws_path, &app, &state)? {
        return Err(format!("Permission denied: path '{}' is outside the workspace.", resolved.display()));
    }

    if !resolved.exists() {
        return Err(format!("Directory not found: {}", resolved.display()));
    }

    if !resolved.is_dir() {
        return Err(format!("Path is not a directory: {}", resolved.display()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&resolved).map_err(|e| format!("read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path();
        let is_dir = file_path.is_dir();
        let size = if !is_dir {
            file_path.metadata().ok().map(|m| m.len())
        } else {
            None
        };

        entries.push(FileEntry {
            name: file_name,
            path: file_path.to_string_lossy().to_string(),
            is_dir,
            size,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    let mut lines = vec![
        "[INSTRUCTION: List the files and directories briefly.]".to_string(),
        format!("Contents of {} ({} items):", resolved.display(), entries.len()),
    ];

    for e in &entries {
        let type_icon = if e.is_dir { "📁" } else { "📄" };
        let size_str = e.size.map(|s| format!(" ({} bytes)", s)).unwrap_or_default();
        lines.push(format!("{} {}{}", type_icon, e.name, size_str));
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
pub fn file_edit(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
    edits: Vec<FileEditOperation>,
) -> Result<String, String> {
    let ws_path = workspace_path(&app)?;
    let file_path = Path::new(&path);

    let resolved = if !file_path.is_absolute() {
        ws_path.join(&path)
    } else {
        file_path.to_path_buf()
    };

    if !check_path_allowed(&resolved, &ws_path, &app, &state)? {
        return Err(format!("Permission denied: path '{}' is outside the workspace.", resolved.display()));
    }

    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved.display()));
    }

    let mut content = fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed to read file '{}': {}", resolved.display(), e))?;

    let mut total_replacements = 0usize;

    for edit_op in edits {
        let count = content.matches(&edit_op.old_text).count();
        if count == 0 {
            return Err(format!("Old text not found in file. First missing match: '{}'", truncate_str(&edit_op.old_text, 100)));
        }
        content = content.replace(&edit_op.old_text, &edit_op.new_text);
        total_replacements += count;
    }

    fs::write(&resolved, &content)
        .map_err(|e| format!("Failed to write file '{}': {}", resolved.display(), e))?;

    Ok(format!(
        "[INSTRUCTION: Confirm briefly that the file was edited. Do NOT repeat the old or new text.] File edited: {} replacement(s) made in {}.",
        total_replacements, resolved.display()
    ))
}