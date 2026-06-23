// data_privacy.rs - Data & Privacy commands for AuraWrite AI agent
//
// Provides visibility and control over AI-stored data:
// - Count items (chat sessions, RAG entities, wiki pages, plans)
// - Delete by category or all at once
// - Single entity RAG deletion (tool for AI)
//
// These commands power the Data & Privacy section in the MCP panel
// and the Agent tab in Preferences.

use std::fs;
use tauri::AppHandle;
use serde::Serialize;
use rusqlite;
use crate::AppState;
use crate::workspace::workspace_path;

fn collect_rowids(conn: &rusqlite::Connection, sql: &str, params: &[&dyn rusqlite::types::ToSql]) -> Result<Vec<i64>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| format!("Prepare failed: {}", e))?;
    let rows = stmt.query_map(params, |row| row.get(0)).map_err(|e| format!("Query failed: {}", e))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn collect_rowids_owned(conn: &rusqlite::Connection, sql: &str) -> Result<Vec<i64>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| format!("Prepare failed: {}", e))?;
    let rows = stmt.query_map([], |row| row.get(0)).map_err(|e| format!("Query failed: {}", e))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ============================================================================
// Stats structs
// ============================================================================

#[derive(Debug, Serialize)]
pub struct DataStats {
    pub chat_sessions: usize,
    pub chat_messages: usize,
    pub rag_entities: usize,
    pub rag_chunks: usize,
    pub wiki_pages: usize,
    pub plans: usize,
}

#[derive(Debug, Serialize)]
pub struct ChatStats {
    pub total_sessions: usize,
    pub total_messages: usize,
}

#[derive(Debug, Serialize)]
pub struct RagStats {
    pub total_entities: usize,
    pub total_chunks: usize,
}

// ============================================================================
// Stats commands
// ============================================================================

