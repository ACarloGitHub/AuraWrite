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
import { buildToolSystemPrompt, type ToolPreferences } from "./tools";
import { recordChatTurn, resetSessionUsage } from "./chat-session-usage";
import { resolveContextWindowFromAPI, setCachedContextWindow, getCachedContextWindow } from "./context-window";
import { setContextFooterModel } from "./context-footer";
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

export function getEffectiveProviderName(aiProvider: string, aiOllamaMode: string): string {
  if (aiProvider === "ollama" && aiOllamaMode === "cloud") return "ollama-cloud";
  return aiProvider;
}

let cachedApiKeys: Record<string, string> = {};

export async function preloadApiKey(): Promise<void> {
  cachedApiKeys = {};
  for (const p of API_KEY_PROVIDERS) {
    try {
      const k = await invoke<string | null>("secrets_get", { key: `ai-api-key:${p}` });
      if (k) {
        cachedApiKeys[p] = k;
      }
    } catch (e) {
      console.error(`[secrets] failed to load key for ${p}:`, e);
    }
  }
  await migrateOllamaCloudKey();
  await migrateLegacyApiKey();
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

type ProviderName = "ollama" | "ollama-cloud" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp";

interface PreferencesAI {
  aiProvider: ProviderName;
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiOllamaMode: OllamaMode;
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
      const defaultModel = PROVIDER_DEFAULT_MODELS[provider] || "";
      const apiKey = getCachedApiKey(provider) || "";
      return {
        aiProvider: provider,
        aiModel: parsed.aiModel || defaultModel,
        aiApiKey: apiKey,
        aiBaseUrl: parsed.aiBaseUrl || "",
        aiOllamaMode: ollamaMode,
      };
    } catch {
      return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "", aiOllamaMode: "local" };
    }
  }
  return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "", aiOllamaMode: "local" };
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
  if (provider === "local-llamacpp" || provider === "ollama" || provider === "lmstudio") return;
  const cached = getCachedContextWindow(provider, model);
  if (cached !== null) return;
  const settings = loadAIFromPreferences();
  const apiKey = getCachedApiKey(provider) || "";
  const baseUrl = getProviderBaseUrl(provider as any, settings.aiBaseUrl);
  try {
    const ctx = await resolveContextWindowFromAPI(provider, model, apiKey, baseUrl);
    if (ctx !== null && ctx > 0) {
      setCachedContextWindow(provider, model, ctx);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerAny = current as any;
    if (current.name === "local-llamacpp" && settings.aiModel) {
      const llamacppProv = current as LocalLlamacppProvider;
      const newMmproj = localStorage.getItem("aurawrite-llamacpp-mmproj") || undefined;
      if (llamacppProv.getConfig().modelPath !== settings.aiModel) {
        llamacppProv.setModel(settings.aiModel, newMmproj);
      }
    }
    if (typeof providerAny.setModel === "function" && settings.aiModel && current.name !== "local-llamacpp") {
      const previousModel = providerAny.model;
      providerAny.setModel(settings.aiModel);
      if (previousModel && previousModel !== settings.aiModel) {
        resetSessionUsage();
      }
    }
    if (typeof providerAny.setApiKey === "function") {
      providerAny.setApiKey(settings.aiApiKey);
    }
    if (typeof providerAny.setBaseUrl === "function" && settings.aiBaseUrl) {
      providerAny.setBaseUrl(settings.aiBaseUrl);
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
    const msg =
      `No AI model selected for ${settings.aiProvider}. Please add a model name in Preferences > AI Provider.`;
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