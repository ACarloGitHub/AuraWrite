/**
 * ManualProvider: talks to a user-defined AI service.
 *
 * The user registers a profile (name, base URL, optional API key, model) in
 * Preferences > AI Provider; this class speaks one of the two wire dialects
 * AuraWrite already knows:
 *   - "openai":    POST {baseUrl}/chat/completions   (OpenAI-compatible
 *                  servers: Alibaba/Model Studio, llama-server, vLLM, Ollama,
 *                  LM Studio, Groq, OpenRouter-style gateways, ...)
 *   - "anthropic": POST {baseUrl}/messages           (Anthropic Messages API
 *                  and servers exposing it, llama-server included)
 *
 * Both dialects are used with the same message builders as the built-in
 * providers, so prompts, AURA_EDIT, attachments and tool instructions behave
 * identically.
 *
 * The API key is ALWAYS optional here: local servers usually need none, but a
 * local llama-server started with `--api-key` does, and cloud services do.
 * The key is sent only when non-empty.
 */
import type { AIContext, AIProvider, AIResponse } from "./providers";
import {
  buildOpenAICompatibleMessages,
  buildAnthropicSystemPrompt,
  buildAnthropicMessages,
  extractOpenAIStyleReasoning,
  extractOpenAICompatibleUsage,
  extractAnthropicThinking,
  extractAnthropicUsage,
} from "./remote-providers";
import { isValidHttpUrl, fetchWithTimeout, withRetry } from "./fetch-retry";
import type { ManualApiType } from "./manual-providers";

/** Anthropic requires max_tokens; same value the built-in provider uses. */
const ANTHROPIC_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = "2023-06-01";

export interface ManualProviderOptions {
  profileName: string;
  apiType: ManualApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ManualProvider implements AIProvider {
  name = "manual";
  displayName: string;
  isLocal = false;

  private apiType: ManualApiType;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(options: ManualProviderOptions) {
    this.displayName = options.profileName || "Manual";
    this.apiType = options.apiType === "anthropic" ? "anthropic" : "openai";
    this.baseUrl = (options.baseUrl || "").replace(/\/+$/, "");
    this.apiKey = options.apiKey || "";
    this.model = options.model || "";
    this.isLocal = this.detectLocal();
  }

  setModel(model: string): void {
    this.model = model || "";
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey || "";
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.isLocal = this.detectLocal();
  }

  setApiType(apiType: ManualApiType): void {
    this.apiType = apiType === "anthropic" ? "anthropic" : "openai";
  }

  setProfileName(name: string): void {
    this.displayName = name || "Manual";
  }

  private detectLocal(): boolean {
    try {
      const host = new URL(this.baseUrl).hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0"
        || host.startsWith("127.") || host === "::";
    } catch {
      return false;
    }
  }

  private label(): string {
    return `Manual provider "${this.displayName}"`;
  }

  private endpoint(): string {
    return this.apiType === "anthropic"
      ? `${this.baseUrl}/messages`
      : `${this.baseUrl}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!this.apiKey.trim()) return headers;
    if (this.apiType === "anthropic") {
      headers["x-api-key"] = this.apiKey.trim();
      headers["anthropic-version"] = ANTHROPIC_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey.trim()}`;
    }
    return headers;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!this.baseUrl) {
      return {
        content: "",
        done: false,
        error: `${this.label()}: no base URL set. Type the full service address (including its version path, e.g. /v1) in Preferences > AI Provider.`,
      };
    }
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `${this.label()}: invalid base URL "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.model.trim()) {
      return {
        content: "",
        done: false,
        error: `${this.label()}: no model set. Load the model list with the refresh button (the first model is picked automatically) or type the model name in Preferences > AI Provider.`,
      };
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const anthropic = this.apiType === "anthropic";
    const body: Record<string, unknown> = anthropic
      ? {
          model: this.model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          system: buildAnthropicSystemPrompt(context),
          messages: buildAnthropicMessages(prompt, context),
        }
      : {
          model: this.model,
          messages: buildOpenAICompatibleMessages(prompt, context),
          stream: false,
        };

    try {
      const response = await withRetry(
        () => fetchWithTimeout(this.endpoint(), {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        }),
        { signal },
      );

      const data = await response.json().catch(() => null);
      if (!data) {
        return { content: "", done: false, error: `${this.label()}: empty response (status ${response.status}) from ${this.endpoint()}` };
      }
      if (data.error) {
        const errMsg = typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
        return { content: "", done: false, error: `${this.label()}: ${errMsg}` };
      }
      if (!response.ok) {
        return { content: "", done: false, error: `${this.label()}: HTTP ${response.status} ${response.statusText || ""} from ${this.endpoint()}` };
      }

      const content = anthropic
        ? (data.content?.[0]?.text || "")
        : (data.choices?.[0]?.message?.content || "");
      const thinking = anthropic ? extractAnthropicThinking(data) : extractOpenAIStyleReasoning(data);
      const usage = anthropic ? extractAnthropicUsage(data) : extractOpenAICompatibleUsage(data);
      return { content, done: true, ...(thinking ? { thinking } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error(`[ManualProvider] Request failed:`, error);
      return {
        content: "",
        done: false,
        error: `${this.label()}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
