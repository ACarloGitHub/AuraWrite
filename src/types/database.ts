// ============================================================================
// Database Types for AuraWrite
// ============================================================================

export interface Project {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  bg_color?: string | null;
  text_color?: string | null;
  template_type: string;
  suggestions_prompt_override?: string | null;
  chat_prompt_override?: string | null;
  selected_style?: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserStyle {
  id: string;
  name: string;
  prompt_fragment: string;
  created_at: number;
}

export type TemplateType =
  | "custom"
  | "book"
  | "chef"
  | "legal"
  | "developer"
  | "notes"
  | "article"
  | "thesis";

export interface Section {
  id: string;
  project_id: string;
  parent_id?: string | null;
  name: string;
  order_index: number;
  bg_color?: string | null;
  text_color?: string | null;
  section_type?: string | null;
  selected_style?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Document {
  id: string;
  section_id: string;
  title: string;
  content_json: string;
  status?: string | null;
  word_count: number;
  tags?: string | null;
  order_index: number;
  bg_color?: string | null;
  text_color?: string | null;
  recipe_entity_id?: string | null;
  selected_style?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Entity {
  id: string;
  project_id: string;
  entity_type_id?: string | null;
  name: string;
  description?: string | null;
  image_path?: string | null;
  metadata_json?: string | null;
  document_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Link {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  link_type: string;
  context_json?: string;
  created_at: number;
}

export interface IndexStatus {
  status: "red" | "yellow" | "green";
  entity_count: number;
  last_indexed: number | null;
  target_updated_at: number | null;
}

export interface EntityType {
  id: string;
  project_id: string;
  name: string;
  icon?: string;
  color?: string;
  fields_json?: string;
  created_at: number;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  backup_path: string;
  content_json?: string;
  word_count?: number;
  note?: string;
  size_bytes?: number;
  created_at: number;
}

// ============================================================================
// Chat (Phase 1 of chat compaction)
// ============================================================================

/**
 * One persisted chat turn. Inserted after every user + assistant message.
 * attachments_json stores a JSON array of {filename, kind, mimeType, size}
 * (base64 is intentionally NOT persisted).
 * project_id is captured at send time for future per-project queries;
 * messages are NOT deleted when a project is deleted.
 */
export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  attachments_json?: string | null;
  project_id?: string | null;
  timestamp: number;
  created_at: number;
}

/** Summary of one persisted chat session (for future history UI). */
export interface ChatSessionSummary {
  session_id: string;
  message_count: number;
  last_timestamp: number;
  first_timestamp: number;
}

// ============================================================================
// Enums
// ============================================================================

export type DocumentStatus = "draft" | "review" | "done" | "todo";
export type ProjectType = "novel" | "notes" | "legal" | "software" | "personal";
export type SectionType = "book" | "part" | "chapter" | "generic" | "folder";

// ============================================================================
// Default Entity Types for Novels
// ============================================================================

export const DEFAULT_ENTITY_TYPES: EntityType[] = [
  {
    id: "character",
    project_id: "", // Will be set on creation
    name: "Personaggio",
    icon: "👤",
    color: "#4a90d9",
    fields_json: JSON.stringify({
      età: "number",
      descrizione: "text",
      personalità: "text",
      background: "text",
    }),
    created_at: Date.now(),
  },
  {
    id: "location",
    project_id: "",
    name: "Luogo",
    icon: "📍",
    color: "#e74c3c",
    fields_json: JSON.stringify({
      descrizione: "text",
      clima: "text",
      importanza: "text",
    }),
    created_at: Date.now(),
  },
  {
    id: "object",
    project_id: "",
    name: "Oggetto",
    icon: "🎒",
    color: "#f39c12",
    fields_json: JSON.stringify({
      descrizione: "text",
      funzione: "text",
      importanza: "text",
    }),
    created_at: Date.now(),
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

export function generateId(): string {
  return crypto.randomUUID();
}

// Fixed palette of 12 harmonious bg+text color combinations
const PROJECT_COLORS: Array<{ bg: string; text: string }> = [
  { bg: "#093150", text: "#93999e" },  // blu chiaro
  { bg: "#442d08", text: "#ffd1c3" },  // arancione caldo
  { bg: "#05420a", text: "#c2d1c3" },  // verde
  { bg: "#560463", text: "#8f8a96" },  // viola
  { bg: "#c49600", text: "#e0e0e0" },  // giallo
  { bg: "#8a0519", text: "#797979" },  // rosso
  { bg: "#03c9bf", text: "#000000" },  // teal
  { bg: "#3f009e", text: "#cfc9ec" },  // indaco
  { bg: "#fc1900", text: "#000000" },  // arancione bruno
  { bg: "#76dd00", text: "#fafafa" },  // verde chiaro
  { bg: "#00aaf8", text: "#ffffff" },  // azzurro
  { bg: "#fd0054", text: "#ffffff" },  // rosa
];

function randomProjectColors(): { bg_color: string; text_color: string } {
  const pair = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
  return { bg_color: pair.bg, text_color: pair.text };
}

export function createProject(name: string, type: ProjectType = "novel", description?: string): Project {
  const now = Date.now();
  const colors = randomProjectColors();
  return {
    id: generateId(),
    name,
    type,
    description,
    template_type: "custom",
    bg_color: colors.bg_color,
    text_color: colors.text_color,
    suggestions_prompt_override: undefined,
    chat_prompt_override: undefined,
    selected_style: undefined,
    created_at: now,
    updated_at: now,
  };
}

export function createSection(
  projectId: string,
  name: string,
  orderIndex: number = 0,
  parentId?: string,
  sectionType: SectionType = "chapter"
): Section {
  const now = Date.now();
  return {
    id: generateId(),
    project_id: projectId,
    parent_id: parentId,
    name,
    order_index: orderIndex,
    bg_color: undefined,
    text_color: undefined,
    section_type: sectionType,
    created_at: now,
    updated_at: now,
  };
}

export function createDocument(sectionId: string, title: string = "Untitled", contentJson: string = "{}", orderIndex: number = 0): Document {
  const now = Date.now();
  return {
    id: generateId(),
    section_id: sectionId,
    title,
    content_json: contentJson,
    status: "draft",
    word_count: 0,
    tags: undefined,
    order_index: orderIndex,
    created_at: now,
    updated_at: now,
  };
}

export function createEntity(
  projectId: string,
  name: string,
  entityTypeId?: string,
  description?: string
): Entity {
  const now = Date.now();
  return {
    id: generateId(),
    project_id: projectId,
    entity_type_id: entityTypeId,
    name,
    description,
    image_path: undefined,
    metadata_json: undefined,
    created_at: now,
    updated_at: now,
  };
}

export function createEntityType(
  projectId: string,
  name: string,
  icon?: string,
  color?: string,
  fields?: Record<string, string>
): EntityType {
  return {
    id: generateId(),
    project_id: projectId,
    name,
    icon,
    color,
    fields_json: fields ? JSON.stringify(fields) : undefined,
    created_at: Date.now(),
  };
}
