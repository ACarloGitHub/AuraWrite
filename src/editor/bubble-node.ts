// ============================================================================
// Bubble node — the speech balloon in the document.
//
// A separate element (Carlo, S6): it is NOT an option of the box. It speaks the
// same dialect as the other elements (D10): `data-*` markers plus an inline
// style, so the exported HTML and the print sheet stand on their own and the
// file re-imports exactly.
//
// The markup carries the drawing AND the text: the SVG is the balloon (body and
// tail as one path), the inner div is the editable text. The two are laid out
// from the same numbers (`bubble-geometry.ts`), so the text sits where the body
// was drawn.
// ============================================================================

import { type NodeSpec } from "prosemirror-model";
import {
  BUBBLE_AT_DEFAULT,
  BUBBLE_BASE_DEFAULT,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  BUBBLE_RADIUS_DEFAULT,
  BUBBLE_STROKE_COLOR_DEFAULT,
  BUBBLE_STROKE_DEFAULT,
  BUBBLE_TAIL_DEFAULT_OUT,
  BUBBLE_TAIL_DEFAULT_ALONG,
  BUBBLE_WIDTH_DEFAULT,
} from "./bubble-geometry";
import { buildBubbleSvg, bubbleShadowOf } from "./bubble-paint";
import { bubbleLayoutOf } from "./pagination-cassie";
import {
  FREE_LAYOUT_ATTRS,
  ROTATION_FLIP_ATTRS,
  SHARED_EFFECT_ATTRS,
  rotationFlipGetDOM,
  rotationFlipToDOM,
  sharedEffectGetDOM,
  sharedEffectToDOM,
} from "./enriched-schema";
import { freeLayoutGetDOM, freeLayoutToDOM } from "./free-layout";
import {
  isWrapping,
  textConditionFromMarker,
  textConditionMarker,
  textConditionOf,
} from "./element-condition";
import { floatGapPx } from "./text-obstacles";
import { transformStyleOf } from "./element-view";

/** The node name, in one place. */
export const BUBBLE_NODE = "bubble";

const BODY_KINDS = ["rect", "ellipse"] as const;
const ALIGNS = ["left", "center", "right"] as const;

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function markerNumber(dom: HTMLElement, name: string, fallback: number): number {
  const raw = dom.getAttribute(name);
  if (raw == null || raw === "") return fallback;
  const n = parseFloat(raw);
  return isFinite(n) ? n : fallback;
}

