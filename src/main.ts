import { createEditor } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel } from "./ai-panel/chat";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { initProjectPanel, triggerSaveStatusCheck } from "./editor/project-panel";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

const THEME_KEY = "aurawrite-theme";
const PREFERENCES_KEY = "aurawrite-preferences";
const ZOOM_KEY = "aurawrite-zoom";

type ThemeMode = "light" | "dark" | "custom";

interface Preferences {
  toolbarDisplay: "icon" | "text" | "both";
  theme: ThemeMode;
  customBg: string;
  customToolbar: string;
  customPaper: string;
  customTextEditor: string;
  customTextButtons: string;
  incrementalEnabled: boolean;
  incrementalMax: number;
  aiSuggestionsInterval: number;
  aiContextInterval: number;
  suggestionsPrompt: string;
  aiAssistantPrompt: string;
  deselectOnDocumentClick: boolean;
}

const defaultSuggestionsPrompt = `You are an AI writing assistant analyzing a document for improvements.

First, read the initial sentences to understand the tone, style, and context.
Then analyze each sentence individually.

For each sentence that could be improved, provide:
1. A title (first 5 words + "...")
2. The suggested improvement (if needed)

Focus on:
- Clarity and readability
- Sentence structure
- Word choice
- Grammar (if issues found)

Respond in JSON format:
{
  "context_understood": "brief summary of tone/style",
  "suggestions": [
    {
      "sentence_title": "First 5 words...",
      "original": "full sentence",
      "suggested": "improved version or null if no change needed",
      "reason": "why this improves the text (if suggested)"
    }
  ]
}`;

const defaultAIAssistantPrompt = `You are an AI writing assistant helping with a document.

The user can ask you questions about the document or request modifications.
You have access to the full document context.

When the user asks for text modifications:
- Propose the change clearly
- Explain why it improves the text

When you suggest accepting a modification:
- Say "Accept?" and wait for confirmation
- After acceptance, the change will be applied

You can read and analyze the document at any time.`;

const defaultPreferences: Preferences = {
  toolbarDisplay: "both",
  theme: "light",
  customBg: "#f0f0f0",
  customToolbar: "#ffffff",
  customPaper: "#ffffff",
  customTextEditor: "#222222",
  customTextButtons: "#222222",
  incrementalEnabled: false,
  incrementalMax: 10,
  aiSuggestionsInterval: 30,
  aiContextInterval: 30,
  suggestionsPrompt: defaultSuggestionsPrompt,
  aiAssistantPrompt: defaultAIAssistantPrompt,
  deselectOnDocumentClick: true,
};

let currentZoom = 100;

function getPreferences(): Preferences {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    return { ...defaultPreferences, ...JSON.parse(saved) };
  }
  return defaultPreferences;
}

function savePreferences(prefs: Preferences): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  applyPreferences(prefs);
}

function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.removeAttribute("data-theme");

  if (prefs.theme === "light") {
    root.style.removeProperty("--custom-bg");
    root.style.removeProperty("--custom-toolbar");
    root.style.removeProperty("--custom-paper");
    root.style.removeProperty("--custom-text-editor");
    root.style.removeProperty("--custom-text-buttons");
  } else if (prefs.theme === "dark") {
    root.setAttribute("data-theme", "dark");
    root.style.removeProperty("--custom-bg");
    root.style.removeProperty("--custom-toolbar");
    root.style.removeProperty("--custom-paper");
    root.style.removeProperty("--custom-text-editor");
    root.style.removeProperty("--custom-text-buttons");
  } else if (prefs.theme === "custom") {
    root.setAttribute("data-theme", "custom");
    root.style.setProperty("--custom-bg", prefs.customBg);
    root.style.setProperty("--custom-toolbar", prefs.customToolbar);
    root.style.setProperty("--custom-paper", prefs.customPaper);
    root.style.setProperty("--custom-text-editor", prefs.customTextEditor);
    root.style.setProperty("--custom-text-buttons", prefs.customTextButtons);
  }

  const toolbar = document.querySelector(".toolbar");
  if (toolbar) {
    toolbar.classList.remove(
      "toolbar-display-icon",
      "toolbar-display-text",
      "toolbar-display-both",
    );
    toolbar.classList.add(`toolbar-display-${prefs.toolbarDisplay}`);
  }

  localStorage.setItem(THEME_KEY, prefs.theme);
}

function initTheme(): void {
  const prefs = getPreferences();
  applyPreferences(prefs);
  updateThemeIcon(prefs.theme);
}

function toggleTheme(): void {
  const prefs = getPreferences();
  const themes: ThemeMode[] = ["light", "dark", "custom"];
  const currentIndex = themes.indexOf(prefs.theme);
  const newTheme = themes[(currentIndex + 1) % themes.length];

  prefs.theme = newTheme;
  savePreferences(prefs);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme: ThemeMode): void {
  const btn = document.getElementById("btn-theme");
  if (btn) {
    if (theme === "light") {
      btn.textContent = "☀️";
    } else if (theme === "dark") {
      btn.textContent = "🌙";
    } else {
      btn.textContent = "🎨";
    }
  }
}

