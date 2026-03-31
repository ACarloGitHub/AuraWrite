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
  isAccepted: boolean;
  isCollapsed: boolean;
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
let analyzedSentences: Set<string> = new Set();
let acceptedOriginals: Map<string, string> = new Map();
let finalizedSentences: Set<string> = new Set();

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
  isAnalyzing = false;
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
      const sentences: string[] = [];
      let match;

      while ((match = sentenceRegex.exec(fullText)) !== null) {
        const sentence = match[0].trim();
        if (sentence.length >= 10) {
          sentences.push(sentence);
        }
      }

      for (const sentence of sentences) {
        const normalized = sentence.toLowerCase();
        if (analyzedSentences.has(normalized)) continue;
        if (finalizedSentences.has(normalized)) continue;
        analyzedSentences.add(normalized);
        analyzeSentence(sentence);
      }
    }, 10);
  });
}

async function analyzeSentence(
  sentence: string,
  previousSuggestion?: string | null,
): Promise<void> {
  if (!editorViewRef) return;

  const prefs = getPreferences();
  const promptText = prefs.suggestionsPrompt || DEFAULT_SUGGESTIONS_PROMPT;

  isAnalyzing = true;
  updateAnalysisStatus(`Analyzing: "${sentence.slice(0, 30)}..."`);

  let retryInstruction = "";
  if (previousSuggestion) {
    retryInstruction = `\nIMPORTANT: Provide a DIFFERENT suggestion from: "${previousSuggestion}"`;
  }

  const prompt = `${promptText}${retryInstruction}

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
      processAIResponse(response.content, sentence);
    }
  } catch (error) {
    updateAnalysisStatus(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  isAnalyzing = false;
}

function processAIResponse(content: string, originalSentence: string): void {
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
          original: originalSentence,
          suggested: s.suggested,
          reason: s.reason || null,
          timestamp: Date.now(),
          isExpanded: true,
          showingOriginal: false,
          isAccepted: false,
          isCollapsed: false,
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

  acceptedOriginals.set(id, suggestion.original);
  finalizedSentences.add(suggestion.original.toLowerCase());

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

  suggestion.isAccepted = true;
  suggestion.isExpanded = false;
  renderSuggestions();
}

export function rejectSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion || !editorViewRef) return;

  const previousSuggestion = suggestion.suggested;
  suggestion.isExpanded = true;
  renderSuggestions();

  analyzeSentence(suggestion.original, previousSuggestion);
}

export function switchSuggestion(id: string): void {
  const suggestion = suggestions.find((s) => s.id === id);
  if (!suggestion || !editorViewRef) return;

  const savedOriginal = acceptedOriginals.get(id);
  const currentDocText = getEditorContent(editorViewRef);

  let targetOriginal = suggestion.original;
  let targetSuggested = suggestion.suggested || suggestion.original;

  if (savedOriginal) {
    const currentInDoc = currentDocText.includes(suggestion.suggested || "");
    if (currentInDoc) {
      targetSuggested = suggestion.original;
      targetOriginal = suggestion.suggested || suggestion.original;
    } else {
      targetSuggested = suggestion.suggested || suggestion.original;
      targetOriginal = savedOriginal;
    }
  }

  const newShowingOriginal = !suggestion.showingOriginal;
  suggestion.showingOriginal = newShowingOriginal;

  const displayText = newShowingOriginal ? targetOriginal : targetSuggested;

  const displayIndex = currentDocText.indexOf(
    newShowingOriginal ? targetOriginal : targetSuggested,
  );

  if (displayIndex === -1) {
    return;
  }

  let finalText = displayText;
  const originalEndsWithPunct = /[.!?]$/.test(targetOriginal.trim());
  const displayEndsWithPunct = /[.!?]$/.test(finalText.trim());

  if (originalEndsWithPunct && displayEndsWithPunct) {
    finalText = finalText.trim().slice(0, -1);
  }

  const tr = editorViewRef.state.tr.replaceWith(
    displayIndex,
    displayIndex + displayText.length,
    editorViewRef.state.schema.text(finalText),
  );

  editorViewRef.dispatch(tr);
  renderSuggestions();
}

export function closeSuggestion(id: string): void {
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
      <div class="suggestion-item ${s.isExpanded ? "suggestion-item--expanded" : ""} ${s.isAccepted ? "suggestion-item--accepted" : ""}" data-id="${s.id}">
        <div class="suggestion-item__header">
          <button class="suggestion-item__toggle" data-action="toggle">${s.isExpanded ? "▼" : "▶"}</button>
          <button class="suggestion-item__collapse" data-action="collapse">${s.isCollapsed ? "»" : "«"}</button>
          <span class="suggestion-item__title">${escapeHtml(s.sentenceTitle)}</span>
          ${s.isAccepted ? "<span class='suggestion-item__accepted-badge'>✓</span>" : ""}
          <button class="suggestion-item__close" data-action="close">✕</button>
        </div>
        ${
          s.isCollapsed
            ? `
        <div class="suggestion-item__actions">
          <button class="suggestion-item__accept" data-action="accept">Accept</button>
          <button class="suggestion-item__reject" data-action="reject">Reject</button>
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
  renderSuggestions();
}
