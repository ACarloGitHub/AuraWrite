export type ProviderName = "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp";

export interface ContextWindowEntry {
  context: number;
  source: "api" | "known" | "estimated" | "configured";
}

const KNOWN_CONTEXT_WINDOWS: Array<{ match: (provider: ProviderName, model: string) => boolean; context: number }> = [
  // OpenAI GPT-5.x family
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.5"), context: 1_050_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.4-pro"), context: 1_050_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.4"), context: 400_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.3"), context: 400_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.2"), context: 400_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5.1"), context: 400_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-5"), context: 400_000 },
  // OpenAI GPT-4.x family
  { match: (_p, m) => m.toLowerCase().includes("gpt-4.1"), context: 1_047_576 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-4o"), context: 128_000 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-4-turbo"), context: 128_000 },
  { match: (_p, m) => m.toLowerCase() === "gpt-4" || m.toLowerCase().startsWith("gpt-4-"), context: 8_192 },
  { match: (_p, m) => m.toLowerCase().includes("gpt-4"), context: 128_000 },
  // OpenAI o-series
  { match: (_p, m) => m.toLowerCase().includes("o3") || m.toLowerCase().includes("o1"), context: 200_000 },
  // OpenAI 3.5
  { match: (_p, m) => m.toLowerCase().includes("gpt-3.5"), context: 16_385 },
  // Anthropic Claude Fable/Mythos
  { match: (_p, m) => m.toLowerCase().includes("fable"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().includes("mythos"), context: 1_000_000 },
  // Anthropic Claude 4.6+
  { match: (_p, m) => m.toLowerCase().includes("opus-4.8"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().includes("opus-4.7"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().includes("opus-4.6"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().includes("sonnet-4.6"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().includes("sonnet-4.5"), context: 200_000 },
  { match: (_p, m) => m.toLowerCase().includes("haiku-4.5"), context: 200_000 },
  { match: (_p, m) => m.toLowerCase().includes("opus-4.5"), context: 200_000 },
  { match: (_p, m) => m.toLowerCase().includes("opus-4.1"), context: 200_000 },
  // Anthropic Claude general (3.5, 3)
  { match: (p, _m) => p === "anthropic", context: 200_000 },
  // DeepSeek V4
  { match: (_p, m) => m.toLowerCase().includes("deepseek-v4") || m.toLowerCase().includes("deepseek-v4"), context: 1_048_576 },
  // DeepSeek R1 / V3.1 / V3.2
  { match: (_p, m) => m.toLowerCase().includes("deepseek-r1"), context: 163_840 },
  { match: (_p, m) => m.toLowerCase().includes("deepseek-v3.1") || m.toLowerCase().includes("deepseek-chat-v3.1"), context: 163_840 },
  { match: (_p, m) => m.toLowerCase().includes("deepseek-v3.2"), context: 131_072 },
  { match: (_p, m) => m.toLowerCase().includes("deepseek-chat-v3"), context: 163_840 },
  // DeepSeek general
  { match: (_p, m) => m.toLowerCase().includes("deepseek"), context: 131_072 },
  // Google Gemini 3.x/2.5
  { match: (_p, m) => m.toLowerCase().includes("gemini-3.5"), context: 1_048_576 },
  { match: (_p, m) => m.toLowerCase().includes("gemini-3.1"), context: 1_048_576 },
  { match: (_p, m) => m.toLowerCase().includes("gemini-3"), context: 1_048_576 },
  { match: (_p, m) => m.toLowerCase().includes("gemini-2.5"), context: 1_048_576 },
  { match: (_p, m) => m.toLowerCase().includes("gemini"), context: 1_048_576 },
  // MiniMax
  { match: (_p, m) => m.toLowerCase().includes("minimax-m3"), context: 1_048_576 },
  { match: (_p, m) => m.toLowerCase().includes("minimax-m2"), context: 256_000 },
  { match: (_p, m) => m.toLowerCase().includes("minimax-m1"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().startsWith("minimax"), context: 256_000 },
  // Zhipu / z.ai GLM
  { match: (p, m) => p === "zai" && m.toLowerCase().includes("glm-5.2"), context: 1_048_576 },
  { match: (p, m) => p === "zai" && m.toLowerCase().includes("glm-5"), context: 262_144 },
  { match: (p, m) => p === "zai" && (m.toLowerCase().includes("glm-5.1") || m.toLowerCase().includes("glm-4.7") || m.toLowerCase().includes("glm-4.6")), context: 200_000 },
  { match: (p, m) => p === "zai" && (m.toLowerCase().includes("glm-4.5") || m.toLowerCase().includes("glm-4.5-air")), context: 131_072 },
  { match: (p, _m) => p === "zai", context: 131_072 },
  // OpenRouter Claude
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("claude"), context: 200_000 },
  // OpenRouter GPT
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("gpt-4"), context: 128_000 },
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("gpt-5"), context: 400_000 },
  // OpenRouter Gemini
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("gemini"), context: 1_048_576 },
  // OpenRouter DeepSeek
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("deepseek"), context: 163_840 },
  // Fallback
  { match: (_p, _m) => true, context: 128_000 },
];