function initZoom(): void {
  const savedZoom = localStorage.getItem(ZOOM_KEY);
  if (savedZoom) {
    currentZoom = parseInt(savedZoom, 10);
  }
  applyZoom();
}

function applyZoom(): void {
  const editor = document.querySelector(".ProseMirror") as HTMLElement;
  if (editor) {
    editor.style.fontSize = `${18 * (currentZoom / 100)}px`;
  }
  const zoomLevelEl = document.getElementById("zoom-level");
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${currentZoom}%`;
  }
}

function setZoom(delta: number): void {
  currentZoom = Math.max(50, Math.min(200, currentZoom + delta));
  localStorage.setItem(ZOOM_KEY, currentZoom.toString());
  applyZoom();
}

function updateCustomColorsVisibility(): void {
  const prefs = getPreferences();
  const customGroup = document.getElementById("custom-colors-group");
  if (customGroup) {
    if (prefs.theme === "custom") {
      customGroup.classList.remove("hidden");
    } else {
      customGroup.classList.add("hidden");
    }
  }
}

function openPreferencesModal(): void {
  const modal = document.getElementById("preferences-modal");
  const prefs = getPreferences();

  (document.getElementById("pref-toolbar-display") as HTMLSelectElement).value =
    prefs.toolbarDisplay;
  (document.getElementById("pref-theme") as HTMLSelectElement).value =
    prefs.theme;
  (document.getElementById("pref-custom-bg") as HTMLInputElement).value =
    prefs.customBg;
  (document.getElementById("pref-custom-toolbar") as HTMLInputElement).value =
    prefs.customToolbar;
  (document.getElementById("pref-custom-paper") as HTMLInputElement).value =
    prefs.customPaper;
  (
    document.getElementById("pref-custom-text-editor") as HTMLInputElement
  ).value = prefs.customTextEditor;
  (
    document.getElementById("pref-custom-text-buttons") as HTMLInputElement
  ).value = prefs.customTextButtons;
  (
    document.getElementById("pref-incremental-enabled") as HTMLInputElement
  ).checked = prefs.incrementalEnabled;
  (document.getElementById("pref-incremental-max") as HTMLInputElement).value =
    prefs.incrementalMax.toString();
  (
    document.getElementById("pref-ai-suggestions-interval") as HTMLInputElement
  ).value = prefs.aiSuggestionsInterval.toString();
  (
    document.getElementById("pref-ai-context-interval") as HTMLInputElement
  ).value = prefs.aiContextInterval.toString();
  (
    document.getElementById("pref-suggestions-prompt") as HTMLTextAreaElement
  ).value = prefs.suggestionsPrompt;
  (
    document.getElementById("pref-ai-assistant-prompt") as HTMLTextAreaElement
  ).value = prefs.aiAssistantPrompt;
  (
    document.getElementById("pref-deselect-on-click") as HTMLInputElement
  ).checked = prefs.deselectOnDocumentClick;

  updateCustomColorsVisibility();

  if (modal) modal.classList.remove("hidden");
}

function closePreferencesModal(): void {
  const modal = document.getElementById("preferences-modal");
  if (modal) modal.classList.add("hidden");
}

function savePreferencesFromModal(): void {
  const prefs: Preferences = {
    toolbarDisplay: (
      document.getElementById("pref-toolbar-display") as HTMLSelectElement
    ).value as Preferences["toolbarDisplay"],
    theme: (document.getElementById("pref-theme") as HTMLSelectElement)
      .value as ThemeMode,
    customBg: (document.getElementById("pref-custom-bg") as HTMLInputElement)
      .value,
    customToolbar: (
      document.getElementById("pref-custom-toolbar") as HTMLInputElement
    ).value,
    customPaper: (
      document.getElementById("pref-custom-paper") as HTMLInputElement
    ).value,
    customTextEditor: (
      document.getElementById("pref-custom-text-editor") as HTMLInputElement
    ).value,
    customTextButtons: (
      document.getElementById("pref-custom-text-buttons") as HTMLInputElement
    ).value,
    incrementalEnabled: (
      document.getElementById("pref-incremental-enabled") as HTMLInputElement
    ).checked,
    incrementalMax: parseInt(
      (document.getElementById("pref-incremental-max") as HTMLInputElement)
        .value,
      10,
    ),
    aiSuggestionsInterval: parseInt(
      (
        document.getElementById(
          "pref-ai-suggestions-interval",
        ) as HTMLInputElement
      ).value,
      10,
    ),
    aiContextInterval: parseInt(
      (document.getElementById("pref-ai-context-interval") as HTMLInputElement)
        .value,
      10,
    ),
    suggestionsPrompt: (
      document.getElementById("pref-suggestions-prompt") as HTMLTextAreaElement
    ).value,
    aiAssistantPrompt: (
      document.getElementById("pref-ai-assistant-prompt") as HTMLTextAreaElement
    ).value,
    deselectOnDocumentClick: (
      document.getElementById("pref-deselect-on-click") as HTMLInputElement
    ).checked,
  };

  savePreferences(prefs);
  updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initZoom();

  const prefs = getPreferences();
  applyPreferences(prefs);

  const editorElement = document.getElementById("editor");
  if (!editorElement) {
    console.error("Editor element not found");
    return;
  }

  const editorView = createEditor(editorElement);
  let isLoadingDocument = false;

  // Esponi flag globale per toolbar.ts
  (window as any).__aurawrite_loading = false;
  function setLoading(val: boolean) {
    isLoadingDocument = val;
    (window as any).__aurawrite_loading = val;
  }

  // Listen for clear editor events
  window.addEventListener("aurawrite:clear-editor", () => {
    setLoading(true);
    const tr = editorView.state.tr;
    tr.delete(0, tr.doc.content.size);
    editorView.dispatch(tr);
    console.log("Editor cleared");
    setTimeout(() => setLoading(false), 50);
  });

  // Initialize project panel
  initProjectPanel({
    onDocumentSelect: (doc) => {
      console.log("Document selected:", doc.title);
      setLoading(true);
      try {
        if (doc.content_json && doc.content_json.trim() !== "") {
          const content = JSON.parse(doc.content_json);
          const newDoc = editorView.state.schema.nodeFromJSON(content);
          const newState = EditorState.create({
            schema: editorView.state.schema,
            doc: newDoc,
            plugins: editorView.state.plugins,
          });
          editorView.updateState(newState);
          console.log("Loaded document content");
        } else {
          // Document is empty — clear the editor
          const tr = editorView.state.tr;
          tr.delete(0, tr.doc.content.size);
          editorView.dispatch(tr);
          console.log("Loaded empty document");
        }
      } catch (e) {
        console.error("Failed to parse document content:", e);
        // Fallback: clear editor on parse error
        const tr = editorView.state.tr;
        tr.delete(0, tr.doc.content.size);
        editorView.dispatch(tr);
      }
      setTimeout(() => setLoading(false), 50);
    },
    onProjectChange: (project) => {
      console.log("Project changed:", project?.name || "none");
    },
    getEditorContent: () => {
      return JSON.stringify(editorView.state.doc.toJSON());
    },
  });

  setupAIPanel(editorView);
  setupSuggestionsPanel(editorView);

  const btnTheme = document.getElementById("btn-theme");
  btnTheme?.addEventListener("click", toggleTheme);

  const btnPreferences = document.getElementById("btn-preferences");
  btnPreferences?.addEventListener("click", openPreferencesModal);

  const preferencesClose = document.getElementById("preferences-close");
  preferencesClose?.addEventListener("click", closePreferencesModal);

  const modalOverlay = document.querySelector(".modal-overlay");
  modalOverlay?.addEventListener("click", closePreferencesModal);

  document.getElementById("pref-theme")?.addEventListener("change", () => {
    updateCustomColorsVisibility();
  });

  document
    .querySelectorAll(
      "#pref-toolbar-display, #pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-deselect-on-click",
    )
    .forEach((el) => {
      el.addEventListener("change", savePreferencesFromModal);
      el.addEventListener("input", savePreferencesFromModal);
    });

  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  btnZoomIn?.addEventListener("click", () => setZoom(10));
  btnZoomOut?.addEventListener("click", () => setZoom(-10));

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "=") {
      e.preventDefault();
      setZoom(10);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      setZoom(-10);
    }
  };
  document.addEventListener("keydown", handleKeyDown);

  // Expose test functions globally for development
  (window as any).auraTest = {
    checkOllama: () => invoke('embedding_check_ollama'),
    generateEmbedding: (text: string, isQuery = false) => 
      invoke('embedding_generate', { text, isQuery }),
    saveEmbedding: (projectId: string, documentId: string, contentText: string) =>
      invoke('embedding_save_document', { projectId, documentId, contentText, chunkSize: 100, chunkOverlap: 20 }),
    searchSimilar: async (projectId: string, query: string, limit = 5) => {
      const queryVector = await invoke('embedding_generate', { text: query, isQuery: true });
      return invoke('embedding_search_documents', { projectId, queryVector, limit });
    },
    // Espone i dati correnti per debug
    getCurrentState: () => ({
      project: (window as any).auraProject,
      section: (window as any).auraSection, 
      document: (window as any).auraDocument
    })
  };
});

function updateWordCount(view: any): void {
  const text = view.state.doc.textContent;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  const wordCountEl = document.getElementById("word-count");
  const charCountEl = document.getElementById("char-count");

  if (wordCountEl) wordCountEl.textContent = `Words: ${words}`;
  if (charCountEl) charCountEl.textContent = `Characters: ${chars}`;
}

(window as any).updateWordCount = updateWordCount;
