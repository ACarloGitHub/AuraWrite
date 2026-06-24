import type { AIProvider, AIContext, AIResponse } from "./providers";
import { withRetry, isValidHttpUrl, fetchWithTimeout } from "./fetch-retry";

function extractOllamaUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const d = data as { prompt_eval_count?: number; eval_count?: number };
  const input = typeof d.prompt_eval_count === "number" ? d.prompt_eval_count : 0;
  const output = typeof d.eval_count === "number" ? d.eval_count : 0;
  if (input === 0 && output === 0) return undefined;
  return { inputTokens: input, outputTokens: output };
}

export type OllamaMode = "local" | "cloud";

const OLLAMA_LOCAL_BASE_URL = "http://localhost:11434";
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/api";

export class OllamaProvider implements AIProvider {
  name = "ollama";
  displayName: string;
  isLocal: boolean;

  private baseUrl: string;
  private model: string;
  private mode: OllamaMode;
  private apiKey: string;
  private abortController: AbortController | null = null;

  constructor(
    model: string = "kimi-k2.5:cloud",
    baseUrl?: string,
    mode: OllamaMode = "local",
    apiKey: string = "",
  ) {
    this.mode = mode;
    this.apiKey = apiKey;
    this.model = model;
    if (mode === "cloud") {
      this.baseUrl = (baseUrl && baseUrl.trim() !== "")
        ? baseUrl.replace(/\/+$/, "")
        : OLLAMA_CLOUD_BASE_URL;
      this.isLocal = false;
      this.displayName = "Ollama (Cloud)";
    } else {
      this.baseUrl = (baseUrl && baseUrl.trim() !== "")
        ? baseUrl.replace(/\/+$/, "")
        : OLLAMA_LOCAL_BASE_URL;
      this.isLocal = true;
      this.displayName = "Ollama (Local)";
    }
  }

  setModel(model: string): void {
    this.model = model;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  setMode(mode: OllamaMode, apiKey: string = ""): void {
    this.mode = mode;
    this.apiKey = apiKey;
    if (mode === "cloud") {
      this.baseUrl = OLLAMA_CLOUD_BASE_URL;
      this.isLocal = false;
      this.displayName = "Ollama (Cloud)";
    } else {
      this.baseUrl = OLLAMA_LOCAL_BASE_URL;
      this.isLocal = true;
      this.displayName = "Ollama (Local)";
    }
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    if (!isValidHttpUrl(this.baseUrl)) {
      return { content: "", done: false, error: `Ollama: invalid baseUrl "${this.baseUrl}". Must start with http:// or https://.` };
    }
    if (this.mode === "cloud" && !this.apiKey.trim()) {
      return {
        content: "",
        done: false,
        error: "Ollama Cloud requires an API key. Add your OLLAMA_API_KEY in Preferences > AI Provider.",
      };
    }
    if (!this.model.trim()) {
      return { content: "", done: false, error: "Ollama: missing model name." };
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.mode === "cloud" && this.apiKey.trim()) {
        headers["Authorization"] = `Bearer ${this.apiKey.trim()}`;
      }

      const body: Record<string, unknown> = {
        model: this.model,
        prompt: this.buildPrompt(prompt, context),
        stream: false,
      };

      const images = context?.attachments
        ?.filter((a) => a.kind === "image")
        .map((a) => a.data) || [];
      if (images.length > 0) {
        body.images = images;
      }

      const isCloud = this.mode === "cloud";
      const endpoint = isCloud ? "/generate" : "/api/generate";

      const response = await withRetry(
        () => fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        }),
        { signal },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: "",
          done: false,
          error: `Ollama error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      const content = data.response || "";
      const thinking = typeof data.thinking === "string" && data.thinking.trim()
        ? data.thinking
        : undefined;
      const usage = extractOllamaUsage(data);
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
      console.error(`[Ollama] Request failed:`, error);
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

  private buildPrompt(prompt: string, context?: AIContext): string {
    let fullPrompt = "";

    if (context?.customAssistantPrompt) {
      fullPrompt += context.customAssistantPrompt + "\n\n";
    }

    if (context?.assistantName) {
      fullPrompt += `Your name is ${context.assistantName}.\n`;
    }
    if (context?.userName) {
      fullPrompt += `The user's name is ${context.userName}.\n`;
    }
    if (context?.interfaceLanguage) {
      fullPrompt += `Respond to the user in ${context.interfaceLanguage}.\n`;
    }
    if (context?.writingLanguage && context.writingLanguage !== context.interfaceLanguage) {
      fullPrompt += `When writing or suggesting text for the document, write in ${context.writingLanguage}.\n`;
    }

    if (context?.toolInstructions) {
      fullPrompt += context.toolInstructions + "\n\n";
    }

    if (context) {
      const parts: string[] = [];

      if (context.documentText) {
        parts.push(`DOCUMENT:\n"""\n${context.documentText}\n"""`);
      }

      if (context.selectedText) {
        parts.push(
          `SELECTED TEXT:\n"${context.selectedText}" (you may ONLY modify this)`,
        );
      }

      if (context.documentTitle) {
        parts.push(`Document: ${context.documentTitle}`);
      }

      if (context.writingStyleFragment) {
        parts.push(`WRITING STYLE:\n${context.writingStyleFragment}`);
      }

      if (context.projectType) {
        parts.push(`Project type: ${context.projectType}`);
      }

      if (parts.length > 0) {
        fullPrompt += `[Context]\n${parts.join("\n\n")}\n\n`;
      }
    }

    if (context?.messageHistory && context.messageHistory.length > 0) {
      fullPrompt += "[Conversation History]\n";
      for (const msg of context.messageHistory) {
        if (msg.role === "user") {
          fullPrompt += `User: ${msg.content}\n`;
        } else if (msg.role === "assistant") {
          fullPrompt += `Assistant: ${msg.content}\n`;
        }
      }
      fullPrompt += "\n";
    }

    fullPrompt += `[User Request]\n${prompt}`;

    fullPrompt += `

IMPORTANT: When the user asks you to modify the document, you MUST use the AURA_EDIT format.

When you need to make an edit, respond with EXACTLY this format:
<<<AURA_EDIT>>>
{"aura_edit": {"message": "Brief explanation", "operations": [{"op": "replace", "find": "exact text to find", "content": [{"type": "text", "text": "new text"}]}]}}
<<<END_AURA_EDIT>>>

Supported operations:
- replace: {"op": "replace", "find": "text", "content": [{"type": "text", "text": "new", "marks": ["strong", "em"]}]}
- format: {"op": "format", "find": "text", "addMark": "bold"}
- insert: {"op": "insert", "find": "after this", "position": "after", "content": [...]}
- delete: {"op": "delete", "find": "text to remove"}

You may ONLY modify the SELECTED TEXT if text is selected. Otherwise you may modify the document.
Do NOT use this format for normal conversation - only for document edits.`;

    return fullPrompt;
  }
}
