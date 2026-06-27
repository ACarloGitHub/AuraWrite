import type { EditorView } from "prosemirror-view";
import { Decoration } from "prosemirror-view";
import { sendToAI, extractJson } from "./ai-manager";
import { notifyDocumentChange } from "./modification-hub";
import { currentProject, currentSection, currentDocument } from "../editor/project-panel";
import { resolveWritingStyleFragment } from "../templates/apply";
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
  isQueued: boolean;
  isFailed?: boolean;
  noChangeNeeded?: boolean;
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
    | "closed"
    | "failed";
  suggestion: string | null;
  reason: string | null;
}

let suggestions: SentenceSuggestion[] = [];
let slots: SentenceSlot[] = [];
let editorViewRef: EditorView | null = null;
let acceptedOriginals: Map<string, string> = new Map();
// Highest PM position (inclusive end) reached by any analysis. The analyzer
// never goes back above this watermark: sentences at a position strictly
// smaller than lastAnalyzedPos are never re-analyzed, even if the user edits
// the surrounding text. Reset to 0 when the editor switches to a new
// document (see clearSuggestions).
let lastAnalyzedPos: number = 0;
let isCurrentlyProcessing: boolean = false;

const DEBUG_LOG_MAX = 100;
const DEBUG_LOG: string[] = [];
const PREFERENCES_KEY_DEBUG = "aurawrite-preferences";

function isDebugEnabled(): boolean {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY_DEBUG);
    if (!saved) return false;
    const prefs = JSON.parse(saved);
    return Boolean(prefs.suggestionsDebug);
  } catch {
    return false;
  }
}

function setDebugEnabled(enabled: boolean): void {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY_DEBUG);
    const prefs = saved ? JSON.parse(saved) : {};
    prefs.suggestionsDebug = enabled;
    localStorage.setItem(PREFERENCES_KEY_DEBUG, JSON.stringify(prefs));
  } catch {
    // Ignore: localStorage may be disabled
  }
  if (!enabled) {
    DEBUG_LOG.length = 0;
  }
  updateDebugLog();
}

function log(message: string): void {
  if (!isDebugEnabled()) return;
  const time = new Date().toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const entry = `[${time}] ${message}`;
  DEBUG_LOG.push(entry);
  if (DEBUG_LOG.length > DEBUG_LOG_MAX) {
    DEBUG_LOG.splice(0, DEBUG_LOG.length - DEBUG_LOG_MAX);
  }
  console.log(entry);
  updateDebugLog();
}

function updateDebugLog(): void {
  if (!isDebugEnabled()) return;
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

/**
 * Map a textContent character index to a ProseMirror document position.
 *
 * doc.textContent concatenates all text nodes without gaps, but ProseMirror
 * positions account for node boundaries (paragraph, page, etc.). Each block
 * node adds offset that textContent does not. Without this mapping, positions
 * drift after every paragraph/page break — causing the suggestions panel to
 * "eat" characters when replacing text.
 */
function mapTextContentIndexToProseMirrorPos(
  view: EditorView,
  textIndex: number,
): number {
  let charCount = 0;
  let result = -1;
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (result !== -1) return false;
    if (node.isText && node.text) {
      const nextCount = charCount + node.text.length;
      if (textIndex < nextCount) {
        result = pos + (textIndex - charCount);
        return false;
      }
      charCount = nextCount;
    }
    return true;
  });
  return result;
}

const PREFERENCES_KEY = "aurawrite-preferences";
const DEFAULT_INTERVAL = 30;

function getPreferences(): {
  aiSuggestionsInterval: number;
  suggestionsPrompt: string;
  aiInterfaceLanguage: string;
} {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    const prefs = JSON.parse(saved);
    return {
      aiSuggestionsInterval: prefs.aiSuggestionsInterval || DEFAULT_INTERVAL,
      suggestionsPrompt: prefs.suggestionsPrompt || "",
      aiInterfaceLanguage: prefs.aiInterfaceLanguage || "English",
    };
  }
  return { aiSuggestionsInterval: DEFAULT_INTERVAL, suggestionsPrompt: "", aiInterfaceLanguage: "English" };
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
}

