/**
 * E8 — the page's own decoration: its border and its watermark
 * ([[concepts/editor-enrichment-page-decor]]).
 *
 * Both are properties of the PAGE, never nodes of the document: one border and
 * one watermark belong to every sheet, so a node per page would mean three
 * hundred copies inside a book — copies that travel in the file, can be
 * selected, are undone, and that pagination would have to add and remove. The
 * formats agree: Word keeps the border as `w:pgBorders` and the watermark in the
 * header, not in the text.
 *
 * Where it lives: next to the margins and the page format (`pagination-state.ts`),
 * because that is where AuraWrite keeps what belongs to the sheet. When the P
 * chapter brings the document's own properties, the decoration follows them
 * without the drawing changing.
 *
 * WHAT IS NOT HERE YET, and deliberately: the drawing. The rectangles will be
 * built by the layer that E8 projects after this model — one box per page, behind
 * the text, only for the pages on screen, with the geometry the page calculator
 * already computed. This module is the data and the reading of it; nothing on
 * screen uses it yet, so nothing can disagree.
 */

const STORAGE_KEY = "aurawrite-page-decor";

/** A page border, as both word processors draw it: one rule, four sides. */
export interface PageBorder {
  /** Line thickness in pt (0.25 … 20). */
  widthPt: number;
  /** `#rrggbb` — the only colour both formats write verbatim. */
  color: string;
  /** How far the rule sits OUTSIDE the text area, in cm (0 … 5). */
  paddingCm: number;
}

/** The watermark: a text line, rotated, in transparency — LibreOffice's dialog. */
export interface PageWatermark {
  text: string;
  font: string;
  color: string;
  /** Degrees counter-clockwise from the baseline, as LibreOffice counts them. */
  angle: number;
  /** Percent: 0 is opaque, 100 invisible. */
  transparency: number;
}

export interface PageDecor {
  border: PageBorder | null;
  watermark: PageWatermark | null;
}

export const EMPTY_PAGE_DECOR: PageDecor = { border: null, watermark: null };

export const DEFAULT_PAGE_BORDER: PageBorder = { widthPt: 0.5, color: "#000000", paddingCm: 0.05 };

export const DEFAULT_WATERMARK: PageWatermark = {
  text: "",
  font: "Liberation Sans",
  color: "#c0c0c0",
  angle: 45,
  transparency: 50,
};

const clamp = (value: number, low: number, high: number): number =>
  Math.round(Math.min(high, Math.max(low, value)) * 100) / 100;

/** A colour the two formats can write and read back: `#rrggbb` only. */
function readColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function readBorder(raw: unknown): PageBorder | null {
  const b = raw as Partial<PageBorder> | null | undefined;
  if (!b || typeof b !== "object") return null;
  return {
    widthPt: clamp(Number(b.widthPt) || DEFAULT_PAGE_BORDER.widthPt, 0.25, 20),
    color: readColor(b.color, DEFAULT_PAGE_BORDER.color),
    paddingCm: clamp(Number(b.paddingCm) || 0, 0, 5),
  };
}

function readWatermark(raw: unknown): PageWatermark | null {
  const w = raw as Partial<PageWatermark> | null | undefined;
  if (!w || typeof w !== "object" || typeof w.text !== "string" || !w.text.trim()) return null;
  return {
    text: w.text,
    font: typeof w.font === "string" && w.font ? w.font : DEFAULT_WATERMARK.font,
    color: readColor(w.color, DEFAULT_WATERMARK.color),
    angle: clamp(Number(w.angle) || 0, -180, 180),
    transparency: clamp(Number(w.transparency) || 0, 0, 100),
  };
}

/** Anything (a stored value, a file) → a decoration the drawing can trust. */
export function normalizePageDecor(raw: unknown): PageDecor {
  const d = raw as Partial<PageDecor> | null | undefined;
  if (!d || typeof d !== "object") return EMPTY_PAGE_DECOR;
  return { border: readBorder(d.border), watermark: readWatermark(d.watermark) };
}

export function isEmptyPageDecor(decor: PageDecor): boolean {
  return decor.border === null && decor.watermark === null;
}

let current: PageDecor = load();

function load(): PageDecor {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePageDecor(JSON.parse(raw)) : EMPTY_PAGE_DECOR;
  } catch {
    return EMPTY_PAGE_DECOR;
  }
}

/** The decoration of the sheet, right now. */
export function getPageDecor(): PageDecor {
  return current;
}

/**
 * Change it, and keep it. `null` on a field removes that decoration; every value
 * is clamped and rounded on the way in, so what the drawing reads back is what
 * the file said (a border read out of a unit conversion must compare equal).
 */
export function setPageDecor(patch: Partial<PageDecor>): PageDecor {
  const next = normalizePageDecor({ border: current.border, watermark: current.watermark, ...patch });
  current = next;
  try {
    if (isEmptyPageDecor(next)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A storage that refuses (private window, quota) leaves the session decorated:
    // the paper still gets it, only the next launch forgets.
  }
  return next;
}