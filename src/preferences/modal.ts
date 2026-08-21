/**
 * Preferences modal: open/close, drag, tab switching, prompt reset,
 * save-from-modal, fonts tab and maintenance tab wiring.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.7).
 *
 * `savePreferencesFromModal` is the synchronous re-read + save used by the
 * AI Provider tab (passed there as a dependency from main.ts).
 */
import { invoke } from "@tauri-apps/api/core";
import { openPath as openLocalPath } from "@tauri-apps/plugin-opener";
import { showErrorToast } from "../error-boundary";
import { populateUserFontsInToolbar, setupFontsReloadListener } from "../editor/fonts-ui";
import { getEffectiveProviderName, getCachedApiKey, preloadApiKey } from "../ai-panel/ai-manager";
import { PROVIDER_BASE_URLS } from "../ai-panel/providers";
import {
  type Preferences,
  type ThemeMode,
  defaultSuggestionsPrompt,
  defaultAIAssistantPrompt,
  defaultEntityExtractionPrompt,
  defaultToolCallingPrompt,
  getPreferences,
  persistPreferences,
} from "./store";
import { updateApiKeyGroupVisibility, refreshModelList } from "./ai-provider-tab";
import { loadPermissionsList } from "./agent-tab";

/** DOM application of preferences (theme, highlight, fonts) stays in main.ts. */
export interface PreferencesModalDeps {
  applyPreferences: (prefs: Preferences) => void;
  updateThemeIcon: (theme: ThemeMode) => void;
}

async function savePreferences(prefs: Preferences, deps: PreferencesModalDeps): Promise<void> {
  await persistPreferences(prefs);
  deps.applyPreferences(prefs);
}

export function openPreferencesModal(): void {
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

  const modal = document.getElementById("preferences-modal");
  const content = modal?.querySelector(".modal-content") as HTMLElement | null;
  if (content) {
    content.style.position = "";
    content.style.left = "";
    content.style.top = "";
    content.style.transform = "";
  }

  if (modal) modal.classList.remove("hidden");
}

export function closePreferencesModal(): void {
  const modal = document.getElementById("preferences-modal");
  if (modal) modal.classList.add("hidden");
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

  listEl.innerHTML = "<em>Scansione in corso…</em>";

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

function resetPrompt(promptType: string, deps: PreferencesModalDeps): void {
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
    savePreferencesFromModal(deps);
  }
}

export function savePreferencesFromModal(deps: PreferencesModalDeps): void {
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

  void savePreferences(prefs, deps);
  deps.updateThemeIcon(prefs.theme);
  updateCustomColorsVisibility();
  updateApiKeyGroupVisibility();

  window.dispatchEvent(new CustomEvent("aurawrite:preferences-changed"));
}

/**
 * Wire the preferences modal: open/close buttons, drag, tab switching,
 * prompt reset buttons, generic change/input save, fonts tab, maintenance
 * tab and reset-all-data. Called once during app bootstrap, in the same
 * position the listeners were originally attached in main.ts.
 */
export function setupPreferencesModal(deps: PreferencesModalDeps): void {
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
      if (promptType) resetPrompt(promptType, deps);
    });
  });

  document.getElementById("pref-theme")?.addEventListener("change", () => {
    updateCustomColorsVisibility();
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

  document
    .querySelectorAll(
      "#pref-theme, #pref-custom-bg, #pref-custom-toolbar, #pref-custom-paper, #pref-custom-text-editor, #pref-custom-text-buttons, #pref-incremental-enabled, #pref-incremental-max, #pref-ai-model, #pref-ai-api-key, #pref-ai-base-url, #pref-ai-suggestions-interval, #pref-ai-context-interval, #pref-ai-interface-language, #pref-ai-writing-language, #pref-ai-assistant-name, #pref-ai-user-name, #pref-suggestions-debug, #pref-suggestions-prompt, #pref-ai-assistant-prompt, #pref-entity-extraction-role, #pref-entity-extraction-prompt, #pref-tool-calling-prompt, #pref-deselect-on-click, #pref-semantic-search-enabled, #pref-selection-highlight, #pref-updates-check-enabled, #pref-fonts-use-bundled, #pref-fonts-editor, #pref-fonts-ui, #pref-agent-planner, #pref-agent-web-search, #pref-agent-file-system, #pref-agent-shell-exec, #pref-agent-rag",
    )
    .forEach((el) => {
      el.addEventListener("change", () => savePreferencesFromModal(deps));
      el.addEventListener("input", () => savePreferencesFromModal(deps));
    });
}
