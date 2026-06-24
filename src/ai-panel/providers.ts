export interface AIProvider {
  name: string;
  displayName: string;
  isLocal: boolean;
  stream(prompt: string, context?: AIContext): Promise<AIResponse>;
  stop(): void;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface Attachment {
  id: string;
  kind: "image" | "document";
  mimeType: string;
  filename: string;
  data: string;
  size?: number;
  html?: string;
}

export function buildContentParts(
  text: string,
  attachments?: Attachment[],
): string | ContentPart[] {
  if (!attachments || attachments.length === 0) return text;
  const parts: ContentPart[] = [];
  if (text.trim()) {
    parts.push({ type: "text", text });
  }
  for (const att of attachments) {
    if (att.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${att.mimeType};base64,${att.data}` },
      });
    } else if (att.kind === "document") {
      parts.push({
        type: "text",
        text: `[Attached document: ${att.filename}]\n"""\n${att.data}\n"""`,
      });
    }
  }
  return parts.length > 0 ? parts : text;
}

export function hasImageAttachments(attachments?: Attachment[]): boolean {
  return !!attachments && attachments.some((a) => a.kind === "image");
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[];
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
  writingStyleFragment?: string;
  messageHistory?: ChatMessage[];
  attachments?: Attachment[];
}

export interface AIResponse {
  content: string;
  done: boolean;
  error?: string;
  thinking?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface AIProviderConfig {
  provider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export const PROVIDER_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  "ollama-cloud": "https://ollama.com/api",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  lmstudio: "http://localhost:1234/v1",
  minimax: "https://api.minimax.io/v1",
  zai: "https://api.z.ai/api/paas/v4",
  "local-llamacpp": "http://127.0.0.1:11435",
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  ollama: "kimi-k2.5:cloud",
  "ollama-cloud": "gpt-oss:120b-cloud",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  deepseek: "deepseek-chat",
  openrouter: "openai/gpt-4o",
  lmstudio: "",
  minimax: "MiniMax-M3",
  zai: "glm-5.1",
  "local-llamacpp": "",
};

export function getProviderBaseUrl(provider: string, customBaseUrl?: string): string {
  const url = (customBaseUrl && customBaseUrl.trim() !== "")
    ? customBaseUrl.trim()
    : (PROVIDER_BASE_URLS[provider] || PROVIDER_BASE_URLS.ollama);
  return url.replace(/\/+$/, "");
}
