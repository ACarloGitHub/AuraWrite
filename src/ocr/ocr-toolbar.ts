import {
  runOcr,
  pickOcrFile,
  pickSavePath,
  resultToPlainText,
  saveResultToDisk,
  getFormatFromPath,
} from "./ocr-processor";
import { terminateOcrWorker } from "./ocr-engine";
import { runOcrAi, isOcrAiLanguageSupported, cancelOcrAi, OCR_AI_SUPPORTED_LANGUAGES, TESSERACT_FALLBACK_LANGUAGES } from "./ocr-ai-engine";
import { fromMarkdown } from "../formats/markdown";
import { OcrOptions, OcrQuality, OcrProgress, OcrFileFormat } from "./ocr-types";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { fromMarkdownToDocx, Packer } from "../formats/docx";
import type { EditorView } from "prosemirror-view";
import type { Node } from "prosemirror-model";

type EditorViewLike = EditorView;

interface OcrLanguageInfo {
  code: string;
  name: string;
  installed: boolean;
  size_bytes: number;
  has_best: boolean;
  has_medium: boolean;
  has_fast: boolean;
}

let ocrBar: HTMLElement | null = null;
let currentFile: string | null = null;
let isRunning = false;
let ocrCancelled = false;
let currentEngine: "tesseract" | "ai" = "tesseract";

let progressCurrentPage = 0;
let progressTotalPages = 0;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function updateStartButton(): void {
  const startBtn = $("ocr-start") as HTMLButtonElement | null;
  const stopBtn = $("ocr-stop") as HTMLButtonElement | null;
  if (startBtn) {
    startBtn.disabled = !currentFile || isRunning;
    startBtn.style.display = isRunning ? "none" : "";
  }
  if (stopBtn) {
    stopBtn.disabled = !isRunning;
    stopBtn.style.display = isRunning ? "" : "none";
  }
}

function updateEngineUI(): void {
  const quantWrap = $("ocr-ai-quant-wrap");
  const langWrap = $("ocr-lang-wrap");
  const qualityWrap = $("ocr-quality-wrap");

  if (currentEngine === "ai") {
    quantWrap?.classList.add("hidden");
    qualityWrap?.classList.add("hidden");
    if (langWrap) {
      const select = langWrap.querySelector("select") as HTMLSelectElement | null;
      if (select) {
        select.innerHTML = "";
        for (const lang of OCR_AI_SUPPORTED_LANGUAGES) {
          const opt = document.createElement("option");
          opt.value = lang.code;
          opt.textContent = lang.name;
          select.appendChild(opt);
        }
        const fallbackGroup = document.createElement("optgroup");
        fallbackGroup.label = "Fallback to Tesseract";
        for (const lang of TESSERACT_FALLBACK_LANGUAGES) {
          const opt = document.createElement("option");
          opt.value = lang.code;
          opt.textContent = `${lang.name} (Tesseract)`;
          fallbackGroup.appendChild(opt);
        }
        select.appendChild(fallbackGroup);
        select.value = "eng";
      }
    }
  } else {
    quantWrap?.classList.add("hidden");
    qualityWrap?.classList.remove("hidden");
    void refreshLanguageDropdown();
  }
}

function updatePageRangeHint(): void {
  const rangeInput = $("ocr-page-range") as HTMLInputElement | null;
  if (!rangeInput) return;
  const isPdf = currentFile?.toLowerCase().endsWith(".pdf") ?? false;
  rangeInput.placeholder = isPdf ? "All (e.g. 1-3, 1,3,5)" : "N/A (images only)";
  rangeInput.disabled = !isPdf;
}

function onProgress(progress: OcrProgress): void {
  if (progress.totalPages > 0) {
    progressTotalPages = progress.totalPages;
  }
  if (progress.currentPage > 0) {
    progressCurrentPage = progress.currentPage;
  }

  const progressFill = $("ocr-progress-fill");
  const progressText = $("ocr-progress-text");

  if (progressFill) {
    const pct = Math.round(progress.progress * 100);
    progressFill.style.width = `${pct}%`;
  }

  if (progressText) {
    if (progressTotalPages > 0 && progressCurrentPage > 0) {
      progressText.textContent = `${progressCurrentPage}/${progressTotalPages} — ${progress.status}`;
    } else {
      progressText.textContent = progress.status;
    }
  }
}

