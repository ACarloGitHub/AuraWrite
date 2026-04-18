import {
  AIProvider,
  AIContext,
  AISettings,
  AIResponse,
  loadAISettings,
  saveAISettings,
  DEFAULT_AI_SETTINGS,
} from "./providers";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider, AnthropicProvider } from "./remote-providers";
import { buildToolSystemPrompt } from "./tools";
import { getEditorView } from "../editor/toolbar";

let currentProvider: AIProvider | null = null;
let currentSettings: AISettings;
let isProcessing = false;

export function initAI(): void {
  currentSettings = loadAISettings();
  currentProvider = createProvider(currentSettings);
}

function createProvider(settings: AISettings): AIProvider {
  switch (settings.provider) {
    case "ollama":
      return new OllamaProvider(settings.model, settings.baseUrl);
    case "openai":
      return new OpenAIProvider(settings.apiKey || "", settings.model);
    case "anthropic":
      return new AnthropicProvider(settings.apiKey || "", settings.model);
    default:
      return new OllamaProvider();
  }
}

export function getAISettings(): AISettings {
  if (!currentSettings) {
    currentSettings = loadAISettings();
  }
  return currentSettings;
}

export function updateAISettings(settings: Partial<AISettings>): void {
  currentSettings = { ...currentSettings, ...settings };
  saveAISettings(currentSettings);
  currentProvider = createProvider(currentSettings);
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
    const toolPrompt = buildToolSystemPrompt();
    return {
      ...context,
      toolInstructions: toolPrompt,
    };
  }
  return context;
}