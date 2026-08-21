/**
 * AI Provider preferences tab: provider switching, model listing and the
 * llamacpp server status shown in the AI Provider tab.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.4).
 *
 * CRITICAL CONTRACT (do not break): the provider "change" listener keeps its
 * 3 steps in ONE function, in this exact order:
 *   STEP 1 — update UI fields synchronously (API key, model, base URL)
 *   STEP 2 — save preferences synchronously
 *   STEP 3 — fire-and-forget async work (shutdown, secrets, model list)
 * A generic 'change' listener also watches these fields; suspending on an
 * await before STEP 2 would persist the previous provider's API key under
 * the NEW provider's namespace.
 */
import { invoke } from "@tauri-apps/api/core";
import { PROVIDER_BASE_URLS } from "../ai-panel/providers";
import { listModelsForProvider, getCachedModels, setCachedModels, type ModelInfo } from "../ai-panel/model-listing";
import { getCachedApiKey, getCurrentProvider, getEffectiveProviderName } from "../ai-panel/ai-manager";
import { LocalLlamacppProvider } from "../ai-panel/local-llamacpp-provider";

/** Dependencies that stay in main.ts (wiring, not provider logic). */
export interface AIProviderTabDeps {
  /** Synchronous re-read of the whole preferences modal + save. */
  savePreferencesFromModal: () => void;
  /** Async refresh of the Security tab keychain status. */
  updateSecretsStatus: () => Promise<void>;
}

export function updateApiKeyGroupVisibility(): void {
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
  const lmstudioCtxGroup = document.getElementById("lmstudio-ctx-group");
  if (lmstudioCtxGroup) {
    if (provider === "lmstudio") {
      lmstudioCtxGroup.classList.remove("hidden");
    } else {
      lmstudioCtxGroup.classList.add("hidden");
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
      const isLocalPath = currentValue.includes("\\") || currentValue.startsWith("/") || currentValue.startsWith("%");
      if (currentValue === "" || isKnownDefault || isLocalPath) {
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
    const currentUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
    const isKnownDefault = currentUrl && Object.values(PROVIDER_BASE_URLS).includes(currentUrl);
    if (!currentUrl || isKnownDefault) {
      baseUrlInput.value = defaultUrl;
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
  placeholder.textContent = "— Select a model —";
  placeholder.selected = true;
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

export async function refreshModelList(force = false): Promise<void> {
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

export function updateLlamacppServerStatusAI(status: any): void {
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

/**
 * Wire all AI Provider tab listeners. Must be called during app bootstrap,
 * in the same position the listeners were originally attached in main.ts.
 */
export function setupAIProviderTab(deps: AIProviderTabDeps): void {
  document.getElementById("pref-ai-provider")?.addEventListener("change", () => {
    const newProviderName = (document.getElementById("pref-ai-provider") as HTMLSelectElement)?.value;
    const newOllamaMode = (document.getElementById("pref-ai-ollama-mode") as HTMLSelectElement)?.value || "local";
    const effectiveProvider = getEffectiveProviderName(newProviderName, newOllamaMode);

    // STEP 1: Update UI fields SYNCHRONOUSLY before any async operation.
    // A generic 'change' listener also watches some of these fields; if this
    // listener suspended on an await before refreshing them, that generic
    // listener would read stale values (the previous provider's API key) and
    // persist them under the NEW provider's namespace.
    updateApiKeyGroupVisibility();
    const apiKeyField = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
    if (apiKeyField) {
      apiKeyField.value = getCachedApiKey(effectiveProvider) ?? "";
    }
    const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
    if (modelInput) {
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
        "local-llamacpp": "",
      };
      const newDefault = defaultModels[effectiveProvider] || "";
      if (newDefault) {
        modelInput.value = newDefault;
      }
      const newBaseUrl = PROVIDER_BASE_URLS[effectiveProvider] || "";
      const baseUrlField = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
      if (baseUrlField) {
        baseUrlField.value = newBaseUrl;
      }
    }

    // STEP 2: Save preferences SYNCHRONOUSLY so the refreshed fields above are
    // persisted before any async work can observe stale state.
    deps.savePreferencesFromModal();

    // STEP 3: Async operations, fire-and-forget so they never suspend this
    // listener before the synchronous save above has completed.
    const oldProvider = getCurrentProvider();
    if (oldProvider && oldProvider instanceof LocalLlamacppProvider && newProviderName !== "local-llamacpp") {
      void oldProvider.shutdownServer();
    }
    void deps.updateSecretsStatus();
    refreshModelList();
  });

  document.getElementById("pref-ai-ollama-mode")?.addEventListener("change", () => {
    const provider = (document.getElementById("pref-ai-provider") as HTMLSelectElement)?.value || "ollama";
    const ollamaMode = (document.getElementById("pref-ai-ollama-mode") as HTMLSelectElement)?.value || "local";
    const effectiveProvider = (provider === "ollama" && ollamaMode === "cloud") ? "ollama-cloud" : provider;

    // STEP 1: Update UI synchronously (same anti-race ordering as the provider
    // listener above).
    const baseUrlField = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
    if (baseUrlField) {
      baseUrlField.value = PROVIDER_BASE_URLS[effectiveProvider] || "";
    }
    const apiKeyField = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
    if (apiKeyField) {
      apiKeyField.value = getCachedApiKey(effectiveProvider) ?? "";
    }
    updateApiKeyGroupVisibility();

    // STEP 2: Save synchronously.
    deps.savePreferencesFromModal();

    // STEP 3: Async fire-and-forget.
    const oldProvider = getCurrentProvider();
    if (oldProvider && oldProvider instanceof LocalLlamacppProvider) {
      void oldProvider.shutdownServer();
    }
    refreshModelList();
  });

  document.getElementById("pref-ai-base-url")?.addEventListener("change", () => {
    refreshModelList();
  });

  document.getElementById("pref-ai-lmstudio-ctx")?.addEventListener("input", () => {
    const el = document.getElementById("pref-ai-lmstudio-ctx") as HTMLInputElement | null;
    if (!el) return;
    const val = el.value.trim();
    if (val && parseInt(val, 10) > 0) {
      localStorage.setItem("aurawrite-lmstudio-ctx-size", val);
    } else {
      localStorage.removeItem("aurawrite-lmstudio-ctx-size");
    }
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
    deps.savePreferencesFromModal();
    const current = getCurrentProvider();
    if (current && typeof (current as any).setModel === "function") {
      (current as any).setModel(value);
    }
  });
}
