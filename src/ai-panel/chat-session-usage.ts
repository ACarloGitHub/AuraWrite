import {
  emptyUsage,
  estimateInputTokens,
  estimateOutputTokens,
  extractProviderUsage,
  mergeUsage,
  type TokenUsage,
} from "./token-counter";
import type { AIContext, AIResponse } from "./providers";

let currentUsage: TokenUsage = emptyUsage();

// Compaction tracking: each session allows at most MAX_COMPACTIONS_PER_SESSION
// compactions. After that the conversation keeps going at full context until the
// user clears the chat (which resets the counter).
let compactionCount = 0;
export const MAX_COMPACTIONS_PER_SESSION = 3;

export function getSessionUsage(): TokenUsage {
  return currentUsage;
}

export function resetSessionUsage(): void {
  currentUsage = emptyUsage();
}

export function getCompactionCount(): number {
  return compactionCount;
}

export function incrementCompactionCount(): void {
  compactionCount++;
}

export function resetCompactionCount(): void {
  compactionCount = 0;
}

export function recordChatTurn(prompt: string, context: AIContext | undefined, response: AIResponse): TokenUsage {
  const provider = extractProviderUsage(response);

  let input: number;
  let output: number;
  let source: "provider" | "estimated";

  if (provider) {
    const providerInput = provider.input;
    const providerOutput = provider.output;
    const estimatedInput = estimateInputTokens(prompt, context).inputTokens;
    const estimatedOutput = estimateOutputTokens(response.content);

    if (providerInput > 0) {
      input = providerInput;
    } else {
      input = estimatedInput;
    }

    if (providerOutput > 0) {
      output = providerOutput;
    } else {
      output = estimatedOutput;
    }
    source = "provider";
  } else {
    const estimate = estimateInputTokens(prompt, context);
    input = estimate.inputTokens;
    output = estimateOutputTokens(response.content);
    source = "estimated";
  }

  currentUsage = mergeUsage(currentUsage, { input, output, source });
  return currentUsage;
}
