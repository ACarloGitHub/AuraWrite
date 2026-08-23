use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;

const DIM: usize = 768;

pub fn register_vec_extension() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    }
}

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 4) }.to_vec()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Embedding {
    pub id: String,
    pub project_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub chunk_index: Option<i32>,
    pub content_text: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub chunk_index: Option<i32>,
    pub content_text: String,
    pub distance: f64,
}

// ============================================================================
// CHAT MESSAGE EMBEDDINGS (Phase 2 of chat compaction)
// ============================================================================
//
// We use a separate vec0 table for chat messages rather than mixing them
// into `vec_embeddings` for two reasons:
// 1. The existing `vec_embeddings` is partitioned by `project_id`, but
//    chat messages have no project (sessions span projects).
// 2. Chat messages have very different metadata needs (session_id, role,
//    timestamp) than documents/entities, and sqlite-vec columns are
//    fixed at CREATE TABLE time.

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessageEmbedding {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub message_timestamp: i64,
    pub content_text: String,
    pub project_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSearchResult {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub message_timestamp: i64,
    pub content_text: String,
    pub project_id: Option<String>,
    pub distance: f64,
}

pub fn init_embeddings_table(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
            embedding float[768],
            project_id TEXT PARTITION KEY,
            entity_type TEXT,
            entity_id TEXT,
            +content_text TEXT,
            +chunk_index INTEGER
        );",
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS embedding_metadata (
            rowid INTEGER PRIMARY KEY,
            embedding_id TEXT UNIQUE NOT NULL,
            project_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            chunk_index INTEGER,
            content_text TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_emb_meta_project ON embedding_metadata(project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_emb_meta_entity ON embedding_metadata(entity_type, entity_id)",
        [],
    )?;

    Ok(())
}

pub async fn generate_embedding(
    text: &str,
    is_query: bool,
    base_url: Option<&str>,
) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();

    // The built-in llama.cpp embeddings server speaks the OpenAI dialect
    // (/v1/embeddings). Verified empirically on pinned build b9680 (P0 test,
    // 2026-08-23): Ollama-style /api/* routes return 404.
    let url = match base_url {
        Some(url) => format!("{}/v1/embeddings", url.trim_end_matches('/')),
        None => format!(
            "http://127.0.0.1:{}/v1/embeddings",
            crate::resources::EMBEDDINGS_PORT_DEFAULT
        ),
    };

    let prefixed_text = if is_query {
        format!("search_query: {}", text)
    } else {
        format!("search_document: {}", text)
    };

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "model": "nomic-embed-text-v2-moe",
            "input": prefixed_text
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to local embedding service: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Embedding service returned error: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

    let embedding = json["data"][0]["embedding"]
        .as_array()
        .ok_or("Invalid embedding format from embedding service")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect::<Vec<f32>>();

    if embedding.len() != DIM {
        return Err(format!(
            "Expected {} dimensions, got {}",
            DIM,
            embedding.len()
        ));
    }

    Ok(embedding)
}

/// Health probe for the local embeddings service: our dedicated port answers
/// /health when the llama.cpp server is up. No model-name check needed — we
/// decide which model to serve at spawn time.
pub async fn check_embeddings_available(base_url: Option<&str>) -> Result<bool, String> {
    let client = reqwest::Client::new();

    let url = match base_url {
        Some(url) => format!("{}/health", url.trim_end_matches('/')),
        None => format!(
            "http://127.0.0.1:{}/health",
            crate::resources::EMBEDDINGS_PORT_DEFAULT
        ),
    };

    match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

pub fn save_embedding(
    conn: &Connection,
    embedding: &Embedding,
    vector: &[f32],
) -> SqliteResult<()> {
    if vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            vector.len()
        )));
    }

    // Delete existing row if this embedding_id already exists
    let existing_rowid: Option<i64> = conn
        .query_row(
            "SELECT rowid FROM embedding_metadata WHERE embedding_id = ?1",
            params![embedding.id],
            |row| row.get(0),
        )
        .ok();

    if let Some(rowid) = existing_rowid {
        // Delete from vec_embeddings first (can't use OR REPLACE on vec0)
        conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?1", params![rowid])?;
        // Delete old metadata row
        conn.execute("DELETE FROM embedding_metadata WHERE rowid = ?1", params![rowid])?;
    }

    // Insert metadata row first (gets auto rowid)
    conn.execute(
        "INSERT INTO embedding_metadata (embedding_id, project_id, entity_type, entity_id, chunk_index, content_text, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![embedding.id, embedding.project_id, embedding.entity_type, embedding.entity_id, embedding.chunk_index, embedding.content_text, embedding.created_at],
    )?;

    let rowid = conn.last_insert_rowid();

    // Insert into vec0 with the same rowid
    let blob = vec_to_blob(vector);
    conn.execute(
        "INSERT INTO vec_embeddings(rowid, embedding, project_id, entity_type, entity_id, content_text, chunk_index) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![rowid, blob, embedding.project_id, embedding.entity_type, embedding.entity_id, embedding.content_text, embedding.chunk_index],
    )?;

    Ok(())
}

