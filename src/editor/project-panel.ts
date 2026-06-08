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
  updateProject,
  deleteProject,
  updateSection,
  deleteSection,
  updateDocument,
  deleteDocument,
  saveDocumentVersion,
  getLatestVersion,
  getEntityIndexStatus,
  updateSectionsOrder,
  updateDocumentsOrder,
} from "../database/db";
import { invoke } from "@tauri-apps/api/core";
import type { Project, Section, Document, IndexStatus } from "../types/database";
import {
  extractEntitiesFromDocument,
  extractEntitiesFromSection,
  extractEntitiesFromProject,
} from "../ai-panel/entity-extraction";
import Sortable from "sortablejs";
import { openColorPicker, applyItemColors, createColorBtn } from "./color-picker";
import { listTemplates, getTemplate, createProjectFromTemplate } from "../templates/apply";
import { listUserStyles } from "../database/db";

// State
let currentProject: Project | null = null;
let currentSection: Section | null = null;
let currentDocument: Document | null = null;
let expandedSections: Set<string> = new Set();
let projects: Project[] = [];
let sections: Section[] = [];
let documents: Document[] = [];
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
      currentProject = null;
      currentSection = null;
      currentDocument = null;
      lastSavedContent = null;
      clearEditor();
      renderProjectsList();
    }
  });

  const btnOpenProject = document.getElementById("btn-open-project");
  btnOpenProject?.addEventListener("click", async () => {
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      // Nessuna modifica o utente ha gestito, apri lista progetti
      currentProject = null;
      currentSection = null;
      currentDocument = null;
      lastSavedContent = null;
      clearEditor();
      renderProjectsList();
    }
    // Se 'cancel', non fare nulla - rimani sul documento
  });

  const btnSaveDb = document.getElementById("btn-save-db");
  btnSaveDb?.addEventListener("click", handleSaveToDatabase);

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
function showSaveDialog(): Promise<'save' | 'dont-save' | 'cancel'> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'save-dialog-overlay';
    
    overlay.innerHTML = `
      <div class="save-dialog">
        <h3>Save changes?</h3>
        <p>You have unsaved changes. What would you like to do?</p>
        <div class="save-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn danger" data-action="dont-save">Don't Save</button>
          <button class="save-dialog-btn primary" data-action="save">Save</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Handle button clicks
    overlay.querySelectorAll('.save-dialog-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action') as 'save' | 'dont-save' | 'cancel';
        overlay.remove();
        resolve(action);
      });
    });
    
    // Handle overlay click (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve('cancel');
      }
    });
  });
}

/**
 * Mostra dialog di conferma per "Don't Save"
 * @returns true se conferma, false altrimenti
 */
function showDiscardConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'save-dialog-overlay';
    
    overlay.innerHTML = `
      <div class="save-dialog">
        <h3>Discard changes?</h3>
        <p>The document will revert to its last saved state. All changes since then will be lost.</p>
        <div class="save-dialog-buttons">
          <button class="save-dialog-btn" data-action="back">Go Back</button>
          <button class="save-dialog-btn danger" data-action="confirm">Yes, Discard Changes</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Handle button clicks
    overlay.querySelectorAll('.save-dialog-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm');
      });
    });
    
    // Handle overlay click (back)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

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
    currentDocument = updatedDoc;
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
        currentDocument = updatedDoc;
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

/**
 * Extract plain text from ProseMirror JSON content
 */
function extractTextFromContent(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    if (!doc.content) return "";
    return extractTextFromNode(doc);
  } catch {
    return contentJson; // Fallback to raw text if parsing fails
  }
}

function extractTextFromNode(node: any): string {
  if (typeof node === "string") return node;
  if (!node) return "";
  
  if (node.text) return node.text;
  
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(" ");
  }
  
  return "";
}

function countWordsInContent(contentJson: string): number {
  const text = extractTextFromContent(contentJson);
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Index document content for semantic search
 * Silently fails if Ollama is not available
 */
async function indexDocumentForSearch(
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
  } catch {
    console.log(`Document ${documentId} not indexed (Ollama may not be available)`);
  }
}

async function handleSaveDocument(doc: Document): Promise<void> {
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

function showNotification(message: string, type: "success" | "error" | "indexing" | "info" = "success"): void {
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
async function handleCloseDocument(): Promise<'proceed' | 'cancel'> {
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
    projects = await getProjects();
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
    sections = await getSections(projectId);
    documents = [];
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
      });
    }
    projects.push(projectResult.project);
    currentProject = projectResult.project;
    currentSection = null;
    currentDocument = null;
    sections = projectResult.sections || [];
    documents = [];
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

interface TemplateDialogResult {
  name: string;
  templateType: string;
  chefVariant?: "a" | "b";
  selectedStyle?: string;
}

