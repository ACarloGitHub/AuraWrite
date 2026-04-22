import { createEditor } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel } from "./ai-panel/chat";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { initProjectPanel, triggerSaveStatusCheck } from "./editor/project-panel";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import {
  setFindQuery,
  findNext,
  findPrev,
  replaceOne,
  replaceAll,
  clearFind,
} from "./editor/find-replace";
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
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio";
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiSuggestionsInterval: number;
  aiContextInterval: number;
  aiInterfaceLanguage: string;
  aiWritingLanguage: string;
  aiAssistantName: string;
  aiUserName: string;
  suggestionsPrompt: string;
  aiAssistantPrompt: string;
  entityExtractionRole: string;
  entityExtractionPrompt: string;
  toolCallingPrompt: string;
  deselectOnDocumentClick: boolean;
  semanticSearchEnabled: boolean;
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

const defaultEntityExtractionPrompt = `You are an entity extraction assistant for a writing application.
Read the text and extract all named entities (characters, locations, objects, events, etc.).
For each entity, provide:
- name: the entity name
- type: the category (character, location, object, event, etc.)
- description: a brief description based on the text context

Respond in JSON format:
{
  "entities": [
    {"name": "Entity Name", "type": "character", "description": "Brief description"}
  ]
}

Rules:
- Extract only entities explicitly mentioned or clearly implied
- Use consistent type names
- Keep descriptions concise (max 200 characters)
- If an entity was already known, update its description with new information`;

const defaultToolCallingPrompt = `You are AuraWrite AI, an intelligent writing assistant with access to a project database.
When the user asks about characters, locations, events, or anything related to their project, you MUST use the available tools to query the database before answering.

To use a tool, include this tag in your response:
<tool name="TOOL_NAME">{"param1": "value1", "param2": "value2"}</tool>

You can use multiple tools in one response.
After receiving tool results, summarize them naturally for the user.`;

const defaultEntityExtractionRole = "";

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
  aiProvider: "ollama",
  aiModel: "kimi-k2.5:cloud",
  aiApiKey: "",
  aiBaseUrl: "",
  aiSuggestionsInterval: 30,
  aiContextInterval: 30,
  aiInterfaceLanguage: "English",
  aiWritingLanguage: "English",
  aiAssistantName: "Aura",
  aiUserName: "",
  suggestionsPrompt: defaultSuggestionsPrompt,
  aiAssistantPrompt: defaultAIAssistantPrompt,
  entityExtractionRole: defaultEntityExtractionRole,
  entityExtractionPrompt: defaultEntityExtractionPrompt,
  toolCallingPrompt: defaultToolCallingPrompt,
  deselectOnDocumentClick: true,
  semanticSearchEnabled: true,
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
  (document.getElementById("pref-ai-provider") as HTMLSelectElement).value =
    prefs.aiProvider;
  (document.getElementById("pref-ai-model") as HTMLInputElement).value =
    prefs.aiModel;
  (document.getElementById("pref-ai-api-key") as HTMLInputElement).value =
    prefs.aiApiKey;
  (document.getElementById("pref-ai-base-url") as HTMLInputElement).value =
    prefs.aiBaseUrl;
  (
    document.getElementById("pref-ai-interface-language") as HTMLSelectElement
  ).value = prefs.aiInterfaceLanguage;
  (
    document.getElementById("pref-ai-writing-language") as HTMLSelectElement
  ).value = prefs.aiWritingLanguage;
  (
    document.getElementById("pref-ai-assistant-name") as HTMLInputElement
  ).value = prefs.aiAssistantName;
  (document.getElementById("pref-ai-user-name") as HTMLInputElement).value =
    prefs.aiUserName;
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
    document.getElementById("pref-entity-extraction-role") as HTMLInputElement
  ).value = prefs.entityExtractionRole;
  (
    document.getElementById("pref-entity-extraction-prompt") as HTMLTextAreaElement
  ).value = prefs.entityExtractionPrompt;
  (
    document.getElementById("pref-tool-calling-prompt") as HTMLTextAreaElement
  ).value = prefs.toolCallingPrompt;
  (
    document.getElementById("pref-incremental-enabled") as HTMLInputElement
  ).checked = prefs.incrementalEnabled;
  (document.getElementById("pref-incremental-max") as HTMLInputElement).value =
    prefs.incrementalMax.toString();
  (
    document.getElementById("pref-deselect-on-click") as HTMLInputElement
  ).checked = prefs.deselectOnDocumentClick;
  (
    document.getElementById("pref-semantic-search-enabled") as HTMLInputElement
  ).checked = prefs.semanticSearchEnabled;

  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  const content = modal?.querySelector(".modal-content") as HTMLElement | null;
  if (content) {
    content.style.position = "";
    content.style.left = "";
    content.style.top = "";
    content.style.transform = "";
  }

  if (modal) modal.classList.remove("hidden");
}

