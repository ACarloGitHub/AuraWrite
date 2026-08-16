// Export Ebook dialog (F4).
//
// Opens a modal that shows the project tree with:
//   - a checkbox per element (include/exclude; default: everything included);
//   - a role/label dropdown per element (Scrivener-inspired, default automatic);
//   - drag & drop to reorder (SortableJS) — the order only applies to the
//     export configuration, never to the project;
//   - book metadata (title, author, language, cover);
//   - a Help window (draggable/resizable) with the role explanations.
//
// The window is draggable and resizable. The configuration is persisted per
// project in a separate DB table (project_export_config) and does NOT modify
// the project itself.

import Sortable from "sortablejs";
import { getProject, getSections, getDocuments } from "../database/db";
import type { Project, Section, Document } from "../types/database";
import {
  getExportConfig,
  setExportConfig,
  defaultExportConfig,
  type EbookExportConfig,
  type EbookRole,
} from "../formats/epub-export";

interface TreeNode {
  section: Section;
  documents: Document[];
  children: TreeNode[];
}

const SECTION_ROLES: EbookRole[] = [
  "transparent",
  "part",
  "front-matter",
  "back-matter",
  "excluded",
];
const DOCUMENT_ROLES: EbookRole[] = [
  "chapter",
  "scene",
  "front-matter",
  "back-matter",
  "excluded",
];

const ROLE_LABELS: Record<EbookRole, string> = {
  "front-matter": "Front Matter",
  part: "Part",
  chapter: "Chapter",
  scene: "Scene",
  "back-matter": "Back Matter",
  excluded: "Excluded",
  transparent: "Transparent",
};

