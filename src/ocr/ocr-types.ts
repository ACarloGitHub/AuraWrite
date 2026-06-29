export type OcrQuality = "best" | "medium" | "fast";

export type OcrPageType = "full" | "single_block" | "single_column" | "single_line";

export type OcrOutputMode = "insert" | "save";

export type OcrFileFormat = "txt" | "hocr" | "tsv" | "pdf";

export interface OcrLanguage {
  code: string;
  name: string;
  installed: boolean;
  hasBest: boolean;
  hasMedium: boolean;
  hasFast: boolean;
}

export interface OcrOptions {
  language: string;
  quality: OcrQuality;
  pageType: OcrPageType;
  pageRange: { start: number; end: number } | null;
  outputMode: OcrOutputMode;
  saveFormat: OcrFileFormat;
}

export interface OcrProgress {
  status: string;
  progress: number;
  currentPage: number;
  totalPages: number;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  error?: string;
}

export interface OcrRawOutput {
  hocr: string | null;
  tsv: string | null;
  pdf: number[] | null;
}

export interface OcrResult {
  pages: OcrPageResult[];
  language: string;
  quality: OcrQuality;
  totalPages: number;
  failedPages: number[];
  rawOutputs: OcrRawOutput[];
}

export const OCR_DEFAULTS: OcrOptions = {
  language: "eng",
  quality: "best",
  pageType: "full",
  pageRange: null,
  outputMode: "insert",
  saveFormat: "txt",
};

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "eng", name: "English" },
  { code: "ita", name: "Italiano" },
  { code: "fra", name: "Français" },
  { code: "deu", name: "Deutsch" },
  { code: "spa", name: "Español" },
  { code: "por", name: "Português" },
  { code: "rus", name: "Русский" },
  { code: "zho", name: "中文" },
  { code: "jpn", name: "日本語" },
  { code: "ara", name: "العربية" },
  { code: "hin", name: "हिन्दी" },
];

export function fileSuffixForQuality(q: OcrQuality): string {
  if (q === "medium") return "_medium";
  if (q === "fast") return "_fast";
  return "";
}