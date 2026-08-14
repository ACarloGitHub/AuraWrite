// Ebooks panel (F2) — the "Ebooks" tab.
//
// An ebook is not a Project: it lives in a dedicated working folder managed by
// the backend (see `src-tauri/src/ebook.rs`). This panel replicates the UX of
// the Projects panel (list, selection, back, delete with confirm, rename,
// colors) without touching the Projects code.

import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  openHTML,
  openJSON,
  openMarkdown,
  openTXT,
  openDOCX,
  closeCurrentFileIfInside,
} from "../editor/toolbar";
import { createColorBtn, openColorPicker } from "../editor/color-picker";
import {
  ebookListAll,
  ebookWorkDelete,
  ebookWorkDir,
  ebookWorkList,
  readEbookMeta,
  writeEbookMeta,
  importEpub,
  exportEpub,
  rewriteRelativeImageSrcs,
  sanitizeFolderName,
} from "./epub-io";
import { fileExtension, isOpenableFile } from "./tree";
import type { EbookEntry, EbookMeta } from "./types";

interface EbookItem {
  folder: string;
  meta: EbookMeta;
}

let ebooks: EbookItem[] = [];
let selectedFolder: string | null = null;
let selectedTree: EbookEntry[] = [];

export function initEbookPanel(): void {
  const btnEbooks = document.getElementById("btn-ebooks");
  btnEbooks?.addEventListener("click", toggleEbookPanel);

  document.getElementById("btn-ebook-import")?.addEventListener("click", () => void handleImport());
  document.getElementById("btn-ebook-export")?.addEventListener("click", () => void handleExport());
  document.getElementById("btn-ebook-back")?.addEventListener("click", () => {
    selectedFolder = null;
    selectedTree = [];
    render();
  });

  void loadEbooks();
}

/** Show the Ebooks panel and start the EPUB import flow (used by the File menu). */
export async function openEbookPanelAndImport(): Promise<void> {
  const panel = document.getElementById("ebook-panel");
  if (panel?.classList.contains("hidden")) toggleEbookPanel();
  await handleImport();
}

function toggleEbookPanel(): void {
  const panel = document.getElementById("ebook-panel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  document.getElementById("btn-ebooks")?.classList.toggle("active", !panel.classList.contains("hidden"));
}

async function loadEbooks(): Promise<void> {
  const folders = await ebookListAll();
  const items: EbookItem[] = [];
  for (const folder of folders) {
    const meta = await readEbookMeta(folder);
    items.push({ folder, meta: meta ?? { name: folder } });
  }
  ebooks = items;
  // Double-sense deletion: if the working folder disappeared, drop the item.
  if (selectedFolder && !folders.includes(selectedFolder)) {
    selectedFolder = null;
    selectedTree = [];
  }
  render();
}

function render(): void {
  const container = document.getElementById("ebook-content");
  if (!container) return;
  const btnBack = document.getElementById("btn-ebook-back") as HTMLButtonElement | null;
  const btnExport = document.getElementById("btn-ebook-export") as HTMLButtonElement | null;
  if (btnBack) btnBack.style.display = selectedFolder ? "inline-flex" : "none";
  if (btnExport) btnExport.style.display = selectedFolder ? "inline-flex" : "none";

  container.innerHTML = "";
  if (!selectedFolder) {
    renderList(container);
  } else {
    renderTree(container);
  }
}

function renderList(container: HTMLElement): void {
  container.innerHTML = "";
  if (ebooks.length === 0) {
    container.innerHTML = `
      <div class="ebook-panel__empty">
        <p>No ebooks</p>
        <p class="hint">Click "+" to import an EPUB</p>
      </div>`;
    return;
  }
  for (const item of ebooks) {
    const el = document.createElement("div");
    el.className = "ebook-item";
    el.style.background = item.meta.color ?? "#252525";
    el.style.color = item.meta.textColor ?? "#ffffff";
    el.addEventListener("click", () => void selectEbook(item.folder));

    const nameEl = document.createElement("span");
    nameEl.className = "ebook-item__name";
    nameEl.textContent = item.meta.name;
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startInlineRename(nameEl, item.meta.name, async (newName) => {
        await writeEbookMeta(item.folder, { ...item.meta, name: newName });
        item.meta.name = newName;
        renderList(container);
      });
    });
    el.appendChild(nameEl);

    const colorBtn = createColorBtn();
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openColorPicker({
        itemType: "ebook",
        itemId: item.folder,
        currentName: item.meta.name,
        currentBg: item.meta.color,
        currentText: item.meta.textColor,
        onSave: async (newName, bg, text) => {
          await writeEbookMeta(item.folder, { name: newName, color: bg, textColor: text });
          item.meta.name = newName;
          item.meta.color = bg;
          item.meta.textColor = text;
          renderList(container);
        },
        onReset: async () => {
          await writeEbookMeta(item.folder, {
            name: item.meta.name,
            color: undefined,
            textColor: undefined,
          });
          item.meta.color = undefined;
          item.meta.textColor = undefined;
          renderList(container);
        },
      });
    });
    el.appendChild(colorBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.textContent = "×";
    delBtn.title = "Delete ebook";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleDelete(item);
    });
    el.appendChild(delBtn);

    container.appendChild(el);
  }
}

