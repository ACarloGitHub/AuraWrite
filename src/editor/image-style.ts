// ============================================================================
// Image style — types, defaults and pure CSS computation for Phase 1 (G1)
// of the editor enrichment program (see wiki concepts/editor-enrichment-fase1).
//
// Single source of truth shared by: the schema dialect (enriched-schema.ts),
// the node view (image-node-view.ts) and the toolbar wiring
// (image-style-toolbar.ts). Pure functions only — no DOM writes here except
// returned strings.
// ============================================================================

export type ImageBorderStyle = "none" | "solid" | "dashed" | "dotted" | "double";

export type ImageFrameEffect = "none" | "raised" | "inset";

export interface ImageStyleAttrs {
  /** Corner rounding in px (0 = square corners). */
  cornerRadius: number;
  /** Master switch for the parametric drop shadow. */
  shadowEnabled: boolean;
  /** Shadow distance from the image edge, px. */
  shadowDistance: number;
  /** Shadow blur radius, px. */
  shadowBlur: number;
  /** Shadow opacity, percent (0-100). */
  shadowOpacity: number;
  /** Shadow color (#rrggbb). Black by default; pick a lighter tone on dark backgrounds. */
  shadowColor: string;
  /**
   * Direction the LIGHT comes FROM, in degrees, compass-like:
   * 0 = from top, 90 = from right, 180 = from bottom, 270 = from left.
   * Default 315 = top-left. The shadow is projected OPPOSITE the light.
   */
  shadowAngle: number;
  /** Border width, px (0 = no border). */
  borderWidth: number;
  /** Border color (#rrggbb). */
  borderColor: string;
  /** Border stroke style. */
  borderStyle: ImageBorderStyle;
  /** Emboss-like frame effect (approximated with layered shadows). */
  frameEffect: ImageFrameEffect;
}

export const DEFAULT_IMAGE_STYLE: ImageStyleAttrs = {
  cornerRadius: 0,
  shadowEnabled: false,
  shadowDistance: 6,
  shadowBlur: 10,
  shadowOpacity: 35,
  shadowColor: "#000000",
  shadowAngle: 315,
  borderWidth: 0,
  borderColor: "#333333",
  borderStyle: "solid",
  frameEffect: "none",
};

const BORDER_STYLES: ImageBorderStyle[] = ["none", "solid", "dashed", "dotted", "double"];
const FRAME_EFFECTS: ImageFrameEffect[] = ["none", "raised", "inset"];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fallback;
}

/** Read raw node attrs (or parsed data-* values) into a complete style object. */
export function normalizeImageStyle(raw: Record<string, unknown>): ImageStyleAttrs {
  const bs = String(raw.borderStyle ?? DEFAULT_IMAGE_STYLE.borderStyle) as ImageBorderStyle;
  const fe = String(raw.frameEffect ?? DEFAULT_IMAGE_STYLE.frameEffect) as ImageFrameEffect;
  return {
    cornerRadius: clampNum(raw.cornerRadius, 0, 500, DEFAULT_IMAGE_STYLE.cornerRadius),
    shadowEnabled: !!raw.shadowEnabled,
    shadowDistance: clampNum(raw.shadowDistance, 0, 100, DEFAULT_IMAGE_STYLE.shadowDistance),
    shadowBlur: clampNum(raw.shadowBlur, 0, 150, DEFAULT_IMAGE_STYLE.shadowBlur),
    shadowOpacity: clampNum(raw.shadowOpacity, 0, 100, DEFAULT_IMAGE_STYLE.shadowOpacity),
    shadowColor: clampColor(raw.shadowColor, DEFAULT_IMAGE_STYLE.shadowColor),
    shadowAngle: ((clampNum(raw.shadowAngle, -3600, 3600, DEFAULT_IMAGE_STYLE.shadowAngle) % 360) + 360) % 360,
    borderWidth: clampNum(raw.borderWidth, 0, 50, DEFAULT_IMAGE_STYLE.borderWidth),
    borderColor: clampColor(raw.borderColor, DEFAULT_IMAGE_STYLE.borderColor),
    borderStyle: BORDER_STYLES.includes(bs) ? bs : DEFAULT_IMAGE_STYLE.borderStyle,
    frameEffect: FRAME_EFFECTS.includes(fe) ? fe : DEFAULT_IMAGE_STYLE.frameEffect,
  };
}

