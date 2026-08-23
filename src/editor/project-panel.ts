// ============================================================================
// Project Panel - Sidebar for projects/sections/documents
// ============================================================================

import {
  getProjects,
  getSections,
  getDocuments,
  getDocument,
  createProjectWithDefaults,
  createSection,
  createDocument,
  deleteProject,
  deleteSection,
  updateDocument,
  deleteDocument,
  saveDocumentVersion,
  getLatestVersion,
  updateDocumentsOrder,
} from "../database/db";
import type { Project, Section, Document } from "../types/database";
import { sendProgrammaticMessage } from "../ai-panel/chat";
import Sortable from "sortablejs";
import { setLoading as setLoadingState } from "../loading-state";
import { createProjectFromTemplate } from "../templates/apply";
import {
  currentProject,
  currentSection,
  currentDocument,
  expandedSections,
  projects,
  sections,
  documents,
  setCurrentProject,
  setCurrentSection,
  setCurrentDocument,
  setProjects,
  setSections,
  setDocuments,
  sectionById,
  computeDepth,
  subtreeHeight,
  isDescendantOf,
} from "./project-state";
import {
  showSaveDialog,
  showDiscardConfirmDialog,
  showTemplateDialog,
  showProjectAISettingsDialog,
  showConfirmDialog,
} from "./project-dialogs";
import {
  extractTextFromContent,
  countWordsInContent,
  indexDocumentForSearch,
  updateIndexIndicators,
} from "./project-indexing";
import { renderProjectsList, refreshActiveHighlight } from "./project-render";
import { clearDropIndicators, flashSection, persistMove } from "./project-dnd";

// Live re-exports (ESM live bindings): external consumers keep seeing fresh
// state. Never replace with copies (`const x = ...` would freeze the value).
export {
  currentProject,
  currentSection,
  currentDocument,
  expandedSections,
  projects,
  sections,
  documents,
} from "./project-state";

// Core-local state
let lastSavedContent: string | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

// Multibranch — drag & drop state
let pendingChild: string | null = null;
const MAX_DEPTH = 4;

// Callbacks (set by main.ts)
let onDocumentSelect: ((doc: Document) => void) | null = null;
let onProjectChange: ((project: Project | null) => void) | null = null;
let getEditorContent: (() => string | null) | null = null;

// Config
const SAVE_DEBOUNCE_MS = 12000; // 12 seconds of inactivity

// ============================================================================
// INITIALIZATION
// ============================================================================

/** Current open project, if any. Exposed for the ebook export dialog. */
export function getCurrentProject(): Project | null {
  return currentProject;
}

export function initProjectPanel(
  callbacks: {
    onDocumentSelect?: (doc: Document) => void;
    onProjectChange?: (project: Project | null) => void;
    getEditorContent?: () => string | null;
  } = {}
): void {
  onDocumentSelect = callbacks.onDocumentSelect || null;
  onProjectChange = callbacks.onProjectChange || null;
  getEditorContent = callbacks.getEditorContent || null;

  const btnNewProject = document.getElementById("btn-new-project");
  btnNewProject?.addEventListener("click", handleNewProject);

  const btnBackProjects = document.getElementById("btn-back-projects");
  btnBackProjects?.addEventListener("click", async () => {
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      setCurrentProject(null);
      setCurrentSection(null);
      setCurrentDocument(null);
      lastSavedContent = null;
      clearEditor();
      renderProjectsList();
    }
  });

  const btnSaveDb = document.getElementById("btn-save-db");
  btnSaveDb?.addEventListener("click", handleSaveToDatabase);

  const btnReadProject = document.getElementById("btn-read-project");
  btnReadProject?.addEventListener("click", () => {
    if (!currentProject) return;
    sendProgrammaticMessage(`Read all documents in the project "${currentProject.name}". Use the read_project tool.`);
  });

  const btnAiSettings = document.getElementById("btn-ai-settings");
  btnAiSettings?.addEventListener("click", () => {
    if (currentProject) showProjectAISettingsDialog(currentProject);
  });

  const btnProjects = document.getElementById("btn-projects");
  btnProjects?.addEventListener("click", toggleProjectPanel);

  // Ascolta evento di modifica contenuto per auto-salvataggio
  window.addEventListener("aurawrite:content-changed", () => {
    scheduleAutoSave();
  });

  loadProjects();
}

