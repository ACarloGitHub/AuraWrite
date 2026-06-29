import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { OcrProgress, OcrResult, OcrPageResult } from "./ocr-types";

const OCR_AI_DEFAULT_PORT = 18089;
const OCR_AI_SERVER_READY_TIMEOUT_MS = 120_000;
const OCR_AI_SERVER_POLL_INTERVAL_MS = 1000;
const OCR_AI_INFERENCE_TIMEOUT_MS = 300_000;

type OcrAiModelInfo = {
  id: string;
  quantization: string;
  model_filename: string;
  model_path: string;
  model_present: boolean;
  model_size_bytes: number;
  mmproj_filename: string;
  mmproj_path: string;
  mmproj_present: boolean;
  mmproj_size_bytes: number;
};

type OcrAiStatus = {
  server_running: boolean;
  port: number | null;
  model_loaded: string | null;
  vram_available_bytes: number | null;
  vram_sufficient: boolean;
};

type LlamaServerStatus = {
  running: boolean;
  pid: number | null;
  port: number | null;
  model_path: string | null;
};

let serverPort: number | null = null;

let cancelController: AbortController | null = null;
let cancelled = false;

export function cancelOcrAi(): void {
  cancelled = true;
  cancelController?.abort();
  void ocrAiStopServer().catch(() => {});
}

export function isOcrAiCancelled(): boolean {
  return cancelled;
}

export function resetOcrAiCancel(): void {
  cancelled = false;
  cancelController = null;
}

export async function ocrAiListModels(): Promise<OcrAiModelInfo[]> {
  return invoke<OcrAiModelInfo[]>("ocr_ai_list_models");
}

export async function ocrAiDownloadModel(
  quantization: string,
): Promise<OcrAiModelInfo> {
  return invoke<OcrAiModelInfo>("ocr_ai_download_model", { quantization });
}

export async function ocrAiRemoveModel(
  quantization: string,
): Promise<void> {
  return invoke("ocr_ai_remove_model", { quantization });
}

export async function ocrAiCheckVram(): Promise<OcrAiStatus> {
  return invoke<OcrAiStatus>("ocr_ai_check_vram");
}

export async function ocrAiSpawnServer(
  quantization: string,
  port?: number,
): Promise<LlamaServerStatus> {
  const result = await invoke<LlamaServerStatus>("ocr_ai_spawn_server", {
    quantization,
    port: port ?? OCR_AI_DEFAULT_PORT,
  });
  if (result.running && result.port) {
    serverPort = result.port;
  }
  return result;
}

export async function ocrAiStopServer(): Promise<LlamaServerStatus> {
  serverPort = null;
  return invoke<LlamaServerStatus>("ocr_ai_stop_server");
}

export async function ocrAiServerStatus(): Promise<LlamaServerStatus> {
  return invoke<LlamaServerStatus>("ocr_ai_server_status");
}

export async function ocrAiReadLog(): Promise<string> {
  return invoke<string>("ocr_ai_read_log");
}

async function waitForServer(
  port: number,
  onProgress?: (progress: OcrProgress) => void,
): Promise<void> {
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < OCR_AI_SERVER_READY_TIMEOUT_MS) {
    if (cancelled) {
      throw new Error("OCR AI cancelled");
    }

    attempts++;
    try {
      const resp = await tauriFetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        onProgress?.({
          status: "OCR AI server ready",
          progress: 0.1,
          currentPage: 0,
          totalPages: 0,
        });
        return;
      }
    } catch {
      // Server not ready yet — check if the process is still alive
    }

    // Every 3 attempts, check if the server process is still alive
    if (attempts % 3 === 0) {
      try {
        const status = await ocrAiServerStatus();
        if (!status.running) {
          // Process is dead — read the log for the error
          const log = await ocrAiReadLog();
          const lastLines = log.trim().split("\n").slice(-10).join("\n");
          throw new Error(
            `OCR AI server crashed during startup.\n\nServer log (last 10 lines):\n${lastLines || "(empty log)"}`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("crashed")) {
          throw e;
        }
        // If we can't check status, just keep polling
      }
    }

    onProgress?.({
      status: `Starting OCR AI server... (${Math.round((Date.now() - start) / 1000)}s)`,
      progress: 0.05,
      currentPage: 0,
      totalPages: 0,
    });
    await new Promise((r) => setTimeout(r, OCR_AI_SERVER_POLL_INTERVAL_MS));
  }

  // Timeout — read the log before throwing
  const log = await ocrAiReadLog();
  const lastLines = log.trim().split("\n").slice(-10).join("\n");
  throw new Error(
    `OCR AI server did not become ready within ${OCR_AI_SERVER_READY_TIMEOUT_MS / 1000}s.\n\nServer log (last 10 lines):\n${lastLines || "(empty log)"}`,
  );
}