pub fn delete_embeddings_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> SqliteResult<()> {
    let rowids: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT rowid FROM embedding_metadata WHERE entity_type = ?1 AND entity_id = ?2",
        )?;
        let rows = stmt.query_map(params![entity_type, entity_id], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for rowid in &rowids {
        conn.execute("DELETE FROM vec_embeddings WHERE rowid = ?1", params![rowid])?;
    }

    conn.execute(
        "DELETE FROM embedding_metadata WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;

    Ok(())
}

pub fn delete_embeddings_for_project(conn: &Connection, project_id: &str) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM vec_embeddings WHERE project_id = ?1",
        params![project_id],
    )?;

    conn.execute(
        "DELETE FROM embedding_metadata WHERE project_id = ?1",
        params![project_id],
    )?;

    Ok(())
}

pub fn search_similar(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    if query_vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            query_vector.len()
        )));
    }

    let blob = vec_to_blob(query_vector);

    let mut stmt = conn.prepare(
        "SELECT v.distance, m.entity_type, m.entity_id, m.chunk_index, m.content_text
         FROM vec_embeddings v
         JOIN embedding_metadata m ON v.rowid = m.rowid
         WHERE v.embedding MATCH ?1 AND v.project_id = ?2
         ORDER BY v.distance
         LIMIT ?3",
    )?;

    let results = stmt
        .query_map(params![blob, project_id, limit], |row| {
            let l2_distance: f32 = row.get(0)?;
            let cosine_distance = 1.0 - (1.0 - (l2_distance * l2_distance) / 2.0).max(0.0);
            Ok(SearchResult {
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content_text: row.get(4)?,
                distance: cosine_distance as f64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

pub fn search_similar_documents(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    if query_vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            query_vector.len()
        )));
    }

    let blob = vec_to_blob(query_vector);

    let mut stmt = conn.prepare(
        "SELECT v.distance, m.entity_type, m.entity_id, m.chunk_index, m.content_text
         FROM vec_embeddings v
         JOIN embedding_metadata m ON v.rowid = m.rowid
         WHERE v.embedding MATCH ?1 AND v.project_id = ?2 AND v.entity_type = 'document'
         ORDER BY v.distance
         LIMIT ?3",
    )?;

    let results = stmt
        .query_map(params![blob, project_id, limit], |row| {
            let l2_distance: f32 = row.get(0)?;
            let cosine_distance = 1.0 - (1.0 - (l2_distance * l2_distance) / 2.0).max(0.0);
            Ok(SearchResult {
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content_text: row.get(4)?,
                distance: cosine_distance as f64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

pub fn search_similar_entities(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    if query_vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            query_vector.len()
        )));
    }

    let blob = vec_to_blob(query_vector);

    let mut stmt = conn.prepare(
        "SELECT v.distance, m.entity_type, m.entity_id, m.chunk_index, m.content_text
         FROM vec_embeddings v
         JOIN embedding_metadata m ON v.rowid = m.rowid
         WHERE v.embedding MATCH ?1 AND v.project_id = ?2 AND v.entity_type = 'entity'
         ORDER BY v.distance
         LIMIT ?3",
    )?;

    let results = stmt
        .query_map(params![blob, project_id, limit], |row| {
            let l2_distance: f32 = row.get(0)?;
            let cosine_distance = 1.0 - (1.0 - (l2_distance * l2_distance) / 2.0).max(0.0);
            Ok(SearchResult {
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                chunk_index: row.get(3)?,
                content_text: row.get(4)?,
                distance: cosine_distance as f64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

pub fn generate_embedding_id(entity_type: &str, entity_id: &str, chunk_index: Option<i32>) -> String {
    match chunk_index {
        Some(idx) => format!("{}_{}_{}", entity_type, entity_id, idx),
        None => format!("{}_{}", entity_type, entity_id),
    }
}

// ============================================================================
// CHAT MESSAGE EMBEDDINGS — table init + CRUD (Phase 2)
// ============================================================================

pub fn init_chat_embeddings_table(conn: &Connection) -> SqliteResult<()> {
    // sqlite-vec 0.1.9 KNN queries require a PARTITION KEY filter in the
    // WHERE clause. We use a constant `is_chat` partition (always '1')
    // so both per-session and cross-session queries can satisfy the
    // constraint without us needing to scan a specific partition.
    // Real scoping (per session / cross-session / by role) happens via
    // JOIN against the chat_message_metadata regular table.
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_chat_embeddings USING vec0(
            embedding float[768],
            is_chat TEXT PARTITION KEY,
            +session_id TEXT,
            +role TEXT,
            +message_timestamp INTEGER,
            +message_id TEXT,
            +content_text TEXT
        );",
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_message_metadata (
            rowid INTEGER PRIMARY KEY,
            message_id TEXT UNIQUE NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            message_timestamp INTEGER NOT NULL,
            content_text TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )?;

    // Migration M_CHAT_2: add project_id column to chat_message_metadata
    // so the Phase 2 RAG search can scope results to a single project.
    // Must run BEFORE the CREATE INDEX on project_id below, otherwise
    // fresh databases fail with "no such column: project_id".
    // Idempotent: the column may already exist on databases that went
    // through this init after the migration was added.
    let has_project_id: bool = conn
        .prepare("SELECT project_id FROM chat_message_metadata LIMIT 1")
        .map(|mut stmt| stmt.query([]).is_ok())
        .unwrap_or(false);
    if !has_project_id {
        conn.execute_batch("ALTER TABLE chat_message_metadata ADD COLUMN project_id TEXT;")?;
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_emb_session
         ON chat_message_metadata(session_id, message_timestamp)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_emb_role
         ON chat_message_metadata(role)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_emb_project
         ON chat_message_metadata(project_id)",
        [],
    )?;

    Ok(())
}

pub fn save_chat_message_embedding(
    conn: &Connection,
    embedding: &ChatMessageEmbedding,
    vector: &[f32],
) -> SqliteResult<()> {
    if vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            vector.len()
        )));
    }

    // Delete existing row if this message_id already has an embedding
    // (e.g. retry after Ollama went down and came back up).
    let existing_rowid: Option<i64> = conn
        .query_row(
            "SELECT rowid FROM chat_message_metadata WHERE message_id = ?1",
            params![embedding.message_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(rowid) = existing_rowid {
        conn.execute(
            "DELETE FROM vec_chat_embeddings WHERE rowid = ?1",
            params![rowid],
        )?;
        conn.execute(
            "DELETE FROM chat_message_metadata WHERE rowid = ?1",
            params![rowid],
        )?;
    }

    conn.execute(
        "INSERT INTO chat_message_metadata
            (message_id, session_id, role, message_timestamp, content_text, project_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            embedding.message_id,
            embedding.session_id,
            embedding.role,
            embedding.message_timestamp,
            embedding.content_text,
            embedding.project_id,
            embedding.created_at,
        ],
    )?;

    let rowid = conn.last_insert_rowid();
    let blob = vec_to_blob(vector);

    conn.execute(
        "INSERT INTO vec_chat_embeddings
            (rowid, embedding, is_chat, session_id, role, message_timestamp, message_id, content_text)
         VALUES (?1, ?2, '1', ?3, ?4, ?5, ?6, ?7)",
        params![
            rowid,
            blob,
            embedding.session_id,
            embedding.role,
            embedding.message_timestamp,
            embedding.message_id,
            embedding.content_text,
        ],
    )?;

    Ok(())
}

/// Search chat messages by embedding similarity, scoped to one session,
/// optionally narrowed further by project_id.
///
/// Implementation note: sqlite-vec 0.1.9 KNN queries do NOT work with a
/// JOIN against the metadata table (the extension fails the KNN parse
/// with "A LIMIT or 'k = ?' constraint is required"). So we run two
/// passes: first a pure KNN query that returns `(rowid, distance)`,
/// then a regular SQL lookup against `chat_message_metadata` for those
/// rowids. We also need a literal LIMIT in the KNN query (params don't
/// count), so we hardcode a generous cap and truncate in Rust.
pub fn search_similar_chat_messages(
    conn: &Connection,
    session_id: &str,
    project_id: Option<&str>,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<ChatSearchResult>> {
    if query_vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            query_vector.len()
        )));
    }

    let blob = vec_to_blob(query_vector);
    let candidates = knn_candidates_chat(conn, &blob)?;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = lookup_chat_metadata(conn, &candidates)?;
    results.retain(|r| r.session_id == session_id);
    if let Some(pid) = project_id {
        results.retain(|r| r.project_id.as_deref() == Some(pid));
    }
    results.truncate(limit.max(0) as usize);
    Ok(results)
}

/// Cross-session search: runs one KNN query (no session filter on the
/// virtual table — sqlite-vec doesn't allow it without a JOIN) and then
/// filters/dedups by session_ids and project_id in Rust. Caller passes
/// the session ids to consider (typically the N most recent sessions).
pub fn search_similar_chat_messages_cross_session(
    conn: &Connection,
    session_ids: &[String],
    project_id: Option<&str>,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<ChatSearchResult>> {
    if query_vector.len() != DIM {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "Expected {} dimensions, got {}",
            DIM,
            query_vector.len()
        )));
    }

    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    let blob = vec_to_blob(query_vector);
    let candidates = knn_candidates_chat(conn, &blob)?;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let allowed: std::collections::HashSet<&str> =
        session_ids.iter().map(|s| s.as_str()).collect();

    let mut results = lookup_chat_metadata(conn, &candidates)?;
    results.retain(|r| allowed.contains(r.session_id.as_str()));
    if let Some(pid) = project_id {
        results.retain(|r| r.project_id.as_deref() == Some(pid));
    }
    results.truncate(limit.max(0) as usize);
    Ok(results)
}

