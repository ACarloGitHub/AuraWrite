/* global setTimeout */

import type { EditorView } from "prosemirror-view";
import { Decoration } from "prosemirror-view";
import { sendToAI } from "./ai-manager";
import { getEditorContent } from "../editor/editor";
import { notifyDocumentChange } from "./modification-hub";
import {
  suggestionsMarkerPluginKey,
  getPositionForSlot,
  createSuggestionDecoration,
} from "../editor/suggestions-marker-plugin";

interface SentenceSuggestion {
  id: string;
  sentenceTitle: string;
  original: string;
  suggested: string | null;
  reason: string | null;
  timestamp: number;
  isExpanded: boolean;
  showingOriginal: boolean;
  isAccepted: boolean;
  isCollapsed: boolean;
  isProcessing: boolean;
}

interface AISuggestionResponse {
  context_understood: string;
  suggestions: {
    sentence_title: string;
    original: string;
    suggested: string | null;
    reason: string | null;
  }[];
}

interface SentenceSlot {
  id: string;
  text: string;
  state:
    | "pending"
    | "processing"
    | "suggested"
    | "discarded"
    | "accepted"
    | "closed";
  suggestion: string | null;
  reason: string | null;
}

let suggestions: SentenceSuggestion[] = [];
let slots: SentenceSlot[] = [];
let editorViewRef: EditorView | null = null;
let contextUnderstood: string = "";
let acceptedOriginals: Map<string, string> = new Map();
let closedSentences: Set<string> = new Set();
let isCurrentlyProcessing: boolean = false;
let currentProcessingSlotId: string | null = null;

let SUGGESTIONS_DEBUG = true;
const DEBUG_LOG: string[] = [];

function log(message: string): void {
  if (!SUGGESTIONS_DEBUG) return;
  const time = new Date().toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const entry = `[${time}] ${message}`;
  DEBUG_LOG.push(entry);
  console.log(entry);
  updateDebugLog();
}

function updateDebugLog(): void {
  if (!SUGGESTIONS_DEBUG) return;
  const logEl = document.getElementById("suggestions-debug-log");
  if (logEl) {
    if (DEBUG_LOG.length === 0) {
      logEl.style.display = "none";
    } else {
      logEl.style.display = "block";
      logEl.innerHTML = DEBUG_LOG.slice(-20)
        .map((e) => `<div class="debug-log-entry">${escapeHtml(e)}</div>`)
        .join("");
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
}

function getSlotPositionFromDecoration(
  id: string,
): { from: number; to: number } | null {
  if (!editorViewRef) return null;
  return getPositionForSlot(editorViewRef.state, id);
}

function createDecorationForSlot(
  slot: SentenceSlot,
  from: number,
  to: number,
): void {
  if (!editorViewRef) return;

  const decoration = createSuggestionDecoration(slot.id, from, to);
  const tr = editorViewRef.state.tr.setMeta(suggestionsMarkerPluginKey, {
    add: [decoration],
  });
  editorViewRef.dispatch(tr);

  log(`DECO: Created decoration for slot ${slot.id} at ${from}-${to}`);
}

function findProseMirrorPosition(
  view: EditorView,
  text: string,
  fallbackIndex: number,
): number {
  let foundPos = -1;
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        foundPos = pos + idx;
        return false;
      }
    }
  });
  if (foundPos !== -1) return foundPos;

  const docText = view.state.doc.textContent;
  const textIndex = docText.indexOf(text, fallbackIndex);
  if (textIndex !== -1) {
    return textIndex;
  }
  return fallbackIndex;
}

const PREFERENCES_KEY = "aurawrite-preferences";
const DEFAULT_INTERVAL = 30;

