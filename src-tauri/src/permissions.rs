// permissions.rs - Agent permission management
//
// Manages which paths the AI agent is allowed to access outside the workspace.
// Three scopes: once (single operation), session (until app close), always (persistent).
//
// Permission checks flow:
// 1. Agent tool requests access to a path
// 2. Rust backend checks if path is inside workspace (always allowed)
// 3. If outside, checks permission store
// 4. If not permitted, emits event to frontend for user dialog
// 5. User chooses: Allow once / Allow for this session / Allow always / Deny
// 6. Permission stored accordingly

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};

use crate::workspace::workspace_path;

const PERMISSIONS_FILE: &str = "agent-permissions.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionEntry {
    pub path: String,
    pub scope: PermissionScope,
    pub tool: String,
    pub granted_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionScope {
    Session,
    Always,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PermissionsStore {
    always: Vec<PermissionEntry>,
    #[serde(skip)]
    session: Vec<PermissionEntry>,
    #[serde(skip)]
    loaded: bool,
}

impl PermissionsStore {
    pub fn empty() -> Self {
        PermissionsStore {
            always: Vec::new(),
            session: Vec::new(),
            loaded: false,
        }
    }

    pub fn all_entries(&self) -> Vec<&PermissionEntry> {
        let mut entries: Vec<&PermissionEntry> = self.always.iter().collect();
        entries.extend(self.session.iter());
        entries
    }

    fn load(app: &AppHandle) -> Result<Self, String> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app_data_dir error: {}", e))?;
        let file = app_data.join("aurawrite").join(PERMISSIONS_FILE);
        if file.exists() {
            let content = fs::read_to_string(&file)
                .map_err(|e| format!("read permissions: {}", e))?;
            // Accept two on-disk formats:
            //  - current:  {"always": [ ... ]}  (struct serialized via save())
            //  - legacy:   [ ... ]               (bare array, produced by a previous bug
            //                                     where save() wrote only self.always)
            let mut store: PermissionsStore = match serde_json::from_str::<PermissionsStore>(&content)
            {
                Ok(s) => s,
                Err(_) => {
                    let always_vec: Vec<PermissionEntry> = serde_json::from_str(&content)
                        .map_err(|e| format!("parse permissions: {}", e))?;
                    PermissionsStore {
                        always: always_vec,
                        session: Vec::new(),
                        loaded: false,
                    }
                }
            };
            store.session = Vec::new();
            store.loaded = true;
            // Re-save immediately in the canonical struct format if we migrated
            // from the legacy array, so the file is self-healing.
            let migrated = serde_json::from_str::<PermissionsStore>(&content).is_err();
            if migrated {
                let _ = store.save(app);
            }
            Ok(store)
        } else {
            Ok(Self::empty())
        }
    }

    fn save(&self, app: &AppHandle) -> Result<(), String> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app_data_dir error: {}", e))?;
        let dir = app_data.join("aurawrite");
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| format!("create dir: {}", e))?;
        }
        let file = dir.join(PERMISSIONS_FILE);
        // Serialize the whole struct. `session` and `loaded` are #[serde(skip)],
        // so the on-disk shape is {"always": [ ... ]}, which load() can parse back.
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("serialize permissions: {}", e))?;
        fs::write(&file, content).map_err(|e| format!("write permissions: {}", e))?;
        Ok(())
    }
}

/// Case-insensitive prefix match for two filesystem paths.
///
/// `Path::starts_with` compares OS path *components* but is case-sensitive even on
/// Windows, so an authorized folder saved as `C:\Users\Carlo\...` would not match a
/// request expressed as `c:\users\carlo\...`. We normalize both sides to a lowercase
/// string with forward slashes and compare on a path boundary, which is robust across
/// drive-letter casing and mixed separators.
pub(crate) fn path_allowed(requested: &Path, allowed: &Path) -> bool {
    let norm = |p: &Path| {
        p.to_string_lossy()
            .to_ascii_lowercase()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string()
    };
    let r = norm(requested);
    let a = norm(allowed);
    if r.is_empty() || a.is_empty() {
        return false;
    }
    r == a || r.starts_with(&format!("{}/", a))
}

pub struct PermissionState {
    pub store: Mutex<PermissionsStore>,
}

impl PermissionState {
    pub fn ensure_loaded(&self, app: &AppHandle) -> Result<(), String> {
        let mut store = self.store.lock().map_err(|e| format!("lock: {}", e))?;
        if !store.always.is_empty() || store.loaded {
            return Ok(());
        }
        let loaded = PermissionsStore::load(app)?;
        store.always = loaded.always;
        store.loaded = true;
        Ok(())
    }
}

#[tauri::command]
pub fn permissions_check(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
    _tool: String,
) -> Result<bool, String> {
    state.ensure_loaded(&app)?;
    let ws_path = workspace_path(&app)?;
    let requested = Path::new(&path);

    if path_allowed(requested, &ws_path) {
        return Ok(true);
    }

    let store = state.store.lock().map_err(|e| format!("lock: {}", e))?;

    for entry in &store.always {
        let allowed = Path::new(&entry.path);
        if path_allowed(requested, allowed) {
            return Ok(true);
        }
    }

    for entry in &store.session {
        let allowed = Path::new(&entry.path);
        if path_allowed(requested, allowed) {
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub fn permissions_grant(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
    scope: PermissionScope,
    tool: String,
) -> Result<(), String> {
    state.ensure_loaded(&app)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("time: {}", e))?
        .as_secs();

    let entry = PermissionEntry {
        path: path.clone(),
        scope: scope.clone(),
        tool,
        granted_at: now,
    };

    let mut store = state.store.lock().map_err(|e| format!("lock: {}", e))?;

    match scope {
        PermissionScope::Session => {
            store.session.push(entry);
        }
        PermissionScope::Always => {
            store.always.push(entry);
            store.save(&app)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn permissions_revoke(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
    path: String,
) -> Result<(), String> {
    state.ensure_loaded(&app)?;
    let mut store = state.store.lock().map_err(|e| format!("lock: {}", e))?;

    store.always.retain(|e| e.path != path);
    store.session.retain(|e| e.path != path);
    store.save(&app)?;

    Ok(())
}

#[tauri::command]
pub fn permissions_list(
    app: AppHandle,
    state: tauri::State<'_, PermissionState>,
) -> Result<Vec<PermissionEntry>, String> {
    state.ensure_loaded(&app)?;
    let store = state.store.lock().map_err(|e| format!("lock: {}", e))?;

    let mut all = store.always.clone();
    all.extend(store.session.clone());
    Ok(all)
}

#[tauri::command]
pub fn permissions_clear_session(
    state: tauri::State<'_, PermissionState>,
) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| format!("lock: {}", e))?;
    store.session.clear();
    Ok(())
}