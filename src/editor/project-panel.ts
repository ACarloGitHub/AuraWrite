// ============================================================================
// Project Panel - Sidebar for projects/sections/documents
// ============================================================================

import {
  getProjects,
  getSections,
  getDocuments,
  createProjectWithDefaults,
  createSection,
  createDocument,
  updateProject,
  deleteProject,
  updateSection,
  deleteSection,
  updateDocument,
  deleteDocument,
} from "../database/db";
import type { Project, Section, Document } from "../types/database";

// State
let currentProject: Project | null = null;
let currentSection: Section | null = null;
let currentDocument: Document | null = null;
let projects: Project[] = [];
let sections: Section[] = [];
let documents: Document[] = [];
let hasUnsavedChanges = false;
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

  const btnOpenProject = document.getElementById("btn-open-project");
  btnOpenProject?.addEventListener("click", () => {
    showingProjectList = true;
    currentProject = null;
    currentSection = null;
    currentDocument = null;
    renderProjectsList();
  });

  const btnSaveDb = document.getElementById("btn-save-db");
  btnSaveDb?.addEventListener("click", handleSaveToDatabase);

  const btnProjects = document.getElementById("btn-projects");
  btnProjects?.addEventListener("click", toggleProjectPanel);

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

function markUnsavedChanges(): void {
  hasUnsavedChanges = true;
  updateSaveStatus();
  scheduleAutoSave();
}

function markSaved(): void {
  hasUnsavedChanges = false;
  updateSaveStatus();
}

function updateSaveStatus(): void {
  const statusEl = document.getElementById("save-status");
  if (statusEl) {
    statusEl.textContent = hasUnsavedChanges ? "Unsaved..." : "Saved ✓";
    statusEl.className = hasUnsavedChanges ? "save-status unsaved" : "save-status saved";
  }
}

function scheduleAutoSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (hasUnsavedChanges && currentDocument) {
      console.log("Auto-saving document...");
    }
  }, SAVE_DEBOUNCE_MS);
}

async function saveCurrentDocument(content: string): Promise<void> {
  if (!currentDocument) return;

  try {
    const updatedDoc: Document = {
      ...currentDocument,
      content_json: content,
      updated_at: Date.now(),
    };
    await updateDocument(updatedDoc);
    currentDocument = updatedDoc;
    markSaved();
    console.log("Document saved to database");
  } catch (error) {
    console.error("Failed to save document:", error);
    showError("Could not save document");
  }
}

async function handleSaveToDatabase(): Promise<void> {
  if (!currentDocument) {
    console.warn("No document selected");
    showError("No document selected");
    return;
  }

  // Ottieni contenuto dall'editor
  const content = getEditorContent ? getEditorContent() : null;
  if (!content) {
    console.warn("No content from editor");
    showError("No content to save");
    return;
  }

  await saveCurrentDocument(content);
  showNotification("Document saved!", "success");
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
  // Chiedi conferma se ci sono modifiche non salvate
  if (hasUnsavedChanges) {
    const save = confirm("Hai modifiche non salvate. Vuoi salvare prima di creare un nuovo progetto?");
    if (save) {
      const content = getEditorContent ? getEditorContent() : null;
      if (content && currentDocument) {
        await saveCurrentDocument(content);
      }
    }
  }
  
  // Pulisci l'editor
  clearEditor();
  
  const name = prompt("Project name:");
  if (!name) return;

  const type = prompt("Project type (novel/script/article):", "novel") || "novel";

  try {
    const result = await createProjectWithDefaults(name, type);
    projects.push(result.project);
    currentProject = result.project;
    currentSection = null;
    currentDocument = null;
    sections = result.sections || [];
    documents = [];
    hasUnsavedChanges = false;
    renderProjectsList();

    if (onProjectChange) {
      onProjectChange(result.project);
    }

    showNotification(`Project "${result.project.name}" created!`, "success");
  } catch (error) {
    console.error("Failed to create project:", error);
    showNotification("Could not create project", "error");
  }
}

async function handleDeleteProject(project: Project): Promise<void> {
  const confirmMsg = `Delete project "${project.name}" and all its sections?`;
  if (!confirm(confirmMsg)) return;

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

async function handleDeleteSection(section: Section): Promise<void> {
  const confirmMsg = `Delete section "${section.name}" and all its documents?`;
  if (!confirm(confirmMsg)) return;

  try {
    await deleteSection(section.id);
    sections = sections.filter(s => s.id !== section.id);
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
  const confirmMsg = `Delete document "${doc.title}"?`;
  if (!confirm(confirmMsg)) return;

  try {
    await deleteDocument(doc.id);
    documents = documents.filter(d => d.id !== doc.id);
    if (currentDocument?.id === doc.id) {
      currentDocument = null;
    }
    renderProjectsList();
    console.log("Deleted document:", doc.title);
  } catch (error) {
    console.error("Failed to delete document:", error);
    showError("Could not delete document");
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
    selectDocument(document);
    renderProjectsList();

    console.log("Created document:", document.title);
  } catch (error) {
    console.error("Failed to create document:", error);
    showError("Could not create document");
  }
}

function selectDocument(doc: Document): void {
  currentDocument = doc;
  if (onDocumentSelect) {
    onDocumentSelect(doc);
  }
  const titleEl = document.getElementById("document-title");
  if (titleEl && currentProject && currentSection) {
    titleEl.textContent = `${currentProject.name} / ${currentSection.name} / ${doc.title}`;
  }
}

// ============================================================================
// RENDERING
// ============================================================================

function renderProjectsList(): void {
  const container = document.getElementById("projects-list");
  if (!container) return;

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
  if (currentProject?.id === project.id) {
    div.classList.add("active");
  }

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
  header.addEventListener("click", () => selectProject(project));
  div.appendChild(header);

  // Non mostrare sections qui - solo nella vista progetto attivo
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

  // Container per azioni inline (solo delete per document)
  const actionsEl = document.createElement("div");
  actionsEl.className = "item-actions";

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
  header.addEventListener("click", (e) => {
    e.stopPropagation();
    selectDocument(doc);
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

export {
  currentProject,
  currentSection,
  currentDocument,
  projects,
  sections,
  documents,
};