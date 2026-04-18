// Database module for AuraWrite
// SQLite schema and operations

use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub project_type: String,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Section {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub order_index: i32,
    pub color: Option<String>,
    pub section_type: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub section_id: String,
    pub title: String,
    pub content_json: String,
    pub status: Option<String>,
    pub word_count: i32,
    pub tags: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Entity {
    pub id: String,
    pub project_id: String,
    pub entity_type_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub image_path: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntityType {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub fields_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocumentVersion {
    pub id: String,
    pub document_id: String,
    pub version_number: i32,
    pub backup_path: String,
    pub content_json: Option<String>,
    pub word_count: Option<i32>,
    pub note: Option<String>,
    pub size_bytes: Option<i32>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Link {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
    pub link_type: String,
    pub context_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndexStatus {
    pub status: String,
    pub entity_count: i64,
    pub last_indexed: Option<i64>,
    pub target_updated_at: Option<i64>,
}

/// Get the database path for AuraWrite
pub fn get_database_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aurawrite");

    // Ensure directory exists
    let _ = std::fs::create_dir_all(&config_dir);

    config_dir.join("aurawrite.db")
}

/// Initialize database with schema
pub fn init_database() -> SqliteResult<Connection> {
    let db_path = get_database_path();
    let conn = Connection::open(&db_path)?;

    // Enable foreign keys
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    // Create schema
    conn.execute_batch(&get_schema())?;

    Ok(conn)
}

/// Get the full schema SQL
fn get_schema() -> String {
    r#"
    -- ============================================================================
    -- AURAWRITE DATABASE SCHEMA
    -- ============================================================================

    -- Projects
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'novel',
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Entity types per project (user-definable)
    CREATE TABLE IF NOT EXISTS entity_types (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        fields_json TEXT,
        created_at INTEGER NOT NULL
    );

    -- Sections (hierarchical: book → parts → chapters)
    CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        section_type TEXT DEFAULT 'chapter',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Documents (the actual content)
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        word_count INTEGER DEFAULT 0,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Entities (characters, locations, etc.)
    CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type_id TEXT REFERENCES entity_types(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        image_path TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Bidirectional links (document ↔ entity, entity ↔ entity)
    CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('document', 'entity')),
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('document', 'entity')),
        target_id TEXT NOT NULL,
        link_type TEXT DEFAULT 'mention',
        context_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(source_type, source_id, target_type, target_id)
    );

    -- Versions (incremental save)
    CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        backup_path TEXT NOT NULL,
        content_json TEXT,
        word_count INTEGER,
        note TEXT,
        size_bytes INTEGER,
        created_at INTEGER NOT NULL
    );

    -- Timeline/Events
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        event_date INTEGER,
        duration_minutes INTEGER,
        entities_involved TEXT,
        created_at INTEGER NOT NULL
    );

    -- Board/Kanban
    CREATE TABLE IF NOT EXISTS board_items (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        status_column TEXT NOT NULL,
        order_index INTEGER NOT NULL
    );

    -- Global tags
    CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT
    );

    -- Tag-Document links
    CREATE TABLE IF NOT EXISTS document_tags (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
    );

    -- Search index (full-text)
    CREATE TABLE IF NOT EXISTS search_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        content_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Attachments
    CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_type TEXT,
        size_bytes INTEGER,
        created_at INTEGER NOT NULL
    );

    -- Project settings
    CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (project_id, key)
    );

    -- Publishing metadata
    CREATE TABLE IF NOT EXISTS publishing_metadata (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (project_id, key)
    );

    -- ============================================================================
    -- INDICES
    -- ============================================================================
    CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);
    CREATE INDEX IF NOT EXISTS idx_sections_parent ON sections(parent_id);
    CREATE INDEX IF NOT EXISTS idx_documents_section ON documents(section_id);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type_id);
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_versions_document ON versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_versions_created ON versions(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
    CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);
    CREATE INDEX IF NOT EXISTS idx_search_entity ON search_index(entity_type, entity_id);
    "#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_database() {
        // Use in-memory database for testing
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&get_schema()).unwrap();

        // Verify tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"sections".to_string()));
        assert!(tables.contains(&"documents".to_string()));
        assert!(tables.contains(&"entities".to_string()));
    }
}

// ============================================================================
// CRUD OPERATIONS - PROJECTS
// ============================================================================