export const BUBBLE_NODE_SPEC: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  selectable: true,
  attrs: {
    body: { default: "rect" },
    at: { default: BUBBLE_AT_DEFAULT },
    tailOut: { default: BUBBLE_TAIL_DEFAULT_OUT },
    tailAlong: { default: BUBBLE_TAIL_DEFAULT_ALONG },
    base: { default: BUBBLE_BASE_DEFAULT },
    bgColor: { default: "" },
    borderWidth: { default: BUBBLE_STROKE_DEFAULT },
    borderColor: { default: BUBBLE_STROKE_COLOR_DEFAULT },
    borderStyle: { default: "solid" },
    cornerRadius: { default: BUBBLE_RADIUS_DEFAULT },
    widthPx: { default: BUBBLE_WIDTH_DEFAULT },
    align: { default: "center" },
    wrap: { default: "wrapped" },
    ...FREE_LAYOUT_ATTRS,
    ...SHARED_EFFECT_ATTRS,
    ...ROTATION_FLIP_ATTRS,
  },
  parseDOM: [
    {
      tag: "div[data-aw-bubble]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        const layout = freeLayoutGetDOM(dom);
        return {
          body: oneOf(dom.getAttribute("data-aw-bubble") || "", BODY_KINDS, "rect"),
          at: markerNumber(dom, "data-at", BUBBLE_AT_DEFAULT),
          tailOut: markerNumber(dom, "data-tail-out", BUBBLE_TAIL_DEFAULT_OUT),
          tailAlong: markerNumber(dom, "data-tail-along", BUBBLE_TAIL_DEFAULT_ALONG),
          base: markerNumber(dom, "data-base", BUBBLE_BASE_DEFAULT),
          bgColor: dom.getAttribute("data-bg") || "",
          borderWidth: markerNumber(dom, "data-border-width", BUBBLE_STROKE_DEFAULT),
          borderColor: dom.getAttribute("data-border-color") || BUBBLE_STROKE_COLOR_DEFAULT,
          borderStyle: oneOf(dom.getAttribute("data-border-style") || "", ["solid", "dashed", "dotted"] as const, "solid"),
          cornerRadius: markerNumber(dom, "data-radius", BUBBLE_RADIUS_DEFAULT),
          widthPx: markerNumber(dom, "data-width", BUBBLE_WIDTH_DEFAULT),
          align: oneOf(dom.getAttribute("data-align") || "", ALIGNS, "center"),
          wrap: textConditionFromMarker(dom.getAttribute("data-wrap")),
          opacity: markerNumber(dom, "data-opacity", 100),
          ...layout,
          ...rotationFlipGetDOM(dom),
          ...sharedEffectGetDOM(dom),
        };
      },
    },
  ],
  toDOM(node) {
    const layout = bubbleLayoutOf(node);
    const params = layout.params;
    const align = String(node.attrs.align ?? "center");
    const condition = textConditionOf(node);

    const attrs: Record<string, string> = {
      class: "aw-bubble",
      "data-aw-bubble": params.body,
      "data-align": align,
      "data-width": String(params.width),
    };
    if (params.at !== BUBBLE_AT_DEFAULT) attrs["data-at"] = String(params.at);
    if (params.tailOut !== BUBBLE_TAIL_DEFAULT_OUT) attrs["data-tail-out"] = String(params.tailOut);
    if (params.tailAlong !== BUBBLE_TAIL_DEFAULT_ALONG) attrs["data-tail-along"] = String(params.tailAlong);
    if (params.base !== BUBBLE_BASE_DEFAULT) attrs["data-base"] = String(params.base);
    if (params.fill) attrs["data-bg"] = params.fill;
    if (params.strokeWidth !== BUBBLE_STROKE_DEFAULT) {
      attrs["data-border-width"] = String(params.strokeWidth);
    }
    if (params.strokeColor.toLowerCase() !== BUBBLE_STROKE_COLOR_DEFAULT) {
      attrs["data-border-color"] = params.strokeColor;
    }
    if (params.dash !== "solid") attrs["data-border-style"] = params.dash;
    if (params.radius !== BUBBLE_RADIUS_DEFAULT) attrs["data-radius"] = String(params.radius);
    const wrapMarker = textConditionMarker(condition);
    if (wrapMarker !== null) attrs["data-wrap"] = wrapMarker;
    Object.assign(attrs, freeLayoutToDOM(node));
    Object.assign(attrs, rotationFlipToDOM(node));
    Object.assign(attrs, sharedEffectToDOM(node));
    const opacity = Number(node.attrs.opacity);
    if (isFinite(opacity) && opacity < 100) {
      attrs["data-opacity"] = String(Math.max(0, Math.round(opacity)));
    }

    // D10 rule 1: the markup stands on its own — sizes, air and turn travel inline.
    const style: string[] = [
      `width: ${layout.boxW}px`,
      `height: ${layout.boxH}px`,
      "position: relative",
      "display: flow-root",
      "box-sizing: border-box",
    ];
    const floating = !node.attrs.free && isWrapping(condition) && (align === "left" || align === "right");
    if (floating) {
      const gap = floatGapPx(node.attrs as Record<string, unknown>, "bubble");
      style.push(`float: ${align}`);
      style.push(align === "left" ? `margin: 0 ${gap}px 0 0` : `margin: 0 0 0 ${gap}px`);
    } else if (align === "center") {
      style.push("margin-left: auto", "margin-right: auto");
    } else if (align === "right") {
      style.push("margin-left: auto");
    }
    const transform = transformStyleOf(node.attrs as Record<string, unknown>);
    if (transform) style.push(`transform: ${transform}`);
    if (isFinite(opacity) && opacity < 100) style.push(`opacity: ${Math.max(0, opacity) / 100}`);
    attrs.style = style.join("; ");

    const svg = buildBubbleSvg(layout, bubbleShadowOf(node.attrs as Record<string, unknown>));
    svg.setAttribute("style", "position: absolute; left: 0; top: 0; pointer-events: none");

    const contentStyle = [
      `width: ${layout.wrapperW}px`,
      `margin: ${layout.bodyTop + layout.insetY}px 0 0 ${layout.bodyLeft + layout.insetX}px`,
      `padding: ${BUBBLE_PAD_Y}px ${BUBBLE_PAD_X}px`,
      "box-sizing: border-box",
    ].join("; ");

    return ["div", attrs, svg, ["div", { class: "aw-bubble__content", style: contentStyle }, 0]];
  },
};
