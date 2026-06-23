// rag_tools.rs - RAG tools (native MCP)
//
// Wraps existing embedding functions for agent use:
//   rag_add    — generate embedding, save to sqlite-vec
//   rag_search — search by similarity
//   rag_list   — list indexed entities for a project
//
// Results follow the Tool Result Injection pattern:
// [INSTRUCTION: ...] prefix tells the AI how to handle the result.

use tauri::State;

use crate::AppState;
use crate::embeddings;

const MAX_RAG_RESULT_CHARS: usize = 500;

#[tauri::command]
pub async fn rag_add(
    state: State<'_, AppState>,
    project_id: String,
    entity_type: String,
    entity_id: String,
    content_text: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let embedding_vector = embeddings::generate_embedding(&content_text, true, base_url.as_deref())
        .await
        .map_err(|e| format!("generate embedding: {}", e))?;

    let chunks = embeddings::chunk_text(&content_text, 500, 50);
    let chunk_count = chunks.len();

    if chunk_count == 0 {
        return Ok("[INSTRUCTION: Tell the user the content was empty and nothing was indexed.] No chunks to index — the content appears to be empty.".to_string());
    }

    if chunk_count == 1 {
        let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let embedding_id = embeddings::generate_embedding_id(&entity_type, &entity_id, Some(0));
        let embedding = embeddings::Embedding {
            id: embedding_id,
            project_id: project_id.clone(),
            entity_type: entity_type.clone(),
            entity_id: entity_id.clone(),
            chunk_index: Some(0),
            content_text: chunks[0].clone(),
            created_at: now,
        };
        embeddings::save_embedding(&*conn, &embedding, &embedding_vector)
            .map_err(|e| format!("save embedding: {}", e))?;
        drop(conn);
        return Ok(format!(
            "[INSTRUCTION: Confirm briefly that the content was indexed.] Indexed 1 chunk for {} '{}'.",
            entity_type, entity_id
        ));
    }

    let mut count = 0u32;
    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_embedding = embeddings::generate_embedding(chunk, true, base_url.as_deref())
            .await
            .map_err(|e| format!("generate chunk embedding {}: {}", i, e))?;

        let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let embedding_id = embeddings::generate_embedding_id(&entity_type, &entity_id, Some(i as i32));
        let embedding = embeddings::Embedding {
            id: embedding_id,
            project_id: project_id.clone(),
            entity_type: entity_type.clone(),
            entity_id: entity_id.clone(),
            chunk_index: Some(i as i32),
            content_text: chunk.clone(),
            created_at: now,
        };
        embeddings::save_embedding(&*conn, &embedding, &chunk_embedding)
            .map_err(|e| format!("save embedding {}: {}", i, e))?;
        drop(conn);
        count += 1;
    }

    Ok(format!(
        "[INSTRUCTION: Confirm briefly that the content was indexed.] Indexed {} chunk(s) for {} '{}'.",
        count, entity_type, entity_id
    ))
}

#[tauri::command]
pub async fn rag_search(
    state: State<'_, AppState>,
    project_id: String,
    query: String,
    limit: Option<i32>,
    base_url: Option<String>,
) -> Result<String, String> {
    let max = limit.unwrap_or(10).min(50);

    let query_vector = embeddings::generate_embedding(&query, true, base_url.as_deref())
        .await
        .map_err(|e| format!("generate query embedding: {}", e))?;

    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;

    let results = embeddings::search_similar(&*conn, &project_id, &query_vector, max)
        .map_err(|e| format!("search similar: {}", e))?;

    drop(conn);

    if results.is_empty() {
        return Ok("[INSTRUCTION: Tell the user that no relevant content was found in the knowledge base. Suggest adding content with rag_add first.] No results found in the knowledge base for this query.".to_string());
    }

    let mut lines = vec![
        format!("[INSTRUCTION: Summarize the most relevant findings from the knowledge base. Do NOT repeat all chunks verbatim — pick the 2-3 most relevant and describe them in your own words.]"),
        format!("Found {} result(s) for \"{}\" (sorted by relevance):", results.len(), query),
    ];

    for (i, r) in results.iter().enumerate() {
        let snippet = {
            let s = r.content_text.chars().take(MAX_RAG_RESULT_CHARS).collect::<String>();
            if r.content_text.len() > MAX_RAG_RESULT_CHARS {
                format!("{}...", s)
            } else {
                s
            }
        };
        lines.push(format!("{}. [{}] {} (distance: {:.3}): {}", i + 1, r.entity_type, r.entity_id, r.distance, snippet));
    }

    Ok(lines.join("\n"))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct RagListEntry {
    pub entity_type: String,
    pub entity_id: String,
    pub chunk_count: i64,
    pub total_chars: i64,
}

#[tauri::command]
pub fn rag_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;

    let sql = r#"
        SELECT entity_type, entity_id,
               COUNT(*) as chunk_count,
               SUM(LENGTH(content_text)) as total_chars
        FROM embeddings
        WHERE project_id = ?
        GROUP BY entity_type, entity_id
        ORDER BY entity_type, entity_id
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| format!("prepare: {}", e))?;
    let entries = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(RagListEntry {
                entity_type: row.get(0)?,
                entity_id: row.get(1)?,
                chunk_count: row.get(2)?,
                total_chars: row.get(3)?,
            })
        })
        .map_err(|e| format!("query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {}", e))?;

    if entries.is_empty() {
        return Ok("[INSTRUCTION: Tell the user that the knowledge base is empty for this project. Suggest adding content with rag_add.] No indexed entities found for this project.".to_string());
    }

    let mut lines = vec![
        "[INSTRUCTION: List the indexed entities briefly.]".to_string(),
        format!("Indexed entities for project ({} entries):", entries.len()),
    ];

    for e in &entries {
        lines.push(format!("- [{}] {} ({} chunks, {} chars)", e.entity_type, e.entity_id, e.chunk_count, e.total_chars));
    }

    Ok(lines.join("\n"))
}