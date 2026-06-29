import Tesseract, { Worker, PSM } from "tesseract.js";
import { OcrQuality, OcrPageType, OcrProgress } from "./ocr-types";

let activeWorker: Worker | null = null;
let workerLanguage: string | null = null;

const PSM_MAP: Record<OcrPageType, PSM> = {
  full: PSM.AUTO,
  single_block: PSM.SINGLE_BLOCK,
  single_column: PSM.SINGLE_COLUMN,
  single_line: PSM.SINGLE_LINE,
};

const TESSERACT_WORKER_PATH = "/tesseract/worker.min.js";
const TESSERACT_CORE_PATH = "/tesseract";
const TESSERACT_LANG_PATH = "/tessdata";

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

    const worker = await Tesseract.createWorker(language, undefined, {
      workerPath: TESSERACT_WORKER_PATH,
      corePath: TESSERACT_CORE_PATH,
      langPath: TESSERACT_LANG_PATH,
      gzip: true,
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
  }
}

export function isOcrWorkerActive(): boolean {
  return activeWorker !== null;
}