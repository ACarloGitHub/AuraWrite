export interface AIProvider {
  name: string;
  displayName: string;
  isLocal: boolean;
  stream(prompt: string, context?: AIContext): Promise<AIResponse>;
  stop(): void;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIContext {
  selectedText?: string;
  documentTitle?: string;
  projectType?: string;
  documentText?: string;
  projectId?: string;
  toolInstructions?: string;
  assistantName?: string;
  userName?: string;
  interfaceLanguage?: string;
  writingLanguage?: string;
  customAssistantPrompt?: string;
  customSuggestionsPrompt?: string;
  messageHistory?: ChatMessage[];
}

export interface AIResponse {
  content: string;
  done: boolean;
  error?: string;
  thinking?: string;
}

export interface AIProviderConfig {
  provider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  "ollama-cloud": "https://ollama.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  lmstudio: "http://localhost:1234/v1",
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  ollama: "kimi-k2.5:cloud",
  "ollama-cloud": "gpt-oss:120b-cloud",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  deepseek: "deepseek-chat",
  openrouter: "openai/gpt-4o",
  lmstudio: "",
};

export function getProviderBaseUrl(provider: string, customBaseUrl?: string): string {
  const url = (customBaseUrl && customBaseUrl.trim() !== "")
    ? customBaseUrl.trim()
    : (PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.ollama);
  return url.replace(/\/+$/, "");
}