export async function openExportEbookDialog(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;

  const sections = await getSections(projectId);
  const roots = await buildTree(projectId, sections);

  let config = (await getExportConfig(projectId)) ?? defaultExportConfig();
  config = fillDefaults(config, project, roots);

  const overlay = document.createElement("div");
  overlay.className = "export-ebook-overlay";
  overlay.innerHTML = `
    <div class="export-ebook-dialog">
      <div class="export-ebook-header">
        <h3>Export Ebook</h3>
        <button class="export-ebook-close" title="Close">&times;</button>
      </div>
      <div class="export-ebook-body">
        <div class="export-ebook-meta">
          <label>Title <input id="ee-title" class="export-ebook-input" value="${escapeAttr(config.metadata.title)}" /></label>
          <label>Author <input id="ee-author" class="export-ebook-input" value="${escapeAttr(config.metadata.author)}" /></label>
          <label>Language <input id="ee-language" class="export-ebook-input" value="${escapeAttr(config.metadata.language)}" /></label>
          <label class="export-ebook-cover">
            <span>Cover</span>
            <button class="export-ebook-cover-btn" id="ee-cover-btn">${config.metadata.coverPath ? "Change..." : "Choose..."}</button>
            <span class="export-ebook-cover-name" id="ee-cover-name">${config.metadata.coverPath ? shortName(config.metadata.coverPath) : ""}</span>
          </label>
          <button class="export-ebook-help-btn" id="ee-help" title="Help">?</button>
        </div>
        <div class="export-ebook-hint">Select what to include, set each element's role, and drag to reorder. The project itself is not modified.</div>
        <div class="export-ebook-tree" id="ee-tree"></div>
      </div>
      <div class="export-ebook-footer">
        <button class="export-ebook-reset">Reset to defaults</button>
        <span class="export-ebook-status" id="ee-status"></span>
        <button class="export-ebook-cancel">Cancel</button>
        <button class="export-ebook-export">Export</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const dialogEl = overlay.querySelector(".export-ebook-dialog") as HTMLElement;
  const headerEl = overlay.querySelector(".export-ebook-header") as HTMLElement;
  const treeEl = overlay.querySelector("#ee-tree") as HTMLElement;
  renderTree(treeEl, roots, config);

  // Draggable window (drag the header).
  makeDraggable(dialogEl, headerEl);

  const saveConfig = (): void => {
    const titleEl = overlay.querySelector("#ee-title") as HTMLInputElement;
    const authorEl = overlay.querySelector("#ee-author") as HTMLInputElement;
    const langEl = overlay.querySelector("#ee-language") as HTMLInputElement;
    config.metadata.title = titleEl.value.trim();
    config.metadata.author = authorEl.value.trim();
    config.metadata.language = langEl.value.trim() || "en";
    config.order = readOrder(treeEl);
    config.saved = true;
    void setExportConfig(projectId, config).catch((e) =>
      console.error("[export-ebook] failed to save config:", e)
    );
  };

  overlay.querySelector(".export-ebook-close")?.addEventListener("click", () => overlay.remove());
  overlay.querySelector(".export-ebook-cancel")?.addEventListener("click", () => overlay.remove());

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);

  overlay.querySelector(".export-ebook-reset")?.addEventListener("click", () => {
    config = fillDefaults(defaultExportConfig(), project, roots);
    treeEl.innerHTML = "";
    renderTree(treeEl, roots, config);
    saveConfig();
    setStatus(overlay, "Reset to defaults");
  });

  overlay.querySelector("#ee-help")?.addEventListener("click", () => openEbookHelpWindow());

  overlay.querySelector("#ee-cover-btn")?.addEventListener("click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] },
      ],
    });
    if (picked && typeof picked === "string") {
      config.metadata.coverPath = picked;
      const nameEl = overlay.querySelector("#ee-cover-name") as HTMLElement | null;
      if (nameEl) nameEl.textContent = shortName(picked);
      const btnEl = overlay.querySelector("#ee-cover-btn") as HTMLButtonElement | null;
      if (btnEl) btnEl.textContent = "Change...";
      saveConfig();
    }
  });

  overlay.querySelector(".export-ebook-export")?.addEventListener("click", async () => {
    saveConfig();
    const { save } = await import("@tauri-apps/plugin-dialog");
    const base = (config.metadata.title || project.name || "book").replace(/[\\/:*?"<>|]/g, "-");
    const dest = await save({
      defaultPath: `${base}.epub`,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    if (!dest) return;
    setStatus(overlay, "Generating ebook...");
    try {
      const { exportProjectToEpub } = await import("../formats/epub-export");
      await exportProjectToEpub(projectId, config, dest);
      setStatus(overlay, "Ebook saved.");
    } catch (e) {
      console.error("[export-ebook] export failed:", e);
      setStatus(overlay, `Export failed: ${(e as Error).message}`);
    }
  });

  // Listen for checkbox/label changes (delegated) and persist.
  treeEl.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest("[data-id]") as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.id as string;
    if (target.matches("input[type=checkbox]")) {
      const checked = (target as HTMLInputElement).checked;
      const idx = config.included.indexOf(id);
      if (checked && idx === -1) config.included.push(id);
      if (!checked && idx !== -1) config.included.splice(idx, 1);
    } else if (target.matches("select")) {
      const role = (target as HTMLSelectElement).value as EbookRole;
      config.labels[id] = role;
    }
    saveConfig();
  });

  treeEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const toggle = target.closest("[data-expand]") as HTMLElement | null;
    if (!toggle) return;
    const row = toggle.closest("[data-id]") as HTMLElement | null;
    const children = row?.querySelector(":scope > .ee-children") as HTMLElement | null;
    if (children) children.classList.toggle("ee-hidden");
    toggle.textContent = children?.classList.contains("ee-hidden") ? "▶" : "▼";
  });
}

function shortName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function setStatus(overlay: HTMLElement, text: string): void {
  const el = overlay.querySelector("#ee-status") as HTMLElement | null;
  if (el) el.textContent = text;
}

/** Make a dialog window draggable via its header. */
function makeDraggable(dialog: HTMLElement, handle: HTMLElement): void {
  handle.style.cursor = "move";
  handle.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = dialog.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      dialog.style.position = "fixed";
      dialog.style.left = `${rect.left + ev.clientX - startX}px`;
      dialog.style.top = `${rect.top + ev.clientY - startY}px`;
      dialog.style.margin = "0";
      dialog.style.width = `${rect.width}px`;
      dialog.style.height = `${rect.height}px`;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

const HELP_TEXT = `Welcome to the Ebook Export

Here you can turn any AuraWrite project into an ebook. The structure of an ebook is very different from what you might expect: there are no folders that "contain" chapters — everything is organized inside a single compressed file (the EPUB). You may feel a bit lost at first, so here is how it all works.

Order matters. The order of the chapters is decided by their position in the list. The element at the top becomes Chapter 1, the next one Chapter 2, and so on. Drag the rows to reorder. The table of contents is generated automatically from this order and from the roles you assign.

There are two dropdowns. Sections and documents play different roles:
- Sections organize the book. You can make a section a Part (a level in the table of contents, like "Act I"), keep it Transparent (it does not create a level and its documents become chapters directly), turn it into Front Matter or Back Matter, or Exclude it.
- Documents are the content. By default a document is a Chapter. You can also mark it as Scene (a short piece, like an interlude), as Front Matter or Back Matter, or Exclude it.

The roles in detail:
- Front Matter — pages at the beginning of the book (title page, copyright, dedication, preface). Put them at the top.
- Part — a level in the table of contents that groups chapters (for example "Act I"). Assign it to a section that contains those chapters.
- Chapter — a chapter of the book. Assign it to documents.
- Scene — a short piece of content, for example an interlude between chapters.
- Back Matter — pages at the end of the book (appendix, notes, about the author).
- Transparent (sections only) — the section does not create a level in the table of contents; its documents become chapters directly. This is the default for sections.
- Excluded — the element does not enter the book. You can also simply uncheck it.

Practical examples:
- If your project has research sections (for example Plot, Characters, World in the Book template) that should not appear in the book: uncheck them or set them to Excluded.
- If you want the book organized in acts: create a section, set it to Part, and put the chapters under it.
- If you want a title page at the beginning: create a document, set it to Front Matter, and keep it at the top of the list.

Cover: pick the cover image here; it will be placed at the beginning of the ebook.`;

/** Open a secondary, draggable/resizable help window. */
function openEbookHelpWindow(): void {
  const overlay = document.createElement("div");
  overlay.className = "export-ebook-help-overlay";
  overlay.innerHTML = `
    <div class="export-ebook-help">
      <div class="export-ebook-help-header">
        <h4>Ebook Export Help</h4>
        <button class="export-ebook-help-close" title="Close">&times;</button>
      </div>
      <pre class="export-ebook-help-body">${escapeHtml(HELP_TEXT)}</pre>
    </div>
  `;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector(".export-ebook-help") as HTMLElement;
  const header = overlay.querySelector(".export-ebook-help-header") as HTMLElement;
  makeDraggable(dialog, header);

  overlay.querySelector(".export-ebook-help-close")?.addEventListener("click", () => overlay.remove());
}

/** Apply defaults for anything missing in a loaded configuration. */
function fillDefaults(
  config: EbookExportConfig,
  project: Project,
  roots: TreeNode[]
): EbookExportConfig {
  const ids = collectIds(roots);
  if (!config.saved) {
    config.included = [...ids];
    config.order = [...ids];
  }
  if (!config.metadata.title) config.metadata.title = project.name;
  if (!config.metadata.language) config.metadata.language = "en";
  return config;
}

function collectIds(roots: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode): void => {
    out.push(node.section.id);
    for (const d of node.documents) out.push(d.id);
    for (const c of node.children) walk(c);
  };
  for (const root of roots) walk(root);
  return out;
}

/** Read the current on-screen order of element ids (depth-first). */
function readOrder(treeEl: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (container: HTMLElement): void => {
    container.querySelectorAll(":scope > .ee-row").forEach((row) => {
      const el = row as HTMLElement;
      out.push(el.dataset.id as string);
      const children = el.querySelector(":scope > .ee-children") as HTMLElement | null;
      if (children) walk(children);
    });
  };
  walk(treeEl);
  return out;
}

function buildTree(projectId: string, sections: Section[]): Promise<TreeNode[]> {
  const byParent = new Map<string | null, Section[]>();
  for (const s of sections) {
    const key = s.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }
  const sortSections = (list: Section[]) => list.sort((a, b) => a.order_index - b.order_index);

  const build = async (parentKey: string | null): Promise<TreeNode[]> => {
    const list = sortSections(byParent.get(parentKey) ?? []);
    const nodes: TreeNode[] = [];
    for (const section of list) {
      const docs = (await getDocuments(section.id)).sort((a, b) => a.order_index - b.order_index);
      const children = await build(section.id);
      nodes.push({ section, documents: docs, children });
    }
    return nodes;
  };

  return build(null);
}

function renderTree(container: HTMLElement, roots: TreeNode[], config: EbookExportConfig): void {
  for (const node of roots) renderNode(container, node, config, 0);

  container.querySelectorAll<HTMLElement>("[data-sortable]").forEach((listEl) => {
    Sortable.create(listEl, {
      group: "export-ebook",
      animation: 150,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      handle: ".ee-drag",
    });
  });
}

function roleFor(node: TreeNode, doc: Document | null, config: EbookExportConfig): EbookRole {
  const id = doc ? doc.id : node.section.id;
  if (config.labels[id]) return config.labels[id];
  return doc ? "chapter" : "transparent";
}

function renderNode(container: HTMLElement, node: TreeNode, config: EbookExportConfig, depth: number): void {
  const row = document.createElement("div");
  row.className = "ee-row";
  row.dataset.id = node.section.id;
  row.style.setProperty("--ee-depth", String(depth));

  const sectionIncluded = config.included.includes(node.section.id);
  const sectionRole = roleFor(node, null, config);

  const expandBtn = node.children.length > 0 || node.documents.length > 0
    ? `<button class="ee-expand" data-expand>▼</button>`
    : `<span class="ee-expand"></span>`;

  row.innerHTML = `
    ${expandBtn}
    <input type="checkbox" class="ee-check" ${sectionIncluded ? "checked" : ""} />
    <span class="ee-name">📁 ${escapeHtml(node.section.name)}</span>
    <select class="ee-role">
      ${SECTION_ROLES.map((r) => `<option value="${r}" ${r === sectionRole ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}
    </select>
    <span class="ee-drag">⠿</span>
  `;
  container.appendChild(row);

  const childrenEl = document.createElement("div");
  childrenEl.className = "ee-children";
  childrenEl.dataset.sortable = "1";
  row.appendChild(childrenEl);

  for (const doc of node.documents) {
    const included = config.included.includes(doc.id);
    const role = roleFor(node, doc, config);
    const docRow = document.createElement("div");
    docRow.className = "ee-row ee-row--doc";
    docRow.dataset.id = doc.id;
    docRow.style.setProperty("--ee-depth", String(depth + 1));
    docRow.innerHTML = `
      <span class="ee-expand"></span>
      <input type="checkbox" class="ee-check" ${included ? "checked" : ""} />
      <span class="ee-name">📄 ${escapeHtml(doc.title)}</span>
      <select class="ee-role">
        ${DOCUMENT_ROLES.map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}
      </select>
      <span class="ee-drag">⠿</span>
    `;
    childrenEl.appendChild(docRow);
  }

  for (const child of node.children) {
    renderNode(childrenEl, child, config, depth + 1);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c] as string
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
