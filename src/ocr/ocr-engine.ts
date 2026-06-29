import Tesseract, { Worker, PSM, LoggerMessage } from "tesseract.js";
import { OcrQuality, OcrPageType, OcrProgress } from "./ocr-types";

let activeWorker: Worker | null = null;
let workerLanguage: string | null = null;

const PSM_MAP: Record<OcrPageType, PSM> = {
  full: PSM.AUTO,
  single_block: PSM.SINGLE_BLOCK,
  single_column: PSM.SINGLE_COLUMN,
  single_line: PSM.SINGLE_LINE,
};

export type OcrProgressCallback = (
  status: string,
  pageProgress: number,
) => void;

let activeLoggerCallback: OcrProgressCallback | null = null;

export async function getOcrWorker(
  language: string,
  _quality: OcrQuality,
  onProgress?: (progress: OcrProgress) => void,
): Promise<Worker> {
  const needsNewWorker = !activeWorker || workerLanguage !== language;

  if (activeWorker && needsNewWorker) {
    await activeWorker.terminate();
    activeWorker = null;
    workerLanguage = null;
  }

  if (!activeWorker) {
    onProgress?.({
      status: "Initializing OCR engine...",
      progress: 0,
      currentPage: 0,
      totalPages: 0,
    });

    activeLoggerCallback = (status: string, pageProgress: number) => {
      if (!onProgress) return;
      onProgress({
        status,
        progress: pageProgress,
        currentPage: 0,
        totalPages: 0,
      });
    };

    const worker = await Tesseract.createWorker(language, undefined, {
      langPath: "/tessdata",
      gzip: true,
      logger: (m: LoggerMessage) => {
        if (activeLoggerCallback && m.progress !== undefined) {
          activeLoggerCallback(m.status || "Processing...", m.progress);
        }
      },
    });

    activeWorker = worker;
    workerLanguage = language;
  }

  return activeWorker;
}

export async function recognizeImage(
  worker: Worker,
  imageSource: string | HTMLImageElement | HTMLCanvasElement | File,
  pageType: OcrPageType,
  outputFormats: { hocr?: boolean; tsv?: boolean; pdf?: boolean },
): Promise<{ text: string; confidence: number; hocr: string | null; tsv: string | null; pdf: number[] | null }> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM_MAP[pageType],
  });

  const result = await worker.recognize(
    imageSource,
    {},
    {
      text: true,
      hocr: outputFormats.hocr ?? false,
      tsv: outputFormats.tsv ?? false,
      pdf: outputFormats.pdf ?? false,
    },
  );

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    hocr: result.data.hocr ?? null,
    tsv: result.data.tsv ?? null,
    pdf: result.data.pdf ?? null,
  };
}

export async function terminateOcrWorker(): Promise<void> {
  if (activeWorker) {
    await activeWorker.terminate();
    activeWorker = null;
    workerLanguage = null;
    activeLoggerCallback = null;
  }
}

export function isOcrWorkerActive(): boolean {
  return activeWorker !== null;
}