function showTemplateDialog(): Promise<TemplateDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'project-type-dialog-overlay';

    const templateOptions = listTemplates().map((t) =>
      `<option value="${t.type}">${t.icon} ${t.displayName}</option>`
    ).join('');

    overlay.innerHTML = `
      <div class="project-type-dialog">
        <h3>Create New Project</h3>
        <div class="form-group">
          <label for="tpl-name">Project Name</label>
          <input type="text" id="tpl-name" placeholder="My Project" autofocus>
        </div>
        <div class="form-group">
          <label for="tpl-type">Template</label>
          <select id="tpl-type">${templateOptions}</select>
        </div>
        <div class="form-group" id="tpl-chef-variant-group" style="display:none;">
          <label for="tpl-chef-variant">Chef layout</label>
          <select id="tpl-chef-variant">
            <option value="a">Variant A (flat, 12 sections)</option>
            <option value="b">Variant B (multibranch, 3 levels)</option>
          </select>
        </div>
        <div class="form-group" id="tpl-style-group" style="display:none;">
          <label for="tpl-style">Writing style</label>
          <select id="tpl-style"></select>
          <p class="form-hint" id="tpl-style-hint" style="display:none;">
            Each document can have its own style, configurable from the Customize Document panel.
          </p>
        </div>
        <div class="project-type-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn primary" data-action="create">Create</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#tpl-name') as HTMLInputElement;
    const typeSelect = overlay.querySelector('#tpl-type') as HTMLSelectElement;
    const styleGroup = overlay.querySelector('#tpl-style-group') as HTMLDivElement;
    const styleSelect = overlay.querySelector('#tpl-style') as HTMLSelectElement;
    const styleHint = overlay.querySelector('#tpl-style-hint') as HTMLParagraphElement;
    const chefVariantGroup = overlay.querySelector('#tpl-chef-variant-group') as HTMLDivElement;
    const chefVariantSelect = overlay.querySelector('#tpl-chef-variant') as HTMLSelectElement;

    const refreshStyleOptions = () => {
      const tpl = getTemplate(typeSelect.value);
      if (tpl && tpl.requiresStyleChoice && tpl.styles.length > 0) {
        styleGroup.style.display = '';
        styleHint.style.display = '';
        styleSelect.innerHTML = tpl.styles.map((s) =>
          `<option value="${s.name}"${s.name === tpl.defaultStyleName ? ' selected' : ''}>${s.name}</option>`
        ).join('');
      } else {
        styleGroup.style.display = 'none';
        styleHint.style.display = 'none';
        styleSelect.innerHTML = '';
      }
      if (typeSelect.value === 'chef') {
        chefVariantGroup.style.display = '';
      } else {
        chefVariantGroup.style.display = 'none';
      }
    };
    typeSelect.addEventListener('change', refreshStyleOptions);
    refreshStyleOptions();

    setTimeout(() => nameInput?.focus(), 10);

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        overlay.querySelector('[data-action="create"]')?.dispatchEvent(new Event('click'));
      }
    });

    overlay.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-action');
        if (act === 'cancel') {
          overlay.remove();
          resolve(null);
        } else if (act === 'create') {
          const name = nameInput?.value.trim();
          if (!name) {
            nameInput?.focus();
            return;
          }
          const tpl = getTemplate(typeSelect.value);
          overlay.remove();
          resolve({
            name,
            templateType: typeSelect.value,
            chefVariant: typeSelect.value === 'chef' ? (chefVariantSelect.value as "a" | "b") : undefined,
            selectedStyle: (tpl && tpl.requiresStyleChoice && styleSelect.value) ? styleSelect.value : undefined,
          });
        }
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
  });
}

interface ProjectTypeResult {
  name: string;
  type: string;
}

function showProjectTypeDialog(): Promise<ProjectTypeResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'project-type-dialog-overlay';

    overlay.innerHTML = `
      <div class="project-type-dialog">
        <h3>Create New Project</h3>
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input type="text" id="project-name" placeholder="My Project" autofocus>
        </div>
        <div class="form-group">
          <label for="project-type">Project Type</label>
          <select id="project-type">
            <option value="novel">Novel</option>
            <option value="script">Script</option>
            <option value="article">Article</option>
            <option value="notes">Notes</option>
            <option value="legal">Legal</option>
            <option value="research">Research</option>
            <option value="custom">Custom...</option>
          </select>
        </div>
        <div class="form-group custom-type-input" id="custom-type-container">
          <label for="custom-type">Custom Type Name</label>
          <input type="text" id="custom-type" placeholder="e.g., Blog, Thesis">
        </div>
        <div class="project-type-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn primary" data-action="create">Create</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#project-name') as HTMLInputElement;
    const typeSelect = overlay.querySelector('#project-type') as HTMLSelectElement;
    const customContainer = overlay.querySelector('#custom-type-container') as HTMLDivElement;
    const customInput = overlay.querySelector('#custom-type') as HTMLInputElement;

    // Focus name input
    setTimeout(() => nameInput?.focus(), 10);

    // Show/hide custom type input
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'custom') {
        customContainer.classList.add('visible');
        customInput?.focus();
      } else {
        customContainer.classList.remove('visible');
      }
    });

    // Handle Enter key on name input
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (typeSelect.value === 'custom') {
          customInput?.focus();
        } else {
          overlay.querySelector('[data-action="create"]')?.dispatchEvent(new Event('click'));
        }
      }
    });

    // Handle Enter key on custom type input
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        overlay.querySelector('[data-action="create"]')?.dispatchEvent(new Event('click'));
      }
    });

    // Handle button clicks
    overlay.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');

        if (action === 'cancel') {
          overlay.remove();
          resolve(null);
        } else if (action === 'create') {
          const name = nameInput?.value.trim();
          if (!name) {
            nameInput?.focus();
            return;
          }

          let type = typeSelect?.value;
          if (type === 'custom') {
            type = customInput?.value.trim().toLowerCase() || 'custom';
          }

          overlay.remove();
          resolve({ name, type });
        }
      });
    });

    // Handle overlay click (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });
  });
}

/**
 * Show a custom confirmation dialog
 * @returns true if confirmed, false otherwise
 */
