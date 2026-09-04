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
import { listModelsForProvider, getCachedModels, setCachedModels, clearModelCacheFor, type ModelInfo } from "../ai-panel/model-listing";
import { getCachedApiKey, getCurrentProvider, getEffectiveProviderName, setCachedApiKey, renameCachedApiKey } from "../ai-panel/ai-manager";
import { clearContextCacheFor } from "../ai-panel/context-window";
import {
  MANUAL_PROVIDER,
  getManualProfiles,
  getManualProfile,
  getActiveManualName,
  manualSecretName,
  storeManualProfiles,
  renameManualProfile,
  removeManualProfile,
  migrateManualSecret,
  deleteManualSecret,
  type ManualProfile,
  type ManualApiType,
} from "../ai-panel/manual-providers";
import {
  LocalLlamacppProvider,
  listChatModels,
  type LlamaServerStatus,
} from "../ai-panel/local-llamacpp-provider";

/** Providers that accept a model change without being rebuilt. Every provider
 * class has the method except the local llama.cpp one, which takes a path;
 * checking it at runtime stays correct, but now through a declared shape. */
interface ModelSettable {
  setModel?(model: string): void;
}

/** Dependencies that stay in main.ts (wiring, not provider logic). */
export interface AIProviderTabDeps {
  /** Synchronous re-read of the whole preferences modal + save. */
  savePreferencesFromModal: () => void;
  /** Async refresh of the Security tab keychain status. */
  updateSecretsStatus: () => Promise<void>;
}

/**
 * The preferences-save dependency, kept at module level so the model-list
 * loader can persist the model it picks automatically for a manual profile.
 * Set by setupAIProviderTab() during bootstrap.
 */
let tabDeps: AIProviderTabDeps | null = null;

function manualNameField(): HTMLInputElement | null {
  return document.getElementById("pref-ai-manual-name") as HTMLInputElement | null;
}

function manualSelectField(): HTMLSelectElement | null {
  return document.getElementById("pref-ai-manual-select") as HTMLSelectElement | null;
}

/** Value of the "create one" command inside the dropdown of profiles. */
const NEW_PROFILE_COMMAND = "__new__";

/**
 * Set while the form is showing a profile that has not been registered yet
 * (the user chose "New provider"). It decides whether a name that is not in
 * the list means "create" (fresh form) or "rename" (loaded profile).
 */
let manualFormIsFresh = false;

/**
 * Fill the dropdown of manual providers: one line per profile with a
 * descriptive text (name and address), and the "New provider" command at the
 * end. The value carried back is always the plain name, so no duplicate line
 * is ever shown.
 */
export function renderManualProfiles(activeName: string): void {
  const select = manualSelectField();
  if (!select) return;
  select.innerHTML = "";
  const profiles = getManualProfiles();

  if (profiles.length === 0 && !activeName) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "— No manual provider yet —";
    select.appendChild(empty);
  }

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.name;
    option.textContent = profile.baseUrl ? `${profile.name} — ${profile.baseUrl}` : profile.name;
    select.appendChild(option);
  }

  const create = document.createElement("option");
  create.value = NEW_PROFILE_COMMAND;
  create.textContent = "+ New provider";
  select.appendChild(create);

  const known = profiles.some((p) => p.name.toLowerCase() === (activeName || "").toLowerCase());
  select.value = known ? (findByName(profiles, activeName) as ManualProfile).name : "";
}

function findByName(profiles: ManualProfile[], name: string): ManualProfile | null {
  const needle = (name || "").trim().toLowerCase();
  if (!needle) return null;
  return profiles.find((p) => p.name.toLowerCase() === needle) || null;
}

/** Blank every field a manual profile owns: a new one never inherits. */
function clearManualForm(): void {
  const nameInput = manualNameField();
  if (nameInput) nameInput.value = "";
  const typeSelect = document.getElementById("pref-ai-manual-type") as HTMLSelectElement | null;
  if (typeSelect) typeSelect.value = "openai";
  const ctxInput = document.getElementById("pref-ai-manual-ctx") as HTMLInputElement | null;
  if (ctxInput) ctxInput.value = "";
  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
  if (baseUrlInput) baseUrlInput.value = "";
  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
  if (modelInput) modelInput.value = "";
  const apiKeyInput = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
  if (apiKeyInput) apiKeyInput.value = "";
}

