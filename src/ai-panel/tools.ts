// ============================================================================
// Tool Calling for AuraWrite AI
// AI can query the database and operate the editor using structured tools.
//
// Strategia A (2026-06-27): the tool surface was consolidated from 43 granular
// tools into 14 domain tools with an `action` parameter. The text-tag protocol
// (<tool name="x">{...}</tool>) is unchanged, so every provider/model keeps
// working. See AuraWrite-Wiki/concepts/tools-consolidation.md.
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "prosemirror-view";
import { requestPermission } from "./permissions";
import { fromMarkdown } from "../formats/markdown";
import { findTextInDoc } from "../editor/text-utils";
import { notifyDocumentChange } from "./modification-hub";

function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[/\\]|\/)/.test(path);
}

const WEB_TOOL_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); _resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ============================================================================
// Tool Definitions (consolidated, 14 domain tools)
// ============================================================================

export const AVAILABLE_TOOLS = [
  // ---- Editor (writes into the open document) ----
  {
    name: "editor_edit",
    description: "Write, insert, replace, format, or delete text in the document currently open in the editor. Content is Markdown (**bold**, *italic*, `code`, # headings, - lists, > quote). Cursor position, selection, and document end are read live from the editor. Always prefer this tool over answering with prose when the user asks to add, insert, rewrite, or change text in the document.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["replace_document", "replace_selection", "insert_at_cursor", "insert_at_end", "insert_at_anchor", "format", "delete"],
          description: "replace_document: rewrite the whole document. replace_selection: replace the text the user has currently selected. insert_at_cursor: insert at the live caret. insert_at_end: append at the end of the document. insert_at_anchor: insert right before/after an existing snippet (needs `anchor`). format: apply/remove a mark on existing text (needs `find` + `mark`/`remove_mark`). delete: remove an existing snippet (needs `find`)."
        },
        content: { type: "string", description: "Markdown content to write/insert/replace. Used by replace_document, replace_selection, insert_at_cursor, insert_at_end, insert_at_anchor." },
        anchor: { type: "string", description: "For insert_at_anchor / format: a snippet of text ALREADY in the document, quoted exactly. The new content is placed before/after it (insert_at_anchor), or it is the text to format (format)." },
        find: { type: "string", description: "For format / delete: the exact text already in the document to apply a mark to, or to delete." },
        position: { type: "string", enum: ["before", "after"], description: "insert_at_anchor: place the new content 'before' or 'after' the anchor. Default 'after'." },
        mark: { type: "string", description: "format: mark to add. Accepted: strong (or bold/b), em (or italic/i), strikethrough (or strike/s/del), underline, code, link (needs `href`)." },
        remove_mark: { type: "string", description: "format: mark to remove (same names as `mark`)." },
        href: { type: "string", description: "format with mark=link: the link URL." }
      },
      required: ["action"]
    }
  },
  // ---- Project entities (characters, locations, etc.) ----
  {
    name: "entity_query",
    description: "Query project entities (characters, locations, objects, events, recipes, etc.). Requires a project_id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "get", "list_by_type", "in_document", "semantic", "embeddings"], description: "search: by name/description. get: one entity by id. list_by_type: all of a type. in_document: entities extracted from a document. semantic: semantic similarity. embeddings: raw indexed chunks of one entity." },
        project_id: { type: "string", description: "The project ID" },
        query: { type: "string", description: "search / semantic: name, description, or natural-language query" },
        entity_type: { type: "string", description: "list_by_type / search filter: type name (e.g. 'Character'); singular or plural accepted" },
        entity_id: { type: "string", description: "get / embeddings: the entity ID" },
        entity_id_type: { type: "string", description: "embeddings: entity type (e.g. 'entity', 'document')" },
        document_id: { type: "string", description: "in_document: the document ID" },
        limit: { type: "number", description: "max results (default 10)" }
      },
      required: ["action", "project_id"]
    }
  },
  // ---- Project documents ----
  {
    name: "document_query",
    description: "Query project documents by title/content, read one, list structure, or semantic-search them. Requires a project_id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "get_content", "get_structure", "semantic"], description: "search: by title/content. get_content: one document by id. get_structure: full section/document tree. semantic: semantic similarity over document text." },
        project_id: { type: "string", description: "The project ID" },
        query: { type: "string", description: "search / semantic: query" },
        section_id: { type: "string", description: "search: filter by section" },
        document_id: { type: "string", description: "get_content: the document ID" },
        limit: { type: "number", description: "max results (default 10)" }
      },
      required: ["action", "project_id"]
    }
  },
  // ---- Read full project / section text ----
  {
    name: "read_scope",
    description: "Read the full text of every document in a whole project or a single section.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["project", "section"], description: "project: all documents in the project. section: all documents in one section." },
        project_id: { type: "string", description: "project: the project ID" },
        section_id: { type: "string", description: "section: the section ID" },
        max_length: { type: "number", description: "max characters per document (0 = no limit, default 0)" }
      },
      required: ["action"]
    }
  },
  // ---- Chat history ----
  {
    name: "chat_history",
    description: "Browse past conversation: semantic search across sessions, list recent sessions, or read one session's messages.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "list_sessions", "get_messages"], description: "search: semantic search across recent sessions. list_sessions: list recent sessions. get_messages: read all messages of one session." },
        query: { type: "string", description: "search: natural-language query" },
        session_id: { type: "string", description: "get_messages: the session ID" },
        project_id: { type: "string", description: "search: optional project filter" },
        limit: { type: "number", description: "search/list_sessions: max results (default 10/20)" }
      },
      required: ["action"]
    }
  },
  // ---- Planner: CRUD ----
  {
    name: "plan_manage",
    description: "Create, read, update, delete, or list plans (markdown checklists shown in the MCP panel).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "read", "update", "delete", "list"], description: "create/update need name+content; read/delete need name; list needs nothing." },
        name: { type: "string", description: "Plan name (used as filename, e.g. 'chapter-outline')" },
        content: { type: "string", description: "create/update: plan markdown. Start with 'status: active'; tasks '- [ ]', questions '- [ ] Question (for user): ...'." }
      },
      required: ["action"]
    }
  },
  // ---- Planner: progress tracking ----
  {
    name: "plan_progress",
    description: "Advance or check status of a plan (shown in the MCP panel).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["next", "status"], description: "next: mark the first open task done and return the next (or a blocking question). status: totals + progress %." },
        name: { type: "string", description: "Plan name" },
        answer: { type: "string", description: "next: answer to a blocking question (optional)" }
      },
      required: ["action", "name"]
    }
  },
  // ---- Web ----
  {
    name: "web_query",
    description: "Web search, fetch a URL as markdown, or image search.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "fetch", "images"], description: "search: DuckDuckGo/Brave results. fetch: read a URL as markdown (30s, 200KB). images: image search." },
        query: { type: "string", description: "search / images: the query" },
        url: { type: "string", description: "fetch: the URL" },
        format: { type: "string", description: "fetch: 'markdown' (default) or 'text'" },
        limit: { type: "number", description: "search / images: max results (default 10, max 20)" }
      },
      required: ["action"]
    }
  },
  // ---- Wiki: read ----
  {
    name: "wiki_query",
    description: "Read the memory wiki (workspace/memory/): search pages, read one by name, or list all.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "read", "list"], description: "search: recursive case-insensitive search. read: one page by name. list: all pages." },
        query: { type: "string", description: "search: query" },
        name: { type: "string", description: "read: page name (e.g. 'worldbuilding')" },
        limit: { type: "number", description: "search: max results (default 20, max 50)" }
      },
      required: ["action"]
    }
  },
  // ---- Wiki: write ----
  {
    name: "wiki_write",
    description: "Write to the memory wiki: one page, or ingest many pages at once.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["page", "ingest"], description: "page: create/update one page. ingest: create many pages at once." },
        name: { type: "string", description: "page: the page name" },
        content: { type: "string", description: "page: the page content in markdown" },
        frontmatter: { type: "object", description: "page: optional YAML frontmatter as JSON" },
        pages: { type: "array", description: "ingest: array of {name, content, frontmatter?} pages", items: { type: "object", properties: { name: { type: "string" }, content: { type: "string" }, frontmatter: { type: "object" } }, required: ["name", "content"] } }
      },
      required: ["action"]
    }
  },
  // ---- Filesystem ----
  {
    name: "file",
    description: "Read, write, list, or edit files. Confined to the workspace by default; absolute paths need user permission.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "list", "edit"], description: "read/write/list: one path. edit: replace text segments in a file." },
        path: { type: "string", description: "file path (relative to workspace, or absolute)" },
        content: { type: "string", description: "write: the content" },
        edits: { type: "array", description: "edit: array of {old_text, new_text}", items: { type: "object", properties: { old_text: { type: "string" }, new_text: { type: "string" } }, required: ["old_text", "new_text"] } }
      },
      required: ["action", "path"]
    }
  },
  // ---- RAG vector memory ----
  {
    name: "rag",
    description: "Index text into the RAG vector store, semantic-search it, list indexed entities, or delete one.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "search", "list", "delete"], description: "add: index text. search: semantic search. list: indexed entities with chunk counts. delete: remove an entity's chunks." },
        project_id: { type: "string", description: "the project ID" },
        entity_type: { type: "string", description: "add / delete: type (e.g. 'wiki', 'note')" },
        entity_id: { type: "string", description: "add / delete: unique id" },
        content_text: { type: "string", description: "add: the text to index" },
        query: { type: "string", description: "search: natural-language query" },
        limit: { type: "number", description: "search: max results (default 10)" }
      },
      required: ["action", "project_id"]
    }
  },
  // ---- Shell: run a command ----
  {
    name: "exec",
    description: "Execute a shell command in the workspace (or a workdir). Requires user confirmation. Destructive commands are blocked. Use exec_job to manage background jobs.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "the shell command" },
        workdir: { type: "string", description: "working directory (relative or absolute). Defaults to workspace root." },
        timeout: { type: "number", description: "timeout in seconds (default 120, max 7200)" },
        background: { type: "boolean", description: "run in background (default false); poll with exec_job." },
        env: { type: "object", description: "environment variables (key-value)" }
      },
      required: ["command"]
    }
  },
  // ---- Shell: manage background jobs ----
  {
    name: "exec_job",
    description: "Manage background shell jobs: poll status, kill, list, or clean up.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["poll", "kill", "list", "clean"], description: "poll: status + last lines of a job. kill: stop a job. list: all jobs. clean: remove old jobs." },
        job_id: { type: "string", description: "poll / kill: the job ID" },
        tail: { type: "number", description: "poll: last N lines (default 100)" },
        max_age_hours: { type: "number", description: "clean: remove jobs older than this (default 24)" },
        all: { type: "boolean", description: "clean: remove all jobs regardless of age (default false)" }
      },
      required: ["action"]
    }
  }
];

