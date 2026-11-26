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
 * Where the drawing lives: the screen layer (`page-decor-layer.ts`), the print
 * sheets (`print-pages.ts`) and the Word section (`formats/docx.ts`). They all
 * read the same numbers through the conversions below, so the three surfaces
 * cannot disagree; this module owns the model, its storage and its geometry.
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

// ---------------------------------------------------------------------------
// THE SHARED GEOMETRY (screen, paper and Word read the same numbers)
//
// The model above stores what a word processor's dialog stores; the drawing
// needs pixels, and the DOCX writer needs points. These are the only
// conversions in the tool, so the three surfaces cannot disagree: a border of
// 1 pt is the same line on screen, on the sheet and in Word.
// ---------------------------------------------------------------------------

/** CSS pixels in a typographic point (96 dpi). */
export const PT_TO_PX = 4 / 3;
/** CSS pixels in a centimetre. */
export const CM_TO_PX = 96 / 2.54;
/** Points in a centimetre (Word's `w:space` is in points). */
export const CM_TO_PT = 72 / 2.54;
/**
 * The watermark's size. The model has no size of its own (LibreOffice's dialog
 * does not ask for one either): 48 pt is that dialog's default, the same number
 * here as on the paper.
 */
export const WATERMARK_FONT_PX = 48 * PT_TO_PX;

/** The rule's thickness in CSS pixels. */
export function borderStrokePx(border: PageBorder): number {
  return Math.max(1, border.widthPt * PT_TO_PX);
}

/** The rule's thickness in eighths of a point, as `w:sz` counts it. */
export function borderSizeEighths(border: PageBorder): number {
  return Math.max(2, Math.round(border.widthPt * 8));
}

/** The rule's distance from the text in points, as `w:space` counts it. */
export function borderSpacePt(border: PageBorder): number {
  return Math.round(border.paddingCm * CM_TO_PT);
}

/** Transparency percent (LibreOffice: 0 opaque, 100 invisible) → CSS opacity. */
export function watermarkOpacity(watermark: PageWatermark): number {
  return Math.round((1 - watermark.transparency / 100) * 100) / 100;
}

/** The text area of one sheet, in the sheet's own coordinates. */
export interface TextArea {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The whole sheet, so the rule can be kept inside it. */
  sheetWidth: number;
  sheetHeight: number;
}

/** Where the four sides of the border run, in the sheet's coordinates. */
export interface BorderBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The distance text → rule after the clamp (may be smaller than asked). */
  paddingPx: number;
}

/**
 * The border's own rectangle: the text area grown outwards by `paddingCm` and
 * by the rule's thickness (the rule is drawn INSIDE the box, so its inner edge
 * is the distance the model asks for). The distance shrinks when the sheet has
 * no room for it: the rule never leaves the page, and the border never claims
 * more than the smallest margin allows.
 */
export function borderBox(area: TextArea, border: PageBorder): BorderBox {
  const stroke = borderStrokePx(border);
  const room = Math.min(
    area.left,
    area.top,
    area.sheetWidth - area.left - area.width,
    area.sheetHeight - area.top - area.height,
  );
  const paddingPx = Math.max(0, Math.min(border.paddingCm * CM_TO_PX, room - stroke));
  // The clamp keeps every side inside the sheet even when the margin is
  // smaller than the rule itself (a full-bleed page): the rule then sits on
  // the sheet's edge instead of being cut by it.
  const left = Math.max(0, area.left - paddingPx - stroke);
  const top = Math.max(0, area.top - paddingPx - stroke);
  const right = Math.min(area.sheetWidth, area.left + area.width + paddingPx + stroke);
  const bottom = Math.min(area.sheetHeight, area.top + area.height + paddingPx + stroke);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    paddingPx,
  };
}

/** Announced when the sheet's decoration changes, so the drawing can follow. */
export const PAGE_DECOR_EVENT = "aurawrite:page-decor-changed";

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
  // A headless run (the DOCX proof) has no window: the value still changes,
  // only nobody is there to redraw.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PAGE_DECOR_EVENT, { detail: { decor: next } }));
  }
  return next;
}