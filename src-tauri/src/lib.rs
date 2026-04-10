// lib.rs - Tauri commands for AuraWrite

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::State;

// Import database module
mod database;
use database::*;

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
// APP SETUP
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize database connection
    let conn = init_database().expect("Failed to initialize database");
    
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
            // Entity commands
            db_create_entity,
            db_get_entities,
            db_update_entity,
            db_delete_entity,
            // Entity type commands
            db_create_entity_type,
            db_get_entity_types,
            db_delete_entity_type,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