/// Run the KNN query against the virtual table and return `(rowid, distance)`
/// pairs. The query has a hardcoded LIMIT of 4096 candidates (the maximum
/// sqlite-vec 0.1.9 allows in a single KNN query), then
/// `lookup_chat_metadata` fetches the full metadata for those rowids.
///
/// # Performance limit
///
/// sqlite-vec 0.1.9 caps the KNN `k` at 4096 (raises
/// "k value in knn query too large, provided N and the limit is 4096"
/// otherwise). 4096 candidates comfortably covers chat datasets up to
/// ~10k messages total — beyond the per-year envelope documented in the
/// chat-compaction plan (50-200 messages per session, 50-250 MB per year).
///
/// When the dataset grows past ~10k messages and the project_id filter
/// starts to drop too many candidates (because the project's messages
/// don't all fit in the top 4096), the options are:
///   a) split `vec_chat_embeddings` into per-project vec0 tables
///      (each becomes a small focused index)
///   b) move to a dedicated vector store (Qdrant, chroma, etc.)
///   c) wait for sqlite-vec to ship native JOIN support
///      (upstream issues #96, #143, #116 are all still open as of
///       2026-06 — when closed, this entire workaround can be deleted)
///
/// This trade-off is also tracked in `AuraWrite-Wiki/concepts/todo-list.md`
/// under "Cose rimandate" so it does not get lost across sessions.
fn knn_candidates_chat(
    conn: &Connection,
    query_blob: &[u8],
) -> SqliteResult<Vec<(i64, f32)>> {
    let mut stmt = conn.prepare(
        "SELECT rowid, distance FROM vec_chat_embeddings
         WHERE embedding MATCH ?1 AND is_chat = '1'
         ORDER BY distance
         LIMIT 4096",
    )?;

    let rows = stmt
        .query_map(params![query_blob], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f32>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Fetch the metadata rows for a list of `(rowid, distance)` pairs and
/// produce the final `ChatSearchResult` list, sorted by distance.
fn lookup_chat_metadata(
    conn: &Connection,
    candidates: &[(i64, f32)],
) -> SqliteResult<Vec<ChatSearchResult>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = std::iter::repeat("?")
        .take(candidates.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT rowid, message_id, session_id, role, message_timestamp, content_text, project_id
         FROM chat_message_metadata
         WHERE rowid IN ({})",
        placeholders
    );

    let rowid_params: Vec<i64> = candidates.iter().map(|(r, _)| *r).collect();
    let params_iter: Vec<&dyn rusqlite::ToSql> =
        rowid_params.iter().map(|r| r as &dyn rusqlite::ToSql).collect();

    let mut stmt = conn.prepare(&sql)?;
    let meta_rows = stmt
        .query_map(params_iter.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let distance_by_rowid: std::collections::HashMap<i64, f32> =
        candidates.iter().map(|(r, d)| (*r, *d)).collect();

    let mut results: Vec<ChatSearchResult> = meta_rows
        .into_iter()
        .filter_map(
            |(rowid, message_id, session_id, role, message_timestamp, content_text, project_id)| {
                distance_by_rowid.get(&rowid).map(|&l2| {
                    let cosine_distance = 1.0 - (1.0 - (l2 * l2) / 2.0).max(0.0);
                    ChatSearchResult {
                        message_id,
                        session_id,
                        role,
                        message_timestamp,
                        content_text,
                        project_id,
                        distance: cosine_distance as f64,
                    }
                })
            },
        )
        .collect();

    results.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(results)
}

pub fn delete_chat_message_embedding(conn: &Connection, message_id: &str) -> SqliteResult<()> {
    let rowid: Option<i64> = conn
        .query_row(
            "SELECT rowid FROM chat_message_metadata WHERE message_id = ?1",
            params![message_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(rowid) = rowid {
        conn.execute(
            "DELETE FROM vec_chat_embeddings WHERE rowid = ?1",
            params![rowid],
        )?;
        conn.execute(
            "DELETE FROM chat_message_metadata WHERE rowid = ?1",
            params![rowid],
        )?;
    }
    Ok(())
}

pub fn delete_chat_embeddings_for_session(
    conn: &Connection,
    session_id: &str,
) -> SqliteResult<usize> {
    let rowids: Vec<i64> = conn
        .prepare("SELECT rowid FROM chat_message_metadata WHERE session_id = ?1")?
        .query_map(params![session_id], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    for rowid in &rowids {
        conn.execute(
            "DELETE FROM vec_chat_embeddings WHERE rowid = ?1",
            params![rowid],
        )?;
    }

    let n = conn.execute(
        "DELETE FROM chat_message_metadata WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(n)
}

pub fn count_chat_message_embeddings(conn: &Connection) -> SqliteResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM chat_message_metadata",
        [],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod chat_tests {
    use super::*;

    fn make_vector(seed: usize) -> Vec<f32> {
        (0..DIM).map(|i| ((i + seed) % 17) as f32 / 17.0).collect()
    }

    fn open_with_chat_tables() -> Connection {
        // Make sure the vec0 extension is registered globally for this test
        // binary. Idempotent — safe to call from every test.
        register_vec_extension();
        let conn = Connection::open_in_memory().unwrap();
        init_chat_embeddings_table(&conn).unwrap();
        conn
    }

    fn sample_emb(message_id: &str, session_id: &str, role: &str, ts: i64, text: &str) -> ChatMessageEmbedding {
        ChatMessageEmbedding {
            message_id: message_id.to_string(),
            session_id: session_id.to_string(),
            role: role.to_string(),
            message_timestamp: ts,
            content_text: text.to_string(),
            project_id: None,
            created_at: ts,
        }
    }

    fn sample_emb_in_project(
        message_id: &str,
        session_id: &str,
        role: &str,
        ts: i64,
        text: &str,
        project_id: &str,
    ) -> ChatMessageEmbedding {
        ChatMessageEmbedding {
            message_id: message_id.to_string(),
            session_id: session_id.to_string(),
            role: role.to_string(),
            message_timestamp: ts,
            content_text: text.to_string(),
            project_id: Some(project_id.to_string()),
            created_at: ts,
        }
    }

    #[test]
    fn test_save_chat_embedding_basic() {
        let conn = open_with_chat_tables();
        let emb = sample_emb("m1", "s1", "user", 1000, "hello");
        save_chat_message_embedding(&conn, &emb, &make_vector(1)).unwrap();
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 1);
    }

    #[test]
    fn test_save_chat_embedding_upserts_on_message_id() {
        let conn = open_with_chat_tables();
        let emb = sample_emb("m1", "s1", "user", 1000, "hello");
        save_chat_message_embedding(&conn, &emb, &make_vector(1)).unwrap();

        // Re-save same message_id with different content + vector
        let emb2 = sample_emb("m1", "s1", "user", 1000, "hello updated");
        save_chat_message_embedding(&conn, &emb2, &make_vector(2)).unwrap();

        // Still only 1 row (upsert, not duplicate)
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 1);
    }

    #[test]
    fn test_save_chat_embedding_rejects_wrong_dim() {
        let conn = open_with_chat_tables();
        let emb = sample_emb("m1", "s1", "user", 1000, "hello");
        let err = save_chat_message_embedding(&conn, &emb, &vec![0.0; 100]).unwrap_err();
        assert!(matches!(err, rusqlite::Error::InvalidParameterName(_)));
    }

    #[test]
    fn test_search_similar_chat_messages_finds_same_session() {
        let conn = open_with_chat_tables();
        // Three messages in session s1, one in s2
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha bravo charlie"),
            &make_vector(1),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m2", "s1", "assistant", 2000, "delta echo foxtrot"),
            &make_vector(2),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m3", "s1", "user", 3000, "golf hotel india"),
            &make_vector(3),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m4", "s2", "user", 4000, "juliett kilo lima"),
            &make_vector(4),
        ).unwrap();

        // Search inside s1 with vector identical to m2 → m2 should rank first
        let results = search_similar_chat_messages(&conn, "s1", None, &make_vector(2), 10).unwrap();
        assert_eq!(results.len(), 3); // only s1 messages
        assert_eq!(results[0].message_id, "m2");
        // None of the results should come from s2
        assert!(results.iter().all(|r| r.session_id == "s1"));
    }

    #[test]
    fn test_search_similar_chat_messages_cross_session() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha"),
            &make_vector(1),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m2", "s2", "user", 2000, "bravo"),
            &make_vector(2),
        ).unwrap();

        let sessions = vec!["s1".to_string(), "s2".to_string()];
        let results = search_similar_chat_messages_cross_session(
            &conn,
            &sessions,
            None,
            &make_vector(2),
            10,
        )
        .unwrap();
        assert_eq!(results.len(), 2);
        // Sorted by distance: m2 (vector seed=2 matches query seed=2) first
        assert_eq!(results[0].message_id, "m2");
        assert_eq!(results[1].message_id, "m1");
    }

    #[test]
    fn test_search_similar_chat_messages_cross_session_with_unknown_id() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha"),
            &make_vector(1),
        ).unwrap();

        // An unknown session id is just skipped — never an error.
        let sessions = vec!["does-not-exist".to_string()];
        let results = search_similar_chat_messages_cross_session(
            &conn,
            &sessions,
            None,
            &make_vector(1),
            10,
        )
        .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_similar_chat_messages_respects_limit() {
        let conn = open_with_chat_tables();
        for i in 0..10 {
            save_chat_message_embedding(
                &conn,
                &sample_emb(&format!("m{i}"), "s1", "user", 1000 + i as i64, &format!("text {i}")),
                &make_vector(i),
            ).unwrap();
        }

        let results = search_similar_chat_messages(&conn, "s1", None, &make_vector(0), 3).unwrap();
        assert_eq!(results.len(), 3);
        // Each result must be from s1
        assert!(results.iter().all(|r| r.session_id == "s1"));
    }

    #[test]
    fn test_delete_chat_message_embedding() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha"),
            &make_vector(1),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m2", "s1", "assistant", 2000, "bravo"),
            &make_vector(2),
        ).unwrap();
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 2);

        delete_chat_message_embedding(&conn, "m1").unwrap();
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 1);
    }

    #[test]
    fn test_delete_chat_embeddings_for_session() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha"),
            &make_vector(1),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m2", "s1", "assistant", 2000, "bravo"),
            &make_vector(2),
        ).unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m3", "s2", "user", 3000, "charlie"),
            &make_vector(3),
        ).unwrap();

        let n = delete_chat_embeddings_for_session(&conn, "s1").unwrap();
        assert_eq!(n, 2);
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 1);
    }

    #[test]
    fn test_delete_nonexistent_message_is_noop() {
        let conn = open_with_chat_tables();
        delete_chat_message_embedding(&conn, "does-not-exist").unwrap();
        assert_eq!(count_chat_message_embeddings(&conn).unwrap(), 0);
    }

    /// The project_id filter must drop messages from other projects even
    /// when they would otherwise rank highly. Two messages, same session,
    /// different projects. Search for one project's vector and assert
    /// that only that project's message comes back.
    #[test]
    fn test_search_similar_chat_messages_filters_by_project() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m1", "s1", "user", 1000, "alpha", "projA"),
            &make_vector(1),
        )
        .unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m2", "s1", "user", 2000, "bravo", "projB"),
            &make_vector(2),
        )
        .unwrap();

        // Without filter: both come back
        let all = search_similar_chat_messages(&conn, "s1", None, &make_vector(1), 10).unwrap();
        assert_eq!(all.len(), 2);

        // Filtered to projA: only m1
        let a = search_similar_chat_messages(&conn, "s1", Some("projA"), &make_vector(1), 10).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].message_id, "m1");
        assert_eq!(a[0].project_id.as_deref(), Some("projA"));

        // Filtered to projB: only m2
        let b = search_similar_chat_messages(&conn, "s1", Some("projB"), &make_vector(2), 10).unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].message_id, "m2");
        assert_eq!(b[0].project_id.as_deref(), Some("projB"));

        // Filtered to a non-existent project: empty
        let none =
            search_similar_chat_messages(&conn, "s1", Some("projZ"), &make_vector(1), 10).unwrap();
        assert!(none.is_empty());
    }

    /// Cross-session variant: same filter applies after merging multiple
    /// sessions. Two projects, two sessions, four messages. The filter
    /// must keep only messages from the requested project.
    #[test]
    fn test_search_similar_chat_messages_cross_session_filters_by_project() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m1", "s1", "user", 1000, "alpha", "projA"),
            &make_vector(1),
        )
        .unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m2", "s1", "user", 2000, "bravo", "projB"),
            &make_vector(2),
        )
        .unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m3", "s2", "user", 3000, "charlie", "projA"),
            &make_vector(3),
        )
        .unwrap();
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("m4", "s2", "user", 4000, "delta", "projB"),
            &make_vector(4),
        )
        .unwrap();

        let sessions = vec!["s1".to_string(), "s2".to_string()];

        let a = search_similar_chat_messages_cross_session(
            &conn,
            &sessions,
            Some("projA"),
            &make_vector(1),
            10,
        )
        .unwrap();
        assert_eq!(a.len(), 2);
        assert!(a.iter().all(|r| r.project_id.as_deref() == Some("projA")));
        let a_ids: std::collections::HashSet<&str> =
            a.iter().map(|r| r.message_id.as_str()).collect();
        assert!(a_ids.contains("m1"));
        assert!(a_ids.contains("m3"));

        let b = search_similar_chat_messages_cross_session(
            &conn,
            &sessions,
            Some("projB"),
            &make_vector(2),
            10,
        )
        .unwrap();
        assert_eq!(b.len(), 2);
        assert!(b.iter().all(|r| r.project_id.as_deref() == Some("projB")));
    }

    /// Regression guard for the KNN cap raise (1k → 10k): even when
    /// the project owns only a tiny fraction of the dataset, the search
    /// must find its messages because the 10k candidate pool is large
    /// enough to include them.
    #[test]
    fn test_search_finds_tiny_project_under_knn_cap() {
        let conn = open_with_chat_tables();

        // 1000 "noise" messages in projX, all using a wildly different
        // vector so the KNN should rank them poorly. 1 message in
        // projTarget with the exact query vector.
        for i in 0..1000 {
            let seed = 100 + i;
            save_chat_message_embedding(
                &conn,
                &sample_emb_in_project(
                    &format!("noise{i}"),
                    "s1",
                    "user",
                    1000 + i as i64,
                    "filler",
                    "projX",
                ),
                &make_vector(seed),
            )
            .unwrap();
        }
        // Save the target message LAST so its rowid is highest.
        save_chat_message_embedding(
            &conn,
            &sample_emb_in_project("target", "s1", "user", 9000, "the one we want", "projTarget"),
            &make_vector(0),
        )
        .unwrap();

        // Query with vector seed=0, filtered to projTarget. The 10k cap
        // must be large enough to include our target even when projX has
        // 1000 candidates that would otherwise dominate.
        let results = search_similar_chat_messages(
            &conn,
            "s1",
            Some("projTarget"),
            &make_vector(0),
            5,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message_id, "target");
    }

    /// Diagnostic: KNN with hardcoded LIMIT + no JOIN works. Used as a
