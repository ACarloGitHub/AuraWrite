// Embeddings module for AuraWrite
// Simple vector storage without sqlite-vec extension
// Vectors stored as JSON, similarity computed in Rust
//
// TODO: Consider integrating Hugging Face GGUF models directly (e.g., nomic-embed-text-v1.5.Q8_0.gguf)
// This would remove the Ollama dependency for users who prefer standalone operation.
// Options to explore:
// - llama-cpp-2 Rust bindings (complex but zero external deps)
// - candle-transformers (pure Rust, good ecosystem support)
// - mistral.rs (supports quantized models, actively maintained)
// See: https://github.com/ggerganov/llama.cpp for reference implementation

use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Embedding {
    pub id: String,
    pub project_id: String,
    pub entity_type: String, // 'document', 'entity', 'chunk'
    pub entity_id: String,   // document_id or entity_id
    pub chunk_index: Option<i32>, // for document chunks
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
// INITIALIZATION
// ============================================================================

/// Initialize embeddings table (regular SQLite table, not virtual)
pub fn init_embeddings_table(conn: &Connection) -> SqliteResult<()> {
    // Create regular table for embeddings
    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS embeddings (
            embedding_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            chunk_index INTEGER,
            content_text TEXT NOT NULL,
            vector_json TEXT NOT NULL, -- JSON array of 768 f32 values
            created_at INTEGER NOT NULL
        )
        "#,
        [],
    )?;

    // Create indices for fast lookups
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings(project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_embeddings_entity_id ON embeddings(entity_id)",
        [],
    )?;

    Ok(())
}

// ============================================================================
// EMBEDDING GENERATION (via Ollama)
// ============================================================================

/// Generate embedding vector using Ollama's nomic-embed-text-v2-moe
/// Uses prefix "search_document: " for documents, "search_query: " for queries
pub async fn generate_embedding(text: &str, is_query: bool) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();

    // Add appropriate prefix for v2-moe model
    let prefixed_text = if is_query {
        format!("search_query: {}", text)
    } else {
        format!("search_document: {}", text)
    };

    let response = client
        .post("http://localhost:11434/api/embeddings")
        .json(&serde_json::json!({
            "model": "nomic-embed-text-v2-moe",
            "prompt": prefixed_text
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned error: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let embedding = json["embedding"]
        .as_array()
        .ok_or("Invalid embedding format from Ollama")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect::<Vec<f32>>();

    if embedding.len() != 768 {
        return Err(format!(
            "Expected 768 dimensions, got {}",
            embedding.len()
        ));
    }

    Ok(embedding)
}

/// Check if Ollama is available with nomic-embed-text-v2-moe
pub async fn check_ollama_available() -> Result<bool, String> {
    let client = reqwest::Client::new();

    match client
        .get("http://localhost:11434/api/tags")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                let json: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

                // Check if nomic-embed-text-v2-moe is available
                let empty_vec = vec![];
                let models = json["models"].as_array().unwrap_or(&empty_vec);
                let has_nomic = models.iter().any(|m| {
                    m["name"]
                        .as_str()
                        .map(|n| n.starts_with("nomic-embed-text-v2-moe"))
                        .unwrap_or(false)
                });

                Ok(has_nomic)
            } else {
                Ok(false)
            }
        }
        Err(_) => Ok(false),
    }
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/// Save embedding for a document, entity, or chunk
pub fn save_embedding(
    conn: &Connection,
    embedding: &Embedding,
    vector: &[f32],
) -> SqliteResult<()> {
    let vector_json = serde_json::to_string(vector).unwrap_or_default();

    conn.execute(
        r#"
        INSERT INTO embeddings (embedding_id, project_id, entity_type, entity_id, chunk_index, content_text, vector_json, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(embedding_id) DO UPDATE SET
            content_text = excluded.content_text,
            vector_json = excluded.vector_json,
            created_at = excluded.created_at
        "#,
        params![
            embedding.id,
            embedding.project_id,
            embedding.entity_type,
            embedding.entity_id,
            embedding.chunk_index,
            embedding.content_text,
            vector_json,
            embedding.created_at
        ],
    )?;

    Ok(())
}

/// Delete embeddings for an entity
pub fn delete_embeddings_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM embeddings WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;
    Ok(())
}

/// Delete all embeddings for a project
pub fn delete_embeddings_for_project(conn: &Connection, project_id: &str) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM embeddings WHERE project_id = ?1",
        params![project_id],
    )?;
    Ok(())
}

// ============================================================================
// SEARCH OPERATIONS
// ============================================================================

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() {
        return 0.0;
    }

    let mut dot_product = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;

    for i in 0..a.len() {
        dot_product += (a[i] as f64) * (b[i] as f64);
        norm_a += (a[i] as f64).powi(2);
        norm_b += (b[i] as f64).powi(2);
    }

    norm_a = norm_a.sqrt();
    norm_b = norm_b.sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a * norm_b)
}

