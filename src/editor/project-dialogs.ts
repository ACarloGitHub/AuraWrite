// ============================================================================
// Project Dialogs - modal dialogs extracted from project-panel.ts
// ============================================================================
// Pure extraction (phase 3, step 2 of the refactoring plan). No logic change.
// Shared state is imported live from ./project-state. The notification helper
// stays in project-panel.ts and is loaded dynamically to avoid a static
// import cycle (same pattern already used by toolbar.ts).

import { updateProject } from "../database/db";
import { listTemplates, getTemplate } from "../templates/apply";
import { currentProject, projects, setCurrentProject } from "./project-state";
import type { Project } from "../types/database";

export function showSaveDialog(): Promise<'save' | 'dont-save' | 'cancel'> {
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
export function showDiscardConfirmDialog(): Promise<boolean> {
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

export interface TemplateDialogResult {
  name: string;
  templateType: string;
  chefVariant?: "a" | "b";
  selectedStyle?: string;
  createSections?: boolean;
  createDocuments?: boolean;
}

export function showTemplateDialog(): Promise<TemplateDialogResult | null> {
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
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="tpl-create-sections" checked>
            <span>Create sections</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="tpl-create-documents" checked>
            <span>Create documents</span>
          </label>
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
    const createSectionsCheckbox = overlay.querySelector('#tpl-create-sections') as HTMLInputElement;
    const createDocumentsCheckbox = overlay.querySelector('#tpl-create-documents') as HTMLInputElement;

    createSectionsCheckbox.addEventListener('change', () => {
      if (!createSectionsCheckbox.checked) {
        createDocumentsCheckbox.checked = false;
        createDocumentsCheckbox.disabled = true;
      } else {
        createDocumentsCheckbox.disabled = false;
      }
    });

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
            createSections: createSectionsCheckbox.checked,
            createDocuments: createDocumentsCheckbox.checked,
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

export interface ProjectTypeResult {
  name: string;
  type: string;
}

// dead code: kept intentionally (superseded by showTemplateDialog; preserved
// during phase 3 extraction because a pure move must not change behavior).
export function _showProjectTypeDialog(): Promise<ProjectTypeResult | null> {
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
export function showProjectAISettingsDialog(project: Project): Promise<void> {
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
              setCurrentProject(updated);
            }
            // Dynamic import avoids a static cycle:
            // project-panel -> project-dialogs -> project-panel
            const { showNotification } = await import("./project-panel");
            showNotification("AI settings saved", "success");
            overlay.remove();
            resolve();
          } catch (e) {
            console.error("Failed to save AI settings:", e);
            const { showNotification } = await import("./project-panel");
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
              setCurrentProject(updated);
            }
            const { showNotification } = await import("./project-panel");
            showNotification("AI settings reset to template defaults", "success");
            overlay.remove();
            resolve();
          } catch (e) {
            console.error("Failed to reset AI settings:", e);
            const { showNotification } = await import("./project-panel");
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function showConfirmDialog(title: string, message: string): Promise<boolean> {
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
