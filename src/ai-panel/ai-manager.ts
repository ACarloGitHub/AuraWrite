import {
  AIProvider,
  AIContext,
  AIResponse,
  getProviderBaseUrl,
  PROVIDER_DEFAULT_MODELS,
} from "./providers";
import { OllamaProvider, type OllamaMode } from "./ollama-provider";
import { OpenAIProvider, AnthropicProvider, DeepSeekProvider, OpenRouterProvider, LMStudioProvider, MiniMaxProvider, ZAIProvider } from "./remote-providers";
import { LocalLlamacppProvider } from "./local-llamacpp-provider";
import { ManualProvider } from "./manual-provider";
import {
  MANUAL_PROVIDER,
  getManualProfiles,
  getActiveManualProfile,
  getActiveManualName,
  manualSecretName,
  isManualProvider,
  type ManualApiType,
} from "./manual-providers";
import { buildToolSystemPrompt, type ToolPreferences } from "./tools";
import { recordChatTurn, resetSessionUsage } from "./chat-session-usage";
import { resolveContextWindowFromAPI, setCachedContextWindow, getCachedContextWindow } from "./context-window";
import { setContextFooterModel, updateContextFooter } from "./context-footer";
import { invoke } from "@tauri-apps/api/core";

const PREFERENCES_KEY = "aurawrite-preferences";

const API_KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "openrouter",
  "ollama",
  "ollama-cloud",
  "lmstudio",
  "minimax",
  "zai",
] as const;

export function getEffectiveProviderName(aiProvider: string, aiOllamaMode: string, manualName?: string): string {
  if (aiProvider === "ollama" && aiOllamaMode === "cloud") return "ollama-cloud";
  if (aiProvider === MANUAL_PROVIDER) {
    const name = (manualName !== undefined ? manualName : "").trim() || getActiveManualName();
    return name ? manualSecretName(name) : MANUAL_PROVIDER;
  }
  return aiProvider;
}

let cachedApiKeys: Record<string, string> = {};

export async function preloadApiKey(): Promise<void> {
  cachedApiKeys = {};
  for (const p of API_KEY_PROVIDERS) {
    await loadSecretIntoCache(p);
  }
  // Manually registered profiles keep their key in the same encrypted store,
  // under `manual:<profile name>`; they must be reloaded like any provider or
  // the user would have to type the key again at every start.
  for (const profile of getManualProfiles()) {
    await loadSecretIntoCache(manualSecretName(profile.name));
  }
  await migrateOllamaCloudKey();
  await migrateLegacyApiKey();
}

async function loadSecretIntoCache(namespace: string): Promise<void> {
  try {
    const k = await invoke<string | null>("secrets_get", { key: `ai-api-key:${namespace}` });
    if (k) {
      cachedApiKeys[namespace] = k;
    }
  } catch (e) {
    console.error(`[secrets] failed to load key for ${namespace}:`, e);
  }
}

/** Move an in-memory API key to another namespace (manual profile rename). */
export function renameCachedApiKey(from: string, to: string): void {
  const key = cachedApiKeys[from];
  if (key) {
    cachedApiKeys[to] = key;
    delete cachedApiKeys[from];
  }
}

async function migrateOllamaCloudKey(): Promise<void> {
  const stored = localStorage.getItem(PREFERENCES_KEY);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored);
    const ollamaMode = parsed.aiOllamaMode || "local";
    if (ollamaMode !== "cloud") return;
    if (cachedApiKeys["ollama-cloud"]) return;
    const ollamaKey = cachedApiKeys["ollama"];
    if (!ollamaKey) return;
    try {
      await invoke("secrets_set", { key: "ai-api-key:ollama-cloud", value: ollamaKey });
      cachedApiKeys["ollama-cloud"] = ollamaKey;
      console.log("[secrets] migrated ollama key to ollama-cloud");
    } catch {
      // migration failed, keep key in ollama namespace
    }
  } catch {
    // ignore parse errors
  }
}

async function migrateLegacyApiKey(): Promise<void> {
  const stored = localStorage.getItem(PREFERENCES_KEY);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored);
    const legacyKey = parsed.aiApiKey;
    const provider = parsed.aiProvider;
    if (legacyKey && legacyKey.trim() && provider && API_KEY_PROVIDERS.includes(provider)) {
      if (!cachedApiKeys[provider]) {
        try {
          await invoke("secrets_set", { key: `ai-api-key:${provider}`, value: legacyKey });
          cachedApiKeys[provider] = legacyKey;
        } catch {
          // Encryption storage failed — keep legacy key in localStorage
        }
      }
    }
    if (parsed.aiApiKey) {
      parsed.aiApiKey = "";
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(parsed));
    }
  } catch {
    // ignore parse errors
  }
}