function showProjectAISettingsDialog(project: Project): Promise<void> {
  return new Promise((resolve) => {
    const tpl = getTemplate(project.template_type);
    const defaultSuggestions = tpl ? tpl.prompts.suggestions : "You are a helpful writing assistant.";
    const defaultChat = tpl ? tpl.prompts.chat : "You are a helpful writing assistant.";
    const styles = tpl ? tpl.styles.map((s) => s.name) : [];

    const overlay = document.createElement("div");
    overlay.className = "save-dialog-overlay";

    const currentSuggestions = project.suggestions_prompt_override ?? defaultSuggestions;
    const currentChat = project.chat_prompt_override ?? defaultChat;
    const currentStyle = project.selected_style ?? tpl?.defaultStyleName ?? "";

    overlay.innerHTML = `
      <div class="save-dialog" style="max-width: 700px;">
        <h3>AI Settings — ${escapeHtml(project.name)}</h3>
        <p style="color: var(--color-text-muted, #888); font-size: 12px; margin: 4px 0 16px;">
          Template: <strong>${escapeHtml(tpl ? `${tpl.icon} ${tpl.displayName}` : project.template_type)}</strong>.
          Leave a field empty to use the template default. Click Reset to clear all overrides.
        </p>
        <div class="form-group">
          <label for="ai-suggestions">Suggestions prompt</label>
          <textarea id="ai-suggestions" rows="4" placeholder="${escapeHtml(defaultSuggestions)}">${escapeHtml(currentSuggestions)}</textarea>
        </div>
        <div class="form-group">
          <label for="ai-chat">Chat prompt</label>
          <textarea id="ai-chat" rows="4" placeholder="${escapeHtml(defaultChat)}">${escapeHtml(currentChat)}</textarea>
        </div>
        ${styles.length > 0 ? `
        <div class="form-group">
          <label for="ai-style">Writing style</label>
          <select id="ai-style">
            ${styles.map((s) => `<option value="${escapeHtml(s)}"${s === currentStyle ? ' selected' : ''}>${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
        ` : ""}
        <div class="save-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn" data-action="reset" title="Clear all overrides and use the template defaults">Reset</button>
          <button class="save-dialog-btn primary" data-action="save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const suggestionsInput = overlay.querySelector("#ai-suggestions") as HTMLTextAreaElement;
    const chatInput = overlay.querySelector("#ai-chat") as HTMLTextAreaElement;
    const styleSelect = overlay.querySelector("#ai-style") as HTMLSelectElement | null;

    overlay.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");
        if (action === "cancel") {
          overlay.remove();
          resolve();
        } else if (action === "save") {
          const newSuggestions = suggestionsInput.value.trim();
          const newChat = chatInput.value.trim();
          const newStyle = styleSelect ? styleSelect.value : currentStyle;
          const updated: Project = {
            ...project,
            suggestions_prompt_override: newSuggestions || undefined,
            chat_prompt_override: newChat || undefined,
            selected_style: newStyle || undefined,
            updated_at: Date.now(),
          };
          try {
            await updateProject(updated);
            // Refresh local state
            const idx = projects.findIndex((p) => p.id === project.id);
            if (idx >= 0) projects[idx] = updated;
            if (currentProject && currentProject.id === project.id) {
              currentProject = updated;
            }
            showNotification("AI settings saved", "success");
            overlay.remove();
            resolve();
          } catch (e) {
            console.error("Failed to save AI settings:", e);
            showNotification("Could not save AI settings", "error");
          }
        } else if (action === "reset") {
          const ok = await showConfirmDialog(
            "Reset AI settings?",
            "This will clear your custom prompts and writing style, and restore the template defaults."
          );
          if (!ok) return;
          const updated: Project = {
            ...project,
            suggestions_prompt_override: undefined,
            chat_prompt_override: undefined,
            selected_style: tpl?.defaultStyleName ?? undefined,
            updated_at: Date.now(),
          };
          try {
            await updateProject(updated);
            const idx = projects.findIndex((p) => p.id === project.id);
            if (idx >= 0) projects[idx] = updated;
            if (currentProject && currentProject.id === project.id) {
              currentProject = updated;
            }
            showNotification("AI settings reset to template defaults", "success");
            overlay.remove();
            resolve();
          } catch (e) {
            console.error("Failed to reset AI settings:", e);
            showNotification("Could not reset AI settings", "error");
          }
        }
      });
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve();
      }
    });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showConfirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'save-dialog-overlay';

    overlay.innerHTML = `
      <div class="save-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="save-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn danger" data-action="confirm">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Handle button clicks
    overlay.querySelectorAll('.save-dialog-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        overlay.remove();
        resolve(action === 'confirm');
      });
    });

    // Handle overlay click (cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    // Handle Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        resolve(false);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  });
}

async function handleDeleteProject(project: Project): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete project "${project.name}"?`,
    "This will delete the project and all its sections, documents, and data. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteProject(project.id);
    projects = projects.filter(p => p.id !== project.id);
    if (currentProject?.id === project.id) {
      currentProject = null;
      currentSection = null;
      currentDocument = null;
    }
    renderProjectsList();
    console.log("Deleted project:", project.name);
  } catch (error) {
    console.error("Failed to delete project:", error);
    showError("Could not delete project");
  }
}