function getPreferences(): {
  aiSuggestionsInterval: number;
  suggestionsPrompt: string;
} {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    const prefs = JSON.parse(saved);
    return {
      aiSuggestionsInterval: prefs.aiSuggestionsInterval || DEFAULT_INTERVAL,
      suggestionsPrompt: prefs.suggestionsPrompt || "",
    };
  }
  return { aiSuggestionsInterval: DEFAULT_INTERVAL, suggestionsPrompt: "" };
}

const DEFAULT_SUGGESTIONS_PROMPT = `You are a writing assistant. Analyze the sentence and suggest improvements for clarity, style, and grammar.`;

export function setupSuggestionsPanel(view: EditorView): void {
  editorViewRef = view;
  setupPanelToggle();
  setupToolbarButton();
  setupDotTrigger(view);
}

function setupToolbarButton(): void {
  const btnSuggestions = document.getElementById("btn-suggestions");
  const suggestionsPanel = document.getElementById("suggestions-panel");

  btnSuggestions?.addEventListener("click", () => {
    const wasHidden = suggestionsPanel?.classList.contains("hidden");
    suggestionsPanel?.classList.toggle("hidden");

    if (wasHidden) {
      startSuggestionsMode();
    } else {
      stopSuggestionsMode();
    }
  });
}

function setupPanelToggle(): void {
  const suggestionsPanel = document.getElementById("suggestions-panel");
  const suggestionsToggle = document.getElementById("suggestions-toggle");

  suggestionsToggle?.addEventListener("click", () => {
    suggestionsPanel?.classList.add("hidden");
    stopSuggestionsMode();
  });
}

function startSuggestionsMode(): void {
  renderSuggestions();
  updateAnalysisStatus("Type a sentence ending with . to get suggestions");
}

function stopSuggestionsMode(): void {
  slots = [];
  isCurrentlyProcessing = false;
  currentProcessingSlotId = null;
}

function setupDotTrigger(view: EditorView): void {
  view.dom.addEventListener("keydown", (e: KeyboardEvent) => {
    if (![".", "!", "?", ":"].includes(e.key)) return;

    const suggestionsPanel = document.getElementById("suggestions-panel");
    if (!suggestionsPanel || suggestionsPanel.classList.contains("hidden"))
      return;

    setTimeout(() => {
      const doc = view.state.doc;
      const fullText = doc.textContent;

      const sentenceRegex = /[^.!?:]+[.!?:]+\s*/g;
      const sentences: { text: string; index: number }[] = [];
      let match;

      while ((match = sentenceRegex.exec(fullText)) !== null) {
        const rawSentence = match[0];
        const sentence = rawSentence.replace(/\s+/g, " ").trim();
        if (sentence.length >= 10) {
          sentences.push({ text: sentence, index: match.index });
        }
      }

      for (const { text: sentence, index: sentenceIndex } of sentences) {
        const normalized = sentence.toLowerCase();

        if (closedSentences.has(normalized)) continue;

        const existingSlot = slots.find(
          (s) => s.text.toLowerCase() === normalized,
        );
        if (existingSlot) continue;

        const existingBox = suggestions.find(
          (s) => s.original.toLowerCase() === normalized,
        );
        if (existingBox) continue;

        const pmFrom = findProseMirrorPosition(view, sentence, sentenceIndex);
        if (pmFrom === -1) {
          log(
            `SLOT: Could not find position for "${sentence.slice(0, 30)}..."`,
          );
          continue;
        }

        const slot: SentenceSlot = {
          id: generateId(),
          text: sentence,
          state: "pending",
          suggestion: null,
          reason: null,
        };

        createDecorationForSlot(slot, pmFrom, pmFrom + sentence.length);

        slots.push(slot);
        log(
          `SLOT: Created slot ${slot.id} at PM pos ${pmFrom}-${pmFrom + sentence.length} for "${sentence.slice(0, 30)}..."`,
        );
      }

      createBoxesFromSlots();
      processNextSlot();
    }, 10);
  });
}

