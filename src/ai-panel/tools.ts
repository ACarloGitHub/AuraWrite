// ============================================================================
// Tool Calling for AuraWrite AI
// AI can query the database using structured tools
// ============================================================================

import { invoke } from "@tauri-apps/api/core";

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
    return [];
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
  plannerEnabled = true
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

  if (!plannerEnabled && name.startsWith("plan_")) {
    return {
      tool: name,
      result: null,
      error: "Planner tool is disabled. Enable it in Settings > Agent.",
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
export function buildToolSystemPrompt(projectId?: string, plannerEnabled = true): string {
  const projectInfo = projectId
    ? `\nThe current project ID is: "${projectId}". Always use this as the project_id parameter when calling tools.\n`
    : "";

  const hasProject = !!projectId;

  return `You are AuraWrite AI, an intelligent writing assistant with access to tools.
${projectInfo}
${hasProject ? `IMPORTANT: When the user asks about characters, locations, events, or anything related to their project, you MUST use the available tools to query the database before answering. Do NOT say "no entities found" without actually calling the tools first.

CRITICAL: Rispondi sempre mostrando entities relative al progetto aperto. Non includere entities di altri progetti. Ogni tool ha un parametro project_id: usalo SEMPRE con il project_id del progetto aperto, MAI lasciarlo vuoto o usare un altro ID.` : "Note: No project is currently open. Only planner tools are available. You can create, read, update, and manage plans in the workspace."}

Available tools:
${AVAILABLE_TOOLS
  .filter((tool) => {
    if (!plannerEnabled && tool.name.startsWith("plan_")) return false;
    if (!hasProject && !tool.name.startsWith("plan_")) return false;
    return true;
  })
  .map((tool) => `
- ${tool.name}: ${tool.description}
  Parameters: ${Object.keys(tool.parameters.properties).join(", ")}
`).join("\n")}

To use a tool, include this tag in your response:
<tool name="TOOL_NAME">{"param1": "value1", "param2": "value2"}</tool>

You can use multiple tools in one response.

=== EXAMPLES (use these patterns) ===

Example 1 — User asks "Who are the characters?" (or "list characters", "elenca personaggi"):
<tool name="list_entities_by_type">{"project_id": "${projectId || "PROJECT_ID"}", "entity_type": "Character"}</tool>

Example 2 — User asks "List the locations" (or "elenca i luoghi", "where does the story take place?"):
<tool name="list_entities_by_type">{"project_id": "${projectId || "PROJECT_ID"}", "entity_type": "Location"}</tool>

Example 3 — User asks "Tell me about Pippo" (or "describe X", "chi è Y?"):
<tool name="search_entities">{"project_id": "${projectId || "PROJECT_ID"}", "query": "Pippo"}</tool>
Then, if you need the full description, follow up with:
<tool name="get_entity_details">{"entity_id": "<id from the previous result>"}</tool>

Example 4 — User asks "Which characters appear in chapter 1?":
<tool name="entities_in_document">{"document_id": "DOCUMENT_ID", "project_id": "${projectId || "PROJECT_ID"}"}</tool>

Example 5 — User asks "Search the document for the word 'dragon'":
<tool name="search_documents">{"project_id": "${projectId || "PROJECT_ID"}", "query": "dragon"}</tool>

${plannerEnabled ? `
Example 6 — User asks "Create a plan for rewriting chapter 3":
<tool name="plan_create">{"name": "rewrite-chapter-3", "content": "status: active\\n\\n# Rewrite Chapter 3\\n\\n- [ ] Read current chapter 3\\n- [ ] Identify weak sections\\n- [ ] Rewrite dialogue scenes\\n- [ ] Add sensory descriptions\\n- [ ] Review pacing\\n- [ ] Final read-through"}</tool>

Example 7 — User asks "What's next on my plan?":
<tool name="plan_next">{"name": "rewrite-chapter-3"}</tool>

Example 8 — User asks "How is the plan going?":
<tool name="plan_status">{"name": "rewrite-chapter-3"}</tool>

Example 9 — User asks "What did we decide about the magic system earlier?":
<tool name="chat_search">{"query": "magic system decisions"}</tool>

Example 10 — User asks "What names did we discuss for the protagonist?":
<tool name="chat_search">{"query": "protagonist names discussed", "project_id": "${projectId || "PROJECT_ID"}"}</tool>
` : ""}
=== CRITICAL RULES ===
- When the query mentions a TYPE of entity (characters, locations, places, objects, events), ALWAYS prefer list_entities_by_type with the appropriate entity_type.
- When the query mentions a SPECIFIC NAME (a person, a place name), use search_entities with that name as query.
- Entity type names in this project may be plural ("Characters") or singular ("Character"). The tool accepts both forms.
- After receiving tool results, summarize them naturally for the user. If the user asks you to write in the document, use the AURA_EDIT format.
${plannerEnabled ? `
=== PLANNER RULES (MANDATORY) ===
When you use planner tools, the plan appears in the MCP panel (🧩 button in the status bar). The user can see and interact with it there — you do NOT need to show it in chat.

YOUR RESPONSE AFTER A PLANNER TOOL CALL MUST BE EXACTLY 1-2 SHORT SENTENCES. This is a hard constraint:

- plan_create: "Plan '[name]' created with X tasks — check the MCP panel (🧩)." Then STOP.
- plan_next: "Completed: [task]. Next: [task]." Nothing else.
- plan_status: "X/Y tasks completed (Z%)." Nothing else.
- plan_read: "Plan '[name]' has X tasks, Y completed." Nothing else.
- plan_update: "Plan updated." Nothing else.
- plan_list: "Plans: name1, name2, name3." Nothing else.

NEVER output the plan content, task lists, or markdown in your chat response. The MCP panel already shows it. Your job is to confirm the action in ONE line.
` : ""}`;
}


