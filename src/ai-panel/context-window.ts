import { fetchWithTimeout } from "./fetch-retry";
import {
  getActiveManualProfile,
  manualSecretName,
  isManualProvider,
  type ManualApiType,
} from "./manual-providers";
import { parseModelList } from "./model-listing";

export type ProviderName = "ollama" | "ollama-cloud" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp" | "manual";

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
  // Ollama Cloud — hosted models. Without these entries ollama-cloud fell through
  // to the catch-all 128K below, which made the 65% compaction threshold almost
  // unreachable in practice. Values are conservative (better to compact early than
  // to overflow). Kimi K2.x exposes a 256K window; the rest of the hosted catalog
  // is capped at 128K.
  { match: (p, m) => p === "ollama-cloud" && m.toLowerCase().includes("kimi"), context: 262_144 },
  { match: (p, _m) => p === "ollama-cloud", context: 131_072 },
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

  if (p === "lmstudio") {
    // Manual override takes precedence (Preferences > AI Provider > Context size
    // when LM Studio is selected). When unset, fall through to the API cache /
    // native REST resolution so the live server setting is used automatically.
    const override = parseInt(localStorage.getItem("aurawrite-lmstudio-ctx-size") || "", 10);
    if (!isNaN(override) && override > 0) {
      return { context: override, source: "configured" };
    }
  }

  // Manual profiles: the size typed in the profile always wins; otherwise the
  // value discovered from the service (cached under manual:<profile>).
  if (isManualProvider(provider)) {
    const profile = getActiveManualProfile();
    if (profile && profile.contextSize > 0) {
      return { context: profile.contextSize, source: "configured" };
    }
    const cachedManual = getCachedContextWindow(manualSecretName(profile?.name || ""), model);
    if (cachedManual) {
      return { context: cachedManual, source: "api" };
    }
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

  if (isManualProvider(provider)) {
    // Nothing is known about this service: the number below is a guess, and it
    // must be marked as one so the screen can say so. A profile with a size
    // typed by the user returned earlier (it always wins).
    return { context: 128_000, source: "estimated" };
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

/** Drop every cached context size of one provider namespace. */
export function clearContextCacheFor(provider: string): void {
  const prefix = `${CONTEXT_CACHE_PREFIX}${provider}:`;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k!));
}

export async function resolveContextWindowFromAPI(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  providerApiType?: ManualApiType,
): Promise<number | null> {
  const cleanBase = (baseUrl || "").replace(/\/+$/, "");
  const trimmedKey = (apiKey || "").trim();

  try {
    if (isManualProvider(provider)) {
      // 1) llama-server reports the context it is ACTUALLY running with in its
      //    own settings endpoint, at the root of the server — the same trick
      //    LM Studio's detection uses (its native REST API, not the
      //    OpenAI-compatible path).
      let origin = "";
      try {
        origin = new URL(cleanBase).origin;
      } catch {
        origin = "";
      }
      if (origin) {
        const propsHeaders: Record<string, string> = {};
        if (trimmedKey) propsHeaders["Authorization"] = `Bearer ${trimmedKey}`;
        try {
          const propsResp = await fetchWithTimeout(`${origin}/props`, { headers: propsHeaders });
          if (propsResp.ok) {
            const props = await propsResp.json().catch(() => null) as
              { default_generation_settings?: { n_ctx?: number } } | null;
            const nCtx = props?.default_generation_settings?.n_ctx;
            if (typeof nCtx === "number" && nCtx > 0) return nCtx;
          }
        } catch {
          // No /props on this service (most cloud APIs have none): go on.
        }
      }

      // 2) Ask the service's model list: many of them report the context window
      //    (vLLM, OpenRouter-style gateways, LM Studio-like servers), and
      //    llama.cpp reports the model's own size there.
      const headers: Record<string, string> = {};
      if (trimmedKey) {
        if (providerApiType === "anthropic") {
          headers["x-api-key"] = trimmedKey;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${trimmedKey}`;
        }
      } else if (providerApiType === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
      }
      const resp = await fetchWithTimeout(`${cleanBase}/models`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      const models = parseModelList(body);
      const wanted = model.toLowerCase();
      const found = models.find((m) => m.id.toLowerCase() === wanted)
        || models.find((m) => m.id.toLowerCase().includes(wanted))
        || (models.length === 1 ? models[0] : undefined);
      if (found && typeof found.contextLength === "number" && found.contextLength > 0) {
        return found.contextLength;
      }
      return null;
    }
    if (provider === "openrouter") {
      const headers: Record<string, string> = { "HTTP-Referer": "https://aurawrite.app" };
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      const resp = await fetchWithTimeout(`${cleanBase}/models`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (body?.data && Array.isArray(body.data)) {
        const found = body.data.find((m: { id?: string; context_length?: number }) => m.id && m.id.toLowerCase() === model.toLowerCase());
        if (found && typeof found.context_length === "number" && found.context_length > 0) {
          return found.context_length;
        }
      }
    } else if (provider === "openai") {
      const headers: Record<string, string> = {};
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      const resp = await fetchWithTimeout(`${cleanBase}/models/${model}`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (body?.data && typeof body.data.context_length === "number" && body.data.context_length > 0) {
        return body.data.context_length;
      }
    } else if (provider === "anthropic") {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (trimmedKey) headers["x-api-key"] = trimmedKey;
      const resp = await fetchWithTimeout(`${cleanBase}/models/${model}`, { headers });
      if (!resp.ok) return null;
      const body = await resp.json();
      if (typeof body?.max_input_tokens === "number" && body.max_input_tokens > 0) {
        return body.max_input_tokens;
      }
    } else if (provider === "lmstudio") {
      // LM Studio exposes the ACTIVE server context setting (the one the user
      // configures in the server GUI) only via its NATIVE REST API at
      // /api/v1/models — NOT the OpenAI-compatible /v1/models (which only
      // returns ids). We read loaded_instances[].config.context_length (the live
      // setting) and fall back to the model's native max_context_length when the
      // model is not loaded yet.
      let origin: string;
      try {
        origin = new URL(cleanBase).origin;
      } catch {
        return null;
      }
      const resp = await fetchWithTimeout(`${origin}/api/v1/models`);
      if (!resp.ok) return null;
      const body = await resp.json();
      const models: Array<{
        key?: string;
        max_context_length?: number;
        loaded_instances?: Array<{ config?: { context_length?: number } }>;
      }> = body?.data?.models ?? body?.models ?? [];
      if (!Array.isArray(models) || models.length === 0) return null;
      const lowerModel = model.toLowerCase();
      const isPlaceholder = !model || model === "loaded-model";
      const found = isPlaceholder
        ? models.find((m) => Array.isArray(m?.loaded_instances) && m.loaded_instances!.length > 0) || models[0]
        : models.find((m) => typeof m?.key === "string" && m.key!.toLowerCase().includes(lowerModel))
          || models.find((m) => Array.isArray(m?.loaded_instances) && m.loaded_instances!.length > 0)
          || models[0];
      if (!found) return null;
      const active = found?.loaded_instances?.[0]?.config?.context_length;
      if (typeof active === "number" && active > 0) return active;
      if (typeof found?.max_context_length === "number" && found.max_context_length > 0) {
        return found.max_context_length;
      }
    }
  } catch {
    // Network error or parsing failure — silently fall back to hardcoded
  }
  return null;
}