function showModal(title: string, message: string): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMessage = message
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  overlay.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content" style="min-width:400px;min-height:auto;max-width:500px;">
      <div class="modal-header">
        <h2>${safeTitle}</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="white-space:pre-wrap;word-break:break-word;">${safeMessage}</p>
        <div style="text-align:right;margin-top:16px;">
          <button class="ocr-bar__btn ocr-bar__btn--primary" id="ocr-modal-ok">OK</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".modal-close")?.addEventListener("click", close);
  overlay.querySelector("#ocr-modal-ok")?.addEventListener("click", close);
  overlay.querySelector(".modal-overlay")?.addEventListener("click", close);
  (overlay.querySelector("#ocr-modal-ok") as HTMLElement)?.focus();
}

async function refreshLanguageDropdown(): Promise<void> {
  if (currentEngine !== "tesseract") return;

  const select = $("ocr-language") as HTMLSelectElement | null;
  if (!select) return;

  const current = select.value;
  select.innerHTML = "";

  let langs: OcrLanguageInfo[] = [];
  try {
    langs = await invoke<OcrLanguageInfo[]>("ocr_list_languages");
  } catch {
    return;
  }

  for (const lang of langs) {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.installed
      ? lang.name
      : `${lang.name} (will download on start)`;
    select.appendChild(opt);
  }

  if (current && Array.from(select.options).some((o) => o.value === current)) {
    select.value = current;
  } else {
    select.value = "eng";
  }
}

function getOptions(): Partial<OcrOptions> {
  const language = ($("ocr-language") as HTMLSelectElement | null)?.value ?? "eng";
  const quality =
    (($("ocr-quality") as HTMLSelectElement | null)?.value ?? "best") as OcrQuality;
  const outputMode = ($("ocr-output-insert") as HTMLInputElement | null)?.checked
    ? "insert"
    : "save";
  const rangeStr = ($("ocr-page-range") as HTMLInputElement | null)?.value?.trim() ?? "";

  let pageRange: { start: number; end: number } | null = null;
  if (rangeStr && currentFile?.toLowerCase().endsWith(".pdf")) {
    const hyphenParts = rangeStr.split("-");
    if (hyphenParts.length === 2) {
      const start = parseInt(hyphenParts[0], 10);
      const end = parseInt(hyphenParts[1], 10);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        pageRange = { start, end };
      }
    } else {
      const single = parseInt(rangeStr, 10);
      if (!isNaN(single) && single > 0) {
        pageRange = { start: single, end: single };
      }
    }
  }

  return { language, quality, outputMode, pageRange };
}

async function pickOcrAiSavePath(defaultName: string): Promise<string | null> {
  const selected = await save({
    defaultPath: defaultName,
    filters: [
      { name: "Word Document", extensions: ["docx"] },
      { name: "Markdown", extensions: ["md"] },
      { name: "Plain Text", extensions: ["txt"] },
    ],
  });
  if (!selected || typeof selected !== "string") return null;
  return selected;
}

