export type OcrQuality = "fast" | "best";

export type OcrPageType = "full" | "single_block" | "single_column" | "single_line";

export type OcrOutputMode = "insert" | "save";

export type OcrFileFormat = "txt" | "hocr" | "tsv" | "pdf" | "page" | "alto";

export interface OcrLanguage {
  code: string;
  name: string;
  installed: boolean;
  installing: boolean;
  hasFast: boolean;
  hasBest: boolean;
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

export interface OcrResult {
  pages: OcrPageResult[];
  language: string;
  quality: OcrQuality;
  totalPages: number;
  failedPages: number[];
}

export const OCR_DEFAULTS: OcrOptions = {
  language: "eng",
  quality: "best",
  pageType: "full",
  pageRange: null,
  outputMode: "insert",
  saveFormat: "txt",
};

export const PREBUNDLED_LANGUAGES: OcrLanguage[] = [
  { code: "eng", name: "English", installed: true, installing: false, hasFast: true, hasBest: true },
  { code: "ita", name: "Italiano", installed: true, installing: false, hasFast: true, hasBest: true },
];

export const DOWNLOADABLE_LANGUAGES: OcrLanguage[] = [
  { code: "fra", name: "Fran\u00e7ais", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "deu", name: "Deutsch", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "spa", name: "Espa\u00f1ol", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "por", name: "Portugu\u00eas", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "rus", name: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "zho", name: "\u4e2d\u6587", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "jpn", name: "\u65e5\u672c\u8a9e", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "ara", name: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", installed: false, installing: false, hasFast: false, hasBest: false },
  { code: "hin", name: "\u0939\u093f\u0928\u094d\u0926\u0940", installed: false, installing: false, hasFast: false, hasBest: false },
];

export function trainedDataPath(lang: string, quality: OcrQuality): string {
  const suffix = quality === "fast" ? "_fast" : "_best";
  return `/tessdata/${lang}${suffix}.traineddata`;
}