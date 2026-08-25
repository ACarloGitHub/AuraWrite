// ============================================================================
// Enriched schema — Phase 1 additions to the document schema.
//
// Hosts the D10 HTML marking dialect for the new elements. editor.ts imports
// from here at a SINGLE hook point (anti-bloat rule D5): attribute specs are
// spread into the image node spec; parse/toDOM helpers extend the existing
// data-* conventions.
//
// Conventions follow the existing image attrs: booleans as attribute
// presence, numbers/colors as data-* strings. Only non-default values are
// emitted to keep exported HTML clean.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import {
  DEFAULT_IMAGE_STYLE,
  normalizeImageStyle,
  type ImageBorderStyle,
  type ImageFrameEffect,
} from "./image-style";

/** Attr specs to spread into the image node spec (editor.ts). */
export const IMAGE_STYLE_ATTRS: Record<string, { default: unknown }> = {
  cornerRadius: { default: DEFAULT_IMAGE_STYLE.cornerRadius },
  shadowEnabled: { default: DEFAULT_IMAGE_STYLE.shadowEnabled },
  shadowDistance: { default: DEFAULT_IMAGE_STYLE.shadowDistance },
  shadowBlur: { default: DEFAULT_IMAGE_STYLE.shadowBlur },
  shadowOpacity: { default: DEFAULT_IMAGE_STYLE.shadowOpacity },
  shadowColor: { default: DEFAULT_IMAGE_STYLE.shadowColor },
  shadowAngle: { default: DEFAULT_IMAGE_STYLE.shadowAngle },
  borderWidth: { default: DEFAULT_IMAGE_STYLE.borderWidth },
  borderColor: { default: DEFAULT_IMAGE_STYLE.borderColor },
  borderStyle: { default: DEFAULT_IMAGE_STYLE.borderStyle },
  frameEffect: { default: DEFAULT_IMAGE_STYLE.frameEffect },
};

/** Read a numeric data-* attribute; fallback when missing or malformed. */
function numAttr(dom: HTMLElement, name: string, fallback: number): number {
  const raw = dom.getAttribute(name);
  if (raw === null || raw.trim() === "") return fallback;
  const n = parseFloat(raw);
  return isFinite(n) ? n : fallback;
}

/** Read the style data-* markers off an <img> element (D10 re-import side). */
export function imageStyleGetDOM(dom: HTMLElement): Record<string, unknown> {
  return {
    cornerRadius: numAttr(dom, "data-radius", DEFAULT_IMAGE_STYLE.cornerRadius),
    shadowEnabled: dom.hasAttribute("data-shadow-enabled"),
    shadowDistance: numAttr(dom, "data-shadow-distance", DEFAULT_IMAGE_STYLE.shadowDistance),
    shadowBlur: numAttr(dom, "data-shadow-blur", DEFAULT_IMAGE_STYLE.shadowBlur),
    shadowOpacity: numAttr(dom, "data-shadow-opacity", DEFAULT_IMAGE_STYLE.shadowOpacity),
    shadowColor: dom.getAttribute("data-shadow-color") || DEFAULT_IMAGE_STYLE.shadowColor,
    shadowAngle: numAttr(dom, "data-shadow-angle", DEFAULT_IMAGE_STYLE.shadowAngle),
    borderWidth: numAttr(dom, "data-border-width", DEFAULT_IMAGE_STYLE.borderWidth),
    borderColor: dom.getAttribute("data-border-color") || DEFAULT_IMAGE_STYLE.borderColor,
    borderStyle: (dom.getAttribute("data-border-style") || DEFAULT_IMAGE_STYLE.borderStyle) as ImageBorderStyle,
    frameEffect: (dom.getAttribute("data-frame-effect") || DEFAULT_IMAGE_STYLE.frameEffect) as ImageFrameEffect,
  };
}

/**
 * Emit the style data-* markers for an image node (D10 export side).
 * Returns only the attributes that differ from the defaults.
 */
export function imageStyleToDOM(node: PMNode): Record<string, string> {
  const s = normalizeImageStyle(node.attrs as Record<string, unknown>);
  const out: Record<string, string> = {};
  if (s.cornerRadius !== DEFAULT_IMAGE_STYLE.cornerRadius) out["data-radius"] = String(s.cornerRadius);
  if (s.shadowEnabled) out["data-shadow-enabled"] = "";
  if (s.shadowDistance !== DEFAULT_IMAGE_STYLE.shadowDistance)
    out["data-shadow-distance"] = String(s.shadowDistance);
  if (s.shadowBlur !== DEFAULT_IMAGE_STYLE.shadowBlur) out["data-shadow-blur"] = String(s.shadowBlur);
  if (s.shadowOpacity !== DEFAULT_IMAGE_STYLE.shadowOpacity) out["data-shadow-opacity"] = String(s.shadowOpacity);
  if (s.shadowColor.toLowerCase() !== DEFAULT_IMAGE_STYLE.shadowColor) out["data-shadow-color"] = s.shadowColor;
  if (s.shadowAngle !== DEFAULT_IMAGE_STYLE.shadowAngle) out["data-shadow-angle"] = String(s.shadowAngle);
  if (s.borderWidth !== DEFAULT_IMAGE_STYLE.borderWidth) out["data-border-width"] = String(s.borderWidth);
  if (s.borderColor.toLowerCase() !== DEFAULT_IMAGE_STYLE.borderColor) out["data-border-color"] = s.borderColor;
  if (s.borderStyle !== DEFAULT_IMAGE_STYLE.borderStyle) out["data-border-style"] = s.borderStyle;
  if (s.frameEffect !== DEFAULT_IMAGE_STYLE.frameEffect) out["data-frame-effect"] = s.frameEffect;
  return out;
}