async function selectEbook(folder: string): Promise<void> {
  selectedFolder = folder;
  selectedTree = await ebookWorkList(folder);
  render();
}

function renderTree(container: HTMLElement): void {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "ebook-panel__list-header";
  header.innerHTML = `<span class="ebook-panel__list-title">${escapeHtml(selectedFolder ?? "")}</span>`;
  container.appendChild(header);

  const ul = document.createElement("div");
  ul.className = "ebook-tree";
  for (const entry of selectedTree) renderEntry(entry, ul, 0);
  container.appendChild(ul);
}

function renderEntry(entry: EbookEntry, parent: HTMLElement, depth: number): void {
  const row = document.createElement("div");
  row.className = entry.is_dir
    ? "ebook-tree__row ebook-tree__row--dir"
    : "ebook-tree__row ebook-tree__row--file";
  row.style.paddingLeft = `${12 + depth * 16}px`;
  row.textContent = `${entry.is_dir ? "📁" : "📄"} ${entry.name}`;

  if (!entry.is_dir && isOpenableFile(entry)) {
    row.classList.add("ebook-tree__row--openable");
    row.addEventListener("click", () => void openEntry(entry));
  }

  parent.appendChild(row);
  if (entry.is_dir) {
    for (const child of entry.children) renderEntry(child, parent, depth + 1);
  }
}

async function openEntry(entry: EbookEntry): Promise<void> {
  if (!selectedFolder) return;
  const workDir = await ebookWorkDir(selectedFolder);
  const absPath = `${workDir}/${entry.relative_path}`;
  const ext = fileExtension(entry.relative_path);
  if (ext === "html" || ext === "htm" || ext === "xhtml") {
    await openHTML(absPath, (html) => rewriteRelativeImageSrcs(html, workDir));
  } else if (ext === "md" || ext === "markdown") {
    await openMarkdown(absPath);
  } else if (ext === "json") {
    await openJSON(absPath);
  } else if (ext === "docx") {
    await openDOCX(absPath);
  } else {
    await openTXT(absPath);
  }
}

async function handleImport(): Promise<void> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  if (!picked || typeof picked !== "string") return;
  try {
    const data = await readFile(picked);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const base = (picked.split(/[\\/]/).pop() ?? "ebook").replace(/\.epub$/i, "");
    const baseFolder = sanitizeFolderName(base) || "ebook";

    const existing = new Set(await ebookListAll());
    let folder = baseFolder;
    let n = 2;
    while (existing.has(folder)) {
      folder = `${baseFolder}_${n}`;
      n++;
    }

    const result = await importEpub(buffer, folder);
    await loadEbooks();
    await selectEbook(result.folder);
  } catch (e) {
    console.error("[ebooks] import failed:", e);
    alert("Failed to import EPUB.");
  }
}

async function handleExport(): Promise<void> {
  if (!selectedFolder) return;
  const dest = await save({
    defaultPath: `${selectedFolder}.epub`,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  if (!dest) return;
  try {
    await exportEpub(selectedFolder, dest);
    alert("EPUB exported.");
  } catch (e) {
    console.error("[ebooks] export failed:", e);
    alert("Failed to export EPUB.");
  }
}

async function handleDelete(item: EbookItem): Promise<void> {
  const ok = await showConfirmDialog(
    `Delete ebook "${item.meta.name}"?`,
    "This will delete its working folder."
  );
  if (!ok) return;
  try {
    const workDir = await ebookWorkDir(item.folder);
    await closeCurrentFileIfInside(workDir);
    await ebookWorkDelete(item.folder);
    if (selectedFolder === item.folder) {
      selectedFolder = null;
      selectedTree = [];
    }
    await loadEbooks();
  } catch (e) {
    console.error("[ebooks] delete failed:", e);
  }
}

/**
 * Custom confirm dialog (same pattern as the Projects panel). Uses an overlay
 * so the confirmation is always shown before any destructive action and
 * cancelling really prevents it. `window.confirm` is unreliable in Tauri.
 */
function showConfirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "save-dialog-overlay";
    overlay.innerHTML = `
      <div class="save-dialog">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="save-dialog-buttons">
          <button class="save-dialog-btn" data-action="cancel">Cancel</button>
          <button class="save-dialog-btn danger" data-action="confirm">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll(".save-dialog-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        overlay.remove();
        resolve(action === "confirm");
      });
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(false);
        document.removeEventListener("keydown", handleEscape);
      }
    };
    document.addEventListener("keydown", handleEscape);
  });
}

function startInlineRename(
  el: HTMLElement,
  current: string,
  onSave: (name: string) => Promise<void>
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.className = "inline-rename-input";
  input.setAttribute("aria-label", "Rename");
  el.textContent = "";
  el.appendChild(input);
  input.focus();
  input.select();

  const finish = () => {
    const value = input.value.trim();
    if (value && value !== current) void onSave(value);
    else el.textContent = current;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    }
    if (e.key === "Escape") el.textContent = current;
  });
  input.addEventListener("blur", finish);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c] as string
  );
}