function toggleProjectPanel(): void {
  const panel = document.getElementById("project-panel");
  const btnProjects = document.getElementById("btn-projects");
  if (panel) {
    panel.classList.toggle("hidden");
    // active = panel is VISIBLE (not hidden)
    btnProjects?.classList.toggle("active", !panel.classList.contains("hidden"));
  }
}

// ============================================================================
// SAVE STATUS
// ============================================================================

/**
 * Mostra dialog per chiedere se salvare le modifiche
 * @returns 'save' | 'dont-save' | 'cancel'
 */
function checkUnsavedChanges(): boolean {
  if (!currentDocument) return false;
  const currentContent = getEditorContent ? getEditorContent() : null;
  if (!currentContent) return false;

  // Compare extracted plain text, not raw JSON. ProseMirror normalizes the
  // loaded doc (adds attrs, reorders content) so editorView.state.doc.toJSON()
  // often differs in shape from the stored content_json, even when the text
  // is identical. Comparing text avoids false-positive "unsaved changes"
  // dialogs when the user navigates between template documents.
  const currentText = extractTextFromContent(currentContent).trim();
  const lastSavedText = lastSavedContent
    ? extractTextFromContent(lastSavedContent).trim()
    : null;

  if (lastSavedText === null) {
    // No prior saved snapshot: editor has been loaded with a fresh doc that
    // has text content. Treat as "saved" — the user hasn't typed anything
    // and shouldn't be prompted on next switch.
    return currentText.length > 0;
  }

  return currentText !== lastSavedText;
}

function markContentSaved(content: string): void {
  lastSavedContent = content;
  updateSaveStatus();
}

function updateSaveStatus(): void {
  const hasUnsaved = checkUnsavedChanges();
  const statusEl = document.getElementById("save-status");
  if (statusEl) {
    statusEl.textContent = hasUnsaved ? "Unsaved..." : "Saved ✓";
    statusEl.className = hasUnsaved ? "save-status unsaved" : "save-status saved";
  }
}

function scheduleAutoSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    if (checkUnsavedChanges() && currentDocument) {
      console.log("Auto-saving document...");
      const content = getEditorContent ? getEditorContent() : null;
      if (content) {
        // Auto-salvataggio: salva senza creare versione
        await saveCurrentDocument(content, false);
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Salva il documento nel database
 * @param content Il contenuto JSON da salvare
 * @param createVersion Se true, crea una versione (salvataggio manuale)
 */
async function saveCurrentDocument(content: string, createVersion: boolean = false): Promise<boolean> {
  if (!currentDocument || !currentProject) return false;

  try {
    const wordCount = countWordsInContent(content);
    const updatedDoc: Document = {
      ...currentDocument,
      content_json: content,
      word_count: wordCount,
      updated_at: Date.now(),
    };
    
    // Se è salvataggio manuale, crea prima una versione
    if (createVersion) {
      await saveDocumentVersion(updatedDoc);
    }
    
    await updateDocument(updatedDoc);
    setCurrentDocument(updatedDoc);
    markContentSaved(content);
    console.log(createVersion ? "Document saved (with version)" : "Document auto-saved");
    
    // Index for semantic search
    await indexDocumentForSearch(currentProject.id, updatedDoc.id, content);

    // Aggiorna gli indicatori di indicizzazione (rosso/giallo/verde).
    // try/catch separato: un errore qui non deve bloccare il save del documento.
    try {
      await updateIndexIndicators();
    } catch (statusError) {
      console.warn("Failed to update index indicators:", statusError);
    }

    return true;
  } catch (error) {
    console.error("Failed to save document:", error);
    showError("Could not save document");
    return false;
  }
}

async function handleSaveToDatabase(): Promise<void> {
  if (!currentProject) {
    console.warn("No project selected");
    showError("No project selected");
    return;
  }

  let savedCount = 0;
  let indexedCount = 0;

  // Save current document content from editor first
  if (currentDocument && getEditorContent) {
    const content = getEditorContent();
    if (content) {
      const updatedDoc: Document = {
        ...currentDocument,
        content_json: content,
        word_count: countWordsInContent(content),
        updated_at: Date.now(),
      };
      try {
        await saveDocumentVersion(updatedDoc);
        await updateDocument(updatedDoc);
        setCurrentDocument(updatedDoc);
        markContentSaved(content);
        savedCount++;
        // Index for semantic search
        await indexDocumentForSearch(currentProject.id, updatedDoc.id, content);
        indexedCount++;
      } catch (error) {
        console.error("Failed to save current document:", error);
      }
    }
  }

  // Save all documents that have content in the DB
  for (const section of sections) {
    const sectionDocs = await getDocuments(section.id);
    for (const doc of sectionDocs) {
      // Skip current doc — already saved above
      if (currentDocument && doc.id === currentDocument.id) continue;
      // Only save docs that have content
      if (doc.content_json && doc.content_json.trim() !== "") {
        try {
          await updateDocument(doc);
          savedCount++;
          // Index for semantic search
          await indexDocumentForSearch(currentProject.id, doc.id, doc.content_json);
          indexedCount++;
        } catch (error) {
          console.error("Failed to save document:", doc.title, error);
        }
      }
    }
  }

  if (savedCount > 0) {
    showNotification(`Project saved (${savedCount} document${savedCount !== 1 ? "s" : ""}, ${indexedCount} indexed)`, "success");
  } else {
    showNotification("Nothing to save", "error");
  }

  // Aggiorna gli indicatori di indicizzazione per riflettere lo stato reale del DB.
  // try/catch separato: un errore qui non deve mascherare l'esito del save.
  try {
    await updateIndexIndicators();
  } catch (statusError) {
    console.warn("Failed to update index indicators:", statusError);
  }
}

// Text extraction / word counting / semantic indexing moved to
// ./project-indexing.ts (phase 3, step 3).

export async function handleSaveDocument(doc: Document): Promise<void> {
  if (currentDocument?.id === doc.id) {
    await handleSaveToDatabase();
    return;
  }

  const content = getEditorContent ? getEditorContent() : null;
  if (content && currentDocument) {
    const updatedDoc: Document = {
      ...currentDocument,
      content_json: content,
      word_count: countWordsInContent(content),
      updated_at: Date.now(),
    };
    try {
      await saveDocumentVersion(updatedDoc);
      await updateDocument(updatedDoc);
    } catch (error) {
      console.error("Failed to save current document:", error);
    }
  }

  await selectDocument(doc);
  await handleSaveToDatabase();
}

export function showNotification(message: string, type: "success" | "error" | "indexing" | "info" = "success"): void {
  if (type === "indexing") {
    document.querySelectorAll(".project-toast.indexing").forEach((t) => t.remove());
  } else {
    document.querySelectorAll(".project-toast").forEach((t) => t.remove());
  }

  const toast = document.createElement("div");
  toast.className = `project-toast ${type}`;
  toast.textContent = message;
  const bgMap: Record<string, string> = {
    success: "#228822",
    error: "#cc0000",
    indexing: "#0066cc",
    info: "#d4a017",
  };
  toast.style.cssText = `
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    z-index: 1000;
    background: ${bgMap[type] || bgMap.success};
    color: white;
    white-space: nowrap;
  `;
  document.body.appendChild(toast);
  if (type !== "indexing") {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  }
}

function clearEditor(): void {
  const event = new CustomEvent("aurawrite:clear-editor");
  window.dispatchEvent(event);
}

/**
 * Gestisce la chiusura di un documento con modifiche non salvate
 * Mostra i dialog e gestisce le azioni
 * @returns 'proceed' se si può procedere, 'cancel' se l'utente annulla
 */
export async function handleCloseDocument(): Promise<'proceed' | 'cancel'> {
  const hasUnsaved = checkUnsavedChanges();
  
  if (!hasUnsaved) {
    return 'proceed';
  }
  
  // Mostra primo dialog
  const choice = await showSaveDialog();
  
  if (choice === 'cancel') {
    return 'cancel';
  }
  
  if (choice === 'save') {
    // Salva con versione
    const content = getEditorContent ? getEditorContent() : null;
    if (content && currentDocument) {
      const saved = await saveCurrentDocument(content, true);
      if (!saved) {
        return 'cancel'; // Salvataggio fallito
      }
    }
    return 'proceed';
  }
  
  if (choice === 'dont-save') {
    // Mostra secondo dialog di conferma
    const confirmed = await showDiscardConfirmDialog();
    
    if (!confirmed) {
      return 'cancel'; // Utente ha cliccato Go Back
    }
    
    // Carica l'ultima versione dal database
    if (currentDocument) {
      try {
        const latestVersion = await getLatestVersion(currentDocument.id);
        if (latestVersion && latestVersion.content_json) {
          // Ripristina il contenuto dal DB
          currentDocument.content_json = latestVersion.content_json;
          // Aggiorna il documento nel DB
          await updateDocument(currentDocument);
          console.log("Document reverted to last saved version");
        } else {
          // Nessuna versione salvata, documento vuoto
          currentDocument.content_json = "";
          await updateDocument(currentDocument);
        }
      } catch (error) {
        console.error("Failed to revert document:", error);
        return 'cancel';
      }
    }
    return 'proceed';
  }
  
  return 'cancel';
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function loadProjects(): Promise<void> {
  try {
    setProjects(await getProjects());
    console.log("Projects from DB:", projects);
    console.log("Number of projects:", projects.length);
    renderProjectsList();
  } catch (error) {
    console.error("Failed to load projects:", error);
    showError("Could not load projects from database");
  }
}

async function loadSections(projectId: string): Promise<void> {
  try {
    setSections(await getSections(projectId));
    setDocuments([]);
    for (const section of sections) {
      const sectionDocs = await getDocuments(section.id);
      documents.push(...sectionDocs);
    }
    // Lo stato di espansione è deciso interamente dall'utente tramite
    // il toggle ▼/▶ o il click sulla sezione. Non forziamo nulla qui.
    // Al primo caricamento di un progetto le sezioni appaiono collassate.
    renderProjectsList();
  } catch (error) {
    console.error("Failed to load sections:", error);
  }
}

async function handleNewProject(): Promise<void> {
  const action = await handleCloseDocument();
  if (action === 'cancel') {
    return; // Utente ha annullato
  }

  // Show template dialog
  const result = await showTemplateDialog();
  if (!result) return;

  try {
    let projectResult: { project: Project; sections: Section[] };
    if (result.templateType === "custom") {
      // Custom: use the legacy createProjectWithDefaults (empty project)
      const customResult = await createProjectWithDefaults(result.name, "custom");
      projectResult = { project: customResult.project, sections: [] };
    } else {
      // Template-based: use the new applyTemplate flow
      projectResult = await createProjectFromTemplate({
        name: result.name,
        templateType: result.templateType,
        chefVariant: result.chefVariant,
        selectedStyle: result.selectedStyle,
        createSections: result.createSections,
        createDocuments: result.createDocuments,
      });
    }
    projects.push(projectResult.project);
    setCurrentProject(projectResult.project);
    setCurrentSection(null);
    setCurrentDocument(null);
    setSections(projectResult.sections || []);
    setDocuments([]);
    // Load documents for all sections created by the template
    for (const section of sections) {
      const sectionDocs = await getDocuments(section.id);
      documents.push(...sectionDocs);
    }
    lastSavedContent = null;
    expandedSections.clear();
    clearEditor();
    renderProjectsList();

    if (onProjectChange) {
      onProjectChange(projectResult.project);
    }

    showNotification(`Project "${projectResult.project.name}" created!`, "success");
  } catch (error) {
    console.error("Failed to create project:", error);
    showNotification("Could not create project", "error");
  }
}

export async function handleDeleteProject(project: Project): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete project "${project.name}"?`,
    "This will delete the project and all its sections, documents, and data. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteProject(project.id);
    setProjects(projects.filter(p => p.id !== project.id));
    if (currentProject?.id === project.id) {
      setCurrentProject(null);
      setCurrentSection(null);
      setCurrentDocument(null);
    }
    renderProjectsList();
    console.log("Deleted project:", project.name);
  } catch (error) {
    console.error("Failed to delete project:", error);
    showError("Could not delete project");
  }
}

export async function handleDeleteSection(section: Section): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete section "${section.name}"?`,
    "This will delete the section and all its documents. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteSection(section.id);
    setSections(sections.filter(s => s.id !== section.id));
    setDocuments(documents.filter(d => d.section_id !== section.id));
    if (currentSection?.id === section.id) {
      setCurrentSection(null);
      setCurrentDocument(null);
    }
    renderProjectsList();
    console.log("Deleted section:", section.name);
  } catch (error) {
    console.error("Failed to delete section:", error);
    showError("Could not delete section");
  }
}

export async function handleDeleteDocument(doc: Document): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete document "${doc.title}"?`,
    "This document will be permanently deleted. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteDocument(doc.id);
    setDocuments(documents.filter(d => d.id !== doc.id));
    if (currentDocument?.id === doc.id) {
      setCurrentDocument(null);
      clearEditor();
    }
    renderProjectsList();
    console.log("Deleted document:", doc.title);
  } catch (error) {
    console.error("Failed to delete document:", error);
    showError("Could not delete document");
  }
}

// ENTITY INDEXING moved to ./project-indexing.ts (phase 3, step 3):
// isIndexing flag, handleIndexDocument/Section/Project, updateIndexIndicators,
// applyIndexStatus.

export async function handleNewSection(projectId: string, parentId?: string): Promise<void> {
  // Limite di profondita': una sezione gia' al livello massimo non puo' avere
  // figli (coerente con il drag & drop multibranch, vedi computeDepth).
  if (parentId && computeDepth(parentId) >= MAX_DEPTH) {
    showNotification(
      `Cannot nest deeper: maximum depth is ${MAX_DEPTH} levels.`,
      "error",
    );
    return;
  }

  const name = prompt("Section name:");
  if (!name) return;

  try {
    // order_index tra i fratelli dello stesso genitore (non su tutto il progetto)
    const orderIndex = sections.filter(
      (s) => (s.parent_id ?? null) === (parentId ?? null),
    ).length;

    const section: Section = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 9)}`,
      project_id: projectId,
      parent_id: (parentId ?? null) as any, // null per sezioni top-level
      name,
      order_index: orderIndex,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await createSection(section);
    sections.push(section);
    // La nuova sezione nasce aperta; se e' annidata espande anche il genitore
    // cosi' il figlio e' subito visibile.
    expandedSections.add(section.id);
    if (parentId) expandedSections.add(parentId);
    renderProjectsList();

    console.log("Created section:", section.name, parentId ? `(child of ${parentId})` : "(top-level)");
  } catch (error) {
    console.error("Failed to create section:", error);
    showError("Could not create section");
  }
}

