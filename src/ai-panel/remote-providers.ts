import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AIProvider, AIContext, AIResponse } from "./providers";
import { withRetry, isValidHttpUrl } from "./fetch-retry";

function extractOpenAIStyleReasoning(data: unknown): string | undefined {
  const message = (data as { choices?: Array<{ message?: { reasoning?: string; reasoning_content?: string } }> })?.choices?.[0]?.message;
  if (!message || typeof message !== "object") return undefined;
  const candidates = [message.reasoning, message.reasoning_content];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractAnthropicThinking(data: unknown): string | undefined {
  const blocks = (data as { content?: Array<{ type?: string; thinking?: string }> })?.content;
  if (!Array.isArray(blocks)) return undefined;
  const parts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === "object" && block.type === "thinking" && typeof block.thinking === "string") {
      parts.push(block.thinking);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractOpenAICompatibleUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  if (!usage) return undefined;
  const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  if (input === 0 && output === 0) return undefined;
  return { inputTokens: input, outputTokens: output };
}

function extractAnthropicUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
  if (!usage) return undefined;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  if (input === 0 && output === 0) return undefined;
  return { inputTokens: input, outputTokens: output };
}

function buildOpenAICompatibleMessages(
  prompt: string,
  context?: AIContext,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: buildOpenAICompatibleSystemPrompt(context) },
  ];

  if (context?.messageHistory && context.messageHistory.length > 0) {
    for (const msg of context.messageHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

function buildOpenAICompatibleSystemPrompt(context?: AIContext): string {
  const parts: string[] = [];

  if (context?.customAssistantPrompt) {
    parts.push(context.customAssistantPrompt);
  } else {
    parts.push("You are an AI assistant for AuraWrite, a writing application.");
    parts.push("Help the user with writing, editing, and organizing their documents.");
  }

  if (context?.assistantName) {
    parts.push(`Your name is ${context.assistantName}.`);
  }
  if (context?.userName) {
    parts.push(`The user's name is ${context.userName}.`);
  }
  if (context?.interfaceLanguage) {
    parts.push(`Respond to the user in ${context.interfaceLanguage}.`);
  }
  if (context?.writingLanguage && context.writingLanguage !== context.interfaceLanguage) {
    parts.push(`When writing or suggesting text for the document, write in ${context.writingLanguage}.`);
  }

  if (context?.toolInstructions) {
    parts.push(context.toolInstructions);
  }

  if (context?.projectType) {
    parts.push(`The current project is of type: ${context.projectType}`);
  }

  if (context?.documentTitle) {
    parts.push(`The current document is titled: ${context.documentTitle}`);
  }

  if (context?.writingStyleFragment) {
    parts.push(`WRITING STYLE:\n${context.writingStyleFragment}`);
  }

  if (context?.documentText) {
    parts.push(`\nDOCUMENT CONTENT:\n"""\n${context.documentText}\n"""`);
  }

  if (context?.selectedText) {
    parts.push(
      `\nSELECTED TEXT (you may ONLY modify this):\n"""\n${context.selectedText}\n"""`,
    );
  }

  parts.push(`
When the user explicitly asks you to modify, replace, or change text in the document, respond with the AURA_EDIT format:
<<<AURA_EDIT>>>
{"aura_edit": {"message": "Brief explanation", "operations": [{"op": "replace", "find": "exact text", "content": [{"type": "text", "text": "new text"}]}]}}
<<<END_AURA_EDIT>>>
Do NOT use AURA_EDIT for normal conversation - only for document edits.`);

  return parts.join("\n");
}

export class OpenAIProvider implements AIProvider {
  name = "openai";
  displayName = "OpenAI";
  isLocal = false;

  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string,
    model: string = "gpt-4o",
    baseUrl: string = "https://api.openai.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `OpenAI: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.apiKey.trim()) {
      return { content: "", done: false, error: "OpenAI: missing API key." };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: buildOpenAICompatibleMessages(prompt, context),
            stream: false,
          }),
          signal,
        }),
        { signal },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          content: "",
          done: false,
          error: `OpenAI error: ${response.status} - ${errorData.error?.message || response.statusText}`,
        };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const thinking = extractOpenAIStyleReasoning(data);
      const usage = extractOpenAICompatibleUsage(data);

      return {
        content,
        done: true,
        ...(thinking ? { thinking } : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          content: "",
          done: true,
          error: "Request cancelled",
        };
      }
      console.error(`[OpenAI] Request failed:`, error);
      return {
        content: "",
        done: false,
        error: error instanceof Error ? error.message : String(error),
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

export class AnthropicProvider implements AIProvider {
  name = "anthropic";
  displayName = "Anthropic";
  isLocal = false;

  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string,
    model: string = "claude-sonnet-4-20250514",
    baseUrl: string = "https://api.anthropic.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `Anthropic: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.apiKey.trim()) {
      return { content: "", done: false, error: "Anthropic: missing API key." };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const systemPrompt = this.buildSystemPrompt(context);
      const userMessages = this.buildUserMessages(prompt, context);

      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: userMessages,
          }),
          signal,
        }),
        { signal },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          content: "",
          done: false,
          error: `Anthropic error: ${response.status} - ${errorData.error?.message || response.statusText}`,
        };
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || "";
      const thinking = extractAnthropicThinking(data);
      const usage = extractAnthropicUsage(data);

      return {
        content,
        done: true,
        ...(thinking ? { thinking } : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          content: "",
          done: true,
          error: "Request cancelled",
        };
      }
      console.error(`[Anthropic] Request failed:`, error);
      return {
        content: "",
        done: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildSystemPrompt(context?: AIContext): string {
    const parts: string[] = [];

    if (context?.customAssistantPrompt) {
      parts.push(context.customAssistantPrompt);
    } else {
      parts.push("You are an AI assistant for AuraWrite, a writing application.");
      parts.push("Help the user with writing, editing, and organizing their documents.");
    }

    if (context?.assistantName) {
      parts.push(`Your name is ${context.assistantName}.`);
    }
    if (context?.userName) {
      parts.push(`The user's name is ${context.userName}.`);
    }
    if (context?.interfaceLanguage) {
      parts.push(`Respond to the user in ${context.interfaceLanguage}.`);
    }
    if (context?.writingLanguage && context.writingLanguage !== context.interfaceLanguage) {
      parts.push(`When writing or suggesting text for the document, write in ${context.writingLanguage}.`);
    }

    if (context?.toolInstructions) {
      parts.push(context.toolInstructions);
    }

    if (context?.projectType) {
      parts.push(`The current project is of type: ${context.projectType}`);
    }

    if (context?.documentTitle) {
      parts.push(`The current document is titled: ${context.documentTitle}`);
    }

    if (context?.writingStyleFragment) {
      parts.push(`WRITING STYLE:\n${context.writingStyleFragment}`);
    }

    if (context?.documentText) {
      parts.push(`\nDOCUMENT CONTENT:\n"""\n${context.documentText}\n"""`);
    }

    if (context?.selectedText) {
      parts.push(
        `\nSELECTED TEXT (you may ONLY modify this):\n"""\n${context.selectedText}\n"""`,
      );
    }

    parts.push(`
When the user explicitly asks you to modify, replace, or change text in the document, respond with the AURA_EDIT format:
<<<AURA_EDIT>>>
{"aura_edit": {"message": "Brief explanation", "operations": [{"op": "replace", "find": "exact text", "content": [{"type": "text", "text": "new text"}]}]}}
<<<END_AURA_EDIT>>>
Do NOT use AURA_EDIT for normal conversation - only for document edits.`);

    return parts.join("\n");
  }

  private buildUserMessages(
    prompt: string,
    context?: AIContext,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (context?.messageHistory && context.messageHistory.length > 0) {
      const maxHistory = 10;
      const history = context.messageHistory.slice(-maxHistory);
      for (const msg of history) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: prompt });

    return messages;
  }
}