/// Calculate cosine distance (1 - similarity)
fn cosine_distance(a: &[f32], b: &[f32]) -> f64 {
    1.0 - cosine_similarity(a, b)
}

/// Get all embeddings for a project
/// Returns Vec of (Embedding, vector_json) tuples
fn get_all_embeddings_for_project(
    conn: &Connection,
    project_id: &str,
) -> SqliteResult<Vec<(Embedding, String)>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            embedding_id,
            project_id,
            entity_type,
            entity_id,
            chunk_index,
            content_text,
            created_at,
            vector_json
        FROM embeddings
        WHERE project_id = ?1
        "#,
    )?;

    let embeddings = stmt.query_map(params![project_id], |row| {
        let embedding = Embedding {
            id: row.get(0)?,
            project_id: row.get(1)?,
            entity_type: row.get(2)?,
            entity_id: row.get(3)?,
            chunk_index: row.get(4)?,
            content_text: row.get(5)?,
            created_at: row.get(6)?,
        };
        let vector_json: String = row.get(7)?;
        Ok((embedding, vector_json))
    })?;

    embeddings.collect()
}

/// Search for similar content using cosine similarity
/// Returns results sorted by distance (ascending)
pub fn search_similar(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    let embeddings = get_all_embeddings_for_project(conn, project_id)?;

    let mut results: Vec<SearchResult> = embeddings
        .into_iter()
        .filter_map(|(emb, vector_json)| {
            let vector: Vec<f32> = serde_json::from_str(&vector_json).ok()?;
            let distance = cosine_distance(query_vector, &vector);
            Some(SearchResult {
                entity_type: emb.entity_type,
                entity_id: emb.entity_id,
                chunk_index: emb.chunk_index,
                content_text: emb.content_text,
                distance,
            })
        })
        .collect();

    // Sort by distance (ascending - closest first)
    results.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal));

    // Limit results
    results.truncate(limit as usize);

    Ok(results)
}

/// Search for similar documents only
pub fn search_similar_documents(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    let embeddings = get_all_embeddings_for_project(conn, project_id)?;

    let mut results: Vec<SearchResult> = embeddings
        .into_iter()
        .filter(|(emb, _)| emb.entity_type == "document")
        .filter_map(|(emb, vector_json)| {
            let vector: Vec<f32> = serde_json::from_str(&vector_json).ok()?;
            let distance = cosine_distance(query_vector, &vector);
            Some(SearchResult {
                entity_type: emb.entity_type,
                entity_id: emb.entity_id,
                chunk_index: emb.chunk_index,
                content_text: emb.content_text,
                distance,
            })
        })
        .collect();

    // Sort by distance
    results.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit as usize);

    Ok(results)
}

/// Search for similar entities (characters, locations, etc.)
pub fn search_similar_entities(
    conn: &Connection,
    project_id: &str,
    query_vector: &[f32],
    limit: i32,
) -> SqliteResult<Vec<SearchResult>> {
    let embeddings = get_all_embeddings_for_project(conn, project_id)?;

    let mut results: Vec<SearchResult> = embeddings
        .into_iter()
        .filter(|(emb, _)| emb.entity_type == "entity")
        .filter_map(|(emb, vector_json)| {
            let vector: Vec<f32> = serde_json::from_str(&vector_json).ok()?;
            let distance = cosine_distance(query_vector, &vector);
            Some(SearchResult {
                entity_type: emb.entity_type,
                entity_id: emb.entity_id,
                chunk_index: emb.chunk_index,
                content_text: emb.content_text,
                distance,
            })
        })
        .collect();

    // Sort by distance
    results.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit as usize);

    Ok(results)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Generate a unique embedding ID
pub fn generate_embedding_id(
    entity_type: &str,
    entity_id: &str,
    chunk_index: Option<i32>,
) -> String {
    match chunk_index {
        Some(idx) => format!("{}_{}_{}", entity_type, entity_id, idx),
        None => format!("{}_{}", entity_type, entity_id),
    }
}

/// Chunk text into smaller pieces for embedding
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

/// Get all embeddings for an entity
pub fn get_embeddings_for_entity(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> SqliteResult<Vec<Embedding>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            embedding_id,
            project_id,
            entity_type,
            entity_id,
            chunk_index,
            content_text,
            created_at
        FROM embeddings
        WHERE entity_type = ?1 AND entity_id = ?2
        ORDER BY chunk_index
        "#,
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

        assert_eq!(chunks.len(), 4);
        assert_eq!(chunks[0], "one two three");
        assert_eq!(chunks[1], "three four five");
        assert_eq!(chunks[2], "five six seven");
        assert_eq!(chunks[3], "seven eight nine ten");
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
    fn test_cosine_similarity() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![1.0f32, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        let c = vec![0.0f32, 1.0, 0.0];
        assert!((cosine_similarity(&a, &c) - 0.0).abs() < 0.001);
    }
}