async function handleDeleteSection(section: Section): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete section "${section.name}"?`,
    "This will delete the section and all its documents. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteSection(section.id);
    sections = sections.filter(s => s.id !== section.id);
    documents = documents.filter(d => d.section_id !== section.id);
    if (currentSection?.id === section.id) {
      currentSection = null;
      currentDocument = null;
    }
    renderProjectsList();
    console.log("Deleted section:", section.name);
  } catch (error) {
    console.error("Failed to delete section:", error);
    showError("Could not delete section");
  }
}

async function handleDeleteDocument(doc: Document): Promise<void> {
  const confirmed = await showConfirmDialog(
    `Delete document "${doc.title}"?`,
    "This document will be permanently deleted. This action cannot be undone."
  );

  if (!confirmed) return;

  try {
    await deleteDocument(doc.id);
    documents = documents.filter(d => d.id !== doc.id);
    if (currentDocument?.id === doc.id) {
      currentDocument = null;
      clearEditor();
    }
    renderProjectsList();
    console.log("Deleted document:", doc.title);
  } catch (error) {
    console.error("Failed to delete document:", error);
    showError("Could not delete document");
  }
}

// ============================================================================
// ENTITY INDEXING
// ============================================================================

let isIndexing = false;

async function handleIndexDocument(doc: Document): Promise<void> {
  if (!currentProject) return;
  if (isIndexing) {
    showNotification("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    showNotification("🗂 Indexing entities...", "indexing");
    const result = await extractEntitiesFromDocument(
      doc.id,
      currentProject.id,
      currentProject.type || "novel",
      (msg) => showNotification(`🗂 ${msg}`, "indexing"),
    );
    if (result.skipped) {
      const reasonMsg = {
        empty: "document is empty",
        no_text: "document has no text",
        error: "extraction failed",
      }[result.reason || "empty"];
      showNotification(`⏭ ${doc.title}: ${reasonMsg}, nothing to index`, "info");
    } else {
      showNotification(`✓ ${doc.title}: ${result.created} created, ${result.updated} updated`, "success");
    }
  } catch (error) {
    showNotification(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

async function handleIndexSection(section: Section): Promise<void> {
  if (!currentProject) return;
  if (isIndexing) {
    showNotification("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    showNotification("🗂 Indexing section...", "indexing");
    const result = await extractEntitiesFromSection(
      section.id,
      currentProject.id,
      currentProject.type || "novel",
      (msg) => showNotification(`🗂 ${msg}`, "indexing"),
    );
    showNotification(`✓ ${section.name}: ${result.created} created, ${result.updated} updated`, "success");
  } catch (error) {
    showNotification(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

async function handleIndexProject(project: Project): Promise<void> {
  if (isIndexing) {
    showNotification("Already indexing, please wait...", "error");
    return;
  }
  isIndexing = true;

  try {
    showNotification("🗂 Indexing project...", "indexing");
    const result = await extractEntitiesFromProject(
      project.id,
      project.type || "novel",
      (msg) => showNotification(`🗂 ${msg}`, "indexing"),
    );
    showNotification(`✓ Project indexed: ${result.created} created, ${result.updated} updated`, "success");
  } catch (error) {
    showNotification(`✗ Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    isIndexing = false;
    updateIndexIndicators();
  }
}

