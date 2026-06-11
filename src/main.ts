import { createEditor, syncDocumentPaginationState } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel, resetChatChunks } from "./ai-panel/chat";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { getCurrentProvider } from "./ai-panel/ai-manager";
import { initProjectPanel, handleSaveToDatabase } from "./editor/project-panel";
import { initKeyboardHelp } from "./editor/keyboard-help";
import { initErrorBoundaries, showErrorToast, showInfoToast, showToast } from "./error-boundary";
import { checkForUpdatesOnStartup } from "./updates";
import { listModelsForProvider, getCachedModels, setCachedModels, type ModelInfo } from "./ai-panel/model-listing";
import { PROVIDER_BASE_URLS } from "./ai-panel/providers";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { updateDownloadProgress, setDownloadRetryHandler, clearDownload } from "./download-toast";
import { openPath as openLocalPath } from "@tauri-apps/plugin-opener";
import {
  populateUserFontsInToolbar,
  setupFontsReloadListener,
} from "./editor/fonts-ui";
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
const EMBED_ONBOARDING_KEY = "aurawrite-embeddings-onboarding-dismissed";

interface ResourceInfo {
  present: boolean;
  path: string;
  size_bytes: number;
  version: string;
  license: string;
  download_url: string;
}
interface ResourcesStatus {
  llamacpp: ResourceInfo;
  nomic: ResourceInfo;
  ollama_installed: boolean;
  ollama_path: string;
  data_dir: string;
  platform: string;
  arch: string;
}

type ThemeMode = "light" | "dark" | "custom";

interface Preferences {
  theme: ThemeMode;
  customBg: string;
  customToolbar: string;
  customPaper: string;
  customTextEditor: string;
  customTextButtons: string;
  incrementalEnabled: boolean;
  incrementalMax: number;
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio";
  aiOllamaMode: "local" | "cloud";
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiSuggestionsInterval: number;
  aiContextInterval: number;
  aiInterfaceLanguage: string;
  aiWritingLanguage: string;
  aiAssistantName: string;
  aiUserName: string;
  suggestionsDebug: boolean;
  suggestionsPrompt: string;
  aiAssistantPrompt: string;
  entityExtractionRole: string;
  entityExtractionPrompt: string;
  toolCallingPrompt: string;
  deselectOnDocumentClick: boolean;
  semanticSearchEnabled: boolean;
  selectionHighlightColor: string;
  updatesCheckEnabled: boolean;
  fontsUseBundled: boolean;
  fontEditor: string;
  fontUi: string;
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
  theme: "light",
  customBg: "#f0f0f0",
  customToolbar: "#ffffff",
  customPaper: "#ffffff",
  customTextEditor: "#222222",
  customTextButtons: "#222222",
  incrementalEnabled: false,
  incrementalMax: 10,
  aiProvider: "ollama",
  aiOllamaMode: "local",
  aiModel: "kimi-k2.5:cloud",
  aiApiKey: "",
  aiBaseUrl: "",
  aiSuggestionsInterval: 30,
  aiContextInterval: 30,
  aiInterfaceLanguage: "English",
  aiWritingLanguage: "English",
  aiAssistantName: "Aura",
  aiUserName: "",
  suggestionsDebug: false,
  suggestionsPrompt: defaultSuggestionsPrompt,
  aiAssistantPrompt: defaultAIAssistantPrompt,
  entityExtractionRole: defaultEntityExtractionRole,
  entityExtractionPrompt: defaultEntityExtractionPrompt,
  toolCallingPrompt: defaultToolCallingPrompt,
  deselectOnDocumentClick: true,
  semanticSearchEnabled: true,
  selectionHighlightColor: "#ffff00",
  updatesCheckEnabled: true,
  fontsUseBundled: true,
  fontEditor: "Lora",
  fontUi: "Inter",
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255, 255, 0, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

  localStorage.setItem(THEME_KEY, prefs.theme);

  // Apply selection highlight color (works in all themes)
  const hlColor = prefs.selectionHighlightColor || "#ffff00";
  root.style.setProperty("--selection-highlight", hexToRgba(hlColor, 0.4));
  root.style.setProperty("--selection-highlight-flash", hexToRgba(hlColor, 0.6));

