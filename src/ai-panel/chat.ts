import type { EditorView } from "prosemirror-view";
import type { AIContext } from "./providers";
import { initAI, sendToAI, isAIProcessing, setProcessing, buildContextWithTools, handlePreferencesChanged } from "./ai-manager";
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
import { parseToolCalls, executeTool, type ToolResult } from "./tools";
import { currentProject } from "../editor/project-panel";

/* global setTimeout */

const MAX_TOOL_ITERATIONS = 3;

interface Message {
  role: "user" | "assistant" | "system" | "tool_result";
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
  window.addEventListener("aurawrite:preferences-changed", handlePreferencesChanged);
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
  const prefs = getPreferences();

  let context: AIContext = {
    selectedText: currentSelection?.text || undefined,
    documentTitle: document.title.replace(" - AuraWrite", ""),
    documentText: chunkText || documentText || undefined,
    projectId: currentProject?.id || undefined,
    assistantName: prefs.aiAssistantName || undefined,
    userName: prefs.aiUserName || undefined,
    interfaceLanguage: prefs.aiInterfaceLanguage || undefined,
    writingLanguage: prefs.aiWritingLanguage || undefined,
    customAssistantPrompt: prefs.aiAssistantPrompt || undefined,
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

      while (iteration < MAX_TOOL_ITERATIONS) {
        const toolCalls = parseToolCalls(aiContent);

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

        const followUpPrompt = `Here are the results from the database tools you requested:\n${toolResultsText}\n\nBased on these results, please provide your final response to the user. If the user asked you to modify the document, use the AURA_EDIT format. If they just asked for information, summarize it naturally.`;

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
  }

  if (historyEl) {
    historyEl.scrollTop = historyEl.scrollHeight;
  }
}

function appendMessage(
  role: "user" | "assistant" | "system" | "tool_result",
  content: string,
): HTMLDivElement | null {
  const historyEl = document.querySelector(".ai-panel__history");
  if (!historyEl) return null;

  messages.push({ role, content, timestamp: Date.now() });

  const msgEl = document.createElement("div");
  msgEl.className = `ai-message ai-message--${role === "tool_result" ? "system" : role}`;
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