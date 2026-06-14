import { undo, redo } from "prosemirror-history";
import { toggleMark, wrapIn, lift, setBlockType } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { NodeType } from "prosemirror-model";

import { toMarkdown, toMarkdownWithRewrites, fromMarkdown } from "../formats/markdown";
import { toPlainText, fromPlainText } from "../formats/txt";
import { toHTML } from "../formats/html";
import { toDocx, fromDocx, Packer } from "../formats/docx";
import { schema } from "./editor";
import { openLinkPopover } from "./link-plugin";
import { toggleTableDropdown, setupTableToolbar, hideDropdown as hideTableDropdown } from "./table-toolbar";
import { populateUserFontsInToolbar } from "./fonts-ui";
import { insertImageFromFile } from "./image-commands";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { showErrorToast, showInfoToast } from "../error-boundary";
import {
  initPagination,
  updateOnTextChange,
} from "./fake-pagination";
import { getPagedMode } from "./pagination-state";
import { getCassieMode, setCassieMode } from "./pagination-state";
import { togglePagedMode as toggleDocPagedMode } from "./editor";
import {
  currentProject,
  currentDocument,
  handleSaveToDatabase as saveProjectToDb,
  handleIndexDocument as indexSingleDocument,
  handleIndexProject as indexEntireProject,
} from "./project-panel";

let editorView: EditorView;

interface DocumentState {
  path: string | null;
  format: string | null;
  isDirty: boolean;
  lastSavedContent: string | null;
}

let documentState: DocumentState = {
  path: null,
  format: null,
  isDirty: false,
  lastSavedContent: null,
};

let incrementalTimer: ReturnType<typeof globalThis.setInterval> | null = null;

async function openImagePicker(view: EditorView): Promise<void> {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        },
      ],
    });
    if (!selected || typeof selected !== "string") return;
    const fileName = selected.split(/[\\/]/).pop() || "image";
    const base64 = await invoke<string>("load_binary_file", { path: selected });
    const mime = mimeFromFilename(fileName);
    const fakeFile = makeFileLike(fileName, mime, base64);
    const { uploadImageFile } = await import("./image-uploader");
    const uploaded = await uploadImageFile(fakeFile);
    const { createImageNode } = await import("./image-commands");
    const node = createImageNode(view, uploaded);
    if (!node) {
      console.error("[image] no image node in schema");
      return;
    }
    const $from = view.state.selection.$from;
    let insertPos = $from.pos;
    for (let d = $from.depth; d >= 0; d--) {
      const parent = $from.node(d);
      const match = parent
        .contentMatchAt($from.index(d))
        .matchType(view.state.schema.nodes.image);
      if (match) {
        insertPos = $from.end(d);
        break;
      }
    }
    const tr = view.state.tr.insert(insertPos, node);
    view.dispatch(tr);
    view.focus();
  } catch (e) {
    console.error("[image] openImagePicker failed:", e);
  }
}

function makeFileLike(name: string, type: string, base64: string): File {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type });
  return new File([blob], name, { type });
}

function mimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function setupToolbar(view: EditorView): void {
  editorView = view;

  setupUndoRedoButtons();
  setupFormattingButtons();
  setupHeadingControl();
  setupListControls();
  setupDecorControls();
  setupAlignmentControls();
  void setupStyleControls();
  setupTopLevelButtons();
  setupWidthControl();
  setupDirtyTracking();
  loadPreferences();
  updateDocumentTitleBar();
  initPagination(document.getElementById("editor")!, view);
  setupOverflowMenu();
}

function setupDirtyTracking(): void {
  editorView.setProps({
    dispatchTransaction(transaction: Transaction) {
      const newState = editorView.state.apply(transaction);
      editorView.updateState(newState);

      if (transaction.docChanged) {
        const isLoading = (window as Window & { __aurawrite_loading?: boolean }).__aurawrite_loading === true;
        const newContent = JSON.stringify(newState.doc.toJSON());
        if (documentState.lastSavedContent !== newContent) {
          documentState.isDirty = true;
          updateWindowTitle();
          updateDocumentTitleBar();

          if (!isLoading) {
            window.dispatchEvent(new CustomEvent("aurawrite:content-changed", {
              detail: { content: newContent }
            }));
          }
        }
        updateOnTextChange(editorView);
      }
    },
  });
}

function updateWindowTitle(): void {
  const title = documentState.path
    ? documentState.path.split(/[/\\]/).pop() || "Untitled"
    : "Untitled";
  document.title = documentState.isDirty
    ? `${title} * - AuraWrite`
    : `${title} - AuraWrite`;
}

function updateDocumentTitleBar(): void {
  const titleEl = document.getElementById("document-title");
  const formatEl = document.getElementById("document-format");

  if (!titleEl || !formatEl) return;

  const title = documentState.path
    ? documentState.path.split(/[/\\]/).pop() || "Untitled"
    : "Untitled";

  titleEl.textContent = title;
  titleEl.classList.toggle("dirty", documentState.isDirty);

  const formatNames: Record<string, string> = {
    json: "JSON",
    md: "Markdown",
    txt: "Plain Text",
    html: "HTML",
    docx: "Word Document",
  };
  formatEl.textContent = documentState.format
    ? formatNames[documentState.format] || documentState.format
    : "";
}

function markSaved(content: string, path: string, format: string): void {
  documentState.lastSavedContent = content;
  documentState.path = path;
  documentState.format = format;
  documentState.isDirty = false;
  updateWindowTitle();
  updateDocumentTitleBar();
}

function loadPreferences(): void {
  const prefs = localStorage.getItem("aurawrite-preferences");
  if (prefs) {
    try {
      const p = JSON.parse(prefs);
      if (p.incrementalEnabled) {
        startIncrementalSave(p.incrementalMax || 10);
      }
    } catch {
      // Ignore preference parse errors
    }
  }
}

function startIncrementalSave(_maxSaves: number): void {
  if (incrementalTimer) clearInterval(incrementalTimer);
  incrementalTimer = setInterval(() => {
    if (documentState.isDirty && documentState.path) {
      saveIncremental();
    }
  }, 30000);
}

async function saveIncremental(): Promise<void> {
  console.log("Incremental save triggered (placeholder for DB integration)");
}

