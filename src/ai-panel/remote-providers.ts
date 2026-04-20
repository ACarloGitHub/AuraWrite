import type { AIProvider, AIContext, AIResponse } from "./providers";

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
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: buildOpenAICompatibleSystemPrompt(context),
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          stream: false,
        }),
        signal: this.abortController.signal,
      });

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

      return {
        content,
        done: true,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          content: "",
          done: true,
          error: "Request cancelled",
        };
      }
      return {
        content: "",
        done: false,
        error: error instanceof Error ? error.message : "Unknown error",
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
    this.abortController = new AbortController();

    try {
      const systemPrompt = this.buildSystemPrompt(context);
      const userContent = this.buildUserContent(prompt, context);

      const response = await fetch(`${this.baseUrl}/messages`, {
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
          messages: [
            {
              role: "user",
              content: userContent,
            },
          ],
        }),
        signal: this.abortController.signal,
      });

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

      return {
        content,
        done: true,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          content: "",
          done: true,
          error: "Request cancelled",
        };
      }
      return {
        content: "",
        done: false,
        error: error instanceof Error ? error.message : "Unknown error",
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

    parts.push(`
When the user explicitly asks you to modify, replace, or change text in the document, respond with the AURA_EDIT format:
<<<AURA_EDIT>>>
{"aura_edit": {"message": "Brief explanation", "operations": [{"op": "replace", "find": "exact text", "content": [{"type": "text", "text": "new text"}]}]}}
<<<END_AURA_EDIT>>>
Do NOT use AURA_EDIT for normal conversation - only for document edits.`);

    return parts.join("\n");
  }

  private buildUserContent(prompt: string, context?: AIContext): string {
    if (context?.documentText) {
      return `DOCUMENT:\n"""\n${context.documentText}\n"""\n\nSELECTED TEXT: ${context.selectedText || "None"}\n\nUser request: ${prompt}`;
    }

    if (context?.selectedText) {
      return `SELECTED TEXT: "${context.selectedText}"\n\nUser request: ${prompt}`;
    }

    return prompt;
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
    baseUrl: string = "https://api.deepseek.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: buildOpenAICompatibleSystemPrompt(context) },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { content: "", done: false, error: `DeepSeek error: ${response.status} - ${errorData.error?.message || response.statusText}` };
      }

      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content || "", done: true };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      return { content: "", done: false, error: error instanceof Error ? error.message : "Unknown error" };
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
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://aurawrite.app",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: buildOpenAICompatibleSystemPrompt(context) },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { content: "", done: false, error: `OpenRouter error: ${response.status} - ${errorData.error?.message || response.statusText}` };
      }

      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content || "", done: true };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      return { content: "", done: false, error: error instanceof Error ? error.message : "Unknown error" };
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
    this.baseUrl = baseUrl;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    this.abortController = new AbortController();

    try {
      const body: Record<string, unknown> = {
        messages: [
          { role: "system", content: buildOpenAICompatibleSystemPrompt(context) },
          { role: "user", content: prompt },
        ],
        stream: false,
      };
      if (this.model) body.model = this.model;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { content: "", done: false, error: `LM Studio error: ${response.status} - ${errorData.error?.message || response.statusText}` };
      }

      const data = await response.json();
      return { content: data.choices?.[0]?.message?.content || "", done: true };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      return { content: "", done: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  stop(): void {
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  }
}
