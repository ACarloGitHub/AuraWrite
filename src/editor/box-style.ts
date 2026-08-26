// ============================================================================
// Box style — types, defaults and pure CSS computation for Phase 1 (G2)
// of the editor enrichment program (see wiki concepts/editor-enrichment-fase1).
//
// Mirrors image-style.ts: single source of truth shared by the schema dialect
// (enriched-schema.ts), the commands (box-commands.ts), the node view
// (box-node-view.ts) and the panel wiring (box-style-toolbar.ts).
// Pure functions only — no DOM access here.
//
// Inner typography (family/size/color) is deliberately NOT a node attribute:
// per Carlo's decision (2026-08-25) it stays with the existing main-toolbar
// text-mark commands, which already work inside the box.
// ============================================================================

export type BoxVariant = "text" | "note";

export type BoxBorderStyle = "none" | "solid" | "dashed" | "dotted" | "double";

export interface BoxStyleAttrs {
  /** Dress of the box: plain text box or sticky-note (preset colors). */
  variant: BoxVariant;
  /** Background fill (#rrggbb); empty = transparent. */
  bgColor: string;
  /** Border width, px (0 = no border). */
  borderWidth: number;
  /** Border color (#rrggbb). */
  borderColor: string;
  /** Border stroke style. */
  borderStyle: BoxBorderStyle;
  /** Corner rounding, px. */
  cornerRadius: number;
  /** Fixed width in px; null = full column width. */
  widthPx: number | null;
}

export const BOX_WIDTH_MIN = 60;
export const BOX_WIDTH_MAX = 4000;

export const DEFAULT_BOX_STYLE: BoxStyleAttrs = {
  variant: "text",
  bgColor: "",
  borderWidth: 0,
  borderColor: "#999999",
  borderStyle: "solid",
  cornerRadius: 8,
  widthPx: null,
};

/** Sticky-note preset: soft yellow card ≈300px wide (contract G2). */
export const NOTE_PRESET: Partial<BoxStyleAttrs> = {
  variant: "note",
  bgColor: "#FEF6D8",
  borderColor: "#E3CE8F",
  borderWidth: 1,
  borderStyle: "solid",
  cornerRadius: 8,
  widthPx: 300,
};

/** Text box preset: full-width framed container. */
export const TEXT_BOX_PRESET: Partial<BoxStyleAttrs> = {
  variant: "text",
  bgColor: "",
  borderColor: "#B9B9B9",
  borderWidth: 1,
  borderStyle: "solid",
  cornerRadius: 8,
  widthPx: null,
};

const BOX_BORDER_STYLES: BoxBorderStyle[] = ["none", "solid", "dashed", "dotted", "double"];
const BOX_VARIANTS: BoxVariant[] = ["text", "note"];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fallback;
}

/** Read raw node attrs into a complete, clamped box style object. */
export function normalizeBoxStyle(raw: Record<string, unknown>): BoxStyleAttrs {
  const bs = String(raw.borderStyle ?? DEFAULT_BOX_STYLE.borderStyle) as BoxBorderStyle;
  const bv = String(raw.variant ?? DEFAULT_BOX_STYLE.variant) as BoxVariant;
  let widthPx: number | null = null;
  if (raw.widthPx !== null && raw.widthPx !== undefined && raw.widthPx !== "") {
    const n = clampNum(raw.widthPx, BOX_WIDTH_MIN, BOX_WIDTH_MAX, NaN);
    if (isFinite(n)) widthPx = n;
  }
  return {
    variant: BOX_VARIANTS.includes(bv) ? bv : DEFAULT_BOX_STYLE.variant,
    bgColor: clampColor(raw.bgColor, ""),
    borderWidth: clampNum(raw.borderWidth, 0, 24, DEFAULT_BOX_STYLE.borderWidth),
    borderColor: clampColor(raw.borderColor, DEFAULT_BOX_STYLE.borderColor),
    borderStyle: BOX_BORDER_STYLES.includes(bs) ? bs : DEFAULT_BOX_STYLE.borderStyle,
    cornerRadius: clampNum(raw.cornerRadius, 0, 100, DEFAULT_BOX_STYLE.cornerRadius),
    widthPx,
  };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * True when the given background hex color is light enough that dark text is
 * required for legibility on screen. Editor-display concern only: exports and
 * print keep their own font-color settings.
 */
export function isLightBgColor(color: string | undefined | null): boolean {
  const raw = (color ?? "").trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (!match) return false;
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.72;
}

export interface BoxStyleCss {
  background?: string;
  border?: string;
  borderRadius?: string;
  width?: string;
}

/** CSS fragment for the box element. Missing keys mean "inherit/clear". */
export function computeBoxCss(style: BoxStyleAttrs): BoxStyleCss {
  const css: BoxStyleCss = {};
  if (style.bgColor) css.background = style.bgColor;
  if (style.borderWidth > 0 && style.borderStyle !== "none") {
    css.border = `${fmt(style.borderWidth)}px ${style.borderStyle} ${style.borderColor}`;
  }
  css.borderRadius = `${fmt(style.cornerRadius)}px`;
  if (style.widthPx != null) css.width = `${fmt(style.widthPx)}px`;
  return css;
}