/** Put one profile's values into the form (fields the user can then edit). */
export function loadManualProfileIntoForm(profile: ManualProfile | null): void {
  manualFormIsFresh = false;
  if (!profile) {
    clearManualForm();
    return;
  }
  const nameInput = manualNameField();
  const typeSelect = document.getElementById("pref-ai-manual-type") as HTMLSelectElement | null;
  const ctxInput = document.getElementById("pref-ai-manual-ctx") as HTMLInputElement | null;
  const baseUrlInput = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
  const apiKeyInput = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;

  if (!profile) {
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "openai";
    if (ctxInput) ctxInput.value = "";
    if (baseUrlInput) baseUrlInput.value = "";
    if (modelInput) modelInput.value = "";
    if (apiKeyInput) apiKeyInput.value = "";
    return;
  }
  if (nameInput) nameInput.value = profile.name;
  if (typeSelect) typeSelect.value = profile.apiType;
  if (ctxInput) ctxInput.value = profile.contextSize > 0 ? String(profile.contextSize) : "";
  if (baseUrlInput) baseUrlInput.value = profile.baseUrl;
  if (modelInput) modelInput.value = profile.model;
  if (apiKeyInput) apiKeyInput.value = getCachedApiKey(manualSecretName(profile.name)) ?? "";
}

/** The manual profile the form is editing (by the name typed in the field). */
function manualProfileInForm(): ManualProfile | null {
  return getManualProfile(manualNameField()?.value || "");
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

  // Manual provider: its own fields (profile name + delete, wire dialect,
  // context size). The API key and base URL groups stay visible: a manual
  // service always needs an address, and its key is optional.
  const isManual = provider === MANUAL_PROVIDER;
  const manualProviderGroup = document.getElementById("manual-provider-group");
  const manualTypeGroup = document.getElementById("manual-type-group");
  const manualCtxGroup = document.getElementById("manual-ctx-group");
  for (const group of [manualProviderGroup, manualTypeGroup, manualCtxGroup]) {
    if (!group) continue;
    group.classList.toggle("hidden", !isManual);
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
    } else if (isManual) {
      apiKeyHint.textContent = "Optional. Needed by online services, and by a local server only if it was started with an API key. Leave empty to send no key.";
    } else {
      apiKeyHint.textContent = "Required.";
    }
  }
  if (baseUrlHint) {
    if (isManual) {
      const sample = manualProfileInForm()?.baseUrl || "";
      baseUrlHint.textContent = `Required. Type the full address of the service, including its version path (usually /v1)${sample ? `. Currently: ${sample}` : ""}.`;
    } else {
      baseUrlHint.textContent = `Default: ${PROVIDER_BASE_URLS[effectiveProvider] || ""}. Leave empty to use default.`;
    }
  }

  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement;
  const llamacppServerGroup = document.getElementById("llamacpp-server-group");
  if (provider === "local-llamacpp") {
    modelInput.placeholder = "Select from list or type path...";
    modelInput.readOnly = false;
    if (llamacppServerGroup) llamacppServerGroup.classList.remove("hidden");
    const savedModel = modelInput.value.trim();
    void populateLocalModelSelect(savedModel);
  } else if (isManual) {
    // A manual profile owns its model and address: never overwrite them with
    // defaults, and never blank the fields — the profile in the form is the
    // user's own text.
    if (llamacppServerGroup) llamacppServerGroup.classList.add("hidden");
    if (modelInput) {
      modelInput.placeholder = "Load the list, or type the model name...";
      modelInput.readOnly = false;
    }
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
  if (baseUrlInput && !isManual) {
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
  // Manual profiles are cached and authenticated per profile: the namespace
  // carries the name typed in the form (or the stored active one).
  if (provider === MANUAL_PROVIDER) {
    const name = (manualNameField()?.value || "").trim() || getActiveManualName();
    return name ? manualSecretName(name) : MANUAL_PROVIDER;
  }
  return provider;
}

function getEffectiveApiType(): ManualApiType {
  const select = document.getElementById("pref-ai-manual-type") as HTMLSelectElement | null;
  return select?.value === "anthropic" ? "anthropic" : "openai";
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
    const models = await listChatModels();

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
  const isManual = provider === MANUAL_PROVIDER || provider.startsWith(`${MANUAL_PROVIDER}:`);
  const apiKey = (document.getElementById("pref-ai-api-key") as HTMLInputElement | null)?.value || "";
  const hasApiKey = apiKey.trim().length > 0;
  const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;
  const currentModel = modelInput?.value || "";

  if (!baseUrl) {
    setModelStatus(isManual
      ? "Type the service address above, then click \u21bb to load its models."
      : "No base URL configured.", !isManual);
    return;
  }

  if (!force) {
    const cached = getCachedModels(provider, baseUrl, hasApiKey);
    if (cached) {
      populateModelSelect(cached, currentModel);
      setModelStatus(`Showing ${cached.length} cached model(s). Click \u21bb to refresh.`);
      maybeAdoptFirstManualModel(cached, isManual);
      return;
    }
  }

  setModelStatus("Loading models...");
  try {
    const models = await listModelsForProvider(provider, baseUrl, apiKey, isManual ? getEffectiveApiType() : undefined);
    setCachedModels(provider, baseUrl, hasApiKey, models);
    populateModelSelect(models, currentModel);
    setModelStatus(`Loaded ${models.length} model(s) from ${provider}.`);
    maybeAdoptFirstManualModel(models, isManual);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ModelListing]", error);
    populateModelSelect([], currentModel);
    setModelStatus(isManual
      ? `The service did not return a model list (${msg}). Type the model name in the field above — a server with one model loaded accepts any name.`
      : `Failed: ${msg}`, true);
  }
}

