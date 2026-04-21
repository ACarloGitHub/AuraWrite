// ============================================================================
// Database Client for AuraWrite
// Tauri command invoker for SQLite operations
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import type {
  Project,
  Section,
  Document,
  Entity,
  EntityType,
  DocumentVersion,
  Link,
  IndexStatus,
} from "../types/database";

// ============================================================================
// PROJECTS
// ============================================================================

export async function createProject(project: Project): Promise<void> {
  await invoke("db_create_project", { project });
}

export async function getProjects(): Promise<Project[]> {
  return await invoke("db_get_projects");
}

export async function getProject(id: string): Promise<Project | null> {
  return await invoke("db_get_project", { id });
}

export async function updateProject(project: Project): Promise<void> {
  await invoke("db_update_project", { project });
}

export async function deleteProject(id: string): Promise<void> {
  await invoke("db_delete_project", { id });
}

// ============================================================================
// SECTIONS
// ============================================================================

export async function createSection(section: Section): Promise<void> {
  await invoke("db_create_section", { section });
}

export async function getSections(projectId: string): Promise<Section[]> {
  return await invoke("db_get_sections", { projectId });
}

export async function updateSection(section: Section): Promise<void> {
  await invoke("db_update_section", { section });
}

export async function deleteSection(id: string): Promise<void> {
  await invoke("db_delete_section", { id });
}

// ============================================================================
// DOCUMENTS
// ============================================================================

export async function createDocument(document: Document): Promise<void> {
  await invoke("db_create_document", { document });
}

export async function getDocuments(sectionId: string): Promise<Document[]> {
  return await invoke("db_get_documents", { sectionId });
}

export async function getDocument(id: string): Promise<Document | null> {
  return await invoke("db_get_document", { id });
}

export async function updateDocument(document: Document): Promise<void> {
  await invoke("db_update_document", { document });
}

export async function deleteDocument(id: string): Promise<void> {
  await invoke("db_delete_document", { id });
}

// ============================================================================
// REORDERING
// ============================================================================

export async function updateSectionsOrder(orders: [string, number][]): Promise<void> {
  await invoke("db_update_sections_order", { orders });
}

export async function updateDocumentsOrder(orders: [string, number][]): Promise<void> {
  await invoke("db_update_documents_order", { orders });
}

// ============================================================================
// ENTITIES
// ============================================================================

export async function createEntity(entity: Entity): Promise<void> {
  await invoke("db_create_entity", { entity });
}

export async function getEntities(projectId: string): Promise<Entity[]> {
  return await invoke("db_get_entities", { projectId });
}

export async function updateEntity(entity: Entity): Promise<void> {
  await invoke("db_update_entity", { entity });
}

export async function deleteEntity(id: string): Promise<void> {
  await invoke("db_delete_entity", { id });
}

// ============================================================================
// ENTITY TYPES
// ============================================================================

export async function createEntityType(entityType: EntityType): Promise<void> {
  await invoke("db_create_entity_type", { entityType });
}

export async function getEntityTypes(projectId: string): Promise<EntityType[]> {
  return await invoke("db_get_entity_types", { projectId });
}

export async function deleteEntityType(id: string): Promise<void> {
  await invoke("db_delete_entity_type", { id });
}

// ============================================================================
// LINKS
// ============================================================================

export async function createLink(link: Link): Promise<void> {
  await invoke("db_create_link", { link });
}

export async function getLinksBySource(sourceType: string, sourceId: string): Promise<Link[]> {
  return await invoke("db_get_links_by_source", { sourceType, sourceId });
}

export async function getLinksByTarget(targetType: string, targetId: string): Promise<Link[]> {
  return await invoke("db_get_links_by_target", { targetType, targetId });
}

export async function deleteLinksBySource(sourceType: string, sourceId: string): Promise<number> {
  return await invoke("db_delete_links_by_source", { sourceType, sourceId });
}

export async function getEntityIndexStatus(targetType: string, targetId: string): Promise<IndexStatus> {
  return await invoke("db_get_entity_index_status", { targetType, targetId });
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

import {
  createProject as makeProject,
  createSection as makeSection,
  createDocument as makeDocument,
  createEntity as makeEntity,
  DEFAULT_ENTITY_TYPES,
} from "../types/database";

export async function createProjectWithDefaults(
  name: string,
  type: string = "novel",
  description?: string
): Promise<{ project: Project; sections: Section[]; entityTypes: EntityType[] }> {
  // Create project
  const project = makeProject(name, type as any, description);
  await createProject(project);

  // Create default sections (Book → Parts → Chapters structure placeholder)
  const sections: Section[] = [];
  // (Sections will be created by user later)

  // Create default entity types for novels
  const entityTypes: EntityType[] = [];
  if (type === "novel") {
    for (const et of DEFAULT_ENTITY_TYPES) {
      const entityType = { ...et, project_id: project.id, id: undefined as any };
      entityType.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await createEntityType(entityType);
      entityTypes.push(entityType);
    }
  }

  return { project, sections, entityTypes };
}

export async function createSectionWithDocuments(
  projectId: string,
  sectionName: string,
  documentTitle?: string,
  parentId?: string
): Promise<{ section: Section; documents: Document[] }> {
  // Get next order index
  const existingSections = await getSections(projectId);
  const orderIndex = existingSections.length;

  // Create section
  const section = makeSection(projectId, sectionName, orderIndex, parentId);
  await createSection(section);

  // Create document
  const document = makeDocument(section.id, documentTitle || "Untitled");
  await createDocument(document);

  return { section, documents: [document] };
}

// ============================================================================
// DOCUMENT VERSIONS
// ============================================================================

export async function createDocumentVersion(version: DocumentVersion): Promise<void> {
  await invoke("db_create_document_version", { version });
}

export async function getLatestVersion(documentId: string): Promise<DocumentVersion | null> {
  return await invoke("db_get_latest_version", { documentId });
}

export async function getVersions(documentId: string): Promise<DocumentVersion[]> {
  return await invoke("db_get_versions", { documentId });
}

export async function cleanupOldVersions(documentId: string, keepCount: number): Promise<void> {
  await invoke("db_cleanup_old_versions", { documentId, keepCount });
}

/**
 * Crea una versione del documento (chiamato solo al salvataggio MANUALE)
 */
export async function saveDocumentVersion(document: Document): Promise<void> {
  // Ottieni il numero versione successivo
  const existingVersions = await getVersions(document.id);
  const nextVersionNumber = existingVersions.length > 0 
    ? Math.max(...existingVersions.map(v => v.version_number)) + 1 
    : 1;

  const version: DocumentVersion = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    document_id: document.id,
    version_number: nextVersionNumber,
    backup_path: "",
    content_json: document.content_json,
    word_count: document.word_count,
    note: undefined,
    size_bytes: document.content_json.length,
    created_at: Date.now(),
  };
  await createDocumentVersion(version);
  
  // Mantieni solo le ultime 10 versioni
  await cleanupOldVersions(document.id, 10);
}