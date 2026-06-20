import type { EditorView } from "prosemirror-view";
import { DOMParser as PMDOMParser } from "prosemirror-model";
import type { AIContext, Attachment } from "./providers";
import mammoth from "mammoth";
import { initAI, sendToAI, isAIProcessing, setProcessing, buildContextWithTools, handlePreferencesChanged } from "./ai-manager";
import { selectionHighlightPluginKey } from "../editor/selection-highlight";
import { showSynonymPopup } from "../editor/synonym-popup";
import {
  splitIntoChunks,
  getChunkSettings,
  saveChunkSettings,
  estimateTokenCount,
  type Chunk,
} from "./chunks";
import {
  updateChunkDecorations,
  clearChunkDecorations,
} from "../editor/chunk-decorations";
import { getEditorContent } from "../editor/editor";
import { applyAuraEdit } from "./edit-executor";
import { parseToolCalls, executeTool, type ToolResult } from "./tools";
import { currentProject, currentSection, currentDocument } from "../editor/project-panel";
import { resolveWritingStyleFragment } from "../templates/apply";
import { updateContextFooter } from "./context-footer";

const MAX_TOOL_ITERATIONS = 3;

interface Message {
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

let pendingAttachments: Attachment[] = [];

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const DOCUMENT_EXTENSIONS = ["txt", "md", "json", "csv", "html", "xml", "log", "ts", "js", "py", "rs", "go", "java", "c", "cpp", "h"];
const DOCX_EXTENSIONS = ["docx"];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 500 * 1024;
const MAX_DOCX_SIZE = 10 * 1024 * 1024;

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith("." + ext));
}

function isDocumentFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith("." + ext));
}

function isDocxFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return DOCX_EXTENSIONS.some((ext) => lower.endsWith("." + ext));
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.substring(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addDocxAttachment(file: File): Promise<void> {
  if (file.size > MAX_DOCX_SIZE) {
    console.warn(`[attachments] DOCX ${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB, exceeds ${MAX_DOCX_SIZE / 1024 / 1024}MB limit`);
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mammothInput: any = (globalThis as { Buffer?: unknown }).Buffer
    ? { buffer: (globalThis as { Buffer: { from: (ab: ArrayBuffer) => unknown } }).Buffer.from(arrayBuffer) }
    : { arrayBuffer };

  const textResult = await mammoth.extractRawText(mammothInput);
  const text = textResult.value;

  if (!text.trim()) {
    console.warn(`[attachments] DOCX ${file.name} has no extractable text`);
    return;
  }

  const htmlResult = await mammoth.convertToHtml(mammothInput);

  pendingAttachments.push({
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename: file.name,
    data: text,
    html: htmlResult.value,
    size: text.length,
  });
}

async function addAttachmentFromFile(file: File): Promise<void> {
  const filename = file.name;

  if (isImageFile(filename)) {
    if (file.size > MAX_IMAGE_SIZE) {
      console.warn(`[attachments] Image ${filename} is ${(file.size / 1024 / 1024).toFixed(1)}MB, exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`);
      return;
    }
    const base64 = await readFileAsBase64(file);
    pendingAttachments.push({
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "image",
      mimeType: getMimeType(filename),
      filename,
      data: base64,
      size: file.size,
    });
  } else if (isDocxFile(filename)) {
    await addDocxAttachment(file);
  } else if (isDocumentFile(filename)) {
    if (file.size > MAX_DOCUMENT_SIZE) {
      console.warn(`[attachments] Document ${filename} is ${(file.size / 1024).toFixed(0)}KB, exceeds ${MAX_DOCUMENT_SIZE / 1024}KB limit`);
      return;
    }
    const text = await file.text();
    pendingAttachments.push({
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "document",
      mimeType: "text/plain",
      filename,
      data: text,
      size: file.size,
    });
  }
}

function insertDocumentIntoEditor(text: string, html?: string): void {
  if (!editorViewRef) return;
  const view = editorViewRef;
  const { state } = view;
  const { schema, selection } = state;

  let nodes: import("prosemirror-model").Node[];

  if (html && html.trim()) {
    const div = document.createElement("div");
    div.innerHTML = html;
    const parser = PMDOMParser.fromSchema(schema);
    const parsedDoc = parser.parse(div);
    const collected: import("prosemirror-model").Node[] = [];
    parsedDoc.content.forEach((node) => collected.push(node));
    nodes = collected;
  } else {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
    if (blocks.length === 0) return;
    nodes = blocks.map((block) => {
      const cleanText = block.replace(/\n/g, " ");
      return schema.nodes.paragraph.create({}, schema.text(cleanText));
    });
  }

  if (nodes.length === 0) return;

  const insertPos = selection.$to.after();
  let tr = state.tr;
  let pos = insertPos;
  for (const node of nodes) {
    tr = tr.insert(pos, node);
    pos += node.nodeSize;
  }
  tr = tr.scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

function renderAttachmentPreviews(): void {
  const container = document.getElementById("ai-attachments-preview");
  if (!container) return;

  if (pendingAttachments.length === 0) {
    container.innerHTML = "";
    container.classList.remove("active");
    return;
  }

  container.classList.add("active");
  container.innerHTML = "";

  for (const att of pendingAttachments) {
    const chip = document.createElement("div");
    chip.className = `ai-attachment-chip ai-attachment-chip--${att.kind}`;

    if (att.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${att.mimeType};base64,${att.data}`;
      img.alt = att.filename;
      img.className = "ai-attachment-chip__thumb";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "ai-attachment-chip__icon";
      icon.textContent = "📄";
      chip.appendChild(icon);
    }

    const label = document.createElement("span");
    label.className = "ai-attachment-chip__name";
    label.textContent = att.filename;
    chip.appendChild(label);

    if (att.kind === "document") {
      const insertBtn = document.createElement("button");
      insertBtn.className = "ai-attachment-chip__insert";
      insertBtn.textContent = "\u21A7";
      insertBtn.title = "Insert into editor";
      insertBtn.addEventListener("click", () => {
        insertDocumentIntoEditor(att.data, att.html);
      });
      chip.appendChild(insertBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "ai-attachment-chip__remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove attachment";
    removeBtn.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== att.id);
      renderAttachmentPreviews();
    });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  }
}

function openAttachDialog(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  const exts = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...DOCX_EXTENSIONS].join(",");
  input.accept = `image/*,.${exts.split(",").join(",.")}`;
  input.onchange = async () => {
    const files = input.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await addAttachmentFromFile(file);
      } catch (e) {
        console.error(`[attachments] Failed to read ${file.name}:`, e);
      }
    }
    renderAttachmentPreviews();
  };
  input.click();
}

interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

interface Preferences {
  aiContextInterval: number;
  aiAssistantPrompt: string;
  deselectOnDocumentClick: boolean;
  aiInterfaceLanguage: string;
  aiWritingLanguage: string;
  aiAssistantName: string;
  aiUserName: string;
}

let messages: Message[] = [];
let currentSelection: SelectionRange | null = null;
let editorViewRef: EditorView | null = null;
let highlighted: boolean = false;
let isPanelOpen: boolean = false;
let chunks: Chunk[] = [];
let selectedChunkId: string | null = null;
let documentChunksComputed: boolean = false;

const PREFERENCES_KEY = "aurawrite-preferences";
const DEFAULT_CONTEXT_INTERVAL = 30;

function getPreferences(): Preferences {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    const prefs = JSON.parse(saved);
    return {
      aiContextInterval: prefs.aiContextInterval || DEFAULT_CONTEXT_INTERVAL,
      aiAssistantPrompt: prefs.aiAssistantPrompt || "",
      deselectOnDocumentClick: prefs.deselectOnDocumentClick ?? true,
      aiInterfaceLanguage: prefs.aiInterfaceLanguage || "English",
      aiWritingLanguage: prefs.aiWritingLanguage || "English",
      aiAssistantName: prefs.aiAssistantName || "Aura",
      aiUserName: prefs.aiUserName || "",
    };
  }
  return {
    aiContextInterval: DEFAULT_CONTEXT_INTERVAL,
    aiAssistantPrompt: "",
    deselectOnDocumentClick: true,
    aiInterfaceLanguage: "English",
    aiWritingLanguage: "English",
    aiAssistantName: "Aura",
    aiUserName: "",
  };
}

export function setupAIPanel(view: EditorView): void {
  editorViewRef = view;
  initAI();
  setupPanelEvents(view);
  setupEditorClickListener(view);
  setupEditorSelectionListener(view);
  setupChatInputResizePersistence();
  window.addEventListener("aurawrite:preferences-changed", handlePreferencesChanged);
}

const CHAT_INPUT_HEIGHT_KEY = "aurawrite-chat-input-height";
const CHAT_INPUT_MIN_HEIGHT = 60;
const CHAT_INPUT_MAX_HEIGHT_RATIO = 0.5;

function setupChatInputResizePersistence(): void {
  const ta = document.getElementById("ai-input") as HTMLTextAreaElement | null;
  const handle = document.getElementById("ai-input-resize-handle") as HTMLElement | null;
  if (!ta) return;

  const saved = localStorage.getItem(CHAT_INPUT_HEIGHT_KEY);
  if (saved) {
    const height = parseInt(saved, 10);
    if (!isNaN(height) && height > 0) {
      ta.style.height = `${height}px`;
    }
  }

  let resizeTimer: number | null = null;
  const saveHeight = () => {
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      localStorage.setItem(CHAT_INPUT_HEIGHT_KEY, String(ta.offsetHeight));
    }, 250);
  };

  ta.addEventListener("mouseup", saveHeight);

  if (handle) {
    let startY = 0;
    let startHeight = 0;
    let dragging = false;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const delta = startY - e.clientY;
      const maxHeight = Math.floor(window.innerHeight * CHAT_INPUT_MAX_HEIGHT_RATIO);
      const newHeight = Math.max(CHAT_INPUT_MIN_HEIGHT, Math.min(maxHeight, startHeight + delta));
      ta.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      saveHeight();
    };

    handle.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startHeight = ta.offsetHeight;
      handle.classList.add("dragging");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }
}

// Track selection only while the editor is focused, so the stored value
// survives when focus moves to the AI panel.
function setupEditorSelectionListener(view: EditorView): void {
  document.addEventListener("selectionchange", () => {
    // Defer one frame so ProseMirror has time to process the event
    // (e.g. double-click word selection updates PM state asynchronously)
    requestAnimationFrame(() => {
      if (!editorViewRef) return;
      const active = document.activeElement;
      const editorFocused = active === view.dom || view.dom.contains(active);
      if (!editorFocused) return;
      currentSelection = getSelectionRange(editorViewRef);
      updateSynonymsButton();
      // Update the "Selected: ..." display in real time while the panel is open
      if (isPanelOpen) updateContextDisplay();
    });
  });
}

function updateSynonymsButton(): void {
  const btn = document.getElementById("ai-synonyms") as HTMLButtonElement | null;
  if (!btn) return;
  // Button is always enabled — works on selected text or on word at cursor.
  btn.disabled = false;
  const word = currentSelection?.text.trim().split(/\s+/)[0];
  btn.title = word
    ? `Synonyms for "${word}"`
    : "Synonyms — looks up word at cursor";
}

function setupEditorClickListener(view: EditorView): void {
  const editorEl = view.dom;
  editorEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".ProseMirror")) {
      const prefs = getPreferences();
      if (prefs.deselectOnDocumentClick && highlighted) {
        const selection = getSelectionRange(view);
        if (!selection) {
          clearSelectionHighlight(view);
          currentSelection = null;
          updateContextDisplay();
        }
      }
    }
  });
}

function applySelectionHighlight(
  view: EditorView,
  selection: SelectionRange,
): void {
  clearSelectionHighlight(view);

  const flashTr = view.state.tr.setMeta(selectionHighlightPluginKey, {
    from: selection.from,
    to: selection.to,
    flash: true,
  });
  view.dispatch(flashTr);
  highlighted = true;

  setTimeout(() => {
    const steadyTr = view.state.tr.setMeta(selectionHighlightPluginKey, {
      from: selection.from,
      to: selection.to,
      flash: false,
    });
    view.dispatch(steadyTr);
  }, 600);
}

function clearSelectionHighlight(view: EditorView): void {
  const tr = view.state.tr.setMeta(selectionHighlightPluginKey, "clear");
  view.dispatch(tr);
  highlighted = false;
}

function setupPanelEvents(view: EditorView): void {
  const btnAI = document.getElementById("btn-ai");
  const aiPanel = document.getElementById("ai-panel");
  const aiClose = document.getElementById("ai-close");
  const aiSend = document.getElementById("ai-send");
  const aiInput = document.getElementById("ai-input") as HTMLTextAreaElement;
  const aiAttach = document.getElementById("ai-attach");

  btnAI?.addEventListener("click", () => {
    const wasHidden = aiPanel?.classList.contains("hidden");
    if (wasHidden) {
      const selection = getSelectionRange(view);
      if (selection) {
        currentSelection = selection;
        applySelectionHighlight(view, selection);
      }
      aiPanel?.classList.remove("hidden");
      isPanelOpen = true;

      if (!documentChunksComputed) {
        computeDocumentChunks();
        documentChunksComputed = true;
      }

      updateContextDisplay();
      updateChunkSelector();
      aiInput?.focus();
    } else {
      aiPanel?.classList.add("hidden");
      isPanelOpen = false;
      if (currentSelection && editorViewRef) {
        clearSelectionHighlight(editorViewRef);
      }
      currentSelection = null;
      updateContextDisplay();
    }
  });

  // mousedown fires before focus — capture stored selection before editor loses it.
  aiPanel?.addEventListener("mousedown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (editorViewRef && currentSelection && !highlighted) {
      applySelectionHighlight(editorViewRef, currentSelection);
      updateContextDisplay();
    }
    // Prevent default only for non-input elements so the editor keeps its
    // DOM selection alive long enough for selectionchange to have fired.
    if (tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT") {
      e.preventDefault();
    }
  });

  // When the textarea gets focus, use the stored selection (never live-read
  // the editor — it has already lost focus at this point).
  aiInput?.addEventListener("focus", () => {
    if (editorViewRef && currentSelection && !highlighted) {
      applySelectionHighlight(editorViewRef, currentSelection);
      updateContextDisplay();
    }
  });

  aiClose?.addEventListener("click", () => {
    aiPanel?.classList.add("hidden");
    isPanelOpen = false;
    if (currentSelection && editorViewRef) {
      clearSelectionHighlight(editorViewRef);
    }
    currentSelection = null;
    updateContextDisplay();
    updateSynonymsButton();
  });

  // Synonyms button — show popup above the selected word
  const aiSynonyms = document.getElementById("ai-synonyms") as HTMLButtonElement | null;
  aiSynonyms?.addEventListener("click", () => {
    if (!editorViewRef) return;
    // Ensure the selection is highlighted before opening the popup
    if (currentSelection && !highlighted) {
      applySelectionHighlight(editorViewRef, currentSelection);
      updateContextDisplay();
    }
    showSynonymPopup(editorViewRef, currentSelection);
  });

  aiAttach?.addEventListener("click", () => {
    openAttachDialog();
  });

  aiSend?.addEventListener("click", () => {
    const text = aiInput?.value.trim();
    if (!text && pendingAttachments.length === 0) return;
    if (editorViewRef && currentSelection && !highlighted) {
      applySelectionHighlight(editorViewRef, currentSelection);
      updateContextDisplay();
    }
    sendMessage(text, [...pendingAttachments]);
  });

  aiInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = aiInput.value.trim();
      if (!text && pendingAttachments.length === 0) return;
      if (editorViewRef && currentSelection && !highlighted) {
        applySelectionHighlight(editorViewRef, currentSelection);
        updateContextDisplay();
      }
      sendMessage(text, [...pendingAttachments]);
    }
  });
}

function computeDocumentChunks(): void {
  if (!editorViewRef) return;

  const documentText = getEditorContent(editorViewRef);
  const documentTitle = document.title.replace(" - AuraWrite", "");
  const settings = getChunkSettings();

  chunks = splitIntoChunks(
    documentText,
    documentTitle,
    settings.tokensPerChunk,
  );
  selectedChunkId = chunks.length > 0 ? chunks[0].id : null;

  updateChunkDecorations(editorViewRef, chunks, selectedChunkId);
}

function updateChunkSelector(): void {
  const chunkSelector = document.getElementById("ai-chunk-selector");
  if (!chunkSelector) return;

  if (chunks.length <= 1) {
    chunkSelector.innerHTML = "";
    return;
  }

  const settings = getChunkSettings();
  const totalTokens = estimateTokenCount(getEditorContent(editorViewRef!));

  chunkSelector.innerHTML = `
    <div class="ai-chunk-selector">
      <div class="ai-chunk-selector__header">
        <span>Document Chunks (${chunks.length})</span>
        <span class="ai-chunk-selector__tokens">~${totalTokens} tokens</span>
      </div>
      <select id="ai-chunk-select" class="ai-chunk-selector__select">
        ${chunks
          .map(
            (c) => `
          <option value="${c.id}" ${c.id === selectedChunkId ? "selected" : ""}>
            ${c.title} (~${estimateTokenCount(c.content)} tokens)
          </option>
        `,
          )
          .join("")}
      </select>
      <div class="ai-chunk-selector__settings">
        <label>
          Max tokens per chunk:
          <input type="number" id="ai-chunk-tokens" value="${settings.tokensPerChunk}" min="1000" max="100000" step="1000" />
        </label>
        <button id="ai-chunk-apply" class="ai-chunk-selector__apply">Apply</button>
      </div>
    </div>
  `;

  document
    .getElementById("ai-chunk-select")
    ?.addEventListener("change", (e) => {
      selectedChunkId = (e.target as HTMLSelectElement).value;
      if (editorViewRef) {
        updateChunkDecorations(editorViewRef, chunks, selectedChunkId);
      }
      updateContextDisplay();
    });

  document.getElementById("ai-chunk-apply")?.addEventListener("click", () => {
    const tokensInput = document.getElementById(
      "ai-chunk-tokens",
    ) as HTMLInputElement;
    const newTokens = parseInt(tokensInput.value, 10);
    if (newTokens >= 1000 && newTokens <= 100000) {
      saveChunkSettings({ ...settings, tokensPerChunk: newTokens });
      computeDocumentChunks();
      updateChunkSelector();
    }
  });
}

function getSelectionRange(view: EditorView): SelectionRange | null {
  const { from, to } = view.state.selection;
  if (from === to) return null;
  const text = view.state.doc.textBetween(from, to);
  if (!text.trim()) return null;
  return { from, to, text };
}

function updateContextDisplay(): void {
  const contextEl = document.getElementById("ai-context");
  if (!contextEl) return;

  const parts: string[] = [];

  if (currentSelection) {
    parts.push(`<div class="ai-panel__context-selection">
      <div class="ai-panel__context-label">Selected:</div>
      <div class="ai-panel__context-text">"${truncateText(currentSelection.text, 100)}"</div>
      <button id="ai-clear-selection" class="ai-panel__clear-btn" title="Clear selection">✕</button>
    </div>`);
  }

  if (selectedChunkId && chunks.length > 1) {
    const chunk = chunks.find((c) => c.id === selectedChunkId);
    if (chunk) {
      parts.push(`<div class="ai-panel__context-label">Chunk:</div>
        <div class="ai-panel__context-text">${chunk.title}</div>`);
    }
  }

  if (currentProject && currentProject.id) {
    parts.push(`<div class="ai-panel__context-label">Project: ${currentProject.name}</div>`);
  }

  if (parts.length > 0) {
    contextEl.classList.add("active");
    contextEl.innerHTML = parts.join("");

    const clearBtn = document.getElementById("ai-clear-selection");
    clearBtn?.addEventListener("click", () => {
      clearCurrentSelection();
    });
  } else {
    contextEl.classList.remove("active");
    contextEl.innerHTML = "";
  }
}

function clearCurrentSelection(): void {
  if (editorViewRef && highlighted) {
    clearSelectionHighlight(editorViewRef);
  }
  currentSelection = null;
  updateContextDisplay();
  updateSynonymsButton();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

function getDocumentText(): string {
  if (!editorViewRef) return "";
  return getEditorContent(editorViewRef);
}

function getSelectedChunkText(): string | null {
  if (!selectedChunkId || chunks.length === 0) return null;
  const chunk = chunks.find((c) => c.id === selectedChunkId);
  return chunk?.content || null;
}

function showToolCallIndicator(): HTMLDivElement | null {
  const historyEl = document.querySelector(".ai-panel__history");
  if (!historyEl) return null;

  const indicator = document.createElement("div");
  indicator.className = "ai-message ai-message--tool-call";
  indicator.innerHTML = `
    <span class="tool-call-indicator">
      <span class="tool-call-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
      Searching database...
    </span>
  `;
  historyEl.appendChild(indicator);
  historyEl.scrollTop = historyEl.scrollHeight;
  return indicator;
}

function updateToolCallIndicator(
  indicator: HTMLDivElement,
  toolNames: string[],
): void {
  indicator.innerHTML = `
    <span class="tool-call-indicator">
      <span class="tool-call-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
      Querying: ${toolNames.join(", ")}
    </span>
  `;
}

function removeToolCallIndicator(indicator: HTMLDivElement): void {
  indicator.remove();
}

async function sendMessage(text: string, attachments?: Attachment[]): Promise<void> {
  const aiInput = document.getElementById("ai-input") as HTMLTextAreaElement;
  const historyEl = document.querySelector(".ai-panel__history");

  if (isAIProcessing()) {
    return;
  }

  const sentAttachments = attachments && attachments.length > 0 ? attachments : undefined;
  appendMessage("user", text, sentAttachments);
  if (aiInput) aiInput.value = "";

  if (sentAttachments) {
    pendingAttachments = [];
    renderAttachmentPreviews();
  }

  if (historyEl) {
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  const chunkText = getSelectedChunkText();
  const documentText = getDocumentText();
  const prefs = getPreferences();

  // Se l'editor è vuoto, NON passiamo documentText: l'AI tenderebbe a
  // rispondere attingendo dalla history della chat, replicando la risposta
  // precedente. Passando undefined, l'AI sa che non c'è contesto testo
  // e si affida solo ai tool del database (se c'è un progetto aperto).
  const hasDocumentContent = documentText.trim().length > 0;
  const effectiveDocumentText = chunkText
    ? chunkText
    : hasDocumentContent
    ? documentText
    : undefined;

  let context: AIContext = {
    selectedText: currentSelection?.text || undefined,
    documentTitle: document.title.replace(" - AuraWrite", ""),
    documentText: effectiveDocumentText,
    projectId: currentProject?.id || undefined,
    assistantName: prefs.aiAssistantName || undefined,
    userName: prefs.aiUserName || undefined,
    interfaceLanguage: prefs.aiInterfaceLanguage || undefined,
    writingLanguage: prefs.aiWritingLanguage || undefined,
    customAssistantPrompt: prefs.aiAssistantPrompt || undefined,
    writingStyleFragment: currentProject && currentSection
      ? resolveWritingStyleFragment(currentSection, currentProject, currentDocument)
      : undefined,
    messageHistory: messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        ...(m.attachments ? { attachments: m.attachments } : {}),
      })),
    attachments: sentAttachments,
  };

  if (context.projectId) {
    context = buildContextWithTools(context);
  }

  const placeholder = appendMessage("assistant", "Thinking...");

  try {
    setProcessing(true);
    const response = await sendToAI(text, context);

    if (placeholder) {
      if (response.error) {
        placeholder.textContent = `Error: ${response.error}`;
        placeholder.classList.add("ai-message--error");
        setProcessing(false);
        return;
      }
    }

    let aiContent = response.content;

    if (context.projectId && aiContent) {
      let iteration = 0;
      let forcedToolRetry = false;

      while (iteration < MAX_TOOL_ITERATIONS) {
        const toolCalls = parseToolCalls(aiContent);

        // Se l'AI non ha chiamato nessun tool e siamo nel primo giro,
        // forziamo un retry: l'AI deve passare per i tool quando c'è
        // un progetto aperto, altrimenti replica la risposta precedente
        // attingendo dalla history della chat.
        if (toolCalls.length === 0 && iteration === 0 && !forcedToolRetry) {
          forcedToolRetry = true;
          const forcePrompt = `The user asked: "${text}". A project is currently open. You MUST call at least one database tool (e.g. list_entities_by_type, search_entities, get_entity_details, entities_in_document) before answering. Do not answer from the chat history alone.

To call a tool, include this tag in your response:
<tool name="TOOL_NAME">{"param1": "value1", "param2": "value2"}</tool>`;
          const forceContext = { ...context };
          const forceResponse = await sendToAI(forcePrompt, forceContext);
          if (forceResponse.error || !forceResponse.content) {
            // Se il retry fallisce, esci e usa la risposta precedente
            break;
          }
          aiContent = forceResponse.content;
          continue;
        }

        if (toolCalls.length === 0) {
          break;
        }

        const toolNames = toolCalls.map((tc) => tc.name);
        const indicator = showToolCallIndicator();
        if (indicator) {
          updateToolCallIndicator(indicator, toolNames);
        }

        const enrichedToolCalls = toolCalls.map((call) => ({
          ...call,
          arguments: {
            project_id: context.projectId,
            ...call.arguments,
          },
        }));

        const toolResults: ToolResult[] = [];
        for (const call of enrichedToolCalls) {
          // Defensive: refuse to execute a tool without a valid project_id
          // unless it's a global tool (none today, all are project-scoped).
          const args = call.arguments as Record<string, unknown>;
          if (args.project_id !== undefined) {
            if (
              typeof args.project_id !== "string" ||
              args.project_id.trim() === "" ||
              (context.projectId && args.project_id !== context.projectId)
            ) {
              console.warn(
                `[tools] refused call '${call.name}' with project_id=${JSON.stringify(args.project_id)} (expected ${context.projectId})`
              );
              toolResults.push({
                tool: call.name,
                result: "",
                error:
                  "Tool call refused: project_id is missing, empty, or does not match the currently open project. " +
                  "This prevents leaking entities from other projects.",
              });
              continue;
            }
          }
          const result = await executeTool(call);
          toolResults.push(result);
        }

        if (indicator) {
          removeToolCallIndicator(indicator);
        }

        let toolResultsText = "";
        for (const result of toolResults) {
          if (result.error) {
            toolResultsText += `\n[Error with ${result.tool}: ${result.error}]\n`;
          } else {
            toolResultsText += `\n[Result from ${result.tool}: ${JSON.stringify(result.result, null, 2)}]\n`;
          }
        }

        const cleanResponse = aiContent.replace(/<tool[^>]*>.*?<\/tool>/gs, "").trim();

        const followUpPrompt = `The user originally asked: "${text}"

You called the following database tool(s):
${toolNames.map((n) => `- ${n}`).join("\n")}

Here are the results from the database tools:
${toolResultsText}

Based on these results, provide your final response to the user's question. ${hasDocumentContent ? "You may also reference the document text that was provided." : "Answer ONLY based on the tool results above. If the tools returned empty results, say so clearly rather than answering from chat history."}`;

        iteration++;

        const followUpContext = { ...context };
        const followUpResponse = await sendToAI(followUpPrompt, followUpContext);

        if (followUpResponse.error) {
          if (placeholder) {
            placeholder.textContent = `${cleanResponse}\n\n[Tool error: ${followUpResponse.error}]`;
            placeholder.classList.add("ai-message--error");
          }
          setProcessing(false);
          return;
        }

        aiContent = followUpResponse.content;
      }
    }

    if (placeholder) {
      if (aiContent) {
        const editResult = applyAuraEdit(
          aiContent,
          editorViewRef!,
          currentSelection,
        );

        if (editResult.operationsApplied > 0) {
          placeholder.textContent = `✓ ${editResult.operationsApplied} modifica/e applicata/e`;
          if (editResult.operationsFailed > 0) {
            placeholder.textContent += `, ${editResult.operationsFailed} fallita/e`;
          }
        } else if (editResult.error) {
          placeholder.textContent = aiContent;
        } else {
          const cleanedContent = aiContent.replace(/<tool[^>]*>.*?<\/tool>/gs, "").trim();
          placeholder.textContent = cleanedContent || aiContent;
        }
      }
    }
  } catch (error) {
    if (placeholder) {
      placeholder.textContent = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      placeholder.classList.add("ai-message--error");
    }
  } finally {
    setProcessing(false);
    updateContextFooter();
  }

  if (historyEl) {
    historyEl.scrollTop = historyEl.scrollHeight;
  }
}
function appendMessage(
  role: "user" | "assistant" | "system" | "tool_result",
  content: string,
  attachments?: Attachment[],
): HTMLDivElement | null {
  const historyEl = document.querySelector(".ai-panel__history");
  if (!historyEl) return null;

  messages.push({ role, content, timestamp: Date.now(), ...(attachments ? { attachments } : {}) });

  const msgEl = document.createElement("div");
  msgEl.className = `ai-message ai-message--${role === "tool_result" ? "system" : role}`;

  if (attachments && attachments.length > 0) {
    const textNode = document.createElement("span");
    textNode.textContent = content;
    msgEl.appendChild(textNode);

    const previewWrap = document.createElement("div");
    previewWrap.className = "ai-message__attachments";
    for (const att of attachments) {
      if (att.kind === "image") {
        const img = document.createElement("img");
        img.src = `data:${att.mimeType};base64,${att.data}`;
        img.alt = att.filename;
        img.className = "ai-message__attachment-img";
        previewWrap.appendChild(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "ai-message__attachment-doc";
        chip.textContent = `📄 ${att.filename}`;
        previewWrap.appendChild(chip);
      }
    }
    msgEl.appendChild(previewWrap);
  } else {
    msgEl.textContent = content;
  }

  historyEl.appendChild(msgEl);
  return msgEl;
}

export function getMessages(): Message[] {
  return [...messages];
}

export function clearMessages(): void {
  messages = [];
  const historyEl = document.querySelector(".ai-panel__history");
  if (historyEl) {
    historyEl.innerHTML = "";
  }
}

export function getCurrentSelection(): SelectionRange | null {
  return currentSelection;
}

export function getChunks(): Chunk[] {
  return [...chunks];
}

export function getSelectedChunk(): string | null {
  return selectedChunkId;
}

export function resetChatChunks(): void {
  documentChunksComputed = false;
  chunks = [];
  selectedChunkId = null;
  clearChunkDecorations(editorViewRef!);
}