import { getOcrWorker, terminateOcrWorker, recognizeImage, setProgressContext } from "./ocr-engine";
import { OcrOptions, OcrResult, OcrPageResult, OcrProgress, OcrFileFormat, OCR_DEFAULTS } from "./ocr-types";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

let pdfjsModule: typeof import("pdfjs-dist") | null = null;

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist");
    pdfjsModule.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }
  return pdfjsModule;
}

function isPdfFile(file: string): boolean {
  return file.toLowerCase().endsWith(".pdf");
}

async function pdfToImages(
  pdfPath: string,
  pageRange: { start: number; end: number } | null,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ canvas: HTMLCanvasElement; pageNumber: number; total: number }[]> {
  const pdfjs = await loadPdfJs();
  const fileData = await readFile(pdfPath);
  const pdf = await pdfjs.getDocument({ data: fileData }).promise;
  const totalPages = pdf.numPages;

  const startPage = pageRange?.start ?? 1;
  const endPage = pageRange?.end ?? totalPages;

  const pages: { canvas: HTMLCanvasElement; pageNumber: number; total: number }[] = [];

  for (let i = startPage; i <= endPage; i++) {
    onProgress?.({
      status: `Rendering page ${i}/${endPage}`,
      progress: ((i - startPage) / (endPage - startPage + 1)) * 0.1,
      currentPage: i,
      totalPages: endPage - startPage + 1,
    });

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ canvas, pageNumber: i, total: endPage - startPage + 1 });
  }

  return pages;
}

export async function runOcr(
  filePath: string,
  options: Partial<OcrOptions>,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const opts: OcrOptions = { ...OCR_DEFAULTS, ...options };
  const results: OcrPageResult[] = [];
  const failedPages: number[] = [];
  const rawOutputs: { hocr: string | null; tsv: string | null; pdf: number[] | null }[] = [];

  onProgress?.({
    status: "Loading OCR engine...",
    progress: 0,
    currentPage: 0,
    totalPages: 0,
  });

  const worker = await getOcrWorker(opts.language, opts.quality, onProgress);

  if (isPdfFile(filePath)) {
    const pages = await pdfToImages(filePath, opts.pageRange, onProgress);
    const totalPages = pages.length;

    for (let i = 0; i < pages.length; i++) {
      const { canvas, pageNumber } = pages[i];
      const base = 0.1 + (i / totalPages) * 0.9;
      const span = 0.9 / totalPages;

      setProgressContext(pageNumber, totalPages, base, span);
      onProgress?.({
        status: `recognizing`,
        progress: base,
        currentPage: pageNumber,
        totalPages,
      });

      try {
        const result = await recognizeImage(worker, canvas, opts.pageType, {
          hocr: true,
          tsv: true,
          pdf: true,
        });
        results.push({
          pageNumber,
          text: result.text,
          confidence: result.confidence,
        });
        rawOutputs.push({
          hocr: result.hocr,
          tsv: result.tsv,
          pdf: result.pdf,
        });

        onProgress?.({
          status: `done`,
          progress: 0.1 + ((i + 1) / totalPages) * 0.9,
          currentPage: pageNumber,
          totalPages,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          pageNumber,
          text: "",
          confidence: 0,
          error: errorMsg,
        });
        rawOutputs.push({ hocr: null, tsv: null, pdf: null });
        failedPages.push(pageNumber);
      }
    }
  } else {
    setProgressContext(1, 1, 0.1, 0.9);
    onProgress?.({
      status: "recognizing",
      progress: 0.1,
      currentPage: 1,
      totalPages: 1,
    });

    try {
      const result = await recognizeImage(worker, filePath, opts.pageType, {
        hocr: true,
        tsv: true,
        pdf: true,
      });
      results.push({
        pageNumber: 1,
        text: result.text,
        confidence: result.confidence,
      });
      rawOutputs.push({
        hocr: result.hocr,
        tsv: result.tsv,
        pdf: result.pdf,
      });

      onProgress?.({
        status: "done",
        progress: 1,
        currentPage: 1,
        totalPages: 1,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      results.push({
        pageNumber: 1,
        text: "",
        confidence: 0,
        error: errorMsg,
      });
      rawOutputs.push({ hocr: null, tsv: null, pdf: null });
      failedPages.push(1);
    }
  }

  await terminateOcrWorker();

  return {
    pages: results,
    language: opts.language,
    quality: opts.quality,
    totalPages: results.length,
    failedPages,
    rawOutputs,
  };
}

export async function pickOcrFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "OCR-supported files",
        extensions: [
          "pdf", "png", "jpg", "jpeg", "bmp", "webp", "tiff", "tif", "gif",
        ],
      },
    ],
  });
  if (!selected || typeof selected !== "string") return null;
  return selected;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: [
      { name: "Plain Text", extensions: ["txt"] },
      { name: "HOCR", extensions: ["hocr"] },
      { name: "TSV", extensions: ["tsv"] },
      { name: "PDF (searchable)", extensions: ["pdf"] },
    ],
  });
  return result;
}

export function getFormatFromPath(savePath: string): OcrFileFormat {
  const ext = savePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "hocr": return "hocr";
    case "tsv": return "tsv";
    case "pdf": return "pdf";
    default: return "txt";
  }
}

export function resultToPlainText(result: OcrResult): string {
  return result.pages
    .filter((p) => !p.error)
    .map((p) => p.text)
    .join("\n\n");
}

export async function saveResultToDisk(
  result: OcrResult,
  savePath: string,
  format: OcrFileFormat,
): Promise<void> {
  if (format === "txt") {
    const text = resultToPlainText(result);
    await invoke("save_document", { path: savePath, content: text });
  } else if (format === "hocr") {
    const hocrParts = result.rawOutputs
      .filter((r) => r.hocr)
      .map((r) => r.hocr as string);
    const fullHocr = hocrParts.join("\n");
    await invoke("save_document", { path: savePath, content: fullHocr });
  } else if (format === "tsv") {
    const tsvParts = result.rawOutputs
      .filter((r) => r.tsv)
      .map((r) => r.tsv as string);
    const fullTsv = tsvParts.join("\n");
    await invoke("save_document", { path: savePath, content: fullTsv });
  } else if (format === "pdf") {
    const pdfParts = result.rawOutputs
      .filter((r) => r.pdf)
      .map((r) => r.pdf as number[]);
    if (pdfParts.length === 0) {
      throw new Error("No searchable PDF was generated by Tesseract.");
    }
    const bytes = new Uint8Array(pdfParts[0]);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binary);
    await invoke("save_binary_file", { path: savePath, base64Content: base64 });
  }
}
