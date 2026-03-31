import type { AIProvider, AIContext, AIResponse } from "./providers";

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
              content: this.buildSystemPrompt(context),
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

  private buildSystemPrompt(context?: AIContext): string {
    const parts = [
      "You are an AI assistant for AuraWrite, a writing application.",
      "Help the user with writing, editing, and organizing their documents.",
    ];

    if (context?.projectType) {
      parts.push(`The current project is of type: ${context.projectType}`);
    }

    if (context?.documentTitle) {
      parts.push(`The current document is titled: ${context.documentTitle}`);
    }

    // TODO: Vector DB - When we implement vector database, we can do semantic search
    // to find relevant chunks. For now, we include the full document text.
    if (context?.documentText) {
      parts.push(`\nDOCUMENT CONTENT:\n"""\n${context.documentText}\n"""`);
    }

    return parts.join("\n");
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
    const parts = [
      "You are an AI assistant for AuraWrite, a writing application.",
      "Help the user with writing, editing, and organizing their documents.",
    ];

    if (context?.projectType) {
      parts.push(`The current project is of type: ${context.projectType}`);
    }

    if (context?.documentTitle) {
      parts.push(`The current document is titled: ${context.documentTitle}`);
    }

    return parts.join("\n");
  }

  private buildUserContent(prompt: string, context?: AIContext): string {
    // TODO: Vector DB - When we implement vector database, we can do semantic search
    // to find relevant chunks. For now, we include the full document text.
    if (context?.documentText) {
      return `DOCUMENT:\n"""\n${context.documentText}\n"""\n\nSELECTED TEXT: ${context.selectedText || "None"}\n\nUser request: ${prompt}`;
    }

    if (context?.selectedText) {
      return `SELECTED TEXT: "${context.selectedText}"\n\nUser request: ${prompt}`;
    }

    return prompt;
  }
}
