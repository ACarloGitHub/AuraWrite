// chat_db.rs - Persistent chat history
//
// Phase 1 of chat compaction: every chat turn is persisted in SQLite so
// the conversation survives app restarts and (later, in Phase 2) can be
// indexed in the RAG for semantic search across sessions.
//
// Design notes:
// - session_id is generated on the frontend at app startup and persisted
//   in localStorage to survive webview reloads. Each cold start of the
//   app produces a new session_id.
// - We persist user and assistant turns only. tool_result messages stay
//   in memory (they're internal noise).
// - attachments_json holds metadata only (filename, kind, mimeType, size),
//   NOT the base64 payload. The base64 is shown to the user in the chat
//   panel during the same session, but not stored on disk.
// - messages are NOT cascade-deleted when a project is removed: chat
//   sessions span across projects (the user can switch projects mid-chat).

use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub attachments_json: Option<String>,
    pub project_id: Option<String>,
    pub timestamp: i64,
    pub created_at: i64,
}

/// Initialize the chat_messages table. The CREATE TABLE IF NOT EXISTS is
/// already part of `get_schema()`, so this is a no-op kept for symmetry
/// with `init_embeddings_table`. Kept public so the app entry point can
/// call it explicitly during startup, mirroring the embeddings pattern.
pub fn init_chat_table(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool_result')),
            content TEXT NOT NULL,
            attachments_json TEXT,
            project_id TEXT,
            timestamp INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id);",
    )?;
    Ok(())
}

/// Persist a single chat turn. INSERT only (no upsert): chat messages are
/// immutable once written. If the same id is inserted twice, the second
/// insert returns an error (the frontend uses crypto.randomUUID() so
/// collisions are effectively impossible).
pub fn save_chat_message(conn: &Connection, message: &ChatMessage) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO chat_messages
            (id, session_id, role, content, attachments_json, project_id, timestamp, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message.id,
            message.session_id,
            message.role,
            message.content,
            message.attachments_json,
            message.project_id,
            message.timestamp,
            message.created_at,
        ],
    )?;
    Ok(())
}

/// Fetch all messages of one session, oldest first.
/// Used by the future Phase 4 (chat_search) and by diagnostics / debug UI.
pub fn get_chat_messages_by_session(
    conn: &Connection,
    session_id: &str,
) -> SqliteResult<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, attachments_json, project_id, timestamp, created_at
         FROM chat_messages
         WHERE session_id = ?1
         ORDER BY timestamp ASC",
    )?;

    let messages = stmt.query_map(params![session_id], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            attachments_json: row.get(4)?,
            project_id: row.get(5)?,
            timestamp: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;

    messages.collect()
}

/// Fetch the most recent sessions, newest first, with a message count.
/// Useful for a future "Chat history" UI and for Phase 4 cross-session
/// search. Returns Vec<(session_id, message_count, last_timestamp)>.
pub fn list_recent_sessions(
    conn: &Connection,
    limit: i32,
) -> SqliteResult<Vec<ChatSessionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT session_id,
                COUNT(*) AS msg_count,
                MAX(timestamp) AS last_ts,
                MIN(timestamp) AS first_ts
         FROM chat_messages
         GROUP BY session_id
         ORDER BY last_ts DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(ChatSessionSummary {
            session_id: row.get(0)?,
            message_count: row.get(1)?,
            last_timestamp: row.get(2)?,
            first_timestamp: row.get(3)?,
        })
    })?;

    rows.collect()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatSessionSummary {
    pub session_id: String,
    pub message_count: i64,
    pub last_timestamp: i64,
    pub first_timestamp: i64,
}

/// Delete all messages of a session. Used by a future "Delete session"
/// UI control. Not exposed to the AI as a tool.
pub fn delete_chat_session(conn: &Connection, session_id: &str) -> SqliteResult<usize> {
    Ok(conn.execute(
        "DELETE FROM chat_messages WHERE session_id = ?1",
        params![session_id],
    )?)
}