export async function handleNewDocument(sectionId: string): Promise<void> {
  const title = prompt("Document title:");
  if (!title) return;

  try {
    const document: Document = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 9)}`,
      section_id: sectionId,
      title,
      content_json: "",
      status: undefined,
      word_count: 0,
      tags: undefined,
      order_index: documents.filter((d) => d.section_id === sectionId).length,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await createDocument(document);
    documents.push(document);
    // Espande la sezione padre: il nuovo documento deve essere visibile.
    expandedSections.add(sectionId);
    renderProjectsList();

    console.log("Created document:", document.title);
  } catch (error) {
    console.error("Failed to create document:", error);
    showError("Could not create document");
  }
}

export async function selectDocument(doc: Document): Promise<void> {
  setLoadingState(true);
  setCurrentDocument(doc);
  // Sincronizza currentSection con la sezione del doc, così il title bar
  // e altre UI non restano con un currentSection stantio.
  const docSection = sections.find((s) => s.id === doc.section_id) || null;
  if (docSection) setCurrentSection(docSection);
  // Espone globalmente per debug
  (window as any).auraDocument = doc;
  // Read fresh document from DB to get latest content
  try {
    const freshDoc = await getDocument(doc.id);
    if (freshDoc) {
      setCurrentDocument(freshDoc);
      (window as any).auraDocument = freshDoc;
      lastSavedContent = freshDoc.content_json || null;
    } else {
      lastSavedContent = doc.content_json || null;
    }
  } catch (error) {
    console.error("Failed to load document from DB:", error);
    lastSavedContent = doc.content_json || null;
  }
  if (onDocumentSelect) {
    onDocumentSelect(currentDocument!);
  }
  const titleEl = document.getElementById("document-title");
  if (titleEl && currentProject && currentSection) {
    titleEl.textContent = `${currentProject.name} / ${currentSection.name} / ${currentDocument!.title}`;
  }
  // Aggiorna subito la cornice di selezione (documento + sezione che lo
  // contiene) senza ricostruire tutta la lista: preserva scroll e istanze
  // SortableJS. (Bug del ritardo evidenziato da Carlo, 2026-06-26.)
  refreshActiveHighlight(currentDocument!.id, currentSection?.id ?? null);
  setTimeout(() => {
    setLoadingState(false);
  }, 100);
}

// RENDERING moved to ./project-render.ts (phase 3, step 4):
// refreshActiveHighlight, renderProjectsList, createActiveProjectElement,
// createProjectElement, createSectionElement, createDocumentElement,
// startInlineRename, closeAddMenus (+ its global click/Escape listeners).

// INLINE RENAME moved to ./project-render.ts (phase 3, step 4).

// DRAG & DROP
// SortableJS instances — recreated on each render
const sectionInstances: Sortable[] = [];
const docSortables: Map<string, Sortable> = new Map();

// MULTIBRANCH tree helpers (sectionById, childSectionsOf, computeDepth,
// subtreeHeight, isDescendantOf) live in ./project-state since step 1 of the
// refactoring plan.

// DnD persistence moved to ./project-dnd.ts (phase 3, step 5a):
// clearDropIndicators, flashSection, persistMove (DB order writes).

// Floating drag label (identico pattern del v4, riusa #drag-label)
let dragLabelEl: HTMLElement | null = null;
function showDragLabel(text: string): void {
  if (!dragLabelEl) {
    dragLabelEl = document.createElement("div");
    dragLabelEl.id = "drag-label";
    document.body.appendChild(dragLabelEl);
  }
  dragLabelEl.textContent = text;
  dragLabelEl.style.display = "block";
}
function hideDragLabel(): void {
  if (dragLabelEl) {
    dragLabelEl.style.display = "none";
  }
}
document.addEventListener("mousemove", (e) => {
  if (dragLabelEl && dragLabelEl.style.display === "block") {
    dragLabelEl.style.left = e.clientX + 14 + "px";
    dragLabelEl.style.top = e.clientY + 14 + "px";
  }
});

// Menu "+" dropdown global close listeners moved to ./project-render.ts
// (phase 3, step 4).

export function initSortable(): void {
  const projectEl = document.querySelector(".project-item.active") as HTMLElement;
  if (!projectEl) return;

  // Distruggi TUTTE le istanze sezione prima di re-inizializzare (evita ghost
  // duplicati e listener leak).
  sectionInstances.forEach((s) => s.destroy());
  sectionInstances.length = 0;
  pendingChild = null;

  // Multibranch — un'istanza Sortable per ogni .section-children
  // (root + ogni sezione espansa con figli). Group condiviso, forceFallback
  // per WebView2, handle:".drag-handle" isola il drag.
  projectEl.querySelectorAll<HTMLElement>(".section-children").forEach((listEl) => {
    const inst = new Sortable(listEl, {
      group: { name: "sections", pull: true, put: true },
      handle: ".drag-handle",
      draggable: ".section-item",
      animation: 150,
      forceFallback: true,
      fallbackOnBody: true,
      emptyInsertThreshold: 10,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",

      onStart(evt) {
        const id = evt.item.dataset.id!;
        const s = sectionById(id);
        if (s) showDragLabel(`↕ TRASCINANDO: ${s.name}  (L${computeDepth(id)})`);
      },

      onMove(evt, originalEvent) {
        clearDropIndicators();
        pendingChild = null;
        const draggedId = evt.dragged.dataset.id!;

        // Walk-up al .section-item antenato. evt.related è spesso un
        // discendente (.item-header, .drag-handle, .item-name, button); senza
        // walk-up il check classList fallisce e si esce subito, perdendo
        // l'intento FIGLIO sulla meta' alta dell'header target.
        const relatedEl = evt.related as HTMLElement | null;
        let relatedSectionEl: HTMLElement | null = null;
        if (relatedEl) {
          let cur: HTMLElement | null = relatedEl;
          while (cur && cur !== document.body) {
            if (cur.classList && cur.classList.contains("section-item")) {
              relatedSectionEl = cur;
              break;
            }
            cur = cur.parentElement;
          }
        }
        if (!relatedEl || !relatedSectionEl) return true;
        const relatedId = relatedSectionEl.dataset.id!;

        // 50/50: meta' alta dell'header del target = intento FIGLIO.
        const headerEl = relatedSectionEl.querySelector(".item-header") as HTMLElement | null;
        if (!headerEl) return true;
        const rect = headerEl.getBoundingClientRect();
        const y = (originalEvent as MouseEvent).clientY;
        const topHalf = y - rect.top < rect.height / 2;

        if (topHalf) {
          // Validazioni LIVE (feedback col bordo, non a fine drop)
          const wouldDepth = computeDepth(relatedId) + subtreeHeight(draggedId);
          const cycle =
            draggedId === relatedId || isDescendantOf(draggedId, relatedId);
          if (wouldDepth > MAX_DEPTH || cycle) {
            relatedSectionEl.classList.add("drop-blocked");
            return false;
          }
          relatedSectionEl.classList.add("drop-as-child");
          pendingChild = relatedId;
          return false;
        }
        return true;
      },

      onEnd: async (evt) => {
        const draggedId = evt.item.dataset.id!;
        hideDragLabel();
        clearDropIndicators();

        if (pendingChild) {
          const parentId = pendingChild;
          pendingChild = null;
          const ok = await persistMove(draggedId, parentId, 0);
          if (ok) {
            expandedSections.add(parentId);
            renderProjectsList();
            flashSection(parentId);
          } else {
            renderProjectsList();
          }
          return;
        }

        const toEl = evt.to as HTMLElement;
        const parentRaw = toEl.dataset.parent ?? "";
        const newParent: string | null = parentRaw === "" ? null : parentRaw;
        const newIndex = evt.newIndex ?? 0;

        if (
          newParent &&
          (newParent === draggedId || isDescendantOf(draggedId, newParent))
        ) {
          renderProjectsList();
          return;
        }

        const ok = await persistMove(draggedId, newParent, newIndex);
        if (!ok) renderProjectsList();
      },
    });
    sectionInstances.push(inst);
  });

  // Document Sortables — una per ogni sezione
  docSortables.forEach((s) => s.destroy());
  docSortables.clear();

  projectEl.querySelectorAll(".section-item").forEach((el) => {
    const sectionEl = el as HTMLElement;
    const sectionId = sectionEl.dataset.id!;
    const docsList = sectionEl.querySelector(".docs-list") as HTMLElement;
    if (!docsList) return;

    const sortable = new Sortable(docsList, {
      group: {
        name: "documents",
        pull: true,
        put: ["documents"],
      },
      animation: 150,
      draggable: ".document-item",
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      forceFallback: true,
      onEnd: async (evt) => {
        const fromSection = evt.from.closest(".section-item") as HTMLElement;
        const toSection = evt.to.closest(".section-item") as HTMLElement;
        const docEl = evt.item as HTMLElement;
        const docId = docEl.dataset.id!;

        if (!fromSection || !toSection) return;

        const fromSectionId = fromSection.dataset.id!;
        const toSectionId = toSection.dataset.id!;

        if (fromSectionId === toSectionId && evt.oldIndex === evt.newIndex) return;

        // Ricompatta ordini nella sezione di destinazione
        const targetDocs = Array.from(toSection.querySelectorAll(".document-item") as NodeListOf<HTMLElement>).map(
          (el, i) => [el.dataset.id!, i] as [string, number]
        );
        await updateDocumentsOrder(targetDocs);

        // Se cambiato sezione, ricompatta anche la vecchia
        if (fromSectionId !== toSectionId) {
          const oldDocs = Array.from(fromSection.querySelectorAll(".document-item") as NodeListOf<HTMLElement>).map(
            (el, i) => [el.dataset.id!, i] as [string, number]
          );
          await updateDocumentsOrder(oldDocs);

          // Aggiorna sezione del doc spostato
          const movedDoc = documents.find((d) => d.id === docId);
          if (movedDoc) {
            movedDoc.section_id = toSectionId;
            movedDoc.updated_at = Date.now();
            await updateDocument(movedDoc);
          }

          // Espandi la sezione di destinazione
          expandedSections.add(toSectionId);

          // Ricarica documenti
          if (currentSection) {
            setDocuments(await getDocuments(currentSection.id));
          }
        } else {
          // Rileggi documenti dalla stessa sezione
          setDocuments(await getDocuments(toSectionId));
        }

        renderProjectsList();
      },
    });

    docSortables.set(sectionId, sortable);
  });
}

export function selectProject(project: Project): void {
  setCurrentProject(project);
  setCurrentSection(null);
  setCurrentDocument(null);
  lastSavedContent = null; // Reset per nuovo progetto
  // Pulisce lo stato di espansione per evitare ID orfani di un progetto
  // precedente che colliderebbero con sezioni del nuovo progetto.
  expandedSections.clear();
  // Espone globalmente per debug
  (window as any).auraProject = project;
  (window as any).auraSection = null;
  (window as any).auraDocument = null;

  loadSections(project.id);

  if (onProjectChange) {
    onProjectChange(project);
  }

  const titleEl = document.getElementById("document-title");
  if (titleEl) {
    titleEl.textContent = project.name;
  }
}

export function toggleAndSelectSection(section: Section): void {
  // La "selezione" (cornice blu) di una sezione deriva esclusivamente dal
  // documento aperto al suo interno: aprire/chiudere una sezione NON la
  // seleziona. Qui si fa solo il toggle di espansione. (Carlo, 2026-06-26.)
  if (expandedSections.has(section.id)) {
    expandedSections.delete(section.id);
  } else {
    expandedSections.add(section.id);
  }

  renderProjectsList();
}

// ============================================================================
// HELPERS
// ============================================================================

function showError(message: string): void {
  alert(message);
}

// ============================================================================
// EXPORTS
// ============================================================================

function triggerSaveStatusCheck(): void {
  // Chiamato quando l'editor cambia — aggiorna solo lo stato visivo
  updateSaveStatus();
}

// Shared state (currentProject, currentSection, currentDocument, projects,
// sections, documents, expandedSections) is re-exported live from
// ./project-state — see the export block at the top of this file.
// Indexing handlers moved to ./project-indexing.ts and are re-exported to
// keep the public surface unchanged (toolbar.ts imports them from here).

export { triggerSaveStatusCheck, handleSaveToDatabase };
export { handleIndexDocument, handleIndexProject } from "./project-indexing";