#[tauri::command]
pub fn data_stats(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<DataStats, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let chat_messages: usize = conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);

    let chat_sessions: usize = conn
        .query_row("SELECT COUNT(DISTINCT session_id) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);

    let rag_entities: usize = conn
        .query_row("SELECT COUNT(DISTINCT entity_type || '_' || entity_id) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);

    let rag_chunks: usize = conn
        .query_row("SELECT COUNT(*) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);

    drop(conn);

    let ws = workspace_path(&app)?;
    let memory_dir = ws.join("memory");
    let plans_dir = ws.join("plans");

    let wiki_pages = if memory_dir.exists() {
        fs::read_dir(&memory_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
            .unwrap_or(0)
    } else {
        0
    };

    let plans = if plans_dir.exists() {
        fs::read_dir(&plans_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
            .unwrap_or(0)
    } else {
        0
    };

    Ok(DataStats {
        chat_sessions,
        chat_messages,
        rag_entities,
        rag_chunks,
        wiki_pages,
        plans,
    })
}

#[tauri::command]
pub fn chat_stats(state: tauri::State<'_, AppState>) -> Result<ChatStats, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let total_messages: usize = conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);

    let total_sessions: usize = conn
        .query_row("SELECT COUNT(DISTINCT session_id) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(ChatStats {
        total_sessions,
        total_messages,
    })
}

#[tauri::command]
pub fn rag_stats(state: tauri::State<'_, AppState>) -> Result<RagStats, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let total_entities: usize = conn
        .query_row("SELECT COUNT(DISTINCT entity_type || '_' || entity_id) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);

    let total_chunks: usize = conn
        .query_row("SELECT COUNT(*) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(RagStats {
        total_entities,
        total_chunks,
    })
}

#[tauri::command]
pub fn wiki_stats(app: AppHandle) -> Result<usize, String> {
    let ws = workspace_path(&app)?;
    let memory_dir = ws.join("memory");
    if !memory_dir.exists() {
        return Ok(0);
    }
    fs::read_dir(&memory_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
        .map_err(|e| format!("Failed to read memory dir: {}", e))
}

#[tauri::command]
pub fn plan_stats(app: AppHandle) -> Result<usize, String> {
    let ws = workspace_path(&app)?;
    let plans_dir = ws.join("plans");
    if !plans_dir.exists() {
        return Ok(0);
    }
    fs::read_dir(&plans_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
        .map_err(|e| format!("Failed to read plans dir: {}", e))
}

// ============================================================================
// Reset commands (delete all)
// ============================================================================

#[tauri::command]
pub fn chat_reset_all(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let msg_count: usize = conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);

    conn.execute("DELETE FROM chat_messages", [])
        .map_err(|e| format!("Failed to delete chat messages: {}", e))?;

    Ok(format!("Deleted {} chat messages.", msg_count))
}

#[tauri::command]
pub fn rag_reset_all(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let chunk_count: usize = conn
        .query_row("SELECT COUNT(*) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);

    // Get all rowids from metadata table first (needed for vec0 deletion)
    let rowids = collect_rowids_owned(&conn, "SELECT rowid FROM embedding_metadata")?;

    // Delete from vec_embeddings by rowid
    for rowid in &rowids {
        let _ = conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?", [rowid]);
    }

    conn.execute("DELETE FROM embedding_metadata", [])
        .map_err(|e| format!("Failed to delete embedding metadata: {}", e))?;

    Ok(format!("Deleted {} RAG chunks ({} entities).", chunk_count, rowids.len()))
}

#[tauri::command]
pub fn rag_reset_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    let chunk_count: usize = conn
        .query_row("SELECT COUNT(*) FROM embedding_metadata WHERE project_id = ?", [&project_id], |row| row.get(0))
        .unwrap_or(0);

    // Get rowids for this project
    let rowids = collect_rowids(&conn, "SELECT rowid FROM embedding_metadata WHERE project_id = ?", &[&project_id as &dyn rusqlite::types::ToSql])?;

    // Delete from vec_embeddings by rowid
    for rowid in &rowids {
        let _ = conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?", [rowid]);
    }

    conn.execute("DELETE FROM embedding_metadata WHERE project_id = ?", [&project_id])
        .map_err(|e| format!("Failed to delete project embeddings: {}", e))?;

    Ok(format!("Deleted {} RAG chunks for project {}.", chunk_count, project_id))
}

#[tauri::command]
pub fn rag_delete(
    project_id: String,
    entity_type: String,
    entity_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;

    // Find rowids for this entity
    let rowids = collect_rowids(&conn, "SELECT rowid FROM embedding_metadata WHERE project_id = ? AND entity_type = ? AND entity_id = ?", &[&project_id as &dyn rusqlite::types::ToSql, &entity_type as &dyn rusqlite::types::ToSql, &entity_id as &dyn rusqlite::types::ToSql])?;

    if rowids.is_empty() {
        return Ok(format!("[INSTRUCTION: Tell the user no RAG data was found for this entity.]No RAG data found for entity '{}/{}' in project {}.", entity_type, entity_id, project_id));
    }

    // Delete from vec_embeddings
    for rowid in &rowids {
        let _ = conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?", [rowid]);
    }

    // Delete from metadata
    conn.execute("DELETE FROM embedding_metadata WHERE project_id = ? AND entity_type = ? AND entity_id = ?", [&project_id, &entity_type, &entity_id])
        .map_err(|e| format!("Failed to delete entity embeddings: {}", e))?;

    Ok(format!("[INSTRUCTION: Tell the user the entity was deleted from RAG.]Deleted {} chunks for entity '{}/{}' in project {}.", rowids.len(), entity_type, entity_id, project_id))
}

#[tauri::command]
pub fn wiki_reset_all(app: AppHandle) -> Result<String, String> {
    let ws = workspace_path(&app)?;
    let memory_dir = ws.join("memory");

    if !memory_dir.exists() {
        return Ok("No wiki pages to delete.".to_string());
    }

    let count = fs::read_dir(&memory_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
        .unwrap_or(0);

    // Delete all .md files in memory dir (but keep subdirs and their contents)
    let entries = fs::read_dir(&memory_dir)
        .map_err(|e| format!("Failed to read memory dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "md") {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
        }
    }

    // Also clean subdirectories (wiki_ingest creates subdirs)
    if memory_dir.exists() {
        let entries = fs::read_dir(&memory_dir)
            .map_err(|e| format!("Failed to read memory dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }

    Ok(format!("Deleted {} wiki pages.", count))
}

#[tauri::command]
pub fn plan_reset_all(app: AppHandle) -> Result<String, String> {
    let ws = workspace_path(&app)?;
    let plans_dir = ws.join("plans");

    if !plans_dir.exists() {
        return Ok("No plans to delete.".to_string());
    }

    let count = fs::read_dir(&plans_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter(|e| e.path().extension().map_or(false, |ext| ext == "md")).count())
        .unwrap_or(0);

    // Delete all .md files in plans dir
    let entries = fs::read_dir(&plans_dir)
        .map_err(|e| format!("Failed to read plans dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "md") {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
        }
    }

    Ok(format!("Deleted {} plans.", count))
}

#[tauri::command]
pub fn data_reset_all(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<String, String> {
    // Delete all chat messages
    let conn = state.db.lock().map_err(|e| format!("Database lock failed: {}", e))?;
    let msg_count: usize = conn
        .query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
        .unwrap_or(0);
    conn.execute("DELETE FROM chat_messages", [])
        .map_err(|e| format!("Failed to delete chat messages: {}", e))?;

    // Delete all chat embeddings
    let chat_emb_count: usize = conn
        .query_row("SELECT COUNT(*) FROM chat_message_metadata", [], |row| row.get(0))
        .unwrap_or(0);
    let chat_rowids = collect_rowids_owned(&conn, "SELECT rowid FROM chat_message_metadata")?;
    for rowid in &chat_rowids {
        let _ = conn.execute("DELETE FROM vec_chat_embeddings WHERE rowid = ?", [rowid]);
    }
    conn.execute("DELETE FROM chat_message_metadata", [])
        .map_err(|e| format!("Failed to delete chat message metadata: {}", e))?;

    // Delete all RAG embeddings
    let rag_count: usize = conn
        .query_row("SELECT COUNT(*) FROM embedding_metadata", [], |row| row.get(0))
        .unwrap_or(0);
    let rag_rowids = collect_rowids_owned(&conn, "SELECT rowid FROM embedding_metadata")?;
    for rowid in &rag_rowids {
        let _ = conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?", [rowid]);
    }
    conn.execute("DELETE FROM embedding_metadata", [])
        .map_err(|e| format!("Failed to delete embedding metadata: {}", e))?;

    drop(conn);

    // Delete all wiki pages
    let ws = workspace_path(&app)?;
    let memory_dir = ws.join("memory");
    let mut wiki_count = 0;
    if memory_dir.exists() {
        let entries = fs::read_dir(&memory_dir)
            .map_err(|e| format!("Failed to read memory dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                wiki_count += 1;
                let _ = fs::remove_file(&path);
            } else if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }

    // Delete all plans
    let plans_dir = ws.join("plans");
    let mut plan_count = 0;
    if plans_dir.exists() {
        let entries = fs::read_dir(&plans_dir)
            .map_err(|e| format!("Failed to read plans dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                plan_count += 1;
                let _ = fs::remove_file(&path);
            }
        }
    }

    Ok(format!(
        "All AI data deleted: {} chat messages, {} chat embeddings, {} RAG chunks, {} wiki pages, {} plans.",
        msg_count, chat_emb_count, rag_count, wiki_count, plan_count
    ))
}