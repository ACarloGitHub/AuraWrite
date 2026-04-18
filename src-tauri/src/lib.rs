// lib.rs - Tauri commands for AuraWrite

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::State;

// Import modules
mod database;
mod embeddings;
use database::*;
use embeddings::*;

// State containing the database connection
pub struct AppState {
    db: Mutex<Connection>,
}

// ============================================================================
// PROJECT COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_project(state: State<AppState>, project: Project) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_project(&*conn, &project).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_projects(state: State<AppState>) -> Result<Vec<Project>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_projects(&*conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_project(state: State<AppState>, id: String) -> Result<Option<Project>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_project_by_id(&*conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_project(state: State<AppState>, project: Project) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    update_project(&*conn, &project).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_project(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::delete_embeddings_for_project(&*conn, &id).map_err(|e| e.to_string())?;
    delete_project(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// SECTION COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_section(state: State<AppState>, section: Section) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_section(&*conn, &section).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_sections(state: State<AppState>, project_id: String) -> Result<Vec<Section>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_sections_by_project(&*conn, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_section(state: State<AppState>, section: Section) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    update_section(&*conn, &section).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_section(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    let docs = get_documents_by_section(&*conn, &id).map_err(|e| e.to_string())?;
    for doc in &docs {
        embeddings::delete_embeddings_for_entity(&*conn, "document", &doc.id).map_err(|e| e.to_string())?;
    }
    delete_section(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// DOCUMENT COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_document(state: State<AppState>, document: Document) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_document(&*conn, &document).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_documents(state: State<AppState>, section_id: String) -> Result<Vec<Document>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_documents_by_section(&*conn, &section_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_document(state: State<AppState>, id: String) -> Result<Option<Document>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_document_by_id(&*conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_document(state: State<AppState>, document: Document) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    update_document(&*conn, &document).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_document(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::delete_embeddings_for_entity(&*conn, "document", &id).map_err(|e| e.to_string())?;
    delete_document(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// ENTITY COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_entity(state: State<AppState>, entity: Entity) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_entity(&*conn, &entity).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_entities(state: State<AppState>, project_id: String) -> Result<Vec<Entity>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_entities_by_project(&*conn, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_entity(state: State<AppState>, entity: Entity) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    update_entity(&*conn, &entity).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_entity(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    delete_entity(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// ENTITY TYPE COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_entity_type(state: State<AppState>, entity_type: EntityType) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_entity_type(&*conn, &entity_type).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_entity_types(state: State<AppState>, project_id: String) -> Result<Vec<EntityType>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_entity_types_by_project(&*conn, &project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_entity_type(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    delete_entity_type(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// DOCUMENT VERSION COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_document_version(state: State<AppState>, version: DocumentVersion) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_document_version(&*conn, &version).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_latest_version(state: State<AppState>, document_id: String) -> Result<Option<DocumentVersion>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_latest_version(&*conn, &document_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_versions(state: State<AppState>, document_id: String) -> Result<Vec<DocumentVersion>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_versions_by_document(&*conn, &document_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_cleanup_old_versions(state: State<AppState>, document_id: String, keep_count: i32) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    cleanup_old_versions(&*conn, &document_id, keep_count).map_err(|e| e.to_string())
}

// ============================================================================
// FILE COMMANDS (existing)
// ============================================================================

#[tauri::command]
fn save_document(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_document(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_binary_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64_encode(&bytes))
}

#[tauri::command]
fn save_binary_file(path: String, base64_content: String) -> Result<(), String> {
    let bytes = base64_decode(&base64_content).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits_collected = 0;

    for c in input.chars() {
        if c == '=' || c.is_ascii_whitespace() {
            continue;
        }
        let val = CHARSET
            .iter()
            .position(|&x| x as char == c)
            .ok_or_else(|| format!("Invalid base64 character: {}", c))? as u32;
        buffer = (buffer << 6) | val;
        bits_collected += 6;
        if bits_collected >= 8 {
            bits_collected -= 8;
            result.push((buffer >> bits_collected) as u8);
            buffer &= (1 << bits_collected) - 1;
        }
    }
    Ok(result)
}

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        result.push(CHARSET[b0 >> 2] as char);
        result.push(CHARSET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ============================================================================
// EMBEDDING COMMANDS
// ============================================================================

#[tauri::command]
async fn embedding_check_ollama() -> Result<bool, String> {
    embeddings::check_ollama_available().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn embedding_generate(text: String, is_query: Option<bool>) -> Result<Vec<f32>, String> {
    embeddings::generate_embedding(&text, is_query.unwrap_or(false)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn embedding_save_document(
    state: State<AppState>,
    project_id: String,
    document_id: String,
    content_text: String,
    chunk_size: i32,
    chunk_overlap: i32,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;

    // Delete existing embeddings for this document
    embeddings::delete_embeddings_for_entity(&*conn, "document", &document_id)
        .map_err(|e| e.to_string())?;

    // Chunk the content
    let chunks = embeddings::chunk_text(&content_text, chunk_size as usize, chunk_overlap as usize);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // Generate embeddings and save (blocking for now - could be async)
    // For now, we'll need to generate embeddings asynchronously from frontend
    // and save them individually

    // Save placeholders - actual embeddings will be added via embedding_save_chunk
    for (i, chunk) in chunks.iter().enumerate() {
        let embedding_id = embeddings::generate_embedding_id("document", &document_id, Some(i as i32));
        let embedding = embeddings::Embedding {
            id: embedding_id,
            project_id: project_id.clone(),
            entity_type: "document".to_string(),
            entity_id: document_id.clone(),
            chunk_index: Some(i as i32),
            content_text: chunk.clone(),
            created_at: now,
        };

        // Save with zero vector initially
        let zero_vector = vec![0.0f32; 768];
        embeddings::save_embedding(&*conn, &embedding, &zero_vector)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn embedding_save_chunk(
    state: State<AppState>,
    project_id: String,
    entity_type: String,
    entity_id: String,
    chunk_index: Option<i32>,
    content_text: String,
    embedding_vector: Vec<f32>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let embedding_id = embeddings::generate_embedding_id(&entity_type, &entity_id, chunk_index);
    let embedding = embeddings::Embedding {
        id: embedding_id,
        project_id,
        entity_type,
        entity_id,
        chunk_index,
        content_text,
        created_at: now,
    };

    embeddings::save_embedding(&*conn, &embedding, &embedding_vector)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn embedding_search(
    state: State<AppState>,
    project_id: String,
    query_vector: Vec<f32>,
    limit: i32,
) -> Result<Vec<embeddings::SearchResult>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::search_similar(&*conn, &project_id, &query_vector, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn embedding_search_documents(
    state: State<AppState>,
    project_id: String,
    query_vector: Vec<f32>,
    limit: i32,
) -> Result<Vec<embeddings::SearchResult>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::search_similar_documents(&*conn, &project_id, &query_vector, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn embedding_delete_for_entity(
    state: State<AppState>,
    entity_type: String,
    entity_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::delete_embeddings_for_entity(&*conn, &entity_type, &entity_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn embedding_delete_for_project(
    state: State<AppState>,
    project_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::delete_embeddings_for_project(&*conn, &project_id)
        .map_err(|e| e.to_string())
}

// ============================================================================
// APP SETUP
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize database connection
    let conn = init_database().expect("Failed to initialize database");

    // Initialize embeddings table
    embeddings::init_embeddings_table(&conn).expect("Failed to initialize embeddings table");

    let app_state = AppState {
        db: Mutex::new(conn),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // File commands
            save_document,
            load_document,
            load_binary_file,
            save_binary_file,
            get_app_version,
            // Project commands
            db_create_project,
            db_get_projects,
            db_get_project,
            db_update_project,
            db_delete_project,
            // Section commands
            db_create_section,
            db_get_sections,
            db_update_section,
            db_delete_section,
            // Document commands
            db_create_document,
            db_get_documents,
            db_get_document,
            db_update_document,
            db_delete_document,
            // Document version commands
            db_create_document_version,
            db_get_latest_version,
            db_get_versions,
            db_cleanup_old_versions,
            // Entity commands
            db_create_entity,
            db_get_entities,
            db_update_entity,
            db_delete_entity,
            // Entity type commands
            db_create_entity_type,
            db_get_entity_types,
            db_delete_entity_type,
            // Embedding commands
            embedding_check_ollama,
            embedding_generate,
            embedding_save_document,
            embedding_save_chunk,
            embedding_search,
            embedding_search_documents,
            embedding_delete_for_entity,
            embedding_delete_for_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
