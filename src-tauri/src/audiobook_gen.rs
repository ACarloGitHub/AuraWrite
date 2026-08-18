// Integration with the external app "Audiobook Generator".
//
// AuraWrite prepares an ebook and hands it over: it writes a small proposal
// file ("campanello") in Audiobook Generator's data dir, leaves a visit card
// pointing to AuraWrite's data dir, publishes the unified ebook catalog, and
// opens the external app. The external app confirms the proposal with the user
// (the handover contract is shared across the two projects).

use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Data dir of Audiobook Generator (the two apps share the same conventions).
const AUDIOBOOK_DATA_DIR: &str = "com.patata.audiobookgenerator";
/// Proposal file written by AuraWrite and consumed by Audiobook Generator.
const PROPOSAL_FILENAME: &str = "aurawrite-proposal.json";
/// Visit card left by AuraWrite so Audiobook Generator can find its data dir.
const VISIT_CARD_FILENAME: &str = "aurawrite-visit-card.json";
/// Unified ebook catalog published by AuraWrite (Editor + Reader).
const CATALOG_FILENAME: &str = "aurawrite-ebooks.json";
/// Manual override of the Audiobook Generator app path, chosen by the user
/// (installations in non-standard locations). Stored in AuraWrite's data dir.
const MANUAL_PATH_FILENAME: &str = "audiobook-generator-path.txt";

#[derive(Serialize)]
pub struct AudiobookGenInfo {
    pub found: bool,
    pub app_path: Option<String>,
    pub data_dir: String,
}

#[derive(Serialize)]
pub struct AudiobookExportResult {
    pub found: bool,
    pub opened: bool,
}

fn audiobook_data_dir() -> PathBuf {
    dirs::data_dir()
        .map(|d| d.join(AUDIOBOOK_DATA_DIR))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Well-known install locations of Audiobook Generator per platform.
fn candidate_app_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(
                Path::new(&local)
                    .join("Audiobook Generator")
                    .join("audiobook-generator.exe"),
            );
        }
        if let Some(prog) = std::env::var_os("ProgramFiles") {
            out.push(
                Path::new(&prog)
                    .join("Audiobook Generator")
                    .join("audiobook-generator.exe"),
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        out.push(PathBuf::from("/Applications/Audiobook Generator.app"));
    }
    #[cfg(target_os = "linux")]
    {
        out.push(PathBuf::from("/usr/lib/audiobook-generator/audiobook-generator"));
        out.push(PathBuf::from("/usr/bin/audiobook-generator"));
    }
    out
}

/// Read the user-chosen app path override, if present and still valid.
fn manual_app_path(app_data: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(app_data.join(MANUAL_PATH_FILENAME)).ok()?;
    let p = PathBuf::from(raw.trim());
    p.exists().then_some(p)
}

fn find_audiobook_generator(app_data: &Path) -> AudiobookGenInfo {
    let data_dir = audiobook_data_dir();
    // The user-chosen path wins over the standard install locations.
    if let Some(p) = manual_app_path(app_data) {
        return AudiobookGenInfo {
            found: true,
            app_path: Some(p.to_string_lossy().to_string()),
            data_dir: data_dir.to_string_lossy().to_string(),
        };
    }
    for p in candidate_app_paths() {
        if p.exists() {
            return AudiobookGenInfo {
                found: true,
                app_path: Some(p.to_string_lossy().to_string()),
                data_dir: data_dir.to_string_lossy().to_string(),
            };
        }
    }
    AudiobookGenInfo {
        found: false,
        app_path: None,
        data_dir: data_dir.to_string_lossy().to_string(),
    }
}

fn open_app(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    #[cfg(target_os = "macos")]
    {
        let _ = p;
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open audiobook generator: {e}"))?;
        return Ok(());
    }
    std::process::Command::new(p)
        .spawn()
        .map_err(|e| format!("launch audiobook generator: {e}"))?;
    Ok(())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir error: {e}"))
}

