import { createEditor, syncDocumentPaginationState } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel, resetChatChunks } from "./ai-panel/chat";
import { setupMCPPanel } from "./ai-panel/mcp-panel";
import { setContextFooterModel, updateContextFooter } from "./ai-panel/context-footer";
import { loadAIFromPreferences, preloadApiKey, getCachedApiKey, setCachedApiKey } from "./ai-panel/ai-manager";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { getCurrentProvider } from "./ai-panel/ai-manager";
import { LocalLlamacppProvider } from "./ai-panel/local-llamacpp-provider";
import { initProjectPanel, handleSaveToDatabase } from "./editor/project-panel";
import { initKeyboardHelp } from "./editor/keyboard-help";
import { initErrorBoundaries, showErrorToast } from "./error-boundary";
import { checkForUpdatesOnStartup } from "./updates";
import { listModelsForProvider, getCachedModels, setCachedModels, type ModelInfo } from "./ai-panel/model-listing";
import { PROVIDER_BASE_URLS } from "./ai-panel/providers";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { updateDownloadProgress, setDownloadRetryHandler } from "./download-toast";
import { MODEL_CATALOG, recommendModelsForHardware, getRecommendedQuantization } from "./ai-panel/model-catalog";
import { shouldShowWizard, showAIWizard } from "./setup/ai-wizard";
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
  llamacpp_embeddings: ResourceInfo;
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
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp";
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
  plannerEnabled: boolean;
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
  plannerEnabled: true,
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

async function updateKeychainStatus(): Promise<void> {
  const statusEl = document.getElementById("security-keychain-status");
  if (!statusEl) return;
  const prefs = getPreferences();
  const provider = prefs.aiProvider;
  try {
    const key = await invoke<string | null>("secrets_get", { key: `ai-api-key:${provider}` });
    if (key) {
      statusEl.textContent = `API key for ${provider} stored securely in the OS keychain.`;
      statusEl.style.color = "";
    } else {
      statusEl.textContent = `OS keychain available. No API key stored for ${provider} (set one in AI Provider tab).`;
      statusEl.style.color = "";
    }
  } catch {
    statusEl.textContent = "Keychain not available on this system. API key is stored in browser storage (less secure).";
    statusEl.style.color = "var(--color-danger, #e53e3e)";
  }
}

async function updateAgentWorkspaceInfo(): Promise<void> {
  const pathInput = document.getElementById("pref-agent-workspace-path") as HTMLInputElement | null;
  try {
    const info = await invoke<{ path: string; exists: boolean }>("workspace_info");
    if (pathInput) pathInput.value = info.path;
  } catch {
    if (pathInput) pathInput.value = "Error";
  }
}