/// Total number of messages across all sessions. Used for diagnostics.
pub fn count_chat_messages(conn: &Connection) -> SqliteResult<i64> {
    conn.query_row("SELECT COUNT(*) FROM chat_messages", [], |row| row.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool_result')),
                content TEXT NOT NULL,
                attachments_json TEXT,
                project_id TEXT,
                timestamp INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn sample(id: &str, session: &str, role: &str, content: &str, ts: i64) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            session_id: session.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            attachments_json: None,
            project_id: None,
            timestamp: ts,
            created_at: ts,
        }
    }

    #[test]
    fn test_save_and_fetch_by_session() {
        let conn = open_in_memory();
        let m1 = sample("m1", "s1", "user", "hello", 1000);
        let m2 = sample("m2", "s1", "assistant", "hi", 2000);
        let m3 = sample("m3", "s2", "user", "other session", 1500);

        save_chat_message(&conn, &m1).unwrap();
        save_chat_message(&conn, &m2).unwrap();
        save_chat_message(&conn, &m3).unwrap();

        let s1_msgs = get_chat_messages_by_session(&conn, "s1").unwrap();
        assert_eq!(s1_msgs.len(), 2);
        assert_eq!(s1_msgs[0].content, "hello");
        assert_eq!(s1_msgs[1].content, "hi");

        let s2_msgs = get_chat_messages_by_session(&conn, "s2").unwrap();
        assert_eq!(s2_msgs.len(), 1);
        assert_eq!(s2_msgs[0].content, "other session");
    }

    #[test]
    fn test_save_duplicate_id_errors() {
        let conn = open_in_memory();
        let m = sample("dup", "s1", "user", "hello", 1000);
        save_chat_message(&conn, &m).unwrap();
        let err = save_chat_message(&conn, &m).unwrap_err();
        assert!(matches!(err, rusqlite::Error::SqliteFailure(_, _)));
    }

    #[test]
    fn test_list_recent_sessions() {
        let conn = open_in_memory();
        save_chat_message(&conn, &sample("m1", "s1", "user", "a", 1000)).unwrap();
        save_chat_message(&conn, &sample("m2", "s1", "assistant", "b", 2000)).unwrap();
        save_chat_message(&conn, &sample("m3", "s2", "user", "c", 3000)).unwrap();

        let sessions = list_recent_sessions(&conn, 10).unwrap();
        assert_eq!(sessions.len(), 2);
        // s2 is most recent (3000)
        assert_eq!(sessions[0].session_id, "s2");
        assert_eq!(sessions[0].message_count, 1);
        assert_eq!(sessions[1].session_id, "s1");
        assert_eq!(sessions[1].message_count, 2);
        assert_eq!(sessions[1].first_timestamp, 1000);
        assert_eq!(sessions[1].last_timestamp, 2000);
    }

    #[test]
    fn test_delete_chat_session() {
        let conn = open_in_memory();
        save_chat_message(&conn, &sample("m1", "s1", "user", "a", 1000)).unwrap();
        save_chat_message(&conn, &sample("m2", "s2", "user", "b", 2000)).unwrap();

        let deleted = delete_chat_session(&conn, "s1").unwrap();
        assert_eq!(deleted, 1);

        assert_eq!(get_chat_messages_by_session(&conn, "s1").unwrap().len(), 0);
        assert_eq!(get_chat_messages_by_session(&conn, "s2").unwrap().len(), 1);
    }

    #[test]
    fn test_count_chat_messages() {
        let conn = open_in_memory();
        assert_eq!(count_chat_messages(&conn).unwrap(), 0);
        save_chat_message(&conn, &sample("m1", "s1", "user", "a", 1000)).unwrap();
        save_chat_message(&conn, &sample("m2", "s1", "assistant", "b", 2000)).unwrap();
        assert_eq!(count_chat_messages(&conn).unwrap(), 2);
    }

    #[test]
    fn test_attachments_json_roundtrip() {
        let conn = open_in_memory();
        let atts = r#"[{"filename":"note.txt","kind":"document","mimeType":"text/plain","size":42}]"#;
        let m = ChatMessage {
            id: "m1".into(),
            session_id: "s1".into(),
            role: "user".into(),
            content: "see attached".into(),
            attachments_json: Some(atts.into()),
            project_id: Some("p1".into()),
            timestamp: 1000,
            created_at: 1000,
        };
        save_chat_message(&conn, &m).unwrap();
        let fetched = get_chat_messages_by_session(&conn, "s1").unwrap();
        assert_eq!(fetched[0].attachments_json.as_deref(), Some(atts));
        assert_eq!(fetched[0].project_id.as_deref(), Some("p1"));
    }
}