import { undo, redo } from "prosemirror-history";
import { toggleMark, wrapIn, lift, setBlockType } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { NodeType } from "prosemirror-model";

import { toMarkdown, fromMarkdown } from "../formats/markdown";
import { toPlainText, fromPlainText } from "../formats/txt";
import { toHTML } from "../formats/html";
import { toDocx, fromDocx, Packer } from "../formats/docx";
import { schema } from "./editor";
import {
  initPagination,
  updateOnTextChange,
  togglePagination,
} from "./fake-pagination";
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

export function setupToolbar(view: EditorView): void {
  editorView = view;

  setupUndoRedoButtons();
  setupFormattingButtons();
  setupHeadingControl();
  setupListControls();
  setupAlignmentControls();
  setupStyleControls();
  setupTopLevelButtons();
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
        const isLoading = (window as any).__aurawrite_loading === true;
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
  const fileMenuBtn = document.getElementById("btn-file-menu");
  const fileMenu = document.getElementById("file-menu");

  fileMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    fileMenu?.classList.toggle("hidden");
  });

  fileMenu?.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = (item as HTMLElement).dataset.action;
      fileMenu?.classList.add("hidden");
      switch (action) {
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
  const btnStrikethrough = document.getElementById("btn-strikethrough");
  const btnBlockquote = document.getElementById("btn-blockquote");
  const btnCodeBlock = document.getElementById("btn-code-block");
  const btnPageBreak = document.getElementById("btn-page-break");

  btnBold?.addEventListener("click", () => toggleMarkWithStored("strong"));
  btnItalic?.addEventListener("click", () => toggleMarkWithStored("em"));
  btnUnderline?.addEventListener("click", () => toggleMarkWithStored("underline"));
  btnStrikethrough?.addEventListener("click", () => toggleMarkWithStored("strikethrough"));

  btnBlockquote?.addEventListener("click", () => {
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
  });

  btnCodeBlock?.addEventListener("click", () => {
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
  const btnBullet = document.getElementById("btn-bullet-list");
  const btnOrdered = document.getElementById("btn-ordered-list");

  btnBullet?.addEventListener("click", () => {
    wrapInList(editorView.state.schema.nodes.bullet_list);
  });

  btnOrdered?.addEventListener("click", () => {
    wrapInList(editorView.state.schema.nodes.ordered_list);
  });
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
  const btnLeft = document.getElementById("btn-align-left");
  const btnCenter = document.getElementById("btn-align-center");
  const btnRight = document.getElementById("btn-align-right");
  const btnJustify = document.getElementById("btn-align-justify");

  btnLeft?.addEventListener("click", () => setAlignment("left"));
  btnCenter?.addEventListener("click", () => setAlignment("center"));
  btnRight?.addEventListener("click", () => setAlignment("right"));
  btnJustify?.addEventListener("click", () => setAlignment("justify"));
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

function setupStyleControls(): void {
  const selFont = document.getElementById("sel-font-family") as HTMLSelectElement | null;
  const selSize = document.getElementById("sel-font-size") as HTMLSelectElement | null;
  const btnTextColor = document.getElementById("btn-text-color") as HTMLInputElement | null;
  const btnHighlightToggle = document.getElementById("btn-highlight-toggle");
  const btnHighlightColor = document.getElementById("btn-highlight") as HTMLInputElement | null;
  const selLineHeight = document.getElementById("sel-line-height") as HTMLSelectElement | null;

  selFont?.addEventListener("change", () => {
    const font = selFont.value;
    if (!font) return;
    applyTextMarkOrStored("fontFamily", { font });
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

function applyTextMark(markName: string, attrs: Record<string, string>): void {
  const { state } = editorView;
  const markType = state.schema.marks[markName];
  if (!markType) return;

  const { from, to } = state.selection;
  if (from === to) return;

  const tr = state.tr.addMark(from, to, markType.create(attrs));
  editorView.dispatch(tr);
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
// OVERFLOW MENU — responsive toolbar items
// ============================================================================

const OVERFLOW_ORDER: string[] = [
  "misc-group",
  "line-height-group",
  "page-group",
  "alignment-group",
  "format-group",
  "style-group",
];

let overflowObserver: ResizeObserver | null = null;

function assignGroupIds(): void {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar) return;

  const groups = toolbar.querySelectorAll(":scope > .toolbar-group");
  const groupNames = ["file-dropdown", "edit-group", "style-group", "format-group", "alignment-group", "line-height-group", "page-group", "overflow-dropdown", "misc-group"];

  groups.forEach((group, i) => {
    if (groupNames[i]) {
      group.id = groupNames[i];
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
    menu.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target as Node) && !menu.contains(e.target as Node)) {
      menu.classList.add("hidden");
    }
  });

  const toolbar = document.querySelector(".toolbar") as HTMLElement;
  if (!toolbar) return;

  const overflowDropdown = document.getElementById("overflow-dropdown") as HTMLElement;
  if (!overflowDropdown) return;

  overflowObserver = new ResizeObserver(() => {
    recalcOverflow(toolbar, overflowDropdown, menu);
  });
  overflowObserver.observe(toolbar);

  // Also recalc on window resize
  window.addEventListener("resize", () => {
    recalcOverflow(toolbar, overflowDropdown, menu);
  });

  // Initial calculation after a frame so toolbar has layout
  requestAnimationFrame(() => {
    recalcOverflow(toolbar, overflowDropdown, menu);
  });
}

function recalcOverflow(toolbar: HTMLElement, overflowDropdown: HTMLElement, overflowMenu: HTMLElement): void {
  // Step 1: Move all overflowed groups back to toolbar and show everything
  const hiddenGroups = overflowMenu.querySelectorAll(".overflow-hidden-group") as NodeListOf<HTMLElement>;
  hiddenGroups.forEach((g) => {
    toolbar.insertBefore(g, overflowDropdown);
    g.classList.remove("overflow-hidden-group");
    g.style.display = "";
  });

  // Step 2: Hide overflow dropdown, clear menu
  overflowDropdown.classList.remove("visible");
  overflowMenu.classList.add("hidden");
  overflowMenu.innerHTML = "";

  // Step 3: Measure total width of all groups
  const groups = Array.from(toolbar.querySelectorAll(":scope > .toolbar-group")) as HTMLElement[];
  const toolbarWidth = toolbar.clientWidth;
  const gapWidth = 8;

  let usedWidth = 0;
  for (const g of groups) {
    if (g.id === "overflow-dropdown") continue;
    usedWidth += g.offsetWidth + gapWidth;
  }

  // Step 4: If everything fits, done
  if (usedWidth <= toolbarWidth) return;

  // Step 5: Need overflow — find groups to hide in priority order
  const overflowBtnWidth = 48;
  const targetWidth = toolbarWidth - overflowBtnWidth;

  for (const groupId of OVERFLOW_ORDER) {
    if (usedWidth <= targetWidth) break;

    const group = document.getElementById(groupId) as HTMLElement;
    if (!group || group.parentElement !== toolbar) continue;

    usedWidth -= (group.offsetWidth + gapWidth);
    group.classList.add("overflow-hidden-group");

    // Move group into overflow menu container
    overflowMenu.appendChild(group);
    group.style.display = "flex";
  }

  // Step 6: Show overflow dropdown
  overflowDropdown.classList.add("visible");
}