async function savePreferences(prefs: Preferences): Promise<void> {
  const prefsToStore = { ...prefs, aiApiKey: "" };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefsToStore));
  if (prefs.aiApiKey !== undefined) {
    setCachedApiKey(prefs.aiProvider, prefs.aiApiKey);
    if (prefs.aiApiKey.trim()) {
      try {
        await invoke("secrets_set", { key: `ai-api-key:${prefs.aiProvider}`, value: prefs.aiApiKey });
      } catch (e) {
        console.error("[secrets] failed to save API key:", e);
      }
    } else {
      try {
        await invoke("secrets_delete", { key: `ai-api-key:${prefs.aiProvider}` });
      } catch (e) {
        console.error("[secrets] failed to delete API key:", e);
    }
  }
}
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
    editor.style.zoom = String(currentZoom / 100);
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
    getCachedApiKey(prefs.aiProvider) ?? "";
  (document.getElementById("pref-ai-base-url") as HTMLInputElement).value =
    prefs.aiBaseUrl;
  // Mark the base URL as "auto-filled" if it matches a known default.
  // This is critical: when the user later changes the provider, the
  // updateApiKeyGroupVisibility() function only re-populates the base
  // URL when dataset.autoFilled === "true" (or the field is empty).
  // Without this marker, a base URL saved from a previous session would
  // prevent the field from updating when the user switches provider,
  // making it look like the feature is broken.
  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
  if (baseUrlInput) {
    const knownDefaults = Object.values(PROVIDER_BASE_URLS) as string[];
    baseUrlInput.dataset.autoFilled = knownDefaults.includes(prefs.aiBaseUrl) ? "true" : "false";
  }
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
  (
    document.getElementById("pref-agent-planner") as HTMLInputElement
  ).checked = prefs.plannerEnabled !== false;

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
    zai: "glm-5.1",
    "local-llamacpp": "local-model",
  };

  if (ollamaModeGroup) {
    if (provider === "ollama") {
      ollamaModeGroup.classList.remove("hidden");
    } else {
      ollamaModeGroup.classList.add("hidden");
    }
  }

  if (apiKeyGroup) {
    if (provider === "local-llamacpp") {
      apiKeyGroup.classList.add("hidden");
    } else {
      apiKeyGroup.classList.remove("hidden");
    }
  }
  if (baseUrlGroup) {
    if (provider === "local-llamacpp") {
      baseUrlGroup.classList.add("hidden");
    } else {
      baseUrlGroup.classList.remove("hidden");
    }
  }
  if (apiKeyHint) {
    if (isOllamaCloud) {
      apiKeyHint.textContent = "Required for Ollama Cloud. Use your OLLAMA_API_KEY from ollama.com.";
    } else if (provider === "ollama") {
      apiKeyHint.textContent = "Optional. Only needed if you ran `ollama signin` to use cloud models through your local Ollama.";
    } else if (provider === "lmstudio") {
      apiKeyHint.textContent = "Not required for LM Studio.";
    } else if (provider === "minimax") {
      apiKeyHint.textContent = "Required. Get your MiniMax API key from platform.minimax.io/user-center/payment-token-plan.";
    } else if (provider === "zai") {
      apiKeyHint.textContent = "Required. Get your Z.ai API key from z.ai/manage-apikey/apikey-list.";
    } else if (provider === "local-llamacpp") {
      apiKeyHint.textContent = "Local model — no API key needed. Configure models in the Local Models tab.";
    } else {
      apiKeyHint.textContent = "Required.";
    }
  }
  if (baseUrlHint) {
    baseUrlHint.textContent = `Default: ${PROVIDER_BASE_URLS[effectiveProvider] || ""}. Leave empty to use default.`;
  }

  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement;
  const llamacppServerGroup = document.getElementById("llamacpp-server-group");
  if (provider === "local-llamacpp") {
    modelInput.placeholder = "Select from list or type path...";
    modelInput.readOnly = false;
    if (llamacppServerGroup) llamacppServerGroup.classList.remove("hidden");
    const savedModel = modelInput.value.trim();
    void populateLocalModelSelect(savedModel);
  } else {
    if (llamacppServerGroup) llamacppServerGroup.classList.add("hidden");
    if (modelInput && defaultModels[effectiveProvider]) {
      const newDefault = defaultModels[effectiveProvider];
      modelInput.placeholder = newDefault;
      modelInput.readOnly = false;
      const currentValue = modelInput.value.trim();
      const isKnownDefault = Object.values(defaultModels).includes(currentValue);
      if (currentValue === "" || isKnownDefault) {
        modelInput.value = newDefault;
      }
      const select = document.getElementById("pref-ai-model-select") as HTMLSelectElement | null;
      if (select) select.innerHTML = '<option value="">— Refresh to load models —</option>';
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
    ? "— No models returned —"
    : "— Select a model —";
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

async function populateLocalModelSelect(currentValue: string): Promise<void> {
  const select = document.getElementById("pref-ai-model-select") as HTMLSelectElement | null;
  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
  if (!select || !modelInput) return;

  select.innerHTML = '<option value="">— Loading local models... —</option>';

  try {
    const models = await invoke("resources_list_chat_models") as Array<{
      id: string;
      filename: string;
      path: string;
      size_bytes: number;
      mmproj_present: boolean;
    }>;

    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = models.length === 0
      ? "— No models downloaded —"
      : "— Select a downloaded model —";
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.path;
      const sizeMB = (m.size_bytes / (1024 * 1024)).toFixed(0);
      opt.textContent = `${m.id} (${m.filename}, ${sizeMB}MB)${m.mmproj_present ? " +vision" : ""}`;
      select.appendChild(opt);
    }

    if (currentValue) {
      const match = Array.from(select.options).find(o => o.value === currentValue);
      if (match) {
        select.value = currentValue;
      }
    }

    setModelStatus(models.length === 0
      ? "No local models found. Download one from the Local Models tab."
      : `${models.length} local model(s) available.`);
  } catch (e) {
    select.innerHTML = '<option value="">— Error loading models —</option>';
    setModelStatus("Failed to load local models: " + (e instanceof Error ? e.message : String(e)), true);
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
    plannerEnabled: chk("pref-agent-planner"),
  };

  savePreferences(prefs);
  updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  window.dispatchEvent(new CustomEvent("aurawrite:preferences-changed"));
}

function setupResizablePanels(): void {
  const STORAGE_KEY = "aurawrite-preferences";
  const DEFAULTS = { ai: 360, projects: 280, suggestions: 320, mcp: 320 } as const;
  const MIN = { ai: 200, projects: 180, suggestions: 200, mcp: 200 } as const;
  const MAX_RATIO = { ai: 0.8, projects: 0.6, suggestions: 0.6, mcp: 0.6 } as const;
  const STORAGE_KEYS = {
    ai: "aiChatPanelWidth",
    projects: "projectPanelWidth",
    suggestions: "suggestionsPanelWidth",
    mcp: "mcpPanelWidth",
  } as const;
  const CSS_VARS = {
    ai: "--ai-panel-width",
    projects: "--project-panel-width",
    suggestions: "--suggestions-panel-width",
    mcp: "--mcp-panel-width",
  } as const;
  const LEFT_EDGED: ReadonlyArray<PanelKey> = ["ai", "mcp"];

  type PanelKey = "ai" | "projects" | "suggestions" | "mcp";
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

  if (llamaStatus) llamaStatus.textContent = `Status: ${status.llamacpp_embeddings.present ? "installed" : "not installed"} (${status.platform}/${status.arch})`;
  if (llamaMeta) llamaMeta.textContent = status.llamacpp_embeddings.present ? `Version: ${status.llamacpp_embeddings.version} · Size: ${formatBytes(status.llamacpp_embeddings.size_bytes)}` : `Will download: ${status.llamacpp_embeddings.download_url}`;
  if (llamaDownload) llamaDownload.style.display = status.llamacpp_embeddings.present ? "none" : "";
  if (llamaRemove) llamaRemove.style.display = status.llamacpp_embeddings.present ? "" : "none";

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
    if (!window.confirm("Remove all local AI resources (llama.cpp, embeddings, nomic)? You can re-download at any time.")) return;
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
      llamaDownload.textContent = "Download llama.cpp (embeddings)";
    }
  });
  llamaRemove?.addEventListener("click", async () => {
    if (!window.confirm("Remove llama.cpp (embeddings)? You can re-download it at any time.")) return;
    await invoke("resources_remove_llamacpp_embeddings");
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
      Promise.allSettled([
        invoke("resources_download_llamacpp"),
        invoke("resources_download_nomic"),
      ])
        .then(() => setupEmbeddingsTab())
        .catch((e) => console.warn("[embeddings onboarding] download failed:", e));
    }
    // After embeddings wizard is dismissed, show AI wizard if needed
    if (shouldShowWizard()) {
      showAIWizard();
    }
  };

  document.getElementById("embeddings-onboarding-close")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-skip")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-download")?.addEventListener("click", () => close(true));
              }

