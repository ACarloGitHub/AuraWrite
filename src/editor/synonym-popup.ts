import type { EditorView } from "prosemirror-view";
import { getSynonyms } from "../ai-panel/ai-manager";
import { buildContextWithTools } from "../ai-panel/ai-manager";
import type { AIContext } from "../ai-panel/providers";
import { currentProject } from "./project-panel";

const MAX_SYNONYMS = 7;

let popupEl: HTMLElement | null = null;
let isPopupVisible = false;
let currentWord: { text: string; from: number; to: number } | null = null;
let isSynonymFetching = false;

export function showSynonymPopup(
  view: EditorView,
  selection?: { text: string; from: number; to: number } | null,
): void {
  currentWord = null;

  if (selection && selection.text && selection.text.trim()) {
    const trimmed = selection.text.trim();
    // Strip leading/trailing whitespace from the document range so that
    // replacing the word does not consume adjacent spaces.
    const leadingWs = selection.text.length - selection.text.trimStart().length;
    const trailingWs = selection.text.length - selection.text.trimEnd().length;
    const adjustedFrom = selection.from + leadingWs;
    const adjustedTo = selection.to - trailingWs;
    if (trimmed.split(/\s+/).length === 1) {
      currentWord = { text: trimmed, from: adjustedFrom, to: adjustedTo };
    } else {
      const firstWord = trimmed.split(/\s+/)[0];
      currentWord = { text: firstWord, from: adjustedFrom, to: adjustedFrom + firstWord.length };
    }
  }

  if (!currentWord) {
    const { from, to, empty } = view.state.selection;

    if (empty) {
      const $pos = view.state.selection.$head;
      const textBefore = $pos.parent.textContent;
      const offset = $pos.parentOffset;

      if (!textBefore) return;

      const wordBoundaryRegex = /[\s\u00A0.,;:!?'"(){}\-—–/\\]/;
      let start = offset;
      let end = offset;

      while (start > 0 && !wordBoundaryRegex.test(textBefore[start - 1])) {
        start--;
      }
      while (end < textBefore.length && !wordBoundaryRegex.test(textBefore[end])) {
        end++;
      }

      if (start === end) return;

      const wordText = textBefore.slice(start, end);
      if (!wordText.trim()) return;

      const docFrom = from - (offset - start);
      const docTo = from + (end - offset);

      currentWord = { text: wordText.trim(), from: docFrom, to: docTo };
    } else {
      const text = view.state.doc.textBetween(from, to);
      if (!text.trim()) return;

      const trimmed = text.trim();
      if (/\s/.test(trimmed)) {
        const firstWord = trimmed.split(/\s+/)[0];
        currentWord = { text: firstWord, from, to: from + text.indexOf(firstWord) + firstWord.length };
      } else {
        currentWord = { text: trimmed, from, to };
      }
    }
  }

  if (!currentWord || !currentWord.text) return;

  // Valida che le posizioni siano ancora valide nel documento corrente
  // (potrebbero essere stantie se la paginazione ha riorganizzato il contenuto)
  const docSize = view.state.doc.content.size;
  if (currentWord.from < 0 || currentWord.from > docSize || currentWord.to > docSize) return;

  let coords: { top: number; bottom: number; left: number; right: number };
  try {
    coords = view.coordsAtPos(currentWord.from);
  } catch {
    return; // posizione non valida nel DOM corrente
  }

  // Save reference BEFORE createPopup, which calls removeSynonymPopup()
  // internally and resets the module-level currentWord to null.
  const wordRef = currentWord;
  createPopup(view, wordRef.text);
  positionPopup(coords);
  // Restore so that replaceWordWithSynonym (called from click handlers) and
  // fetchSynonyms can still use the correct word/positions.
  currentWord = wordRef;
  fetchSynonyms(view, wordRef.text);
}

function createPopup(view: EditorView, word: string): void {
  removeSynonymPopup();

  popupEl = document.createElement("div");
  popupEl.className = "synonym-popup";
  popupEl.innerHTML = `
    <div class="synonym-popup__header">
      <span class="synonym-popup__title">Synonyms for "${escapeHtml(word)}"</span>
      <button class="synonym-popup__close" title="Close">&times;</button>
    </div>
    <div class="synonym-popup__body">
      <div class="synonym-popup__loading">
        <span class="synonym-popup__spinner"></span>
        Looking up synonyms...
      </div>
    </div>
  `;

  popupEl.querySelector(".synonym-popup__close")?.addEventListener("click", () => {
    removeSynonymPopup();
  });

  document.addEventListener("mousedown", handleOutsideClick);
  document.addEventListener("keydown", handleKeyDown);

  document.body.appendChild(popupEl);
  isPopupVisible = true;
}

function positionPopup(coords: { left: number; top: number; bottom: number }): void {
  if (!popupEl) return;

  const popupRect = popupEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = coords.left;
  let top = coords.bottom + 8;

  if (left + popupRect.width > viewportWidth - 16) {
    left = viewportWidth - popupRect.width - 16;
  }
  if (left < 16) {
    left = 16;
  }
  if (top + popupRect.height > viewportHeight - 16) {
    top = coords.top - popupRect.height - 8;
  }

  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;
}

async function fetchSynonyms(view: EditorView, word: string): Promise<void> {
  if (isSynonymFetching) return;
  isSynonymFetching = true;

  const prefs = JSON.parse(localStorage.getItem("aurawrite-preferences") || "{}");
  const context: AIContext = {
    documentTitle: document.title.replace(" - AuraWrite", ""),
    documentText: view.state.doc.textContent.slice(0, 2000),
    projectId: currentProject?.id || undefined,
    assistantName: prefs.aiAssistantName || undefined,
    userName: prefs.aiUserName || undefined,
    interfaceLanguage: prefs.aiInterfaceLanguage || "English",
    writingLanguage: prefs.aiWritingLanguage || "English",
  };

  const enrichedContext = context.projectId ? buildContextWithTools(context) : context;

  try {
    const synonyms = await getSynonyms(word, enrichedContext);

    if (!isPopupVisible || !popupEl) return;

    const body = popupEl.querySelector(".synonym-popup__body");
    if (!body) return;

    if (synonyms.length === 0) {
      body.innerHTML = `<div class="synonym-popup__empty">No synonyms found</div>`;
    } else {
      const limited = synonyms.slice(0, MAX_SYNONYMS);
      body.innerHTML = `
        <div class="synonym-popup__list">
          ${limited.map((s) => `<button class="synonym-popup__item" data-synonym="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}
        </div>
      `;

      body.querySelectorAll(".synonym-popup__item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const synonym = (btn as HTMLElement).dataset.synonym;
          if (synonym && currentWord) {
            replaceWordWithSynonym(view, synonym);
          }
          removeSynonymPopup();
        });
      });
    }
  } catch {
    if (isPopupVisible && popupEl) {
      const body = popupEl.querySelector(".synonym-popup__body");
      if (body) {
        body.innerHTML = `<div class="synonym-popup__error">Failed to load synonyms</div>`;
      }
    }
  } finally {
    isSynonymFetching = false;
  }
}

function replaceWordWithSynonym(view: EditorView, synonym: string): void {
  if (!currentWord) return;

  const { from, to } = currentWord;
  const schema = view.state.schema;
  const tr = view.state.tr.replaceWith(from, to, schema.text(synonym));
  view.dispatch(tr);
  view.focus();
}

function handleOutsideClick(e: Event): void {
  if (popupEl && !popupEl.contains(e.target as globalThis.Node)) {
    removeSynonymPopup();
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    removeSynonymPopup();
  }
}

export function removeSynonymPopup(): void {
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
  }
  isPopupVisible = false;
  currentWord = null;
  isSynonymFetching = false;

  document.removeEventListener("mousedown", handleOutsideClick);
  document.removeEventListener("keydown", handleKeyDown);
}

export function isSynonymPopupVisible(): boolean {
  return isPopupVisible;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}