function setupTopLevelButtons(): void {
  const fileMenuBtn = document.getElementById("btn-file-menu");
  const fileMenu = document.getElementById("file-menu");

  fileMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (fileMenu?.classList.contains("hidden")) {
      positionDropdown(fileMenuBtn as HTMLElement, fileMenu);
      fileMenu?.classList.remove("hidden");
    } else {
      fileMenu?.classList.add("hidden");
    }
  });

  fileMenu?.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = (item as HTMLElement).dataset.action;
      fileMenu?.classList.add("hidden");
      switch (action) {
        case "new":
          handleNew();
          break;
        case "save":
          handleSave();
          break;
        case "save-as":
          handleSaveAs();
          break;
        case "open":
          handleOpen();
          break;
        case "export":
          handleExport();
          break;
        case "export-project":
          handleExportProject();
          break;
        case "save-project":
          handleSaveProject();
          break;
        case "index":
          handleIndexDocument();
          break;
        case "index-create":
          handleIndexAndCreateEntities();
          break;
      }
    });
  });

  document.addEventListener("click", () => {
    fileMenu?.classList.add("hidden");
  });

  const btnPrint = document.getElementById("btn-print");
  btnPrint?.addEventListener("click", () => window.print());
}

async function handleNew(): Promise<void> {
  if (documentState.isDirty) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      "Ci sono modifiche non salvate. Vuoi davvero creare un nuovo documento? Le modifiche verranno perse.",
      { title: "AuraWrite", kind: "warning", okLabel: "Crea nuovo", cancelLabel: "Annulla" }
    );
    if (!ok) return;
  }

  (window as Window & { __aurawrite_loading?: boolean }).__aurawrite_loading = true;

  const newState = EditorState.create({
    schema: editorView.state.schema,
    plugins: editorView.state.plugins,
  });
  editorView.updateState(newState);

  const { syncDocumentPaginationState } = await import("./editor");
  syncDocumentPaginationState(editorView);

  documentState.path = null;
  documentState.format = null;
  documentState.isDirty = false;
  documentState.lastSavedContent = JSON.stringify(newState.doc.toJSON());
  updateWindowTitle();
  updateDocumentTitleBar();

  (window as Window & { __aurawrite_loading?: boolean }).__aurawrite_loading = false;

  const { showToast } = await import("../error-boundary");
  showToast("New document created", "success", 2500);
}

async function handleSave(): Promise<void> {
  if (documentState.path && !documentState.isDirty) {
    return;
  }

  if (documentState.path && documentState.format) {
    await saveToPath(documentState.path, documentState.format);
  } else {
    await handleSaveAs();
  }
}

async function handleSaveAs(): Promise<void> {
  const filters = [
    { name: "ProseMirror JSON", extensions: ["json"] },
    { name: "Markdown", extensions: ["md"] },
    { name: "Plain Text", extensions: ["txt"] },
    { name: "Word Document", extensions: ["docx"] },
  ];

  const path = await getFilePath({
    save: true,
    filters,
    defaultPath: "untitled.json",
  });

  if (!path) return;

  const format = path.split(".").pop() || "json";
  await saveToPath(path, format);
}

async function saveToPath(path: string, format: string): Promise<void> {
  const content = await getContentByFormat(format);
  await saveFile(path, format, content);
  markSaved(content, path, format);
}

async function getContentByFormat(format: string): Promise<string> {
  switch (format) {
    case "json":
      return JSON.stringify(editorView.state.doc.toJSON(), null, 2);
    case "md":
    case "markdown":
      return toMarkdown(editorView.state.doc);
    case "txt":
      return toPlainText(editorView.state.doc);
    case "html":
      return toHTML(editorView.state.doc);
    case "docx":
      return await docxToBase64(editorView.state.doc);
    default:
      return JSON.stringify(editorView.state.doc.toJSON(), null, 2);
  }
}

async function docxToBase64(doc: unknown): Promise<string> {
  const docxDoc = await toDocx(doc);
  return await Packer.toBase64String(docxDoc);
}

async function saveFile(
  path: string,
  format: string,
  content: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");

  if (format === "docx") {
    await invoke("save_binary_file", { path, base64Content: content });
  } else {
    await invoke("save_document", { path, content });
  }
}

async function handleOpen(): Promise<void> {
  const filters = [
    { name: "Tutti i files supportati", extensions: ["json", "md", "txt", "html", "htm", "docx"] },
    { name: "AuraWrite JSON", extensions: ["json"] },
    { name: "Markdown", extensions: ["md"] },
    { name: "Word Document", extensions: ["docx"] },
    { name: "HTML", extensions: ["html", "htm"] },
    { name: "Plain Text", extensions: ["txt"] },
    { name: "Tutti i files", extensions: ["*"] },
  ];

  const path = await getFilePath({
    filters,
  });

  if (!path) return;

  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json":
      await openJSON(path);
      break;
    case "md":
      await openMarkdown(path);
      break;
    case "docx":
      await openDOCX(path);
      break;
    case "txt":
      await openTXT(path);
      break;
    default:
      alert(`Unsupported file format: .${ext || "unknown"}`);
  }
}

async function openJSON(path: string): Promise<void> {
  const content = await loadFile(path);
  const json = JSON.parse(content);
  const migrated = migrateImageNodesInJson(json);

  const { Node } = await import("prosemirror-model");

  const newDoc = Node.fromJSON(schema, migrated);
  const newState = EditorState.create({
    schema: editorView.state.schema,
    doc: newDoc,
    plugins: editorView.state.plugins,
  });
  editorView.updateState(newState);

  const { syncDocumentPaginationState } = await import("./editor");
  syncDocumentPaginationState(editorView);

  markSaved(content, path, "json");
}

async function openMarkdown(path: string): Promise<void> {
  const content = await loadFile(path);
  const json = fromMarkdown(content);

  const { Node } = await import("prosemirror-model");

  const newDoc = Node.fromJSON(schema, json);
  const newState = EditorState.create({
    schema: editorView.state.schema,
    doc: newDoc,
    plugins: editorView.state.plugins,
  });
  editorView.updateState(newState);

  const { syncDocumentPaginationState } = await import("./editor");
  syncDocumentPaginationState(editorView);

  markSaved(JSON.stringify(json), path, "md");
}

async function openDOCX(path: string): Promise<void> {
  try {
    const arrayBuffer = await loadBinaryFile(path);
    const html = await fromDocx(arrayBuffer);

    const { parseHTML, syncDocumentPaginationState } = await import("./editor");

    const newDoc = parseHTML(html);
    const newState = EditorState.create({
      schema: editorView.state.schema,
      doc: newDoc,
      plugins: editorView.state.plugins,
    });
    editorView.updateState(newState);
    syncDocumentPaginationState(editorView);

    markSaved(JSON.stringify(newState.doc.toJSON()), path, "docx");
  } catch (e) {
    console.error("DOCX import failed:", e);
    alert("Failed to import DOCX.");
  }
}

async function openTXT(path: string): Promise<void> {
  const content = await loadFile(path);
  const json = fromPlainText(content);

  const { Node } = await import("prosemirror-model");

  const newDoc = Node.fromJSON(schema, json);
  const newState = EditorState.create({
    schema: editorView.state.schema,
    doc: newDoc,
    plugins: editorView.state.plugins,
  });
  editorView.updateState(newState);

  const { syncDocumentPaginationState } = await import("./editor");
  syncDocumentPaginationState(editorView);

  markSaved(JSON.stringify(json), path, "txt");
}