  // Apply font preferences (v0.4.0+)
  if (prefs.fontsUseBundled) {
    // Use bundled Lora/Inter; CSS fallbacks still resolve to system
    root.style.setProperty(
      "--font-editor",
      `"${prefs.fontEditor || "Lora"}", Georgia, "Times New Roman", serif`
    );
    root.style.setProperty(
      "--font-family",
      `"${prefs.fontUi || "Inter"}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    );
  } else {
    // Skip bundled, go straight to system stack
    root.style.setProperty("--font-editor", `Georgia, "Times New Roman", serif`);
    root.style.setProperty(
      "--font-family",
      `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    );
  }
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
      btn.textContent = "â˜€ï¸";
    } else if (theme === "dark") {
      btn.textContent = "ðŸŒ™";
    } else {
      btn.textContent = "ðŸŽ¨";
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
  (document.getElementById("pref-ai-ollama-mode") as HTMLSelectElement).value =
    prefs.aiOllamaMode;
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
  (document.getElementById("pref-suggestions-debug") as HTMLInputElement).checked =
    prefs.suggestionsDebug;
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
  (
    document.getElementById("pref-selection-highlight") as HTMLInputElement
  ).value = prefs.selectionHighlightColor || "#ffff00";
  (
    document.getElementById("pref-updates-check-enabled") as HTMLInputElement
  ).checked = prefs.updatesCheckEnabled !== false;
  (
    document.getElementById("pref-fonts-use-bundled") as HTMLInputElement
  ).checked = prefs.fontsUseBundled !== false;
  (document.getElementById("pref-fonts-editor") as HTMLSelectElement).value =
    prefs.fontEditor || "Lora";
  (document.getElementById("pref-fonts-ui") as HTMLSelectElement).value =
    prefs.fontUi || "Inter";

  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();
  refreshModelList();

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

function loadUserFonts(): void {
  const listEl = document.getElementById("pref-fonts-user-list");
  const dirEl = document.getElementById("pref-fonts-user-dir");
  if (!listEl || !dirEl) {
    console.warn("[fonts] UI elements missing - tab not in DOM? listEl:", listEl, "dirEl:", dirEl);
    return;
  }
  console.log("[fonts] loadUserFonts called");

  listEl.innerHTML = "<em>Scansione in corsoâ€¦</em>";

  void (async () => {
    try {
      const dir = await invoke<string>("get_user_fonts_dir");
      dirEl.textContent = dir;
      const fonts = await invoke<
        { path: string; filename: string; family_guess: string; size_bytes: number }[]
      >("list_user_fonts");

      if (fonts.length === 0) {
        listEl.innerHTML =
          "<em>Nessun font trovato. Trascina file .ttf / .otf / .woff / .woff2 nella cartella e clicca 'Reload'.</em>";
        return;
      }

      listEl.innerHTML = "";
      for (const f of fonts) {
        const entry = document.createElement("div");
        entry.className = "font-entry";
        const left = document.createElement("span");
        left.textContent = `${f.family_guess} (${(f.size_bytes / 1024).toFixed(1)} KB)`;
        const right = document.createElement("span");
        right.className = "font-source";
        right.textContent = "user folder";
        entry.appendChild(left);
        entry.appendChild(right);
        listEl.appendChild(entry);
      }
    } catch (e) {
      listEl.innerHTML = `<em>Errore: ${String(e)}</em>`;
    }
  })();
}

function updateApiKeyGroupVisibility(): void {
  const provider = (document.getElementById("pref-ai-provider") as HTMLSelectElement)?.value;
  const ollamaModeGroup = document.getElementById("ollama-mode-group");
  const apiKeyGroup = document.getElementById("api-key-group");
  const baseUrlGroup = document.getElementById("base-url-group");
  const apiKeyHint = document.getElementById("api-key-hint");
  const baseUrlHint = document.getElementById("base-url-hint");
  const ollamaModeSelect = document.getElementById("pref-ai-ollama-mode") as HTMLSelectElement | null;
  const ollamaMode = ollamaModeSelect?.value || "local";

  const isOllamaCloud = provider === "ollama" && ollamaMode === "cloud";
  const effectiveProvider = isOllamaCloud ? "ollama-cloud" : provider;

  const defaultModels: Record<string, string> = {
    ollama: "kimi-k2.5:cloud",
    "ollama-cloud": "gpt-oss:120b-cloud",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    deepseek: "deepseek-chat",
    openrouter: "openai/gpt-4o",
    lmstudio: "loaded-model",
    minimax: "MiniMax-M3",
  };

  if (ollamaModeGroup) {
    if (provider === "ollama") {
      ollamaModeGroup.classList.remove("hidden");
    } else {
      ollamaModeGroup.classList.add("hidden");
    }
  }

  if (apiKeyGroup) {
    apiKeyGroup.classList.remove("hidden");
  }
  if (baseUrlGroup) {
    baseUrlGroup.classList.remove("hidden");
  }
  if (apiKeyHint) {
    if (isOllamaCloud) {
      apiKeyHint.textContent = "Required for Ollama Cloud. Use your OLLAMA_API_KEY from ollama.com.";
    } else if (provider === "ollama") {
      apiKeyHint.textContent = "Optional. Only needed if you ran `ollama signin` to use cloud models through your local Ollama.";
    } else if (provider === "lmstudio") {
      apiKeyHint.textContent = "Not required for LM Studio.";
    } else if (provider === "minimax") {
      apiKeyHint.textContent = "Required. Get your MiniMax API key from platform.minimax.io/user-center/payment/token-plan.";
    } else {
      apiKeyHint.textContent = "Required.";
    }
  }
  if (baseUrlHint) {
    baseUrlHint.textContent = `Default: ${PROVIDER_BASE_URLS[effectiveProvider] || ""}. Leave empty to use default.`;
  }

  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement;
  if (modelInput && defaultModels[effectiveProvider]) {
    const newDefault = defaultModels[effectiveProvider];
    modelInput.placeholder = newDefault;
    const currentValue = modelInput.value.trim();
    const isKnownDefault = Object.values(defaultModels).includes(currentValue);
    if (currentValue === "" || isKnownDefault) {
      modelInput.value = newDefault;
    }
  }

  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement;
  if (baseUrlInput) {
    const defaultUrl = PROVIDER_BASE_URLS[effectiveProvider] || "";
    baseUrlInput.placeholder = defaultUrl;
    if (!baseUrlInput.value.trim() || baseUrlInput.dataset.autoFilled === "true") {
      baseUrlInput.value = defaultUrl;
      baseUrlInput.dataset.autoFilled = defaultUrl ? "true" : "false";
    }
  }
}

function getEffectiveProvider(): string {
  const provider = (document.getElementById("pref-ai-provider") as HTMLSelectElement | null)?.value || "ollama";
  const ollamaMode = (document.getElementById("pref-ai-ollama-mode") as HTMLSelectElement | null)?.value || "local";
  if (provider === "ollama" && ollamaMode === "cloud") return "ollama-cloud";
  return provider;
}

function getEffectiveBaseUrl(): string {
  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
  const value = (baseUrlInput?.value || "").trim();
  if (value) return value.replace(/\/+$/, "");
  const effectiveProvider = getEffectiveProvider();
  return PROVIDER_BASE_URLS[effectiveProvider] || "";
}

function setModelStatus(text: string, isError = false): void {
  const el = document.getElementById("pref-ai-model-status");
  if (el) {
    el.textContent = text;
    el.classList.toggle("model-status-error", isError);
    el.classList.toggle("model-status-ok", !isError && text.length > 0);
  }
}

function populateModelSelect(models: ModelInfo[], currentModel: string): void {
  const select = document.getElementById("pref-ai-model-select") as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = models.length === 0
    ? "â€” No models returned â€”"
    : "â€” Select a model â€”";
  select.appendChild(placeholder);
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id;
    select.appendChild(opt);
  }
  if (currentModel) {
    select.value = currentModel;
  }
}