// ============================================================================
// Tool Implementation
// ============================================================================

interface Entity {
  id: string;
  project_id: string;
  entity_type_id?: string;
  name: string;
  description?: string;
  metadata_json?: string;
}

interface EntityType {
  id: string;
  project_id: string;
  name: string;
}

interface Document {
  id: string;
  section_id: string;
  title: string;
  content_json: string;
  word_count: number;
}

interface Section {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  order_index: number;
}

// Tool: search_entities
async function searchEntities(
  projectId: string,
  query: string,
  entityTypeName?: string,
  limit: number = 10
): Promise<Entity[]> {
  // Get all entities for the project
  const entities: Entity[] = await invoke("db_get_entities", {
    projectId
  });

  // Get entity types to match names
  const entityTypes: EntityType[] = await invoke("db_get_entity_types", {
    projectId
  });

  const queryLower = query.toLowerCase().trim();

  // Euristica: se la query è una singola parola che corrisponde (anche
  // parzialmente) al nome di un tipo di entità noto, redirigiamo a
  // listEntitiesByType. Esempi: query="characters" → tipo "Character",
  // query="places" → tipo "Place", query="luoghi" → "Location".
  // Non si applica se l'AI ha già passato esplicitamente entity_type.
  if (!entityTypeName) {
    const queryWord = queryLower.split(/\s+/)[0];
    const matchingType = entityTypes.find((et) => {
      const n = et.name.toLowerCase().trim();
      return n === queryWord || n.includes(queryWord) || queryWord.includes(n);
    });
    if (matchingType) {
      return entities
        .filter((e) => e.entity_type_id === matchingType.id)
        .slice(0, limit);
    }
  }

  let results = entities.filter((entity) => {
    const nameMatch = entity.name.toLowerCase().includes(queryLower);
    const descMatch = entity.description
      ? entity.description.toLowerCase().includes(queryLower)
      : false;
    return nameMatch || descMatch;
  });

  // Filter by entity type if specified
  if (entityTypeName) {
    const typeLower = entityTypeName.toLowerCase().trim();
    // Fuzzy match: esatto, contiene, o è contenuto (gestisce plurali/varianti).
    const matchingTypes = entityTypes.filter((et) => {
      const n = et.name.toLowerCase().trim();
      return n === typeLower || n.includes(typeLower) || typeLower.includes(n);
    });
    const typeIds = matchingTypes.map((t) => t.id);
    results = results.filter((e) =>
      typeIds.includes(e.entity_type_id || "")
    );
  }

  return results.slice(0, limit);
}

