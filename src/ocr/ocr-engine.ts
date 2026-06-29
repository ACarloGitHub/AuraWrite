import Tesseract, { Worker, PSM } from "tesseract.js";
import { OcrQuality, OcrPageType, OcrProgress } from "./ocr-types";

let activeWorker: Worker | null = null;
let workerLanguage: string | null = null;
let workerQuality: OcrQuality | null = null;

const PSM_MAP: Record<OcrPageType, PSM> = {
  full: PSM.AUTO,
  single_block: PSM.SINGLE_BLOCK,
  single_column: PSM.SINGLE_COLUMN,
  single_line: PSM.SINGLE_LINE,
};

export async function getOcrWorker(
  language: string,
  quality: OcrQuality,
  onProgress?: (progress: OcrProgress) => void,
): Promise<Worker> {
  const needsNewWorker =
    !activeWorker ||
    workerLanguage !== language ||
    workerQuality !== quality;

  if (activeWorker && needsNewWorker) {
    await activeWorker.terminate();
    activeWorker = null;
    workerLanguage = null;
    workerQuality = null;
  }

  if (!activeWorker) {
    onProgress?.({
      status: "Initializing OCR engine...",
      progress: 0,
      currentPage: 0,
      totalPages: 0,
    });

    const worker = await Tesseract.createWorker(language, undefined, {
      logger: (m) => {
        if (onProgress && m.progress !== undefined) {
          onProgress({
            status: m.status || "Processing...",
            progress: m.progress,
            currentPage: 0,
            totalPages: 0,
          });
        }
      },
    });

    activeWorker = worker;
    workerLanguage = language;
    workerQuality = quality;
  }

  return activeWorker;
}

export async function recognizeImage(
  worker: Worker,
  imageSource: string | HTMLImageElement | HTMLCanvasElement | File,
  pageType: OcrPageType,
): Promise<{ text: string; confidence: number }> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM_MAP[pageType],
  });

  const result = await worker.recognize(imageSource);

  return {
    text: result.data.text,
    confidence: result.data.confidence,
  };
}

export async function terminateOcrWorker(): Promise<void> {
  if (activeWorker) {
    await activeWorker.terminate();
    activeWorker = null;
    workerLanguage = null;
    workerQuality = null;
  }
}

export function isOcrWorkerActive(): boolean {
  return activeWorker !== null;
}