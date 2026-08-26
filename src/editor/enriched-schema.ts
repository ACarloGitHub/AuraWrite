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

import type { Node as PMNode, NodeSpec } from "prosemirror-model";
import {
  DEFAULT_IMAGE_STYLE,
  normalizeImageStyle,
  type ImageBorderStyle,
  type ImageFrameEffect,
} from "./image-style";
import {
  DEFAULT_BOX_STYLE,
  normalizeBoxStyle,
  computeBoxCss,
  type BoxAlign,
  type BoxBorderStyle,
  type BoxVariant,
} from "./box-style";

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

// ============================================================================
// styled_box node (Phase 1, step G2) — framed block container with editable
// normal content. Rendered by StyledBoxNodeView (box-node-view.ts), which owns
// its DOM: selection from the surface, flow drag via drop line, width resize.
// ============================================================================

const BOX_VARIANTS: BoxVariant[] = ["text", "note"];
const BOX_BORDER_STYLES: BoxBorderStyle[] = ["none", "solid", "dashed", "dotted", "double"];
const BOX_ALIGNS: BoxAlign[] = ["left", "center", "right"];

function oneOf<T extends string>(value: string, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Node spec appended to the schema in editor.ts (single hook point). */
export const STYLED_BOX_NODE_SPEC: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  selectable: true,
  attrs: {
    variant: { default: DEFAULT_BOX_STYLE.variant },
    align: { default: DEFAULT_BOX_STYLE.align },
    bgColor: { default: DEFAULT_BOX_STYLE.bgColor },
    borderWidth: { default: DEFAULT_BOX_STYLE.borderWidth },
    borderColor: { default: DEFAULT_BOX_STYLE.borderColor },
    borderStyle: { default: DEFAULT_BOX_STYLE.borderStyle },
    cornerRadius: { default: DEFAULT_BOX_STYLE.cornerRadius },
    widthPx: { default: DEFAULT_BOX_STYLE.widthPx },
  },
  parseDOM: [
    {
      tag: "div[data-aw-box]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        return boxStyleGetDOM(dom);
      },
    },
  ],
  toDOM(node) {
    const s = normalizeBoxStyle(node.attrs as Record<string, unknown>);
    const attrs: Record<string, string> = {
      "data-aw-box": s.variant,
      class: "aw-box",
    };
    if (s.bgColor) attrs["data-bg"] = s.bgColor;
    if (s.borderWidth > 0) attrs["data-border-width"] = String(s.borderWidth);
    if (s.borderWidth > 0 && s.borderStyle !== DEFAULT_BOX_STYLE.borderStyle)
      attrs["data-border-style"] = s.borderStyle;
    if (s.borderWidth > 0 && s.borderColor.toLowerCase() !== DEFAULT_BOX_STYLE.borderColor)
      attrs["data-border-color"] = s.borderColor;
    if (s.cornerRadius !== DEFAULT_BOX_STYLE.cornerRadius) attrs["data-radius"] = String(s.cornerRadius);
    if (s.widthPx != null) attrs["data-width"] = String(s.widthPx);
    if (s.align !== DEFAULT_BOX_STYLE.align) attrs["data-align"] = s.align;
    // D10 rule 1: emit BOTH the stable markers and the inline style, so the
    // markup renders universally outside AuraWrite and re-imports exactly.
    const css = computeBoxCss(s);
    const styleText = Object.entries(css)
      .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${value}`)
      .join("; ");
    if (styleText) attrs.style = styleText;
    return ["div", attrs, 0];
  },
};

/**
 * Read the D10 box markers off a <div data-aw-box> element (re-import side).
 * Markers are authoritative over inline style.
 */
export function boxStyleGetDOM(dom: HTMLElement): Record<string, unknown> {
  return {
    variant: oneOf<BoxVariant>(dom.getAttribute("data-aw-box") || "", BOX_VARIANTS, DEFAULT_BOX_STYLE.variant),
    bgColor: dom.getAttribute("data-bg") || "",
    borderWidth: numAttr(dom, "data-border-width", DEFAULT_BOX_STYLE.borderWidth),
    borderColor: dom.getAttribute("data-border-color") || DEFAULT_BOX_STYLE.borderColor,
    borderStyle: oneOf<BoxBorderStyle>(
      dom.getAttribute("data-border-style") || "",
      BOX_BORDER_STYLES,
      DEFAULT_BOX_STYLE.borderStyle
    ),
    cornerRadius: numAttr(dom, "data-radius", DEFAULT_BOX_STYLE.cornerRadius),
    widthPx: dom.hasAttribute("data-width") ? numAttr(dom, "data-width", NaN) : null,
    align: oneOf<BoxAlign>(
      dom.getAttribute("data-align") || "",
      BOX_ALIGNS,
      DEFAULT_BOX_STYLE.align
    ),
  };
}

// ============================================================================
// figure node (Phase 1, step G3) — composite figure: image + optional caption
// box. Rendered with plain CSS (flex column/row) from the data-caption-layout
// attribute; no custom node view. break-inside:avoid keeps it on one page.
// ============================================================================

const CAPTION_LAYOUTS = ["below", "above", "left", "right"] as const;
export type CaptionLayout = (typeof CAPTION_LAYOUTS)[number];
const DEFAULT_CAPTION_LAYOUT: CaptionLayout = "below";
const DEFAULT_CAPTION_GAP_PX = 12;

/** Node spec appended to the schema in editor.ts (single hook point). */
export const FIGURE_NODE_SPEC: NodeSpec = {
  content: "image styled_box?",
  group: "block",
  defining: true,
  selectable: true,
  attrs: {
    captionLayout: { default: DEFAULT_CAPTION_LAYOUT },
    captionGap: { default: DEFAULT_CAPTION_GAP_PX },
  },
  parseDOM: [
    {
      tag: "figure[data-aw-figure]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        return figureStyleGetDOM(dom);
      },
    },
  ],
  toDOM(node) {
    const layout = oneOf<string>(
      String(node.attrs.captionLayout ?? ""),
      CAPTION_LAYOUTS as unknown as string[],
      DEFAULT_CAPTION_LAYOUT
    );
    const rawGap = Number(node.attrs.captionGap);
    const gap = isFinite(rawGap) ? Math.max(0, Math.min(120, rawGap)) : DEFAULT_CAPTION_GAP_PX;
    const attrs: Record<string, string> = {
      "data-aw-figure": "",
      "data-caption-layout": layout,
      class: "aw-figure",
    };
    if (gap !== DEFAULT_CAPTION_GAP_PX) attrs["data-caption-gap"] = String(gap);
    attrs.style = `--aw-figure-gap: ${gap}px`;
    return ["figure", attrs, 0];
  },
};

/** Read the D10 figure markers off a <figure data-aw-figure> element. */
export function figureStyleGetDOM(dom: HTMLElement): Record<string, unknown> {
  const rawGap = numAttr(dom, "data-caption-gap", DEFAULT_CAPTION_GAP_PX);
  return {
    captionLayout: oneOf<string>(
      dom.getAttribute("data-caption-layout") || "",
      CAPTION_LAYOUTS as unknown as string[],
      DEFAULT_CAPTION_LAYOUT
    ),
    captionGap: Math.max(0, Math.min(120, rawGap)),
  };
}
