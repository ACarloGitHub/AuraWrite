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
  computeImageBoxShadow,
  computeImageCss,
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
import {
  freeLayoutGetDOM,
  freeLayoutToDOM,
  LEVEL_DEFAULT,
  parseFreeSpec,
  type FreeSpec,
} from "./free-layout";
import {
  isWrapping,
  textConditionFromMarker,
  textConditionMarker,
  textConditionOf,
} from "./element-condition";
import { elementDecorationExtent } from "./element-decoration";
import { OBSTACLE_MARGIN_PX } from "./text-obstacles";

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

/**
 * Free-layout attr specs (F3.a) to spread into every free-capable node spec:
 * `free` = null while in flow, otherwise the position RELATIVE TO THE ANCHOR
 * block (never a page coordinate); `zLevel` = depth in the shared numeric
 * scale, also carried by text blocks. See free-layout.ts and contract §5.
 */
export const FREE_LAYOUT_ATTRS: Record<string, { default: unknown }> = {
  free: { default: null },
  zLevel: { default: LEVEL_DEFAULT },
};

/** Normalise the `free` attribute of a node (defensive: bad data = in flow). */
export function readFreeAttr(value: unknown): FreeSpec | null {
  return parseFreeSpec(value);
}

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
    // U1: opacity is shared by every element.
    opacity: numAttr(dom, "data-opacity", 100),
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
  const opacity = Number(node.attrs.opacity);
  if (isFinite(opacity) && opacity < 100) out["data-opacity"] = String(Math.max(0, Math.round(opacity)));
  return out;
}

/** Opacity is shared by every element (contract U1). */
export const OPACITY_ATTR: Record<string, { default: unknown }> = { opacity: { default: 100 } };

/**
 * Shadow, frame effect and opacity for an element that keeps its OWN border
 * model (the styled box). The image and the figure already carry the shadow and
 * frame-effect attrs through IMAGE_STYLE_ATTRS; they only need OPACITY_ATTR.
 */
export const SHARED_EFFECT_ATTRS: Record<string, { default: unknown }> = {
  shadowEnabled: { default: DEFAULT_IMAGE_STYLE.shadowEnabled },
  shadowDistance: { default: DEFAULT_IMAGE_STYLE.shadowDistance },
  shadowBlur: { default: DEFAULT_IMAGE_STYLE.shadowBlur },
  shadowOpacity: { default: DEFAULT_IMAGE_STYLE.shadowOpacity },
  shadowColor: { default: DEFAULT_IMAGE_STYLE.shadowColor },
  shadowAngle: { default: DEFAULT_IMAGE_STYLE.shadowAngle },
  frameEffect: { default: DEFAULT_IMAGE_STYLE.frameEffect },
  ...OPACITY_ATTR,
};

/** Read the shared effect markers (shadow, frame effect, opacity) off an element. */
export function sharedEffectGetDOM(dom: HTMLElement): Record<string, unknown> {
  return {
    shadowEnabled: dom.hasAttribute("data-shadow-enabled"),
    shadowDistance: numAttr(dom, "data-shadow-distance", DEFAULT_IMAGE_STYLE.shadowDistance),
    shadowBlur: numAttr(dom, "data-shadow-blur", DEFAULT_IMAGE_STYLE.shadowBlur),
    shadowOpacity: numAttr(dom, "data-shadow-opacity", DEFAULT_IMAGE_STYLE.shadowOpacity),
    shadowColor: dom.getAttribute("data-shadow-color") || DEFAULT_IMAGE_STYLE.shadowColor,
    shadowAngle: numAttr(dom, "data-shadow-angle", DEFAULT_IMAGE_STYLE.shadowAngle),
    frameEffect: (dom.getAttribute("data-frame-effect") || DEFAULT_IMAGE_STYLE.frameEffect) as ImageFrameEffect,
    opacity: numAttr(dom, "data-opacity", 100),
  };
}

