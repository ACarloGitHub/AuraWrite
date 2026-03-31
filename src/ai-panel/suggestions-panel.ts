import type { EditorView } from "prosemirror-view";
import { sendToAI } from "./ai-manager";
import { getEditorContent } from "../editor/editor";

interface SentenceSuggestion {
  id: string;
  sentenceTitle: string;
  original: string;
  suggested: string | null;
  reason: string | null;
  timestamp: number;
  isExpanded: boolean;
  showingOriginal: boolean;
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

let suggestions: SentenceSuggestion[] = [];
let editorViewRef: EditorView | null = null;
let isAnalyzing: boolean = false;
let contextUnderstood: string = "";
let lastAnalyzedSentence: string = "";

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
  isAnalyzing = false;
}

function setupDotTrigger(view: EditorView): void {
  view.dom.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== ".") return;

    const suggestionsPanel = document.getElementById("suggestions-panel");
    if (!suggestionsPanel || suggestionsPanel.classList.contains("hidden"))
      return;

    const doc = view.state.doc;
    const { from } = view.state.selection;
    const textBefore = doc.textBetween(Math.max(0, from - 50), from, " ");

    const dotIndex = textBefore.lastIndexOf(".");
    if (dotIndex === -1) return;

    const textAfterDot = textBefore.slice(dotIndex + 1);
    if (textAfterDot.trim() !== "") return;

    const sentenceStart = Math.max(0, from - 50 + dotIndex);
    const sentenceText = doc.textBetween(sentenceStart, from + 1, " ");

    if (sentenceText.length < 10) return;
    if (sentenceText === lastAnalyzedSentence) return;

    lastAnalyzedSentence = sentenceText;
    analyzeSentence(sentenceText.trim());
  });
}

async function analyzeSentence(sentence: string): Promise<void> {
  if (isAnalyzing || !editorViewRef) return;

  const prefs = getPreferences();
  if (!prefs.suggestionsPrompt) return;

  isAnalyzing = true;
  updateAnalysisStatus(`Analyzing: "${sentence.slice(0, 30)}..."`);

  const prompt = `${prefs.suggestionsPrompt}

SINGLE SENTENCE TO ANALYZE:
"${sentence}"

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
    const response = await sendToAI(prompt, {
      documentTitle: document.title.replace(" - AuraWrite", ""),
    });

    if (response.error) {
      updateAnalysisStatus(`Error: ${response.error}`);
    } else {
      processAIResponse(response.content);
    }
  } catch (error) {
    updateAnalysisStatus(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  isAnalyzing = false;
}

function processAIResponse(content: string): void {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in AI response");
      return;
    }

    const response: AISuggestionResponse = JSON.parse(jsonMatch[0]);

    if (response.context_understood) {
      contextUnderstood = response.context_understood;
    }

    if (response.suggestions && Array.isArray(response.suggestions)) {
      const newSuggestions = response.suggestions
        .filter((s) => s.suggested && s.original)
        .map((s) => ({
          id: generateId(),
          sentenceTitle: s.sentence_title || truncateText(s.original, 30),
          original: s.original,
          suggested: s.suggested,
          reason: s.reason || null,
          timestamp: Date.now(),
          isExpanded: true,
          showingOriginal: false,
        }));

      if (newSuggestions.length > 0) {
        suggestions = [...newSuggestions, ...suggestions];
        renderSuggestions();
      } else {
        updateAnalysisStatus("No suggestions for this sentence");
      }
    }
  } catch (error) {
    console.error("Failed to parse AI response:", error);
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
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion || !editorViewRef) return;

  const documentText = getEditorContent(editorViewRef);
  const originalIndex = documentText.indexOf(suggestion.original);

  if (originalIndex === -1) {
    console.error("Original text not found in document");
    return;
  }

  let finalSuggested = suggestion.showingOriginal
    ? suggestion.original
    : suggestion.suggested || suggestion.original;

  const originalEndsWithPunct = /[.!?]$/.test(suggestion.original.trim());
  const suggestedEndsWithPunct = /[.!?]$/.test(finalSuggested.trim());

  if (originalEndsWithPunct && suggestedEndsWithPunct) {
    finalSuggested = finalSuggested.trim().slice(0, -1);
  }

  const tr = editorViewRef.state.tr.replaceWith(
    originalIndex,
    originalIndex + suggestion.original.length,
    editorViewRef.state.schema.text(finalSuggested),
  );

  editorViewRef.dispatch(tr);
  // TODO: DB - Save original sentence to database before replacing
  // db.sentences.save({ original: suggestion.original, accepted: true, timestamp: Date.now() });
  removeSuggestion(id);
}

export function rejectSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion || !editorViewRef) return;

  let finalSuggested = suggestion.showingOriginal
    ? suggestion.original
    : suggestion.suggested || suggestion.original;

  const originalEndsWithPunct = /[.!?]$/.test(suggestion.original.trim());
  const suggestedEndsWithPunct = /[.!?]$/.test(finalSuggested.trim());

  if (originalEndsWithPunct && suggestedEndsWithPunct) {
    finalSuggested = finalSuggested.trim().slice(0, -1);
  }

  const documentText = getEditorContent(editorViewRef);
  const originalIndex = documentText.indexOf(suggestion.original);

  if (originalIndex === -1) {
    removeSuggestion(id);
    return;
  }

  const tr = editorViewRef.state.tr.replaceWith(
    originalIndex,
    originalIndex + suggestion.original.length,
    editorViewRef.state.schema.text(finalSuggested),
  );

  editorViewRef.dispatch(tr);
  removeSuggestion(id);
}

export function switchSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion || !editorViewRef) return;

  const newShowingOriginal = !suggestion.showingOriginal;
  suggestion.showingOriginal = newShowingOriginal;

  const displayText = newShowingOriginal
    ? suggestion.original
    : suggestion.suggested || suggestion.original;

  const documentText = getEditorContent(editorViewRef);
  const originalIndex = documentText.indexOf(suggestion.original);

  if (originalIndex === -1) {
    return;
  }

  let finalText = displayText;
  const originalEndsWithPunct = /[.!?]$/.test(suggestion.original.trim());
  const displayEndsWithPunct = /[.!?]$/.test(finalText.trim());

  if (originalEndsWithPunct && displayEndsWithPunct) {
    finalText = finalText.trim().slice(0, -1);
  }

  const tr = editorViewRef.state.tr.replaceWith(
    originalIndex,
    originalIndex + suggestion.original.length,
    editorViewRef.state.schema.text(finalText),
  );

  editorViewRef.dispatch(tr);
  renderSuggestions();
}

export function closeSuggestion(id: string): void {
  removeSuggestion(id);
}

export function toggleExpandSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion) return;
  suggestion.isExpanded = !suggestion.isExpanded;
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
      <div class="suggestion-item ${s.isExpanded ? "suggestion-item--expanded" : ""}" data-id="${s.id}">
        <div class="suggestion-item__header">
          <button class="suggestion-item__toggle" data-action="toggle">${s.isExpanded ? "▼" : "▶"}</button>
          <span class="suggestion-item__title">${escapeHtml(s.sentenceTitle)}</span>
          <button class="suggestion-item__close" data-action="close">✕</button>
        </div>
        ${
          s.isExpanded
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
            <button class="suggestion-item__reject" data-action="reject">Reject</button>
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
  renderSuggestions();
}