export function getCachedApiKey(provider?: string): string | null {
  if (!provider) return null;
  return cachedApiKeys[provider] ?? null;
}

export function setCachedApiKey(provider: string, key: string): void {
  if (!provider) return;
  if (key) cachedApiKeys[provider] = key;
  else delete cachedApiKeys[provider];
}

type ProviderName = "ollama" | "ollama-cloud" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp" | "manual";

interface PreferencesAI {
  aiProvider: ProviderName;
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiOllamaMode: OllamaMode;
  /** Manual profile in use (name and dialect); empty when not manual. */
  aiManualName: string;
  aiManualApiType: ManualApiType;
}

export function loadAIFromPreferences(): PreferencesAI {
  const stored = localStorage.getItem(PREFERENCES_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const storedProvider = parsed.aiProvider || "ollama";
      const ollamaMode: OllamaMode = parsed.aiOllamaMode || "local";
      const provider: ProviderName = (storedProvider === "ollama" && ollamaMode === "cloud")
        ? "ollama-cloud"
        : (storedProvider as ProviderName);
      if (provider === MANUAL_PROVIDER) {
        // A manual profile owns its model / base URL / key: present them in the
        // same shape the rest of the app already expects.
        const profile = getActiveManualProfile();
        const name = profile?.name || "";
        return {
          aiProvider: provider,
          aiModel: profile?.model || parsed.aiModel || "",
          aiApiKey: name ? (getCachedApiKey(manualSecretName(name)) || "") : "",
          aiBaseUrl: profile?.baseUrl || parsed.aiBaseUrl || "",
          aiOllamaMode: ollamaMode,
          aiManualName: name,
          aiManualApiType: profile?.apiType || "openai",
        };
      }
      const defaultModel = PROVIDER_DEFAULT_MODELS[provider] || "";
      const apiKey = getCachedApiKey(provider) || "";
      return {
        aiProvider: provider,
        aiModel: parsed.aiModel || defaultModel,
        aiApiKey: apiKey,
        aiBaseUrl: parsed.aiBaseUrl || "",
        aiOllamaMode: ollamaMode,
        aiManualName: "",
        aiManualApiType: "openai",
      };
    } catch {
      return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "", aiOllamaMode: "local", aiManualName: "", aiManualApiType: "openai" };
    }
  }
  return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "", aiOllamaMode: "local", aiManualName: "", aiManualApiType: "openai" };
}

let currentProvider: AIProvider | null = null;
let isProcessing = false;

export function initAI(): void {
  const settings = loadAIFromPreferences();
  currentProvider = createProvider(settings);
}

function createProvider(settings: PreferencesAI): AIProvider {
  const baseUrl = getProviderBaseUrl(settings.aiProvider, settings.aiBaseUrl);
  switch (settings.aiProvider) {
    case "ollama":
    case "ollama-cloud":
      return new OllamaProvider(
        settings.aiModel,
        baseUrl,
        settings.aiOllamaMode,
        settings.aiApiKey,
      );
    case "openai":
      return new OpenAIProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "anthropic":
      return new AnthropicProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "openrouter":
      return new OpenRouterProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "deepseek":
      return new DeepSeekProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "lmstudio":
      return new LMStudioProvider(settings.aiModel, baseUrl);
    case "minimax":
      return new MiniMaxProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "zai":
      return new ZAIProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "local-llamacpp":
      return new LocalLlamacppProvider({
        modelPath: settings.aiModel,
        port: parseInt(localStorage.getItem("aurawrite-llamacpp-port") || "11435"),
        ctxSize: parseInt(localStorage.getItem("aurawrite-llamacpp-ctx-size") || "4096"),
        ngl: localStorage.getItem("aurawrite-llamacpp-ngl") || "all",
        flashAttn: localStorage.getItem("aurawrite-llamacpp-flash-attn") || "auto",
        cacheTypeK: localStorage.getItem("aurawrite-llamacpp-cache-type-k") || "f16",
        cacheTypeV: localStorage.getItem("aurawrite-llamacpp-cache-type-v") || "f16",
        threads: parseInt(localStorage.getItem("aurawrite-llamacpp-threads") || "0") || undefined,
        fitTarget: parseInt(localStorage.getItem("aurawrite-llamacpp-fit-target") || "1024") || 1024,
      });
    case "manual":
      return new ManualProvider({
        profileName: settings.aiManualName,
        apiType: settings.aiManualApiType,
        baseUrl,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
      });
    default:
      return new OllamaProvider();
  }
}

export function getAISettings(): PreferencesAI {
  return loadAIFromPreferences();
}