function migrateImageNodesInJson(node: any): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((child) => migrateImageNodesInJson(child));
  }
  if (node.type === "image") {
    return { type: "paragraph", content: [node] };
  }
  if (Array.isArray(node.content)) {
    const newContent = node.content.map((child: any) => migrateImageNodesInJson(child));
    return { ...node, content: newContent };
  }
  return node;
}

async function handleExport(): Promise<void> {
  const filters = [
    { name: "Markdown", extensions: ["md"] },
    { name: "HTML", extensions: ["html", "htm"] },
    { name: "Word Document", extensions: ["docx"] },
    { name: "Plain Text", extensions: ["txt"] },
    { name: "AuraWrite JSON", extensions: ["json"] },
  ];

  const path = await getFilePath({
    save: true,
    filters,
    defaultPath: "document.md",
  });

  if (!path) return;

  const ext = path.split(".").pop()?.toLowerCase();

  // Special path for Markdown: also copy images to a sibling _attachments
  // folder so the exported .md is self-contained.
  if (ext === "md" || ext === "markdown") {
    await handleExportMarkdownSingle(path);
    return;
  }

  const content = await getContentByFormat(ext || "md");
  await saveFile(path, ext || "md", content);
}

/**
 * Export a single document as a standalone .md file with images copied to a
 * sibling <doc-name>_attachments/ folder. Emits:
 *   <user-path>/my-doc.md
 *   <user-path>/my-doc_attachments/1781-foo.png
 *   <user-path>/my-doc_attachments/1782-bar.jpg
 * The .md uses relative paths to those copied images:
 *   ![alt](my-doc_attachments/1781-foo.png)
 *
 * This way the .md file is self-contained and can be opened standalone in
 * Obsidian, VS Code, or any markdown viewer.
 */
async function handleExportMarkdownSingle(mdPath: string): Promise<void> {
  const doc = editorView.state.doc;
  const docTitle =
    (typeof doc.firstChild?.attrs?.title === "string" && doc.firstChild.attrs.title) ||
    basenameWithoutExt(mdPath) ||
    "document";
  const safeDocTitle = sanitizeFilenameLocal(docTitle);
  const baseDir = dirnameLocal(mdPath);
  const attachmentsDir = joinPathLocal(baseDir, `${safeDocTitle}_attachments`);

  // Create the attachments dir up front
  try {
    await invoke("vault_create_dir", { path: attachmentsDir });
  } catch (e) {
    showErrorToast(
      `Could not create attachments folder: ${(e as Error).message}`
    );
    return;
  }

  // Walk the doc, collect image sources, copy each, rewrite paths
  const imageMap = new Map<string, string>(); // original src -> relative copied path
  await walkAndCopyImages(doc, attachmentsDir, baseDir, imageMap);

  // Generate markdown with rewritten image paths
  const json: any = doc;
  const body = toMarkdownWithRewrites(json, {
    imagePathFor: (src: string) => {
      const rewritten = imageMap.get(src);
      if (rewritten) return rewritten;
      // If image wasn't copied (e.g. external http URL), keep original
      return null;
    },
  });

  // Write the .md
  await invoke("save_document", { path: mdPath, content: body });
  showInfoToast(
    `Exported to ${mdPath}${imageMap.size > 0 ? ` (${imageMap.size} image${imageMap.size === 1 ? "" : "s"} copied to ${safeDocTitle}_attachments/)` : ""}`
  );
}

async function walkAndCopyImages(
  node: any,
  attachmentsDir: string,
  baseDir: string,
  out: Map<string, string>
): Promise<void> {
  if (!node) return;
  if (node.type === "image" || (node.type && node.attrs?.src)) {
    const src: string = node.attrs?.src;
    if (src && !out.has(src)) {
      try {
        const fileName = await copyImageToDir(src, attachmentsDir, baseDir);
        if (fileName) {
          // Compute relative path from baseDir to attachmentsDir/fileName
          const rel = `${basenameLocal(attachmentsDir)}/${fileName}`;
          out.set(src, rel);
        }
      } catch (e) {
        console.warn(
          `[export-md-single] Could not copy image ${src}:`,
          (e as Error).message
        );
      }
    }
    return;
  }
  // node.content can be:
  //  - undefined (leaf node like "image" — already handled above)
  //  - a plain array (serialized ProseMirror JSON from the database)
  //  - a Fragment (live ProseMirror Node, has .forEach but no Symbol.iterator)
  //  - anything else (defensive: skip)
  const content = node.content;
  if (content && typeof content.forEach === "function") {
    // Fragment: collect via forEach
    const children: any[] = [];
    content.forEach((c: any) => children.push(c));
    for (const child of children) {
      await walkAndCopyImages(child, attachmentsDir, baseDir, out);
    }
  } else if (Array.isArray(content)) {
    for (const child of content) {
      await walkAndCopyImages(child, attachmentsDir, baseDir, out);
    }
  }
}

async function copyImageToDir(
  src: string,
  destDir: string,
  baseDir: string
): Promise<string | null> {
  // Strip any query/hash
  const cleanSrc = src.split("?")[0].split("#")[0];

  if (cleanSrc.startsWith("images/")) {
    // Local app-data image
    const absPath = await invoke<string>("read_image_asset_path", {
      relativePath: cleanSrc,
    });
    const fileName = basenameLocal(absPath);
    const destPath = joinPathLocal(destDir, fileName);
    await invoke("vault_copy_file", { src: absPath, dest: destPath });
    return fileName;
  }

  if (cleanSrc.startsWith("asset://") || cleanSrc.startsWith("http://asset.localhost")) {
    // Tauri asset protocol URL: fetch + write via base64
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk))
      );
    }
    const base64 = btoa(binary);
    // Derive a filename from the URL or fall back to "image-<n>"
    const urlFileName = cleanSrc.split("/").pop()?.split("?")[0] || "image";
    const fileName = sanitizeFilenameLocal(urlFileName) || "image";
    const destPath = joinPathLocal(destDir, fileName);
    await invoke("vault_write_file_bytes", { path: destPath, base64 });
    return fileName;
  }

  // data: URIs, http(s) URLs: skip (not safe to copy)
  return null;
}

// Local helpers (duplicated to keep this module self-contained)
function basenameWithoutExt(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const file = lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
  const lastDot = file.lastIndexOf(".");
  return lastDot > 0 ? file.substring(0, lastDot) : file;
}

function dirnameLocal(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash >= 0 ? p.substring(0, lastSlash) : "";
}

function basenameLocal(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
}

function joinPathLocal(...parts: string[]): string {
  const cleaned = parts
    .map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter((p) => p.length > 0);
  return cleaned.join("/");
}

function sanitizeFilenameLocal(name: string): string {
  if (!name) return "untitled";
  let s = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/[.\s]+$/, "");
  if (!s) s = "untitled";
  return s;
}