function createBoxesFromSlots(): void {
  const pendingSlots = slots.filter(
    (s) => s.state === "pending" || s.state === "discarded",
  );

  const newSuggestions: SentenceSuggestion[] = [];

  for (const slot of pendingSlots) {
    const existingBox = suggestions.find(
      (b) => b.original.toLowerCase() === slot.text.toLowerCase(),
    );
    if (existingBox) continue;

    const suggestion: SentenceSuggestion = {
      id: slot.id,
      sentenceTitle: truncateText(slot.text, 30),
      original: slot.text,
      suggested: slot.suggestion,
      reason: slot.reason,
      timestamp: Date.now(),
      isExpanded: true,
      showingOriginal: false,
      isAccepted: slot.state === "accepted",
      isCollapsed: false,
      isProcessing: slot.state === "processing",
    };

    newSuggestions.push(suggestion);
  }

  if (newSuggestions.length > 0) {
    suggestions = [...suggestions, ...newSuggestions];
    renderSuggestions();
  }
}

async function processNextSlot(): Promise<void> {
  if (isCurrentlyProcessing) {
    return;
  }

  const slotIndex = slots.findIndex(
    (s) => s.state === "pending" || s.state === "discarded",
  );

  if (slotIndex === -1) {
    isCurrentlyProcessing = false;
    currentProcessingSlotId = null;
    updateAnalysisStatus("Analysis complete");
    return;
  }

  const slot = slots[slotIndex];
  const wasDiscarded = slot.state === "discarded";
  slot.state = "processing";
  currentProcessingSlotId = slot.id;
  isCurrentlyProcessing = true;

  const suggestionBox = suggestions.find((b) => b.id === slot.id);
  if (suggestionBox) {
    suggestionBox.isProcessing = true;
    renderSuggestions();
  }

  log(
    `PROCESS: Processing slot ${slot.id} - "${slot.text.slice(0, 30)}..." (wasDiscarded: ${wasDiscarded})`,
  );

  const prefs = getPreferences();
  const promptText = prefs.suggestionsPrompt || DEFAULT_SUGGESTIONS_PROMPT;

  let previousSuggestion = "";
  if (wasDiscarded && slot.suggestion) {
    previousSuggestion = slot.suggestion;
    log(
      `DISCARD: Previous suggestion was "${previousSuggestion.slice(0, 30)}..."`,
    );
  }

  updateAnalysisStatus(`Analyzing: "${slot.text.slice(0, 30)}..."`);

  const prompt = `${promptText}
${previousSuggestion ? `\nIMPORTANT: You must provide a COMPLETELY DIFFERENT suggestion. Do NOT suggest similar wording, synonyms of words used in: "${previousSuggestion}". Think of a completely different approach.` : ""}

SINGLE SENTENCE TO ANALYZE:
"${slot.text}"

Remember: Respond only with valid JSON in this exact format:
{
  "context_understood": "brief summary of tone/style (1 sentence max)",
  "suggestions": [
    {
      "sentence_title": "First 5 words...",
      "original": "full original sentence",
      "suggested": "improved version OR null if no change needed",
      "reason": "why this improves the text OR null"
    }
  ]
}`;

  try {
    log(`AI: Sending request...`);
    const response = await sendToAI(prompt, {
      documentTitle: document.title.replace(" - AuraWrite", ""),
    });
    log(
      `AI: Response received: ${response.error ? "ERROR - " + response.error : "OK"}`,
    );

    if (response.error) {
      slot.state = slot.suggestion ? "suggested" : "pending";
      updateAnalysisStatus(`Error: ${response.error}`);
    } else {
      processAIResponse(response.content, slot);
    }
  } catch (error) {
    log(`AI EXCEPTION: ${error}`);
    slot.state = slot.suggestion ? "suggested" : "pending";
    updateAnalysisStatus(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  isCurrentlyProcessing = false;
  currentProcessingSlotId = null;

  const processingBox = suggestions.find((b) => b.isProcessing);
  if (processingBox) {
    processingBox.isProcessing = false;
  }

  setTimeout(() => processNextSlot(), 100);
}

function processAIResponse(content: string, slot: SentenceSlot): void {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log(`PARSE ERROR: No JSON found`);
      slot.state = "suggested";
      return;
    }

    const response: AISuggestionResponse = JSON.parse(jsonMatch[0]);

    if (response.context_understood) {
      contextUnderstood = response.context_understood;
    }

    if (response.suggestions && Array.isArray(response.suggestions)) {
      const newSuggestion = response.suggestions.find(
        (s) => s.suggested && s.original,
      );

      if (newSuggestion) {
        slot.suggestion = newSuggestion.suggested;
        slot.reason = newSuggestion.reason || null;
        slot.state = "suggested";

        const existingBox = suggestions.find((b) => b.id === slot.id);
        if (existingBox) {
          existingBox.suggested = slot.suggestion;
          existingBox.reason = slot.reason;
          existingBox.sentenceTitle =
            newSuggestion.sentence_title || truncateText(slot.text, 30);
          renderSuggestions();
        }

        log(`SUGGESTION: Got suggestion for slot ${slot.id}`);
      } else {
        log(`SUGGESTION: No valid suggestion`);
        slot.state = "suggested";
      }
    }

    if (slots.every((s) => s.state === "suggested" || s.state === "accepted")) {
      updateAnalysisStatus("Analysis complete");
    }
  } catch (error) {
    log(`PARSE EXCEPTION: ${error}`);
    slot.state = "suggested";
  }
}

