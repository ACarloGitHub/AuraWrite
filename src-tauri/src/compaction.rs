// compaction.rs - AI compaction summary file management
//
// Phase 3 of chat compaction: saves/reads session summary MD files
// in <workspace>/sessions/. Each file has YAML front matter with
// session metadata and a Markdown body with the structured summary.

use std::fs;
use tauri::AppHandle;

use crate::workspace::workspace_path;

fn sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let ws = workspace_path(app)?;
    let dir = ws.join("sessions");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create sessions dir: {}", e))?;
    }
    Ok(dir)
}

fn sanitize_session_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
}

#[tauri::command]
pub fn compaction_save_summary(
    app: AppHandle,
    session_id: String,
    date: String,
    model: String,
    tokens_before: i64,
    tokens_after: i64,
    summary: String,
) -> Result<String, String> {
    let dir = sessions_dir(&app)?;
    let safe_id = sanitize_session_id(&session_id);
    let filename = format!("{}-{}.md", date, safe_id);
    let path = dir.join(&filename);

    if !path.starts_with(&dir) {
        return Err("Invalid session id: path traversal attempt".into());
    }

    let content = format!(
        "---\nsession: {}\ndate: {}\nmodel: {}\ntokens_before: {}\ntokens_after: {}\n---\n\n{}\n",
        session_id, date, model, tokens_before, tokens_after, summary
    );

    fs::write(&path, &content).map_err(|e| format!("write summary: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn compaction_read_latest_summary(app: AppHandle) -> Result<Option<String>, String> {
    let dir = sessions_dir(&app)?;
    if !dir.exists() {
        return Ok(None);
    }

    let mut entries: Vec<(String, String)> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read sessions dir: {}", e))? {
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.ends_with(".md") {
            let content =
                fs::read_to_string(entry.path()).map_err(|e| format!("read summary: {}", e))?;
            entries.push((fname, content));
        }
    }

    if entries.is_empty() {
        return Ok(None);
    }

    // Sort by filename (starts with date) descending — latest first
    entries.sort_by(|a, b| b.0.cmp(&a.0));

    // Parse the summary content from between the YAML front matter delimiters
    let latest = &entries[0].1;
    let body = if let Some(end_front) = latest.find("---\n\n") {
        &latest[end_front + 5..]
    } else if let Some(end_front) = latest.find("---\r\n\r\n") {
        &latest[end_front + 7..]
    } else {
        latest
    };

    Ok(Some(body.trim().to_string()))
}

#[tauri::command]
pub fn compaction_list_summaries(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = sessions_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut names: Vec<String> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read sessions dir: {}", e))? {
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if fname.ends_with(".md") {
            names.push(fname.trim_end_matches(".md").to_string());
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn compaction_delete_summary(app: AppHandle, name: String) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    let safe = sanitize_session_id(&name);
    let path = dir.join(format!("{}.md", safe));
    if !path.starts_with(&dir) {
        return Err("Invalid summary name: path traversal attempt".into());
    }
    if !path.exists() {
        return Err(format!("Summary not found: {}", name));
    }
    fs::remove_file(&path).map_err(|e| format!("delete summary: {}", e))?;
    Ok(())
}