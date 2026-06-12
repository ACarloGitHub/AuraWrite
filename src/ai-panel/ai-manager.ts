import {
  AIProvider,
  AIContext,
  AIResponse,
  getProviderBaseUrl,
  PROVIDER_DEFAULT_MODELS,
} from "./providers";
import { OllamaProvider, type OllamaMode } from "./ollama-provider";
import { OpenAIProvider, AnthropicProvider, DeepSeekProvider, OpenRouterProvider, LMStudioProvider, MiniMaxProvider } from "./remote-providers";
import { buildToolSystemPrompt } from "./tools";
import { recordChatTurn, resetSessionUsage } from "./chat-session-usage";

const PREFERENCES_KEY = "aurawrite-preferences";

type ProviderName = "ollama" | "ollama-cloud" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax";

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
      return {
        aiProvider: provider,
        aiModel: parsed.aiModel || defaultModel,
        aiApiKey: parsed.aiApiKey || "",
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
    default:
      return new OllamaProvider();
  }
}

export function getAISettings(): PreferencesAI {
  return loadAIFromPreferences();
}

export function updateAISettings(): void {
  currentProvider = createProvider(loadAIFromPreferences());
}

export function handlePreferencesChanged(): void {
  updateAISettings();
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
    currentProvider = createProvider(settings);
  } else {
    const providerAny = current as any;
    if (typeof providerAny.setModel === "function" && settings.aiModel) {
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

  const providersRequiringKey: Array<PreferencesAI["aiProvider"]> = ["openai", "anthropic", "deepseek", "openrouter", "ollama-cloud", "minimax"];
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

export function stopAI(): void {
  if (currentProvider) {
    currentProvider.stop();
  }
  isProcessing = false;
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
  if (context.projectId) {
    const toolPrompt = buildToolSystemPrompt(context.projectId);
    return {
      ...context,
      toolInstructions: toolPrompt,
    };
  }
  return context;
}