function updateAnalysisStatus(status: string): void {
  const contentEl = document.querySelector(".suggestions-panel__content");
  if (!contentEl) return;

  const statusEl = contentEl.querySelector(".suggestions-status");
  if (statusEl) {
    statusEl.textContent = status;
  }
}

export function acceptSuggestion(id: string): void {
  log(`ACCEPT: Accepting suggestion for slot ${id}`);

  const slot = slots.find((s) => s.id === id);
  const suggestion = suggestions.find((s) => s.id === id);
  if (!slot || !suggestion || !editorViewRef) {
    log(`ACCEPT ERROR: Slot or suggestion not found`);
    return;
  }

  const currentPos = getSlotPositionFromDecoration(id);
  if (!currentPos) {
    log(`ACCEPT ERROR: Could not find decoration for slot ${id}`);
    return;
  }

  const finalSuggested = suggestion.suggested || suggestion.original;
  const oldLen = currentPos.to - currentPos.from;

  const tr = editorViewRef.state.tr.replaceWith(
    currentPos.from,
    currentPos.to,
    editorViewRef.state.schema.text(finalSuggested),
  );

  editorViewRef.dispatch(tr);

  const newLen = finalSuggested.length;

  const newDeco = createSuggestionDecoration(
    id,
    currentPos.from,
    currentPos.from + newLen,
  );
  const tr2 = editorViewRef.state.tr.setMeta(suggestionsMarkerPluginKey, {
    remove: [
      Decoration.inline(
        currentPos.from,
        currentPos.to,
        { class: "suggestion-marker", "data-slot-id": id },
        { id },
      ),
    ],
    add: [newDeco],
  });
  editorViewRef.dispatch(tr2);

  notifyDocumentChange(
    { from: currentPos.from, oldLen, newLen },
    "suggestions",
  );

  slot.state = "accepted";
  suggestion.isAccepted = true;
  suggestion.isExpanded = false;
  renderSuggestions();

  log(`ACCEPT: Successfully accepted`);
}

export function rejectSuggestion(id: string): void {
  log(`REJECT: Rejecting suggestion for slot ${id}`);

  const slot = slots.find((s) => s.id === id);
  const suggestion = suggestions.find((s) => s.id === id);
  if (!slot) {
    log(`REJECT ERROR: Slot not found`);
    return;
  }

  log(`REJECT: Marking slot ${id} as discarded`);
  slot.state = "discarded";

  if (suggestion) {
    suggestion.isExpanded = true;
    renderSuggestions();
  }

  processNextSlot();
}