// ============================================================================
// EXPORT PROJECT (D1 — Obsidian vault export)
// ============================================================================

async function handleExportProject(): Promise<void> {
  // Need a project loaded. We import currentProject lazily to avoid a
  // circular import between toolbar.ts and project-panel.ts.
  const { currentProject } = await import("./project-panel");
  if (!currentProject) {
    showErrorToast(
      "No project selected. Open a project from the Projects panel first."
    );
    return;
  }
  const projectId: string = currentProject.id;

  const modal = document.getElementById("export-project-modal");
  const closeBtn = document.getElementById("export-project-close");
  const cancelBtn = document.getElementById("export-project-cancel");
  const browseBtn = document.getElementById("export-project-browse");
  const startBtn = document.getElementById("export-project-start");
  const vaultNameInput = document.getElementById(
    "export-project-vault-name"
  ) as HTMLInputElement | null;
  const targetDirLabel = document.getElementById("export-project-target-dir");
  const aiCheckbox = document.getElementById(
    "export-project-include-ai-index"
  ) as HTMLInputElement | null;
  const statusLabel = document.getElementById("export-project-status");
  const progressWrap = document.getElementById("export-project-progress-wrap");
  const progressBar = document.getElementById("export-project-progress-bar");

  if (
    !modal ||
    !closeBtn ||
    !cancelBtn ||
    !browseBtn ||
    !startBtn ||
    !vaultNameInput ||
    !targetDirLabel ||
    !aiCheckbox ||
    !statusLabel ||
    !progressWrap ||
    !progressBar
  ) {
    console.error("[export-project] modal elements not found");
    return;
  }

  // Pre-fill the vault name with the project name (best effort)
  try {
    const { getProject } = await import("../database/db");
    const project = await getProject(projectId);
    if (project && !vaultNameInput.value) {
      vaultNameInput.value = project.name || "AuraWrite Project";
    }
  } catch {
    // ignore
  }

  // Determine if AI is configured (best effort: check localStorage prefs key)
  let aiConfigured = false;
  try {
    const prefsRaw = localStorage.getItem("aurawrite-preferences");
    if (prefsRaw) {
      const prefs = JSON.parse(prefsRaw);
      if (prefs.aiProvider && prefs.aiProvider !== "none") {
        aiConfigured = true;
      }
    }
  } catch {
    // ignore
  }
  aiCheckbox.disabled = !aiConfigured;
  if (!aiConfigured) {
    aiCheckbox.checked = false;
  }

  // Reset state
  targetDirLabel.textContent = "(not selected)";
  statusLabel.textContent = "";
  statusLabel.style.color = "";
  progressWrap.style.display = "none";
  progressBar.style.width = "0%";
  let selectedTargetDir: string | null = null;

  const closeModal = () => {
    modal.classList.add("hidden");
  };

  const setStatus = (text: string, color?: string) => {
    statusLabel.textContent = text;
    if (color) statusLabel.style.color = color;
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  browseBtn.onclick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string" && picked.length > 0) {
        selectedTargetDir = picked;
        targetDirLabel.textContent = picked;
      }
    } catch (e) {
      setStatus(`Could not open folder picker: ${(e as Error).message}`, "red");
    }
  };

  startBtn.onclick = async () => {
    const vaultName = vaultNameInput.value.trim();
    if (!vaultName) {
      setStatus("Please enter a vault name.", "red");
      return;
    }
    if (!selectedTargetDir) {
      setStatus("Please choose a target folder.", "red");
      return;
    }
    if (aiCheckbox.checked && !aiConfigured) {
      setStatus("AI is not configured. Uncheck the AI index option.", "red");
      return;
    }

    (startBtn as HTMLButtonElement).disabled = true;
    (cancelBtn as HTMLButtonElement).disabled = true;
    progressWrap.style.display = "block";
    progressBar.style.width = "0%";
    setStatus("Starting export...");
    try {
      const { exportProjectToVault } = await import("../formats/obsidian");
      const result = await exportProjectToVault({
        projectId,
        parentDir: selectedTargetDir,
        vaultName,
        failIfExists: true,
        onProgress: (fraction, message) => {
          progressBar.style.width = `${Math.round(fraction * 100)}%`;
          setStatus(message);
        },
      });
      setStatus(
        `Vault exported to ${result.vaultPath} (${result.filesWritten} files, ${result.imagesCopied} images).`,
        "green"
      );
      // Keep modal open so user can see the path; close after 3s
      setTimeout(() => {
        closeModal();
        (startBtn as HTMLButtonElement).disabled = false;
        (cancelBtn as HTMLButtonElement).disabled = false;
      }, 3000);
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`, "red");
      (startBtn as HTMLButtonElement).disabled = false;
      (cancelBtn as HTMLButtonElement).disabled = false;
    }
  };

  modal.classList.remove("hidden");
}

async function getFilePath(options: {
  save?: boolean;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
}): Promise<string | null> {
  const { save, open } = await import("@tauri-apps/plugin-dialog");

  if (options.save) {
    return save({
      filters: options.filters,
      defaultPath: options.defaultPath,
    });
  } else {
    const result = await open({
      filters: options.filters,
      multiple: false,
    });
    return result as string | null;
  }
}

async function loadFile(path: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("load_document", { path });
}

async function loadBinaryFile(path: string): Promise<ArrayBuffer> {
  const { invoke } = await import("@tauri-apps/api/core");
  const base64 = await invoke<string>("load_binary_file", { path });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================================
// UNDO / REDO
// ============================================================================

function setupUndoRedoButtons(): void {
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");

  btnUndo?.addEventListener("click", () => {
    undo(editorView.state, editorView.dispatch);
    editorView.focus();
  });

  btnRedo?.addEventListener("click", () => {
    redo(editorView.state, editorView.dispatch);
    editorView.focus();
  });
}

// ============================================================================
// FORMATTING — Bold, Italic, Underline, Strikethrough
// ============================================================================

function toggleMarkWithStored(markName: string): void {
  const { state } = editorView;
  const markType = state.schema.marks[markName];
  if (!markType) return;

  const { from, to } = state.selection;
  if (from === to) {
    const activeMarks = state.storedMarks || [];
    const hasMark = activeMarks.some((m) => m.type === markType);
    if (hasMark) {
      editorView.dispatch(
        state.tr.setStoredMarks(activeMarks.filter((m) => m.type !== markType))
      );
    } else {
      editorView.dispatch(
        state.tr.addStoredMark(markType.create())
      );
    }
  } else {
    toggleMark(markType)(state, editorView.dispatch);
  }
  editorView.focus();
}

function setupFormattingButtons(): void {
  const btnBold = document.getElementById("btn-bold");
  const btnItalic = document.getElementById("btn-italic");
  const btnUnderline = document.getElementById("btn-underline");
  const btnPageBreak = document.getElementById("btn-page-break");
  const btnLink = document.getElementById("btn-link");
  const btnTable = document.getElementById("btn-table");
  const btnImage = document.getElementById("btn-image");

  btnBold?.addEventListener("click", () => toggleMarkWithStored("strong"));
  btnItalic?.addEventListener("click", () => toggleMarkWithStored("em"));
  btnUnderline?.addEventListener("click", () => toggleMarkWithStored("underline"));
  btnLink?.addEventListener("click", () => openLinkPopover(editorView));
  btnTable?.addEventListener("click", () => toggleTableDropdown());
  btnImage?.addEventListener("click", () => openImagePicker(editorView));

  setupTableToolbar(editorView);

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest("#btn-table") && !target.closest(".table-dropdown")) {
      hideTableDropdown();
    }
  });

  btnPageBreak?.addEventListener("click", () => {
    togglePageBreak();
    editorView.focus();
  });

  const btnPagedMode = document.getElementById("btn-paged-mode");
  btnPagedMode?.addEventListener("click", () => {
    handleTogglePagedMode();
  });
  updatePagedModeButtonText();
  window.addEventListener("aurawrite:pagination-mode-changed", ((e: CustomEvent) => {
    updatePagedModeButtonText();
    if (e.detail.enabled && getCassieMode()) {
      setCassieMode(false);
    }
  }) as EventListener);

  const btnCassie = document.getElementById("btn-cassie-pagination");
  btnCassie?.addEventListener("click", () => {
    handleToggleCassieMode();
  });
  updateCassieModeButton();
  window.addEventListener("aurawrite:cassie-pagination-changed", () => {
    updateCassieModeButton();
  });
}

// ============================================================================
// HEADING DROPDOWN
// ============================================================================

function setupHeadingControl(): void {
  const sel = document.getElementById("sel-heading") as HTMLSelectElement | null;
  if (!sel) return;

  sel.addEventListener("change", () => {
    const level = parseInt(sel.value, 10);
    const state = editorView.state;

    if (level === 0) {
      // Set to paragraph
      const nodeType = state.schema.nodes.paragraph;
      if (!nodeType) return;
      setBlockType(nodeType)(state, editorView.dispatch);
    } else {
      const nodeType = state.schema.nodes.heading;
      if (!nodeType) return;
      setBlockType(nodeType, { level })(state, editorView.dispatch);
    }

    sel.blur();
    editorView.focus();
  });
}

// ============================================================================
// LIST CONTROLS
// ============================================================================

function setupListControls(): void {
  const btn = document.getElementById("btn-list-menu") as HTMLButtonElement | null;
  const menu = document.getElementById("list-menu") as HTMLElement | null;
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      positionDropdown(btn, menu);
    } else {
      menu.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e: MouseEvent) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  });

  const bullet = document.getElementById("btn-bullet-list");
  const ordered = document.getElementById("btn-ordered-list");

  bullet?.addEventListener("click", () => {
    wrapInList(editorView.state.schema.nodes.bullet_list);
    menu.classList.add("hidden");
  });
  ordered?.addEventListener("click", () => {
    wrapInList(editorView.state.schema.nodes.ordered_list);
    menu.classList.add("hidden");
  });
}

function setupDecorControls(): void {
  const btn = document.getElementById("btn-decor-menu") as HTMLButtonElement | null;
  const menu = document.getElementById("decor-menu") as HTMLElement | null;
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      positionDropdown(btn, menu);
    } else {
      menu.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e: MouseEvent) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  });

  const strike = document.getElementById("btn-strikethrough-decor");
  const quote = document.getElementById("btn-blockquote-decor");
  const code = document.getElementById("btn-code-block-decor");

  strike?.addEventListener("click", () => {
    toggleMarkWithStored("strikethrough");
    menu.classList.add("hidden");
  });
  quote?.addEventListener("click", () => {
    handleToggleBlockquote();
    menu.classList.add("hidden");
  });
  code?.addEventListener("click", () => {
    handleToggleCodeBlock();
    menu.classList.add("hidden");
  });
}

function handleToggleBlockquote(): void {
  const { state } = editorView;
  const blockquoteType = state.schema.nodes.blockquote;
  if (!blockquoteType) return;

  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === blockquoteType) {
      lift(state, (tr: Transaction) => {
        editorView.dispatch(tr);
        editorView.focus();
      });
      return;
    }
  }

  wrapIn(blockquoteType)(state, (tr: Transaction) => {
    editorView.dispatch(tr);
    editorView.focus();
  });
}

function handleToggleCodeBlock(): void {
  const { state } = editorView;
  const codeBlockType = state.schema.nodes.code_block;
  const paragraphType = state.schema.nodes.paragraph;
  if (!codeBlockType || !paragraphType) return;

  const { $from } = state.selection;
  const node = $from.parent;
  if (node.type === codeBlockType) {
    setBlockType(paragraphType)(state, editorView.dispatch);
  } else {
    setBlockType(codeBlockType)(state, editorView.dispatch);
  }
  editorView.focus();
}

function wrapInList(listType?: NodeType): void {
  if (!listType) return;
  wrapIn(listType)(
    editorView.state,
    (tr: Transaction) => {
      editorView.dispatch(tr);
      editorView.focus();
    },
  );
}

function setupAlignmentControls(): void {
  const btn = document.getElementById("btn-align-menu") as HTMLButtonElement | null;
  const menu = document.getElementById("align-menu") as HTMLElement | null;
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.classList.contains("hidden")) {
      menu.classList.remove("hidden");
      positionDropdown(btn, menu);
    } else {
      menu.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e: MouseEvent) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  });

  menu.querySelectorAll<HTMLButtonElement>("[data-align]").forEach((item) => {
    item.addEventListener("click", () => {
      const align = item.getAttribute("data-align") as
        | "left"
        | "center"
        | "right"
        | "justify";
      setAlignment(align);
      menu.classList.add("hidden");
    });
  });
}

function setAlignment(align: "left" | "center" | "right" | "justify"): void {
  const { state } = editorView;
  const tr = state.tr;
  const { from, to } = state.selection;

  let applied = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      tr.setNodeMarkup(pos, undefined, { ...(node.attrs || {}), align });
      applied = true;
    }
  });

  if (!applied) {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        const pos = $from.before(d);
        tr.setNodeMarkup(pos, undefined, { ...(node.attrs || {}), align });
        applied = true;
        break;
      }
    }
  }

  if (applied) {
    editorView.dispatch(tr);
    editorView.focus();
  }
}

// ============================================================================
// STYLE CONTROLS — Font, Size, Color, Highlight, Line Height
// ============================================================================

async function setupStyleControls(): Promise<void> {
  await populateUserFontsInToolbar();
  const selFont = document.getElementById("sel-font-family") as HTMLSelectElement | null;
  const selSize = document.getElementById("sel-font-size") as HTMLSelectElement | null;
  const btnTextColor = document.getElementById("btn-text-color") as HTMLInputElement | null;
  const btnHighlightToggle = document.getElementById("btn-highlight-toggle");
  const btnHighlightColor = document.getElementById("btn-highlight") as HTMLInputElement | null;
  const selLineHeight = document.getElementById("sel-line-height") as HTMLSelectElement | null;
  const fontPreview = document.getElementById("font-family-preview") as HTMLSpanElement | null;

  const updateFontPreview = () => {
    if (!fontPreview || !selFont) return;
    const font = selFont.value;
    fontPreview.style.fontFamily = font || "inherit";
  };
  updateFontPreview();

  selFont?.addEventListener("change", () => {
    const font = selFont.value;
    if (!font) return;
    applyTextMarkOrStored("fontFamily", { font });
    updateFontPreview();
    selFont.blur();
    editorView.focus();
  });

  selSize?.addEventListener("change", () => {
    const size = selSize.value;
    if (!size) return;
    applyTextMarkOrStored("fontSize", { size });
    selSize.blur();
    editorView.focus();
  });

  btnTextColor?.addEventListener("input", () => {
    const color = btnTextColor.value;
    if (!color) return;
    applyTextMarkOrStored("textColor", { color });
  });

  btnTextColor?.addEventListener("change", () => {
    editorView.focus();
  });

  btnHighlightToggle?.addEventListener("click", () => {
    const { state } = editorView;
    const markType = state.schema.marks.highlight;
    if (!markType) return;
    const color = btnHighlightColor?.value || "#ffff00";
    const { from, to } = state.selection;

    if (from === to) {
      const activeMarks = state.storedMarks || [];
      const hasHighlight = activeMarks.some((m) => m.type === markType);
      if (hasHighlight) {
        editorView.dispatch(state.tr.setStoredMarks(activeMarks.filter((m) => m.type !== markType)));
      } else {
        editorView.dispatch(state.tr.addStoredMark(markType.create({ color })));
      }
    } else {
      const hasHighlight = state.doc.rangeHasMark(from, to, markType);
      if (hasHighlight) {
        editorView.dispatch(state.tr.removeMark(from, to, markType));
      } else {
        editorView.dispatch(state.tr.addMark(from, to, markType.create({ color })));
      }
    }
    editorView.focus();
  });

  btnHighlightColor?.addEventListener("input", () => {
    const color = btnHighlightColor.value;
    if (!color) return;
    const { state } = editorView;
    const { from, to } = state.selection;
    const markType = state.schema.marks.highlight;
    if (!markType) return;
    if (from === to) return;
    const tr = state.tr.addMark(from, to, markType.create({ color }));
    editorView.dispatch(tr);
  });

  btnHighlightColor?.addEventListener("change", () => {
    editorView.focus();
  });

  selLineHeight?.addEventListener("change", () => {
    const lineHeight = selLineHeight.value;
    if (!lineHeight) return;
    setLineHeight(lineHeight);
    selLineHeight.blur();
    editorView.focus();
  });
}

function applyTextMarkOrStored(markName: string, attrs: Record<string, string>): void {
  const { state } = editorView;
  const markType = state.schema.marks[markName];
  if (!markType) return;

  const { from, to } = state.selection;
  if (from === to) {
    const activeMarks = state.storedMarks || [];
    const existing = activeMarks.find((m) => m.type === markType);
    if (existing) {
      const updated = activeMarks.filter((m) => m.type !== markType);
      updated.push(markType.create(attrs));
      editorView.dispatch(state.tr.setStoredMarks(updated));
    } else {
      editorView.dispatch(state.tr.addStoredMark(markType.create(attrs)));
    }
  } else {
    const tr = state.tr.addMark(from, to, markType.create(attrs));
    editorView.dispatch(tr);
  }
}

function setLineHeight(lineHeight: string): void {
  const { state } = editorView;
  const { $from } = state.selection;
  const depth = $from.depth;

  if (depth === 0) return;

  const node = $from.node(depth);
  const pos = $from.before(depth);

  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...(node.attrs || {}),
    lineHeight,
  });
  editorView.dispatch(tr);
}

// ============================================================================
// PAGE BREAK
// ============================================================================

function togglePageBreak(): void {
  const { from } = editorView.state.selection;
  const $pos = editorView.state.doc.resolve(from);

  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "paragraph") {
      const pos = $pos.before(depth);
      const nodeAtPos = editorView.state.doc.nodeAt(pos);

      if (!nodeAtPos) continue;

      const currentValue = nodeAtPos.attrs.pageBreakBefore as boolean;
      const tr = editorView.state.tr;

      tr.setNodeMarkup(pos, undefined, {
        ...nodeAtPos.attrs,
        pageBreakBefore: !currentValue,
      });

      editorView.dispatch(tr);
      return;
    }
  }
}

function handleTogglePagedMode(): void {
  toggleDocPagedMode(editorView);
  updatePagedModeButtonText();
  editorView.focus();
}

function handleToggleCassieMode(): void {
  setCassieMode(!getCassieMode());
  // Force a re-measure by dispatching an empty transaction; the
  // plugin recomputes on the next doc-changing transaction, but
  // the user expects immediate visual feedback after toggling.
  const tr = editorView.state.tr;
  tr.setMeta("force-cassie-recompute", true);
  editorView.dispatch(tr);
  editorView.focus();
}

function updateCassieModeButton(): void {
  const btn = document.getElementById("btn-cassie-pagination") as HTMLButtonElement | null;
  if (!btn) return;
  btn.classList.toggle("toolbar__btn--active", getCassieMode());
  btn.disabled = getPagedMode();
}

function updatePagedModeButtonText(): void {
  const btn = document.getElementById("btn-paged-mode");
  if (!btn) return;
  const btnText = btn.querySelector(".toolbar__btn-text");
  if (!btnText) return;
  const isPaged = getPagedMode();
  btnText.textContent = isPaged ? "Scroll" : "Pages";
  btn.classList.toggle("toolbar__btn--active", isPaged);
  // Show/hide the persistent info banner above the editor.
  const banner = document.getElementById("paged-info-banner");
  if (banner) {
    if (isPaged) {
      banner.removeAttribute("hidden");
    } else {
      banner.setAttribute("hidden", "");
    }
  }
  // Show/hide the width control depending on mode
  syncWidthGroupVisibility();
  updateCassieModeButton();
}

async function handleSaveProject(): Promise<void> {
  if (!currentProject) {
    alert("No project open. Open a project from the sidebar first.");
    return;
  }
  await saveProjectToDb();
}

async function handleIndexDocument(): Promise<void> {
  if (!currentProject) {
    alert("No project open.");
    return;
  }
  if (!currentDocument) {
    alert("No document selected. Select a document first.");
    return;
  }
  await indexSingleDocument(currentDocument);
}

async function handleIndexAndCreateEntities(): Promise<void> {
  if (!currentProject) {
    alert("No project open.");
    return;
  }
  await indexEntireProject(currentProject);
}

export function getEditorView(): EditorView {
  return editorView;
}

// ============================================================================
// EDITOR MARGIN CONTROL (continuous mode only)
// ============================================================================

// The user-facing scale is 0–100.
// 0  = no margins (text fills the full editor area)
// 100 = maximum margins (very narrow text column, ~10% of editor width)
// Internally we map 0-100 → 0-45% actual CSS padding on each side.
const MARGIN_KEY = "aurawrite-editor-margin-pct";
const MARGIN_MIN = 0;
const MARGIN_MAX = 100;
const MARGIN_DEFAULT = 20; // ≈ 9% actual padding each side

function getEditorMargin(): number {
  const saved = localStorage.getItem(MARGIN_KEY);
  if (saved) {
    const n = parseInt(saved, 10);
    if (!isNaN(n) && n >= MARGIN_MIN && n <= MARGIN_MAX) return n;
  }
  return MARGIN_DEFAULT;
}

// Keep a persistent injected <style> element to override any cached CSS.
// This guarantees the rules apply even if Vite HMR hasn't refreshed styles.css.
let _editorStyleEl: HTMLStyleElement | null = null;

function applyEditorMargin(userVal: number): void {
  // Calcolo lineare dei margini interni: da 16px (0%) a calc(16px + 23%) (100%)
  const internalPct = (userVal / 100) * 23;

  // Inject (or update) a high-specificity style that overrides the CSS file
  if (!_editorStyleEl) {
    _editorStyleEl = document.createElement("style");
    _editorStyleEl.id = "__aura-editor-margin";
    document.head.appendChild(_editorStyleEl);
  }
  _editorStyleEl.textContent = `
    .ProseMirror:not(.is-paged-mode) {
      width: 95% !important;
      max-width: 95% !important;
      min-height: calc(100% - 40px) !important;
      margin: 20px auto !important;
      background: var(--color-paper, #fff) !important;
      box-shadow: var(--shadow-editor) !important;
      border-radius: 6px !important;
      padding-top: var(--spacing-xl) !important;
      padding-bottom: var(--spacing-xl) !important;
      padding-left: calc(16px + ${internalPct.toFixed(2)}%) !important;
      padding-right: calc(16px + ${internalPct.toFixed(2)}%) !important;
      box-sizing: border-box !important;
    }
    .ProseMirror:not(.is-paged-mode) .pm-page {
      width: 100% !important;
      max-width: none !important;
      min-height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
    }
    .ProseMirror:not(.is-paged-mode) .pm-page-header,
    .ProseMirror:not(.is-paged-mode) .pm-page-footer {
      display: none !important;
    }
  `;

  document.documentElement.style.setProperty("--editor-margin-h", `calc(16px + ${internalPct.toFixed(2)}%)`);
  localStorage.setItem(MARGIN_KEY, String(userVal));
  const inp = document.getElementById("inp-editor-width") as HTMLInputElement | null;
  if (inp && inp.value !== String(userVal)) inp.value = String(userVal);
}

function syncWidthGroupVisibility(): void {
  const group = document.getElementById("width-group");
  if (!group) return;
  group.classList.toggle("hidden", getPagedMode());
}

function setupWidthControl(): void {
  applyEditorMargin(getEditorMargin());
  syncWidthGroupVisibility();

  const inp = document.getElementById("inp-editor-width") as HTMLInputElement | null;
  if (!inp) return;

  inp.addEventListener("change", () => {
    const raw = parseInt(inp.value, 10);
    const val = isNaN(raw) ? MARGIN_DEFAULT : Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, raw));
    applyEditorMargin(val);
  });

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  });
}

// ============================================================================
// DROPDOWN POSITIONING — position:fixed support for overflow:hidden toolbar
// ============================================================================

function positionDropdown(trigger: HTMLElement, menu: HTMLElement | null): void {
  if (!menu || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 240;
  const vw = window.innerWidth;

  let left = rect.left;
  if (left + menuWidth > vw) {
    left = rect.right - menuWidth;
  }
  if (left < 0) left = 4;

  menu.style.top = `${rect.bottom}px`;
  menu.style.left = `${left}px`;
}

// ============================================================================
// OVERFLOW MENU — responsive toolbar items
// ============================================================================

// Groups that can overflow, in priority order (first to hide = lowest priority).
// width-group is first: it's least critical and already hides in paged mode.
// Groups that can overflow, in priority order (first to hide = lowest priority).
// width-group is first: it's least critical and already hides in paged mode.
const OVERFLOW_ORDER: string[] = [
  "width-group",
  "misc-group",
  "line-height-group",
  "page-group",
  "alignment-group",
  "format-group",
  "style-group",
];

const GROUP_LABELS: Record<string, string> = {
  "style-group": "Style",
  "format-group": "Format",
  "alignment-group": "Alignment",
  "line-height-group": "Line Height",
  "page-group": "Page",
  "width-group": "Width",
  "misc-group": "Settings",
};

const GROUP_IDS_IN_ORDER: string[] = [
  "file-dropdown",
  "edit-group",
  "style-group",
  "format-group",
  "alignment-group",
  "line-height-group",
  "page-group",
  "width-group",
  "overflow-dropdown",
  "misc-group",
];

function assignGroupIds(): void {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar) return;
  const groups = toolbar.querySelectorAll(":scope > .toolbar-group");
  groups.forEach((group, i) => {
    // Only assign if the element has no explicit id already set in HTML.
    if (GROUP_IDS_IN_ORDER[i] && !group.id) {
      group.id = GROUP_IDS_IN_ORDER[i];
    }
  });
}

function setupOverflowMenu(): void {
  assignGroupIds();

  const btn = document.getElementById("btn-overflow-menu") as HTMLButtonElement;
  const menu = document.getElementById("overflow-menu") as HTMLElement;
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu?.classList.contains("hidden")) {
      forceRecalc();
      positionDropdown(btn, menu);
      menu?.classList.remove("hidden");
    } else {
      menu?.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  });

  const toolbar = document.querySelector(".toolbar") as HTMLElement;
  const overflowDropdown = document.getElementById("overflow-dropdown") as HTMLElement;
  if (!toolbar || !overflowDropdown) return;

  let pendingRaf = false;
  const scheduleRecalc = () => {
    if (pendingRaf) return;
    pendingRaf = true;
    requestAnimationFrame(() => {
      pendingRaf = false;
      recalcOverflow(toolbar, overflowDropdown, menu);
    });
  };

  const forceRecalc = () => {
    pendingRaf = false;
    recalcOverflow(toolbar, overflowDropdown, menu);
  };

  // Observe the toolbar itself — it must have overflow:hidden for clientWidth to work
  new ResizeObserver(scheduleRecalc).observe(toolbar);

  // Also observe body width changes (for window resize when toolbar doesn't shrink)
  new ResizeObserver(scheduleRecalc).observe(document.body);

  window.addEventListener("resize", scheduleRecalc);

  setTimeout(scheduleRecalc, 150);
  scheduleRecalc();
}

function recalcOverflow(toolbar: HTMLElement, overflowDropdown: HTMLElement, overflowMenu: HTMLElement): void {
  const isMenuOpen = !overflowMenu.classList.contains("hidden");

  const allGroups = Array.from(toolbar.querySelectorAll(":scope > .toolbar-group")) as HTMLElement[];
  for (const g of allGroups) {
    g.style.display = "";
  }

  if (!isMenuOpen) {
    overflowMenu.classList.add("hidden");
  }
  overflowDropdown.classList.remove("visible");

  void toolbar.offsetWidth;

  const toolbarWidth = toolbar.clientWidth;
  const gap = 8;
  let usedWidth = 0;
  for (const g of allGroups) {
    if (g.id === "overflow-dropdown") continue;
    // Skip groups hidden via CSS class (e.g. width-group in paged mode) —
    // their offsetWidth is 0 anyway, but the explicit skip is cleaner.
    if (g.classList.contains("hidden")) continue;
    usedWidth += g.offsetWidth + gap;
  }

  if (usedWidth <= toolbarWidth) {
    if (!isMenuOpen) {
      overflowMenu.innerHTML = "";
    }
    return;
  }

  overflowDropdown.classList.add("visible");
  void overflowDropdown.offsetWidth;
  const overflowBtnWidth = overflowDropdown.offsetWidth + gap;

  const targetWidth = toolbarWidth - overflowBtnWidth;

  let currentWidth = usedWidth;
  for (const groupId of OVERFLOW_ORDER) {
    if (currentWidth <= targetWidth) break;

    const group = document.getElementById(groupId) as HTMLElement;
    if (!group) continue;

    currentWidth -= (group.offsetWidth + gap);
    group.style.display = "none";
  }

  overflowMenu.innerHTML = "";

  for (const groupId of OVERFLOW_ORDER) {
    const group = document.getElementById(groupId) as HTMLElement;
    if (!group || group.style.display !== "none") continue;

    const label = GROUP_LABELS[groupId] || "";
    if (label) {
      const sectionHeader = document.createElement("div");
      sectionHeader.className = "overflow-section-label";
      sectionHeader.textContent = label;
      overflowMenu.appendChild(sectionHeader);
    }

    // If the group is a toolbar-dropdown (e.g. "List", "Align", "Decor"),
    // we replicate the dropdown items inline so the user can still
    // reach them. Without this, the user would see only the toggle
    // button with no way to access the items inside.
    if (group.classList.contains("toolbar-dropdown")) {
      const innerMenu = group.querySelector(".dropdown-menu") as HTMLElement | null;
      if (innerMenu) {
        const items = innerMenu.querySelectorAll<HTMLElement>(".dropdown-menu__item");
        for (const item of Array.from(items)) {
          const proxy = item.cloneNode(true) as HTMLElement;
          proxy.addEventListener("click", (e) => {
            e.stopPropagation();
            item.click();
            overflowMenu.classList.add("hidden");
          });
          overflowMenu.appendChild(proxy);
        }
      }
      const divider = document.createElement("div");
      divider.className = "dropdown-divider";
      overflowMenu.appendChild(divider);
      continue;
    }

    const row = document.createElement("div");
    row.className = "overflow-group-row";

    const children = Array.from(group.children);
    for (const child of children) {
      if (child.classList.contains("dropdown-menu")) continue;

      const proxy = createProxyButton(child as HTMLElement);
      if (proxy) row.appendChild(proxy);
    }

    if (row.children.length > 0) {
      overflowMenu.appendChild(row);
    }

    const divider = document.createElement("div");
    divider.className = "dropdown-divider";
    overflowMenu.appendChild(divider);
  }

  const lastChild = overflowMenu.lastElementChild;
  if (lastChild && lastChild.classList.contains("dropdown-divider")) {
    lastChild.remove();
  }

  if (isMenuOpen) {
    overflowMenu.classList.remove("hidden");
    positionDropdown(overflowDropdown.querySelector("#btn-overflow-menu") as HTMLElement, overflowMenu);
  }
}

function createProxyButton(original: HTMLElement): HTMLElement | null {
  if (original instanceof HTMLButtonElement) {
    const btn = document.createElement("button");
    btn.className = original.className;
    btn.title = original.title || "";
    if (original.classList.contains("active")) btn.classList.add("active");

    const icon = original.querySelector(".toolbar__btn-icon");
    const isIconOnly = original.classList.contains("toolbar__btn-icon-only");

    if (icon) {
      btn.appendChild(icon.cloneNode(true));
    } else if (isIconOnly) {
      btn.textContent = original.textContent?.trim() || "";
    } else {
      const txt = original.querySelector(".toolbar__btn-text");
      if (txt) btn.appendChild(txt.cloneNode(true));
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      original.click();
      const m = document.getElementById("overflow-menu");
      if (m) m.classList.add("hidden");
    });

    return btn;
  }

  if (original instanceof HTMLSelectElement) {
    const select = original.cloneNode(true) as HTMLSelectElement;
    select.value = original.value;
    select.className = original.className;

    select.addEventListener("change", () => {
      original.value = select.value;
      original.dispatchEvent(new Event("change", { bubbles: true }));
    });

    return select;
  }

  if (original instanceof HTMLInputElement && original.type === "color") {
    const input = document.createElement("input");
    input.type = "color";
    input.value = original.value;
    input.className = original.className;
    input.title = original.title || "";

    input.addEventListener("input", () => {
      original.value = input.value;
      original.dispatchEvent(new Event("input", { bubbles: true }));
    });

    return input;
  }

  if (original instanceof HTMLInputElement && original.type === "color") {
    const input = document.createElement("input");
    input.type = "color";
    input.value = original.value;
    input.className = original.className;
    input.title = original.title || "";

    input.addEventListener("input", () => {
      original.value = input.value;
      original.dispatchEvent(new Event("input", { bubbles: true }));
    });

    return input;
  }

  if (original instanceof HTMLInputElement && original.type === "number") {
    const input = document.createElement("input");
    input.type = "number";
    if (original.min) input.min = original.min;
    if (original.max) input.max = original.max;
    if (original.step) input.step = original.step;
    input.value = original.value;
    input.className = original.className;
    input.title = original.title || "";

    input.addEventListener("change", () => {
      original.value = input.value;
      original.dispatchEvent(new Event("change", { bubbles: true }));
    });

    return input;
  }

  return null;
}
