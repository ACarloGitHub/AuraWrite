// workspace.rs - Agent workspace sandbox management
//
// The agent workspace is a sandbox directory where AuraWrite's AI agent can
// read and write operational files without asking for permission. It stores
// plans, drafts, working notes, and temporary attachments.
//
// Persistent data (memory wiki, sessions, RAG) lives in app data, NOT in the
// workspace. The workspace is disposable and movable — like Claude's working
// directory.
//
// Workspace structure:
//   <path>/aura-workspace/
//   ├── plans/          Plans, todos, state machine markdown
//   ├── notes/          Working notes, MEMORY.md
//   ├── drafts/         Draft text, code snippets
//   └── attachments/   Temporary attachments from chat
//
// Memory/RAG structure (in app data, NOT in workspace):
//   <app_data>/aurawrite/memory/    Memory wiki (Karpathy-style)
//   <app_data>/aurawrite/sessions/  Archived/compacted sessions

use std::fs;
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

const WORKSPACE_DIR_NAME: &str = "aura-workspace";

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    path: String,
    exists: bool,
    subdirs: Vec<SubdirInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubdirInfo {
    name: String,
    path: String,
    exists: bool,
    file_count: usize,
}

const SUBDIRS: &[&str] = &["plans", "notes", "drafts", "attachments"];

fn default_workspace_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    Ok(app_data.join("aurawrite").join(WORKSPACE_DIR_NAME))
}

pub fn workspace_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    default_workspace_path(app)
}

/// Ensure workspace exists and all subdirs are created.
/// Called on startup and after path changes.
pub fn ensure_workspace(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let path = workspace_path(app)?;
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("create workspace dir: {}", e))?;
    }
    for name in SUBDIRS {
        let subdir = path.join(name);
        if !subdir.exists() {
            fs::create_dir_all(&subdir)
                .map_err(|e| format!("create subdir {}: {}", name, e))?;
        }
    }
    Ok(path)
}

#[tauri::command]
pub fn workspace_get_path(app: AppHandle) -> Result<String, String> {
    let path = workspace_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_init(app: AppHandle) -> Result<String, String> {
    let path = ensure_workspace(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_info(app: AppHandle) -> Result<WorkspaceInfo, String> {
    let path = workspace_path(&app)?;
    let exists = path.exists();

    let subdirs: Vec<SubdirInfo> = SUBDIRS
        .iter()
        .map(|name| {
            let subdir = path.join(name);
            let subdir_exists = subdir.exists();
            let file_count = if subdir_exists {
                fs::read_dir(&subdir)
                    .map(|rd| rd.count())
                    .unwrap_or(0)
            } else {
                0
            };
            SubdirInfo {
                name: name.to_string(),
                path: subdir.to_string_lossy().to_string(),
                exists: subdir_exists,
                file_count,
            }
        })
        .collect();

    Ok(WorkspaceInfo {
        path: path.to_string_lossy().to_string(),
        exists,
        subdirs,
    })
}


#[tauri::command]
pub fn workspace_open(app: AppHandle) -> Result<(), String> {
    let path = workspace_path(&app)?;
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("create workspace dir: {}", e))?;
    }
    open_in_file_manager(&path)
}

fn open_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open finder: {}", e))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open file manager: {}", e))?;
    }
    Ok(())
}

/// Reset workspace: delete all files inside subdirs, but keep the workspace
/// directory and its subdirs intact. The workspace folder is NOT removed.
#[tauri::command]
pub fn workspace_reset(app: AppHandle) -> Result<(), String> {
    let path = workspace_path(&app)?;
    if !path.exists() {
        return Ok(());
    }
    for name in SUBDIRS {
        let subdir = path.join(name);
        if subdir.exists() {
            for entry in fs::read_dir(&subdir).map_err(|e| format!("read subdir {}: {}", name, e))? {
                let entry = entry.map_err(|e| format!("read entry: {}", e))?;
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    fs::remove_dir_all(&entry_path)
                        .map_err(|e| format!("remove dir {}: {}", entry_path.display(), e))?;
                } else {
                    fs::remove_file(&entry_path)
                        .map_err(|e| format!("remove file {}: {}", entry_path.display(), e))?;
                }
            }
        }
    }
    Ok(())
}