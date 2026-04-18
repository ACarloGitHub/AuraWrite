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

  const queryLower = query.toLowerCase();

  let results = entities.filter((entity) => {
    const nameMatch = entity.name.toLowerCase().includes(queryLower);
    const descMatch = entity.description
      ? entity.description.toLowerCase().includes(queryLower)
      : false;
    return nameMatch || descMatch;
  });

  // Filter by entity type if specified
  if (entityTypeName) {
    const typeLower = entityTypeName.toLowerCase();
    const matchingTypes = entityTypes.filter(
      (et) => et.name.toLowerCase() === typeLower
    );
    const typeIds = matchingTypes.map((t) => t.id);
    results = results.filter((e) =>
      typeIds.includes(e.entity_type_id || "")
    );
  }

  return results.slice(0, limit);
}

// Tool: get_entity_details
async function getEntityDetails(entityId: string): Promise<Entity | null> {
  // We need to get all entities and find by ID
  // This is inefficient but works with current API
  // In production, add a get_entity_by_id command

  // For now, return minimal info
  return {
    id: entityId,
    project_id: "",
    name: "Entity",
    description: "Details not available"
  };
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

  const typeLower = entityType.toLowerCase();
  const matchingType = entityTypes.find(
    (et) => et.name.toLowerCase() === typeLower
  );

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
    // Generate embedding for query
    const queryVector: number[] = await invoke("embedding_generate", {
      text: query
    });

    // Search similar documents
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
  toolCall: ToolCall
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

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
  const regex = /<tool\s+name="([^"]+)">\s*({[^}]+})\s*<\/tool>/g;

  let match;
  while ((match = regex.exec(response)) !== null) {
    try {
      const name = match[1];
      const args = JSON.parse(match[2]);
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
export function buildToolSystemPrompt(projectId?: string): string {
  const projectInfo = projectId
    ? `\nThe current project ID is: "${projectId}". Always use this as the project_id parameter when calling tools.\n`
    : "";

  return `You are AuraWrite AI, an intelligent writing assistant with access to a project database.
${projectInfo}
IMPORTANT: When the user asks about characters, locations, events, or anything related to their project, you MUST use the available tools to query the database before answering. Do NOT say "no entities found" without actually calling the tools first.

Available tools:
${AVAILABLE_TOOLS.map((tool) => `
- ${tool.name}: ${tool.description}
  Parameters: ${Object.keys(tool.parameters.properties).join(", ")}
`).join("\n")}

To use a tool, include this tag in your response:
<tool name="TOOL_NAME">{"param1": "value1", "param2": "value2"}</tool>

You can use multiple tools in one response.

Example: If the user asks "Who are the characters?", respond with:
<tool name="search_entities">{"project_id": "${projectId || "PROJECT_ID"}", "query": "character"}</tool>

After receiving tool results, summarize them naturally for the user. If the user asks you to write in the document, use the AURA_EDIT format.`;
}

/**
 * Process AI response with potential tool calls
 */
export async function processAIResponseWithTools(
  response: string,
  projectId: string
): Promise<{ text: string; toolResults: ToolResult[] }> {
  const toolCalls = parseToolCalls(response);

  if (toolCalls.length === 0) {
    return { text: response, toolResults: [] };
  }

  // Inject project_id if missing
  const enrichedToolCalls = toolCalls.map((call) => ({
    ...call,
    arguments: {
      project_id: projectId,
      ...call.arguments
    }
  }));

  // Execute all tools
  const toolResults = await Promise.all(
    enrichedToolCalls.map((call) => executeTool(call))
  );

  // Build result text
  let resultText = response.replace(/<tool[^>]*>.*?<\/tool>/gs, "");
  resultText += "\n\n";
  resultText += toolResults
    .map((r) => {
      if (r.error) {
        return `Error with ${r.tool}: ${r.error}`;
      }
      return formatToolResult(r.tool, r.result);
    })
    .join("\n\n");

  return { text: resultText, toolResults };
}

function formatToolResult(tool: string, result: unknown): string {
  if (Array.isArray(result) && result.length === 0) {
    return `No results found for ${tool}.`;
  }

  if (Array.isArray(result)) {
    const items = result.slice(0, 5); // Limit to 5 items
    return `${tool} results:\n${items
      .map((item) => `  - ${formatItem(item)}`)
      .join("\n")}`;
  }

  return `${tool}: ${JSON.stringify(result, null, 2)}`;
}

function formatItem(item: unknown): string {
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    if (obj.name) {
      return String(obj.name);
    }
    if (obj.title) {
      return String(obj.title);
    }
  }
  return JSON.stringify(item);
}
