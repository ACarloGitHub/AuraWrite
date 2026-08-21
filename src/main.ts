import { createEditor, syncDocumentPaginationState } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel, resetChatChunks } from "./ai-panel/chat";
import { setupMCPPanel } from "./ai-panel/mcp-panel";
import { setContextFooterModel, updateContextFooter } from "./ai-panel/context-footer";
import { initOcrToolbar } from "./ocr/ocr-toolbar";
import { setupOcrPreferencesTab } from "./ocr/ocr-preferences";
import { loadAIFromPreferences, preloadApiKey, getCachedApiKey, getEffectiveProviderName } from "./ai-panel/ai-manager";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { initProjectPanel } from "./editor/project-panel";
import { initKeyboardHelp } from "./editor/keyboard-help";
import { initEbookPanel } from "./ebook/panel";
import { initErrorBoundaries, showErrorToast } from "./error-boundary";
import { checkForUpdatesOnStartup } from "./updates";
import { PROVIDER_BASE_URLS } from "./ai-panel/providers";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { updateDownloadProgress } from "./download-toast";
import { shouldShowWizard, showAIWizard } from "./setup/ai-wizard";
import {
  setupEmbeddingsTab,
  maybeShowEmbeddingsOnboarding,
  setupLocalModelsTab,
  setupLlamacppParamsTab,
  EMBED_ONBOARDING_KEY,
} from "./preferences/resources-tab";
import { shouldShowOcrAiWizard, showOcrAiWizard } from "./ocr/ocr-ai-wizard";
import { hexToRgba } from "./utils/format";
import {
  updateApiKeyGroupVisibility,
  refreshModelList,
  setupAIProviderTab,
} from "./preferences/ai-provider-tab";
import { openPath as openLocalPath } from "@tauri-apps/plugin-opener";
import {
  type Preferences,
  type ThemeMode,
  defaultSuggestionsPrompt,
  defaultAIAssistantPrompt,
  defaultEntityExtractionPrompt,
  defaultToolCallingPrompt,
  getPreferences,
  persistPreferences,
} from "./preferences/store";
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
  goToFirstMatch,
} from "./editor/find-replace";
import "./styles.css";

const THEME_KEY = "aurawrite-theme";
const ZOOM_KEY = "aurawrite-zoom";


let currentZoom = 100;


