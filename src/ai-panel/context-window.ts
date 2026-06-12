export type ProviderName = "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax";

export interface ContextWindowEntry {
  context: number;
  source: "known" | "estimated" | "default";
}

const KNOWN_CONTEXT_WINDOWS: Array<{ match: (provider: ProviderName, model: string) => boolean; context: number }> = [
  { match: (_p, m) => m.toLowerCase().startsWith("minimax-m3"), context: 1_000_000 },
  { match: (_p, m) => m.toLowerCase().startsWith("minimax-m2"), context: 256_000 },
  { match: (_p, m) => m.toLowerCase().startsWith("minimax-"), context: 256_000 },
  { match: (_p, m) => m.toLowerCase().includes("deepseek"), context: 128_000 },
  { match: (p, m) => p === "openai" && m.toLowerCase().includes("gpt-4o"), context: 128_000 },
  { match: (p, m) => p === "openai" && m.toLowerCase().includes("gpt-4"), context: 128_000 },
  { match: (p, m) => p === "openai" && m.toLowerCase().includes("o1"), context: 200_000 },
  { match: (p, m) => p === "openai" && m.toLowerCase().includes("o3"), context: 200_000 },
  { match: (p, m) => p === "openai" && m.toLowerCase().includes("gpt-5"), context: 400_000 },
  { match: (p, _m) => p === "anthropic", context: 200_000 },
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("claude"), context: 200_000 },
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("gpt-4"), context: 128_000 },
  { match: (p, m) => p === "openrouter" && m.toLowerCase().includes("gemini"), context: 1_000_000 },
  { match: (_p, _m) => true, context: 128_000 },
];

const DEFAULT_LOCAL_CONTEXT = 8_000;

export function getContextWindow(provider: string, model: string): ContextWindowEntry {
  const p = (provider || "").toLowerCase() as ProviderName;
  const m = (model || "").toLowerCase();

  for (const entry of KNOWN_CONTEXT_WINDOWS) {
    if (entry.match(p, m)) {
      return { context: entry.context, source: "known" };
    }
  }

  if (p === "ollama" || p === "lmstudio") {
    return { context: DEFAULT_LOCAL_CONTEXT, source: "estimated" };
  }

  return { context: 128_000, source: "default" };
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