export class DeepSeekProvider implements AIProvider {
  name = "deepseek";
  displayName = "DeepSeek";
  isLocal = false;

  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string,
    model: string = "deepseek-chat",
    baseUrl: string = "https://api.deepseek.com",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `DeepSeek: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.apiKey.trim()) {
      return { content: "", done: false, error: "DeepSeek: missing API key." };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: buildOpenAICompatibleMessages(prompt, context),
            stream: false,
          }),
          signal,
        }),
        { signal },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { content: "", done: false, error: `DeepSeek error: ${response.status} - ${errorData.error?.message || response.statusText}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const thinking = extractOpenAIStyleReasoning(data);
      const usage = extractOpenAICompatibleUsage(data);
      return { content, done: true, ...(thinking ? { thinking } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error(`[DeepSeek] Request failed:`, error);
      return { content: "", done: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }
}

export class OpenRouterProvider implements AIProvider {
  name = "openrouter";
  displayName = "OpenRouter";
  isLocal = false;

  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string,
    model: string = "openai/gpt-4o",
    baseUrl: string = "https://openrouter.ai/api/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `OpenRouter: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.apiKey.trim()) {
      return { content: "", done: false, error: "OpenRouter: missing API key." };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://aurawrite.app",
          },
          body: JSON.stringify({
            model: this.model,
            messages: buildOpenAICompatibleMessages(prompt, context),
            stream: false,
          }),
          signal,
        }),
        { signal },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { content: "", done: false, error: `OpenRouter error: ${response.status} - ${errorData.error?.message || response.statusText}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const thinking = extractOpenAIStyleReasoning(data);
      const usage = extractOpenAICompatibleUsage(data);
      return { content, done: true, ...(thinking ? { thinking } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error(`[OpenRouter] Request failed:`, error);
      return { content: "", done: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }
}

export class LMStudioProvider implements AIProvider {
  name = "lmstudio";
  displayName = "LM Studio";
  isLocal = true;

  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    model: string = "",
    baseUrl: string = "http://localhost:1234/v1",
  ) {
    this.model = model;
    this.baseUrl = this.normalizeBaseUrl(baseUrl);
  }

  private normalizeBaseUrl(url: string): string {
    let normalized = url.replace(/\/+$/, "");
    if (!normalized.match(/\/v1\/?$/)) {
      normalized = normalized + "/v1";
    }
    return normalized;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `LM Studio: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.model.trim()) {
      return { content: "", done: false, error: "LM Studio: missing model name. Type the model id exposed by your local server." };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const body: Record<string, unknown> = {
        messages: buildOpenAICompatibleMessages(prompt, context),
        stream: false,
        model: this.model || "local-model",
      };

      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        }),
        { signal },
      );

      const data = await response.json().catch(() => null);
      if (!data) {
        return { content: "", done: false, error: `LM Studio error: empty response (status ${response.status})` };
      }
      if (data.error) {
        const errMsg = typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
        if (errMsg.includes("Unexpected endpoint or method")) {
          return {
            content: "",
            done: false,
            error: `LM Studio endpoint error: baseUrl must end with /v1. URL: ${this.baseUrl}/chat/completions. Server: ${errMsg}`,
          };
        }
        return { content: "", done: false, error: `LM Studio error: ${errMsg}` };
      }
      if (!response.ok) {
        return { content: "", done: false, error: `LM Studio error: HTTP ${response.status} ${response.statusText}` };
      }
      const content = data.choices?.[0]?.message?.content || "";
      const thinking = extractOpenAIStyleReasoning(data);
      const usage = extractOpenAICompatibleUsage(data);
      return { content, done: true, ...(thinking ? { thinking } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error(`[LMStudio] Request failed:`, error);
      return { content: "", done: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }
}

export class MiniMaxProvider implements AIProvider {
  name = "minimax";
  displayName = "MiniMax";
  isLocal = false;
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(
    apiKey: string = "",
    model: string = "MiniMax-M3",
    baseUrl: string = "https://api.minimax.io/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setModel(model: string): void {
    this.model = model;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `MiniMax: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (!this.apiKey.trim()) {
      return { content: "", done: false, error: "MiniMax: missing API key. Add your MiniMax API key in Preferences > AI Provider." };
    }
    if (!this.model.trim()) {
      return { content: "", done: false, error: `MiniMax: missing model name. Default: MiniMax-M3. See https://platform.minimax.io/docs/guides/models-intro for the full list.` };
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const body: Record<string, unknown> = {
        messages: buildOpenAICompatibleMessages(prompt, context),
        stream: false,
        model: this.model,
      };

      const response = await withRetry(
        () => tauriFetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        }),
        { signal },
      );

      const data = await response.json().catch(() => null);
      if (!data) {
        return { content: "", done: false, error: `MiniMax error: empty response (status ${response.status})` };
      }
      if (data.error) {
        const errMsg = typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
        return { content: "", done: false, error: `MiniMax error: ${errMsg}` };
      }
      if (!response.ok) {
        return { content: "", done: false, error: `MiniMax error: HTTP ${response.status} ${response.statusText}` };
      }
      const content = data.choices?.[0]?.message?.content || "";
      const thinking = extractOpenAIStyleReasoning(data);
      const usage = extractOpenAICompatibleUsage(data);
      return { content, done: true, ...(thinking ? { thinking } : {}), ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error(`[MiniMax] Request failed:`, error);
      return { content: "", done: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  stop(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }
}