const DEFAULT_LOCAL_CONTEXT = 8_000;

export function getContextWindow(provider: string, model: string): ContextWindowEntry {
  const p = (provider || "").toLowerCase() as ProviderName;
  const m = (model || "").toLowerCase();

  if (p === "local-llamacpp") {
    const ctxSize = parseInt(localStorage.getItem("aurawrite-llamacpp-ctx-size") || "4096", 10);
    if (!isNaN(ctxSize) && ctxSize > 0) {
      return { context: ctxSize, source: "configured" };
    }
    return { context: DEFAULT_LOCAL_CONTEXT, source: "configured" };
  }

  const cached = getCachedContextWindow(provider, model);
  if (cached) {
    return { context: cached, source: "api" };
  }

  for (const entry of KNOWN_CONTEXT_WINDOWS) {
    if (entry.match(p, m)) {
      return { context: entry.context, source: "known" };
    }
  }

  if (p === "ollama" || p === "lmstudio") {
    return { context: DEFAULT_LOCAL_CONTEXT, source: "estimated" };
  }

  return { context: 128_000, source: "known" };
}

export function formatContextNumber(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) {
    const k = tokens / 1_000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}K`;
  }
  const m = tokens / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1)}M`;
}

const CONTEXT_CACHE_PREFIX = "aurawrite-ctx-";
const CONTEXT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedContextEntry {
  timestamp: number;
  contextLength: number;
}

export function getCachedContextWindow(provider: string, model: string): number | null {
  const key = `${CONTEXT_CACHE_PREFIX}${provider}:${model.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const entry: CachedContextEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CONTEXT_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.contextLength;
  } catch {
    return null;
  }
}

export function setCachedContextWindow(provider: string, model: string, contextLength: number): void {
  const key = `${CONTEXT_CACHE_PREFIX}${provider}:${model.toLowerCase()}`;
  const entry: CachedContextEntry = { timestamp: Date.now(), contextLength };
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage may be full
  }
}

export async function resolveContextWindowFromAPI(provider: string, model: string, apiKey: string, baseUrl: string): Promise<number | null> {
  const cleanBase = (baseUrl || "").replace(/\/+$/, "");
  const trimmedKey = (apiKey || "").trim();

  try {
    if (provider === "openrouter") {
      const headers: Record<string, string> = { "HTTP-Referer": "https://aurawrite.app" };
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const resp = await tauriFetch(`${cleanBase}/models`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (body?.data && Array.isArray(body.data)) {
        const found = body.data.find((m: any) => m.id && m.id.toLowerCase() === model.toLowerCase());
        if (found && typeof found.context_length === "number" && found.context_length > 0) {
          return found.context_length;
        }
      }
    } else if (provider === "openai") {
      const headers: Record<string, string> = {};
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const resp = await tauriFetch(`${cleanBase}/models/${model}`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (body?.data && typeof body.data.context_length === "number" && body.data.context_length > 0) {
        return body.data.context_length;
      }
    } else if (provider === "anthropic") {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (trimmedKey) headers["x-api-key"] = trimmedKey;
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const resp = await tauriFetch(`${cleanBase}/models/${model}`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (typeof body?.max_input_tokens === "number" && body.max_input_tokens > 0) {
        return body.max_input_tokens;
      }
    }
  } catch {
    // Network error or parsing failure — silently fall back to hardcoded
  }
  return null;
}