export function switchSuggestion(id: string): void {
  log(`SWITCH: Switching suggestion for slot ${id}`);

  const slot = slots.find((s) => s.id === id);
  const suggestion = suggestions.find((s) => s.id === id);
  if (!slot || !suggestion || !editorViewRef) {
    log(`SWITCH ERROR: Slot not found`);
    return;
  }

  const currentPos = getSlotPositionFromDecoration(id);
  if (!currentPos) {
    log(`SWITCH ERROR: Could not find decoration for slot ${id}`);
    closeSuggestion(id);
    return;
  }

  const isShowingOriginal = suggestion.showingOriginal;
  const newText = isShowingOriginal
    ? suggestion.suggested || suggestion.original
    : suggestion.original;

  const oldLen = currentPos.to - currentPos.from;

  const tr = editorViewRef.state.tr.replaceWith(
    currentPos.from,
    currentPos.to,
    editorViewRef.state.schema.text(newText),
  );

  editorViewRef.dispatch(tr);

  const newLen = newText.length;

  const newDeco = createSuggestionDecoration(
    id,
    currentPos.from,
    currentPos.from + newLen,
  );
  const tr2 = editorViewRef.state.tr.setMeta(suggestionsMarkerPluginKey, {
    remove: [
      Decoration.inline(
        currentPos.from,
        currentPos.to,
        { class: "suggestion-marker", "data-slot-id": id },
        { id },
      ),
    ],
    add: [newDeco],
  });
  editorViewRef.dispatch(tr2);

  notifyDocumentChange(
    { from: currentPos.from, oldLen, newLen },
    "suggestions",
  );

  suggestion.showingOriginal = !isShowingOriginal;
  if (!isShowingOriginal) {
    suggestion.original = newText;
  }
  renderSuggestions();

  log(`SWITCH: Successfully switched to "${newText.slice(0, 30)}..."`);
}

export function closeSuggestion(id: string): void {
  log(`CLOSE: Closing slot ${id}`);

  const slot = slots.find((s) => s.id === id);
  const suggestion = suggestions.find((s) => s.id === id);

  if (slot) {
    closedSentences.add(slot.text.toLowerCase());
    slot.state = "closed";
  }

  if (suggestion) {
    closedSentences.add(suggestion.original.toLowerCase());
  }

  if (editorViewRef) {
    const currentPos = getSlotPositionFromDecoration(id);
    if (currentPos) {
      const tr = editorViewRef.state.tr.setMeta(suggestionsMarkerPluginKey, {
        remove: [
          Decoration.inline(
            currentPos.from,
            currentPos.to,
            { class: "suggestion-marker", "data-slot-id": id },
            { id },
          ),
        ],
      });
      editorViewRef.dispatch(tr);
      log(`DECO: Removed decoration for slot ${id}`);
    }
  }

  acceptedOriginals.delete(id);
  removeSuggestion(id);
}

export function toggleExpandSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion) return;
  suggestion.isExpanded = !suggestion.isExpanded;
  renderSuggestions();
}

export function toggleCollapseSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion) return;
  suggestion.isCollapsed = !suggestion.isCollapsed;
  renderSuggestions();
}

function removeSuggestion(id: string): void {
  suggestions = suggestions.filter((s) => s.id !== id);
  renderSuggestions();
}

