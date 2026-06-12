import type { AIContext, AIResponse, ChatMessage } from "./providers";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "provider" | "estimated";
}

const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateInputTokens(prompt: string, context?: AIContext): TokenUsage {
  const parts: string[] = [];

  if (context?.toolInstructions) parts.push(context.toolInstructions);
  if (context?.customAssistantPrompt) parts.push(context.customAssistantPrompt);
  if (context?.customSuggestionsPrompt) parts.push(context.customSuggestionsPrompt);
  if (context?.writingStyleFragment) parts.push(context.writingStyleFragment);
  if (context?.documentText) parts.push(context.documentText);
  if (context?.selectedText) parts.push(context.selectedText);
  if (context?.documentTitle) parts.push(context.documentTitle);

  if (context?.messageHistory) {
    for (const msg of context.messageHistory) {
      parts.push(msg.content);
    }
  }

  parts.push(prompt);

  const total = parts.reduce((sum, part) => sum + estimateTokensFromText(part), 0);
  return {
    inputTokens: total,
    outputTokens: 0,
    totalTokens: total,
    source: "estimated",
  };
}

export function extractProviderUsage(response: AIResponse): { input: number; output: number } | null {
  const u = response.usage;
  if (!u) return null;
  const input = typeof u.inputTokens === "number" ? u.inputTokens : 0;
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0;
  if (input === 0 && output === 0) return null;
  return { input, output };
}

export function estimateOutputTokens(text: string): number {
  return estimateTokensFromText(text);
}

export function mergeUsage(
  current: TokenUsage,
  incoming: { input: number; output: number; source: "provider" | "estimated" },
): TokenUsage {
  const next: TokenUsage = {
    inputTokens: current.inputTokens + incoming.input,
    outputTokens: current.outputTokens + incoming.output,
    totalTokens: current.totalTokens + incoming.input + incoming.output,
    source: incoming.source === "provider" ? "provider" : current.source,
  };
  return next;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "estimated" };
}

export function usageToHistory(usage: TokenUsage, role: ChatMessage["role"], content: string): {
  role: ChatMessage["role"];
  content: string;
  tokens: number;
} {
  return { role, content, tokens: estimateTokensFromText(content) };
}
