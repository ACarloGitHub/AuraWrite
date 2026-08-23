// ============================================================================
// Project Indexing - semantic search indexing + entity extraction triggers
// ============================================================================
// Pure extraction (phase 3, step 3 of the refactoring plan). No logic change.
// Shared state is imported live from ./project-state. The notification helper
// stays in project-panel.ts and is loaded dynamically through notify() to
// avoid a static import cycle (same pattern as toolbar.ts / project-dialogs).
// The isIndexing flag is LOCAL to this module on purpose (nothing else shares it).

import { invoke } from "@tauri-apps/api/core";
import { getEntityIndexStatus } from "../database/db";
import {
  extractEntitiesFromDocument,
  extractEntitiesFromSection,
  extractEntitiesFromProject,
} from "../ai-panel/entity-extraction";
import { currentProject, sections, documents } from "./project-state";
import type { Project, Section, Document, IndexStatus } from "../types/database";

/**
 * Extract plain text from ProseMirror JSON content
 */
export function extractTextFromContent(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    if (!doc.content) return "";
    return extractTextFromNode(doc);
  } catch {
    return contentJson; // Fallback to raw text if parsing fails
  }
}

export function extractTextFromNode(node: any): string {
  if (typeof node === "string") return node;
  if (!node) return "";

  if (node.text) return node.text;

  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(" ");
  }

  return "";
}

export function countWordsInContent(contentJson: string): number {
  const text = extractTextFromContent(contentJson);
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Index document content for semantic search
 * Silently fails if Ollama is not available
 */
export async function indexDocumentForSearch(
  projectId: string,
  documentId: string,
  contentJson: string
): Promise<void> {
  const PREFERENCES_KEY = "aurawrite-preferences";
  const saved = localStorage.getItem(PREFERENCES_KEY);
  const prefs = saved ? JSON.parse(saved) : {};
  const semanticEnabled = prefs.semanticSearchEnabled !== false;
  console.log(`[SemanticSearch] enabled=${semanticEnabled}, saved pref=${prefs.semanticSearchEnabled}`);
  if (!semanticEnabled) return;

  try {
    const text = extractTextFromContent(contentJson);
    if (!text.trim()) return;

    const baseUrl = prefs.aiBaseUrl || undefined;

    await invoke("embedding_save_document", {
      projectId,
      documentId,
      contentText: text,
      chunkSize: 100,
      chunkOverlap: 20,
      baseUrl,
    });
    console.log(`Document ${documentId} indexed for search`);
  } catch (err) {
    console.error(`Document ${documentId} not indexed:`, err);
  }
}

// Dynamic-import bridge to the panel's notification helper (avoids the static
// cycle project-panel -> project-indexing -> project-panel).
async function notify(
  message: string,
  type: "success" | "error" | "indexing" | "info"
): Promise<void> {
  const { showNotification } = await import("./project-panel");
  showNotification(message, type);
}

let isIndexing = false;

export async function handleIndexDocument(doc: Document): Promise<void> {
  if (!currentProject) return;
  if (isIndexing) {
    notify("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    notify("🗂 Indexing entities...", "indexing");
    const result = await extractEntitiesFromDocument(
      doc.id,
      currentProject.id,
      currentProject.type || "novel",
      (msg) => notify(`🗂 ${msg}`, "indexing"),
    );
    if (result.skipped) {
      const reasonMsg = {
        empty: "document is empty",
        no_text: "document has no text",
        error: "extraction failed",
      }[result.reason || "empty"];
      notify(`⏭ ${doc.title}: ${reasonMsg}, nothing to index`, "info");
    } else {
      notify(`✓ ${doc.title}: ${result.created} created, ${result.updated} updated`, "success");
    }
  } catch (error) {
    notify(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

export async function handleIndexSection(section: Section): Promise<void> {
  if (!currentProject) return;
  if (isIndexing) {
    notify("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    notify("🗂 Indexing section...", "indexing");
    const result = await extractEntitiesFromSection(
      section.id,
      currentProject.id,
      currentProject.type || "novel",
      (msg) => notify(`🗂 ${msg}`, "indexing"),
    );
    notify(`✓ ${section.name}: ${result.created} created, ${result.updated} updated`, "success");
  } catch (error) {
    notify(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

export async function handleIndexProject(project: Project): Promise<void> {
  if (isIndexing) {
    notify("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    notify("🗂 Indexing project...", "indexing");
    const result = await extractEntitiesFromProject(
      project.id,
      project.type || "novel",
      (msg) => notify(`🗂 ${msg}`, "indexing"),
    );
    notify(`✓ Project indexed: ${result.created} created, ${result.updated} updated`, "success");
  } catch (error) {
    notify(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

export async function updateIndexIndicators(): Promise<void> {
  if (!currentProject) return;

  try {
    const projectStatus = await getEntityIndexStatus("project", currentProject.id);
    const projectBtns = document.querySelectorAll<HTMLButtonElement>(".index-btn[data-target-type='project']");
    projectBtns.forEach((btn) => {
      btn.dataset.targetId = currentProject!.id;
      applyIndexStatus(btn, projectStatus);
    });

    for (const section of sections) {
      const sectionStatus = await getEntityIndexStatus("section", section.id);
      const sectionBtns = document.querySelectorAll<HTMLButtonElement>(`.index-btn[data-target-type='section'][data-target-id='${section.id}']`);
      sectionBtns.forEach((btn) => applyIndexStatus(btn, sectionStatus));

      const sectionDocs = documents.filter((doc) => doc.section_id === section.id);
      for (const doc of sectionDocs) {
        const docStatus = await getEntityIndexStatus("document", doc.id);
        const docBtns = document.querySelectorAll<HTMLButtonElement>(`.index-btn[data-target-type='document'][data-target-id='${doc.id}']`);
        docBtns.forEach((btn) => applyIndexStatus(btn, docStatus));
      }
    }
  } catch (error) {
    console.error("[IndexStatus] Error:", error);
  }
}

export function applyIndexStatus(btn: HTMLButtonElement, status: IndexStatus): void {
  btn.classList.remove("index-red", "index-yellow", "index-green");
  btn.classList.add(`index-${status.status}`);

  const tooltips: Record<string, string> = {
    red: "Not indexed — click to extract entities",
    yellow: "Outdated — document modified since last indexing",
    green: `Indexed — ${status.entity_count} entities linked`,
  };
  btn.title = tooltips[status.status] || "Index entities";
}