const ABBREVIATIONS = new Set<string>([
  // Italian titles / honorifics
  "sig", "sig.ra", "sig.na", "sign", "sign.ra", "sign.na",
  "dott", "dott.ssa", "dr", "dr.ssa", "prof", "prof.ssa",
  "ing", "geom", "rag", "arch", "avv", "not", "per", "spett", "gent", "cav", "march",
  // Ordinals / references
  "n", "no", "nr", "num", "pag", "pp", "art", "artt", "c", "cc",
  "vol", "cap", "fig", "tav", "par",
  // Misc Italian
  "ecc", "all", "f.lli", "flli", "p.i", "piva", "c.f", "cf",
  "s.p.a", "spa", "s.r.l", "srl", "s.n.c", "snc", "p.f", "s.a.s",
  // English
  "mr", "mister", "mrs", "miss", "ms", "st", "ave", "jr", "sr",
  "ph.d", "phd", "b.a", "m.a", "ba", "ma",
  "etc", "e.g", "eg", "i.e", "ie", "vs", "approx", "inc", "co", "ltd",
  "u.s", "u.k", "u.s.a", "d.c", "u.n",
]);

/** Extract the trailing token (letters, digits and dots) ending at endPos. */
function tokenBefore(text: string, endPos: number): string {
  let start = endPos;
  while (start > 0 && /[\p{L}\p{N}.]/u.test(text[start - 1])) start--;
  return text.slice(start, endPos);
}

/** Whether a token immediately preceding a period is an abbreviation. */
function isAbbreviationToken(token: string): boolean {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  // Strip trailing dots (handles ellipsis after an abbreviation: "Sig...").
  const core = lower.replace(/\.+$/, "");
  if (core && ABBREVIATIONS.has(core)) return true;
  // Single uppercase letter (initials: "J.", "U.S.", "D.C.").
  return /^[A-ZÀ-Ý]$/.test(token);
}

/**
 * Split text into sentences, treating a period as a boundary ONLY when the
 * preceding token is not a known abbreviation (Sig., Dott., Sig.ra, etc.).
 * "!" and "?" are always boundaries; ":" too (kept from the original logic).
 */
function tokenizeSentences(
  text: string,
): { text: string; rawLength: number; index: number }[] {
  const results: { text: string; rawLength: number; index: number }[] = [];
  let sentenceStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== ":") continue;
    if (ch === ".") {
      if (isAbbreviationToken(tokenBefore(text, i))) continue;
    }
    let end = i + 1;
    while (end < text.length && /[.!?:]/.test(text[end])) end++;
    while (end < text.length && /\s/.test(text[end])) end++;
    const rawSentence = text.slice(sentenceStart, end);
    const sentence = rawSentence.replace(/\s+/g, " ").trim();
    if (sentence.length >= 10) {
      results.push({
        text: sentence,
        rawLength: rawSentence.length,
        index: sentenceStart,
      });
    }
    sentenceStart = end;
  }
  return results;
}