/**
 * A manual profile with no model yet adopts the first model the service
 * reports. This is what makes a locally started llama-server work without the
 * user copying the model path by hand.
 */
function maybeAdoptFirstManualModel(models: ModelInfo[], isManual: boolean): void {
  if (!isManual || models.length === 0) return;
  const input = document.getElementById("pref-ai-model") as HTMLInputElement | null;
  if (!input || input.value.trim()) return;
  input.value = models[0].id;
  setModelStatus(`Using "${models[0].id}" — the only model needed to start. Change it whenever you want.`);
  tabDeps?.savePreferencesFromModal();
}

export function updateLlamacppServerStatusAI(status: LlamaServerStatus): void {
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
  tabDeps = deps;

  // Manual provider profiles: name combo (create / select / rename) and the
  // delete button. Registered BEFORE the provider switch listener runs, so
  // switching to "Manual" always finds a wired form.
  setupManualProfileControls(deps);

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
    const baseUrlField = document.getElementById("pref-ai-base-url") as HTMLInputElement | null;
    const apiKeyField = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
    const modelInput = document.getElementById("pref-ai-model") as HTMLInputElement | null;

    if (newProviderName === MANUAL_PROVIDER) {
      // Switching to "Manual": show the profile in use, exactly as stored.
      renderManualProfiles(getActiveManualName());
      loadManualProfileIntoForm(getManualProfile(getActiveManualName()));
    } else {
      if (apiKeyField) {
        apiKeyField.value = getCachedApiKey(effectiveProvider) ?? "";
      }
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
      }
      if (baseUrlField) {
        baseUrlField.value = PROVIDER_BASE_URLS[effectiveProvider] || "";
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
    if (current) {
      const settable = current as ModelSettable;
      if (typeof settable.setModel === "function") {
        settable.setModel(value);
      }
    }
  });
}

/**
 * Wire the manual provider controls.
 *
 * Two controls, no guessing:
 *   - the dropdown lists the registered providers (descriptive text) and ends
 *     with the command "+ New provider";
 *   - the name field carries the name of the provider in the form.
 *
 * So a name that is not in the list can only mean one thing:
 *   - the form came from "+ New provider"  → the name CREATES a provider;
 *   - the form holds a loaded provider     → the name RENAMES it (its API key
 *     and caches follow the new name).
 * A name that IS in the list always means "that one" (selection), so no
 * duplicate is ever created.
 */