async function updateIndexIndicators(): Promise<void> {
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

function applyIndexStatus(btn: HTMLButtonElement, status: IndexStatus): void {
  btn.classList.remove("index-red", "index-yellow", "index-green");
  btn.classList.add(`index-${status.status}`);

  const tooltips: Record<string, string> = {
    red: "Not indexed — click to extract entities",
    yellow: "Outdated — document modified since last indexing",
    green: `Indexed — ${status.entity_count} entities linked`,
  };
  btn.title = tooltips[status.status] || "Index entities";
}

async function handleNewSection(projectId: string): Promise<void> {
  const name = prompt("Section name:");
  if (!name) return;

  try {
    const existingSections = await getSections(projectId);
    const orderIndex = existingSections.length;

    const section: Section = {
      id: `${Date.now()}-${crypto.randomUUID().slice(0, 9)}`,
      project_id: projectId,
      parent_id: null as any, // null for top-level sections
      name,
      order_index: orderIndex,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await createSection(section);
    sections.push(section);
    // Nuova sezione nasce espansa: l'utente l'ha appena creata, vuole vederla.
    expandedSections.add(section.id);
    currentSection = section;
    renderProjectsList();

    console.log("Created section:", section.name);
  } catch (error) {
    console.error("Failed to create section:", error);
    showError("Could not create section");
  }
}

async function handleNewDocument(sectionId: string): Promise<void> {
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

async function selectDocument(doc: Document): Promise<void> {
  (window as any).__aurawrite_loading = true;
  currentDocument = doc;
  // Sincronizza currentSection con la sezione del doc, così il title bar
  // e altre UI non restano con un currentSection stantio.
  const docSection = sections.find((s) => s.id === doc.section_id) || null;
  if (docSection) currentSection = docSection;
  // Espone globalmente per debug
  (window as any).auraDocument = doc;
  // Read fresh document from DB to get latest content
  try {
    const freshDoc = await getDocument(doc.id);
    if (freshDoc) {
      currentDocument = freshDoc;
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
  setTimeout(() => {
    (window as any).__aurawrite_loading = false;
  }, 100);
}

// ============================================================================
// RENDERING
// ============================================================================

function renderProjectsList(): void {
  const container = document.getElementById("projects-list");
  if (!container) return;

  const btnBackProjects = document.getElementById("btn-back-projects");
  if (btnBackProjects) {
    btnBackProjects.style.display = currentProject ? "inline-flex" : "none";
  }
  const btnAiSettings = document.getElementById("btn-ai-settings");
  if (btnAiSettings) {
    btnAiSettings.style.display = currentProject ? "inline-flex" : "none";
  }

  container.innerHTML = "";

  if (projects.length === 0) {
    container.innerHTML = `
      <div class="project-panel__empty">
        <p>No projects</p>
        <p class="hint">Click "+" to create one</p>
      </div>
    `;
    return;
  }

  // Se nessun progetto selezionato, mostra lista
  if (!currentProject) {
    // Header con titolo
    const header = document.createElement("div");
    header.className = "project-panel__list-header";
    header.innerHTML = `
      <span class="project-panel__list-title">Select a project:</span>
    `;
    container.appendChild(header);

    projects.forEach((project) => {
      const projectEl = createProjectElement(project);
      container.appendChild(projectEl);
    });
    return;
  }

  // Mostra solo il progetto attivo con la sua gerarchia
  const activeProjectEl = createActiveProjectElement(currentProject);
  container.appendChild(activeProjectEl);

  updateIndexIndicators();

  // Init SortableJS after DOM is rendered
  initSortable();
}

function createActiveProjectElement(project: Project): HTMLElement {
  const div = document.createElement("div");
  div.className = "project-item active";

  // Header del progetto con azioni
  const header = document.createElement("div");
  header.className = "item-header";

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.innerHTML = `<strong>${project.name}</strong>`;
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineRename(nameEl, project.name, async (newName) => {
      project.name = newName;
      project.updated_at = Date.now();
      await updateProject(project);
      nameEl.innerHTML = `<strong>${newName}</strong>`;
      const titleEl = document.getElementById("document-title");
      if (titleEl && currentSection && currentDocument) {
        titleEl.textContent = `${newName} / ${currentSection.name} / ${currentDocument.title}`;
      } else if (titleEl) {
        titleEl.textContent = newName;
      }
    }, () => {
      nameEl.innerHTML = `<strong>${project.name}</strong>`;
    });
  });

  // Container per azioni inline
  const actionsEl = document.createElement("div");
  actionsEl.className = "item-actions";

  // Pulsante + Section
  const addSectionBtn = document.createElement("button");
  addSectionBtn.className = "item-action-btn";
  addSectionBtn.textContent = "+ Sec";
  addSectionBtn.title = "Add section";
  addSectionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleNewSection(project.id);
  });
  actionsEl.appendChild(addSectionBtn);

  const indexBtn = document.createElement("button");
  indexBtn.className = "item-action-btn index-btn";
  indexBtn.textContent = "🗂";
  indexBtn.title = "Index all entities in project";
  indexBtn.dataset.targetType = "project";
  indexBtn.dataset.targetId = project.id;
  indexBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleIndexProject(project);
  });
  actionsEl.appendChild(indexBtn);

  // Pulsante elimina
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete project";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteProject(project);
  });
  actionsEl.appendChild(deleteBtn);

  header.appendChild(nameEl);

  const colorBtnProject = createColorBtn();
  colorBtnProject.addEventListener("click", (e) => {
    e.stopPropagation();
    openColorPicker({
      itemType: "project",
      itemId: project.id,
      currentName: project.name,
      currentBg: project.bg_color,
      currentText: project.text_color,
      onSave: async (newName, bg, text) => {
        project.name = newName;
        project.bg_color = bg;
        project.text_color = text;
        project.updated_at = Date.now();
        await updateProject(project);
        nameEl.innerHTML = `<strong>${newName}</strong>`;
        applyItemColors(header, bg, text, "project");
        const titleEl = document.getElementById("document-title");
        if (titleEl && currentSection && currentDocument) {
          titleEl.textContent = `${newName} / ${currentSection.name} / ${currentDocument.title}`;
        } else if (titleEl) {
          titleEl.textContent = newName;
        }
      },
      onReset: async () => {
        project.bg_color = undefined;
        project.text_color = undefined;
        project.updated_at = Date.now();
        await updateProject(project);
        applyItemColors(header, undefined, undefined, "project");
      },
    });
  });
  header.appendChild(colorBtnProject);

  header.appendChild(actionsEl);
  div.appendChild(header);

  // Lista sezioni — render ricorsivo con container radice
  // Regola: .section-children esiste SOLO per figli diretti del container radice
  // (le sezioni top-level con parent_id nullo o orfano). Le sezioni nidificate
  // sono renderizzate dentro il .section-children del rispettivo parent in
  // createSectionElement.
  const sectionsList = document.createElement("div");
  sectionsList.className = "section-children root";
  sectionsList.dataset.parent = "";

  const roots = childSectionsOf(null);
  for (const section of roots) {
    sectionsList.appendChild(createSectionElement(section));
  }
  div.appendChild(sectionsList);

  applyItemColors(header, project.bg_color, project.text_color, "project");

  return div;
}

