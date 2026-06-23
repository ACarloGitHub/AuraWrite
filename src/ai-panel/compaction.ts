// compaction.ts — Phase 3 of chat compaction: AI Compaction
//
// When the chat context exceeds 65% of the model's context window,
// this module:
// 1. Splits messages into head (old) and tail (recent) groups
// 2. Sends the head to the AI for a structured summary
// 3. Saves the summary via a Tauri command (YAML-front-matter MD file)
// 4. Returns the result so chat.ts can update its in-memory history
//
// The original messages remain in SQLite (Phase 1) and in the RAG
// (Phase 2) for future search. Only the in-memory message history
// passed to the AI is compacted.

import { invoke } from "@tauri-apps/api/core";
import { sendToAI } from "./ai-manager";
import { getSessionUsage } from "./chat-session-usage";
import { getContextWindow } from "./context-window";
import { estimateTokensFromText } from "./token-counter";
import { getAISettings } from "./ai-manager";

const COMPACTION_THRESHOLD = 0.65;
const COMPACTION_TAIL_TURNS = 3;
const COMPACT_SUMMARY_STORAGE_KEY = "aurawrite-compaction-summary";

export interface CompactionResult {
  compacted: boolean;
  summaryPath?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  messagesRemoved?: number;
  headCount?: number;
  tailCount?: number;
  summary?: string;
}

const COMPACT_PROMPT = `You are a conversation summarizer. You will receive the beginning (older messages) of a conversation that is being compacted to save context window space.

Your task is to produce a STRUCTURED SUMMARY with these EXACT sections:

## Goal
What is the user working on? What are they trying to achieve?

## Progress
What has been accomplished so far? List concrete completed steps.

## Key Decisions
What important decisions were made? What alternatives were considered and rejected?

## Next Steps
What was the user about to do next? What was the most recent direction?

## Critical Context
Specific facts, numbers, names, references, or technical details that MUST be preserved for the conversation to continue productively. Include file paths, configuration values, error messages, and any precise information.

## Relevant Files
List any files, documents, or resources that were mentioned or worked on.

RULES:
- Be concise but complete. Every concrete detail matters.
- Do NOT add information that was not in the conversation.
- Use the same language the user was using.
- If a previous summary is provided, UPDATE it incrementally — do not start from zero.`;

export function shouldCompact(): boolean {
  const settings = getAISettings();
  const windowInfo = getContextWindow(settings.aiProvider, settings.aiModel);
  const usage = getSessionUsage();

  if (windowInfo.context <= 0 || usage.totalTokens <= 0) return false;

  const ratio = usage.totalTokens / windowInfo.context;
  return ratio >= COMPACTION_THRESHOLD;
}

export function getCompactionRatio(): number {
  const settings = getAISettings();
  const windowInfo = getContextWindow(settings.aiProvider, settings.aiModel);
  const usage = getSessionUsage();

  if (windowInfo.context <= 0) return 0;
  return usage.totalTokens / windowInfo.context;
}

export async function compactConversation(
  messages: Array<{ role: string; content: string }>,
): Promise<CompactionResult> {
  if (messages.length < COMPACTION_TAIL_TURNS * 2) {
    return { compacted: false };
  }

  const tailStart = Math.max(0, messages.length - COMPACTION_TAIL_TURNS * 2);
  const headMessages = messages.slice(0, tailStart);
  const tailMessages = messages.slice(tailStart);

  if (headMessages.length === 0) {
    return { compacted: false };
  }

  // Only compact user and assistant messages
  const headUserAssistant = headMessages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  if (headUserAssistant.length === 0) {
    return { compacted: false };
  }

  const usageBefore = getSessionUsage();
  const settings = getAISettings();

  let previousSummary: string | null = null;
  try {
    previousSummary = await invoke<string | null>("compaction_read_latest_summary");
  } catch {
    // No previous summary — first compaction
  }

  const headText = headUserAssistant
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  let prompt: string;
  if (previousSummary) {
    prompt = `${COMPACT_PROMPT}\n\n--- PREVIOUS SUMMARY (update this incrementally) ---\n\n${previousSummary}\n\n--- NEW MESSAGES TO SUMMARIZE ---\n\n${headText}`;
  } else {
    prompt = `${COMPACT_PROMPT}\n\n--- MESSAGES TO SUMMARIZE ---\n\n${headText}`;
  }

  const response = await sendToAI(prompt);

  if (response.error || !response.content) {
    console.warn("[compaction] AI summarization failed:", response.error);
    return { compacted: false };
  }

  const summary = response.content;

  const sessionId = localStorage.getItem("aurawrite-chat-session-id") || `s-${Date.now().toString(36)}`;
  const date = new Date().toISOString().slice(0, 10);
  const model = settings.aiModel || "unknown";

  const estimatedSummaryTokens = estimateTokensFromText(summary);
  const estimatedTailTokens = estimateTokensFromText(
    tailMessages.map((m) => m.content).join("\n"),
  );
  const tokensAfter = estimatedSummaryTokens + estimatedTailTokens;

  let summaryPath: string | undefined;
  try {
    summaryPath = await invoke<string>("compaction_save_summary", {
      sessionId,
      date,
      model,
      tokensBefore: usageBefore.totalTokens,
      tokensAfter,
      summary,
    });
  } catch (err) {
    console.warn("[compaction] Failed to save summary file:", err);
  }

  // Cache the summary for injection as system context in next AI calls
  setCompactionSummary(summary, date, model, usageBefore.totalTokens, tokensAfter);

  return {
    compacted: true,
    summaryPath,
    tokensBefore: usageBefore.totalTokens,
    tokensAfter,
    messagesRemoved: headUserAssistant.length,
    headCount: headMessages.length,
    tailCount: tailMessages.length,
    summary,
  };
}

export function getCompactionSystemContext(): string | null {
  const raw = sessionStorage.getItem(COMPACT_SUMMARY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    if (!obj.summary || !obj.date) return null;
    return [
      `[Previous conversation context — summarized on ${obj.date}]`,
      "",
      obj.summary,
      "",
      "[End of summary. Original messages are preserved in the database and searchable via chat_search.]",
    ].join("\n");
  } catch {
    return null;
  }
}

export function setCompactionSummary(
  summary: string,
  date: string,
  model: string,
  tokensBefore: number,
  tokensAfter: number,
): void {
  sessionStorage.setItem(
    COMPACT_SUMMARY_STORAGE_KEY,
    JSON.stringify({ summary, date, model, tokensBefore, tokensAfter }),
  );
}

export function clearCompactionSummary(): void {
  sessionStorage.removeItem(COMPACT_SUMMARY_STORAGE_KEY);
}

export { COMPACTION_THRESHOLD, COMPACTION_TAIL_TURNS };