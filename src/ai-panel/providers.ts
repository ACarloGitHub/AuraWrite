export interface AIProvider {
  name: string;
  displayName: string;
  isLocal: boolean;
  stream(prompt: string, context?: AIContext): Promise<AIResponse>;
  stop(): void;
}

export interface AIContext {
  selectedText?: string;
  documentTitle?: string;
  projectType?: string;
  documentText?: string;
  projectId?: string;
  toolInstructions?: string;
}

export interface AIResponse {
  content: string;
  done: boolean;
  error?: string;
}

export interface AIProviderConfig {
  provider: "ollama" | "openai" | "anthropic";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AISettings {
  enabled: boolean;
  provider: "ollama" | "openai" | "anthropic";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  streamResponses: boolean;
  autoIndexDocument: boolean;
  privacyDisclaimerShown: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  provider: "ollama",
  model: "kimi-k2.5:cloud",
  streamResponses: true,
  autoIndexDocument: false,
  privacyDisclaimerShown: false,
};

export function loadAISettings(): AISettings {
  const stored = localStorage.getItem("aurawrite-ai-settings");
  if (stored) {
    try {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_AI_SETTINGS;
    }
  }
  return DEFAULT_AI_SETTINGS;
}

export function saveAISettings(settings: AISettings): void {
  localStorage.setItem("aurawrite-ai-settings", JSON.stringify(settings));
}