// Tool: get_entity_details
async function getEntityDetails(entityId: string): Promise<Entity | null> {
  try {
    return await invoke("db_get_entity_by_id", { id: entityId });
  } catch {
    return null;
  }
}

// Tool: list_entities_by_type
async function listEntitiesByType(
  projectId: string,
  entityType: string
): Promise<Entity[]> {
  // Get entity types
  const entityTypes: EntityType[] = await invoke("db_get_entity_types", {
    projectId
  });

  const typeLower = entityType.toLowerCase().trim();
  // Fuzzy match: esatto, contiene, o è contenuto (gestisce plurali, varianti,
  // e casi come "Place" vs "Places", "Location" vs "Locations").
  const matchingType = entityTypes.find((et) => {
    const n = et.name.toLowerCase().trim();
    return n === typeLower || n.includes(typeLower) || typeLower.includes(n);
  });

  if (!matchingType) {
    return [];
  }

  // Get all entities and filter by type
  const entities: Entity[] = await invoke("db_get_entities", {
    projectId
  });

  return entities.filter(
    (e) => e.entity_type_id === matchingType.id
  );
}

// Tool: search_documents
async function searchDocuments(
  projectId: string,
  query: string,
  sectionId?: string,
  limit: number = 10
): Promise<Document[]> {
  // Get project structure
  const sections: Section[] = await invoke("db_get_sections", {
    projectId
  });

  const queryLower = query.toLowerCase();
  let results: Document[] = [];

  for (const section of sections) {
    if (sectionId && section.id !== sectionId) {
      continue;
    }

    const documents: Document[] = await invoke("db_get_documents", {
      sectionId: section.id
    });

    const matchingDocs = documents.filter((doc) => {
      const titleMatch = doc.title.toLowerCase().includes(queryLower);
      // Parse content_json for text search
      let contentMatch = false;
      try {
        const content = JSON.parse(doc.content_json);
        const text = extractTextFromContent(content);
        contentMatch = text.toLowerCase().includes(queryLower);
      } catch {
        // Ignore parse errors
      }
      return titleMatch || contentMatch;
    });

    results.push(...matchingDocs);
  }

  return results.slice(0, limit);
}

// Tool: get_document_content
async function getDocumentContent(
  documentId: string
): Promise<Document | null> {
  return await invoke("db_get_document", { id: documentId });
}

// Tool: get_project_structure
async function getProjectStructure(projectId: string): Promise<{
  sections: Section[];
  documents: Record<string, Document[]>;
}> {
  const sections: Section[] = await invoke("db_get_sections", {
    projectId
  });
  const documents: Record<string, Document[]> = {};

  for (const section of sections) {
    const sectionDocs: Document[] = await invoke("db_get_documents", {
      sectionId: section.id
    });
    documents[section.id] = sectionDocs;
  }

  return { sections, documents };
}

// Tool: semantic_search (requires embeddings)
async function semanticSearch(
  projectId: string,
  query: string,
  limit: number = 5
): Promise<Array<{ entity_type: string; entity_id: string; content_text: string; distance: number }>> {
  try {
    const PREFERENCES_KEY = "aurawrite-preferences";
    const saved = localStorage.getItem(PREFERENCES_KEY);
    const prefs = saved ? JSON.parse(saved) : {};
    const baseUrl = prefs.aiBaseUrl || undefined;

    const queryVector: number[] = await invoke("embedding_generate", {
      text: query,
      isQuery: true,
      baseUrl,
    });

    const results = await invoke("embedding_search_documents", {
      projectId,
      queryVector,
      limit
    });

    return results as Array<{
      entity_type: string;
      entity_id: string;
      content_text: string;
      distance: number;
    }>;
  } catch (error) {
    console.error("Semantic search failed:", error);
    return [];
  }
}

async function semanticSearchEntities(
  projectId: string,
  query: string,
  limit: number = 5
): Promise<Array<{ entity_type: string; entity_id: string; content_text: string; distance: number }>> {
  try {
    const PREFERENCES_KEY = "aurawrite-preferences";
    const saved = localStorage.getItem(PREFERENCES_KEY);
    const prefs = saved ? JSON.parse(saved) : {};
    const baseUrl = prefs.aiBaseUrl || undefined;

    const queryVector: number[] = await invoke("embedding_generate", {
      text: query,
      isQuery: true,
      baseUrl,
    });

    const results = await invoke("embedding_search_entities", {
      projectId,
      queryVector,
      limit
    });

    return results as Array<{
      entity_type: string;
      entity_id: string;
      content_text: string;
      distance: number;
    }>;
  } catch (error) {
    console.error("Semantic search entities failed:", error);
    return [];
  }
}

async function getEmbeddingsForEntity(
  entityType: string,
  entityId: string
): Promise<Array<{ id: string; project_id: string; entity_type: string; entity_id: string; chunk_index: number | null; content_text: string; created_at: number }>> {
  try {
    const results = await invoke("embedding_get_for_entity", {
      entityType,
      entityId,
    });
    return results as Array<{
      id: string;
      project_id: string;
      entity_type: string;
      entity_id: string;
      chunk_index: number | null;
      content_text: string;
      created_at: number;
    }>;
  } catch (error) {
    console.error("Get embeddings for entity failed:", error);
    return [];
  }
}

// Tool: entities_in_document
async function entitiesInDocument(
  documentId: string,
  projectId: string
): Promise<Array<{ entity_id: string; entity_name: string; entity_type: string; description: string }>> {
  try {
    const links = await invoke("db_get_links_by_source", {
      sourceType: "document",
      sourceId: documentId
    }) as Array<{ target_id: string; target_type: string; link_type: string }>;

    const entityLinks = links.filter((l) => l.link_type === "extracted_from" && l.target_type === "entity");

    if (entityLinks.length === 0) {
      return [];
    }

    const entityIds = entityLinks.map((l) => l.target_id);

    const allEntities = await invoke("db_get_entities", { projectId }) as Array<{
      id: string;
      name: string;
      entity_type_id?: string;
      description?: string;
    }>;

    const allEntityTypes = await invoke("db_get_entity_types", { projectId }) as Array<{
      id: string;
      name: string;
    }>;
    const typeMap = new Map(allEntityTypes.map((t) => [t.id, t.name]));

    return allEntities
      .filter((e) => entityIds.includes(e.id))
      .map((e) => ({
        entity_id: e.id,
        entity_name: e.name,
        entity_type: e.entity_type_id ? (typeMap.get(e.entity_type_id) || "unknown") : "unknown",
        description: e.description || "",
      }));
  } catch (error) {
    console.error("entities_in_document failed:", error);
    return [];
  }
}

