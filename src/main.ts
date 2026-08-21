import { createEditor, syncDocumentPaginationState } from "./editor/editor";
import { setupToolbar } from "./editor/toolbar";
import { setupAIPanel, resetChatChunks } from "./ai-panel/chat";
import { setupMCPPanel } from "./ai-panel/mcp-panel";
import { setContextFooterModel, updateContextFooter } from "./ai-panel/context-footer";
import { initOcrToolbar } from "./ocr/ocr-toolbar";
import { setupOcrPreferencesTab } from "./ocr/ocr-preferences";
import { loadAIFromPreferences, preloadApiKey } from "./ai-panel/ai-manager";
import { setupSuggestionsPanel } from "./ai-panel/suggestions-panel";
import { initProjectPanel } from "./editor/project-panel";
import { initKeyboardHelp } from "./editor/keyboard-help";
import { initEbookPanel } from "./ebook/panel";
import { initErrorBoundaries } from "./error-boundary";
import { checkForUpdatesOnStartup } from "./updates";
import { EditorState } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { updateDownloadProgress } from "./download-toast";
import { shouldShowWizard, showAIWizard, setAIWizardDismissedCallback } from "./setup/ai-wizard";
import {
  setupEmbeddingsTab,
  maybeShowEmbeddingsOnboarding,
  setupLocalModelsTab,
  setupLlamacppParamsTab,
  EMBED_ONBOARDING_KEY,
} from "./preferences/resources-tab";
import { shouldShowOcrAiWizard, showOcrAiWizard } from "./ocr/ocr-ai-wizard";
import { hexToRgba } from "./utils/format";
import { setupAIProviderTab } from "./preferences/ai-provider-tab";
import {
  type Preferences,
  type ThemeMode,
  getPreferences,
  persistPreferences,
} from "./preferences/store";
import { setupPreferencesModal, savePreferencesFromModal } from "./preferences/modal";
import { updateSecretsStatus, setupAgentAndDataTabs } from "./preferences/agent-tab";
import { setLoading } from "./loading-state";
import { setupResizablePanels } from "./editor/resizable-panels";
import { openFindBar, setupFindReplaceUI } from "./editor/find-replace-ui";
import { setupAppShortcuts } from "./editor/app-shortcuts";
import "./styles.css";

const THEME_KEY = "aurawrite-theme";
const ZOOM_KEY = "aurawrite-zoom";


let currentZoom = 100;


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

  // Loading flag (typed module, still mirrored on window for DevTools)
  setLoading(false);

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
    } else {
      // AI wizard still pending: when it is dismissed (X, skip, overlay or
      // done), show the OCR AI wizard after a short delay. Explicit callback
      // (replaces the MutationObserver on the modal class, refactoring step 1.7).
      setAIWizardDismissedCallback(() => {
        if (shouldShowOcrAiWizard()) {
          setTimeout(() => showOcrAiWizard(), 500);
        }
      });
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

  setupFindReplaceUI(editorView);

  const btnTheme = document.getElementById("btn-theme");
  btnTheme?.addEventListener("click", toggleTheme);

  const modalDeps = { applyPreferences, updateThemeIcon };
  setupPreferencesModal(modalDeps);
  setupAIProviderTab({ savePreferencesFromModal: () => savePreferencesFromModal(modalDeps), updateSecretsStatus });

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

  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  btnZoomIn?.addEventListener("click", () => setZoom(10));
  btnZoomOut?.addEventListener("click", () => setZoom(-10));

  setupAgentAndDataTabs();

  setupAppShortcuts({ openFindBar, zoomIn: () => setZoom(10), zoomOut: () => setZoom(-10) });

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