function setupDotTrigger(view: EditorView): void {
  view.dom.addEventListener("keydown", (e: KeyboardEvent) => {
    if (![".", "!", "?", ":"].includes(e.key)) return;

    const suggestionsPanel = document.getElementById("suggestions-panel");
    if (!suggestionsPanel || suggestionsPanel.classList.contains("hidden"))
      return;

    // Do not trigger analysis when the period completes an abbreviation
    // ("Sig.", "Sig.ra", "Dott.", etc.): it is not a sentence boundary.
    if (e.key === ".") {
      const { from } = view.state.selection;
      const before = view.state.doc.textBetween(
        Math.max(0, from - 12),
        from,
        "\n",
        "\n",
      );
      if (isAbbreviationToken(tokenBefore(before, before.length))) return;
    }

    setTimeout(() => {
      const doc = view.state.doc;
      const fullText = doc.textContent;

      const sentences = tokenizeSentences(fullText);

      // Clamp the watermark to the current document size so a switch to a
      // smaller document (or a re-load that resets positions) does not
      // suppress legitimate analysis.
      const docSize = doc.content.size;
      if (lastAnalyzedPos > docSize) lastAnalyzedPos = 0;

      for (const { text: sentence, rawLength, index: sentenceIndex } of sentences) {
        const normalized = sentence.toLowerCase();

        const existingSlot = slots.find(
          (s) => s.text.toLowerCase() === normalized,
        );
        if (existingSlot) continue;

        const existingBox = suggestions.find(
          (s) => s.original.toLowerCase() === normalized,
        );
        if (existingBox) continue;

        const pmFrom = mapTextContentIndexToProseMirrorPos(view, sentenceIndex);
        if (pmFrom === -1) {
          log(
            `SLOT: Could not find position for "${sentence.slice(0, 30)}..."`,
          );
          continue;
        }

        // Monotonic watermark: once a sentence has been analyzed (or reached
        // by the loop), the analyzer never goes back above its start. The
        // "x" close action is now folded into this mechanism: dismissing a
        // suggestion just leaves the slot below the watermark, so it is
        // never revisited.
        if (pmFrom < lastAnalyzedPos) continue;

        const slot: SentenceSlot = {
          id: generateId(),
          text: sentence,
          state: "pending",
          suggestion: null,
          reason: null,
        };

        createDecorationForSlot(slot, pmFrom, pmFrom + rawLength);

        slots.push(slot);
        // Raise the watermark to the end of this sentence so that nothing
        // earlier than it is ever considered again.
        if (pmFrom + rawLength > lastAnalyzedPos) {
          lastAnalyzedPos = pmFrom + rawLength;
        }
        log(
          `SLOT: Created slot ${slot.id} at PM pos ${pmFrom}-${pmFrom + rawLength} for "${sentence.slice(0, 30)}..."`,
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
      isQueued: slot.state === "discarded",
      isFailed: slot.state === "failed",
    };

    newSuggestions.push(suggestion);
  }

  if (newSuggestions.length > 0) {
    suggestions = [...suggestions, ...newSuggestions];
    renderSuggestions();
  }
}

export function retrySuggestion(id: string): void {
  log(`RETRY: Retrying slot ${id}`);
  const slot = slots.find((s) => s.id === id);
  const suggestion = suggestions.find((s) => s.id === id);
  if (!slot) return;

  slot.state = "pending";
  if (suggestion) {
    suggestion.isFailed = false;
    suggestion.noChangeNeeded = false;
    suggestion.isProcessing = isCurrentlyProcessing ? false : true;
    suggestion.isQueued = isCurrentlyProcessing;
  }
  renderSuggestions();
  if (isCurrentlyProcessing) {
    log(`RETRY: Queued slot ${id} — will be picked up after current request finishes`);
  } else {
    processNextSlot();
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
    updateAnalysisStatus("Analysis complete");
    return;
  }

  const slot = slots[slotIndex];
  const wasDiscarded = slot.state === "discarded";
  slot.state = "processing";
  isCurrentlyProcessing = true;

  const suggestionBox = suggestions.find((b) => b.id === slot.id);
  if (suggestionBox) {
    suggestionBox.isProcessing = true;
    suggestionBox.isQueued = false;
    suggestionBox.isFailed = false;
  }

  const queuedCount = slots.filter(
    (s) => s.state === "pending" || s.state === "discarded",
  ).length;
  const totalActive = slots.filter(
    (s) =>
      s.state === "processing" ||
      s.state === "pending" ||
      s.state === "discarded",
  ).length;
  const currentIdx = totalActive - queuedCount;

  updateAnalysisStatus(
    wasDiscarded
      ? `Re-analyzing ${currentIdx}/${totalActive}${queuedCount > 0 ? ` • ${queuedCount} queued` : ""}`
      : `Analyzing ${currentIdx}/${totalActive}${queuedCount > 0 ? ` • ${queuedCount} queued` : ""}`,
  );
  renderSuggestions();

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
${prefs.aiInterfaceLanguage ? `\nIMPORTANT: Write the "reason" field in ${prefs.aiInterfaceLanguage}. The suggested text must stay in the original document language.` : ""}

SINGLE SENTENCE TO ANALYZE:
"${slot.text}"

Remember: DO NOT output any thinking, reasoning, explanation, or <thought>/<thinking> tags. You must respond IMMEDIATELY and ONLY with valid JSON in this exact format:
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
      writingStyleFragment: currentProject && currentSection
        ? resolveWritingStyleFragment(currentSection, currentProject, currentDocument)
        : undefined,
    });
    log(
      `AI: Response received: ${response.error ? "ERROR - " + response.error : "OK"}`,
    );

    if (response.error) {
      slot.state = slot.suggestion ? "suggested" : "failed";
      const existingBox = suggestions.find((b) => b.id === slot.id);
      if (existingBox) {
        existingBox.isFailed = true;
        existingBox.isProcessing = false;
      }
      updateAnalysisStatus(`Error: ${response.error}`);
    } else {
      processAIResponse(response.content, slot);
    }
  } catch (error) {
    log(`AI EXCEPTION: ${error}`);
    slot.state = slot.suggestion ? "suggested" : "failed";
    const existingBox = suggestions.find((b) => b.id === slot.id);
    if (existingBox) {
      existingBox.isFailed = true;
      existingBox.isProcessing = false;
    }
    updateAnalysisStatus(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  isCurrentlyProcessing = false;

  const processingBox = suggestions.find((b) => b.isProcessing);
  if (processingBox) {
    processingBox.isProcessing = false;
    renderSuggestions();
    log(`SAFETY: Cleared stuck isProcessing on box ${processingBox.id}`);
  }

  setTimeout(() => processNextSlot(), 100);
}

function processAIResponse(content: string, slot: SentenceSlot): void {
  try {
    const jsonStr = extractJson(content);
    if (!jsonStr) {
      log(`PARSE ERROR: No JSON found in content: "${truncateText(content, 100)}"`);
      slot.state = slot.suggestion ? "suggested" : "failed";
      const existingBox = suggestions.find((b) => b.id === slot.id);
      if (existingBox) {
        existingBox.isFailed = true;
        existingBox.isProcessing = false;
        renderSuggestions();
      }
      return;
    }

    log(`PARSE: Extracted JSON: ${jsonStr}`);
    const response: AISuggestionResponse = JSON.parse(jsonStr);

    if (response.context_understood) {
      // context_understood is now handled by the AI status indicator only
    }

    let suggestionFound = false;

    if (response.suggestions && Array.isArray(response.suggestions)) {
      const newSuggestion = response.suggestions.find(
        (s) => s.suggested && s.original,
      );

      if (newSuggestion) {
        slot.suggestion = newSuggestion.suggested;
        slot.reason = newSuggestion.reason || null;
        slot.state = "suggested";
        suggestionFound = true;

        const existingBox = suggestions.find((b) => b.id === slot.id);
        if (existingBox) {
          existingBox.suggested = slot.suggestion;
          existingBox.reason = slot.reason;
          existingBox.sentenceTitle =
            newSuggestion.sentence_title || truncateText(slot.text, 30);
          existingBox.isFailed = false;
          renderSuggestions();
        }

        log(`SUGGESTION: Got suggestion for slot ${slot.id}`);
      }
    }

    if (!suggestionFound) {
      log(`SUGGESTION: No valid suggestion found in response`);
      slot.state = "suggested";
      const existingBox = suggestions.find((b) => b.id === slot.id);
      if (existingBox) {
        if (slot.suggestion) {
          existingBox.isFailed = false;
          existingBox.isProcessing = false;
        } else {
          existingBox.noChangeNeeded = true;
          existingBox.isFailed = false;
          existingBox.isProcessing = false;
        }
        renderSuggestions();
      }
    }

    if (slots.every((s) => s.state === "suggested" || s.state === "accepted")) {
      updateAnalysisStatus("Analysis complete");
    }
  } catch (error) {
    log(`PARSE EXCEPTION: ${error}`);
    slot.state = slot.suggestion ? "suggested" : "failed";
    const existingBox = suggestions.find((b) => b.id === slot.id);
    if (existingBox) {
      existingBox.isFailed = true;
      existingBox.isProcessing = false;
      renderSuggestions();
    }
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
    suggestion.isQueued = true;
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
  if (slot) {
    slot.state = "closed";
  }

  if (editorViewRef) {
    const currentPos = getSlotPositionFromDecoration(id);
    if (currentPos) {
      // Dismissal just removes the suggestion box and its marker decoration.
      // Re-analysis is prevented by the lastAnalyzedPos watermark, which is
      // never moved backward: the slot stays below the watermark for the
      // rest of the document's lifetime, so it cannot be revisited.
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

  const processingCount = slots.filter(
    (s) => s.state === "processing",
  ).length;
  const queuedCount = slots.filter(
    (s) => s.state === "pending" || s.state === "discarded",
  ).length;

  let statusText = "";
  if (processingCount > 0 && queuedCount > 0) {
    statusText = `Processing… ${queuedCount} more queued`;
  } else if (processingCount > 0) {
    statusText = "Processing…";
  } else if (queuedCount > 0) {
    statusText = `${queuedCount} queued`;
  } else {
    statusText = "Analysis complete";
  }

  const statusHtml = `
    <div class="suggestions-status">${escapeHtml(statusText)}</div>
    ${suggestions
      .map(
        (s) => `
      <div class="suggestion-item ${s.isExpanded ? "suggestion-item--expanded" : ""} ${s.isAccepted ? "suggestion-item--accepted" : ""} ${s.isProcessing ? "suggestion-item--processing" : ""} ${s.isQueued ? "suggestion-item--queued" : ""} ${s.isFailed ? "suggestion-item--failed" : ""} ${s.noChangeNeeded ? "suggestion-item--no-change" : ""}" data-id="${s.id}">
        <div class="suggestion-item__header">
          <button class="suggestion-item__toggle" data-action="toggle">${s.isExpanded ? "▼" : "▶"}</button>
          <button class="suggestion-item__collapse" data-action="collapse">${s.isCollapsed ? "»" : "«"}</button>
          <span class="suggestion-item__title">${escapeHtml(s.sentenceTitle)}</span>
          ${s.isAccepted ? "<span class='suggestion-item__accepted-badge'>✓</span>" : ""}
          <button class="suggestion-item__debug" data-action="debug" title="Toggle debug log">🐛</button>
          <button class="suggestion-item__close" data-action="close">✕</button>
        </div>
        ${
          s.isProcessing
            ? `
        <div class="suggestion-item__body suggestion-item__body--processing">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__spinner"></span>
            <span class="suggestion-item__processing-text">Analyzing…</span>
          </div>
        </div>
        `
            : s.isFailed
              ? `
        <div class="suggestion-item__body suggestion-item__body--failed">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__error-dot">✕</span>
            <span class="suggestion-item__error-text">Analysis failed.</span>
            <button class="suggestion-item__retry" data-action="retry">Retry</button>
          </div>
        </div>
        `
              : s.noChangeNeeded
                ? `
        <div class="suggestion-item__body suggestion-item__body--no-change">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__no-change-dot">✓</span>
            <span class="suggestion-item__no-change-text">No changes suggested.</span>
            <button class="suggestion-item__retry" data-action="reanalyze">Re-analyze</button>
          </div>
        </div>
        `
                : s.isQueued
                  ? `
        <div class="suggestion-item__body suggestion-item__body--queued">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__queued-dot"></span>
            <span class="suggestion-item__queued-text">Queued for re-analysis…</span>
          </div>
        </div>
        `
                  : !s.suggested && !s.isAccepted
                    ? `
        <div class="suggestion-item__body suggestion-item__body--pending">
          <div class="suggestion-item__processing-indicator">
            <span class="suggestion-item__queued-dot"></span>
            <span class="suggestion-item__queued-text">Waiting for analysis…</span>
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
        case "retry":
          retrySuggestion(itemId);
          break;
        case "reanalyze":
          retrySuggestion(itemId);
          break;
        case "debug":
          toggleDebugFromPanel();
          break;
      }
    });
  });
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 9);
}

function toggleDebugFromPanel(): void {
  const next = !isDebugEnabled();
  setDebugEnabled(next);
  console.log(`[Suggestions] Debug log ${next ? "enabled" : "disabled"}`);
  renderSuggestions();
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
  // Reset the monotonic watermark so a fresh document starts analysis from
  // the beginning. Without this, switching to a smaller document would keep
  // lastAnalyzedPos at the previous document's size and skip everything.
  lastAnalyzedPos = 0;
  isCurrentlyProcessing = false;
  renderSuggestions();
}

export function resetAnalysisState(): void {
  lastAnalyzedPos = 0;
}