/// regression guard for the sqlite-vec 0.1.9 quirk where JOIN against
/// a regular table breaks KNN parsing.
#[test]
fn test_diagnostic_vec0_knn_minimal() {
        let conn = open_with_chat_tables();
        save_chat_message_embedding(
            &conn,
            &sample_emb("m1", "s1", "user", 1000, "alpha"),
            &make_vector(1),
        )
        .unwrap();

        let blob = vec_to_blob(&make_vector(1));
        let result: Result<Vec<f32>, _> = conn
            .prepare(
                "SELECT distance FROM vec_chat_embeddings
                 WHERE embedding MATCH ?1 AND is_chat = '1'
                 ORDER BY distance LIMIT 3",
            )
            .unwrap()
            .query_map(params![blob], |row| row.get(0))
            .unwrap()
            .collect();
        println!("minimal KNN result: {:?}", result);
        result.unwrap();
    }
}

pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut chunks = Vec::new();
    let step = chunk_size - overlap;

    let mut i = 0;
    while i < words.len() {
        let end = (i + chunk_size).min(words.len());
        let chunk = words[i..end].join(" ");
        chunks.push(chunk);
        i += step;
        if end >= words.len() {
            break;
        }
    }

    chunks
}

pub fn get_embeddings_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> SqliteResult<Vec<Embedding>> {
    let mut stmt = conn.prepare(
        "SELECT embedding_id, project_id, entity_type, entity_id, chunk_index, content_text, created_at
         FROM embedding_metadata
         WHERE entity_type = ?1 AND entity_id = ?2
         ORDER BY chunk_index",
    )?;

    let embeddings = stmt.query_map(params![entity_type, entity_id], |row| {
        Ok(Embedding {
            id: row.get(0)?,
            project_id: row.get(1)?,
            entity_type: row.get(2)?,
            entity_id: row.get(3)?,
            chunk_index: row.get(4)?,
            content_text: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    embeddings.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_text() {
        let text = "one two three four five six seven eight nine ten";
        let chunks = chunk_text(text, 3, 1);

        assert_eq!(chunks.len(), 5);
        assert_eq!(chunks[0], "one two three");
        assert_eq!(chunks[1], "three four five");
        assert_eq!(chunks[2], "five six seven");
        assert_eq!(chunks[3], "seven eight nine");
        assert_eq!(chunks[4], "nine ten");
    }

    #[test]
    fn test_generate_embedding_id() {
        assert_eq!(
            generate_embedding_id("document", "doc123", None),
            "document_doc123"
        );
        assert_eq!(
            generate_embedding_id("document", "doc123", Some(0)),
            "document_doc123_0"
        );
    }

    #[test]
    fn test_vec_to_blob_roundtrip() {
        let original: Vec<f32> = (0..768).map(|i| i as f32 / 768.0).collect();
        let blob = vec_to_blob(&original);
        assert_eq!(blob.len(), 768 * 4);

        let reconstructed: Vec<f32> = blob
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        for i in 0..768 {
            assert!((original[i] - reconstructed[i]).abs() < f32::EPSILON);
        }
    }

    #[test]
    fn test_cosine_distance_from_l2() {
        // On unit vectors: cosine_distance = 1 - (1 - L2^2/2) = L2^2/2
        // L2([1,0,0], [0,1,0]) = sqrt(2) ≈ 1.414
        // cosine_distance should be 1.0
        let l2: f32 = 1.4142135;
        let cosine_distance = 1.0 - (1.0 - (l2 * l2) / 2.0).max(0.0);
        assert!((cosine_distance - 1.0).abs() < 0.01);

        // L2([1,0,0], [1,0,0]) = 0 → cosine_distance = 0
        let l2_self: f32 = 0.0;
        let cos_self = 1.0 - (1.0 - (l2_self * l2_self) / 2.0).max(0.0);
        assert!(cos_self.abs() < 0.001);
    }
}