/// Report whether Audiobook Generator is installed and where its data lives.
#[tauri::command]
pub fn audiobook_generator_status(app: tauri::AppHandle) -> Result<AudiobookGenInfo, String> {
    Ok(find_audiobook_generator(&app_data_dir(&app)?))
}

/// Store (or clear) a manual app path chosen by the user. Pass an empty
/// string to remove the override.
#[tauri::command]
pub fn audiobook_generator_set_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    let target = dir.join(MANUAL_PATH_FILENAME);
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        let _ = fs::remove_file(&target);
        return Ok(false);
    }
    if !Path::new(&trimmed).exists() {
        return Err(format!("The chosen file does not exist: {trimmed}"));
    }
    fs::write(&target, &trimmed).map_err(|e| format!("save manual app path: {e}"))?;
    Ok(true)
}

/// Hand an ebook over to Audiobook Generator: write the proposal + visit card
/// + catalog, then open the external app. Returns `found: false` when the app
/// is not installed (the frontend shows the download info dialog).
#[tauri::command]
pub fn audiobook_generator_export(
    app: tauri::AppHandle,
    ebook_path: String,
) -> Result<AudiobookExportResult, String> {
    let info = find_audiobook_generator(&app_data_dir(&app)?);
    if !info.found {
        return Ok(AudiobookExportResult {
            found: false,
            opened: false,
        });
    }

    let data_dir = PathBuf::from(&info.data_dir);
    fs::create_dir_all(&data_dir).map_err(|e| format!("create audiobook data dir: {e}"))?;

    // Proposal ("campanello") for the external app to confirm with the user.
    let proposal = json!({ "input": ebook_path });
    fs::write(data_dir.join(PROPOSAL_FILENAME), proposal.to_string())
        .map_err(|e| format!("write proposal: {e}"))?;

    let _ = write_visit_card(&app);
    let _ = publish_ebook_catalog(&app);

    if let Some(app_path) = &info.app_path {
        open_app(app_path)?;
    }
    Ok(AudiobookExportResult {
        found: true,
        opened: info.app_path.is_some(),
    })
}

/// Leave a visit card in Audiobook Generator's data dir so it can find
/// AuraWrite's data dir and the unified ebook catalog.
fn write_visit_card(app: &tauri::AppHandle) -> Result<(), String> {
    let aw_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {e}"))?;
    let data_dir = audiobook_data_dir();
    let card = json!({
        "aurawrite_data_dir": aw_data.to_string_lossy(),
        "catalog": aw_data.join(CATALOG_FILENAME).to_string_lossy(),
    });
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    fs::write(data_dir.join(VISIT_CARD_FILENAME), card.to_string()).map_err(|e| e.to_string())
}

/// Publish the unified ebook catalog (Editor working folders + Reader files)
/// in AuraWrite's data dir, for Audiobook Generator to read in read-only mode.
fn publish_ebook_catalog(app: &tauri::AppHandle) -> Result<(), String> {
    let aw_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {e}"))?;
    let work_root = aw_data.join("ebook-work");

    let mut books: Vec<serde_json::Value> = Vec::new();

    // Editor: one entry per working folder.
    if let Ok(entries) = fs::read_dir(&work_root) {
        let mut folders: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        folders.sort();
        for f in folders {
            books.push(json!({
                "id": f,
                "name": f,
                "section": "editor",
                "path": work_root.join(&f).to_string_lossy(),
            }));
        }
    }

    // Reader: entries from reader-books.json (registered file paths).
    let reader_path = aw_data.join("reader-books.json");
    if let Ok(raw) = fs::read_to_string(&reader_path) {
        if let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
            for b in list {
                let id = b.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let path = b.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                books.push(json!({
                    "id": id,
                    "name": name,
                    "section": "reader",
                    "path": path,
                }));
            }
        }
    }

    let catalog = json!({ "books": books });
    fs::write(aw_data.join(CATALOG_FILENAME), catalog.to_string()).map_err(|e| e.to_string())
}