pub fn create_project(conn: &Connection, project: &Project) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO projects (id, name, type, description, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            project.id,
            project.name,
            project.project_type,
            project.description,
            project.created_at,
            project.updated_at
        ],
    )?;
    Ok(())
}

pub fn get_projects(conn: &Connection) -> SqliteResult<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, type, description, created_at, updated_at FROM projects ORDER BY updated_at DESC"
    )?;

    let projects = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            project_type: row.get(2)?,
            description: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;

    projects.collect()
}

pub fn get_project_by_id(conn: &Connection, id: &str) -> SqliteResult<Option<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, type, description, created_at, updated_at FROM projects WHERE id = ?1",
    )?;

    let mut rows = stmt.query(params![id])?;

    if let Some(row) = rows.next()? {
        Ok(Some(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            project_type: row.get(2)?,
            description: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn update_project(conn: &Connection, project: &Project) -> SqliteResult<()> {
    conn.execute(
        "UPDATE projects SET name = ?1, type = ?2, description = ?3, updated_at = ?4 WHERE id = ?5",
        params![
            project.name,
            project.project_type,
            project.description,
            project.updated_at,
            project.id
        ],
    )?;
    Ok(())
}

pub fn delete_project(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - SECTIONS
// ============================================================================

pub fn create_section(conn: &Connection, section: &Section) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO sections (id, project_id, parent_id, name, order_index, color, section_type, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            section.id,
            section.project_id,
            section.parent_id,
            section.name,
            section.order_index,
            section.color,
            section.section_type,
            section.created_at,
            section.updated_at
        ],
    )?;
    Ok(())
}

pub fn get_sections_by_project(conn: &Connection, project_id: &str) -> SqliteResult<Vec<Section>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, parent_id, name, order_index, color, section_type, created_at, updated_at 
         FROM sections WHERE project_id = ?1 ORDER BY order_index, created_at"
    )?;

    let sections = stmt.query_map(params![project_id], |row| {
        Ok(Section {
            id: row.get(0)?,
            project_id: row.get(1)?,
            parent_id: row.get(2)?,
            name: row.get(3)?,
            order_index: row.get(4)?,
            color: row.get(5)?,
            section_type: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    sections.collect()
}

pub fn update_section(conn: &Connection, section: &Section) -> SqliteResult<()> {
    conn.execute(
        "UPDATE sections SET name = ?1, parent_id = ?2, order_index = ?3, color = ?4, section_type = ?5, updated_at = ?6 
         WHERE id = ?7",
        params![
            section.name,
            section.parent_id,
            section.order_index,
            section.color,
            section.section_type,
            section.updated_at,
            section.id
        ],
    )?;
    Ok(())
}

pub fn delete_section(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM sections WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - DOCUMENTS
// ============================================================================

pub fn create_document(conn: &Connection, document: &Document) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO documents (id, section_id, title, content_json, status, word_count, tags, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            document.id,
            document.section_id,
            document.title,
            document.content_json,
            document.status,
            document.word_count,
            document.tags,
            document.created_at,
            document.updated_at
        ],
    )?;
    Ok(())
}

pub fn get_documents_by_section(
    conn: &Connection,
    section_id: &str,
) -> SqliteResult<Vec<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, section_id, title, content_json, status, word_count, tags, created_at, updated_at 
         FROM documents WHERE section_id = ?1 ORDER BY updated_at DESC"
    )?;

    let documents = stmt.query_map(params![section_id], |row| {
        Ok(Document {
            id: row.get(0)?,
            section_id: row.get(1)?,
            title: row.get(2)?,
            content_json: row.get(3)?,
            status: row.get(4)?,
            word_count: row.get(5)?,
            tags: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    documents.collect()
}

pub fn get_document_by_id(conn: &Connection, id: &str) -> SqliteResult<Option<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, section_id, title, content_json, status, word_count, tags, created_at, updated_at 
         FROM documents WHERE id = ?1"
    )?;

    let mut rows = stmt.query(params![id])?;

    if let Some(row) = rows.next()? {
        Ok(Some(Document {
            id: row.get(0)?,
            section_id: row.get(1)?,
            title: row.get(2)?,
            content_json: row.get(3)?,
            status: row.get(4)?,
            word_count: row.get(5)?,
            tags: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn update_document(conn: &Connection, document: &Document) -> SqliteResult<()> {
    conn.execute(
        "UPDATE documents SET title = ?1, content_json = ?2, status = ?3, word_count = ?4, tags = ?5, updated_at = ?6 
         WHERE id = ?7",
        params![
            document.title,
            document.content_json,
            document.status,
            document.word_count,
            document.tags,
            document.updated_at,
            document.id
        ],
    )?;
    Ok(())
}

pub fn delete_document(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - ENTITIES
// ============================================================================

pub fn create_entity(conn: &Connection, entity: &Entity) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO entities (id, project_id, entity_type_id, name, description, image_path, metadata_json, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entity.id,
            entity.project_id,
            entity.entity_type_id,
            entity.name,
            entity.description,
            entity.image_path,
            entity.metadata_json,
            entity.created_at,
            entity.updated_at
        ],
    )?;
    Ok(())
}

pub fn get_entities_by_project(conn: &Connection, project_id: &str) -> SqliteResult<Vec<Entity>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, entity_type_id, name, description, image_path, metadata_json, created_at, updated_at 
         FROM entities WHERE project_id = ?1 ORDER BY name"
    )?;

    let entities = stmt.query_map(params![project_id], |row| {
        Ok(Entity {
            id: row.get(0)?,
            project_id: row.get(1)?,
            entity_type_id: row.get(2)?,
            name: row.get(3)?,
            description: row.get(4)?,
            image_path: row.get(5)?,
            metadata_json: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    entities.collect()
}

pub fn update_entity(conn: &Connection, entity: &Entity) -> SqliteResult<()> {
    conn.execute(
        "UPDATE entities SET name = ?1, entity_type_id = ?2, description = ?3, image_path = ?4, metadata_json = ?5, updated_at = ?6 
         WHERE id = ?7",
        params![
            entity.name,
            entity.entity_type_id,
            entity.description,
            entity.image_path,
            entity.metadata_json,
            entity.updated_at,
            entity.id
        ],
    )?;
    Ok(())
}

pub fn delete_entity(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM entities WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - ENTITY TYPES
// ============================================================================

pub fn create_entity_type(conn: &Connection, entity_type: &EntityType) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO entity_types (id, project_id, name, icon, color, fields_json, created_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entity_type.id,
            entity_type.project_id,
            entity_type.name,
            entity_type.icon,
            entity_type.color,
            entity_type.fields_json,
            entity_type.created_at
        ],
    )?;
    Ok(())
}

pub fn get_entity_types_by_project(
    conn: &Connection,
    project_id: &str,
) -> SqliteResult<Vec<EntityType>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, icon, color, fields_json, created_at 
         FROM entity_types WHERE project_id = ?1 ORDER BY name",
    )?;

    let types = stmt.query_map(params![project_id], |row| {
        Ok(EntityType {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            color: row.get(4)?,
            fields_json: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    types.collect()
}

pub fn delete_entity_type(conn: &Connection, id: &str) -> SqliteResult<()> {
    conn.execute("DELETE FROM entity_types WHERE id = ?1", params![id])?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - DOCUMENT VERSIONS
// ============================================================================

/// Create a new version snapshot (chiamato solo al salvataggio MANUALE)
pub fn create_document_version(conn: &Connection, version: &DocumentVersion) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO versions (id, document_id, version_number, backup_path, content_json, word_count, note, size_bytes, created_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            version.id,
            version.document_id,
            version.version_number,
            version.backup_path,
            version.content_json,
            version.word_count,
            version.note,
            version.size_bytes,
            version.created_at
        ],
    )?;
    Ok(())
}

/// Get the latest version for a document
pub fn get_latest_version(
    conn: &Connection,
    document_id: &str,
) -> SqliteResult<Option<DocumentVersion>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, version_number, backup_path, content_json, word_count, note, size_bytes, created_at 
         FROM versions WHERE document_id = ?1 ORDER BY created_at DESC LIMIT 1"
    )?;

    let mut rows = stmt.query(params![document_id])?;

    if let Some(row) = rows.next()? {
        Ok(Some(DocumentVersion {
            id: row.get(0)?,
            document_id: row.get(1)?,
            version_number: row.get(2)?,
            backup_path: row.get(3)?,
            content_json: row.get(4)?,
            word_count: row.get(5)?,
            note: row.get(6)?,
            size_bytes: row.get(7)?,
            created_at: row.get(8)?,
        }))
    } else {
        Ok(None)
    }
}

/// Get all versions for a document
pub fn get_versions_by_document(
    conn: &Connection,
    document_id: &str,
) -> SqliteResult<Vec<DocumentVersion>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, version_number, backup_path, content_json, word_count, note, size_bytes, created_at 
         FROM versions WHERE document_id = ?1 ORDER BY created_at DESC"
    )?;

    let versions = stmt.query_map(params![document_id], |row| {
        Ok(DocumentVersion {
            id: row.get(0)?,
            document_id: row.get(1)?,
            version_number: row.get(2)?,
            backup_path: row.get(3)?,
            content_json: row.get(4)?,
            word_count: row.get(5)?,
            note: row.get(6)?,
            size_bytes: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;

    versions.collect()
}

/// Delete old versions (keep only the last N)
pub fn cleanup_old_versions(
    conn: &Connection,
    document_id: &str,
    keep_count: i32,
) -> SqliteResult<()> {
    conn.execute(
        "DELETE FROM versions WHERE document_id = ?1 AND id NOT IN (
            SELECT id FROM versions WHERE document_id = ?1 ORDER BY created_at DESC LIMIT ?2
        )",
        params![document_id, keep_count],
    )?;
    Ok(())
}

// ============================================================================
// CRUD OPERATIONS - LINKS
// ============================================================================

pub fn create_link(conn: &Connection, link: &Link) -> SqliteResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO links (id, source_type, source_id, target_type, target_id, link_type, context_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            link.id,
            link.source_type,
            link.source_id,
            link.target_type,
            link.target_id,
            link.link_type,
            link.context_json,
            link.created_at
        ],
    )?;
    Ok(())
}

pub fn get_links_by_source(conn: &Connection, source_type: &str, source_id: &str) -> SqliteResult<Vec<Link>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_type, source_id, target_type, target_id, link_type, context_json, created_at
         FROM links WHERE source_type = ?1 AND source_id = ?2 ORDER BY created_at"
    )?;
    let links = stmt.query_map(params![source_type, source_id], |row| {
        Ok(Link {
            id: row.get(0)?,
            source_type: row.get(1)?,
            source_id: row.get(2)?,
            target_type: row.get(3)?,
            target_id: row.get(4)?,
            link_type: row.get(5)?,
            context_json: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    links.collect()
}

pub fn get_links_by_target(conn: &Connection, target_type: &str, target_id: &str) -> SqliteResult<Vec<Link>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_type, source_id, target_type, target_id, link_type, context_json, created_at
         FROM links WHERE target_type = ?1 AND target_id = ?2 ORDER BY created_at"
    )?;
    let links = stmt.query_map(params![target_type, target_id], |row| {
        Ok(Link {
            id: row.get(0)?,
            source_type: row.get(1)?,
            source_id: row.get(2)?,
            target_type: row.get(3)?,
            target_id: row.get(4)?,
            link_type: row.get(5)?,
            context_json: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    links.collect()
}

pub fn delete_links_by_source(conn: &Connection, source_type: &str, source_id: &str) -> SqliteResult<usize> {
    Ok(conn.execute(
        "DELETE FROM links WHERE source_type = ?1 AND source_id = ?2",
        params![source_type, source_id],
    )?)
}

pub fn delete_links_for_project(conn: &Connection, project_id: &str) -> SqliteResult<usize> {
    let section_ids: Vec<String> = conn.prepare(
        "SELECT id FROM sections WHERE project_id = ?1"
    )?
    .query_map(params![project_id], |row| row.get(0))?
    .filter_map(|r| r.ok())
    .collect();

    let mut total_deleted = 0usize;
    for section_id in &section_ids {
        let doc_ids: Vec<String> = conn.prepare(
            "SELECT id FROM documents WHERE section_id = ?1"
        )?
        .query_map(params![section_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

        for doc_id in &doc_ids {
            total_deleted += delete_links_by_source(conn, "document", doc_id)?;
        }
    }

    Ok(total_deleted)
}

pub fn get_entity_index_status_for_document(
    conn: &Connection,
    document_id: &str,
) -> SqliteResult<IndexStatus> {
    let link_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM links WHERE source_type = 'document' AND source_id = ?1 AND link_type = 'extracted_from'",
        params![document_id],
        |row| row.get(0),
    )?;

    if link_count == 0 {
        return Ok(IndexStatus {
            status: "red".to_string(),
            entity_count: 0,
            last_indexed: None,
            target_updated_at: None,
        });
    }

    let last_indexed: Option<i64> = conn.query_row(
        "SELECT MAX(created_at) FROM links WHERE source_type = 'document' AND source_id = ?1 AND link_type = 'extracted_from'",
        params![document_id],
        |row| row.get(0),
    )?;

    let doc_updated_at: Option<i64> = conn.query_row(
        "SELECT updated_at FROM documents WHERE id = ?1",
        params![document_id],
        |row| row.get(0),
    )?;

    let status = if let (Some(li), Some(du)) = (last_indexed, doc_updated_at) {
        if du > li { "yellow" } else { "green" }
    } else {
        "green"
    };

    Ok(IndexStatus {
        status: status.to_string(),
        entity_count: link_count,
        last_indexed,
        target_updated_at: doc_updated_at,
    })
}

pub fn get_entity_index_status_for_section(
    conn: &Connection,
    section_id: &str,
) -> SqliteResult<IndexStatus> {
    let doc_ids: Vec<String> = conn.prepare(
        "SELECT id FROM documents WHERE section_id = ?1"
    )?
    .query_map(params![section_id], |row| row.get(0))?
    .filter_map(|r| r.ok())
    .collect();

    if doc_ids.is_empty() {
        return Ok(IndexStatus {
            status: "red".to_string(),
            entity_count: 0,
            last_indexed: None,
            target_updated_at: None,
        });
    }

    let mut total_entities: i64 = 0;
    let mut max_last_indexed: Option<i64> = None;
    let mut max_doc_updated: Option<i64> = None;
    let mut has_any_link = false;

    for doc_id in &doc_ids {
        let doc_status = get_entity_index_status_for_document(conn, doc_id)?;
        total_entities += doc_status.entity_count;
        if doc_status.entity_count > 0 {
            has_any_link = true;
        }
        if let Some(li) = doc_status.last_indexed {
            max_last_indexed = Some(max_last_indexed.map_or(li, |m: i64| m.max(li)));
        }
        if let Some(du) = doc_status.target_updated_at {
            max_doc_updated = Some(max_doc_updated.map_or(du, |m: i64| m.max(du)));
        }
    }

    if !has_any_link {
        return Ok(IndexStatus {
            status: "red".to_string(),
            entity_count: 0,
            last_indexed: None,
            target_updated_at: None,
        });
    }

    let status = if let (Some(li), Some(du)) = (max_last_indexed, max_doc_updated) {
        if du > li { "yellow" } else { "green" }
    } else {
        "green"
    };

    Ok(IndexStatus {
        status: status.to_string(),
        entity_count: total_entities,
        last_indexed: max_last_indexed,
        target_updated_at: max_doc_updated,
    })
}

pub fn get_entity_index_status_for_project(
    conn: &Connection,
    project_id: &str,
) -> SqliteResult<IndexStatus> {
    let section_ids: Vec<String> = conn.prepare(
        "SELECT id FROM sections WHERE project_id = ?1"
    )?
    .query_map(params![project_id], |row| row.get(0))?
    .filter_map(|r| r.ok())
    .collect();

    let mut total_entities: i64 = 0;
    let mut max_last_indexed: Option<i64> = None;
    let mut max_doc_updated: Option<i64> = None;
    let mut has_any_link = false;

    for section_id in &section_ids {
        let section_status = get_entity_index_status_for_section(conn, section_id)?;
        total_entities += section_status.entity_count;
        if section_status.entity_count > 0 {
            has_any_link = true;
        }
        if let Some(li) = section_status.last_indexed {
            max_last_indexed = Some(max_last_indexed.map_or(li, |m: i64| m.max(li)));
        }
        if let Some(du) = section_status.target_updated_at {
            max_doc_updated = Some(max_doc_updated.map_or(du, |m: i64| m.max(du)));
        }
    }

    if !has_any_link {
        return Ok(IndexStatus {
            status: "red".to_string(),
            entity_count: 0,
            last_indexed: None,
            target_updated_at: None,
        });
    }

    let status = if let (Some(li), Some(du)) = (max_last_indexed, max_doc_updated) {
        if du > li { "yellow" } else { "green" }
    } else {
        "green"
    };

    Ok(IndexStatus {
        status: status.to_string(),
        entity_count: total_entities,
        last_indexed: max_last_indexed,
        target_updated_at: max_doc_updated,
    })
}