async function refreshModelList(force = false): Promise<void> {
  const provider = getEffectiveProvider();
  const baseUrl = getEffectiveBaseUrl();
  const apiKey = (document.getElementById("pref-ai-api-key") as HTMLInputElement | null)?.value || "";
  const hasApiKey = apiKey.trim().length > 0;
  const currentModel = (document.getElementById("pref-ai-model") as HTMLInputElement | null)?.value || "";

  if (!baseUrl) {
    setModelStatus("No base URL configured.", true);
    return;
  }

  if (!force) {
    const cached = getCachedModels(provider, baseUrl, hasApiKey);
    if (cached) {
      populateModelSelect(cached, currentModel);
      setModelStatus(`Showing ${cached.length} cached model(s). Click \u21bb to refresh.`);
      return;
    }
  }

  setModelStatus("Loading models...");
  try {
    const models = await listModelsForProvider(provider, baseUrl, apiKey);
    setCachedModels(provider, baseUrl, hasApiKey, models);
    populateModelSelect(models, currentModel);
    setModelStatus(`Loaded ${models.length} model(s) from ${provider}.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ModelListing]", error);
    populateModelSelect([], currentModel);
    setModelStatus(`Failed: ${msg}`, true);
  }
}

function switchPreferencesTab(tabName: string): void {
  console.log(`[prefs] switchPreferencesTab('${tabName}')`);
  document.querySelectorAll(".pref-tab").forEach((tab) => {
    tab.classList.toggle("active", (tab as HTMLElement).dataset.tab === tabName);
  });
  document.querySelectorAll(".pref-tab-content").forEach((content) => {
    content.classList.toggle("active", (content as HTMLElement).dataset.tab === tabName);
  });
  // Diagnostic: log if the Fonts tab was requested but the content element is missing
  if (tabName === "fonts") {
    const el = document.querySelector('.pref-tab-content[data-tab="fonts"]');
    console.log("[prefs] Fonts content element:", el);
    if (!el) {
      console.error("[prefs] Fonts tab is in the tab bar but the content is missing from the DOM");
    }
  }
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
    theme: sel("pref-theme") as ThemeMode,
    customBg: inp("pref-custom-bg"),
    customToolbar: inp("pref-custom-toolbar"),
    customPaper: inp("pref-custom-paper"),
    customTextEditor: inp("pref-custom-text-editor"),
    customTextButtons: inp("pref-custom-text-buttons"),
    incrementalEnabled: chk("pref-incremental-enabled"),
    incrementalMax: parseInt(inp("pref-incremental-max"), 10) || 10,
    aiProvider: sel("pref-ai-provider") as Preferences["aiProvider"] || "ollama",
    aiOllamaMode: (sel("pref-ai-ollama-mode") as Preferences["aiOllamaMode"]) || "local",
    aiModel: inp("pref-ai-model"),
    aiApiKey: inp("pref-ai-api-key"),
    aiBaseUrl: inp("pref-ai-base-url"),
    aiSuggestionsInterval: parseInt(inp("pref-ai-suggestions-interval"), 10) || 30,
    aiContextInterval: parseInt(inp("pref-ai-context-interval"), 10) || 30,
    aiInterfaceLanguage: sel("pref-ai-interface-language") || "English",
    aiWritingLanguage: sel("pref-ai-writing-language") || "English",
    aiAssistantName: inp("pref-ai-assistant-name"),
    aiUserName: inp("pref-ai-user-name"),
    suggestionsDebug: chk("pref-suggestions-debug"),
    suggestionsPrompt: tarea("pref-suggestions-prompt"),
    aiAssistantPrompt: tarea("pref-ai-assistant-prompt"),
    entityExtractionRole: inp("pref-entity-extraction-role"),
    entityExtractionPrompt: tarea("pref-entity-extraction-prompt"),
    toolCallingPrompt: tarea("pref-tool-calling-prompt"),
    deselectOnDocumentClick: chk("pref-deselect-on-click"),
    semanticSearchEnabled: chk("pref-semantic-search-enabled"),
    selectionHighlightColor: inp("pref-selection-highlight") || "#ffff00",
    updatesCheckEnabled: chk("pref-updates-check-enabled"),
    fontsUseBundled: chk("pref-fonts-use-bundled"),
    fontEditor: sel("pref-fonts-editor") || "Lora",
    fontUi: sel("pref-fonts-ui") || "Inter",
  };

  savePreferences(prefs);
  updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  window.dispatchEvent(new CustomEvent("aurawrite:preferences-changed"));
}

function setupResizablePanels(): void {
  const STORAGE_KEY = "aurawrite-preferences";
  const DEFAULTS = { ai: 360, projects: 280, suggestions: 320 } as const;
  const MIN = { ai: 200, projects: 180, suggestions: 200 } as const;
  const MAX_RATIO = { ai: 0.8, projects: 0.6, suggestions: 0.6 } as const;
  const STORAGE_KEYS = {
    ai: "aiChatPanelWidth",
    projects: "projectPanelWidth",
    suggestions: "suggestionsPanelWidth",
  } as const;
  const CSS_VARS = {
    ai: "--ai-panel-width",
    projects: "--project-panel-width",
    suggestions: "--suggestions-panel-width",
  } as const;
  const LEFT_EDGED: ReadonlyArray<"ai" | "projects" | "suggestions"> = ["ai"];

  type PanelKey = "ai" | "projects" | "suggestions";
  type Widths = Record<PanelKey, number>;

  function loadWidths(): Widths {
    const out: Widths = { ...DEFAULTS };
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
          const v = parsed[STORAGE_KEYS[k]];
          if (typeof v === "number") out[k] = v;
        }
      }
    } catch { /* fall through */ }
    return out;
  }

  function saveWidths(w: Widths): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
        parsed[STORAGE_KEYS[k]] = w[k];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch (e) {
      console.warn("[resize] failed to save panel widths:", e);
    }
  }

  function applyWidths(): void {
    const w = loadWidths();
    const root = document.documentElement;
    for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
      const maxW = window.innerWidth * MAX_RATIO[k];
      root.style.setProperty(CSS_VARS[k], Math.max(MIN[k], Math.min(w[k], maxW)) + "px");
    }
  }

  applyWidths();
  window.addEventListener("resize", applyWidths);

  let widths = loadWidths();

  document.querySelectorAll<HTMLElement>(".panel-resize-handle").forEach((handle) => {
    const target = handle.dataset.resize as PanelKey | undefined;
    if (!target || !(target in STORAGE_KEYS)) return;

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      widths = { ...widths, [target]: DEFAULTS[target] };
      applyWidths();
      saveWidths(widths);
    });

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widths[target];
      const maxWidth = window.innerWidth * MAX_RATIO[target];
      const minWidth = MIN[target];
      handle.classList.add("panel-resize-handle--active");

      const onMove = (ev: MouseEvent) => {
        const growRight = !LEFT_EDGED.includes(target);
        const dx = growRight ? ev.clientX - startX : startX - ev.clientX;
        const next = Math.max(minWidth, Math.min(startWidth + dx, maxWidth));
        widths = { ...widths, [target]: next };
        document.documentElement.style.setProperty(CSS_VARS[target], next + "px");
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        handle.classList.remove("panel-resize-handle--active");
        saveWidths(widths);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

let downloadListenerInstalled = false;
function setupDownloadProgressListener(): void {
  if (downloadListenerInstalled) return;
  downloadListenerInstalled = true;
  tauriListen<any>("download-progress", (event) => {
    const p = event.payload as any;
    if (p && typeof p.id === "string") {
      updateDownloadProgress({
        id: p.id,
        name: p.name ?? p.id,
        phase: p.phase ?? "downloading",
        bytes: typeof p.bytes === "number" ? p.bytes : 0,
        total: typeof p.total === "number" ? p.total : 0,
        speed_bps: typeof p.speed_bps === "number" ? p.speed_bps : 0,
        eta_seconds: typeof p.eta_seconds === "number" ? p.eta_seconds : Infinity,
        error: p.error,
      });
    }
  }).catch((e) => console.warn("[download-toast] listen failed:", e));
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function refreshEmbeddingsStatus(): Promise<ResourcesStatus | null> {
  try {
    return (await invoke("resources_get_status")) as ResourcesStatus;
  } catch (e) {
    console.warn("[embeddings] status failed:", e);
    return null;
  }
}

async function setupEmbeddingsTab(): Promise<void> {
  const status = await refreshEmbeddingsStatus();
  if (!status) return;

  const llamaStatus = document.getElementById("embed-llamacpp-status");
  const llamaMeta = document.getElementById("embed-llamacpp-meta");
  const llamaDownload = document.getElementById("embed-llamacpp-download") as HTMLButtonElement | null;
  const llamaRemove = document.getElementById("embed-llamacpp-remove") as HTMLButtonElement | null;
  const nomicStatus = document.getElementById("embed-nomic-status");
  const nomicMeta = document.getElementById("embed-nomic-meta");
  const nomicDownload = document.getElementById("embed-nomic-download") as HTMLButtonElement | null;
  const nomicRemove = document.getElementById("embed-nomic-remove") as HTMLButtonElement | null;
  const ollamaStatus = document.getElementById("embed-ollama-status");
  const ollamaInstall = document.getElementById("embed-ollama-install") as HTMLButtonElement | null;
  const ollamaPullNomic = document.getElementById("embed-ollama-pull-nomic") as HTMLButtonElement | null;
  const removeAll = document.getElementById("embed-remove-all") as HTMLButtonElement | null;
  const reshowOnboarding = document.getElementById("embed-reshow-onboarding") as HTMLButtonElement | null;

  if (llamaStatus) llamaStatus.textContent = `Status: ${status.llamacpp.present ? "installed" : "not installed"} (${status.platform}/${status.arch})`;
  if (llamaMeta) llamaMeta.textContent = status.llamacpp.present ? `Version: ${status.llamacpp.version} · Size: ${formatBytes(status.llamacpp.size_bytes)}` : `Will download: ${status.llamacpp.download_url}`;
  if (llamaDownload) llamaDownload.style.display = status.llamacpp.present ? "none" : "";
  if (llamaRemove) llamaRemove.style.display = status.llamacpp.present ? "" : "none";

  if (nomicStatus) nomicStatus.textContent = `Status: ${status.nomic.present ? "installed" : "not installed"}`;
  if (nomicMeta) nomicMeta.textContent = status.nomic.present ? `Version: ${status.nomic.version} · Size: ${formatBytes(status.nomic.size_bytes)}` : `Will download: ${status.nomic.download_url}`;
  if (nomicDownload) nomicDownload.style.display = status.nomic.present ? "none" : "";
  if (nomicRemove) nomicRemove.style.display = status.nomic.present ? "" : "none";

  if (ollamaStatus) ollamaStatus.textContent = `Ollama status: ${status.ollama_installed ? "installed" : "not installed"} (${status.ollama_path || "not on PATH"})`;
  if (ollamaInstall) ollamaInstall.style.display = status.ollama_installed ? "none" : "";
  if (ollamaPullNomic) ollamaPullNomic.style.display = status.ollama_installed ? "" : "none";

  installEmbeddingsButtonHandlers();
  ollamaPullNomic?.addEventListener("click", async () => {
    ollamaPullNomic.disabled = true;
    ollamaPullNomic.textContent = "Pulling nomic via Ollama...";
    try {
      await invoke("ollama_pull_nomic");
      ollamaPullNomic.textContent = "nomic pulled via Ollama ✓";
    } catch (e) {
      ollamaPullNomic.disabled = false;
      ollamaPullNomic.textContent = "Download nomic via Ollama";
      alert("Failed to pull nomic via Ollama: " + (e instanceof Error ? e.message : String(e)));
    }
  });
  removeAll?.addEventListener("click", async () => {
    if (!window.confirm("Remove both llama.cpp and nomic? You can re-download at any time.")) return;
    await invoke("resources_remove_all");
    await setupEmbeddingsTab();
  });
  reshowOnboarding?.addEventListener("click", () => {
    localStorage.removeItem(EMBED_ONBOARDING_KEY);
    maybeShowEmbeddingsOnboarding();
  });
}

let embeddingsButtonHandlersInstalled = false;
function installEmbeddingsButtonHandlers(): void {
  if (embeddingsButtonHandlersInstalled) return;
  embeddingsButtonHandlersInstalled = true;
  const llamaDownload = document.getElementById("embed-llamacpp-download") as HTMLButtonElement | null;
  const llamaRemove = document.getElementById("embed-llamacpp-remove") as HTMLButtonElement | null;
  const nomicDownload = document.getElementById("embed-nomic-download") as HTMLButtonElement | null;
  const nomicRemove = document.getElementById("embed-nomic-remove") as HTMLButtonElement | null;

  llamaDownload?.addEventListener("click", async () => {
    llamaDownload.disabled = true;
    setDownloadRetryHandler("llamacpp", () => {
      llamaDownload.click();
    });
    try {
      await invoke("resources_download_llamacpp");
      await setupEmbeddingsTab();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[llamacpp] download failed:", msg);
    } finally {
      llamaDownload.disabled = false;
      llamaDownload.textContent = "Download llama.cpp";
    }
  });
  llamaRemove?.addEventListener("click", async () => {
    if (!window.confirm("Remove llama.cpp? You can re-download it at any time.")) return;
    await invoke("resources_remove_all");
    await setupEmbeddingsTab();
  });
  nomicDownload?.addEventListener("click", async () => {
    nomicDownload.disabled = true;
    setDownloadRetryHandler("nomic", () => {
      nomicDownload.click();
    });
    try {
      await invoke("resources_download_nomic");
      await setupEmbeddingsTab();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[nomic] download failed:", msg);
    } finally {
      nomicDownload.disabled = false;
      nomicDownload.textContent = "Download nomic";
    }
  });
  nomicRemove?.addEventListener("click", async () => {
    if (!window.confirm("Remove nomic? You can re-download it at any time.")) return;
    await invoke("resources_remove_all");
    await setupEmbeddingsTab();
  });
}

function maybeShowEmbeddingsOnboarding(): void {
  if (localStorage.getItem(EMBED_ONBOARDING_KEY)) return;
  const modal = document.getElementById("embeddings-onboarding-modal");
  if (!modal) return;
  modal.classList.remove("hidden");

  const close = (download: boolean) => {
    localStorage.setItem(EMBED_ONBOARDING_KEY, "1");
    modal.classList.add("hidden");
    if (download) {
      (async () => {
        try {
          await invoke("resources_download_llamacpp");
          await invoke("resources_download_nomic");
          await setupEmbeddingsTab();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[embeddings onboarding] download failed:", msg);
        }
      })();
    }
  };

  document.getElementById("embeddings-onboarding-close")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-skip")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-download")?.addEventListener("click", () => close(true));
}

document.addEventListener("DOMContentLoaded", () => {
  initErrorBoundaries();
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
  syncDocumentPaginationState(editorView);

  // Esponi flag globale per toolbar.ts
  (window as any).__aurawrite_loading = false;
  function setLoading(val: boolean) {
    (window as any).__aurawrite_loading = val;
  }

  function migrateImageNodesInJson(node: any): any {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map((child) => migrateImageNodesInJson(child));
    }
    if (node.type === "image") {
      return { type: "paragraph", content: [node] };
    }
    if (Array.isArray(node.content)) {
      const newContent = node.content.map((child: any) => migrateImageNodesInJson(child));
      return { ...node, content: newContent };
    }
    return node;
  }

  // Listen for clear editor events
  window.addEventListener("aurawrite:clear-editor", () => {
    setLoading(true);
    const tr = editorView.state.tr;
    tr.delete(0, tr.doc.content.size);
    editorView.dispatch(tr);
    syncDocumentPaginationState(editorView);
    console.log("Editor cleared");
    setTimeout(() => setLoading(false), 50);
  });

  // Resizable side panels (AI chat, projects)
  setupResizablePanels();

  // Listen for download progress events from the Rust backend
  setupDownloadProgressListener();

  // Embeddings tab + first-launch onboarding dialog
  setupEmbeddingsTab();
  maybeShowEmbeddingsOnboarding();

  // Initialize project panel
  initProjectPanel({
    onDocumentSelect: (doc) => {
      console.log("Document selected:", doc.title);
      resetChatChunks();
      setLoading(true);
      try {
        if (doc.content_json && doc.content_json.trim() !== "") {
          const rawContent = JSON.parse(doc.content_json);
          const migrated = migrateImageNodesInJson(rawContent);
          const newDoc = editorView.state.schema.nodeFromJSON(migrated);
          const newState = EditorState.create({
            schema: editorView.state.schema,
            doc: newDoc,
            plugins: editorView.state.plugins,
          });
          editorView.updateState(newState);
          syncDocumentPaginationState(editorView);
          console.log("Loaded document content");
        } else {
          // Document is empty â€” clear the editor
          const tr = editorView.state.tr;
          tr.delete(0, tr.doc.content.size);
          editorView.dispatch(tr);
          syncDocumentPaginationState(editorView);
          console.log("Loaded empty document");
        }
      } catch (e) {
        console.error("Failed to parse document content:", e);
        // Fallback: clear editor on parse error
        const tr = editorView.state.tr;
        tr.delete(0, tr.doc.content.size);
        editorView.dispatch(tr);
        syncDocumentPaginationState(editorView);
      }
      setTimeout(() => setLoading(false), 50);
    },    onProjectChange: (project) => {
      console.log("Project changed:", project?.name || "none");
    },
    getEditorContent: () => {
      return JSON.stringify(editorView.state.doc.toJSON());
    },
  });

  setupAIPanel(editorView);
  setupSuggestionsPanel(editorView);
  setupToolbar(editorView);
  initKeyboardHelp();

  const findBar = document.getElementById("find-bar");
  const findInput = document.getElementById("find-input") as HTMLInputElement | null;
  const replaceInput = document.getElementById("replace-input") as HTMLInputElement | null;

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

  // Fonts tab: open in explorer / reload list (v0.4.0+)
  const fontsOpenDir = document.getElementById("pref-fonts-open-dir");
  fontsOpenDir?.addEventListener("click", async () => {
    try {
      const dir = await invoke<string>("get_user_fonts_dir");
      await openLocalPath(dir);
    } catch (e) {
      showErrorToast(`Could not open folder: ${String(e)}`, 5000);
    }
  });
  const fontsReload = document.getElementById("pref-fonts-reload");
  fontsReload?.addEventListener("click", () => {
    void loadUserFonts();
    void populateUserFontsInToolbar();
    window.dispatchEvent(new CustomEvent("aurawrite:fonts-reloaded"));
  });
  void loadUserFonts(); // initial load
  void populateUserFontsInToolbar(); // initial toolbar population
  setupFontsReloadListener();

  // Maintenance tab: clean orphan links (v0.4.2+)
  const btnCleanLinks = document.getElementById("pref-maintenance-clean-links");
  btnCleanLinks?.addEventListener("click", async () => {
    btnCleanLinks.setAttribute("disabled", "true");
    try {
      const removed = await invoke<number>("db_cleanup_orphan_links");
      if (removed > 0) {
        showErrorToast(`Cleaned ${removed} orphan link(s).`, 5000);
      } else {
        showErrorToast("No orphan links found. Database is clean.", 5000);
      }
    } catch (e) {
      showErrorToast(`Cleanup failed: ${String(e)}`, 5000);
    } finally {
      btnCleanLinks.removeAttribute("disabled");
    }
  });

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
    refreshModelList();
    savePreferencesFromModal();
  });
  document.getElementById("pref-ai-ollama-mode")?.addEventListener("change", () => {
    updateApiKeyGroupVisibility();
    refreshModelList();
    savePreferencesFromModal();
  });
  document.getElementById("pref-ai-base-url")?.addEventListener("change", () => {
    refreshModelList();
  });
  document.getElementById("pref-ai-api-key")?.addEventListener("change", () => {
    refreshModelList();
  });
  document.getElementById("pref-ai-model-refresh")?.addEventListener("click", () => {
    refreshModelList(true);
  });
  document.getElementById("pref-ai-model-select")?.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (!value) return;
    const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
    if (modelInput) modelInput.value = value;
    savePreferencesFromModal();
    const current = getCurrentProvider();
    if (current && typeof (current as any).setModel === "function") {
      (current as any).setModel(value);
    }
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
      "#pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-provider, #pref-ai-model, #pref-ai-api-key, #pref-ai-base-url, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-ai-interface-language, #pref-ai-writing-language, #pref-ai-assistant-name, #pref-ai-user-name, #pref-suggestions-debug, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-entity-extraction-role, #pref-entity-extraction-prompt, #pref-tool-calling-prompt, #pref-deselect-on-click, #pref-semantic-search-enabled, #pref-selection-highlight, #pref-updates-check-enabled, #pref-fonts-use-bundled, #pref-fonts-editor, #pref-fonts-ui",
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
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      const newBtn = document.querySelector(
        '.dropdown-item[data-action="new"]'
      ) as HTMLButtonElement | null;
      newBtn?.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSaveToDatabase();
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

  if (import.meta.env.DEV) {
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
      getCurrentState: () => ({
        project: (window as any).auraProject,
        section: (window as any).auraSection, 
        document: (window as any).auraDocument
      })
    };
  }


  // Check for new releases at startup (silent if disabled or offline)
  void checkForUpdatesOnStartup();
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

// ============================================================================