export async function updateAISettings(): Promise<void> {
  const settings = loadAIFromPreferences();
  if (currentProvider && currentProvider.name === "local-llamacpp" && settings.aiProvider !== "local-llamacpp") {
    await (currentProvider as LocalLlamacppProvider).shutdownServer();
  }
  currentProvider = createProvider(settings);
  setContextFooterModel(settings.aiProvider, settings.aiModel);
  resolveAndCacheContextWindow(settings.aiProvider, settings.aiModel);
}

export function handlePreferencesChanged(): void {
  updateAISettings();
}

async function resolveAndCacheContextWindow(provider: string, model: string): Promise<void> {
  if (!model) return;
  // local-llamacpp uses the configured ctx-size from preferences; ollama is
  // purely local with no reliable context endpoint. lmstudio IS resolved here
  // (native REST API /api/v1/models) so the active server setting is cached.
  if (provider === "local-llamacpp" || provider === "ollama") return;
  const settings = loadAIFromPreferences();
  // Manual profiles cache and authenticate per profile, not per provider.
  const namespace = provider === MANUAL_PROVIDER
    ? (settings.aiManualName ? manualSecretName(settings.aiManualName) : MANUAL_PROVIDER)
    : provider;
  const cached = getCachedContextWindow(namespace, model);
  if (cached !== null) return;
  const apiKey = getCachedApiKey(namespace) || "";
  const baseUrl = getProviderBaseUrl(provider, settings.aiBaseUrl);
  if (!baseUrl) return;
  try {
    const ctx = await resolveContextWindowFromAPI(
      provider,
      model,
      apiKey,
      baseUrl,
      isManualProvider(provider) ? settings.aiManualApiType : undefined,
    );
    if (ctx !== null && ctx > 0) {
      setCachedContextWindow(namespace, model, ctx);
      // The limit was discovered after the footer was drawn: repaint it, or
      // the screen would keep showing the guess.
      updateContextFooter();
    }
  } catch {
    // Silently fall back to hardcoded table
  }
}

