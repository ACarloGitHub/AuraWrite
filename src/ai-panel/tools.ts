// ============================================================================
// Tool Calling for AuraWrite AI
// AI can query the database using structured tools
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { requestPermission } from "./permissions";

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
// Tool Definitions (for AI)
// ============================================================================

export const AVAILABLE_TOOLS = [
  {
    name: "search_entities",
    description: "Search for entities (characters, locations, objects, etc.) by name or description",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID to search in"
        },
        query: {
          type: "string",
          description: "Search query - name or partial name of the entity"
        },
        entity_type: {
          type: "string",
          description: "Optional: filter by entity type name (e.g., 'character', 'location')"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "get_entity_details",
    description: "Get full details of a specific entity",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "The entity ID"
        }
      },
      required: ["entity_id"]
    }
  },
  {
    name: "list_entities_by_type",
    description: "List all entities of a specific type",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        entity_type: {
          type: "string",
          description: "The entity type name"
        }
      },
      required: ["project_id", "entity_type"]
    }
  },
  {
    name: "search_documents",
    description: "Search documents by title or content",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        query: {
          type: "string",
          description: "Search query"
        },
        section_id: {
          type: "string",
          description: "Optional: filter by section ID"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "get_document_content",
    description: "Get the full content of a specific document",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The document ID"
        }
      },
      required: ["document_id"]
    }
  },
  {
    name: "get_project_structure",
    description: "Get the full structure of a project (sections and documents)",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "semantic_search",
    description: "Search for semantically similar content using vector embeddings (requires Ollama)",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        query: {
          type: "string",
          description: "Natural language query"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 5)",
          default: 5
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "semantic_search_entities",
    description: "Search for semantically similar entities (characters, locations, objects, events, themes, recipes, etc.) using vector embeddings. Unlike semantic_search which searches documents, this only searches entity embeddings.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        query: {
          type: "string",
          description: "Natural language query about entities (e.g. 'a brave warrior', 'a cozy Italian recipe')"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 5)",
          default: 5
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "get_entity_embeddings",
    description: "Get all embedding chunks for a specific entity. Returns the text chunks that were indexed for a character, location, recipe, etc. Useful for understanding what information is stored about an entity.",
    parameters: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          description: "The type of entity (e.g. 'entity', 'document')"
        },
        entity_id: {
          type: "string",
          description: "The ID of the entity"
        }
      },
      required: ["entity_type", "entity_id"]
    }
  },
  {
    name: "entities_in_document",
    description: "Get all entities extracted from a specific document. Use this to find which characters, locations, etc. appear in a particular chapter or section.",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The document ID to get entities for"
        },
        project_id: {
          type: "string",
          description: "The project ID (needed to look up entities)"
        }
      },
      required: ["document_id", "project_id"]
    }
  },
  {
    name: "read_project",
    description: "Read all documents in a project. Returns the full text content of every document, organized by section. Use this when the user asks to read the entire project or wants a comprehensive understanding of all content.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        max_length: {
          type: "number",
          description: "Maximum characters per document (0 = no limit, default 0). Documents exceeding this are truncated with a note.",
          default: 0
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "read_section",
    description: "Read all documents in a specific section. Returns the full text content of every document in that section. Use this when the user wants to read a specific section or chapter.",
    parameters: {
      type: "object",
      properties: {
        section_id: {
          type: "string",
          description: "The section ID"
        },
        max_length: {
          type: "number",
          description: "Maximum characters per document (0 = no limit, default 0). Documents exceeding this are truncated with a note.",
          default: 0
        }
      },
      required: ["section_id"]
    }
  },
  {
    name: "plan_create",
    description: "Create a new plan with tasks as markdown checkboxes. Tasks use '- [ ]' for open and '- [x]' for completed. Questions for the user use '- [ ] Question (for user): ...'",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name (used as filename, e.g. 'chapter-outline')"
        },
        content: {
          type: "string",
          description: "Plan content in markdown with checkboxes. Start with 'status: active' and use '- [ ]' for tasks, '- [ ] Question (for user): ...' for blocking questions"
        }
      },
      required: ["name", "content"]
    }
  },
  {
    name: "plan_read",
    description: "Read the content of an existing plan",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name to read"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "plan_list",
    description: "List all existing plans",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "plan_update",
    description: "Update an existing plan with new content (overwrites entire plan)",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name to update"
        },
        content: {
          type: "string",
          description: "New plan content in markdown"
        }
      },
      required: ["name", "content"]
    }
  },
  {
    name: "plan_delete",
    description: "Delete a plan",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name to delete"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "plan_next",
    description: "Mark the first unchecked task as completed and return the next task. If all tasks are done, marks the plan as completed. If there is a blocking question, returns it for the user to answer.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name"
        },
        answer: {
          type: "string",
          description: "Answer to a blocking question (optional, only if the plan has a question for the user)"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "plan_status",
    description: "Get the status of a plan: total tasks, completed, remaining, progress percentage, and any blocking question",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Plan name"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "chat_search",
    description: "Search past chat messages using semantic similarity. Finds relevant previous conversations even across sessions. Use this when you need specific details that were discussed earlier but are no longer in the active conversation context (because they were compacted into a summary). Returns the original full messages, not summaries.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query describing what you're looking for (e.g. 'the discussion about the magic system', 'character names mentioned for the protagonist')"
        },
        project_id: {
          type: "string",
          description: "Optional: filter results to a specific project ID"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10
        }
      },
      required: ["query"]
    }
  },
  {
    name: "chat_list_sessions",
    description: "List recent chat sessions. Returns session ID, message count, first and last message timestamps. Use this to browse conversation history or find a specific session before reading its messages with chat_get_session_messages.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of sessions to return (default: 20)",
          default: 20
        }
      },
      required: []
    }
  },
  {
    name: "chat_get_session_messages",
    description: "Get all messages from a specific chat session. Returns the full conversation including user and assistant messages in chronological order. Use chat_list_sessions first to find the session ID.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "The session ID to retrieve messages for"
        }
      },
      required: ["session_id"]
    }
  },
  // ====== Web tools (native MCP) ======
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo (or Brave Search API if configured). Returns an array of results with title, url, and snippet.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 20)",
          default: 10
        }
      },
      required: ["query"]
    }
  },
  {
    name: "web_fetch",
    description: "Fetch the content of a URL and return it as markdown or plain text. Useful for reading web pages, articles, documentation. Timeout: 30s. Content limit: 200KB.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch"
        },
        format: {
          type: "string",
          description: "Output format: 'markdown' (default) or 'text'",
          default: "markdown"
        }
      },
      required: ["url"]
    }
  },
  {
    name: "web_search_images",
    description: "Search for images on the web. Returns an array of results with url, title, thumbnail_url, width, height, and source.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Image search query"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10, max: 20)",
          default: 10
        }
      },
      required: ["query"]
    }
  },
  // ====== Wiki tools (native MCP) ======
  {
    name: "wiki_search",
    description: "Search the memory wiki (workspace/memory/) for pages matching a query. Performs recursive case-insensitive search in page content and names.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (case-insensitive)"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 20, max: 50)",
          default: 20
        }
      },
      required: ["query"]
    }
  },
  {
    name: "wiki_read",
    description: "Read a wiki page by name from the memory wiki (workspace/memory/). Returns the page content and optional YAML frontmatter.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The wiki page name (e.g. 'worldbuilding' or 'magic-system')"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "wiki_write",
    description: "Create or update a wiki page in the memory wiki (workspace/memory/). Content is markdown, optionally with YAML frontmatter.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The wiki page name (will be sanitized for filesystem)"
        },
        content: {
          type: "string",
          description: "The page content in markdown"
        },
        frontmatter: {
          type: "object",
          description: "Optional YAML frontmatter as a JSON object (e.g. {tags: ['magic', 'world'], created: '2025-01-01'})",
        }
      },
      required: ["name", "content"]
    }
  },
  {
    name: "wiki_list",
    description: "List all wiki pages in the memory wiki (workspace/memory/). Returns page names, paths, and preview content.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "wiki_ingest",
    description: "Create multiple wiki pages at once from source text. The AI decides the page structure and content, the tool saves them all. Use this to organize knowledge from a conversation into the memory wiki.",
    parameters: {
      type: "object",
      properties: {
        pages: {
          type: "array",
          description: "Array of wiki pages to create",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Page name" },
              content: { type: "string", description: "Page content in markdown" },
              frontmatter: { type: "object", description: "Optional YAML frontmatter" }
            },
            required: ["name", "content"]
          }
        }
      },
      required: ["pages"]
    }
  },
  // ====== File system tools (native MCP) ======
  {
    name: "file_read",
    description: "Read a file from the filesystem. By default confined to the workspace directory. Paths outside the workspace require user permission.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to workspace root, or absolute)"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "file_write",
    description: "Write content to a file. By default confined to the workspace directory. Paths outside the workspace require user permission. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to workspace root, or absolute)"
        },
        content: {
          type: "string",
          description: "The content to write"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "file_list",
    description: "List files and directories at a given path. By default confined to the workspace directory. Returns name, path, is_dir, and size.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path (relative to workspace root, or absolute)",
          default: "."
        }
      },
      required: []
    }
  },
  {
    name: "file_edit",
    description: "Edit a file by replacing specific text segments. By default confined to the workspace directory. Each edit specifies old_text to find and new_text to replace it with.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path (relative to workspace root, or absolute)"
        },
        edits: {
          type: "array",
          description: "Array of edit operations",
          items: {
            type: "object",
            properties: {
              old_text: { type: "string", description: "The text to find" },
              new_text: { type: "string", description: "The replacement text" }
            },
            required: ["old_text", "new_text"]
          }
        }
      },
      required: ["path", "edits"]
    }
  },
  // ====== RAG tools (native MCP) ======
  {
    name: "rag_add",
    description: "Index text content into the RAG vector database. Generates embeddings and saves chunks for later semantic search.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        entity_type: {
          type: "string",
          description: "Type of entity (e.g. 'wiki', 'note', 'external')"
        },
        entity_id: {
          type: "string",
          description: "Unique identifier for this entity"
        },
        content_text: {
          type: "string",
          description: "The text content to index"
        }
      },
      required: ["project_id", "entity_type", "entity_id", "content_text"]
    }
  },
  {
    name: "rag_search",
    description: "Search the RAG vector database by semantic similarity. Returns matching chunks sorted by relevance.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        query: {
          type: "string",
          description: "Natural language search query"
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "rag_list",
    description: "List all indexed entities in the RAG database for a project, with chunk counts and total characters.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "rag_delete",
    description: "Delete a specific entity from the RAG index. Removes all chunks associated with the entity. Use this when the user asks to forget or remove specific information from the AI's memory.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project ID"
        },
        entity_type: {
          type: "string",
          description: "The entity type (e.g., 'document', 'character', 'location')"
        },
        entity_id: {
          type: "string",
          description: "The entity ID to delete"
        }
      },
      required: ["project_id", "entity_type", "entity_id"]
    }
  },
  {
    name: "exec",
    description: "Execute a shell command. The command runs in the workspace directory by default. Use 'workdir' to specify a different directory. Always requires user confirmation before execution. Commands that could destroy data (rm -rf /, format, etc.) are blocked.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute"
        },
        workdir: {
          type: "string",
          description: "Working directory (relative to workspace or absolute path). Defaults to workspace root."
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 120, max: 7200)"
        },
        background: {
          type: "boolean",
          description: "Run command in background (default: false). Use exec_poll to check status, exec_kill to stop."
        },
        env: {
          type: "object",
          description: "Environment variables to set (key-value pairs)"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "exec_poll",
    description: "Check the status of a background command. Returns the last N lines of stdout/stderr.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The background job ID returned by exec"
        },
        tail: {
          type: "number",
          description: "Number of last lines to show (default: 100)"
        }
      },
      required: ["job_id"]
    }
  },
  {
    name: "exec_kill",
    description: "Kill a running background command.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The background job ID to kill"
        }
      },
      required: ["job_id"]
    }
  },
  {
    name: "exec_list",
    description: "List all background commands with their status.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "exec_clean",
    description: "Clean up old background command jobs. Removes completed jobs older than the specified age.",
    parameters: {
      type: "object",
      properties: {
        max_age_hours: {
          type: "number",
          description: "Remove jobs older than this many hours (default: 24)"
        },
        all: {
          type: "boolean",
          description: "Remove all jobs regardless of age (default: false)"
        }
      },
      required: []
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
    return {
      tool: name,
      result: null,
      error: "Planner tool is disabled. Enable it in Settings > Agent.",
    };
  }
  if (!webSearchEnabled && name.startsWith("web_")) {
    return {
      tool: name,
      result: null,
      error: "Web search tools are disabled. Enable them in Settings > Agent.",
    };
  }
  if (!fileSystemEnabled && name.startsWith("file_")) {
    return {
      tool: name,
      result: null,
      error: "File system tools are disabled. Enable them in Settings > Agent.",
    };
  }
  if (!ragEnabled && name.startsWith("rag_")) {
    return {
      tool: name,
      result: null,
      error: "RAG tools are disabled. Enable them in Settings > Agent.",
    };
  }
  if (!shellExecEnabled && name === "exec") {
    return {
      tool: name,
      result: null,
      error: "Shell execution is disabled. Enable it in Settings > Agent.",
    };
  }

  try {
    let result: unknown;

    switch (name) {
      case "search_entities":
        result = await searchEntities(
          args.project_id as string,
          args.query as string,
          args.entity_type as string | undefined,
          (args.limit as number) || 10
        );
        break;

      case "get_entity_details":
        result = await getEntityDetails(args.entity_id as string);
        break;

      case "list_entities_by_type":
        result = await listEntitiesByType(
          args.project_id as string,
          args.entity_type as string
        );
        break;

      case "search_documents":
        result = await searchDocuments(
          args.project_id as string,
          args.query as string,
          args.section_id as string | undefined,
          (args.limit as number) || 10
        );
        break;

      case "get_document_content":
        result = await getDocumentContent(args.document_id as string);
        break;

      case "get_project_structure":
        result = await getProjectStructure(args.project_id as string);
        break;

      case "semantic_search":
        result = await semanticSearch(
          args.project_id as string,
          args.query as string,
          (args.limit as number) || 5
        );
        break;

      case "semantic_search_entities":
        result = await semanticSearchEntities(
          args.project_id as string,
          args.query as string,
          (args.limit as number) || 5
        );
        break;

      case "get_entity_embeddings":
        result = await getEmbeddingsForEntity(
          args.entity_type as string,
          args.entity_id as string
        );
        break;

      case "entities_in_document":
        result = await entitiesInDocument(
          args.document_id as string,
          (args.project_id as string) || ""
        );
        break;

      case "read_project":
        result = await readProject(
          args.project_id as string,
          (args.max_length as number) || 0
        );
        break;

      case "read_section":
        result = await readSection(
          args.section_id as string,
          (args.max_length as number) || 0
        );
        break;

      case "plan_create":
        result = await invoke<string>("plan_create", {
          name: args.name as string,
          content: args.content as string,
        });
        break;

      case "plan_read":
        result = await invoke<string>("plan_read", {
          name: args.name as string,
        });
        break;

      case "plan_list":
        result = await invoke<string[]>("plan_list");
        break;

      case "plan_update":
        result = await invoke<string>("plan_update", {
          name: args.name as string,
          content: args.content as string,
        });
        break;

      case "plan_delete":
        result = await invoke<string>("plan_delete", {
          name: args.name as string,
        });
        break;

      case "plan_next":
        result = await invoke<string>("plan_next", {
          name: args.name as string,
          answer: args.answer as string | undefined,
        });
        break;

      case "plan_status":
        result = await invoke<string>("plan_status", {
          name: args.name as string,
        });
        break;

      case "chat_search":
        result = await chatSearch(
          args.query as string,
          (args.project_id as string) || undefined,
          (args.limit as number) || 10
        );
        break;

      case "chat_list_sessions":
        result = await invoke<Array<{session_id: string; message_count: number; last_timestamp: number; first_timestamp: number}>>("chat_list_recent_sessions", {
          limit: (args.limit as number) || 20,
        });
        break;

      case "chat_get_session_messages":
        result = await invoke<Array<{id: string; session_id: string; role: string; content: string; project_id: string | null; timestamp: number}>>("chat_get_messages_by_session", {
          sessionId: args.session_id as string,
        });
        break;

      // ====== Web tools (native MCP) ======
      // All return strings with [INSTRUCTION: ...] prefix (Tool Result Injection pattern)
      case "web_search":
        result = await withTimeout(
          invoke<string>("web_search", {
            query: args.query as string,
            limit: (args.limit as number) || 10,
          }),
          WEB_TOOL_TIMEOUT_MS,
          "web_search"
        );
        break;

      case "web_fetch":
        result = await withTimeout(
          invoke<string>("web_fetch", {
            url: args.url as string,
            format: (args.format as string) || "markdown",
          }),
          WEB_TOOL_TIMEOUT_MS,
          "web_fetch"
        );
        break;

      case "web_search_images":
        result = await withTimeout(
          invoke<string>("web_search_images", {
            query: args.query as string,
            limit: (args.limit as number) || 10,
          }),
          WEB_TOOL_TIMEOUT_MS,
          "web_search_images"
        );
        break;

      // ====== Wiki tools (native MCP) ======
      case "wiki_search":
        result = await invoke<string>("wiki_search", {
          query: args.query as string,
          limit: (args.limit as number) || 20,
        });
        break;

      case "wiki_read":
        result = await invoke<string>("wiki_read", {
          name: args.name as string,
        });
        break;

      case "wiki_write":
        result = await invoke<string>("wiki_write", {
          name: args.name as string,
          content: args.content as string,
          frontmatter: args.frontmatter || null,
        });
        break;

      case "wiki_list":
        result = await invoke<string>("wiki_list");
        break;

      case "wiki_ingest":
        result = await invoke<string>("wiki_ingest", {
          pages: args.pages as Array<{ name: string; content: string; frontmatter?: unknown }>,
        });
        break;

      // ====== File system tools (native MCP) ======
      case "file_read": {
        const filePath = args.path as string;
        if (isAbsolutePath(filePath)) {
          const allowed = await requestPermission("file_read", filePath);
          if (!allowed) {
            return { tool: name, result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
          }
        }
        result = await invoke<string>("file_read", {
          path: filePath,
        });
        break;
      }

      case "file_write": {
        const filePath = args.path as string;
        if (isAbsolutePath(filePath)) {
          const allowed = await requestPermission("file_write", filePath);
          if (!allowed) {
            return { tool: name, result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
          }
        }
        result = await invoke<string>("file_write", {
          path: filePath,
          content: args.content as string,
        });
        break;
      }

      case "file_list": {
        const dirPath = (args.path as string) || ".";
        if (isAbsolutePath(dirPath)) {
          const allowed = await requestPermission("file_list", dirPath);
          if (!allowed) {
            return { tool: name, result: null, error: `Permission denied: user did not grant access to '${dirPath}'.` };
          }
        }
        result = await invoke<string>("file_list", {
          path: dirPath,
        });
        break;
      }

      case "file_edit": {
        const filePath = args.path as string;
        if (isAbsolutePath(filePath)) {
          const allowed = await requestPermission("file_edit", filePath);
          if (!allowed) {
            return { tool: name, result: null, error: `Permission denied: user did not grant access to '${filePath}'.` };
          }
        }
        result = await invoke<string>("file_edit", {
          path: filePath,
          edits: args.edits as Array<{ old_text: string; new_text: string }>,
        });
        break;
      }

      // ====== RAG tools (native MCP) ======
      case "rag_add":
        result = await invoke<string>("rag_add", {
          projectId: args.project_id as string,
          entityType: args.entity_type as string,
          entityId: args.entity_id as string,
          contentText: args.content_text as string,
        });
        break;

      case "rag_search":
        result = await invoke<string>("rag_search", {
          projectId: args.project_id as string,
          query: args.query as string,
          limit: (args.limit as number) || 10,
        });
        break;

      case "rag_list":
        result = await invoke<string>("rag_list", {
          projectId: args.project_id as string,
        });
        break;

      case "rag_delete":
        result = await invoke<string>("rag_delete", {
          projectId: args.project_id as string,
          entityType: args.entity_type as string,
          entityId: args.entity_id as string,
        });
        break;

      // ====== Shell exec tools (native MCP) ======
      case "exec": {
        const command = args.command as string;
        const allowed = await requestPermission("exec", command);
        if (!allowed) {
          return { tool: name, result: null, error: `Permission denied: user did not grant permission to execute '${command}'.` };
        }
        result = await invoke<string>("exec", {
          command,
          workdir: args.workdir as string || null,
          timeout: args.timeout as number || null,
          background: args.background as boolean || null,
          env: args.env as Record<string, string> || null,
        });
        break;
      }

      case "exec_poll":
        result = await invoke<string>("exec_poll", {
          jobId: args.job_id as string,
          tail: args.tail as number || null,
        });
        break;

      case "exec_kill":
        result = await invoke<string>("exec_kill", {
          jobId: args.job_id as string,
        });
        break;

      case "exec_list":
        result = await invoke<string>("exec_list");
        break;

      case "exec_clean":
        result = await invoke<string>("exec_clean", {
          maxAgeHours: args.max_age_hours as number || null,
          all: args.all as boolean || null,
        });
        break;

      default:
        return {
          tool: name,
          result: null,
          error: `Unknown tool: ${name}`
        };
    }

    return {
      tool: name,
      result
    };
  } catch (error) {
    return {
      tool: name,
      result: null,
      error: error instanceof Error ? error.message : String(error)
    };
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
}

export function buildToolSystemPrompt(projectId?: string, prefs: ToolPreferences = {}): string {
  const plannerEnabled = prefs.plannerEnabled !== false;
  const webSearchEnabled = prefs.webSearchEnabled !== false;
  const fileSystemEnabled = prefs.fileSystemEnabled !== false;
  const shellExecEnabled = prefs.shellExecEnabled === true;
  const ragEnabled = prefs.ragEnabled === true;
  const pid = projectId || "PROJECT_ID";
  const projectInfo = projectId
    ? `\nThe current project ID is: "${projectId}". Use it as the project_id parameter for all tool calls.`
    : "";
  const hasProject = !!projectId;

  // NOTE: the full, verbose version of this prompt (22 worked examples, bilingual
  // block, per-example repetition of project_id) is preserved in
  // documentation/tool-prompt-backup-full-2026-06-25.md. This compact form cuts
  // ~1.1K tokens from every turn's fixed overhead. Behaviour is unchanged.
  return `You are AuraWrite AI, an intelligent writing assistant with access to tools.
${projectInfo}
${hasProject ? `When the user asks about characters, locations, events, or anything project-related, you MUST call the database tools before answering. Never say "no entities found" without calling a tool first. Always pass the open project's ID as project_id; never use other projects' entities.` : "No project is open. Project-specific tools (entities, documents, semantic search) need a project_id. Wiki, web, file, and planner tools are always available."}

Available tools:
${AVAILABLE_TOOLS
  .filter((tool) => {
    if (!plannerEnabled && tool.name.startsWith("plan_")) return false;
    if (!webSearchEnabled && tool.name.startsWith("web_")) return false;
    if (!fileSystemEnabled && tool.name.startsWith("file_")) return false;
    if (!ragEnabled && tool.name.startsWith("rag_")) return false;
    // Filter ALL exec_* tools when shell is disabled, not just the bare "exec".
    if (!shellExecEnabled && tool.name.startsWith("exec")) return false;
    return true;
  })
  .map((tool) => `- ${tool.name}: ${tool.description} Params: ${Object.keys(tool.parameters.properties).join(", ")}`)
  .join("\n")}

To call a tool, emit this tag with one-line JSON. Multiple tools per response are allowed:
<tool name="TOOL_NAME">{"param": "value"}</tool>

=== PATTERNS (adapt to the user's language) ===
- List a TYPE of entity (characters, locations, events): <tool name="list_entities_by_type">{"project_id": "${pid}", "entity_type": "Character"}</tool>
- Find a SPECIFIC name: <tool name="search_entities">{"project_id": "${pid}", "query": "Pippo"}</tool> (follow with get_entity_details using the returned id)
- Read project or section text: <tool name="read_project">{"project_id": "${pid}"}</tool> or <tool name="read_section">{"section_id": "SECTION_ID"}</tool>
- Recall a past decision from earlier chat: <tool name="chat_search">{"query": "magic system decisions"${hasProject ? `, "project_id": "${pid}"` : ""}}</tool>
- Browse past sessions: <tool name="chat_list_sessions">{}</tool> then <tool name="chat_get_session_messages">{"session_id": "..."}</tool>
- Entity type names may be plural ("Characters") or singular ("Character"); both are accepted.
${plannerEnabled ? `- Planner: <tool name="plan_create">{"name": "x", "content": "..."}</tool>, <tool name="plan_next">{"name": "x"}</tool>, <tool name="plan_status">{"name": "x"}</tool>` : ""}
${webSearchEnabled ? `- Web: <tool name="web_search">{"query": "...", "limit": 5}</tool>, <tool name="web_fetch">{"url": "..."}</tool>, <tool name="web_search_images">{"query": "..."}</tool>` : ""}
${fileSystemEnabled ? `- Files: <tool name="file_read">{"path": "notes/x.md"}</tool>, <tool name="file_write">{"path": "drafts/x.md", "content": "..."}</tool>` : ""}
${ragEnabled ? `- RAG: <tool name="rag_add">{"project_id": "${pid}", "entity_type": "wiki", "entity_id": "x", "content_text": "..."}</tool>, <tool name="rag_search">{"project_id": "${pid}", "query": "..."}</tool>` : ""}
- Wiki: <tool name="wiki_search">{"query": "..."}</tool>, <tool name="wiki_write">{"name": "page", "content": "..."}</tool>, <tool name="wiki_list">{}</tool>

=== RULES ===
- After tool results, summarize them naturally for the user. If the user wants text written into the document, use the AURA_EDIT format.
${plannerEnabled ? `
=== PLANNER RULES (MANDATORY) ===
Plans appear in the MCP panel (🧩 in the status bar); the user interacts there. Your chat response after a planner tool call MUST be 1-2 short sentences — confirm the action in one line and STOP:
- plan_create: "Plan '[name]' created with X tasks — see the MCP panel (🧩)."
- plan_next: "Completed: [task]. Next: [task]."
- plan_status: "X/Y tasks completed (Z%)."
- plan_read/plan_update/plan_list: confirm in one line.
NEVER output the plan content, task lists, or markdown in chat — the MCP panel already shows it.` : ""}`;
}


