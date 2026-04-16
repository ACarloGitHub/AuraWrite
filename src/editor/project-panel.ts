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
} from "../database/db";
import type { Project, Section, Document } from "../types/database";

// State
let currentProject: Project | null = null;
let currentSection: Section | null = null;
let currentDocument: Document | null = null;
let projects: Project[] = [];
let sections: Section[] = [];
let documents: Document[] = [];
let lastSavedContent: string | null = null; // Contenuto salvato nel DB (per confronto)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let showingProjectList = false; // Se true, mostra lista progetti invece del progetto attivo

// Callbacks (set by main.ts)
let onDocumentSelect: ((doc: Document) => void) | null = null;
let onProjectChange: ((project: Project | null) => void) | null = null;
let onContentChange: ((content: string) => void) | null = null;
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
    onContentChange?: (content: string) => void;
    getEditorContent?: () => string | null;
  } = {}
): void {
  onDocumentSelect = callbacks.onDocumentSelect || null;
  onProjectChange = callbacks.onProjectChange || null;
  onContentChange = callbacks.onContentChange || null;
  getEditorContent = callbacks.getEditorContent || null;

  const btnNewProject = document.getElementById("btn-new-project");
  btnNewProject?.addEventListener("click", handleNewProject);

  const btnBackProjects = document.getElementById("btn-back-projects");
  btnBackProjects?.addEventListener("click", async () => {
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      showingProjectList = true;
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
      showingProjectList = true;
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
    btnProjects?.classList.toggle("active");
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
  
  if (lastSavedContent === null) {
    try {
      const parsed = JSON.parse(currentContent);
      if (parsed.content && parsed.content.length > 0) {
        const hasText = parsed.content.some((node: any) => 
          node.content && node.content.some((child: any) => child.text && child.text.length > 0)
        );
        return hasText;
      }
      return false;
    } catch {
      return currentContent !== "";
    }
  }
  
  return currentContent !== lastSavedContent;
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
  if (!currentDocument) return false;

  try {
    const updatedDoc: Document = {
      ...currentDocument,
      content_json: content,
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

  // Save current document content from editor first
  if (currentDocument && getEditorContent) {
    const content = getEditorContent();
    if (content) {
      const updatedDoc: Document = {
        ...currentDocument,
        content_json: content,
        updated_at: Date.now(),
      };
      try {
        await saveDocumentVersion(updatedDoc);
        await updateDocument(updatedDoc);
        currentDocument = updatedDoc;
        markContentSaved(content);
        savedCount++;
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
        } catch (error) {
          console.error("Failed to save document:", doc.title, error);
        }
      }
    }
  }

  if (savedCount > 0) {
    showNotification(`Project saved (${savedCount} document${savedCount !== 1 ? "s" : ""})`, "success");
  } else {
    showNotification("Nothing to save", "error");
  }
}

async function handleSaveDocument(doc: Document): Promise<void> {
  // Se il documento è quello corrente, salva il contenuto attuale dell'editor
  if (currentDocument?.id === doc.id) {
    await handleSaveToDatabase();
    return;
  }

  // Altrimenti, seleziona il documento prima di salvarlo
  await selectDocument(doc);
  // Piccolo delay per permettere a ProseMirror di caricare
  setTimeout(async () => {
    await handleSaveToDatabase();
  }, 150);
}

function showNotification(message: string, type: "success" | "error" = "success"): void {
  const toast = document.createElement("div");
  toast.className = `project-toast ${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    z-index: 1000;
    ${type === "success" ? "background: #228822; color: white;" : "background: #cc0000; color: white;"}
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
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
    console.log("Sections from DB:", sections);
    console.log("Number of sections:", sections.length);
    renderProjectsList();
  } catch (error) {
    console.error("Failed to load sections:", error);
  }
}

async function loadDocuments(sectionId: string): Promise<void> {
  try {
    documents = await getDocuments(sectionId);
    renderProjectsList();
  } catch (error) {
    console.error("Failed to load documents:", error);
  }
}

async function handleNewProject(): Promise<void> {
  const action = await handleCloseDocument();
  if (action === 'cancel') {
    return; // Utente ha annullato
  }

  // Show project type dialog with dropdown
  const result = await showProjectTypeDialog();
  if (!result) return;

  try {
    const projectResult = await createProjectWithDefaults(result.name, result.type);
    projects.push(projectResult.project);
    currentProject = projectResult.project;
    currentSection = null;
    currentDocument = null;
    sections = projectResult.sections || [];
    documents = [];
    lastSavedContent = null;
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

async function handleNewSection(projectId: string): Promise<void> {
  const name = prompt("Section name:");
  if (!name) return;

  try {
    const existingSections = await getSections(projectId);
    const orderIndex = existingSections.length;

    const section: Section = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      project_id: projectId,
      parent_id: null as any, // null for top-level sections
      name,
      order_index: orderIndex,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await createSection(section);
    sections.push(section);
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
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      section_id: sectionId,
      title,
      content_json: "",
      status: null as any,
      word_count: 0,
      tags: null as any,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await createDocument(document);
    documents.push(document);
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

  header.appendChild(nameEl);
  header.appendChild(actionsEl);
  div.appendChild(header);

  // Mostra sections indentate (piatte, non dentro box)
  if (sections.length > 0) {
    sections.forEach((section) => {
      const sectionEl = createSectionElement(section);
      div.appendChild(sectionEl);
    });
  }

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

  header.appendChild(nameEl);
  header.appendChild(actionsEl);
  
  // Click sul progetto chiede conferma se ci sono modifiche
  header.addEventListener("click", async () => {
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      selectProject(project);
    }
  });
  
  div.appendChild(header);

  return div;
}

function createSectionElement(section: Section): HTMLElement {
  const div = document.createElement("div");
  div.className = "section-item";
  if (currentSection?.id === section.id) {
    div.classList.add("active");
  }

  const header = document.createElement("div");
  header.className = "item-header";

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.textContent = section.name;

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

  header.appendChild(nameEl);
  header.appendChild(actionsEl);
  header.addEventListener("click", (e) => {
    e.stopPropagation();
    selectSection(section);
  });
  div.appendChild(header);

  // Mostra documents se la section è selezionata
  if (currentSection?.id === section.id && documents.length > 0) {
    documents.forEach((doc) => {
      const docEl = createDocumentElement(doc);
      div.appendChild(docEl);
    });
  }

  return div;
}

function createDocumentElement(doc: Document): HTMLElement {
  const div = document.createElement("div");
  div.className = "document-item";
  if (currentDocument?.id === doc.id) {
    div.classList.add("active");
  }

  const header = document.createElement("div");
  header.className = "item-header";

  const nameEl = document.createElement("div");
  nameEl.className = "item-name";
  nameEl.textContent = doc.title;

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

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete document";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handleDeleteDocument(doc);
  });
  actionsEl.appendChild(deleteBtn);

  header.appendChild(nameEl);
  header.appendChild(actionsEl);
  header.addEventListener("click", async (e) => {
    e.stopPropagation();
    // Se è già il documento corrente, non fare nulla
    if (currentDocument?.id === doc.id) return;
    
    // Controlla se ci sono modifiche non salvate
    const action = await handleCloseDocument();
    if (action === 'proceed') {
      await selectDocument(doc);
    }
  });
  div.appendChild(header);

  return div;
}

// ============================================================================
// SELECTION HANDLERS
// ============================================================================

function selectProject(project: Project): void {
  currentProject = project;
  currentSection = null;
  currentDocument = null;
  lastSavedContent = null; // Reset per nuovo progetto
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

function selectSection(section: Section): void {
  currentSection = section;

  loadDocuments(section.id);

  const titleEl = document.getElementById("document-title");
  if (titleEl && currentProject) {
    titleEl.textContent = `${currentProject.name} / ${section.name}`;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

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
};