export async function sendToAI(
  prompt: string,
  context?: AIContext,
): Promise<AIResponse> {
  if (!currentProvider) {
    initAI();
  }

  // Check if the current provider requires an API key
  const settings = loadAIFromPreferences();

  // Sync the active provider with the latest settings. This is the safety
  // belt that guarantees the user-selected provider/model/baseUrl/apiKey are
  // applied to the next request, even if the preferences-changed event
  // failed to reach handlePreferencesChanged (e.g. listener not yet
  // attached, event fired before chat panel setup, race condition).
  const current = currentProvider!;
  if (current.name !== settings.aiProvider) {
    if (current.name === "local-llamacpp") {
      await (current as LocalLlamacppProvider).shutdownServer();
    }
    currentProvider = createProvider(settings);
  } else {
    // Settings that can be applied to a provider already in place instead of
    // rebuilding it. Declared as an optional-method shape: the runtime checks
    // stay (not every provider has every setter) but nothing is untyped here.
    const settable = current as typeof current & {
      model?: string;
      setModel?: (model: string) => void;
      setApiKey?: (apiKey: string) => void;
      setBaseUrl?: (baseUrl: string) => void;
      setApiType?: (apiType: ManualApiType) => void;
      setProfileName?: (name: string) => void;
    };
    if (current.name === "local-llamacpp" && settings.aiModel) {
      const llamacppProv = current as LocalLlamacppProvider;
      const newMmproj = localStorage.getItem("aurawrite-llamacpp-mmproj") || undefined;
      if (llamacppProv.getConfig().modelPath !== settings.aiModel) {
        llamacppProv.setModel(settings.aiModel, newMmproj);
      }
    }
    if (typeof settable.setModel === "function" && settings.aiModel && current.name !== "local-llamacpp") {
      const previousModel = settable.model;
      settable.setModel(settings.aiModel);
      if (previousModel && previousModel !== settings.aiModel) {
        resetSessionUsage();
      }
    }
    if (typeof settable.setApiKey === "function") {
      settable.setApiKey(settings.aiApiKey);
    }
    if (typeof settable.setBaseUrl === "function" && settings.aiBaseUrl) {
      settable.setBaseUrl(settings.aiBaseUrl);
    }
    if (typeof settable.setApiType === "function" && settings.aiManualApiType) {
      settable.setApiType(settings.aiManualApiType);
    }
    if (typeof settable.setProfileName === "function" && settings.aiManualName) {
      settable.setProfileName(settings.aiManualName);
    }
  }
  const active = currentProvider!;

  const providersRequiringKey: Array<PreferencesAI["aiProvider"]> = ["openai", "anthropic", "deepseek", "openrouter", "ollama-cloud", "minimax", "zai"];
  if (providersRequiringKey.includes(settings.aiProvider) && !settings.aiApiKey.trim()) {
    const msg =
      `Missing API key for ${settings.aiProvider}. Please add your API key in Preferences > AI Provider.`;
    console.error("[AI]", msg);
    return {
      content: "",
      done: false,
      error: msg,
    };
  }

  // Also warn if no model is set
  if (!settings.aiModel.trim()) {
    const msg = settings.aiProvider === MANUAL_PROVIDER
      ? `No model set for the manual provider "${settings.aiManualName || "unnamed"}". Load the model list (the first model is picked automatically) or type the model name in Preferences > AI Provider.`
      : `No AI model selected for ${settings.aiProvider}. Please add a model name in Preferences > AI Provider.`;
    console.error("[AI]", msg);
    return {
      content: "",
      done: false,
      error: msg,
    };
  }

  try {
    const response = await active.stream(prompt, context);
    recordChatTurn(prompt, context, response);
    return response;
  } catch (error) {
    return {
      content: "",
      done: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

let stoppedByUser = false;

export function stopAI(): void {
  stoppedByUser = true;
  if (currentProvider) {
    currentProvider.stop();
  }
  isProcessing = false;
}

export function wasStoppedByUser(): boolean {
  const val = stoppedByUser;
  return val;
}

export function clearStoppedFlag(): void {
  stoppedByUser = false;
}

export function isAIProcessing(): boolean {
  return isProcessing;
}

export function setProcessing(processing: boolean): void {
  isProcessing = processing;
}

export function extractJson(content: string): string | null {
  if (!content) return null;
  // Strip out thought/thinking blocks completely
  let clean = content.replace(/<(thought|thinking)>[\s\S]*?<\/\1>/gi, "");
  // Find first '{' and last '}'
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    return clean.substring(firstBrace, lastBrace + 1);
  }
  return null;
}

export async function getSynonyms(
  word: string,
  context?: AIContext,
): Promise<string[]> {
  const prompt = `Find synonyms and antonyms for the word "${word}". 
DO NOT output any thinking, reasoning, explanation, or <thought>/<thinking> tags. You must respond IMMEDIATELY and ONLY with valid JSON in this format:
{
  "synonyms": ["word1", "word2", "word3"],
  "antonyms": ["opposite1", "opposite2"]
}
Only include common, usable synonyms. If none found, return empty arrays.`;

  const response = await sendToAI(prompt, context);

  if (response.error || !response.content) {
    return [];
  }

  try {
    const jsonStr = extractJson(response.content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return [...(parsed.synonyms || []), ...(parsed.antonyms || [])];
    }
  } catch {
    // Failed to parse synonyms/antonyms
  }

  return [];
}

export async function improveText(
  text: string,
  instruction: string = "Improve this text",
  context?: AIContext,
): Promise<AIResponse> {
  const prompt = `${instruction}:\n\n"${text}"`;

  return sendToAI(prompt, context);
}

export async function continueText(
  text: string,
  context?: AIContext,
): Promise<AIResponse> {
  const prompt = `Continue the following text naturally:\n\n"${text}"`;

  return sendToAI(prompt, context);
}

export async function suggestAlternatives(
  text: string,
  context?: AIContext,
): Promise<string[]> {
  const prompt = `Suggest 3 alternative ways to write this phrase or sentence.
DO NOT output any thinking, reasoning, explanation, or <thought>/<thinking> tags. You must respond IMMEDIATELY and ONLY with valid JSON in this format:
{
  "alternatives": [
    "alternative 1",
    "alternative 2", 
    "alternative 3"
  ]
}

Original: "${text}"`;

  const response = await sendToAI(prompt, context);

  if (response.error || !response.content) {
    return [];
  }

  try {
    const jsonStr = extractJson(response.content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return parsed.alternatives || [];
    }
  } catch {
    // Failed to parse alternatives
  }

  return [];
}

export function getCurrentProvider(): AIProvider | null {
  return currentProvider;
}

export function buildContextWithTools(context: AIContext): AIContext {
  const saved = localStorage.getItem("aurawrite-preferences");
  const prefs = saved ? JSON.parse(saved) : {};
  const toolPrefs: ToolPreferences = {
    plannerEnabled: prefs.plannerEnabled ?? true,
    webSearchEnabled: prefs.webSearchEnabled ?? true,
    fileSystemEnabled: prefs.fileSystemEnabled ?? true,
    shellExecEnabled: prefs.shellExecEnabled ?? false,
    ragEnabled: prefs.ragEnabled ?? false,
  };

  const hasAnyTool = toolPrefs.plannerEnabled || toolPrefs.webSearchEnabled ||
    toolPrefs.fileSystemEnabled || toolPrefs.ragEnabled || toolPrefs.shellExecEnabled;

  if (!hasAnyTool) {
    return context;
  }

  const toolPrompt = buildToolSystemPrompt(context.projectId, toolPrefs);
  return {
    ...context,
    toolInstructions: toolPrompt,
  };
}