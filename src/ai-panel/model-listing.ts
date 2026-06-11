import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface ModelInfo {
  id: string;
  displayName?: string;
  size?: number;
  modified?: string;
}

interface ListingConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  parse: (body: any) => ModelInfo[];
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
): Promise<ModelInfo[]> {
  const config = buildListingConfig(provider, baseUrl, apiKey);
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

function buildListingConfig(provider: string, baseUrl: string, apiKey: string): ListingConfig | null {
  const trimmedKey = apiKey.trim();
  const cleanBase = baseUrl.replace(/\/+$/, "");
  switch (provider) {
    case "ollama":
    case "ollama-cloud": {
      const headers: Record<string, string> = {};
      if (provider === "ollama-cloud" && trimmedKey) {
        headers["Authorization"] = `Bearer ${trimmedKey}`;
      }
      return {
        url: `${cleanBase}/api/tags`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.models)) return [];
          return body.models.map((m: any) => ({
            id: m.name || m.model,
            displayName: m.name || m.model,
            size: typeof m.size === "number" ? m.size : undefined,
            modified: typeof m.modified_at === "string" ? m.modified_at : undefined,
          }));
        },
      };
    }
    case "lmstudio":
      return {
        url: `${cleanBase}/models`,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({ id: m.id, displayName: m.id }));
        },
      };
    case "openai": {
      const headers: Record<string, string> = {};
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      return {
        url: `${cleanBase}/models`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({ id: m.id, displayName: m.id }));
        },
      };
    }
    case "anthropic": {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (trimmedKey) headers["x-api-key"] = trimmedKey;
      return {
        url: `${cleanBase}/models`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({
            id: m.id,
            displayName: typeof m.display_name === "string" ? m.display_name : m.id,
          }));
        },
      };
    }
    case "deepseek": {
      const headers: Record<string, string> = {};
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      return {
        url: `${cleanBase}/models`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({ id: m.id, displayName: m.id }));
        },
      };
    }
    case "openrouter": {
      const headers: Record<string, string> = { "HTTP-Referer": "https://aurawrite.app" };
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      return {
        url: `${cleanBase}/models`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({
            id: m.id,
            displayName: typeof m.name === "string" ? m.name : m.id,
          }));
        },
      };
    }
    case "minimax": {
      const headers: Record<string, string> = {};
      if (trimmedKey) headers["Authorization"] = `Bearer ${trimmedKey}`;
      return {
        url: `${cleanBase}/models`,
        headers,
        parse: (body: any) => {
          if (!body || !Array.isArray(body.data)) return [];
          return body.data.map((m: any) => ({
            id: m.id,
            displayName: m.id,
          }));
        },
      };
    }
    default:
      return null;
  }
}