function setupManualProfileControls(deps: AIProviderTabDeps): void {
  const nameInput = manualNameField();
  const select = manualSelectField();
  const deleteBtn = document.getElementById("pref-ai-manual-delete") as HTMLButtonElement | null;

  /** Make one registered profile the one in the form. */
  const chooseProfile = (profile: ManualProfile) => {
    storeManualProfiles(getManualProfiles(), profile.name);
    loadManualProfileIntoForm(profile);
    renderManualProfiles(profile.name);
    deps.savePreferencesFromModal();
    void refreshModelList();
  };

  select?.addEventListener("change", () => {
    const value = select.value;
    if (value === NEW_PROFILE_COMMAND) {
      // Fresh form: every field of a provider, so a new one never inherits.
      // Nothing is saved here: the previous profile keeps its own settings and
      // its stored key until the new name is committed.
      manualFormIsFresh = true;
      clearManualForm();
      const modelSelect = document.getElementById("pref-ai-model-select") as HTMLSelectElement | null;
      if (modelSelect) modelSelect.innerHTML = '<option value="">— Load the list after filling the address —</option>';
      if (nameInput) nameInput.focus();
      setModelStatus("New provider: type its name, then its address, and load its models.", false);
      return;
    }
    if (!value) return;
    const profile = getManualProfile(value);
    if (profile) chooseProfile(profile);
  });

  nameInput?.addEventListener("change", () => {
    const typed = nameInput.value.trim();
    nameInput.value = typed;
    const loadedName = getActiveManualName();
    const loaded = loadedName ? getManualProfile(loadedName) : null;

    if (!typed) {
      // Blank name registers nothing; the stored list stays as it is.
      deps.savePreferencesFromModal();
      return;
    }

    const existing = getManualProfile(typed);
    if (existing) {
      if (manualFormIsFresh || !loaded || loaded.name.toLowerCase() !== existing.name.toLowerCase()) {
        // The name is taken: show the registered provider instead of creating
        // a second one with the same identity.
        setModelStatus(`"${existing.name}" is already registered — its settings are shown.`, false);
      }
      chooseProfile(existing);
      return;
    }

    if (!manualFormIsFresh && loaded && loaded.name.toLowerCase() !== typed.toLowerCase()) {
      // Renaming the provider in the form: identity moves with its key.
      if (renameManualProfile(loaded.name, typed)) {
        renameCachedApiKey(manualSecretName(loaded.name), manualSecretName(typed));
        clearModelCacheFor(manualSecretName(loaded.name));
        clearContextCacheFor(manualSecretName(loaded.name));
        void migrateManualSecret(loaded.name, typed).then(() => deps.updateSecretsStatus());
        setModelStatus(`Renamed to "${typed}" — its address, model and API key followed.`, false);
      } else {
        setModelStatus(`A manual provider named "${typed}" already exists.`, true);
        loadManualProfileIntoForm(loaded);
        return;
      }
    } else {
      // Creation (or the very first provider): remember the name; the fields
      // on screen become the profile at the next save.
      storeManualProfiles(getManualProfiles(), typed);
      manualFormIsFresh = false;
    }

    renderManualProfiles(typed);
    deps.savePreferencesFromModal();
    void refreshModelList();
  });

  deleteBtn?.addEventListener("click", async () => {
    const typed = (nameInput?.value || getActiveManualName()).trim();
    const profile = getManualProfile(typed);
    if (!profile) {
      setModelStatus("There is no manual provider with that name to delete.", true);
      return;
    }
    const hasKey = !!getCachedApiKey(manualSecretName(profile.name));
    const confirmed = confirm(
      `Delete the manual provider "${profile.name}"?\n\n` +
      `This removes its address, its model and its saved settings` +
      `${hasKey ? " together with its API key" : " (no API key is stored for it)"}.\n` +
      "Other providers and manual profiles are untouched.",
    );
    if (!confirmed) return;

    await deleteManualSecret(profile.name);
    setCachedApiKey(manualSecretName(profile.name), "");
    clearModelCacheFor(manualSecretName(profile.name));
    clearContextCacheFor(manualSecretName(profile.name));

    const remaining = removeManualProfile(profile.name);
    const next = remaining[0];
    if (next) {
      loadManualProfileIntoForm(next);
    } else {
      loadManualProfileIntoForm(null);
      manualFormIsFresh = true;
    }
    renderManualProfiles(next ? next.name : "");
    // Save last: the form now shows the surviving profile (or nothing), so the
    // deleted one cannot be folded back into the list.
    deps.savePreferencesFromModal();
    void deps.updateSecretsStatus();
    void refreshModelList();
    setModelStatus(next
      ? `"${profile.name}" deleted. Now editing "${next.name}".`
      : `"${profile.name}" deleted. No manual provider left.`, false);
  });

  document.getElementById("pref-ai-manual-type")?.addEventListener("change", () => {
    // The dialect decides how the model list is asked for.
    void refreshModelList();
  });

  // Clearing the key field is the one deliberate way to drop a stored key, and
  // it only applies to the manual provider in the form (see store.ts: a global
  // save never deletes secrets as a side effect).
  const apiKeyInput = document.getElementById("pref-ai-api-key") as HTMLInputElement | null;
  apiKeyInput?.addEventListener("change", async () => {
    const provider = (document.getElementById("pref-ai-provider") as HTMLSelectElement | null)?.value;
    if (provider !== MANUAL_PROVIDER || apiKeyInput.value.trim()) return;
    const name = (nameInput?.value || getActiveManualName()).trim();
    const namespace = manualSecretName(name);
    if (!getCachedApiKey(namespace)) return;
    await deleteManualSecret(name);
    setCachedApiKey(namespace, "");
    clearModelCacheFor(namespace);
    renderManualProfiles(name);
    void deps.updateSecretsStatus();
    setModelStatus(`Stored API key of "${name}" removed — requests will be sent without a key.`, false);
  });
}
