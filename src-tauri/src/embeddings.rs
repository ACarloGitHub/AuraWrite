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

    let url = match base_url {
        Some(url) => format!("{}/api/embeddings", url.trim_end_matches('/')),
        None => "http://localhost:11434/api/embeddings".to_string(),
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

    if embedding.len() != DIM {
        return Err(format!(
            "Expected {} dimensions, got {}",
            DIM,
            embedding.len()
        ));
    }

    Ok(embedding)
}

pub async fn check_ollama_available(base_url: Option<&str>) -> Result<bool, String> {
    let client = reqwest::Client::new();

    let url = match base_url {
        Some(url) => format!("{}/api/tags", url.trim_end_matches('/')),
        None => "http://localhost:11434/api/tags".to_string(),
    };

    match client
        .get(&url)
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