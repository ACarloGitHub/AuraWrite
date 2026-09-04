import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isManualProvider, type ManualApiType } from "./manual-providers";

export interface ModelInfo {
  id: string;
  displayName?: string;
  size?: number;
  modified?: string;
  /** Context window in tokens, when the service reports it. */
  contextLength?: number;
}

interface ListingConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  parse: (body: unknown) => ModelInfo[];
}

interface CachedEntry {
  timestamp: number;
  models: ModelInfo[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = "aurawrite-models-";

export function formatCacheKey(provider: string, baseUrl: string, hasApiKey: boolean): string {
  return `${CACHE_PREFIX}${provider}:${baseUrl.replace(/\/+$/, "")}:${hasApiKey ? "k" : "n"}`;
}

export function getCachedModels(provider: string, baseUrl: string, hasApiKey: boolean): ModelInfo[] | null {
  const key = formatCacheKey(provider, baseUrl, hasApiKey);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const entry: CachedEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.models;
  } catch {
    return null;
  }
}

export function setCachedModels(provider: string, baseUrl: string, hasApiKey: boolean, models: ModelInfo[]): void {
  const key = formatCacheKey(provider, baseUrl, hasApiKey);
  const entry: CachedEntry = { timestamp: Date.now(), models };
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage may be full or disabled; silently ignore
  }
}

export function clearModelCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export async function listModelsForProvider(
  provider: string,
  baseUrl: string,
  apiKey: string,
  apiType?: ManualApiType,
): Promise<ModelInfo[]> {
  const config = buildListingConfig(provider, baseUrl, apiKey, apiType);
  if (!config) {
    throw new Error(`Model listing is not supported for provider "${provider}".`);
  }
  const response = await tauriFetch(config.url, {
    method: config.method || "GET",
    headers: config.headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || ""} from ${config.url}`);
  }
  const body = await response.json().catch(() => null);
  if (body && typeof body === "object" && typeof body.error === "string") {
    throw new Error(body.error);
  }
  if (!body) {
    throw new Error("Empty response body");
  }
  return config.parse(body);
}

/** Remove the cached model list of one provider namespace. */
export function clearModelCacheFor(provider: string): void {
  const prefix = `${CACHE_PREFIX}${provider}:`;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keysToRemove.push(k);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k!));
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function firstNumber(...values: unknown[]): number {
  for (const v of values) {
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

/** One object with unknown contents, as any service may answer. */
type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as LooseRecord
    : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Tolerant reader for a model list. Services put the array in different places
 * (`data`, `models`, `output.models`, or the body itself) and call the id
 * differently (`id`, `model`, `name`); all of them are accepted here, so a
 * manually registered service works without per-vendor code — and so do the
 * built-in providers, which all speak one of these shapes.
 *
 * The order the service reports is preserved (the local llama.cpp list and
 * Ollama's are meaningful as they come).
 */
export function parseModelList(body: unknown): ModelInfo[] {
  const root = asRecord(body);
  const output = asRecord(root?.output);
  const result = asRecord(root?.result);
  const candidates: unknown[][] = [
    asList(root?.data),
    asList(root?.models),
    asList(output?.models),
    asList(result?.models),
    asList(body),
  ];
  const items = candidates.find((list) => list.length > 0) || [];

  const models: ModelInfo[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    // `name` last: some native APIs (Ollama's /api/tags) label the id that way.
    const id = firstString(item.id, item.model, item.model_id, item.name);
    if (!id || models.some((m) => m.id === id)) continue;
    const label = firstString(item.display_name, item.name, item.model_name, item.title);
    // Context sizes live in flat fields for most services, but llama.cpp puts
    // the model's own size inside a nested `meta` object.
    const meta = asRecord(item.meta);
    const contextLength = firstNumber(
      item.context_length,
      item.max_context_length,
      item.context_window,
      item.max_model_len,
      item.n_ctx,
      item.context,
      meta?.n_ctx_train,
      meta?.context_length,
    );
    const model: ModelInfo = { id, displayName: label && label !== id ? label : id };
    const size = item.size;
    if (typeof size === "number") model.size = size;
    const modified = item.modified_at;
    if (typeof modified === "string") model.modified = modified;
    if (contextLength > 0) model.contextLength = contextLength;
    models.push(model);
  }
  return models;
}

function buildListingConfig(provider: string, baseUrl: string, apiKey: string, apiType?: ManualApiType): ListingConfig | null {
  const trimmedKey = apiKey.trim();
  const cleanBase = baseUrl.replace(/\/+$/, "");
  // Manually registered profiles: same request shape as the dialect chosen
  // for the profile, with a tolerant parser (unknown services, unknown JSON).
  if (isManualProvider(provider)) {
    if (apiType === "anthropic") {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (trimmedKey) headers["x-api-key"] = trimmedKey;
      return { url: `${cleanBase}/models`, headers, parse: parseModelList };
    }
    const headers: Record<string, string> = {};
    if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
    return { url: `${cleanBase}/models`, headers, parse: parseModelList };
  }
  const bearer = (): Record<string, string> =>
    (trimmedKey ? { Authorization: `Bearer ${trimmedKey}` } : {});

  switch (provider) {
    case "ollama":
    case "ollama-cloud": {
      const headers: Record<string, string> = {};
      if (provider === "ollama-cloud" && trimmedKey) {
        headers["Authorization"] = `Bearer ${trimmedKey}`;
      }
      const tagsPath = provider === "ollama-cloud" ? "/tags" : "/api/tags";
      return { url: `${cleanBase}${tagsPath}`, headers, parse: parseModelList };
    }
    case "lmstudio":
      return { url: `${cleanBase}/models`, parse: parseModelList };
    case "anthropic": {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (trimmedKey) headers["x-api-key"] = trimmedKey;
      return { url: `${cleanBase}/models`, headers, parse: parseModelList };
    }
    case "openrouter": {
      const headers: Record<string, string> = { "HTTP-Referer": "https://aurawrite.app", ...bearer() };
      return { url: `${cleanBase}/models`, headers, parse: parseModelList };
    }
    case "openai":
    case "deepseek":
    case "minimax":
    case "zai":
      return { url: `${cleanBase}/models`, headers: bearer(), parse: parseModelList };
    default:
      return null;
  }
}
