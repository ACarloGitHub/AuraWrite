import { undo, redo } from "prosemirror-history";
import { toggleMark } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";

import { toMarkdown, fromMarkdown } from "../formats/markdown";
import { toPlainText, fromPlainText } from "../formats/txt";
import { toHTML } from "../formats/html";
import { toDocx, fromDocx, Packer } from "../formats/docx";
import { schema } from "./editor";
import {
  setPaginationEnabled,
  getPaginationEnabled,
  initPagination,
  updateOnTextChange,
  togglePagination,
} from "./fake-pagination";

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

export function setupToolbar(view: EditorView): void {
  editorView = view;

  setupUndoRedoButtons();
  setupFormattingButtons();
  setupTopLevelButtons();
  setupDirtyTracking();
  loadPreferences();
  updateDocumentTitleBar();
  initPagination(document.getElementById("editor")!, view);
}

function setupDirtyTracking(): void {
  editorView.setProps({
    dispatchTransaction(transaction: Transaction) {
      const newState = editorView.state.apply(transaction);
      editorView.updateState(newState);

      if (transaction.docChanged) {
        const newContent = JSON.stringify(newState.doc.toJSON());
        if (documentState.lastSavedContent !== newContent) {
          documentState.isDirty = true;
          updateWindowTitle();
          updateDocumentTitleBar();
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
    } catch (_e) {
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
  const btnSave = document.getElementById("btn-save");
  const btnSaveAs = document.getElementById("btn-save-as");
  const btnOpen = document.getElementById("btn-open");
  const btnExport = document.getElementById("btn-export");

  btnSave?.addEventListener("click", () => handleSave());
  btnSaveAs?.addEventListener("click", () => handleSaveAs());
  btnOpen?.addEventListener("click", () => handleOpen());
  btnExport?.addEventListener("click", () => handleExport());
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

async function docxToBase64(doc: any): Promise<string> {
  const docxDoc = toDocx(doc);
  const buffer = await Packer.toBuffer(docxDoc);
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
    { name: "ProseMirror JSON", extensions: ["json"] },
    { name: "Markdown", extensions: ["md"] },
    { name: "Word Document", extensions: ["docx"] },
    { name: "Plain Text", extensions: ["txt"] },
    { name: "All Files", extensions: ["*"] },
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

  const { Node } = await import("prosemirror-model");

  const newDoc = Node.fromJSON(schema, json);
  const newState = EditorState.create({ doc: newDoc });
  editorView.updateState(newState);

  markSaved(content, path, "json");
}

async function openMarkdown(path: string): Promise<void> {
  const content = await loadFile(path);
  const json = fromMarkdown(content);

  const { Node } = await import("prosemirror-model");

  const newDoc = Node.fromJSON(schema, json);
  const newState = EditorState.create({ doc: newDoc });
  editorView.updateState(newState);

  markSaved(JSON.stringify(json), path, "md");
}

async function openDOCX(path: string): Promise<void> {
  try {
    const arrayBuffer = await loadBinaryFile(path);
    const html = await fromDocx(arrayBuffer);

    const { parseHTML } = await import("./editor");

    const newDoc = parseHTML(html);
    const newState = EditorState.create({ doc: newDoc });
    editorView.updateState(newState);

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
  const newState = EditorState.create({ doc: newDoc });
  editorView.updateState(newState);

  markSaved(JSON.stringify(json), path, "txt");
}

async function handleExport(): Promise<void> {
  const filters = [
    { name: "Markdown", extensions: ["md"] },
    { name: "HTML", extensions: ["html"] },
    { name: "Word Document", extensions: ["docx"] },
    { name: "Plain Text", extensions: ["txt"] },
  ];

  const path = await getFilePath({
    save: true,
    filters,
    defaultPath: "document.md",
  });

  if (!path) return;

  const ext = path.split(".").pop()?.toLowerCase();
  const content = await getContentByFormat(ext || "md");
  await saveFile(path, ext || "md", content);
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

function setupFormattingButtons(): void {
  const btnBold = document.getElementById("btn-bold");
  const btnItalic = document.getElementById("btn-italic");
  const btnPageBreak = document.getElementById("btn-page-break");

  btnBold?.addEventListener("click", () => {
    const markType = editorView.state.schema.marks.strong;
    if (markType) {
      toggleMark(markType)(editorView.state, editorView.dispatch);
      editorView.focus();
    }
  });

  btnItalic?.addEventListener("click", () => {
    const markType = editorView.state.schema.marks.em;
    if (markType) {
      toggleMark(markType)(editorView.state, editorView.dispatch);
      editorView.focus();
    }
  });

  btnPageBreak?.addEventListener("click", () => {
    togglePageBreak();
    editorView.focus();
  });

  const btnAutoPagination = document.getElementById("btn-auto-pagination");
  btnAutoPagination?.addEventListener("click", () => {
    toggleAutoPagination();
  });
}

function togglePageBreak(): void {
  const { from } = editorView.state.selection;
  const $pos = editorView.state.doc.resolve(from);

  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "paragraph") {
      const pos = $pos.before(depth);
      const nodeAtPos = editorView.state.doc.nodeAt(pos);

      if (!nodeAtPos) continue;

      const tr = editorView.state.tr;

      tr.setNodeMarkup(pos, undefined, {
        ...nodeAtPos.attrs,
        pageBreakBefore: true,
      });

      const endPos = pos + nodeAtPos.nodeSize;
      const newParagraph = editorView.state.schema.nodes.paragraph.create();
      tr.insert(endPos, newParagraph);

      tr.setSelection(TextSelection.create(tr.doc, endPos + 1));

      editorView.dispatch(tr);
      return;
    }
  }
}

/**
 * Toggle auto pagination on/off
 */
function toggleAutoPagination(): void {
  const enabled = togglePagination(editorView);
  updateAutoPaginationButtonText(enabled);
  editorView.focus();
}

function updateAutoPaginationButtonText(enabled: boolean): void {
  const btn = document.getElementById("btn-auto-pagination");
  if (!btn) return;

  const btnText = btn.querySelector(".toolbar__btn-text");
  if (!btnText) return;

  btnText.textContent = enabled ? "Cont" : "Auto";
}

export function getEditorView(): EditorView {
  return editorView;
}
