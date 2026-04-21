// ============================================================================
// Database Types for AuraWrite
// ============================================================================

export interface Project {
  id: string;
  name: string;
  type: string;
  description?: string;
  created_at: number;
  updated_at: number;
}

export interface Section {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  order_index: number;
  color?: string;
  section_type?: string;
  created_at: number;
  updated_at: number;
}

export interface Document {
  id: string;
  section_id: string;
  title: string;
  content_json: string;
  status?: string;
  word_count: number;
  tags?: string;
  order_index: number;
  created_at: number;
  updated_at: number;
}

export interface Entity {
  id: string;
  project_id: string;
  entity_type_id?: string;
  name: string;
  description?: string;
  image_path?: string;
  metadata_json?: string;
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
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function createProject(name: string, type: ProjectType = "novel", description?: string): Project {
  const now = Date.now();
  return {
    id: generateId(),
    name,
    type,
    description,
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
    color: undefined,
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