function createProjectElement(project: Project): HTMLElement {
  // Usato solo per la lista di selezione (quando nessun progetto è attivo)
  const div = document.createElement("div");
  div.className = "project-item";

  const header = document.createElement("div");
  header.className = "item-header";

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.textContent = project.name;
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineRename(nameEl, project.name, async (newName) => {
      project.name = newName;
      project.updated_at = Date.now();
      await updateProject(project);
      renderProjectsList();
    });
  });

  // Container per azioni inline
  const actionsEl = document.createElement("div");
  actionsEl.className = "item-actions";

  // Pulsante + Section
  const addSectionBtn = document.createElement("button");
  addSectionBtn.className = "item-action-btn";
  addSectionBtn.textContent = "+ Sec";
  addSectionBtn.title = "Add section";
  addSectionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleNewSection(project.id);
  });
  actionsEl.appendChild(addSectionBtn);

  // Pulsante elimina
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete project";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteProject(project);
  });
  actionsEl.appendChild(deleteBtn);

  const colorBtnProjectList = createColorBtn();
  colorBtnProjectList.addEventListener("click", (e) => {
    e.stopPropagation();
    openColorPicker({
      itemType: "project",
      itemId: project.id,
      currentName: project.name,
      currentBg: project.bg_color,
      currentText: project.text_color,
      onSave: async (newName, bg, text) => {
        project.name = newName;
        project.bg_color = bg;
        project.text_color = text;
        project.updated_at = Date.now();
        await updateProject(project);
        nameEl.textContent = newName;
        applyItemColors(header, bg, text, "project");
      },
      onReset: async () => {
        project.bg_color = undefined;
        project.text_color = undefined;
        project.updated_at = Date.now();
        await updateProject(project);
        applyItemColors(header, undefined, undefined, "project");
      },
    });
  });

  header.appendChild(nameEl);
  header.appendChild(colorBtnProjectList);
  header.appendChild(actionsEl);

  // Click sull'header del progetto attivo: idempotente (se è già il progetto
  // corrente, non fa nulla). Il rename è gestito esclusivamente da nameEl
  // (dblclick), quindi qui niente timer.
  header.addEventListener("click", async () => {
    if (currentProject?.id === project.id) return;
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      selectProject(project);
    }
  });
  div.appendChild(header);

  applyItemColors(header, project.bg_color, project.text_color, "project");

  return div;
}

function createSectionElement(section: Section): HTMLElement {
  const div = document.createElement("div");
  div.className = "section-item";
  if (currentSection?.id === section.id) {
    div.classList.add("active");
  }
  div.dataset.id = section.id;
  div.dataset.type = "section";

  const header = document.createElement("div");
  header.className = "item-header";

  const dragHandle = document.createElement("span");
  dragHandle.className = "drag-handle";
  dragHandle.textContent = "⋮";
  dragHandle.title = "Drag to move";

  const isExpanded = expandedSections.has(section.id);
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "section-toggle-btn";
  toggleBtn.textContent = isExpanded ? "▼" : "▶";
  toggleBtn.title = isExpanded ? "Collapse section" : "Expand section";
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAndSelectSection(section);
  });

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.textContent = section.name;
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineRename(nameEl, section.name, async (newName) => {
      section.name = newName;
      section.updated_at = Date.now();
      await updateSection(section);
      renderProjectsList();
    });
  });

  // Container per azioni inline
  const actionsEl = document.createElement("div");
  actionsEl.className = "item-actions";

  // Pulsante + Document (sempre visibile)
  const addDocBtn = document.createElement("button");
  addDocBtn.className = "item-action-btn";
  addDocBtn.textContent = "+ Doc";
  addDocBtn.title = "Add document";
  addDocBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleNewDocument(section.id);
  });
  actionsEl.appendChild(addDocBtn);

  const indexBtn = document.createElement("button");
  indexBtn.className = "item-action-btn index-btn";
  indexBtn.textContent = "🗂";
  indexBtn.title = "Index entities in this section";
  indexBtn.dataset.targetType = "section";
  indexBtn.dataset.targetId = section.id;
  indexBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleIndexSection(section);
  });
  actionsEl.appendChild(indexBtn);

  // Pulsante elimina
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete section";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteSection(section);
  });
  actionsEl.appendChild(deleteBtn);

  header.appendChild(dragHandle);
  header.appendChild(toggleBtn);
  header.appendChild(nameEl);

  const colorBtnSection = createColorBtn();
  colorBtnSection.addEventListener("click", (e) => {
    e.stopPropagation();
    const tpl = currentProject?.template_type ? getTemplate(currentProject.template_type) : null;
    const tplStyles = tpl?.styles?.map(s => s.name) || [];
    openColorPicker({
      itemType: "section",
      itemId: section.id,
      currentName: section.name,
      currentBg: section.bg_color,
      currentText: section.text_color,
      currentStyle: section.selected_style,
      styles: tplStyles.length > 0 ? tplStyles : undefined,
      onSave: async (newName, bg, text, style) => {
        section.name = newName;
        section.bg_color = bg;
        section.text_color = text;
        section.selected_style = style || null;
        section.updated_at = Date.now();
        await updateSection(section);
        nameEl.textContent = newName;
        applyItemColors(header, bg, text, "section");
      },
      onReset: async () => {
        section.bg_color = undefined;
        section.text_color = undefined;
        section.selected_style = null;
        section.updated_at = Date.now();
        await updateSection(section);
        applyItemColors(header, undefined, undefined, "section");
      },
    });
  });
  header.appendChild(colorBtnSection);

  header.appendChild(actionsEl);

  // Click sull'header (escluso toggle, actions, color button che hanno
  // stopPropagation) = toggle espansione + selezione. Niente timer, niente
  // dblclick handler qui: il rename è gestito esclusivamente da nameEl.
  header.addEventListener("click", () => {
    toggleAndSelectSection(section);
  });

  div.appendChild(header);

  // Multibranch: container figli sezione — SOLO se espansa E ha figli
  // (regola semplificata, identica al pattern di .docs-list)
  const childSections = childSectionsOf(section.id);
  if (isExpanded && childSections.length > 0) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "section-children";
    childrenContainer.dataset.parent = section.id;
    for (const child of childSections) {
      childrenContainer.appendChild(createSectionElement(child));
    }
    div.appendChild(childrenContainer);
  }

  // Lista documenti — target di SortableJS "documents"
  const docsList = document.createElement("div");
  docsList.className = "docs-list";

  const sectionDocs = documents
    .filter((doc) => doc.section_id === section.id)
    .sort((a, b) => a.order_index - b.order_index);
  if (isExpanded && sectionDocs.length > 0) {
    sectionDocs.forEach((doc) => {
      const docEl = createDocumentElement(doc);
      docsList.appendChild(docEl);
    });
  }
  div.appendChild(docsList);

  applyItemColors(header, section.bg_color, section.text_color, "section");

  return div;
}

