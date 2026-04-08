import type { EditorView } from "prosemirror-view";
import { initAI, sendToAI, isAIProcessing } from "./ai-manager";
import { selectionHighlightPluginKey } from "../editor/selection-highlight";
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

/* global setTimeout */

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
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
      deselectOnDocumentClick: prefs.deselectOnDocumentClick ?? true, // default true
    };
  }
  return {
    aiContextInterval: DEFAULT_CONTEXT_INTERVAL,
    aiAssistantPrompt: "",
    deselectOnDocumentClick: true,
  };
}

export function setupAIPanel(view: EditorView): void {
  editorViewRef = view;
  initAI();
  setupPanelEvents(view);
  setupEditorClickListener(view);
}

function setupEditorClickListener(view: EditorView): void {
  // Deselection on document click is now controlled by preference
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

  btnAI?.addEventListener("click", () => {
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
  });

  // Aggiorna la selezione quando l'utente clicca nell'input
  aiInput?.addEventListener("focus", () => {
    if (!editorViewRef) return;
    const selection = getSelectionRange(editorViewRef);
    if (selection) {
      currentSelection = selection;
      applySelectionHighlight(editorViewRef, selection);
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
  });

  aiSend?.addEventListener("click", () => {
    const text = aiInput?.value.trim();
    if (text) {
      sendMessage(text);
    }
  });

  aiInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = aiInput.value.trim();
      if (text) {
        sendMessage(text);
      }
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
            (c, i) => `
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

  if (parts.length > 0) {
    contextEl.classList.add("active");
    contextEl.innerHTML = parts.join("");

    // Aggiungi listener al pulsante clear
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

async function sendMessage(text: string): Promise<void> {
  const aiInput = document.getElementById("ai-input") as HTMLTextAreaElement;
  const historyEl = document.querySelector(".ai-panel__history");

  if (isAIProcessing()) {
    return;
  }

  appendMessage("user", text);
  if (aiInput) aiInput.value = "";

  if (historyEl) {
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  const chunkText = getSelectedChunkText();
  const documentText = getDocumentText();

  // TODO: Vector DB - When we implement vector database, we can do semantic search
  // to find relevant document chunks based on the user's query.
  // For now, we pass either the selected chunk or full document text.
  const context = {
    selectedText: currentSelection?.text || undefined,
    documentTitle: document.title.replace(" - AuraWrite", ""),
    documentText: chunkText || documentText || undefined,
  };

  const placeholder = appendMessage("assistant", "Thinking...");

  try {
    const response = await sendToAI(text, context);

    if (placeholder) {
      if (response.error) {
        placeholder.textContent = `Error: ${response.error}`;
        placeholder.classList.add("ai-message--error");
      } else {
        const editResult = applyAuraEdit(
          response.content,
          editorViewRef!,
          currentSelection,
        );

        if (editResult.operationsApplied > 0) {
          placeholder.textContent = `✓ ${editResult.operationsApplied} modifica/e applicata/e`;
          if (editResult.operationsFailed > 0) {
            placeholder.textContent += `, ${editResult.operationsFailed} fallita/e`;
          }
          // Note: Selection is NOT cleared automatically - user can iterate on same selection
        } else if (editResult.error) {
          placeholder.textContent = response.content;
        } else {
          placeholder.textContent = response.content;
        }
      }
    }
  } catch (error) {
    if (placeholder) {
      placeholder.textContent = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      placeholder.classList.add("ai-message--error");
    }
  }

  if (historyEl) {
    historyEl.scrollTop = historyEl.scrollHeight;
  }
}

function appendMessage(
  role: "user" | "assistant",
  content: string,
): HTMLDivElement | null {
  const historyEl = document.querySelector(".ai-panel__history");
  if (!historyEl) return null;

  messages.push({ role, content, timestamp: Date.now() });

  const msgEl = document.createElement("div");
  msgEl.className = `ai-message ai-message--${role}`;
  msgEl.textContent = content;
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
