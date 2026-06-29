import { runOcr, pickOcrFile, pickSavePath, resultToPlainText, saveResultToDisk } from "./ocr-processor";
import { OcrOptions, OcrQuality, OcrFileFormat, OcrProgress } from "./ocr-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EditorViewLike = { state: any; dispatch: any; focus: () => void };

let ocrBar: HTMLElement | null = null;
let currentFile: string | null = null;
let isRunning = false;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function updateStartButton(): void {
  const startBtn = $("ocr-start") as HTMLButtonElement | null;
  if (startBtn) {
    startBtn.disabled = !currentFile || isRunning;
  }
}

function updatePageRangeHint(): void {
  const rangeInput = $("ocr-page-range") as HTMLInputElement | null;
  if (!rangeInput) return;
  const isPdf = currentFile?.toLowerCase().endsWith(".pdf") ?? false;
  rangeInput.placeholder = isPdf ? "All (e.g. 1-3, 1,3,5)" : "N/A (images only)";
  rangeInput.disabled = !isPdf;
}

function updateSaveFormatVisibility(): void {
  const formatSelect = $("ocr-save-format") as HTMLSelectElement | null;
  const insertRadio = $("ocr-output-insert") as HTMLInputElement | null;
  if (!formatSelect || !insertRadio) return;
  formatSelect.style.display = insertRadio.checked ? "none" : "";
}

function onProgress(progress: OcrProgress): void {
  const progressBar = $("ocr-progress-bar");
  const progressText = $("ocr-progress-text");

  if (progressBar) {
    const pct = Math.round(progress.progress * 100);
    progressBar.style.width = `${pct}%`;
  }

  if (progressText) {
    if (progress.totalPages > 0) {
      progressText.textContent = `Page ${progress.currentPage}/${progress.totalPages} — ${progress.status}`;
    } else {
      progressText.textContent = progress.status;
    }
  }
}

function showModal(title: string, message: string): void {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
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

function getOptions(): Partial<OcrOptions> {
  const language = ($("ocr-language") as HTMLSelectElement | null)?.value ?? "eng";
  const quality = (($("ocr-quality") as HTMLSelectElement | null)?.value ?? "best") as OcrQuality;
  const outputMode = ($("ocr-output-insert") as HTMLInputElement | null)?.checked ? "insert" : "save";
  const saveFormat = (($("ocr-save-format") as HTMLSelectElement | null)?.value ?? "txt") as OcrFileFormat;
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

  return { language, quality, outputMode, saveFormat, pageRange };
}

export function initOcrToolbar(editorViewGetter: () => EditorViewLike | null): void {
  const bar = $("ocr-bar");
  if (!bar) return;
  ocrBar = bar;

  const btnOcr = $("btn-ocr");
  btnOcr?.addEventListener("click", () => {
    if (!ocrBar) return;
    if (ocrBar.classList.contains("hidden")) {
      ocrBar.classList.remove("hidden");
    } else {
      ocrBar.classList.add("hidden");
    }
  });

  $("ocr-close")?.addEventListener("click", () => {
    ocrBar?.classList.add("hidden");
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

  $("ocr-output-insert")?.addEventListener("change", updateSaveFormatVisibility);
  $("ocr-output-save")?.addEventListener("change", updateSaveFormatVisibility);
  updateSaveFormatVisibility();

  $("ocr-start")?.addEventListener("click", async () => {
    if (!currentFile || isRunning) return;
    isRunning = true;
    updateStartButton();

    const progressWrap = $("ocr-progress-wrap");
    const progressBar = $("ocr-progress-bar");
    if (progressWrap) progressWrap.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "0%";

    const options = getOptions();

    try {
      const result = await runOcr(currentFile, options, onProgress);

      if (result.failedPages.length > 0) {
        const failedList = result.failedPages.join(", ");
        showModal(
          "OCR Completed with Errors",
          `OCR finished, but the following pages failed: ${failedList}.\n\nYou can retry the failed pages individually.`
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
            const tr = editorView.state.tr.insert(editorView.state.selection.from, nodes);
            editorView.dispatch(tr);
            editorView.focus();
          } else {
            showModal("OCR Result", "No text was recognized from the document.");
          }
        } else {
          showModal("OCR Result", "No document is open in the editor. Use \"Save to disk\" instead.");
        }
      } else {
        const defaultName = currentFile.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "ocr_result";
        const format = options.saveFormat ?? "txt";
        const savePath = await pickSavePath(`${defaultName}_ocr.${format}`);
        if (savePath) {
          await saveResultToDisk(result, savePath, format);
          showModal("OCR Complete", `Text saved to:\n${savePath}`);
        }
      }

      if (result.failedPages.length === 0) {
        const progressText = $("ocr-progress-text");
        if (progressText) progressText.textContent = "Done";
        if (progressBar) progressBar.style.width = "100%";
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      showModal("OCR Error", `An error occurred during OCR:\n${errorMsg}`);
    } finally {
      isRunning = false;
      updateStartButton();
      setTimeout(() => {
        if (progressWrap) progressWrap.classList.add("hidden");
      }, 2000);
    }
  });
}

export function hideOcrBar(): void {
  ocrBar?.classList.add("hidden");
}