import type { AIProvider, AIContext, AIResponse } from "./providers";

export class OllamaProvider implements AIProvider {
  name = "ollama";
  displayName = "Ollama";
  isLocal = true;

  private baseUrl: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(
    model: string = "huihui_ai/glm-4.7-flash-abliterated:q4_K",
    baseUrl: string = "http://localhost:11434",
  ) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: this.buildPrompt(prompt, context),
          stream: false,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: "",
          done: false,
          error: `Ollama error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        content: data.response || "",
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

  private buildPrompt(prompt: string, context?: AIContext): string {
    let fullPrompt = prompt;

    if (context) {
      const parts: string[] = [];

      if (context.documentText) {
        parts.push(`DOCUMENT:\n"""\n${context.documentText}\n"""`);
      }

      if (context.selectedText) {
        parts.push(`SELECTED TEXT:\n"${context.selectedText}"`);
      }

      if (context.documentTitle) {
        parts.push(`Document: ${context.documentTitle}`);
      }

      if (context.projectType) {
        parts.push(`Project type: ${context.projectType}`);
      }

      if (parts.length > 0) {
        fullPrompt = `[Context]\n${parts.join("\n\n")}\n\n[User Request]\n${prompt}`;
      }
    }

    return fullPrompt;
  }
}
