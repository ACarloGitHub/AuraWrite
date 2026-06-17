// lib.rs - Tauri commands for AuraWrite

use std::sync::Mutex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WindowEvent};

// Import modules
mod database;
mod embeddings;
mod updates;
mod fonts;
mod resources;
mod vault_export;
use database::*;
use updates::*;
use fonts::*;
use resources::*;
use vault_export::*;

// State containing the database connection
pub struct AppState {
    db: Mutex<Connection>,
}

/// Kill all llama-server processes spawned by AuraWrite.
/// Called on app shutdown to free VRAM/RAM.
fn kill_llamacpp_processes() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "llama-server.exe", "/T"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "llama-server"])
            .output();
    }
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
    delete_links_for_project(&*conn, &id).map_err(|e| e.to_string())?;
    delete_project(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// USER STYLES COMMANDS
// ============================================================================

#[tauri::command]
fn db_list_user_styles(state: State<AppState>) -> Result<Vec<database::UserStyle>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    database::list_user_styles(&*conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_create_user_style(
    state: State<AppState>,
    style: database::UserStyle,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    database::create_user_style(&*conn, &style).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_user_style(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    database::delete_user_style(&*conn, &id).map_err(|e| e.to_string())
}

// ============================================================================
// SECTION COMMANDS
// ============================================================================

// ============================================================================
// TEMPLATE SYSTEM COMMANDS
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateDocumentSpec {
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateSectionSpec {
    pub name: String,
    pub children: Vec<TemplateSectionSpec>,
    pub tutorial: Option<TemplateDocumentSpec>,
    pub documents: Vec<TemplateDocumentSpec>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateEntityTypeFieldSpec {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub required: Option<bool>,
    pub enum_values: Option<Vec<String>>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateEntityTypeSpec {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub fields: Vec<TemplateEntityTypeFieldSpec>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateSpec {
    pub template_type: String,
    pub display_name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub sections: Vec<TemplateSectionSpec>,
    pub entity_types: Vec<TemplateEntityTypeSpec>,
    pub suggestions_prompt: Option<String>,
    pub chat_prompt: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn generate_id(prefix: &str) -> String {
    format!("{}-{}", prefix, uuid_v4_like())
}

fn uuid_v4_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}-{:x}", nanos, (nanos >> 16) as u64)
}

fn apply_template_section_recursive(
    conn: &Connection,
    project_id: &str,
    section_spec: &TemplateSectionSpec,
    parent_id: Option<&str>,
    now: i64,
) -> Result<String, String> {
    let section_id = generate_id("sec");
    let section = Section {
        id: section_id.clone(),
        project_id: project_id.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        name: section_spec.name.clone(),
        order_index: 0,
        bg_color: None,
        text_color: None,
        section_type: Some("chapter".to_string()),
        selected_style: None,
        created_at: now,
        updated_at: now,
    };
    create_section(conn, &section).map_err(|e| format!("create_section: {}", e))?;

    if let Some(tut) = &section_spec.tutorial {
        let doc = Document {
            id: generate_id("doc"),
            section_id: section_id.clone(),
            title: tut.title.clone(),
            content_json: document_to_prosemirror_json(tut.body.as_deref().unwrap_or("")),
            status: Some("draft".to_string()),
            word_count: 0,
            tags: None,
            order_index: 0,
            bg_color: None,
            text_color: None,
            recipe_entity_id: None,
            selected_style: None,
            created_at: now,
            updated_at: now,
        };
        create_document(conn, &doc).map_err(|e| format!("create_document: {}", e))?;
    }
    for (i, d) in section_spec.documents.iter().enumerate() {
        let mut doc = Document {
            id: generate_id("doc"),
            section_id: section_id.clone(),
            title: d.title.clone(),
            content_json: document_to_prosemirror_json(d.body.as_deref().unwrap_or("")),
            status: Some("draft".to_string()),
            word_count: 0,
            tags: None,
            order_index: i as i32,
            bg_color: None,
            text_color: None,
            recipe_entity_id: None,
            selected_style: None,
            created_at: now,
            updated_at: now,
        };
        // empty body documents keep empty content_json
        if d.body.as_ref().map_or(true, String::is_empty) {
            doc.content_json = String::new();
        }
        create_document(conn, &doc).map_err(|e| format!("create_document: {}", e))?;
    }

    for child in &section_spec.children {
        apply_template_section_recursive(conn, project_id, child, Some(&section_id), now)?;
    }

    Ok(section_id)
}

fn document_to_prosemirror_json(text: &str) -> String {
    // Wrap plain text in a ProseMirror doc. Empty string = empty doc.
    // The editor schema has `doc.content = "(page | block)+"`, so we MUST
    // wrap blocks in a `page` node, otherwise `nodeFromJSON` throws and the
    // catch in main.ts silently clears the editor (making the doc appear empty).
    if text.is_empty() {
        return String::new();
    }
    let paragraphs: Vec<String> = text
        .lines()
        .map(|line| {
            // Empty lines must produce an empty paragraph (no text node) —
            // ProseMirror throws "Empty text nodes are not allowed" otherwise.
            if line.is_empty() {
                return r#"{"type":"paragraph"}"#.to_string();
            }
            let escaped = line
                .replace("\\", "\\\\")
                .replace("\"", "\\\"");
            format!(r#"{{"type":"paragraph","content":[{{"type":"text","text":"{}"}}]}}"#, escaped)
        })
        .collect();
    let inner = paragraphs.join(",");
    format!(
        r#"{{"type":"doc","content":[{{"type":"page","attrs":{{"pageNumber":1}},"content":[{}]}}]}}"#,
        inner
    )
}

#[tauri::command]
fn apply_template(
    state: State<AppState>,
    project_id: String,
    template: TemplateSpec,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    let now = now_ms();

    // Wrap everything in a transaction. Either the whole template applies or nothing.
    conn.execute_batch("BEGIN").map_err(|e| format!("begin: {}", e))?;

    let result: Result<(), String> = (|| {
        // 1) Create entity types
        for et in &template.entity_types {
            let fields_json = serde_json::to_string(
                &et.fields.iter().map(|f| {
                    serde_json::json!({
                        "name": f.name,
                        "type": f.field_type,
                        "required": f.required.unwrap_or(false),
                        "enum_values": f.enum_values,
                        "note": f.note,
                    })
                }).collect::<Vec<_>>()
            ).map_err(|e| format!("entity_type fields json: {}", e))?;
            let entity_type = database::EntityType {
                id: generate_id("et"),
                project_id: project_id.clone(),
                name: et.name.clone(),
                icon: et.icon.clone(),
                color: et.color.clone(),
                fields_json: Some(fields_json),
                created_at: now,
            };
            create_entity_type(&conn, &entity_type)
                .map_err(|e| format!("create_entity_type: {}", e))?;
        }

        // 2) Create sections (recursively)
        for (i, section_spec) in template.sections.iter().enumerate() {
            apply_template_section_recursive(
                &conn,
                &project_id,
                section_spec,
                None,
                now,
            )?;
            // order_index of roots tracked via parent order: we use index i.
            let _ = i;
        }

        // 3) Store prompts on the project by re-reading + updating
        let project = get_project_by_id(&conn, &project_id)
            .map_err(|e| format!("get_project: {}", e))?
            .ok_or_else(|| "Project not found".to_string())?;
        let updated = database::Project {
            template_type: template.template_type.clone(),
            suggestions_prompt_override: None,
            chat_prompt_override: None,
            selected_style: None,
            ..project
        };
        update_project(&conn, &updated).map_err(|e| format!("update_project: {}", e))?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT").map_err(|e| format!("commit: {}", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

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
        delete_links_for_entity(&*conn, "document", &doc.id).map_err(|e| e.to_string())?;
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
    delete_links_for_entity(&*conn, "document", &id).map_err(|e| e.to_string())?;
    delete_document(&*conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_sections_order(state: State<AppState>, orders: Vec<(String, i32)>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    update_sections_order(&*conn, &orders, now).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_documents_order(state: State<AppState>, orders: Vec<(String, i32)>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    update_documents_order(&*conn, &orders, now).map_err(|e| e.to_string())
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
fn db_get_entity_by_id(state: State<AppState>, id: String) -> Result<Option<Entity>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_entity_by_id(&*conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_entity(state: State<AppState>, entity: Entity) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    update_entity(&*conn, &entity).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_entity(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    embeddings::delete_embeddings_for_entity(&*conn, "entity", &id).map_err(|e| e.to_string())?;
    delete_links_for_entity(&*conn, "entity", &id).map_err(|e| e.to_string())?;
    delete_entity(&*conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_cleanup_orphan_links(state: State<AppState>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    cleanup_orphan_links(&*conn).map_err(|e| e.to_string())
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
// LINK COMMANDS
// ============================================================================

#[tauri::command]
fn db_create_link(state: State<AppState>, link: Link) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    create_link(&*conn, &link).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_links_by_source(state: State<AppState>, source_type: String, source_id: String) -> Result<Vec<Link>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_links_by_source(&*conn, &source_type, &source_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_links_by_target(state: State<AppState>, target_type: String, target_id: String) -> Result<Vec<Link>, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    get_links_by_target(&*conn, &target_type, &target_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_links_by_source(state: State<AppState>, source_type: String, source_id: String) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    delete_links_by_source(&*conn, &source_type, &source_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_entity_index_status(state: State<AppState>, target_type: String, target_id: String) -> Result<IndexStatus, String> {
    let conn = state.db.lock().map_err(|_| "Database lock failed".to_string())?;
    match target_type.as_str() {
        "document" => get_entity_index_status_for_document(&*conn, &target_id).map_err(|e| e.to_string()),
        "section" => get_entity_index_status_for_section(&*conn, &target_id).map_err(|e| e.to_string()),
        "project" => get_entity_index_status_for_project(&*conn, &target_id).map_err(|e| e.to_string()),
        _ => Err("Invalid target_type. Use 'document', 'section', or 'project'.".to_string()),
    }
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
fn save_image_to_assets(
    app: tauri::AppHandle,
    filename: String,
    base64_content: String,
) -> Result<String, String> {
    let bytes = base64_decode(&base64_content).map_err(|e| e.to_string())?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let images_dir = app_data.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    let safe_name = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let final_name = format!("{}-{}", unique, safe_name);
    let dest = images_dir.join(&final_name);
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(format!("images/{}", final_name))
}

#[tauri::command]
fn read_image_asset(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    if relative_path.contains("..") {
        return Err("Invalid path".into());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let full = app_data.join(&relative_path);
    std::fs::read(&full).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_image_asset_path(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    if relative_path.contains("..") {
        return Err("Invalid path".into());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let full = app_data.join(&relative_path);
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
fn get_image_asset_url(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    if relative_path.contains("..") {
        return Err("Invalid path".into());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let full = app_data.join(&relative_path);
    let path_str = full.to_string_lossy().to_string();
    Ok(path_str)
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
async fn embedding_check_ollama(base_url: Option<String>) -> Result<bool, String> {
    embeddings::check_ollama_available(base_url.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn embedding_generate(text: String, is_query: Option<bool>, base_url: Option<String>) -> Result<Vec<f32>, String> {
    embeddings::generate_embedding(&text, is_query.unwrap_or(false), base_url.as_deref()).await.map_err(|e| e.to_string())
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

    // One-shot cleanup: remove orphan links left over from older versions
    // where deleting a document/section/project/entity did not cascade to the
    // `links` table. Idempotent and safe to run on every startup.
    match cleanup_orphan_links(&conn) {
        Ok(n) if n > 0 => println!("[Maintenance] Removed {} orphan link(s) from previous runs.", n),
        Ok(_) => {}
        Err(e) => eprintln!("[Maintenance] Orphan link cleanup failed: {}", e),
    }

    let app_state = AppState {
        db: Mutex::new(conn),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // File commands
            save_document,
            load_document,
            load_binary_file,
            save_binary_file,
            save_image_to_assets,
            read_image_asset,
            read_image_asset_path,
            get_image_asset_url,
            get_app_version,
            // Project commands
            db_create_project,
            db_get_projects,
            db_get_project,
            db_update_project,
            db_delete_project,
            // User styles commands
            db_list_user_styles,
            db_create_user_style,
            db_delete_user_style,
            // Template commands
            apply_template,
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
            db_update_sections_order,
            db_update_documents_order,
            // Document version commands
            db_create_document_version,
            db_get_latest_version,
            db_get_versions,
            db_cleanup_old_versions,
            // Entity commands
            db_create_entity,
            db_get_entities,
            db_get_entity_by_id,
            db_update_entity,
            db_delete_entity,
            // Entity type commands
            db_create_entity_type,
            db_get_entity_types,
            db_delete_entity_type,
            // Link commands
            db_create_link,
            db_get_links_by_source,
            db_get_links_by_target,
            db_delete_links_by_source,
            db_get_entity_index_status,
            // Maintenance (v0.4.2+)
            db_cleanup_orphan_links,
            // Embedding commands
            embedding_check_ollama,
            embedding_generate,
            embedding_save_document,
            embedding_save_chunk,
            embedding_search,
            embedding_search_documents,
            embedding_delete_for_entity,
            embedding_delete_for_project,
            // Update notification (v0.4.0+)
            check_for_updates,
            // Fonts (v0.4.0+)
            get_user_fonts_dir,
            list_user_fonts,
            // Resources (v0.7.0+ — local embeddings: llama.cpp + nomic GGUF)
            resources_get_status,
            resources_verify_nomic,
            resources_nomic_sha256,
            resources_download_llamacpp,
            resources_download_llamacpp_variant,
            resources_llamacpp_variant,
            resources_llamacpp_embeddings_variant,
            resources_download_nomic,
            resources_remove_all,
            resources_remove_llamacpp_ai,
            resources_remove_llamacpp_embeddings,
            ollama_check,
            ollama_pull_model,
            ollama_pull_nomic,
            embeddings_check_provider,
            // Hardware detection (M8.1)
            resources_detect_hardware,
            // Chat model management (M8.3)
            resources_download_chat_model,
            resources_list_chat_models,
            resources_remove_chat_model,
            resources_register_local_model,
            resources_verify_model,
            resources_detect_mmproj,
            // Llama server lifecycle (M8.6)
            llamacpp_spawn_server,
            llamacpp_stop_server,
            llamacpp_server_status,
            // Llama embeddings server lifecycle
            llamacpp_spawn_embeddings_server,
            llamacpp_stop_embeddings_server,
            llamacpp_embeddings_server_status,
            // Vault export (D1 — Obsidian export)
            vault_create_dir,
            vault_check_path,
            vault_write_file,
            vault_write_file_bytes,
            vault_copy_file,
        ])
        .on_window_event(|_window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                kill_llamacpp_processes();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