function renderSuggestions(): void {
  const contentEl = document.querySelector(".suggestions-panel__content");
  if (!contentEl) return;

  if (suggestions.length === 0) {
    contentEl.innerHTML = `
      <div class="suggestions-status">Type a sentence ending with . to get suggestions</div>
      <div class="suggestions-empty">No suggestions yet</div>
    `;
    return;
  }

  const statusHtml = `
    <div class="suggestions-status">${escapeHtml(contextUnderstood) || "Analysis complete"}</div>
    ${suggestions
      .map(
        (s) => `
      <div class="suggestion-item ${s.isExpanded ? "suggestion-item--expanded" : ""} ${s.isAccepted ? "suggestion-item--accepted" : ""} ${s.isProcessing ? "suggestion-item--processing" : ""}" data-id="${s.id}">
        <div class="suggestion-item__header">
          <button class="suggestion-item__toggle" data-action="toggle">${s.isExpanded ? "▼" : "▶"}</button>
          <button class="suggestion-item__collapse" data-action="collapse">${s.isCollapsed ? "»" : "«"}</button>
          <span class="suggestion-item__title">${escapeHtml(s.sentenceTitle)}</span>
          ${s.isAccepted ? "<span class='suggestion-item__accepted-badge'>✓</span>" : ""}
          ${s.isProcessing ? "<span class='suggestion-item__processing-badge'>⟳</span>" : ""}
          <button class="suggestion-item__close" data-action="close">✕</button>
        </div>
        ${
          s.isProcessing
            ? `
        <div class="suggestion-item__body suggestion-item__body--processing">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__spinner"></span>
            <span class="suggestion-item__processing-text">Generating new suggestion...</span>
          </div>
        </div>
        `
            : s.isCollapsed
              ? `
        <div class="suggestion-item__actions">
          <button class="suggestion-item__accept" data-action="accept">Accept</button>
          <button class="suggestion-item__reject" data-action="reject">Discard</button>
          <button class="suggestion-item__switch" data-action="switch">Switch</button>
        </div>
        `
              : s.isExpanded
                ? `
        <div class="suggestion-item__body">
          <div class="suggestion-item__original">
            <span class="suggestion-item__label">Original:</span>
            <span class="suggestion-item__text">"${escapeHtml(s.original)}"</span>
          </div>
          ${
            s.suggested
              ? `
          <div class="suggestion-item__proposed">
            <span class="suggestion-item__label">Suggested:</span>
            <span class="suggestion-item__text">"${escapeHtml(s.suggested)}"</span>
          </div>
          `
              : ""
          }
          ${
            s.reason
              ? `
          <div class="suggestion-item__reason">
            <span class="suggestion-item__label">Reason:</span>
            <span class="suggestion-item__text">${escapeHtml(s.reason)}</span>
          </div>
          `
              : ""
          }
          <div class="suggestion-item__actions">
            <button class="suggestion-item__accept" data-action="accept">Accept</button>
            <button class="suggestion-item__reject" data-action="reject">Discard</button>
            <button class="suggestion-item__switch" data-action="switch">Switch</button>
          </div>
        </div>
        `
                : ""
        }
      </div>
    `,
      )
      .join("")}`;

  contentEl.innerHTML = statusHtml;

  contentEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".suggestion-item");
      const itemId = item?.getAttribute("data-id");
      const action = (e.target as HTMLElement).getAttribute("data-action");

      if (!itemId || !action) return;

      switch (action) {
        case "accept":
          acceptSuggestion(itemId);
          break;
        case "reject":
          rejectSuggestion(itemId);
          break;
        case "switch":
          switchSuggestion(itemId);
          break;
        case "close":
          closeSuggestion(itemId);
          break;
        case "toggle":
          toggleExpandSuggestion(itemId);
          break;
        case "collapse":
          toggleCollapseSuggestion(itemId);
          break;
      }
    });
  });
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function getSuggestions(): SentenceSuggestion[] {
  return [...suggestions];
}

export function clearSuggestions(): void {
  suggestions = [];
  slots = [];
  acceptedOriginals.clear();
  closedSentences.clear();
  isCurrentlyProcessing = false;
  currentProcessingSlotId = null;
  renderSuggestions();
}

export function resetAnalysisState(): void {
  closedSentences.clear();
}