/** Emit the shared effect markers for a node (D10 export side). */
export function sharedEffectToDOM(node: PMNode): Record<string, string> {
  const s = normalizeImageStyle(node.attrs as Record<string, unknown>);
  const out: Record<string, string> = {};
  if (s.shadowEnabled) out["data-shadow-enabled"] = "";
  if (s.shadowDistance !== DEFAULT_IMAGE_STYLE.shadowDistance) out["data-shadow-distance"] = String(s.shadowDistance);
  if (s.shadowBlur !== DEFAULT_IMAGE_STYLE.shadowBlur) out["data-shadow-blur"] = String(s.shadowBlur);
  if (s.shadowOpacity !== DEFAULT_IMAGE_STYLE.shadowOpacity) out["data-shadow-opacity"] = String(s.shadowOpacity);
  if (s.shadowColor.toLowerCase() !== DEFAULT_IMAGE_STYLE.shadowColor) out["data-shadow-color"] = s.shadowColor;
  if (s.shadowAngle !== DEFAULT_IMAGE_STYLE.shadowAngle) out["data-shadow-angle"] = String(s.shadowAngle);
  if (s.frameEffect !== DEFAULT_IMAGE_STYLE.frameEffect) out["data-frame-effect"] = s.frameEffect;
  const opacity = Number(node.attrs.opacity);
  if (isFinite(opacity) && opacity < 100) out["data-opacity"] = String(Math.max(0, Math.round(opacity)));
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
    // F3.a: a box participates in wrapping and depth like the other elements.
    // The wrap STATE is stored from now on; honouring it for a box (float
    // bands in the calculator and on screen) lands with F3.c.
    wrap: { default: "wrapped" },
    ...FREE_LAYOUT_ATTRS,
    // U1: same effects as the image (shadow, frame effect, opacity).
    ...SHARED_EFFECT_ATTRS,
  },
  parseDOM: [
    {
      tag: "div[data-aw-box]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        return { ...boxStyleGetDOM(dom), ...boxLayoutGetDOM(dom), ...sharedEffectGetDOM(dom) };
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
    // Free-layout markers (F3.a): only what differs from the default.
    Object.assign(attrs, freeLayoutToDOM(node));
    const boxWrapMarker = textConditionMarker(textConditionOf(node));
    if (boxWrapMarker !== null) attrs["data-wrap"] = boxWrapMarker;
    // U1: shadow, frame effect and opacity markers (D10).
    Object.assign(attrs, sharedEffectToDOM(node));
    // D10 rule 1: emit BOTH the stable markers and the inline style, so the
    // markup renders universally outside AuraWrite and re-imports exactly.
    const css = computeBoxCss(s);
    const styleMap: Record<string, string> = { ...css };
    const shadow = computeImageBoxShadow(normalizeImageStyle(node.attrs as Record<string, unknown>));
    if (shadow) styleMap.boxShadow = shadow;
    const opacity = Number(node.attrs.opacity);
    if (isFinite(opacity) && opacity < 100) styleMap.opacity = String(Math.max(0, opacity) / 100);
    const styleText = Object.entries(styleMap)
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
// figure node (Phase 1, step G3, refactor 2026-08-29) — the FIGURE carries the
// photo as node ATTRS (not as a child node) and its CONTENT is the caption
// text. Canonical ProseMirror figure+caption pattern (forum #462 / #1326):
// the image cannot be deleted separately, and the caption is real editable
// text without any box chrome. Rendered by FigureNodeView (figure-node-view.ts),
// which owns the DOM; the D10 dialect below emits <figure><img/><figcaption>.
// ============================================================================

const CAPTION_LAYOUTS = ["below", "above"] as const;
export type CaptionLayout = (typeof CAPTION_LAYOUTS)[number];
const DEFAULT_CAPTION_LAYOUT: CaptionLayout = "below";
const DEFAULT_CAPTION_GAP_PX = 0;

/** Read the photo attrs off an <img> element (shared by image + figure). */
export function readImageAttrsFromDOM(dom: HTMLElement): Record<string, unknown> {
  const w = dom.getAttribute("width");
  const h = dom.getAttribute("height");
  return {
    src: dom.getAttribute("src") || "",
    alt: dom.getAttribute("alt") || "",
    title: dom.getAttribute("title") || "",
    width: w ? parseInt(w, 10) || null : null,
    height: h ? parseInt(h, 10) || null : null,
    align: dom.getAttribute("data-align") || "center",
    wrap: textConditionFromMarker(dom.getAttribute("data-wrap")),
    rotation: parseFloat(dom.getAttribute("data-rotation") || "0") || 0,
    flipH: dom.hasAttribute("data-flip-h"),
    flipV: dom.hasAttribute("data-flip-v"),
    aspectLocked: !dom.hasAttribute("data-aspect-unlocked"),
    caption: dom.getAttribute("data-caption") || "",
    ...imageStyleGetDOM(dom),
  };
}

/** Re-import side of the box free-layout markers (wrap + depth + position). */
function boxLayoutGetDOM(dom: HTMLElement): Record<string, unknown> {
  const layout = freeLayoutGetDOM(dom);
  // Same marker convention as image/figure.
  return {
    wrap: textConditionFromMarker(dom.getAttribute("data-wrap")),
    free: layout.free,
    zLevel: layout.zLevel,
  };
}

/** Node spec appended to the schema in editor.ts (single hook point). */
export const FIGURE_NODE_SPEC: NodeSpec = {
  content: "paragraph+",
  group: "block",
  defining: true,
  selectable: true,
  attrs: {
    // Photo carried as attrs (canonical figure+caption pattern).
    src: { default: "" },
    alt: { default: "" },
    title: { default: "" },
    width: { default: null },
    height: { default: null },
    align: { default: "center" },
    wrap: { default: true },
    rotation: { default: 0 },
    flipH: { default: false },
    flipV: { default: false },
    aspectLocked: { default: true },
    // Caption styling.
    captionLayout: { default: DEFAULT_CAPTION_LAYOUT },
    captionGap: { default: DEFAULT_CAPTION_GAP_PX },
    captionBg: { default: "" },
    captionPadTop: { default: 4 },
    captionPadBottom: { default: 0 },
    // Phase 1 (enrichment) style attrs — same dialect/logic as the image node.
    ...IMAGE_STYLE_ATTRS,
    // U1: opacity is shared by every element.
    ...OPACITY_ATTR,
    // F3.a: depth and free position (shared spec with image and styled_box).
    ...FREE_LAYOUT_ATTRS,
  },
  parseDOM: [
    {
      tag: "figure[data-aw-figure]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        const img = dom.querySelector("img");
        const layout = String(dom.getAttribute("data-caption-layout") || "");
        const rawGap = numAttr(dom, "data-caption-gap", DEFAULT_CAPTION_GAP_PX);
        return {
          ...(img ? readImageAttrsFromDOM(img) : {}),
          captionLayout: oneOf<string>(
            layout,
            CAPTION_LAYOUTS as unknown as string[],
            DEFAULT_CAPTION_LAYOUT
          ),
          captionGap: Math.max(0, Math.min(120, rawGap)),
          captionBg: dom.getAttribute("data-caption-bg") || "",
          captionPadTop: numAttr(dom, "data-caption-pad-top", 4),
          captionPadBottom: numAttr(dom, "data-caption-pad-bottom", 0),
          // Free-layout markers (figure carries them on <figure>).
          ...freeLayoutGetDOM(dom),
        };
      },
    },
  ],
  toDOM(node) {
    const s = normalizeImageStyle(node.attrs as Record<string, unknown>);
    const layout = oneOf<string>(
      String(node.attrs.captionLayout ?? ""),
      CAPTION_LAYOUTS as unknown as string[],
      DEFAULT_CAPTION_LAYOUT
    );
    const rawGap = Number(node.attrs.captionGap);
    const gap = isFinite(rawGap) ? Math.max(0, Math.min(120, rawGap)) : DEFAULT_CAPTION_GAP_PX;
    const bg = String(node.attrs.captionBg ?? "");

    const figAttrs: Record<string, string> = {
      "data-aw-figure": "",
      "data-caption-layout": layout,
      "data-align": String(node.attrs.align ?? "center"),
      class: "aw-figure",
    };
    if (gap !== DEFAULT_CAPTION_GAP_PX) figAttrs["data-caption-gap"] = String(gap);
    if (bg) figAttrs["data-caption-bg"] = bg;
    // Free-layout markers (F3.a) live on the <figure>, the element's own box.
    Object.assign(figAttrs, freeLayoutToDOM(node));
    const padTop = Number(node.attrs.captionPadTop);
    const padBottom = Number(node.attrs.captionPadBottom);
    if (isFinite(padTop) && padTop > 0) figAttrs["data-caption-pad-top"] = String(Math.round(padTop));
    if (isFinite(padBottom) && padBottom > 0) figAttrs["data-caption-pad-bottom"] = String(Math.round(padBottom));

    // The style (border / shadow / radius) wraps the WHOLE unit: emit on the
    // <figure> element (D10 rule 1: marker + inline style, both present).
    const imgCss = computeImageCss(s);
    const cssMap: Record<string, string> = {
      ...(imgCss.borderRadius ? { "border-radius": imgCss.borderRadius } : {}),
      ...(imgCss.border ? { border: imgCss.border } : {}),
      ...(imgCss.boxShadow ? { "box-shadow": imgCss.boxShadow } : {}),
    };
    const figOpacity = Number(node.attrs.opacity);
    if (isFinite(figOpacity) && figOpacity < 100) cssMap.opacity = String(Math.max(0, figOpacity) / 100);
    // T1.4: a floating figure carries its float and air inline, so the exported
    // HTML (no stylesheet) and the print sheet keep the frame and shadow clear.
    const figAlign = String(node.attrs.align ?? "center");
    if (isWrapping(textConditionOf(node)) && (figAlign === "left" || figAlign === "right") && !node.attrs.free) {
      const gap = Math.round(
        OBSTACLE_MARGIN_PX + elementDecorationExtent(node.attrs as Record<string, unknown>, "figure").x,
      );
      cssMap["float"] = figAlign;
      cssMap[figAlign === "left" ? "margin-right" : "margin-left"] = `${gap}px`;
      cssMap["margin-top"] = "0";
      cssMap["margin-bottom"] = "0";
    }
    const styleText = Object.entries(cssMap)
      .map(([prop, value]) => `${prop}: ${value}`)
      .join("; ");
    if (styleText) figAttrs.style = styleText;

    // <img> built from the photo attrs (same data-* dialect as the image node).
    const imgAttrs: Record<string, string> = {
      src: String(node.attrs.src ?? ""),
      alt: String(node.attrs.alt ?? ""),
    };
    if (node.attrs.title) imgAttrs.title = String(node.attrs.title);
    if (node.attrs.width) imgAttrs.width = String(node.attrs.width);
    if (node.attrs.height) imgAttrs.height = String(node.attrs.height);
    imgAttrs["data-align"] = String(node.attrs.align ?? "center");
    const figureWrapMarker = textConditionMarker(textConditionOf(node));
    if (figureWrapMarker !== null) imgAttrs["data-wrap"] = figureWrapMarker;
    if (node.attrs.rotation) imgAttrs["data-rotation"] = String(node.attrs.rotation);
    if (node.attrs.flipH) imgAttrs["data-flip-h"] = "";
    if (node.attrs.flipV) imgAttrs["data-flip-v"] = "";
    if (node.attrs.aspectLocked === false) imgAttrs["data-aspect-unlocked"] = "";
    Object.assign(imgAttrs, imageStyleToDOM(node));

    // <figcaption> with an inline style for the caption background and the
    // vertical whitespace (D10 rule 1: markers above + inline style below, so
    // the look survives export without an external CSS file).
    const capStyle: Record<string, string> = {};
    if (bg) capStyle.background = bg;
    const capPadTop = Number(node.attrs.captionPadTop);
    const capPadBottom = Number(node.attrs.captionPadBottom);
    const pt = isFinite(capPadTop) ? Math.max(0, Math.min(60, capPadTop)) : 0;
    const pb = isFinite(capPadBottom) ? Math.max(0, Math.min(60, capPadBottom)) : 0;
    if (pt > 0 || pb > 0) capStyle.padding = `${pt}px 8px ${pb}px`;
    const capStyleText = Object.entries(capStyle)
      .map(([prop, value]) => `${prop}: ${value}`)
      .join("; ");
    const capAttrs = capStyleText ? { style: capStyleText } : {};

    return ["figure", figAttrs, ["img", imgAttrs], ["figcaption", capAttrs, 0]];
  },
};

/**
 * Defensive migration of legacy document JSON before parsing with the current
 * schema (document load / open JSON). Handles:
 *  - old `figure` nodes (content: image + styled_box) → the new figure that
 *    carries the photo as attrs and the caption text as content.
 *
 * Block-level images are deliberately LEFT ALONE: an image is a top-level
 * block, and wrapping it in a paragraph (as this function did while images
 * were inline) moves it out of the top level. That broke the free layout, the
 * Layers window and every attribute command after a reload (observed by Carlo
 * 2026-09-11: after reopening, images were "stuck" and missing from Layers).
 */
export function migrateLegacyDocumentJson(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((child) => migrateLegacyDocumentJson(child));
  }
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "figure") {
    const children = Array.isArray(n.content) ? n.content : [];
    const image = children.find((c) => (c as { type?: string })?.type === "image");
    const box = children.find((c) => (c as { type?: string })?.type === "styled_box");
    const attrs: Record<string, unknown> = {
      ...(n.attrs ?? {}),
      ...((image as { attrs?: Record<string, unknown> } | undefined)?.attrs ?? {}),
    };
    delete attrs.caption;
    const boxContent = (box as { content?: unknown[] } | undefined)?.content;
    const content: unknown[] =
      Array.isArray(boxContent) && boxContent.length > 0 ? boxContent : [{ type: "paragraph" }];
    return { ...n, attrs, content };
  }
  if (Array.isArray(n.content)) {
    return { ...n, content: n.content.map((child) => migrateLegacyDocumentJson(child)) };
  }
  return node;
}
