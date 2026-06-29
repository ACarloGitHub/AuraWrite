import { getOcrWorker, terminateOcrWorker, recognizeImage } from "./ocr-engine";
import { OcrOptions, OcrResult, OcrPageResult, OcrProgress, OCR_DEFAULTS } from "./ocr-types";
import { open, save } from "@tauri-apps/plugin-dialog";

let pdfjsModule: typeof import("pdfjs-dist") | null = null;

async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist");
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
): Promise<{ canvas: HTMLCanvasElement; pageNumber: number }[]> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument(pdfPath).promise;
  const totalPages = pdf.numPages;

  const startPage = pageRange?.start ?? 1;
  const endPage = pageRange?.end ?? totalPages;

  const pages: { canvas: HTMLCanvasElement; pageNumber: number }[] = [];

  for (let i = startPage; i <= endPage; i++) {
    onProgress?.({
      status: `Rendering page ${i} of ${endPage}...`,
      progress: (i - startPage) / (endPage - startPage + 1) * 0.3,
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
    pages.push({ canvas, pageNumber: i });
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
      onProgress?.({
        status: `Processing page ${pageNumber} of ${totalPages}...`,
        progress: 0.3 + (i / totalPages) * 0.7,
        currentPage: pageNumber,
        totalPages,
      });

      try {
        const result = await recognizeImage(worker, canvas, opts.pageType);
        results.push({
          pageNumber,
          text: result.text,
          confidence: result.confidence,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          pageNumber,
          text: "",
          confidence: 0,
          error: errorMsg,
        });
        failedPages.push(pageNumber);
      }
    }
  } else {
    onProgress?.({
      status: "Processing image...",
      progress: 0.3,
      currentPage: 1,
      totalPages: 1,
    });

    try {
      const result = await recognizeImage(worker, filePath, opts.pageType);
      results.push({
        pageNumber: 1,
        text: result.text,
        confidence: result.confidence,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      results.push({
        pageNumber: 1,
        text: "",
        confidence: 0,
        error: errorMsg,
      });
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

export function resultToPlainText(result: OcrResult): string {
  return result.pages
    .filter((p) => !p.error)
    .map((p) => p.text)
    .join("\n\n--- Page " + "---\n\n");
}

export function resultToTsv(result: OcrResult): string {
  const header = "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const rows: string[] = [header];
  for (const page of result.pages) {
    if (page.error) continue;
    const lines = page.text.split("\n");
    for (const line of lines) {
      const words = line.split(/\s+/);
      for (const word of words) {
        if (word) {
          rows.push(`1\t${page.pageNumber}\t0\t0\t0\t1\t0\t0\t0\t0\t${page.confidence.toFixed(2)}\t${word}`);
        }
      }
    }
  }
  return rows.join("\n");
}