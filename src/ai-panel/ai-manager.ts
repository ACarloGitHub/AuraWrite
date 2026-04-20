import {
  AIProvider,
  AIContext,
  AIResponse,
  getProviderBaseUrl,
} from "./providers";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider, AnthropicProvider, DeepSeekProvider, OpenRouterProvider, LMStudioProvider } from "./remote-providers";
import { buildToolSystemPrompt } from "./tools";
import { getEditorView } from "../editor/toolbar";

const PREFERENCES_KEY = "aurawrite-preferences";

interface PreferencesAI {
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio";
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
}

function loadAIFromPreferences(): PreferencesAI {
  const stored = localStorage.getItem(PREFERENCES_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return {
        aiProvider: parsed.aiProvider || "ollama",
        aiModel: parsed.aiModel || "kimi-k2.5:cloud",
        aiApiKey: parsed.aiApiKey || "",
        aiBaseUrl: parsed.aiBaseUrl || "",
      };
    } catch {
      return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "" };
    }
  }
  return { aiProvider: "ollama", aiModel: "kimi-k2.5:cloud", aiApiKey: "", aiBaseUrl: "" };
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
      return new OllamaProvider(settings.aiModel, baseUrl);
    case "openai":
      return new OpenAIProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "anthropic":
      return new AnthropicProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "deepseek":
      return new DeepSeekProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "openrouter":
      return new OpenRouterProvider(settings.aiApiKey, settings.aiModel, baseUrl);
    case "lmstudio":
      return new LMStudioProvider(settings.aiModel, baseUrl);
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

  try {
    const response = await currentProvider!.stream(prompt, context);
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

export async function getSynonyms(
  word: string,
  context?: AIContext,
): Promise<string[]> {
  const prompt = `Find synonyms and antonyms for the word "${word}". Respond in JSON format:
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
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
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
  const prompt = `Suggest 3 alternative ways to write this phrase or sentence. Respond in JSON format:
{
  "alternatives": [
    "alternative 1",
    "alternative 2", 
    "alternative 3"
  ]
}\n\nOriginal: "${text}"`;

  const response = await sendToAI(prompt, context);

  if (response.error || !response.content) {
    return [];
  }

  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
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