// ============================================================================
// Project Render - tree rendering for projects/sections/documents
// ============================================================================
// Pure extraction (phase 3, step 4 of the refactoring plan). No logic change.
// Shared state comes live from ./project-state; entity-indexing actions from
// ./project-indexing. The remaining collaborators (selection, save/close
// guards, creation/deletion handlers) stay in project-panel.ts and are
// imported statically here: every one of them is a hoisted `function`
// declaration used only at runtime (inside event handlers), so the existing
// project-panel <-> project-render cycle follows the same pattern as the
// pre-existing project-panel <-> chat cycle.

import { updateProject, updateSection, updateDocument } from "../database/db";
import { sendProgrammaticMessage } from "../ai-panel/chat";
import { getTemplate } from "../templates/apply";
import { openColorPicker, applyItemColors, createColorBtn } from "./color-picker";
import {
  currentProject,
  currentSection,
  currentDocument,
  projects,
  documents,
  expandedSections,
  childSectionsOf,
} from "./project-state";
import {
  updateIndexIndicators,
  handleIndexDocument,
  handleIndexSection,
  handleIndexProject,
} from "./project-indexing";
import {
  selectDocument,
  selectProject,
  toggleAndSelectSection,
  handleCloseDocument,
  handleSaveDocument,
  handleNewSection,
  handleNewDocument,
  handleDeleteProject,
  handleDeleteSection,
  handleDeleteDocument,
  initSortable,
} from "./project-panel";
import type { Project, Section, Document } from "../types/database";

/**
 * Aggiorna le classi "active" (cornice blu) su documenti e sezioni in modo
 * mirato, senza un renderProjectsList() completo. Usato da selectDocument()
 * per far seguire la cornice al click senza lag.
 */
export function refreshActiveHighlight(docId: string, sectionId: string | null): void {
  document.querySelectorAll(".document-item.active").forEach((el) => el.classList.remove("active"));
  const docEl = document.querySelector(`.document-item[data-id="${docId}"]`);
  if (docEl) docEl.classList.add("active");

  document.querySelectorAll(".section-item.active").forEach((el) => el.classList.remove("active"));
  if (sectionId) {
    const secEl = document.querySelector(`.section-item[data-id="${sectionId}"]`);
    if (secEl) secEl.classList.add("active");
  }
}

// ============================================================================
// RENDERING
// ============================================================================

export function renderProjectsList(): void {
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
  const btnReadProject = document.getElementById("btn-read-project");
  if (btnReadProject) {
    btnReadProject.style.display = currentProject ? "inline-flex" : "none";
  }
  const btnSaveDb = document.getElementById("btn-save-db");
  if (btnSaveDb) {
    btnSaveDb.style.display = currentProject ? "inline-flex" : "none";
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

export function createActiveProjectElement(project: Project): HTMLElement {
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

export function createProjectElement(project: Project): HTMLElement {
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

export function createSectionElement(section: Section): HTMLElement {
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
  // Section handles carry "section-drag-handle" (see createSectionElement):
  // distinct classes keep the two Sortable engines from cross-matching.
  dragHandle.className = "drag-handle section-drag-handle";
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

  // Pulsante "+" a tendina: crea sottosezione o documento
  const addDropdown = document.createElement("div");
  addDropdown.className = "section-add-dropdown";

  const addToggle = document.createElement("button");
  addToggle.type = "button";
  addToggle.className = "item-action-btn";
  addToggle.textContent = "+";
  addToggle.title = "Aggiungi sezione o documento";
  addDropdown.appendChild(addToggle);

  const addMenu = document.createElement("div");
  addMenu.className = "section-add-menu";
  addMenu.setAttribute("role", "menu");

  const addSecItem = document.createElement("button");
  addSecItem.type = "button";
  addSecItem.className = "section-add-menu__item";
  addSecItem.textContent = "Sec";
  addSecItem.title = "Aggiungi sottosezione";
  addSecItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAddMenus();
    if (currentProject) handleNewSection(currentProject.id, section.id);
  });
  addMenu.appendChild(addSecItem);

  const addDocItem = document.createElement("button");
  addDocItem.type = "button";
  addDocItem.className = "section-add-menu__item";
  addDocItem.textContent = "Doc";
  addDocItem.title = "Aggiungi documento";
  addDocItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAddMenus();
    handleNewDocument(section.id);
  });
  addMenu.appendChild(addDocItem);

  addDropdown.appendChild(addMenu);

  addToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !addMenu.classList.contains("open");
    closeAddMenus();
    if (willOpen) addMenu.classList.add("open");
  });

  actionsEl.appendChild(addDropdown);

  // Pulsante "AI": invia i documenti di questa sezione alla chat AI
  const readSectionBtn = document.createElement("button");
  readSectionBtn.type = "button";
  readSectionBtn.className = "item-action-btn";
  readSectionBtn.textContent = "AI";
  readSectionBtn.title = "Invia sezione alla chat AI";
  readSectionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sendProgrammaticMessage(`Read all documents in the section "${section.name}". Use the read_section tool with section_id "${section.id}".`);
  });
  actionsEl.appendChild(readSectionBtn);

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

export function createDocumentElement(doc: Document): HTMLElement {
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
  dragHandle.className = "drag-handle doc-drag-handle";
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

  const aiReadDocBtn = document.createElement("button");
  aiReadDocBtn.className = "item-action-btn";
  aiReadDocBtn.textContent = "AI";
  aiReadDocBtn.title = "Send document to AI chat";
  aiReadDocBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sendProgrammaticMessage(`Read the document "${doc.title}". Use the get_document_content tool with document_id "${doc.id}".`);
  });
  actionsEl.appendChild(aiReadDocBtn);

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

export function startInlineRename(
  el: HTMLElement,
  currentName: string,
  onSave: (newName: string) => Promise<void>,
  onCancel?: () => void,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentName;
  input.className = "inline-rename-input";
  input.setAttribute("aria-label", "Rename");

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

// --- Menu a tendina "+" delle sezioni: chiusura globale ---
export function closeAddMenus(): void {
  document
    .querySelectorAll<HTMLElement>(".section-add-menu.open")
    .forEach((m) => m.classList.remove("open"));
}
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".section-add-dropdown")) closeAddMenus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAddMenus();
});

// SortableJS instance wiring (initSortable) stays in project-panel.ts and
// moves to project-dnd.ts in steps 5a/5b; it is imported above because
// renderProjectsList() invokes it after every DOM rebuild.
