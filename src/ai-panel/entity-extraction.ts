import { sendToAI } from "./ai-manager";
import type { AIContext } from "./providers";
import { invoke } from "@tauri-apps/api/core";
import { getEditorContent } from "../editor/editor";
import type { EditorView } from "prosemirror-view";

interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

interface ExistingEntity {
  id: string;
  name: string;
  entity_type: string;
  description: string;
  created_at: number;
}

const PROJECT_TYPE_SUGGESTIONS: Record<string, string> = {
  novel: "Characters, Locations, Objects, Events",
  script: "Characters, Locations, Scenes, Props",
  article: "Sources, Topics, Key Concepts",
  notes: "Topics, References",
  legal: "Clients, Articles, Communications, Evidence",
  research: "Sources, Topics, Hypotheses, Experiments",
  custom: "",
};

function buildExtractionPrompt(
  chunkText: string,
  existingEntities: ExistingEntity[],
  projectType: string,
): string {
  const typeSuggestion = PROJECT_TYPE_SUGGESTIONS[projectType] || PROJECT_TYPE_SUGGESTIONS["novel"];
  const typeGuidance = typeSuggestion
    ? `Suggested entity types for this ${projectType} project: ${typeSuggestion}. You may also create new types if needed.`
    : `Extract entities from the text. Create appropriate entity types based on what you find.`;

  let existingContext = "";
  if (existingEntities.length > 0) {
    existingContext = `\n\nExisting entities in this project (DO NOT duplicate these — update their descriptions if you find new information):\n${existingEntities.map((e) => `- [${e.entity_type}] ${e.name}: ${e.description.substring(0, 150)}`).join("\n")}`;
  }

  return `You are analyzing a chunk of text from a writing project to extract entities (characters, locations, objects, events, etc.).

${typeGuidance}
${existingContext}

Text chunk:
"""
${chunkText}
"""

Instructions:
1. Extract all named entities from this text chunk.
2. For each entity, provide: name, type, and a brief description based on what is mentioned in this text.
3. If an entity already exists in the list above, include it again with an UPDATED description that incorporates the new information from this text chunk.
4. If no entities are found in this chunk, return an empty array.
5. Be precise: only extract clearly named entities (proper nouns), not generic references.

Respond with ONLY a JSON array, no other text:
[{"name": "Entity Name", "type": "Entity Type", "description": "Brief description based on this text"}]`;
}

async function getExistingEntities(projectId: string): Promise<ExistingEntity[]> {
  try {
    const entities = await invoke("db_get_entities", { projectId });
    const entityTypes = await invoke("db_get_entity_types", { projectId }) as Array<{ id: string; name: string }>;
    const typeMap = new Map(entityTypes.map((t) => [t.id, t.name]));

    return (entities as Array<{
      id: string;
      name: string;
      entity_type_id?: string;
      description?: string;
      created_at: number;
    }>).map((e) => ({
      id: e.id,
      name: e.name,
      entity_type: e.entity_type_id ? (typeMap.get(e.entity_type_id) || "unknown") : "unknown",
      description: e.description || "",
      created_at: e.created_at,
    }));
  } catch {
    return [];
  }
}

function extractTextFromProseMirror(contentJson: string): string {
  try {
    const content = JSON.parse(contentJson);
    return extractTextFromNode(content);
  } catch {
    return contentJson;
  }
}

function extractTextFromNode(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (obj.text && typeof obj.text === "string") return obj.text as string;
  if (obj.content && Array.isArray(obj.content)) {
    return (obj.content as unknown[]).map((child) => extractTextFromNode(child)).join(" ");
  }
  return "";
}

function parseExtractionResponse(response: string): ExtractedEntity[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown) =>
        e &&
        typeof e === "object" &&
        typeof (e as Record<string, unknown>).name === "string" &&
        typeof (e as Record<string, unknown>).type === "string",
    ) as ExtractedEntity[];
  } catch {
    return [];
  }
}

async function findOrCreateEntityType(
  projectId: string,
  typeName: string,
): Promise<string> {
  const entityTypes = await invoke("db_get_entity_types", { projectId }) as Array<{
    id: string;
    name: string;
    project_id: string;
    icon?: string;
    color?: string;
    fields_json?: string;
    created_at: number;
  }>;

  const existing = entityTypes.find(
    (t) => t.name.toLowerCase() === typeName.toLowerCase(),
  );
  if (existing) return existing.id;

  const newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  await invoke("db_create_entity_type", {
    entityType: {
      id: newId,
      project_id: projectId,
      name: typeName,
      icon: null,
      color: null,
      fields_json: null,
      created_at: Date.now(),
    },
  });
  return newId;
}