// Tool: read_project — read all documents in a project
async function readProject(
  projectId: string,
  maxLength: number = 0
): Promise<{
  project_id: string;
  sections: Array<{
    section_id: string;
    section_name: string;
    documents: Array<{
      document_id: string;
      title: string;
      text: string;
      word_count: number;
      truncated: boolean;
    }>;
  }>;
}> {
  const sections: Section[] = await invoke("db_get_sections", { projectId });

  const result = await Promise.all(sections.map(async (section) => {
    const docs: Document[] = await invoke("db_get_documents", { sectionId: section.id });

    const documents = docs.map((doc) => {
      let text: string;
      let truncated = false;
      try {
        const content = JSON.parse(doc.content_json);
        text = extractTextFromContent(content);
      } catch {
        text = doc.content_json || "";
      }
      if (maxLength > 0 && text.length > maxLength) {
        text = text.substring(0, maxLength) + `\n[... truncated, ${doc.word_count} total words]`;
        truncated = true;
      }
      return {
        document_id: doc.id,
        title: doc.title,
        text,
        word_count: doc.word_count,
        truncated,
      };
    });

    return {
      section_id: section.id,
      section_name: section.name,
      documents,
    };
  }));

  return { project_id: projectId, sections: result };
}

// Tool: read_section — read all documents in a section
async function readSection(
  sectionId: string,
  maxLength: number = 0
): Promise<{
  section_id: string;
  documents: Array<{
    document_id: string;
    title: string;
    text: string;
    word_count: number;
    truncated: boolean;
  }>;
}> {
  const docs: Document[] = await invoke("db_get_documents", { sectionId });

  const documents = docs.map((doc) => {
    let text: string;
    let truncated = false;
    try {
      const content = JSON.parse(doc.content_json);
      text = extractTextFromContent(content);
    } catch {
      text = doc.content_json || "";
    }
    if (maxLength > 0 && text.length > maxLength) {
      text = text.substring(0, maxLength) + `\n[... truncated, ${doc.word_count} total words]`;
      truncated = true;
    }
    return {
      document_id: doc.id,
      title: doc.title,
      text,
      word_count: doc.word_count,
      truncated,
    };
  });

  return { section_id: sectionId, documents };
}

// Tool: chat_search — search past chat messages via semantic similarity
async function chatSearch(
  query: string,
  projectId?: string,
  limit: number = 10
): Promise<Array<{ message_id: string; session_id: string; role: string; message_timestamp: number; content_text: string; project_id: string | null; distance: number }>> {
  try {
    const PREFERENCES_KEY = "aurawrite-preferences";
    const saved = localStorage.getItem(PREFERENCES_KEY);
    const prefs = saved ? JSON.parse(saved) : {};
    const baseUrl = prefs.aiBaseUrl || undefined;

    const queryVector: number[] = await invoke("embedding_generate", {
      text: query,
      isQuery: true,
      baseUrl,
    });

    // Get the current and recent session IDs for cross-session search
    const sessions = await invoke<Array<{ session_id: string; message_count: number; last_timestamp: number }>>(
      "chat_list_recent_sessions",
      { limit: 10 }
    );

    if (sessions.length === 0) {
      return [];
    }

    const sessionIds = sessions.map((s) => s.session_id);

    const results = await invoke<Array<{ message_id: string; session_id: string; role: string; message_timestamp: number; content_text: string; project_id: string | null; distance: number }>>(
      "embedding_search_chat_messages_cross_session",
      {
        sessionIds,
        projectId: projectId || null,
        queryVector,
        limit,
      }
    );

    return results;
  } catch (error) {
    console.error("Chat search failed:", error);
    return [{ message_id: "error", session_id: "", role: "system", message_timestamp: Date.now(), content_text: `Chat search failed: ${error instanceof Error ? error.message : String(error)}. This usually means the embedding model is not running. Try starting the local AI server or using a different search method.`, project_id: null, distance: 999 }];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((node) => extractTextFromNode(node)).join(" ");
  }

  return "";
}

function extractTextFromNode(node: unknown): string {
  if (typeof node === "string") {
    return node;
  }

  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;

    if (obj.text && typeof obj.text === "string") {
      return obj.text;
    }

    if (obj.content && Array.isArray(obj.content)) {
      return obj.content
        .map((child) => extractTextFromNode(child))
        .join("");
    }
  }

  return "";
}

// ============================================================================
// Tool Executor
// ============================================================================

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  result: unknown;
  error?: string;
}

// Accepted mark names are normalized to the schema's canonical names. This
// tolerates the aliases models tend to emit (bold/b, italic/i, strike/s/del).
const MARK_ALIASES: Record<string, string> = {
  bold: "strong", b: "strong", strong: "strong",
  italic: "em", italics: "em", i: "em", em: "em",
  strike: "strikethrough", strikethrough: "strikethrough", s: "strikethrough", del: "strikethrough",
  underline: "underline", u: "underline",
  code: "code",
  link: "link",
};

function resolveMark(
  schema: EditorView["state"]["schema"],
  name: string,
  href?: string,
): import("prosemirror-model").Mark | null {
  const canonical = MARK_ALIASES[(name || "").toLowerCase().trim()];
  if (!canonical) return null;
  const marks = schema.marks as Record<string, { create: (attrs?: Record<string, unknown>) => import("prosemirror-model").Mark } | undefined>;
  const spec = marks[canonical];
  if (!spec) return null;
  if (canonical === "link") {
    return href ? spec.create({ href }) : null;
  }
  return spec.create();
}

function resolveMarkType(
  schema: EditorView["state"]["schema"],
  name: string,
): import("prosemirror-model").MarkType | null {
  const canonical = MARK_ALIASES[(name || "").toLowerCase().trim()];
  if (!canonical) return null;
  const marks = schema.marks as Record<string, import("prosemirror-model").MarkType | undefined>;
  return marks[canonical] ?? null;
}

// Build a ProseMirror Fragment from a Markdown string using the editor schema.
function markdownToFragment(
  schema: EditorView["state"]["schema"],
  markdown: string,
): import("prosemirror-model").Fragment {
  const json = fromMarkdown(markdown || "");
  // fromMarkdown returns { type: "doc", content: [...] } in serialized form.
  const pmDoc = schema.nodeFromJSON(json);
  return pmDoc.content;
}