async function updateSecretsStatus(): Promise<void> {
  const statusEl = document.getElementById("security-keychain-status");
  if (!statusEl) return;
  const prefs = getPreferences();
  const effectiveProvider = getEffectiveProviderName(prefs.aiProvider, prefs.aiOllamaMode);
  try {
    const key = await invoke<string | null>("secrets_get", { key: `ai-api-key:${effectiveProvider}` });
    if (key) {
      statusEl.textContent = `API key for ${effectiveProvider} stored securely (encrypted).`;
      statusEl.style.color = "";
    } else {
      statusEl.textContent = `No API key stored for ${effectiveProvider} (set one in AI Provider tab).`;
      statusEl.style.color = "";
    }
  } catch {
    statusEl.textContent = "Encrypted storage not available. Please re-enter your API keys.";
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
  await persistPreferences(prefs);
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
  const effectiveProviderForKey = getEffectiveProviderName(prefs.aiProvider, prefs.aiOllamaMode);
  (document.getElementById("pref-ai-api-key") as HTMLInputElement).value =
    getCachedApiKey(effectiveProviderForKey) ?? "";
  const effectiveProviderForUrl = (prefs.aiProvider === "ollama" && prefs.aiOllamaMode === "cloud")
    ? "ollama-cloud" : prefs.aiProvider;
  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
  if (baseUrlInput) {
    const savedUrl = prefs.aiBaseUrl.trim().replace(/\/+$/, "");
    const defaultUrl = PROVIDER_BASE_URLS[effectiveProviderForUrl] || "";
    if (savedUrl) {
      baseUrlInput.value = savedUrl;
    } else {
      baseUrlInput.value = defaultUrl;
    }
  }
  const lmstudioCtxInput = document.getElementById("pref-ai-lmstudio-ctx") as HTMLInputElement | null;
  if (lmstudioCtxInput) {
    lmstudioCtxInput.value = localStorage.getItem("aurawrite-lmstudio-ctx-size") || "";
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
  (
    document.getElementById("pref-agent-web-search") as HTMLInputElement
  ).checked = prefs.webSearchEnabled !== false;
  (
    document.getElementById("pref-agent-file-system") as HTMLInputElement
  ).checked = prefs.fileSystemEnabled !== false;
  (
    document.getElementById("pref-agent-shell-exec") as HTMLInputElement
  ).checked = prefs.shellExecEnabled === true;
  (
    document.getElementById("pref-agent-rag") as HTMLInputElement
  ).checked = prefs.ragEnabled === true;

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
    webSearchEnabled: chk("pref-agent-web-search"),
    fileSystemEnabled: chk("pref-agent-file-system"),
    shellExecEnabled: chk("pref-agent-shell-exec"),
    ragEnabled: chk("pref-agent-rag"),
  };

  savePreferences(prefs);
  updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  window.dispatchEvent(new CustomEvent("aurawrite:preferences-changed"));
}

function setupResizablePanels(): void {
  const STORAGE_KEY = "aurawrite-preferences";
  const DEFAULTS = { ai: 360, projects: 320, suggestions: 320, mcp: 320, ebooks: 320 } as const;
  const MIN = { ai: 200, projects: 180, suggestions: 200, mcp: 200, ebooks: 200 } as const;
  const MAX_RATIO = { ai: 0.8, projects: 0.6, suggestions: 0.6, mcp: 0.6, ebooks: 0.6 } as const;
  const STORAGE_KEYS = {
    ai: "aiChatPanelWidth",
    projects: "projectPanelWidth",
    suggestions: "suggestionsPanelWidth",
    mcp: "mcpPanelWidth",
    ebooks: "ebooksPanelWidth",
  } as const;
  const CSS_VARS = {
    ai: "--ai-panel-width",
    projects: "--project-panel-width",
    suggestions: "--suggestions-panel-width",
    mcp: "--mcp-panel-width",
    ebooks: "--ebooks-panel-width",
  } as const;
  const LEFT_EDGED: ReadonlyArray<PanelKey> = ["ai", "mcp"];

  type PanelKey = "ai" | "projects" | "suggestions" | "mcp" | "ebooks";
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

async function loadPrivacyStats(): Promise<void> {
  try {
    const stats = await invoke<{
      chat_sessions: number;
      chat_messages: number;
      rag_entities: number;
      rag_chunks: number;
      wiki_pages: number;
      plans: number;
    }>("data_stats");

    const chatCount = document.getElementById("pref-data-chat-count");
    const ragCount = document.getElementById("pref-data-rag-count");
    const wikiCount = document.getElementById("pref-data-wiki-count");
    const plansCount = document.getElementById("pref-data-plans-count");

    if (chatCount) chatCount.textContent = `${stats.chat_sessions} sessions, ${stats.chat_messages} messages`;
    if (ragCount) ragCount.textContent = `${stats.rag_entities} entities, ${stats.rag_chunks} chunks`;
    if (wikiCount) wikiCount.textContent = `${stats.wiki_pages} pages`;
    if (plansCount) plansCount.textContent = `${stats.plans} plans`;
  } catch (e) {
    console.error("[agent] failed to load privacy stats:", e);
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

  // OCR preferences tab
  setupOcrPreferencesTab();

  // AI wizard first launch — only show after embeddings wizard is done
  if (shouldShowWizard() && localStorage.getItem(EMBED_ONBOARDING_KEY)) {
    showAIWizard();
  }

  // OCR AI wizard — show after AI wizard is dismissed (same session or next launch)
  if (shouldShowOcrAiWizard()) {
    if (!shouldShowWizard()) {
      // AI wizard already dismissed — show OCR AI wizard now
      showOcrAiWizard();
    }
    // If AI wizard is still pending, the OCR AI wizard will show on next app launch
    // after the AI wizard is dismissed, or we can show it when AI wizard closes.
    // We listen for the AI wizard modal closing to show OCR AI wizard immediately.
    const aiWizardModal = document.getElementById("ai-wizard-modal");
    if (aiWizardModal) {
      const observer = new MutationObserver(() => {
        if (aiWizardModal.classList.contains("hidden") && shouldShowOcrAiWizard()) {
          observer.disconnect();
          setTimeout(() => showOcrAiWizard(), 500);
        }
      });
      observer.observe(aiWizardModal, { attributes: true, attributeFilter: ["class"] });
    }
  }

  // Initialize project panel
  initProjectPanel({
    onDocumentSelect: (doc) => {
      console.log("Document selected:", doc.title);
      void import("./editor/codemirror-editor").then((m) => m.closeCodeMirror());
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
  initOcrToolbar(() => editorView);
  initEbookPanel();

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

  function openFindBar(): void {
    findBar?.classList.remove("hidden");
    findInput?.focus();
    findInput?.select();
  }

  function closeFindBar(): void {
    findBar?.classList.add("hidden");
    clearFind(editorView);
  }

  const btnFind = document.getElementById("btn-find");
  btnFind?.addEventListener("click", () => openFindBar());

  document.getElementById("find-close")?.addEventListener("click", closeFindBar);

  findInput?.addEventListener("input", () => {
    setFindQuery(findInput.value, editorView);
  });

  findInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goToFirstMatch(editorView, true);
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

  setupAIProviderTab({ savePreferencesFromModal, updateSecretsStatus });

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
      const apiProviders = ["openai", "anthropic", "deepseek", "openrouter", "ollama", "ollama-cloud", "lmstudio", "minimax", "zai"];
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
      "#pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-model, #pref-ai-api-key, #pref-ai-base-url, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-ai-interface-language, #pref-ai-writing-language, #pref-ai-assistant-name, #pref-ai-user-name, #pref-suggestions-debug, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-entity-extraction-role, #pref-entity-extraction-prompt, #pref-tool-calling-prompt, #pref-deselect-on-click, #pref-semantic-search-enabled, #pref-selection-highlight, #pref-updates-check-enabled, #pref-fonts-use-bundled, #pref-fonts-editor, #pref-fonts-ui, #pref-agent-planner, #pref-agent-web-search, #pref-agent-file-system, #pref-agent-shell-exec, #pref-agent-rag",
    )
    .forEach((el) => {
      el.addEventListener("change", savePreferencesFromModal);
      el.addEventListener("input", savePreferencesFromModal);
    });

  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  btnZoomIn?.addEventListener("click", () => setZoom(10));
  btnZoomOut?.addEventListener("click", () => setZoom(-10));

  updateSecretsStatus();

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
    const { open } = await import("@tauri-apps/plugin-dialog");
    let selected: string | null = null;
    try {
      const result = await open({ directory: true, multiple: false });
      if (typeof result === "string") selected = result;
    } catch (e) {
      console.error("[agent] folder picker failed:", e);
      return;
    }
    if (!selected) return; // user cancelled the dialog
    try {
      await invoke("permissions_grant", { path: selected, scope: "always", tool: "*" });
      await loadPermissionsList();
    } catch (e) {
      console.error("[agent] add folder permission failed:", e);
      alert("Failed to add folder: " + (e as Error).message);
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

  // Data & Privacy buttons in Preferences
  loadPrivacyStats();

  document.getElementById("pref-data-chat-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL chat history? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("chat_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] chat reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-rag-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL RAG data? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("rag_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] rag reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-wiki-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL wiki pages? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("wiki_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] wiki reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-plans-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete ALL plans? This cannot be undone.")) return;
    try {
      const result = await invoke<string>("plan_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] plans reset failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

  document.getElementById("pref-data-delete-all")?.addEventListener("click", async () => {
    if (!confirm("⚠️ Delete ALL AI data? This includes chat history, RAG index, wiki pages, and plans. This CANNOT be undone.")) return;
    try {
      const result = await invoke<string>("data_reset_all");
      alert(result);
      loadPrivacyStats();
    } catch (e) {
      console.error("[agent] data reset all failed:", e);
      alert("Failed: " + (e as Error).message);
    }
  });

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
      // Ctrl+S always triggers File > Save (the current file), never the
      // project save (which has its own "Save Project" button).
      const saveBtn = document.querySelector(
        '.dropdown-item[data-action="save"]'
      ) as HTMLButtonElement | null;
      saveBtn?.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      openFindBar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "h") {
      e.preventDefault();
      openFindBar();
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

// ============================================================================
