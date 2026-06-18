import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AIProvider, AIContext, AIResponse } from "./providers";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_PORT = 11435;
const DEFAULT_HOST = "127.0.0.1";

interface LlamaServerConfig {
  modelPath: string;
  port?: number;
  ctxSize?: number;
  ngl?: string;
  flashAttn?: string;
  cacheTypeK?: string;
  cacheTypeV?: string;
  threads?: number;
  mmprojPath?: string;
}

interface LlamaServerStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  model_path: string | null;
}

function extractLlamaCppUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  if (!usage) return undefined;
  const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  if (input === 0 && output === 0) return undefined;
  return { inputTokens: input, outputTokens: output };
}

function buildLlamaCppMessages(
  prompt: string,
  context?: AIContext,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: buildLlamaCppSystemPrompt(context) },
  ];

  if (context?.messageHistory && context.messageHistory.length > 0) {
    for (const msg of context.messageHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

function buildLlamaCppSystemPrompt(context?: AIContext): string {
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

  if (context) {
    const contextParts: string[] = [];
    if (context.documentText) {
      contextParts.push(`DOCUMENT:\n"""\n${context.documentText}\n"""`);
    }
    if (context.selectedText) {
      contextParts.push(`SELECTED TEXT:\n"${context.selectedText}" (you may ONLY modify this)`);
    }
    if (context.documentTitle) {
      contextParts.push(`Document: ${context.documentTitle}`);
    }
    if (context.writingStyleFragment) {
      contextParts.push(`WRITING STYLE:\n${context.writingStyleFragment}`);
    }
    if (context.projectType) {
      contextParts.push(`Project type: ${context.projectType}`);
    }
    if (contextParts.length > 0) {
      parts.push(`[Context]\n${contextParts.join("\n\n")}`);
    }
  }

  parts.push(`
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
Do NOT use this format for normal conversation - only for document edits.`);

  return parts.join("\n\n");
}

export class LocalLlamacppProvider implements AIProvider {
  name = "local-llamacpp";
  displayName = "Local (llama.cpp)";
  isLocal = true;

  private config: LlamaServerConfig;
  private abortController: AbortController | null = null;
  private serverRunning: boolean = false;
  private currentModelPath: string | null = null;
  private currentMmprojPath: string | null = null;

  constructor(config: LlamaServerConfig) {
    this.config = config;
  }

  private getBaseUrl(): string {
    const port = this.config.port || DEFAULT_PORT;
    return `http://${DEFAULT_HOST}:${port}`;
  }

  getConfig(): LlamaServerConfig {
    return this.config;
  }

  async ensureServerRunning(): Promise<boolean> {
    const newModelPath = this.config.modelPath;
    const newMmprojPath = this.config.mmprojPath || null;

    if (this.serverRunning) {
      if (this.currentModelPath === newModelPath && this.currentMmprojPath === newMmprojPath) {
        return true;
      }
      console.log("[LocalLlamacpp] Model changed, restarting server:", this.currentModelPath, "→", newModelPath);
      await this.shutdownServer();
    }

    try {
      const status: LlamaServerStatus = await invoke("llamacpp_server_status");
      if (status.running && status.model_path === newModelPath) {
        this.serverRunning = true;
        this.currentModelPath = newModelPath;
        this.currentMmprojPath = newMmprojPath;
        return true;
      }
      if (status.running) {
        await invoke("llamacpp_stop_server");
      }
    } catch {
      // Server not running, try to start it
    }

    try {
      const result: LlamaServerStatus = await invoke("llamacpp_spawn_server", {
        modelPath: this.config.modelPath,
        port: this.config.port || DEFAULT_PORT,
        ctxSize: this.config.ctxSize,
        ngl: this.config.ngl,
        flashAttn: this.config.flashAttn,
        cacheTypeK: this.config.cacheTypeK,
        cacheTypeV: this.config.cacheTypeV,
        threads: this.config.threads,
        mmprojPath: this.config.mmprojPath,
      });
      this.serverRunning = result.running;
      if (result.running) {
        this.currentModelPath = newModelPath;
        this.currentMmprojPath = newMmprojPath;
        await this.waitForServerReady();
      }
      return result.running;
    } catch (e) {
      console.error("[LocalLlamacpp] Failed to start server:", e);
      return false;
    }
  }

  private async waitForServerReady(maxRetries: number = 30, delayMs: number = 500): Promise<void> {
    const url = `${this.getBaseUrl()}/v1/models`;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const resp = await tauriFetch(url, { method: "GET" });
        if (resp.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error("llama-server did not become ready in time");
  }

  async stream(prompt: string, context?: AIContext): Promise<AIResponse> {
    const running = await this.ensureServerRunning();
    if (!running) {
      return {
        content: "",
        done: false,
        error: "Local llama.cpp server failed to start. Try starting it manually from Preferences > Local Models > Server Status, or check that a model is selected in the AI Provider tab.",
      };
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const messages = buildLlamaCppMessages(prompt, context);
    const modelAlias = this.extractModelName();

    try {
      const response = await tauriFetch(`${this.getBaseUrl()}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelAlias,
          messages,
          temperature: 0.7,
          top_p: 0.95,
          stream: false,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: "",
          done: false,
          error: `llama.cpp error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content || "";
      const thinking = extractLlamaCppThinking(data);
      const usage = extractLlamaCppUsage(data);

      return {
        content,
        done: true,
        ...(thinking ? { thinking } : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { content: "", done: true, error: "Request cancelled" };
      }
      console.error("[LocalLlamacpp] Request failed:", error);
      return {
        content: "",
        done: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  setModel(modelPath: string, mmprojPath?: string): void {
    this.config.modelPath = modelPath;
    this.config.mmprojPath = mmprojPath;
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async shutdownServer(): Promise<void> {
    try {
      await invoke("llamacpp_stop_server");
    } catch (e) {
      console.error("[LocalLlamacpp] Failed to stop server:", e);
    }
    this.serverRunning = false;
    this.currentModelPath = null;
    this.currentMmprojPath = null;
  }

  private extractModelName(): string {
    const path = this.config.modelPath;
    const filename = path.split("/").pop()?.split("\\").pop() || "model";
    return filename.replace(/\.gguf$/i, "");
  }
}

function extractLlamaCppThinking(data: unknown): string | undefined {
  const message = (data as { choices?: Array<{ message?: { reasoning_content?: string } }> })?.choices?.[0]?.message;
  if (!message || typeof message !== "object") return undefined;
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }
  return undefined;
}

export async function getHardwareInfo(): Promise<{
  os: string;
  arch: string;
  ram_total_bytes: number;
  ram_available_bytes: number;
  gpus: Array<{ vendor: string; model: string; vram_bytes: number; backend: string }>;
  recommended_llamacpp_variant: string;
  disk_free_bytes: number;
  disk_total_bytes: number;
}> {
  return invoke("resources_detect_hardware");
}

export async function downloadChatModel(
  modelId: string,
  url: string,
  filename: string,
  mmprojUrl?: string,
  mmprojFilename?: string,
): Promise<{
  id: string;
  filename: string;
  path: string;
  size_bytes: number;
  mmproj_present: boolean;
  mmproj_path: string | null;
  mmproj_size_bytes: number | null;
}> {
  return invoke("resources_download_chat_model", {
    modelId,
    url,
    filename,
    mmprojUrl: mmprojUrl || null,
    mmprojFilename: mmprojFilename || null,
  });
}

export async function listChatModels(): Promise<
  Array<{
    id: string;
    filename: string;
    path: string;
    size_bytes: number;
    mmproj_present: boolean;
    mmproj_path: string | null;
    mmproj_size_bytes: number | null;
  }>
> {
  return invoke("resources_list_chat_models");
}

export async function removeChatModel(modelId: string): Promise<void> {
  return invoke("resources_remove_chat_model", { modelId });
}

export async function registerLocalModel(
  modelId: string,
  filePath: string,
): Promise<{
  id: string;
  filename: string;
  path: string;
  size_bytes: number;
  mmproj_present: boolean;
  mmproj_path: string | null;
  mmproj_size_bytes: number | null;
}> {
  return invoke("resources_register_local_model", { modelId, filePath });
}

export async function verifyModel(filePath: string): Promise<boolean> {
  return invoke("resources_verify_model", { filePath });
}

export async function downloadLlamacppVariant(variant: string): Promise<{
  present: boolean;
  path: string;
  size_bytes: number;
  version: string;
  license: string;
  download_url: string;
}> {
  return invoke("resources_download_llamacpp_variant", { variant });
}

export async function getLlamacppVariant(): Promise<string> {
  return invoke("resources_llamacpp_variant");
}