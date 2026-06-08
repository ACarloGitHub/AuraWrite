import type { EditorView } from "prosemirror-view";
import type { AIContext } from "./providers";
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
import { currentProject, currentSection } from "../editor/project-panel";
import { resolveWritingStyleFragment } from "../templates/apply";

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
  setupEditorSelectionListener(view);
  window.addEventListener("aurawrite:preferences-changed", handlePreferencesChanged);
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

  aiSend?.addEventListener("click", () => {
    const text = aiInput?.value.trim();
    if (!text) return;
    if (editorViewRef && currentSelection && !highlighted) {
      applySelectionHighlight(editorViewRef, currentSelection);
      updateContextDisplay();
    }
    sendMessage(text);
  });

  aiInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = aiInput.value.trim();
      if (!text) return;
      if (editorViewRef && currentSelection && !highlighted) {
        applySelectionHighlight(editorViewRef, currentSelection);
        updateContextDisplay();
      }
      sendMessage(text);
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
      ? resolveWritingStyleFragment(currentSection, currentProject)
      : undefined,
    messageHistory: messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1)
      .slice(-10)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
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

export function resetChatChunks(): void {
  documentChunksComputed = false;
  chunks = [];
  selectedChunkId = null;
  clearChunkDecorations(editorViewRef!);
}