/**
 * Convert a compass-like bearing (0 = up, clockwise) into a screen offset
 * vector scaled by `distance`. Screen y grows downward.
 */
export function bearingToOffset(bearingDeg: number, distance: number): { dx: number; dy: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  return { dx: Math.sin(rad) * distance, dy: -Math.cos(rad) * distance };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Convert #rgb / #rrggbb (+optional alpha) to an rgba() CSS color string. */
function hexToCssRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h.slice(0, 6), 16);
  if (!isFinite(int)) return `rgba(0, 0, 0, ${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Compute the box-shadow value(s) for the image.
 * Returns "" when nothing should be applied.
 *
 * Note: `raised` / `inset` effects are approximated with layered outer
 * shadows (true inset shadows are invisible on <img>). Documented
 * flattening towards Word applies regardless (contract D1).
 */
export function computeImageBoxShadow(style: ImageStyleAttrs): string {
  const layers: string[] = [];
  if (style.shadowEnabled) {
    const opposite = (style.shadowAngle + 180) % 360;
    const { dx, dy } = bearingToOffset(opposite, style.shadowDistance);
    const alpha = clampNum(style.shadowOpacity, 0, 100, 35) / 100;
    // When a frame is present it sits OUTSIDE the photo/caption, so the drop
    // shadow would be hidden behind it. Widen the shadow's source by the frame
    // width (spread) so it is cast from the frame's outer edge, not under it.
    const spread =
      style.borderWidth > 0 && style.borderStyle !== "none" ? style.borderWidth : 0;
    layers.push(
      `${fmt(dx)}px ${fmt(dy)}px ${fmt(style.shadowBlur)}px` +
        `${spread > 0 ? ` ${fmt(spread)}px` : ""} ${hexToCssRgba(style.shadowColor, alpha)}`
    );
  }
  if (style.frameEffect === "raised") {
    // Light comes from shadowAngle: bright edge toward the light, dark edge away.
    const litDir = bearingToOffset(style.shadowAngle, 2);
    const awayDir = bearingToOffset((style.shadowAngle + 180) % 360, 3);
    layers.push(
      `${fmt(-litDir.dx)}px ${fmt(-litDir.dy)}px 2px rgba(255, 255, 255, 0.85)`,
      `${fmt(awayDir.dx)}px ${fmt(awayDir.dy)}px 4px rgba(0, 0, 0, 0.45)`
    );
  } else if (style.frameEffect === "inset") {
    // Pressed look: dark edge toward the light, soft glow away.
    const litDir = bearingToOffset(style.shadowAngle, 3);
    const awayDir = bearingToOffset((style.shadowAngle + 180) % 360, 2);
    layers.push(
      `${fmt(litDir.dx)}px ${fmt(litDir.dy)}px 4px rgba(0, 0, 0, 0.5)`,
      `${fmt(-awayDir.dx)}px ${fmt(-awayDir.dy)}px 2px rgba(255, 255, 255, 0.7)`
    );
  }
  return layers.join(", ");
}

export interface ImageStyleCss {
  borderRadius?: string;
  border?: string;
  boxShadow?: string;
}

/** Full CSS fragment for the <img> element. Missing keys mean "clear". */
export function computeImageCss(style: ImageStyleAttrs): ImageStyleCss {
  const css: ImageStyleCss = {};
  if (style.cornerRadius > 0) css.borderRadius = `${fmt(style.cornerRadius)}px`;
  if (style.borderWidth > 0 && style.borderStyle !== "none") {
    css.border = `${fmt(style.borderWidth)}px ${style.borderStyle} ${style.borderColor}`;
  }
  const shadow = computeImageBoxShadow(style);
  if (shadow) css.boxShadow = shadow;
  return css;
}