function createDocumentElement(doc: Document): HTMLElement {
  const div = document.createElement("div");
  div.className = "document-item";
  if (currentDocument?.id === doc.id) {
    div.classList.add("active");
  }
  div.dataset.id = doc.id;
  div.dataset.type = "document";
  div.dataset.sectionId = doc.section_id;

  const header = document.createElement("div");
  header.className = "item-header";

  const dragHandle = document.createElement("span");
  dragHandle.className = "drag-handle";
  dragHandle.textContent = "⋮";
  dragHandle.title = "Drag to move";

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.textContent = doc.title;
  nameEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startInlineRename(nameEl, doc.title, async (newName) => {
      doc.title = newName;
      doc.updated_at = Date.now();
      await updateDocument(doc);
      renderProjectsList();
    });
  });

  // Container per azioni inline (save + delete per document)
  const actionsEl = document.createElement("div");
  actionsEl.className = "item-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "item-action-btn";
  saveBtn.textContent = "💾";
  saveBtn.title = "Save document";
  saveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await handleSaveDocument(doc);
  });
  actionsEl.appendChild(saveBtn);

  const indexBtn = document.createElement("button");
  indexBtn.className = "item-action-btn index-btn";
  indexBtn.textContent = "🗂";
  indexBtn.title = "Index entities in this document";
  indexBtn.dataset.targetType = "document";
  indexBtn.dataset.targetId = doc.id;
  indexBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleIndexDocument(doc);
  });
  actionsEl.appendChild(indexBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete document";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteDocument(doc);
  });
  actionsEl.appendChild(deleteBtn);

  header.appendChild(dragHandle);
  header.appendChild(nameEl);

  const colorBtnDoc = createColorBtn();
  colorBtnDoc.addEventListener("click", (e) => {
    e.stopPropagation();
    const tpl = currentProject?.template_type ? getTemplate(currentProject.template_type) : null;
    const tplStyles = tpl?.styles?.map(s => s.name) || [];
    openColorPicker({
      itemType: "document",
      itemId: doc.id,
      currentName: doc.title,
      currentBg: doc.bg_color,
      currentText: doc.text_color,
      currentStyle: doc.selected_style,
      styles: tplStyles.length > 0 ? tplStyles : undefined,
      onSave: async (newName, bg, text, style) => {
        doc.title = newName;
        doc.bg_color = bg;
        doc.text_color = text;
        doc.selected_style = style || null;
        doc.updated_at = Date.now();
        await updateDocument(doc);
        nameEl.textContent = newName;
        applyItemColors(header, bg, text, "document");
      },
      onReset: async () => {
        doc.bg_color = undefined;
        doc.text_color = undefined;
        doc.selected_style = null;
        doc.updated_at = Date.now();
        await updateDocument(doc);
        applyItemColors(header, undefined, undefined, "document");
      },
    });
  });
  header.appendChild(colorBtnDoc);

  header.appendChild(actionsEl);
  let docClickTimer: ReturnType<typeof setTimeout> | null = null;
  header.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (currentDocument?.id === doc.id) return;
    if (docClickTimer) {
      clearTimeout(docClickTimer);
      docClickTimer = null;
      return;
    }
    docClickTimer = setTimeout(async () => {
      docClickTimer = null;
      const action = await handleCloseDocument();
      if (action === 'proceed') {
        await selectDocument(doc);
      }
    }, 300);
  });
  header.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (docClickTimer) {
      clearTimeout(docClickTimer);
      docClickTimer = null;
    }
  });
  div.appendChild(header);

  applyItemColors(header, doc.bg_color, doc.text_color, "document");

  return div;
}

// ============================================================================
// INLINE RENAME
// ============================================================================

function startInlineRename(
  el: HTMLElement,
  currentName: string,
  onSave: (newName: string) => Promise<void>,
  onCancel?: () => void,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "inline-rename-input";

  el.textContent = "";
  el.appendChild(input);
  input.focus();
  input.select();

  let saved = false;

  const save = async () => {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      await onSave(newName);
    } else {
      if (onCancel) {
        onCancel();
      } else {
        el.textContent = currentName;
      }
    }
  };

  input.addEventListener("blur", () => save());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      saved = true;
      if (onCancel) {
        onCancel();
      } else {
        el.textContent = currentName;
      }
    }
  });
}

// DRAG & DROP
// SortableJS instances — recreated on each render
const sectionInstances: Sortable[] = [];
const docSortables: Map<string, Sortable> = new Map();