async function upsertEntity(
  projectId: string,
  extracted: ExtractedEntity,
  existingEntities: ExistingEntity[],
): Promise<"created" | "updated"> {
  const existing = existingEntities.find(
    (e) => e.name.toLowerCase() === extracted.name.toLowerCase(),
  );

  const typeId = await findOrCreateEntityType(projectId, extracted.type);

  if (existing) {
    const updatedDesc = extracted.description.length > existing.description.length
      ? extracted.description
      : existing.description + " " + extracted.description;

    await invoke("db_update_entity", {
      entity: {
        id: existing.id,
        project_id: projectId,
        entity_type_id: typeId,
        name: extracted.name,
        description: updatedDesc.substring(0, 2000),
        image_path: null,
        metadata_json: null,
        created_at: existing.created_at,
        updated_at: Date.now(),
      },
    });
    const idx = existingEntities.findIndex((e) => e.id === existing.id);
    if (idx >= 0) {
      existingEntities[idx].description = updatedDesc.substring(0, 150);
    }
    return "updated";
  }

  const newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  await invoke("db_create_entity", {
    entity: {
      id: newId,
      project_id: projectId,
      entity_type_id: typeId,
      name: extracted.name,
      description: extracted.description.substring(0, 2000),
      image_path: null,
      metadata_json: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  });
  existingEntities.push({
    id: newId,
    name: extracted.name,
    entity_type: extracted.type,
    description: extracted.description.substring(0, 150),
    created_at: Date.now(),
  });
  return "created";
}

export async function extractEntitiesFromDocument(
  documentId: string,
  projectId: string,
  projectType: string,
  onProgress?: (message: string) => void,
): Promise<{ created: number; updated: number }> {
  const doc = await invoke("db_get_document", { id: documentId }) as {
    id: string;
    content_json: string;
    title: string;
  } | null;

  if (!doc || !doc.content_json) {
    onProgress?.(`Skipping empty document: ${doc?.title || documentId}`);
    return { created: 0, updated: 0 };
  }

  const text = extractTextFromProseMirror(doc.content_json);
  if (!text.trim()) {
    onProgress?.(`Skipping document with no text: ${doc.title}`);
    return { created: 0, updated: 0 };
  }

  const existingEntities = await getExistingEntities(projectId);

  const chunkSize = getChunkTokenSetting();
  const chunks = splitIntoExtractionChunks(text, chunkSize);

  let created = 0;
  let updated = 0;

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Indexing "${doc.title}" — chunk ${i + 1}/${chunks.length}...`);

    const prompt = buildExtractionPrompt(chunks[i], existingEntities, projectType);
    const context: AIContext = { projectId };
    const response = await sendToAI(prompt, context);

    if (response.error || !response.content) {
      onProgress?.(`Error on chunk ${i + 1}: ${response.error || "empty response"}`);
      continue;
    }

    const extracted = parseExtractionResponse(response.content);

    for (const entity of extracted) {
      const result = await upsertEntity(projectId, entity, existingEntities);
      if (result === "created") created++;
      else updated++;
    }
  }

  return { created, updated };
}

export async function extractEntitiesFromSection(
  sectionId: string,
  projectId: string,
  projectType: string,
  onProgress?: (message: string) => void,
): Promise<{ created: number; updated: number }> {
  const docs = await invoke("db_get_documents", { sectionId }) as Array<{
    id: string;
    title: string;
  }>;

  let totalCreated = 0;
  let totalUpdated = 0;

  for (let i = 0; i < docs.length; i++) {
    onProgress?.(`Document ${i + 1}/${docs.length}: ${docs[i].title}`);
    const result = await extractEntitiesFromDocument(
      docs[i].id,
      projectId,
      projectType,
      onProgress,
    );
    totalCreated += result.created;
    totalUpdated += result.updated;
  }

  return { created: totalCreated, updated: totalUpdated };
}

export async function extractEntitiesFromProject(
  projectId: string,
  projectType: string,
  onProgress?: (message: string) => void,
): Promise<{ created: number; updated: number }> {
  const sections = await invoke("db_get_sections", { projectId }) as Array<{
    id: string;
    name: string;
  }>;

  let totalCreated = 0;
  let totalUpdated = 0;
  let docIndex = 0;

  const allDocs: Array<{ id: string; title: string; sectionName: string }> = [];
  for (const section of sections) {
    const docs = await invoke("db_get_documents", { sectionId: section.id }) as Array<{
      id: string;
      title: string;
    }>;
    for (const doc of docs) {
      allDocs.push({ ...doc, sectionName: section.name });
    }
  }

  for (const doc of allDocs) {
    docIndex++;
    onProgress?.(`[${docIndex}/${allDocs.length}] ${doc.title} (${doc.sectionName})`);
    const result = await extractEntitiesFromDocument(
      doc.id,
      projectId,
      projectType,
      onProgress,
    );
    totalCreated += result.created;
    totalUpdated += result.updated;
  }

  return { created: totalCreated, updated: totalUpdated };
}

function splitIntoExtractionChunks(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const tentative = current ? `${current} ${word}` : word;
    if (tentative.split(/\s+/).length > maxTokens) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = tentative;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

function getChunkTokenSetting(): number {
  const saved = localStorage.getItem("aurawrite-preferences");
  if (saved) {
    try {
      const prefs = JSON.parse(saved);
      return prefs.indexingChunkTokens || 2000;
    } catch {
      return 2000;
    }
  }
  return 2000;
}