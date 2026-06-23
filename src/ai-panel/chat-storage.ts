// chat-storage.ts
//
// Phase 1 of chat compaction: every chat turn is persisted in SQLite.
//
// Responsibilities:
// - generate / retrieve the current session_id (one per app session)
// - save each user + assistant turn to disk via Tauri command
// - Phase 2: kick off async embedding generation after each save (fire-and-forget)
//
// Design notes:
// - session_id is generated ONCE on first call to getCurrentSessionId() and
//   cached in localStorage. A cold app restart produces a new session_id.
// - The webview itself may reload (HMR, dev refresh), but localStorage
//   survives, so the same session continues across reloads — only a true
//   cold start creates a new session.
// - saveChatMessage() is fire-and-forget: errors are logged to console
//   but do not interrupt the chat UX. The DB is durable enough that a
//   single failed insert is recoverable; we'd rather degrade gracefully
//   than block the user with a modal.
// - We persist only user + assistant messages. tool_result messages stay
//   in memory (they're noise to the future RAG).

import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "./providers";
import type { ChatMessage, ChatSessionSummary } from "../types/database";

const SESSION_ID_KEY = "aurawrite-chat-session-id";

function generateSessionId(): string {
  // Readable prefix + epoch ms + random suffix for debugging in the DB.
  // Example: "s-1740000000000-a3f9b2e1"
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `s-${ts}-${rand}`;
}

let cachedSessionId: string | null = null;

/**
 * Get the current session_id, generating one if needed.
 * Returns the cached value on subsequent calls within the same webview session.
 */
export function getCurrentSessionId(): string {
  if (cachedSessionId) return cachedSessionId;

  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored && stored.startsWith("s-")) {
    cachedSessionId = stored;
    return stored;
  }

  const fresh = generateSessionId();
  localStorage.setItem(SESSION_ID_KEY, fresh);
  cachedSessionId = fresh;
  return fresh;
}

/**
 * Force a new session_id. Used by a future "New session" UI control.
 * Not currently called from anywhere — kept here so the API is ready
 * for Phase 4 (chat_search across sessions).
 */
export function resetSessionId(): string {
  const fresh = generateSessionId();
  localStorage.setItem(SESSION_ID_KEY, fresh);
  cachedSessionId = fresh;
  return fresh;
}

/**
 * Save a single chat message to SQLite. Fire-and-forget: errors are
 * logged but never thrown — chat UX must keep flowing even if the disk
 * hiccups.
 *
 * @param role       "user" | "assistant" | "system" | "tool_result"
 * @param content    message text (already cleaned of tool tags)
 * @param attachments  optional list of attachments (metadata only,
 *                     base64 is NOT persisted)
 * @param projectId  optional id of the open project at send time
 */
export async function saveChatMessage(
  role: ChatMessage["role"],
  content: string,
  attachments?: Attachment[],
  projectId?: string,
): Promise<void> {
  // Persist user + assistant only; tool_result is internal noise.
  if (role !== "user" && role !== "assistant") return;

  const now = Date.now();
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    session_id: getCurrentSessionId(),
    role,
    content,
    attachments_json: attachments && attachments.length > 0
      ? JSON.stringify(
          attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
        )
      : null,
    project_id: projectId ?? null,
    timestamp: now,
    created_at: now,
  };

  try {
    await invoke("chat_save_message", { message });
    // Phase 2 hook: schedule embedding generation after successful save.
    // Fire-and-forget — failures here must not interrupt the chat.
    void scheduleChatEmbedding(message);
  } catch (err) {
    console.warn(`[chat-storage] saveChatMessage failed (role=${role}):`, err);
  }
}

/**
 * Phase 2: kick off async embedding generation for a saved message.
 * Best-effort: errors are swallowed. The next save attempt will overwrite
 * the placeholder (zero vector) used by save_chat_message_embedding.
 */
async function scheduleChatEmbedding(message: ChatMessage): Promise<void> {
  // Skip if the embeddings stack is not configured (nomic missing,
  // Ollama down, etc.) — chat must keep working without embeddings.
  try {
    const vector: number[] = await invoke("embedding_generate", {
      text: message.content,
      isQuery: false,
      baseUrl: null,
    });
    if (vector.length !== 768) {
      console.warn(`[chat-storage] embedding has unexpected length ${vector.length}, skipping`);
      return;
    }
    await invoke("embedding_save_chat_message", {
      messageId: message.id,
      sessionId: message.session_id,
      role: message.role,
      messageTimestamp: message.timestamp,
      contentText: message.content,
      projectId: message.project_id,
      embeddingVector: vector,
    });
  } catch (err) {
    // No-op: nomic not installed, Ollama not running, etc.
    console.debug(`[chat-storage] embedding skipped for message ${message.id}:`, err);
  }
}

/**
 * Load all messages of the current session, oldest first.
 * Used by a future "scroll back" UI and by Phase 4 (chat_search).
 */
export async function loadChatSession(
  sessionId?: string,
): Promise<ChatMessage[]> {
  const sid = sessionId ?? getCurrentSessionId();
  try {
    return await invoke<ChatMessage[]>("chat_get_messages_by_session", {
      sessionId: sid,
    });
  } catch (err) {
    console.warn(`[chat-storage] loadChatSession failed for ${sid}:`, err);
    return [];
  }
}

/**
 * List recent chat sessions, newest first. Used by a future history UI
 * and by Phase 4 for cross-session search.
 */
export async function listRecentSessions(
  limit = 20,
): Promise<ChatSessionSummary[]> {
  try {
    return await invoke<ChatSessionSummary[]>("chat_list_recent_sessions", {
      limit,
    });
  } catch (err) {
    console.warn("[chat-storage] listRecentSessions failed:", err);
    return [];
  }
}

/**
 * Delete a session and its messages. Used by a future "Delete chat history"
 * UI control. Not exposed to the AI.
 */
export async function deleteChatSession(sessionId: string): Promise<number> {
  try {
    return await invoke<number>("chat_delete_session", { sessionId });
  } catch (err) {
    console.warn(`[chat-storage] deleteChatSession failed for ${sessionId}:`, err);
    return 0;
  }
}

/**
 * Total persisted chat messages across all sessions. Diagnostics.
 */
export async function countChatMessages(): Promise<number> {
  try {
    return await invoke<number>("chat_count_messages");
  } catch (err) {
    console.warn("[chat-storage] countChatMessages failed:", err);
    return 0;
  }
}