async function runOcrAiAndInsert(
  filePath: string,
  quantization: string,
  onProgress: (p: OcrProgress) => void,
): Promise<void> {
  const outputMode = ($("ocr-output-insert") as HTMLInputElement | null)?.checked
    ? "insert"
    : "save";

  const pageRangeStr = ($("ocr-page-range") as HTMLInputElement | null)?.value?.trim() ?? "";
  let pageRange: { start: number; end: number } | null = null;
  if (pageRangeStr && filePath.toLowerCase().endsWith(".pdf")) {
    const hyphenParts = pageRangeStr.split("-");
    if (hyphenParts.length === 2) {
      const start = parseInt(hyphenParts[0], 10);
      const end = parseInt(hyphenParts[1], 10);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        pageRange = { start, end };
      }
    } else {
      const single = parseInt(pageRangeStr, 10);
      if (!isNaN(single) && single > 0) {
        pageRange = { start: single, end: single };
      }
    }
  }

  const result = await runOcrAi(filePath, quantization, onProgress, pageRange);

  if (result.failedPages.length > 0 && result.pages.some((p) => !p.error)) {
    const failedList = result.failedPages.join(", ");
    showModal(
      "OCR AI Completed with Errors",
      `OCR AI finished, but ${result.failedPages.length} page(s) failed: ${failedList}.\n\nSuccessful pages have been processed.`,
    );
  } else if (result.failedPages.length === result.pages.length) {
    showModal("OCR AI Failed", "All pages failed. Check that the OCR AI model is working correctly.");
    return;
  }

  const fullText = result.pages
    .filter((p) => !p.error)
    .map((p) => p.text)
    .join("\n\n");

  if (!fullText.trim()) {
    showModal("OCR AI Result", "No text was recognized from the document.");
    return;
  }

  if (outputMode === "insert") {
    const editorView = (window as unknown as { _auraWriteEditorView?: EditorViewLike | null })._auraWriteEditorView ?? null;
    if (editorView) {
      const doc = fromMarkdown(fullText);
      const schema = editorView.state.schema;
      const nodes: Node[] = [];

      for (const node of doc.content || []) {
        const pmNode = schema.nodeFromJSON(node);
        if (pmNode) {
          nodes.push(pmNode);
        }
      }

      if (nodes.length > 0) {
        const tr = editorView.state.tr.insert(
          editorView.state.selection.from,
          nodes,
        );
        editorView.dispatch(tr);
        editorView.focus();
      }
    } else {
      showModal(
        "OCR AI Result",
        'No document is open in the editor. Use "Save to disk" instead.',
      );
    }
  } else {
    const defaultName =
      filePath
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "ocr_result";
    const savePath = await pickOcrAiSavePath(`${defaultName}_ocr_ai`);
    if (!savePath) return;

    const ext = savePath.split(".").pop()?.toLowerCase() ?? "txt";

    if (ext === "docx") {
      const docxDoc = fromMarkdownToDocx(fullText);
      const base64 = await Packer.toBase64String(docxDoc);
      await invoke("save_binary_file", { path: savePath, base64Content: base64 });
    } else if (ext === "md") {
      await invoke("save_document", { path: savePath, content: fullText });
    } else {
      const plainText = result.pages
        .filter((p) => !p.error)
        .map((p) => p.text.replace(/[#*_`>()]/g, "").replace(/\[/g, "").replace(/]/g, "").trim())
        .join("\n\n");
      await invoke("save_document", { path: savePath, content: plainText });
    }
    showModal("OCR AI Complete", `File saved to:\n${savePath}`);
  }
}

export function initOcrToolbar(editorViewGetter: () => EditorViewLike | null): void {
  const bar = $("ocr-bar");
  if (!bar) return;
  ocrBar = bar;

  (window as unknown as { _auraWriteEditorView?: EditorViewLike | null })._auraWriteEditorView = editorViewGetter();

  void refreshLanguageDropdown();

  const engineSelect = $("ocr-engine") as HTMLSelectElement | null;
  if (engineSelect) {
    engineSelect.addEventListener("change", () => {
      currentEngine = engineSelect.value as "tesseract" | "ai";
      updateEngineUI();
    });
  }

  // Initialize UI state based on default engine
  updateEngineUI();

  const btnOcr = $("btn-ocr");
  btnOcr?.addEventListener("click", () => {
    if (!ocrBar) return;
    if (ocrBar.classList.contains("hidden")) {
      ocrBar.classList.remove("hidden");
      void refreshLanguageDropdown();
    } else {
      ocrBar.classList.add("hidden");
    }
  });

  $("ocr-close")?.addEventListener("click", () => {
    ocrBar?.classList.add("hidden");
  });

  $("ocr-stop")?.addEventListener("click", async () => {
    if (!isRunning) return;
    ocrCancelled = true;
    if (currentEngine === "ai") {
      cancelOcrAi();
    } else {
      await terminateOcrWorker();
    }
  });

  $("ocr-load")?.addEventListener("click", async () => {
    const filePath = await pickOcrFile();
    if (filePath) {
      currentFile = filePath;
      const filename = $("ocr-filename");
      if (filename) {
        const parts = filePath.replace(/\\/g, "/").split("/");
        filename.textContent = parts[parts.length - 1];
      }
      updatePageRangeHint();
      updateStartButton();
    }
  });

  $("ocr-start")?.addEventListener("click", async () => {
    if (!currentFile || isRunning) return;
    isRunning = true;
    progressCurrentPage = 0;
    progressTotalPages = 0;
    updateStartButton();

    const progressWrap = $("ocr-progress-wrap");
    const progressFill = $("ocr-progress-fill");
    if (progressWrap) progressWrap.classList.remove("hidden");
    if (progressFill) progressFill.style.width = "0%";

    try {
      if (currentEngine === "ai") {
        const quantization = ($("ocr-ai-quant") as HTMLSelectElement | null)?.value ?? "q8_0";
        const lang = ($("ocr-language") as HTMLSelectElement | null)?.value ?? "eng";

        if (!isOcrAiLanguageSupported(lang)) {
          showModal(
            "Language Not Supported by AI",
            `The language "${lang}" is not supported by LightOnOCR AI. It will fall back to Tesseract.\n\nSupported languages: en, fr, de, es, it, pt, nl, sv, da, zh, ja`,
          );
          const options = getOptions();
          await runOcr(currentFile, options, onProgress);
          // ...handle Tesseract fallback result same as below
          return;
        }

        await runOcrAiAndInsert(currentFile, quantization, onProgress);

        const progressText = $("ocr-progress-text");
        if (progressText) progressText.textContent = "Done";
        if (progressFill) progressFill.style.width = "100%";
      } else {
        const options = getOptions();
        const result = await runOcr(currentFile, options, onProgress);

        if (result.failedPages.length > 0) {
          const failedList = result.failedPages.join(", ");
          showModal(
            "OCR Completed with Errors",
            `OCR finished, but the following pages failed: ${failedList}.\n\nYou can retry the failed pages individually.`,
          );
        }

        const editorView = editorViewGetter();

        if (options.outputMode === "insert") {
          if (editorView) {
            const text = resultToPlainText(result);
            if (text) {
              const schema = editorView.state.schema;
              const lines = text.split("\n");
              const nodes = lines.map((line: string) =>
                schema.nodes.paragraph.create(null, line ? schema.text(line) : null)
              );
              const tr = editorView.state.tr.insert(
                editorView.state.selection.from,
                nodes,
              );
              editorView.dispatch(tr);
              editorView.focus();
            } else {
              showModal("OCR Result", "No text was recognized from the document.");
            }
          } else {
            showModal(
              "OCR Result",
              'No document is open in the editor. Use "Save to disk" instead.',
            );
          }
        } else {
          const defaultName =
            currentFile
              .replace(/\\/g, "/")
              .split("/")
              .pop()
              ?.replace(/\.[^.]+$/, "") ?? "ocr_result";
          const savePath = await pickSavePath(`${defaultName}_ocr`);
          if (savePath) {
            const format: OcrFileFormat = getFormatFromPath(savePath);
            await saveResultToDisk(result, savePath, format);
            showModal("OCR Complete", `File saved to:\n${savePath}`);
          }
        }

        if (result.failedPages.length === 0) {
          const progressText = $("ocr-progress-text");
          if (progressText) progressText.textContent = "Done";
          if (progressFill) progressFill.style.width = "100%";
        }
      }
    } catch (err) {
      if (ocrCancelled) {
        showModal("OCR Cancelled", "OCR processing was cancelled.");
        ocrCancelled = false;
      } else {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        showModal(
          "OCR Error",
          `An error occurred during OCR:\n${errorMsg}`,
        );
      }
    } finally {
      isRunning = false;
      ocrCancelled = false;
      updateStartButton();
      const progressWrap = $("ocr-progress-wrap");
      setTimeout(() => {
        if (progressWrap) progressWrap.classList.add("hidden");
      }, 2000);
    }
  });

  updateEngineUI();
}

export function hideOcrBar(): void {
  ocrBar?.classList.add("hidden");
}