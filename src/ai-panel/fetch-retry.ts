import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export { tauriFetch };

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

export interface FetchWithTimeoutOptions extends globalThis.RequestInit {
  connectTimeout?: number;
  requestTimeout?: number;
  maxRedirections?: number;
  proxy?: unknown;
  danger?: unknown;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === "AbortError") return false;
    if (error.message && error.message.includes("Request timed out")) return false;
    if (error.message && error.message.includes("timed out after")) return false;
    const message = error.message || "";
    if (/HTTP\s+5\d\d/.test(message)) return true;
    if (/network|fetch|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(message)) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 500 && status < 600) return true;
  }
  return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const shouldRetry = options.shouldRetry ?? isTransientError;
  const onRetry = options.onRetry;
  const signal = options.signal;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const expoDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.random() * 0.3 * expoDelay;
      const delayMs = Math.round(expoDelay + jitter);
      if (onRetry) onRetry(error, attempt, delayMs);
      await delay(delayMs, signal);
    }
  }
  throw lastError;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const outerSignal = options.signal;

  let timedOut = false;

  const onLinkAbort = () => {
    controller.abort();
  };

  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort();
    } else {
      outerSignal.addEventListener("abort", onLinkAbort, { once: true });
    }
  }

  const {
    connectTimeout: _ct,
    requestTimeout: _rt,
    maxRedirections,
    proxy,
    danger,
    signal: _s,
    ...fetchOptions
  } = options as FetchWithTimeoutOptions & { signal?: AbortSignal };

  const tauriOptions: Record<string, unknown> = {
    ...fetchOptions,
    signal: controller.signal,
    connectTimeout,
  };
  if (maxRedirections !== undefined) tauriOptions.maxRedirections = maxRedirections;
  if (proxy !== undefined) tauriOptions.proxy = proxy;
  if (danger !== undefined) tauriOptions.danger = danger;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeout);

  try {
    const response = await Promise.race([
      tauriFetch(url, tauriOptions),
      new Promise<never>((_, reject) => {
        const onAbort = () => {
          reject(
            timedOut
              ? new Error(`Request timed out after ${requestTimeout / 1000}s`)
              : new DOMException("Aborted", "AbortError"),
          );
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) {
          onAbort();
        }
      }),
    ]);
    return response;
  } finally {
    clearTimeout(timeoutId);
    if (outerSignal) {
      outerSignal.removeEventListener("abort", onLinkAbort);
    }
  }
}

export function isValidHttpUrl(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}