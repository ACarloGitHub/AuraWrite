import Tesseract, { Worker, PSM, LoggerMessage } from "tesseract.js";
import { OcrQuality, OcrPageType, OcrProgress } from "./ocr-types";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

let activeWorker: Worker | null = null;
let activeWorkerLang: string | null = null;
let activeWorkerQuality: OcrQuality | null = null;

const PSM_MAP: Record<OcrPageType, PSM> = {
  full: PSM.AUTO,
  single_block: PSM.SINGLE_BLOCK,
  single_column: PSM.SINGLE_COLUMN,
  single_line: PSM.SINGLE_LINE,
};

let activeOnProgress: ((p: OcrProgress) => void) | null = null;
let loggerCurrentPage = 0;
let loggerTotalPages = 0;
let loggerBaseProgress = 0;
let loggerPageSpan = 0;

/// Bundled languages that ship with the app in public/tessdata/.
/// These can be used offline immediately as "medium" quality.
const BUNDLED_LANGUAGES = ["eng", "ita"];

/// Ensures the requested model variant is available. If the model is
/// missing and the language is bundled (eng/ita) with quality "medium",
/// installs the bundled file into app_data. Otherwise triggers a full
/// download of all three variants.
async function ensureModelAvailable(
  language: string,
  quality: OcrQuality,
): Promise<boolean> {
  // Check if the requested variant exists in app_data.
  try {
    const installed = await invoke<boolean>("ocr_is_installed", {
      lang: language,
      quality,
    });
    if (installed) return true;
  } catch {
    // fall through
  }

  // For bundled languages at "medium" quality, install the bundled file.
  if (BUNDLED_LANGUAGES.includes(language)) {
    const ok = await installBundledAsMedium(language);
    if (ok && quality === "medium") return true;
    if (ok) {
      // Check again after installing medium
      try {
        const installed = await invoke<boolean>("ocr_is_installed", {
          lang: language,
          quality,
        });
        if (installed) return true;
      } catch {
        // fall through to download
      }
    }
  }

  // Full download (all three variants).
  try {
    await invoke("ocr_download_language", { lang: language });
    // Verify the requested variant now exists.
    const installed = await invoke<boolean>("ocr_is_installed", {
      lang: language,
      quality,
    });
    return installed;
  } catch (e) {
    console.warn(`[OCR] Download failed for ${language}:`, e);
    return false;
  }
}

/// Fetches the bundled <lang>.traineddata.gz from the app's public folder
/// and saves it into app_data as <lang>_medium.traineddata.gz via a Rust
/// command. Returns true on success.
async function installBundledAsMedium(lang: string): Promise<boolean> {
  try {
    const resp = await fetch(`/tessdata/${lang}.traineddata.gz`);
    if (!resp.ok) return false;
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Convert to base64 for transfer to Rust.
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binary);

    await invoke("ocr_save_bundled_medium", { lang, base64Data: base64 });
    return true;
  } catch (e) {
    console.warn(`[OCR] Failed to install bundled ${lang}:`, e);
    return false;
  }
}

export async function getOcrWorker(
  language: string,
  quality: OcrQuality,
  onProgress?: (progress: OcrProgress) => void,
): Promise<Worker> {
  const sameAsActive =
    activeWorker !== null &&
    activeWorkerLang === language &&
    activeWorkerQuality === quality;

  if (!sameAsActive) {
    if (activeWorker) {
      await activeWorker.terminate();
      activeWorker = null;
      activeWorkerLang = null;
      activeWorkerQuality = null;
    }
  }

  if (activeWorker) {
    return activeWorker;
  }

  onProgress?.({
    status: `Loading ${language} (${quality}) model...`,
    progress: 0,
    currentPage: 0,
    totalPages: 0,
  });

  activeOnProgress = onProgress ?? null;

  // 1. Ensure the model variant is available on disk.
  const available = await ensureModelAvailable(language, quality);
  if (!available) {
    throw new Error(
      `Could not load ${language} (${quality}) model. Check your internet connection or install it from Preferences → OCR.`,
    );
  }

  // 2. Prepare the model: copy/gzip the requested variant into
  //    <lang>.traineddata.gz so Tesseract.js can find it.
  try {
    await invoke("ocr_prepare_model", { lang: language, quality });
  } catch (e) {
    throw new Error(`Failed to prepare ${language} (${quality}) model: ${e}`);
  }

  // 3. Get the tessdata directory path and convert to an asset:// URL.
  let tessdataPath: string;
  try {
    tessdataPath = await invoke<string>("ocr_get_tessdata_dir");
  } catch (e) {
    throw new Error(`Failed to get tessdata directory: ${e}`);
  }
  const langPath = convertFileSrc(tessdataPath);

  // 4. Create the worker with langPath pointing at the prepared directory.
  //    Pass the language as a string — Tesseract.js will fetch
  //    <langPath>/<lang>.traineddata.gz from there.
  const workerOptions: Partial<Tesseract.WorkerOptions> = {
    corePath: "/tesseract/tesseract-core-simd.wasm.js",
    workerPath: "/tesseract/worker.min.js",
    workerBlobURL: false,
    langPath,
    gzip: true,
    logger: (m: LoggerMessage) => {
      if (!activeOnProgress || m.progress === undefined) return;
      const cumulative = loggerBaseProgress + m.progress * loggerPageSpan;
      activeOnProgress({
        status: m.status || "Processing...",
        progress: cumulative,
        currentPage: loggerCurrentPage,
        totalPages: loggerTotalPages,
      });
    },
  };

  activeWorker = await Tesseract.createWorker(
    language,
    undefined,
    workerOptions,
  );
  activeWorkerLang = language;
  activeWorkerQuality = quality;
  return activeWorker;
}

export function setProgressContext(
  page: number,
  total: number,
  base: number,
  span: number,
): void {
  loggerCurrentPage = page;
  loggerTotalPages = total;
  loggerBaseProgress = base;
  loggerPageSpan = span;
}

export async function recognizeImage(
  worker: Worker,
  imageSource: string | HTMLImageElement | HTMLCanvasElement | File,
  pageType: OcrPageType,
  outputFormats: { hocr?: boolean; tsv?: boolean; pdf?: boolean },
): Promise<{
  text: string;
  confidence: number;
  hocr: string | null;
  tsv: string | null;
  pdf: number[] | null;
}> {
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
    activeWorkerLang = null;
    activeWorkerQuality = null;
    activeOnProgress = null;
    loggerCurrentPage = 0;
    loggerTotalPages = 0;
    loggerBaseProgress = 0;
    loggerPageSpan = 0;
  }
}

export function isOcrWorkerActive(): boolean {
  return activeWorker !== null;
}