async function loadPermissionsList(): Promise<void> {
  const listEl = document.getElementById("agent-permissions-list");
  if (!listEl) return;
  try {
    const permissions = await invoke<Array<{ path: string; scope: string; tool: string; granted_at: number }>>("permissions_list");
    if (permissions.length === 0) {
      listEl.innerHTML = '<div style="color:var(--color-text-muted);font-size:12px;">No authorized folders yet.</div>';
      return;
    }
    listEl.innerHTML = permissions.map((p) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--color-border);">
        <span style="flex:1;font-size:12px;font-family:monospace;word-break:break-all;">${p.path}</span>
        <span style="font-size:11px;color:var(--color-text-muted);padding:2px 6px;border:1px solid var(--color-border);border-radius:3px;">${p.scope}</span>
        <button class="btn-small permission-remove-btn" data-path="${p.path}" style="color:var(--color-danger, #e53e3e);">Remove</button>
      </div>`
    ).join("");
    listEl.querySelectorAll(".permission-remove-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = (btn as HTMLElement).dataset.path || "";
        try {
          await invoke("permissions_revoke", { path });
          await loadPermissionsList();
        } catch (e) {
          console.error("[agent] revoke permission failed:", e);
        }
      });
    });
  } catch {
    listEl.innerHTML = '<div style="color:var(--color-danger);font-size:12px;">Could not load permissions.</div>';
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initErrorBoundaries();
  initTheme();
  initZoom();

  await preloadApiKey();
  invoke("workspace_init").catch(() => {});
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

  // Local models tab + llama.cpp params tab
  setupLocalModelsTab();
  setupLlamacppParamsTab();

  // AI wizard first launch — only show after embeddings wizard is done
  if (shouldShowWizard() && localStorage.getItem(EMBED_ONBOARDING_KEY)) {
    showAIWizard();
  }

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
        console.error("Raw content_json (first 500 chars):", doc.content_json?.slice(0, 500));
        console.error("Document id:", doc.id, "title:", doc.title);
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
  setupMCPPanel();
  setupSuggestionsPanel(editorView);
  setupToolbar(editorView);

  const initialPrefs = loadAIFromPreferences();
  setContextFooterModel(initialPrefs.aiProvider, initialPrefs.aiModel);
  updateContextFooter();
  window.addEventListener("aurawrite:preferences-changed", () => {
    const prefs = loadAIFromPreferences();
    setContextFooterModel(prefs.aiProvider, prefs.aiModel);
    updateContextFooter();
  });

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
      if (tabName === "agent") loadPermissionsList();
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

  document.getElementById("pref-ai-provider")?.addEventListener("change", async () => {
    const oldProvider = getCurrentProvider();
    const newProviderName = (document.getElementById("pref-ai-provider") as HTMLSelectElement)?.value;
    if (oldProvider && oldProvider instanceof LocalLlamacppProvider && newProviderName !== "local-llamacpp") {
      await oldProvider.shutdownServer();
    }
    updateApiKeyGroupVisibility();
    // Aggiorna il campo API key con la key del nuovo provider (se presente nel keychain),
    // e aggiorna lo stato del keychain nella tab Security.
    const apiKeyField = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
    if (apiKeyField) {
      apiKeyField.value = getCachedApiKey(newProviderName) ?? "";
    }
    void updateKeychainStatus();
    refreshModelList();
    savePreferencesFromModal();
  });
  document.getElementById("pref-ai-ollama-mode")?.addEventListener("change", async () => {
    const oldProvider = getCurrentProvider();
    if (oldProvider && oldProvider instanceof LocalLlamacppProvider) {
      await oldProvider.shutdownServer();
    }
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
    const provider = getEffectiveProvider();
    if (provider === "local-llamacpp") {
      const currentModel = (document.getElementById("pref-ai-model") as HTMLInputElement | null)?.value || "";
      void populateLocalModelSelect(currentModel);
    } else {
      refreshModelList(true);
    }
  });
  document.getElementById("llamacpp-stop-server-ai")?.addEventListener("click", async () => {
    try {
      await invoke("llamacpp_stop_server");
      updateLlamacppServerStatusAI({ running: false, pid: null, port: null, model_path: null });
    } catch (e) {
      console.error("[llamacpp] stop failed:", e);
    }
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

  document.getElementById("pref-reset-all-data")?.addEventListener("click", async () => {
    const confirmed = confirm(
      "This will permanently delete ALL user data:\n\n" +
      "- All downloaded models and llama.cpp\n" +
      "- The project database (all projects, documents, entities)\n" +
      "- All preferences and AI settings\n" +
      "- The AI setup wizard state\n\n" +
      "The app will need to restart. Are you sure?"
    );
    if (!confirmed) return;
    const btn = document.getElementById("pref-reset-all-data") as HTMLButtonElement | null;
    const resultEl = document.getElementById("pref-reset-all-data-result");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Clearing...";
    }
    try {
      await invoke("llamacpp_stop_server").catch(() => {});
      const apiProviders = ["openai", "anthropic", "deepseek", "openrouter", "minimax", "zai"];
      for (const p of apiProviders) {
        await invoke("secrets_delete", { key: `ai-api-key:${p}` }).catch(() => {});
      }
      await invoke("secrets_delete", { key: "ai-api-key" }).catch(() => {});
      await preloadApiKey();
      localStorage.clear();
      const msg = await invoke("resources_clear_all_user_data");
      if (resultEl) resultEl.textContent = String(msg);
      if (btn) btn.textContent = "Done — restart app";
    } catch (e) {
      if (resultEl) resultEl.textContent = "Error: " + (e instanceof Error ? e.message : String(e));
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Reset all data";
      }
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
      "#pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-provider, #pref-ai-model, #pref-ai-api-key, #pref-ai-base-url, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-ai-interface-language, #pref-ai-writing-language, #pref-ai-assistant-name, #pref-ai-user-name, #pref-suggestions-debug, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-entity-extraction-role, #pref-entity-extraction-prompt, #pref-tool-calling-prompt, #pref-deselect-on-click, #pref-semantic-search-enabled, #pref-selection-highlight, #pref-updates-check-enabled, #pref-fonts-use-bundled, #pref-fonts-editor, #pref-fonts-ui, #pref-agent-planner",
    )
    .forEach((el) => {
      el.addEventListener("change", savePreferencesFromModal);
      el.addEventListener("input", savePreferencesFromModal);
    });

  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  btnZoomIn?.addEventListener("click", () => setZoom(10));
  btnZoomOut?.addEventListener("click", () => setZoom(-10));

  updateKeychainStatus();
  document.getElementById("pref-security-test-keychain")?.addEventListener("click", updateKeychainStatus);

  updateAgentWorkspaceInfo();
  document.getElementById("pref-agent-workspace-open")?.addEventListener("click", async () => {
    try {
      await invoke("workspace_open");
    } catch (e) {
      console.error("[agent] workspace open failed:", e);
    }
  });
  document.getElementById("pref-agent-reset-workspace")?.addEventListener("click", async () => {
    const confirmed = confirm("This will delete all files inside the workspace (plans, drafts, notes, attachments).\nThe workspace folder itself will be kept.\n\nAre you sure?");
    if (!confirmed) return;
    try {
      await invoke("workspace_reset");
      updateAgentWorkspaceInfo();
    } catch (e) {
      console.error("[agent] workspace reset failed:", e);
    }
  });

  document.getElementById("pref-agent-add-folder")?.addEventListener("click", async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await invoke("permissions_grant", { path: selected, scope: "always", tool: "*" });
        await loadPermissionsList();
      }
    } catch {
      // user cancelled
    }
  });

  document.getElementById("pref-agent-clear-session")?.addEventListener("click", async () => {
    try {
      await invoke("permissions_clear_session");
      await loadPermissionsList();
    } catch (e) {
      console.error("[agent] clear session permissions failed:", e);
    }
  });

  loadPermissionsList();

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
      searchSimilarEntities: async (projectId: string, query: string, limit = 5) => {
        const queryVector = await invoke('embedding_generate', { text: query, isQuery: true });
        return invoke('embedding_search_entities', { projectId, queryVector, limit });
      },
      getEntityEmbeddings: (entityType: string, entityId: string) =>
        invoke('embedding_get_for_entity', { entityType, entityId }),
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

async function setupLocalModelsTab(): Promise<void> {
  // Models directory
  try {
    const currentDir = await invoke<string>("resources_get_models_dir");
    const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
    if (dirInput) dirInput.value = currentDir;
  } catch (e) {
    console.warn("[models-dir] failed to get models dir:", e);
  }

  document.getElementById("local-models-dir-browse")?.addEventListener("click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    try {
      const newDir = await invoke<string>("resources_set_models_dir", { path: selected });
      const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
      if (dirInput) dirInput.value = newDir;
      await refreshLocalModelList();
    } catch (e) {
      alert("Failed to set models directory: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-models-dir-reset")?.addEventListener("click", async () => {
    try {
      const defaultDir = await invoke<string>("resources_reset_models_dir");
      const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
      if (dirInput) dirInput.value = defaultDir;
      await refreshLocalModelList();
    } catch (e) {
      alert("Failed to reset models directory: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  await refreshHardwareInfo();
  await refreshLocalModelList();
  await refreshLocalModelCatalog();

  document.getElementById("local-hardware-refresh")?.addEventListener("click", async () => {
    await refreshHardwareInfo();
    await refreshLocalModelCatalog();
  });

  document.getElementById("local-model-url-download")?.addEventListener("click", async () => {
    const urlInput = document.getElementById("local-model-url") as HTMLInputElement;
    const idInput = document.getElementById("local-model-url-id") as HTMLInputElement;
    const url = urlInput.value.trim();
    const id = idInput.value.trim();
    if (!url || !id) {
      alert("Please provide both a URL and a Model ID.");
      return;
    }
    if (!url.toLowerCase().endsWith(".gguf")) {
      alert("The URL must point to a .gguf file.");
      return;
    }
    const filename = url.split("/").pop() || `${id}.gguf`;
    setDownloadRetryHandler(id, () => {
      (document.getElementById("local-model-url-download") as HTMLButtonElement)?.click();
    });
    try {
      await invoke("resources_download_chat_model", { modelId: id, url, filename, mmprojUrl: null, mmprojFilename: null });
      urlInput.value = "";
      idInput.value = "";
      await refreshLocalModelList();
    } catch (e) {
      alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-model-path-register")?.addEventListener("click", async () => {
    const pathInput = document.getElementById("local-model-path") as HTMLInputElement;
    const idInput = document.getElementById("local-model-path-id") as HTMLInputElement;
    const filePath = pathInput.value.trim();
    const id = idInput.value.trim();
    if (!filePath || !id) {
      alert("Please provide both a file path and a Model ID.");
      return;
    }
    try {
      const valid = await invoke("resources_verify_model", { filePath }) as boolean;
      if (!valid) {
        alert("The file does not appear to be a valid GGUF model.");
        return;
      }
      await invoke("resources_register_local_model", { modelId: id, filePath });
      pathInput.value = "";
      idInput.value = "";
      await refreshLocalModelList();
    } catch (e) {
      alert("Registration failed: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-llamacpp-download-variant")?.addEventListener("click", async () => {
    const select = document.getElementById("local-llamacpp-variant-select") as HTMLSelectElement;
    let variant = select.value;
    if (variant === "auto") {
      const hw = await invoke("resources_detect_hardware") as any;
      variant = hw.recommended_llamacpp_variant || "cpu";
    }
    const btn = document.getElementById("local-llamacpp-download-variant") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Downloading...";
    setDownloadRetryHandler("llamacpp-" + variant, () => {
      btn?.click();
    });
    try {
      await invoke("resources_download_llamacpp_variant", { variant });
      await refreshLlamacppVariant();
    } catch (e) {
      alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      btn.disabled = false;
      btn.textContent = "Download llama.cpp variant";
    }
  });
}

async function refreshHardwareInfo(): Promise<void> {
  const el = document.getElementById("local-hardware-info");
  if (!el) return;
  try {
    const hw = await invoke("resources_detect_hardware") as any;
    const gpus = hw.gpus.map((g: any) => `${g.vendor} ${g.model} (${formatBytes(g.vram_bytes)} VRAM, ${g.backend})`).join(", ") || "None detected";
    el.innerHTML = `<strong>OS:</strong> ${hw.os}/${hw.arch} &nbsp;|&nbsp; <strong>RAM:</strong> ${formatBytes(hw.ram_total_bytes)} total, ${formatBytes(hw.ram_available_bytes)} available &nbsp;|&nbsp; <strong>GPU:</strong> ${gpus} &nbsp;|&nbsp; <strong>Disk:</strong> ${formatBytes(hw.disk_free_bytes)} free of ${formatBytes(hw.disk_total_bytes)} &nbsp;|&nbsp; <strong>Recommended:</strong> ${hw.recommended_llamacpp_variant}`;
  } catch (e) {
    el.textContent = "Failed to detect hardware: " + (e instanceof Error ? e.message : String(e));
  }
}

async function refreshLocalModelList(): Promise<void> {
  const container = document.getElementById("local-model-list");
  if (!container) return;
  try {
    const models = await invoke("resources_list_chat_models") as any[];
    if (models.length === 0) {
      container.innerHTML = '<p class="preference-hint">No models downloaded yet. Choose one from the catalog above or provide a URL.</p>';
      return;
    }
    container.innerHTML = models.map((m: any) => `
      <div class="preference-row" style="margin-bottom:8px;padding:8px;border:1px solid var(--border-color);border-radius:4px;">
        <div style="flex:1;">
          <strong>${m.id}</strong> &nbsp; ${m.filename} &nbsp; ${formatBytes(m.size_bytes)}
          ${m.mmproj_present ? ' &nbsp; <span style="color:#4caf50;">+ mmproj</span>' : ''}
        </div>
        <button class="pref-btn pref-btn-danger local-model-remove" data-model-id="${m.id}">Remove</button>
      </div>
    `).join("");
    container.querySelectorAll(".local-model-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const modelId = (btn as HTMLElement).dataset.modelId || "";
        if (!confirm(`Remove model "${modelId}"? You can re-download it at any time.`)) return;
        try {
          await invoke("resources_remove_chat_model", { modelId });
          await refreshLocalModelList();
          await refreshLocalModelCatalog();
        } catch (e) {
          alert("Failed to remove model: " + (e instanceof Error ? e.message : String(e)));
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="preference-hint">Error loading models: ' + (e instanceof Error ? e.message : String(e)) + '</p>';
  }
}

async function refreshLocalModelCatalog(): Promise<void> {
  const container = document.getElementById("local-model-catalog");
  if (!container) return;
  try {
    const hw = await invoke("resources_detect_hardware") as any;
    const vram = hw.gpus.length > 0 ? hw.gpus[0].vram_bytes : 0;
    const ram = hw.ram_total_bytes as number;
    const recommended = recommendModelsForHardware(vram, ram);
    const downloaded = await invoke("resources_list_chat_models") as any[];
    const downloadedIds = new Set(downloaded.map((m: any) => m.id));

    container.innerHTML = MODEL_CATALOG.map((model) => {
      const isRecommended = recommended.some((r: any) => r.id === model.id);
      const isDownloaded = downloadedIds.has(model.id);
      const bestQuant = getRecommendedQuantization(model, vram, ram);
      const canFit = model.quantizations.some((q: any) =>
        q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= ram)
      );
      if (!canFit && vram > 0) return "";

      return `
        <div class="catalog-model-card" data-model-id="${model.id}" style="margin-bottom:12px;padding:10px;border:1px solid var(--border-color);border-radius:6px;${isRecommended ? 'border-color:#4caf50;' : ''}${isDownloaded ? 'background:rgba(76,175,80,0.08);' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>${model.name}</strong>
              ${isRecommended ? '<span style="color:#4caf50;">★ Recommended</span>' : ''}
              ${isDownloaded ? '<span style="color:#4caf50;">✓ Downloaded</span>' : ''}
              <br><span class="preference-hint">${model.description}</span>
              <br><span class="preference-hint">${model.total_params} params · ${model.architecture} · ${model.context_length.toLocaleString()} ctx · ${model.license}</span>
            </div>
          </div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;" class="catalog-quant-group" data-model-id="${model.id}">
            ${model.quantizations
              .filter((q: any) => q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= ram))
              .map((q: any) => `
                <button class="pref-btn catalog-quant-btn${bestQuant && bestQuant.id === q.id ? ' pref-btn-primary' : ''}" data-model-id="${model.id}" data-quant-id="${q.id}" data-url="${q.url}" data-filename="${q.filename}" data-quant-name="${q.name}" data-model-name="${model.name}" data-size="${q.size_bytes}">${q.name}</button>
              `).join("")}
          </div>
          ${model.is_multimodal ? '<span class="preference-hint" style="color:#ff9800;">⚡ Multimodal (vision + audio) — mmproj will be downloaded automatically</span>' : ''}
          <div class="catalog-confirm-area" id="catalog-confirm-${model.id}" style="display:none;margin-top:8px;padding:8px;background:var(--color-surface,rgba(0,0,0,0.05));border-radius:4px;"></div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".catalog-quant-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const el = btn as HTMLElement;
        const modelId = el.dataset.modelId || "";
        const _quantId = el.dataset.quantId || "";
        const url = el.dataset.url || "";
        const filename = el.dataset.filename || "";
        const quantName = el.dataset.quantName || "";
        const modelName = el.dataset.modelName || "";
        const sizeBytes = parseInt(el.dataset.size || "0");

        // Deselect all quant buttons in this model card
        const card = el.closest(".catalog-model-card");
        card?.querySelectorAll(".catalog-quant-btn").forEach((b) => b.classList.remove("pref-btn-primary"));
        el.classList.add("pref-btn-primary");

        // Show confirmation area
        const confirmArea = document.getElementById(`catalog-confirm-${modelId}`);
        if (confirmArea) {
          confirmArea.style.display = "block";
          confirmArea.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>Download ${modelName} (${quantName})?</strong><br>
                <span class="preference-hint">${formatBytes(sizeBytes)} — ${url.split('/').pop()}</span>
              </div>
              <button class="pref-btn pref-btn-primary catalog-confirm-download" data-model-id="${modelId}" data-url="${url}" data-filename="${filename}" data-quant-name="${quantName}">Download</button>
            </div>
          `;
          const confirmBtn = confirmArea.querySelector(".catalog-confirm-download");
          if (confirmBtn) {
            (confirmBtn as HTMLButtonElement).addEventListener("click", async () => {
              const model = MODEL_CATALOG.find((m) => m.id === modelId);
              const mmprojUrl = model?.mmproj_url || null;
              const mmprojFilename = model?.mmproj_filename || null;
              (confirmBtn as HTMLButtonElement).disabled = true;
              (confirmBtn as HTMLButtonElement).textContent = "Downloading...";
              setDownloadRetryHandler(modelId, () => {
                (confirmBtn as HTMLButtonElement).click();
              });
              try {
                await invoke("resources_download_chat_model", {
                  modelId,
                  url,
                  filename,
                  mmprojUrl,
                  mmprojFilename,
                });
                (confirmBtn as HTMLButtonElement).textContent = "✓ Done";
                await refreshLocalModelList();
                await refreshLocalModelCatalog();
  } catch (e) {
                (confirmBtn as HTMLButtonElement).textContent = "Failed";
                alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
                setTimeout(() => {
                  (confirmBtn as HTMLButtonElement).disabled = false;
                  (confirmBtn as HTMLButtonElement).textContent = "Download";
                }, 2000);
              }

            });
          }
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="preference-hint">Error loading catalog: ' + (e instanceof Error ? e.message : String(e)) + '</p>';
  }
}

async function refreshLlamacppVariant(): Promise<void> {
  const el = document.getElementById("local-llamacpp-variant");
  if (!el) return;
  try {
    const variant = await invoke("resources_llamacpp_variant") as string;
    el.textContent = `llama.cpp variant installed: ${variant}`;
  } catch {
    el.textContent = "llama.cpp not installed yet";
  }
}

function saveLlamacppParams(): void {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement)?.value || "";
  localStorage.setItem("aurawrite-llamacpp-ctx-size", val("llamacpp-ctx-size"));
  localStorage.setItem("aurawrite-llamacpp-ngl", val("llamacpp-ngl"));
  if (val("llamacpp-ngl-custom")) {
    localStorage.setItem("aurawrite-llamacpp-ngl-custom", val("llamacpp-ngl-custom"));
  }
  localStorage.setItem("aurawrite-llamacpp-fit-target", val("llamacpp-fit-target"));
  localStorage.setItem("aurawrite-llamacpp-cache-type-k", val("llamacpp-cache-type-k"));
  localStorage.setItem("aurawrite-llamacpp-cache-type-v", val("llamacpp-cache-type-v"));
  localStorage.setItem("aurawrite-llamacpp-flash-attn", val("llamacpp-flash-attn"));
  localStorage.setItem("aurawrite-llamacpp-threads", val("llamacpp-threads"));
  localStorage.setItem("aurawrite-llamacpp-port", val("llamacpp-port"));
  localStorage.setItem("aurawrite-llamacpp-batch-size", val("llamacpp-batch-size"));
}

function setupLlamacppParamsTab(): void {
  const nglSelect = document.getElementById("llamacpp-ngl") as HTMLSelectElement;
  const nglCustom = document.getElementById("llamacpp-ngl-custom") as HTMLInputElement;
  if (nglSelect && nglCustom) {
    nglSelect.addEventListener("change", () => {
      nglCustom.style.display = nglSelect.value === "custom" ? "" : "none";
      saveLlamacppParams();
    });
  }

  // Save all llamacpp params to localStorage when they change
  document.querySelectorAll(
    "#llamacpp-ctx-size, #llamacpp-ngl-custom, #llamacpp-fit-target, #llamacpp-cache-type-k, #llamacpp-cache-type-v, #llamacpp-flash-attn, #llamacpp-threads, #llamacpp-port, #llamacpp-batch-size",
  ).forEach((el) => {
    el.addEventListener("change", saveLlamacppParams);
    el.addEventListener("input", saveLlamacppParams);
  });

  document.getElementById("llamacpp-start-server")?.addEventListener("click", async () => {
    const startBtn = document.getElementById("llamacpp-start-server") as HTMLButtonElement | null;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = "Starting...";
    }
    try {
      const modelPath = (document.getElementById("pref-ai-model") as HTMLInputElement | null)?.value?.trim();
      if (!modelPath) {
        alert("No model selected. Please select a model in the AI Provider tab first.");
        return;
      }
      const nglValue = nglSelect?.value === "custom" ? nglCustom?.value : nglSelect?.value;
      let mmprojPath: string | null = null;
      try {
        const models = await invoke("resources_list_chat_models") as Array<{ path: string; mmproj_path: string | null }>;
        const matched = models.find((m) => m.path === modelPath);
        mmprojPath = matched?.mmproj_path || null;
      } catch {
        // ignore
      }
      const result = await invoke("llamacpp_spawn_server", {
        modelPath,
        port: parseInt(localStorage.getItem("aurawrite-llamacpp-port") || "11435"),
        ctxSize: parseInt(localStorage.getItem("aurawrite-llamacpp-ctx-size") || "4096"),
        ngl: nglValue || "all",
        flashAttn: localStorage.getItem("aurawrite-llamacpp-flash-attn") || "auto",
        cacheTypeK: localStorage.getItem("aurawrite-llamacpp-cache-type-k") || "f16",
        cacheTypeV: localStorage.getItem("aurawrite-llamacpp-cache-type-v") || "f16",
        threads: parseInt(localStorage.getItem("aurawrite-llamacpp-threads") || "0") || null,
        mmprojPath,
        noMmprojOffload: false,
        fitTarget: parseInt(localStorage.getItem("aurawrite-llamacpp-fit-target") || "1024") || 1024,
      });
      const status = result as { running: boolean; pid: number | null; port: number | null; model_path: string | null };
      updateLlamacppServerStatus(status);
      if (!status.running) {
        alert("Server failed to start. Check the server status and try again.");
      }
    } catch (e) {
      alert("Failed to start server: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Start server";
      }
    }
  });

  document.getElementById("llamacpp-stop-server")?.addEventListener("click", async () => {
    try {
      await invoke("llamacpp_stop_server");
      updateLlamacppServerStatus({ running: false, pid: null, port: null, model_path: null });
    } catch (e) {
      console.error("[llamacpp] stop failed:", e);
    }
  });

  // Initial status check
  (async () => {
    try {
      const status = await invoke("llamacpp_server_status") as any;
      updateLlamacppServerStatus(status);
    } catch {
      // Server not started yet, that's fine
    }
  })();

  // Periodic status polling every 5 seconds
  setInterval(async () => {
    try {
      const status = await invoke("llamacpp_server_status") as any;
      updateLlamacppServerStatus(status);
    } catch {
      // ignore
    }
  }, 5000);
}

function updateLlamacppServerStatus(status: any): void {
  const el = document.getElementById("llamacpp-server-status");
  const startBtn = document.getElementById("llamacpp-start-server") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("llamacpp-stop-server") as HTMLButtonElement | null;
  if (!el) return;
  if (status.running) {
    el.innerHTML = `<span style="color:#4caf50;">● Running</span> (PID ${status.pid}, port ${status.port})<br>Model: ${status.model_path || "unknown"}`;
    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "";
  } else {
    el.innerHTML = '<span style="color:#999;">○ Not running</span>';
    if (startBtn) startBtn.style.display = "";
    if (stopBtn) stopBtn.style.display = "none";
  }
  updateLlamacppServerStatusAI(status);
}

function updateLlamacppServerStatusAI(status: any): void {
  const el = document.getElementById("llamacpp-server-status-ai");
  const stopBtn = document.getElementById("llamacpp-stop-server-ai") as HTMLButtonElement | null;
  if (!el) return;
  if (status.running) {
    el.innerHTML = `<span style="color:#4caf50;">● Running</span> (PID ${status.pid}, port ${status.port})<br>Model: ${status.model_path || "unknown"}`;
    if (stopBtn) stopBtn.style.display = "";
  } else {
    el.innerHTML = '<span style="color:#999;">○ Not running</span>';
    if (stopBtn) stopBtn.style.display = "none";
  }
}

// ============================================================================