// editor_edit executor: writes into the live document via ProseMirror
// transactions. Each action dispatches exactly one transaction, so the whole
// edit is undoable with a single Ctrl+Z.
function executeEditorEdit(
  args: Record<string, unknown>,
  editorView: EditorView | undefined,
  selection: { from: number; to: number; text: string } | null | undefined,
): ToolResult {
  if (!editorView) {
    return { tool: "editor_edit", result: null, error: "No document is open in the editor." };
  }
  const view = editorView;
  const schema = view.state.schema;
  const action = (args.action as string) || "";

  const requireText = (key: string): string => (args[key] as string) || "";

  try {
    switch (action) {
      case "replace_document": {
        const content = requireText("content");
        const frag = markdownToFragment(schema, content);
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, frag);
        view.dispatch(tr);
        notifyDocumentChange({ from: 0, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Document replaced with ${content.length} chars of Markdown.` };
      }
      case "replace_selection": {
        const sel = selection && selection.text ? selection : null;
        if (!sel) {
          return {
            tool: "editor_edit",
            result: null,
            error: "No text is selected in the editor. Ask the user to select the target text first, or use insert_at_anchor / replace_document instead.",
          };
        }
        const content = requireText("content");
        const frag = markdownToFragment(schema, content);
        const tr = view.state.tr.replaceWith(sel.from, sel.to, frag);
        view.dispatch(tr);
        notifyDocumentChange({ from: sel.from, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Replaced the selected text (${sel.text.length} chars) with the new content.` };
      }
      case "insert_at_cursor": {
        const content = requireText("content");
        // Insert as a sibling block right after the block that holds the caret,
        // so a new paragraph is created instead of splicing block content into
        // the middle of a text node.
        const $head = view.state.doc.resolve(view.state.selection.from);
        const target = $head.after($head.depth);
        const frag = markdownToFragment(schema, content);
        const tr = view.state.tr.insert(target, frag);
        view.dispatch(tr);
        notifyDocumentChange({ from: target, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Inserted at the cursor (new block at position ${target}).` };
      }
      case "insert_at_end": {
        const content = requireText("content");
        const pos = view.state.doc.content.size;
        const frag = markdownToFragment(schema, content);
        const tr = view.state.tr.insert(pos, frag);
        view.dispatch(tr);
        notifyDocumentChange({ from: pos, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Inserted at the end of the document (position ${pos}).` };
      }
      case "insert_at_anchor": {
        const anchor = requireText("anchor");
        const position = (args.position as string) === "before" ? "before" : "after";
        if (!anchor) {
          return { tool: "editor_edit", result: null, error: "insert_at_anchor requires 'anchor': a snippet of text already in the document, quoted exactly." };
        }
        const found = findTextInDoc(view, anchor);
        if (!found) {
          return { tool: "editor_edit", result: null, error: `Anchor text not found in the document: "${anchor.slice(0, 60)}${anchor.length > 60 ? "..." : ""}". Quote the text exactly as it appears.` };
        }
        // Insert at a block boundary (before/after the block that holds the
        // anchor) so new paragraphs land as clean siblings, not spliced into a
        // text run.
        const $anchor = view.state.doc.resolve(position === "after" ? found.to : found.from);
        const target = position === "after" ? $anchor.after($anchor.depth) : $anchor.before($anchor.depth);
        const content = requireText("content");
        const frag = markdownToFragment(schema, content);
        const tr = view.state.tr.insert(target, frag);
        view.dispatch(tr);
        notifyDocumentChange({ from: target, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Inserted ${position} the anchor (position ${target}).` };
      }
      case "format": {
        const find = requireText("find") || requireText("anchor");
        if (!find) {
          return { tool: "editor_edit", result: null, error: "format requires 'find': the exact text already in the document to format." };
        }
        const found = findTextInDoc(view, find);
        if (!found) {
          return { tool: "editor_edit", result: null, error: `Text to format not found: "${find.slice(0, 60)}${find.length > 60 ? "..." : ""}".` };
        }
        const addName = requireText("mark");
        const removeName = requireText("remove_mark");
        const href = requireText("href");
        const addMark = addName ? resolveMark(schema, addName, href) : null;
        const removeType = removeName ? resolveMarkType(schema, removeName) : null;
        if (!addMark && !removeType) {
          return { tool: "editor_edit", result: null, error: "format requires 'mark' (e.g. strong, em, underline, code, link) to add, or 'remove_mark' to remove." };
        }
        let tr = view.state.tr;
        if (addMark) tr = tr.addMark(found.from, found.to, addMark);
        if (removeType) tr = tr.removeMark(found.from, found.to, removeType);
        view.dispatch(tr);
        notifyDocumentChange({ from: found.from, oldLen: 0, newLen: 0 }, "ai_assistant");
        const tags = [addName, removeName].filter(Boolean).join(", ");
        return { tool: "editor_edit", result: `Formatted the text (${tags || "mark"}).` };
      }
      case "delete": {
        const find = requireText("find");
        if (!find) {
          return { tool: "editor_edit", result: null, error: "delete requires 'find': the exact text to remove." };
        }
        const found = findTextInDoc(view, find);
        if (!found) {
          return { tool: "editor_edit", result: null, error: `Text to delete not found: "${find.slice(0, 60)}${find.length > 60 ? "..." : ""}".` };
        }
        const tr = view.state.tr.delete(found.from, found.to);
        view.dispatch(tr);
        notifyDocumentChange({ from: found.from, oldLen: 0, newLen: 0 }, "ai_assistant");
        return { tool: "editor_edit", result: `Deleted the text (${find.length} chars).` };
      }
      default:
        return { tool: "editor_edit", result: null, error: `Unknown editor action: "${action}". Valid: replace_document, replace_selection, insert_at_cursor, insert_at_end, insert_at_anchor, format, delete.` };
    }
  } catch (e) {
    return { tool: "editor_edit", result: null, error: `Editor edit failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function executeTool(
  toolCall: ToolCall,
  prefs: ToolPreferences = {}
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

  const plannerEnabled = prefs.plannerEnabled !== false;
  const webSearchEnabled = prefs.webSearchEnabled !== false;
  const fileSystemEnabled = prefs.fileSystemEnabled !== false;
  const ragEnabled = prefs.ragEnabled === true;
  const shellExecEnabled = prefs.shellExecEnabled === true;

  if (!plannerEnabled && name.startsWith("plan_")) {
    return { tool: name, result: null, error: "Planner tool is disabled. Enable it in Settings > Agent." };
  }
  if (!webSearchEnabled && name === "web_query") {
    return { tool: name, result: null, error: "Web search tools are disabled. Enable them in Settings > Agent." };
  }
  if (!fileSystemEnabled && name === "file") {
    return { tool: name, result: null, error: "File system tools are disabled. Enable them in Settings > Agent." };
  }
  if (!ragEnabled && name === "rag") {
    return { tool: name, result: null, error: "RAG tools are disabled. Enable them in Settings > Agent." };
  }
  if (!shellExecEnabled && (name === "exec" || name === "exec_job")) {
    return { tool: name, result: null, error: "Shell execution is disabled. Enable it in Settings > Agent." };
  }

  try {
    let result: unknown;
    // `tool` is the name returned to the chat (cards, events). For consolidated
    // tools we return the granular action name so chat.ts prefix-based event
    // dispatch (plan_, wiki_, web_) keeps working unchanged.
    let tool = name;

    switch (name) {
      // ====== Editor ======
      case "editor_edit":
        return executeEditorEdit(args, prefs.editorView, prefs.selection);

      // ====== Entities ======
      case "entity_query": {
        const action = (args.action as string) || "";
        const projectId = (args.project_id as string) || "";
        switch (action) {
          case "search":
            result = await searchEntities(projectId, (args.query as string) || "", args.entity_type as string | undefined, (args.limit as number) || 10);
            tool = "search_entities"; break;
          case "get":
            result = await getEntityDetails((args.entity_id as string) || ""); tool = "get_entity_details"; break;
          case "list_by_type":
            result = await listEntitiesByType(projectId, (args.entity_type as string) || ""); tool = "list_entities_by_type"; break;
          case "in_document":
            result = await entitiesInDocument((args.document_id as string) || "", projectId); tool = "entities_in_document"; break;
          case "semantic":
            result = await semanticSearchEntities(projectId, (args.query as string) || "", (args.limit as number) || 5); tool = "semantic_search_entities"; break;
          case "embeddings":
            result = await getEmbeddingsForEntity((args.entity_id_type as string) || "entity", (args.entity_id as string) || ""); tool = "get_entity_embeddings"; break;
          default:
            return { tool: name, result: null, error: `Unknown entity_query action: "${action}"` };
        }
        break;
      }

      // ====== Documents ======
      case "document_query": {
        const action = (args.action as string) || "";
        const projectId = (args.project_id as string) || "";
        switch (action) {
          case "search":
            result = await searchDocuments(projectId, (args.query as string) || "", args.section_id as string | undefined, (args.limit as number) || 10);
            tool = "search_documents"; break;
          case "get_content":
            result = await getDocumentContent((args.document_id as string) || ""); tool = "get_document_content"; break;
          case "get_structure":
            result = await getProjectStructure(projectId); tool = "get_project_structure"; break;
          case "semantic":
            result = await semanticSearch(projectId, (args.query as string) || "", (args.limit as number) || 5); tool = "semantic_search"; break;
          default:
            return { tool: name, result: null, error: `Unknown document_query action: "${action}"` };
        }
        break;
      }

      // ====== Read scope ======
      case "read_scope": {
        const action = (args.action as string) || "";
        switch (action) {
          case "project":
            result = await readProject((args.project_id as string) || "", (args.max_length as number) || 0); tool = "read_project"; break;
          case "section":
            result = await readSection((args.section_id as string) || "", (args.max_length as number) || 0); tool = "read_section"; break;
          default:
            return { tool: name, result: null, error: `Unknown read_scope action: "${action}"` };
        }
        break;
      }

      // ====== Chat history ======
      case "chat_history": {
        const action = (args.action as string) || "";
        switch (action) {
          case "search":
            result = await chatSearch((args.query as string) || "", (args.project_id as string) || undefined, (args.limit as number) || 10); tool = "chat_search"; break;
          case "list_sessions":
            result = await invoke<Array<{ session_id: string; message_count: number; last_timestamp: number; first_timestamp: number }>>("chat_list_recent_sessions", { limit: (args.limit as number) || 20 });
            tool = "chat_list_sessions"; break;
          case "get_messages":
            result = await invoke<Array<{ id: string; session_id: string; role: string; content: string; project_id: string | null; timestamp: number }>>("chat_get_messages_by_session", { sessionId: (args.session_id as string) || "" });
            tool = "chat_get_session_messages"; break;
          default:
            return { tool: name, result: null, error: `Unknown chat_history action: "${action}"` };
        }
        break;
      }

      // ====== Planner CRUD ======
      case "plan_manage": {
        const action = (args.action as string) || "";
        switch (action) {
          case "create":
            result = await invoke<string>("plan_create", { name: (args.name as string) || "", content: (args.content as string) || "" }); tool = "plan_create"; break;
          case "read":
            result = await invoke<string>("plan_read", { name: (args.name as string) || "" }); tool = "plan_read"; break;
          case "list":
            result = await invoke<string[]>("plan_list"); tool = "plan_list"; break;
          case "update":
            result = await invoke<string>("plan_update", { name: (args.name as string) || "", content: (args.content as string) || "" }); tool = "plan_update"; break;
          case "delete":
            result = await invoke<string>("plan_delete", { name: (args.name as string) || "" }); tool = "plan_delete"; break;
          default:
            return { tool: name, result: null, error: `Unknown plan_manage action: "${action}"` };
        }
        break;
      }

      // ====== Planner progress ======
      case "plan_progress": {
        const action = (args.action as string) || "";
        switch (action) {
          case "next":
            result = await invoke<string>("plan_next", { name: (args.name as string) || "", answer: (args.answer as string) || undefined }); tool = "plan_next"; break;
          case "status":
            result = await invoke<string>("plan_status", { name: (args.name as string) || "" }); tool = "plan_status"; break;
          default:
            return { tool: name, result: null, error: `Unknown plan_progress action: "${action}"` };
        }
        break;
      }

      // ====== Web ======
      case "web_query": {
        const action = (args.action as string) || "";
        switch (action) {
          case "search":
            result = await withTimeout(invoke<string>("web_search", { query: (args.query as string) || "", limit: (args.limit as number) || 10 }), WEB_TOOL_TIMEOUT_MS, "web_search"); tool = "web_search"; break;
          case "fetch":
            result = await withTimeout(invoke<string>("web_fetch", { url: (args.url as string) || "", format: (args.format as string) || "markdown" }), WEB_TOOL_TIMEOUT_MS, "web_fetch"); tool = "web_fetch"; break;
          case "images":
            result = await withTimeout(invoke<string>("web_search_images", { query: (args.query as string) || "", limit: (args.limit as number) || 10 }), WEB_TOOL_TIMEOUT_MS, "web_search_images"); tool = "web_search_images"; break;
          default:
            return { tool: name, result: null, error: `Unknown web_query action: "${action}"` };
        }
        break;
      }

      // ====== Wiki read ======
      case "wiki_query": {
        const action = (args.action as string) || "";
        switch (action) {
          case "search":
            result = await invoke<string>("wiki_search", { query: (args.query as string) || "", limit: (args.limit as number) || 20 }); tool = "wiki_search"; break;
          case "read":
            result = await invoke<string>("wiki_read", { name: (args.name as string) || "" }); tool = "wiki_read"; break;
          case "list":
            result = await invoke<string>("wiki_list"); tool = "wiki_list"; break;
          default:
            return { tool: name, result: null, error: `Unknown wiki_query action: "${action}"` };
        }
        break;
      }

      // ====== Wiki write ======
      case "wiki_write": {
        const action = (args.action as string) || "";
        switch (action) {
          case "page":
            result = await invoke<string>("wiki_write", { name: (args.name as string) || "", content: (args.content as string) || "", frontmatter: args.frontmatter || null }); tool = "wiki_write"; break;
          case "ingest":
            result = await invoke<string>("wiki_ingest", { pages: args.pages as Array<{ name: string; content: string; frontmatter?: unknown }> || [] }); tool = "wiki_ingest"; break;
          default:
            return { tool: name, result: null, error: `Unknown wiki_write action: "${action}"` };
        }
        break;
      }

      // ====== Filesystem ======
      case "file": {
        const action = (args.action as string) || "";
        const filePath = (args.path as string) || "";
        switch (action) {
          case "read": {
            if (isAbsolutePath(filePath)) {
              const allowed = await requestPermission("file_read", filePath);
              if (!allowed) return { tool: "file_read", result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
            }
            result = await invoke<string>("file_read", { path: filePath }); tool = "file_read"; break;
          }
          case "write": {
            if (isAbsolutePath(filePath)) {
              const allowed = await requestPermission("file_write", filePath);
              if (!allowed) return { tool: "file_write", result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
            }
            result = await invoke<string>("file_write", { path: filePath, content: (args.content as string) || "" }); tool = "file_write"; break;
          }
          case "list": {
            const dirPath = filePath || ".";
            if (isAbsolutePath(dirPath)) {
              const allowed = await requestPermission("file_list", dirPath);
              if (!allowed) return { tool: "file_list", result: null, error: `Permission denied: user did not grant access to '${dirPath}'.` };
            }
            result = await invoke<string>("file_list", { path: dirPath }); tool = "file_list"; break;
          }
          case "edit": {
            if (isAbsolutePath(filePath)) {
              const allowed = await requestPermission("file_edit", filePath);
              if (!allowed) return { tool: "file_edit", result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
            }
            result = await invoke<string>("file_edit", { path: filePath, edits: args.edits as Array<{ old_text: string; new_text: string }> || [] }); tool = "file_edit"; break;
          }
          default:
            return { tool: name, result: null, error: `Unknown file action: "${action}"` };
        }
        break;
      }

      // ====== RAG ======
      case "rag": {
        const action = (args.action as string) || "";
        const projectId = (args.project_id as string) || "";
        switch (action) {
          case "add":
            result = await invoke<string>("rag_add", { projectId, entityType: (args.entity_type as string) || "", entityId: (args.entity_id as string) || "", contentText: (args.content_text as string) || "" }); tool = "rag_add"; break;
          case "search":
            result = await invoke<string>("rag_search", { projectId, query: (args.query as string) || "", limit: (args.limit as number) || 10 }); tool = "rag_search"; break;
          case "list":
            result = await invoke<string>("rag_list", { projectId }); tool = "rag_list"; break;
          case "delete":
            result = await invoke<string>("rag_delete", { projectId, entityType: (args.entity_type as string) || "", entityId: (args.entity_id as string) || "" }); tool = "rag_delete"; break;
          default:
            return { tool: name, result: null, error: `Unknown rag action: "${action}"` };
        }
        break;
      }

      // ====== Shell exec ======
      case "exec": {
        const command = (args.command as string) || "";
        const allowed = await requestPermission("exec", command);
        if (!allowed) return { tool: "exec", result: null, error: `Permission denied: user did not grant permission to execute '${command}'.` };
        result = await invoke<string>("exec", {
          command,
          workdir: (args.workdir as string) || null,
          timeout: (args.timeout as number) || null,
          background: (args.background as boolean) || null,
          env: (args.env as Record<string, string>) || null,
        });
        tool = "exec";
        break;
      }

      case "exec_job": {
        const action = (args.action as string) || "";
        switch (action) {
          case "poll":
            result = await invoke<string>("exec_poll", { jobId: (args.job_id as string) || "", tail: (args.tail as number) || null }); tool = "exec_poll"; break;
          case "kill":
            result = await invoke<string>("exec_kill", { jobId: (args.job_id as string) || "" }); tool = "exec_kill"; break;
          case "list":
            result = await invoke<string>("exec_list"); tool = "exec_list"; break;
          case "clean":
            result = await invoke<string>("exec_clean", { maxAgeHours: (args.max_age_hours as number) || null, all: (args.all as boolean) || null }); tool = "exec_clean"; break;
          default:
            return { tool: name, result: null, error: `Unknown exec_job action: "${action}"` };
        }
        break;
      }

      default:
        return { tool: name, result: null, error: `Unknown tool: ${name}` };
    }

    return { tool, result };
  } catch (error) {
    return { tool: name, result: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// Tool Calling Parser
// ============================================================================

/**
 * Parse tool calls from AI response
 * Supports format: <tool name="search_entities">{"project_id": "...", "query": "..."}</tool>
 */
export function parseToolCalls(response: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const tagRegex = /<tool\s+name="([^"]+)">\s*/g;

  let tagMatch;
  while ((tagMatch = tagRegex.exec(response)) !== null) {
    const name = tagMatch[1];
    const startIndex = tagMatch.index + tagMatch[0].length;

    if (response[startIndex] !== "{") continue;

    let braceCount = 0;
    let jsonEnd = -1;
    for (let i = startIndex; i < response.length; i++) {
      if (response[i] === "{") braceCount++;
      else if (response[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }

    if (jsonEnd === -1) continue;

    const jsonStr = response.slice(startIndex, jsonEnd);
    try {
      const args = JSON.parse(jsonStr);
      toolCalls.push({ name, arguments: args });
    } catch {
      // Ignore malformed tool calls
    }
  }

  return toolCalls;
}

/**
 * Build system prompt with available tools
 */
export interface ToolPreferences {
  plannerEnabled?: boolean;
  webSearchEnabled?: boolean;
  fileSystemEnabled?: boolean;
  shellExecEnabled?: boolean;
  ragEnabled?: boolean;
  editorView?: EditorView;
  selection?: { from: number; to: number; text: string };
}

export function buildToolSystemPrompt(projectId?: string, prefs: ToolPreferences = {}): string {
  const plannerEnabled = prefs.plannerEnabled !== false;
  const webSearchEnabled = prefs.webSearchEnabled !== false;
  const fileSystemEnabled = prefs.fileSystemEnabled !== false;
  const shellExecEnabled = prefs.shellExecEnabled === true;
  const ragEnabled = prefs.ragEnabled === true;
  const pid = projectId || "PROJECT_ID";
  const projectInfo = projectId
    ? `\nThe current project ID is: "${projectId}". Use it as the project_id parameter.`
    : "";
  const hasProject = !!projectId;

  // NOTE: the full, verbose version of the original (per-tool) prompt is
  // preserved in documentation/tool-prompt-backup-full-2026-06-25.md. The
  // surface was consolidated 43 → 14 (see concepts/tools-consolidation.md).
  return `You are AuraWrite AI, an intelligent writing assistant with access to tools.
${projectInfo}
${hasProject ? `When the user asks about characters, locations, events, or anything project-related, you MUST call the database tools before answering. Never say "no entities found" without calling a tool first. Always pass the open project's ID as project_id; never use other projects' entities.` : "No project is open. Project-specific tools (entities, documents, semantic search) need a project_id. Wiki, web, file, planner, and editor tools are always available."}

WRITING INTO THE DOCUMENT (most important rule):
When the user asks you to add, insert, append, rewrite, replace, rephrase, delete, or format text in the document — or anything that means "put this in the editor" — you MUST call the editor_edit tool. Do NOT answer with prose, do NOT show the text in chat with markdown asterisks, do NOT wrap it in a quote block. The text goes ONLY inside the editor_edit call's content (as Markdown). After the call, reply in chat with ONE short sentence saying what you did. If the user did not select text and you need a target, use insert_at_cursor, insert_at_end, or insert_at_anchor.

Available tools (each takes an "action" parameter):
${AVAILABLE_TOOLS
    .filter((tool) => {
      if (!plannerEnabled && tool.name.startsWith("plan_")) return false;
      if (!webSearchEnabled && tool.name === "web_query") return false;
      if (!fileSystemEnabled && tool.name === "file") return false;
      if (!ragEnabled && tool.name === "rag") return false;
      if (!shellExecEnabled && (tool.name === "exec" || tool.name === "exec_job")) return false;
      return true;
    })
    .map((tool) => `- ${tool.name}: ${tool.description} Params: ${Object.keys(tool.parameters.properties).join(", ")}`)
    .join("\n")}

To call a tool, emit this tag with one-line JSON. Multiple tools per response are allowed:
<tool name="TOOL_NAME">{"action": "...", "param": "value"}</tool>

=== PATTERNS (adapt to the user's language) ===
- Write text into the document (ALWAYS use this, never prose):
  <tool name="editor_edit">{"action": "insert_at_end", "content": "A new paragraph **with bold**."}</tool>
  <tool name="editor_edit">{"action": "insert_at_cursor", "content": "Inserted where the caret is."}</tool>
  <tool name="editor_edit">{"action": "insert_at_anchor", "anchor": "the exact sentence already in the doc", "position": "after", "content": "Inserted right after it."}</tool>
  <tool name="editor_edit">{"action": "replace_selection", "content": "Rewritten version of the selected text."}</tool>
  <tool name="editor_edit">{"action": "replace_document", "content": "# Full new document\\n\\nRewritten end to end, with **changed phrases in bold**."}</tool>
  <tool name="editor_edit">{"action": "format", "find": "exact text already in the doc", "mark": "strong"}</tool>
  <tool name="editor_edit">{"action": "delete", "find": "exact text to remove"}</tool>
- Entity by TYPE: <tool name="entity_query">{"action": "list_by_type", "project_id": "${pid}", "entity_type": "Character"}</tool>
- Find a SPECIFIC name: <tool name="entity_query">{"action": "search", "project_id": "${pid}", "query": "Pippo"}</tool> then get with entity_id
- Read project/section text: <tool name="read_scope">{"action": "project", "project_id": "${pid}"}</tool> or <tool name="read_scope">{"action": "section", "section_id": "SECTION_ID"}</tool>
- Recall a past decision: <tool name="chat_history">{"action": "search", "query": "magic system decisions"${hasProject ? `, "project_id": "${pid}"` : ""}}</tool>
- Entity type names may be plural ("Characters") or singular ("Character"); both accepted.
${plannerEnabled ? `- Planner: <tool name="plan_manage">{"action": "create", "name": "x", "content": "..."}</tool>, <tool name="plan_progress">{"action": "next", "name": "x"}</tool>` : ""}
${webSearchEnabled ? `- Web: <tool name="web_query">{"action": "search", "query": "...", "limit": 5}</tool>, <tool name="web_query">{"action": "fetch", "url": "..."}</tool>` : ""}
${fileSystemEnabled ? `- Files: <tool name="file">{"action": "read", "path": "notes/x.md"}</tool>, <tool name="file">{"action": "write", "path": "drafts/x.md", "content": "..."}</tool>` : ""}
${ragEnabled ? `- RAG: <tool name="rag">{"action": "add", "project_id": "${pid}", "entity_type": "wiki", "entity_id": "x", "content_text": "..."}</tool>, <tool name="rag">{"action": "search", "project_id": "${pid}", "query": "..."}</tool>` : ""}
- Wiki: <tool name="wiki_query">{"action": "search", "query": "..."}</tool>, <tool name="wiki_write">{"action": "page", "name": "page", "content": "..."}</tool>

=== RULES ===
- After tool results, summarize them naturally for the user in ONE short sentence.
- The document text and any selected text are already in your context. To CHANGE the document, call editor_edit — never echo the text in chat.
${plannerEnabled ? `
=== PLANNER RULES (MANDATORY) ===
Plans appear in the MCP panel (🧩 in the status bar); the user interacts there. Your chat response after a planner tool call MUST be 1-2 short sentences — confirm the action in one line and STOP:
- plan_manage create: "Plan '[name]' created with X tasks — see the MCP panel (🧩)."
- plan_progress next: "Completed: [task]. Next: [task]."
- plan_progress status: "X/Y tasks completed (Z%)."
- plan_manage read/update/list: confirm in one line.
NEVER output the plan content, task lists, or markdown in chat — the MCP panel already shows it.` : ""}`;
}