// =============================================================================
// MULTIBRANCH — helpers per drag & drop sezioni
// =============================================================================

function sectionById(id: string): Section | undefined {
  return sections.find((s) => s.id === id);
}

function childSectionsOf(parentId: string | null): Section[] {
  return sections
    .filter((s) => (s.parent_id ?? null) === parentId)
    .sort((a, b) => a.order_index - b.order_index);
}

function computeDepth(id: string): number {
  let d = 1;
  let n = sectionById(id);
  while (n && n.parent_id) {
    d++;
    n = sectionById(n.parent_id);
  }
  return d;
}

function subtreeHeight(id: string): number {
  const kids = childSectionsOf(id);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(k.id)));
}

function isDescendantOf(ancestorId: string, candidateId: string): boolean {
  let n = sectionById(candidateId);
  while (n && n.parent_id) {
    if (n.parent_id === ancestorId) return true;
    n = sectionById(n.parent_id);
  }
  return false;
}

function clearDropIndicators(): void {
  document
    .querySelectorAll(".section-item.drop-as-child, .section-item.drop-blocked")
    .forEach((el) => el.classList.remove("drop-as-child", "drop-blocked"));
}

function flashSection(id: string): void {
  const el = document.querySelector(`.section-item[data-id="${id}"]`) as HTMLElement | null;
  if (!el) return;
  el.classList.add("child-flash");
  setTimeout(() => el.classList.remove("child-flash"), 1000);
}

// Persisti lo spostamento di una sezione: aggiorna parent_id + order_index
// della sezione spostata, poi ricompatta gli ordini dei fratelli in origine e
// destinazione. Stesso pattern dei documenti cross-section, senza toccare il
// backend Rust. Tauri v2: snake_case in Rust → camelCase in invoke.
async function persistMove(
  sectionId: string,
  newParentId: string | null,
  newIndex: number
): Promise<boolean> {
  if (!currentProject) return false;
  const section = sectionById(sectionId);
  if (!section) return false;
  const oldParentId = section.parent_id ?? null;

  // Aggiorna modello locale
  section.parent_id = newParentId ?? undefined;
  section.order_index = newIndex;
  section.updated_at = Date.now();

  // Ricompatta ordini destinazione
  const destSiblings = childSectionsOf(newParentId).filter((s) => s.id !== sectionId);
  destSiblings.splice(newIndex, 0, section);
  for (let i = 0; i < destSiblings.length; i++) destSiblings[i].order_index = i;

  // Ricompatta ordini origine se parent cambiato
  const oldSiblingsChanged = oldParentId !== newParentId;
  const oldSiblings = oldSiblingsChanged ? childSectionsOf(oldParentId) : [];
  for (let i = 0; i < oldSiblings.length; i++) oldSiblings[i].order_index = i;

  try {
    // 1) Aggiorna la sezione spostata (parent_id + order_index).
    // NB: Tauri v2 per strutture annidate (section: Section) usa snake_case
    // di default sul payload JS; solo i parametri primitivi dei command sono
    // auto-convertiti a camelCase.
    await invoke("db_update_section", {
      section: {
        id: section.id,
        project_id: section.project_id,
        parent_id: section.parent_id ?? null,
        name: section.name,
        order_index: section.order_index,
        bg_color: section.bg_color ?? null,
        text_color: section.text_color ?? null,
        section_type: section.section_type ?? null,
        created_at: section.created_at,
        updated_at: section.updated_at,
      },
    });

    // 2) Ricompatta ordini destinazione
    await invoke("db_update_sections_order", {
      orders: destSiblings.map((s) => [s.id, s.order_index]),
    });

    // 3) Se parent cambiato, ricompatta anche origine
    if (oldSiblingsChanged) {
      await invoke("db_update_sections_order", {
        orders: oldSiblings.map((s) => [s.id, s.order_index]),
      });
    }

    // 4) Ricarica sezioni dal DB
    sections = await getSections(currentProject.id);
    return true;
  } catch (e) {
    console.error("[multibranch] persistMove failed:", e);
    return false;
  }
}

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

function initSortable(): void {
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
            documents = await getDocuments(currentSection.id);
          }
        } else {
          // Rileggi documenti dalla stessa sezione
          documents = await getDocuments(toSectionId);
        }

        renderProjectsList();
      },
    });

    docSortables.set(sectionId, sortable);
  });
}

function selectProject(project: Project): void {
  currentProject = project;
  currentSection = null;
  currentDocument = null;
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

function toggleAndSelectSection(section: Section): void {
  currentSection = section;
  // Toggle espansione: se la sezione era espansa, collassa; altrimenti espandi.
  // Unico entry point per modificare lo stato di una sezione (chiamato sia dal
  // click sull'header che dal toggle ▼/▶). Niente timer, niente loadDocuments
  // parziale: la lista `documents` contiene già tutti i documenti del progetto
  // grazie a `loadSections`.
  if (expandedSections.has(section.id)) {
    expandedSections.delete(section.id);
  } else {
    expandedSections.add(section.id);
  }

  const titleEl = document.getElementById("document-title");
  if (titleEl && currentProject) {
    titleEl.textContent = `${currentProject.name} / ${section.name}`;
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

export {
  currentProject,
  currentSection,
  currentDocument,
  projects,
  sections,
  documents,
  triggerSaveStatusCheck,
  handleSaveToDatabase,
  handleIndexDocument,
  handleIndexProject,
};