async function sendImageForOcr(
  imageBase64: string,
  mimeType: string,
  port: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_AI_INFERENCE_TIMEOUT_MS);

  if (abortSignal) {
    if (abortSignal.aborted) {
      clearTimeout(timeout);
      throw new Error("OCR AI cancelled");
    }
    abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const resp = await tauriFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0.0,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OCR AI inference failed (HTTP ${resp.status}): ${text}`);
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OCR AI returned empty content");
    }
    return content;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("OCR AI cancelled");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ocrAiEnsureModel(
  quantization: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<boolean> {
  const models = await ocrAiListModels();
  const target = models.find(
    (m) => m.quantization.toLowerCase() === quantization.toLowerCase(),
  );
  if (!target) return false;
  if (target.model_present && target.mmproj_present) return true;

  if (cancelled) throw new Error("OCR AI cancelled");

  onProgress?.({
    status: "Downloading OCR AI model...",
    progress: 0.02,
    currentPage: 0,
    totalPages: 0,
  });
  try {
    await ocrAiDownloadModel(quantization);
    return true;
  } catch (e) {
    console.error("[OCR AI] Model download failed:", e);
    return false;
  }
}

export async function runOcrAi(
  filePath: string,
  quantization: string,
  onProgress?: (progress: OcrProgress) => void,
  pageRange?: { start: number; end: number } | null,
): Promise<OcrResult> {
  cancelled = false;
  cancelController = new AbortController();
  const abortSignal = cancelController.signal;

  const results: OcrPageResult[] = [];
  const failedPages: number[] = [];

  onProgress?.({
    status: "Checking OCR AI model...",
    progress: 0,
    currentPage: 0,
    totalPages: 0,
  });

  const modelReady = await ocrAiEnsureModel(quantization, onProgress);
  if (cancelled) throw new Error("OCR AI cancelled");
  if (!modelReady) {
    throw new Error(
      "OCR AI model is not downloaded. Please download it from Preferences → OCR.",
    );
  }

  onProgress?.({
    status: "Checking VRAM...",
    progress: 0.03,
    currentPage: 0,
    totalPages: 0,
  });

  const vramStatus = await ocrAiCheckVram();
  if (vramStatus.vram_available_bytes !== null && !vramStatus.vram_sufficient) {
    const vramGb = (vramStatus.vram_available_bytes / 1024 / 1024 / 1024).toFixed(1);
    throw new Error(
      `Insufficient VRAM for OCR AI. Available: ${vramGb} GB. Need at least 3.1 GB free.`,
    );
  }

  // Start server (first time)
  const status = await ocrAiServerStatus();
  let port = status.port ?? OCR_AI_DEFAULT_PORT;

  if (!status.running) {
    onProgress?.({
      status: "Starting OCR AI server...",
      progress: 0.02,
      currentPage: 0,
      totalPages: 0,
    });

    const spawnResult = await ocrAiSpawnServer(quantization, port);
    if (!spawnResult.running) {
      const log = await ocrAiReadLog();
      const lastLines = log.trim().split("\n").slice(-10).join("\n");
      throw new Error(
        `Failed to start OCR AI server.\n\nServer log (last 10 lines):\n${lastLines || "(empty log)"}`,
      );
    }
    port = spawnResult.port ?? port;

    // Give the process 2 seconds before polling
    await new Promise((r) => setTimeout(r, 2000));

    const quickCheck = await ocrAiServerStatus();
    if (!quickCheck.running) {
      const log = await ocrAiReadLog();
      const lastLines = log.trim().split("\n").slice(-10).join("\n");
      throw new Error(
        `OCR AI server process died immediately after launch.\n\nServer log (last 10 lines):\n${lastLines || "(empty log)"}`,
      );
    }

    await waitForServer(port, onProgress);
  }

  if (cancelled) {
    await ocrAiStopServer();
    throw new Error("OCR AI cancelled");
  }

  const { readFile } = await import("@tauri-apps/plugin-fs");
  const isPdf = filePath.toLowerCase().endsWith(".pdf");

  let totalPages: number;
  const pagesToProcess: number[] = [];

  if (isPdf) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const fileData = await readFile(filePath);
    const pdf = await pdfjs.getDocument({ data: fileData }).promise;
    totalPages = pdf.numPages;

    // Build list of pages to process based on page range
    const rangeStart = pageRange?.start ?? 1;
    const rangeEnd = pageRange?.end ?? totalPages;
    for (let p = rangeStart; p <= Math.min(rangeEnd, totalPages); p++) {
      pagesToProcess.push(p);
    }

    if (pagesToProcess.length === 0) {
      await ocrAiStopServer();
      throw new Error("No pages to process in the selected range.");
    }

    // Render and process pages one at a time (lazy, no batch restart)
    for (let idx = 0; idx < pagesToProcess.length; idx++) {
      if (cancelled) {
        await ocrAiStopServer();
        throw new Error("OCR AI cancelled");
      }

      const pageNum = pagesToProcess[idx];
      const pageProgress = 0.1 + (idx / pagesToProcess.length) * 0.85;

      onProgress?.({
        status: `Rendering page ${pageNum}/${totalPages}...`,
        progress: pageProgress,
        currentPage: pageNum,
        totalPages: pagesToProcess.length,
      });

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");

      // Free canvas memory
      canvas.width = 0;
      canvas.height = 0;

      onProgress?.({
        status: `OCR AI: page ${pageNum}/${totalPages}`,
        progress: pageProgress + 0.5 / pagesToProcess.length,
        currentPage: pageNum,
        totalPages: pagesToProcess.length,
      });

      try {
        const markdown = await sendImageForOcr(base64, "image/jpeg", port, abortSignal);
        results.push({ pageNumber: pageNum, text: markdown, confidence: 0 });
      } catch (err) {
        if (cancelled || (err instanceof Error && err.message === "OCR AI cancelled")) {
          await ocrAiStopServer();
          throw new Error("OCR AI cancelled");
        }
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.push({ pageNumber: pageNum, text: "", confidence: 0, error: errorMsg });
        failedPages.push(pageNum);
      }
    }
  } else {
    // Single image — no batching needed
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "bmp"
              ? "image/bmp"
              : "image/png";
    const fileData = await readFile(filePath);
    let binary = "";
    const chunkSize = 8192;
    const bytes = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : fileData;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binary);

    totalPages = 1;
    onProgress?.({
      status: "OCR AI: page 1/1",
      progress: 0.5,
      currentPage: 1,
      totalPages: 1,
    });

    try {
      const markdown = await sendImageForOcr(base64, mimeType, port, abortSignal);
      results.push({ pageNumber: 1, text: markdown, confidence: 0 });
    } catch (err) {
      if (cancelled || (err instanceof Error && err.message === "OCR AI cancelled")) {
        await ocrAiStopServer();
        throw new Error("OCR AI cancelled");
      }
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      results.push({ pageNumber: 1, text: "", confidence: 0, error: errorMsg });
      failedPages.push(1);
    }
  }

  const processedCount = isPdf ? pagesToProcess.length : 1;

  onProgress?.({
    status: "Stopping OCR AI server...",
    progress: 0.95,
    currentPage: processedCount,
    totalPages: processedCount,
  });

  await ocrAiStopServer();

  return {
    pages: results,
    language: "ai",
    quality: "best" as const,
    totalPages: processedCount,
    failedPages,
    rawOutputs: [],
  };
}

export function isOcrAiLanguageSupported(langCode: string): boolean {
  const supported = ["en", "fr", "de", "es", "it", "pt", "nl", "sv", "da", "zh", "ja"];
  return supported.includes(langCode);
}

export const OCR_AI_SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
];

export const TESSERACT_FALLBACK_LANGUAGES = [
  { code: "rus", name: "Русский" },
  { code: "ara", name: "العربية" },
  { code: "hin", name: "हिन्दी" },
];