function closePreferencesModal(): void {
  const modal = document.getElementById("preferences-modal");
  if (modal) modal.classList.add("hidden");
}

function makeModalDraggable(): void {
  const modal = document.getElementById("preferences-modal");
  const header = modal?.querySelector(".modal-header") as HTMLElement | null;
  const content = modal?.querySelector(".modal-content") as HTMLElement | null;
  if (!modal || !header || !content) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  header.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest(".modal-close")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = content.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    content.style.position = "fixed";
    content.style.left = `${initialLeft + dx}px`;
    content.style.top = `${initialTop + dy}px`;
    content.style.transform = "none";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

function updateApiKeyGroupVisibility(): void {
  const provider = (document.getElementById("pref-ai-provider") as HTMLSelectElement)?.value;
  const apiKeyGroup = document.getElementById("api-key-group");
  const baseUrlGroup = document.getElementById("base-url-group");
  const apiKeyHint = document.getElementById("api-key-hint");
  const baseUrlHint = document.getElementById("base-url-hint");

  const defaultBaseUrls: Record<string, string> = {
    ollama: "http://localhost:11434",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    lmstudio: "http://localhost:1234/v1",
  };

  const defaultModels: Record<string, string> = {
    ollama: "kimi-k2.5:cloud",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    deepseek: "deepseek-chat",
    openrouter: "openai/gpt-4o",
    lmstudio: "loaded-model",
  };

  const apiKeyRequired = provider !== "ollama" && provider !== "lmstudio";

  if (apiKeyGroup) {
    apiKeyGroup.classList.remove("hidden");
  }
  if (baseUrlGroup) {
    baseUrlGroup.classList.remove("hidden");
  }
  if (apiKeyHint) {
    if (provider === "ollama") {
      apiKeyHint.textContent = "Required for cloud models (leave empty for local models).";
    } else if (provider === "lmstudio") {
      apiKeyHint.textContent = "Not required for LM Studio.";
    } else {
      apiKeyHint.textContent = "Required.";
    }
  }
  if (baseUrlHint) {
    baseUrlHint.textContent = `Default: ${defaultBaseUrls[provider] || ""}. Leave empty to use default.`;
  }

  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement;
  if (modelInput && defaultModels[provider]) {
    modelInput.placeholder = defaultModels[provider];
  }

  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement;
  if (baseUrlInput && !baseUrlInput.value.trim()) {
    baseUrlInput.placeholder = defaultBaseUrls[provider] || "";
  }
}

function switchPreferencesTab(tabName: string): void {
  document.querySelectorAll(".pref-tab").forEach((tab) => {
    tab.classList.toggle("active", (tab as HTMLElement).dataset.tab === tabName);
  });
  document.querySelectorAll(".pref-tab-content").forEach((content) => {
    content.classList.toggle("active", (content as HTMLElement).dataset.tab === tabName);
  });
}

function resetPrompt(promptType: string): void {
  const defaults: Record<string, string> = {
    suggestions: defaultSuggestionsPrompt,
    assistant: defaultAIAssistantPrompt,
    extraction: defaultEntityExtractionPrompt,
    toolcalling: defaultToolCallingPrompt,
  };
  const fieldMap: Record<string, string> = {
    suggestions: "pref-suggestions-prompt",
    assistant: "pref-ai-assistant-prompt",
    extraction: "pref-entity-extraction-prompt",
    toolcalling: "pref-tool-calling-prompt",
  };
  const textArea = document.getElementById(fieldMap[promptType]) as HTMLTextAreaElement | null;
  if (textArea && defaults[promptType]) {
    textArea.value = defaults[promptType];
    savePreferencesFromModal();
  }
}

function savePreferencesFromModal(): void {
  const el = (id: string) => document.getElementById(id);
  const sel = (id: string) => (el(id) as HTMLSelectElement)?.value || "";
  const inp = (id: string) => (el(id) as HTMLInputElement)?.value || "";
  const chk = (id: string) => (el(id) as HTMLInputElement)?.checked ?? false;
  const tarea = (id: string) => (el(id) as HTMLTextAreaElement)?.value || "";

  const prefs: Preferences = {
    toolbarDisplay: sel("pref-toolbar-display") as Preferences["toolbarDisplay"],
    theme: sel("pref-theme") as ThemeMode,
    customBg: inp("pref-custom-bg"),
    customToolbar: inp("pref-custom-toolbar"),
    customPaper: inp("pref-custom-paper"),
    customTextEditor: inp("pref-custom-text-editor"),
    customTextButtons: inp("pref-custom-text-buttons"),
    incrementalEnabled: chk("pref-incremental-enabled"),
    incrementalMax: parseInt(inp("pref-incremental-max"), 10) || 10,
    aiProvider: sel("pref-ai-provider") as Preferences["aiProvider"] || "ollama",
    aiModel: inp("pref-ai-model"),
    aiApiKey: inp("pref-ai-api-key"),
    aiBaseUrl: inp("pref-ai-base-url"),
    aiSuggestionsInterval: parseInt(inp("pref-ai-suggestions-interval"), 10) || 30,
    aiContextInterval: parseInt(inp("pref-ai-context-interval"), 10) || 30,
    aiInterfaceLanguage: sel("pref-ai-interface-language") || "English",
    aiWritingLanguage: sel("pref-ai-writing-language") || "English",
    aiAssistantName: inp("pref-ai-assistant-name"),
    aiUserName: inp("pref-ai-user-name"),
    suggestionsPrompt: tarea("pref-suggestions-prompt"),
    aiAssistantPrompt: tarea("pref-ai-assistant-prompt"),
    entityExtractionRole: inp("pref-entity-extraction-role"),
    entityExtractionPrompt: tarea("pref-entity-extraction-prompt"),
    toolCallingPrompt: tarea("pref-tool-calling-prompt"),
    deselectOnDocumentClick: chk("pref-deselect-on-click"),
    semanticSearchEnabled: chk("pref-semantic-search-enabled"),
  };

  savePreferences(prefs);
  updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  window.dispatchEvent(new CustomEvent("aurawrite:preferences-changed"));
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
  setupToolbar(editorView);

  const findBar = document.getElementById("find-bar");
  const findInput = document.getElementById("find-input") as HTMLInputElement | null;
  const replaceInput = document.getElementById("replace-input") as HTMLInputElement | null;
  const findCountEl = document.getElementById("find-count");

  function openFindBar(replaceVisible = false): void {
    findBar?.classList.remove("hidden");
    if (!replaceVisible) {
      document.querySelector(".find-bar__replace")?.classList.add("hidden");
      document.getElementById("replace-one")?.classList.add("hidden");
      document.getElementById("replace-all")?.classList.add("hidden");
    } else {
      document.querySelector(".find-bar__replace")?.classList.remove("hidden");
      document.getElementById("replace-one")?.classList.remove("hidden");
      document.getElementById("replace-all")?.classList.remove("hidden");
    }
    findInput?.focus();
    findInput?.select();
  }

  function closeFindBar(): void {
    findBar?.classList.add("hidden");
    clearFind(editorView);
  }

  const btnFind = document.getElementById("btn-find");
  btnFind?.addEventListener("click", () => openFindBar(false));

  const btnFindReplace = document.getElementById("btn-find-replace");
  btnFindReplace?.addEventListener("click", () => openFindBar(true));

  document.getElementById("find-close")?.addEventListener("click", closeFindBar);

  findInput?.addEventListener("input", () => {
    setFindQuery(findInput.value, editorView);
  });

  findInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrev(editorView);
      } else {
        findNext(editorView);
      }
    }
    if (e.key === "Escape") {
      closeFindBar();
    }
  });

  document.getElementById("find-next")?.addEventListener("click", () => findNext(editorView));
  document.getElementById("find-prev")?.addEventListener("click", () => findPrev(editorView));
  document.getElementById("replace-one")?.addEventListener("click", () => {
    if (replaceInput) replaceOne(editorView, replaceInput.value);
  });
  document.getElementById("replace-all")?.addEventListener("click", () => {
    if (replaceInput) replaceAll(editorView, replaceInput.value);
  });

  const btnTheme = document.getElementById("btn-theme");
  btnTheme?.addEventListener("click", toggleTheme);

  const btnPreferences = document.getElementById("btn-preferences");
  btnPreferences?.addEventListener("click", openPreferencesModal);

  const preferencesClose = document.getElementById("preferences-close");
  preferencesClose?.addEventListener("click", closePreferencesModal);

  const modalOverlay = document.querySelector(".modal-overlay");
  modalOverlay?.addEventListener("click", closePreferencesModal);

  makeModalDraggable();

  document.querySelectorAll(".pref-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = (tab as HTMLElement).dataset.tab;
      if (tabName) switchPreferencesTab(tabName);
    });
  });

  document.querySelectorAll(".btn-reset-prompt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const promptType = (btn as HTMLElement).dataset.default;
      if (promptType) resetPrompt(promptType);
    });
  });

  document.getElementById("pref-theme")?.addEventListener("change", () => {
    updateCustomColorsVisibility();
  });

  document.getElementById("pref-ai-provider")?.addEventListener("change", () => {
    updateApiKeyGroupVisibility();
  });

  function migrateOldAISettings(): void {
    const oldSettings = localStorage.getItem("aurawrite-ai-settings");
    if (!oldSettings) return;
    try {
      const parsed = JSON.parse(oldSettings);
      const current = getPreferences();
      if (parsed.provider && !localStorage.getItem("aurawrite-preferences-migrated")) {
        const merged: Preferences = {
          ...current,
          aiProvider: parsed.provider || current.aiProvider,
          aiModel: parsed.model || current.aiModel,
          aiApiKey: parsed.apiKey || current.aiApiKey,
          aiBaseUrl: parsed.baseUrl || current.aiBaseUrl,
        };
        savePreferences(merged);
        localStorage.setItem("aurawrite-preferences-migrated", "1");
      }
    } catch {
      // Migration failed, keep defaults
    }
  }
  migrateOldAISettings();

  // Apply first-load preferences
  const firstLoadPrefs = getPreferences();
  applyPreferences(firstLoadPrefs);
  updateThemeIcon(firstLoadPrefs.theme);

  document
    .querySelectorAll(
      "#pref-toolbar-display, #pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-provider, #pref-ai-model, #pref-ai-api-key, #pref-ai-base-url, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-ai-interface-language, #pref-ai-writing-language, #pref-ai-assistant-name, #pref-ai-user-name, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-entity-extraction-role, #pref-entity-extraction-prompt, #pref-tool-calling-prompt, #pref-deselect-on-click, #pref-semantic-search-enabled",
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
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      openFindBar(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "h") {
      e.preventDefault();
      openFindBar(true);
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

  function setupToolbarOverflow(): void {
    const toolbar = document.querySelector(".toolbar");
    const overflowDropdown = document.getElementById("overflow-dropdown");
    const overflowMenu = document.getElementById("overflow-menu");
    const overflowBtn = document.getElementById("btn-overflow-menu");
    if (!toolbar || !overflowDropdown || !overflowMenu || !overflowBtn) return;

    const miscGroup = toolbar.querySelector(".toolbar-group:last-of-type") as HTMLElement | null;
    const alwaysVisible = new Set<string>([
      "file-dropdown",
      "overflow-dropdown",
    ]);

    function recalc(): void {
      const groups = Array.from(toolbar!.querySelectorAll(".toolbar-group")) as HTMLElement[];
      const toolbarWidth = toolbar!.clientWidth;
      const miscWidth = miscGroup?.offsetWidth || 0;
      const available = toolbarWidth - miscWidth - 10;

      let used = 0;
      const overflowGroups: HTMLElement[] = [];
      const overflowItems: Array<{ label: string; el: HTMLElement }> = [];

      for (const group of groups) {
        if (alwaysVisible.has(group.id)) continue;
        const gw = group.offsetWidth;
        if (used + gw <= available) {
          used += gw;
          group.style.display = "";
        } else {
          overflowGroups.push(group);
          group.style.display = "none";
          group.querySelectorAll("button, select, input").forEach((el) => {
            const btn = el as HTMLElement;
            const label =
              btn.title ||
              (btn as HTMLSelectElement).options?.[(btn as HTMLSelectElement).selectedIndex]?.text ||
              btn.id ||
              "";
            if (label) overflowItems.push({ label, el: btn });
          });
        }
      }

      if (overflowGroups.length > 0) {
        overflowDropdown!.style.display = "";
        overflowMenu!.innerHTML = "";
        const seen = new Set<string>();
        for (const item of overflowItems) {
          if (seen.has(item.label)) continue;
          seen.add(item.label);
          const menuItem = document.createElement("button");
          menuItem.className = "dropdown-item";
          menuItem.textContent = item.label;
          menuItem.addEventListener("click", () => {
            item.el.click();
            overflowMenu!.classList.add("hidden");
          });
          overflowMenu!.appendChild(menuItem);
        }
      } else {
        overflowDropdown!.style.display = "none";
      }
    }

    overflowBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overflowMenu!.classList.toggle("hidden");
    });

    document.addEventListener("click", () => {
      overflowMenu?.classList.add("hidden");
    });

    window.addEventListener("resize", recalc);
    recalc();
  }

  setupToolbarOverflow();
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
