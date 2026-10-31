// ============================================================================
// Shape node (chapter A, step S1) — the drawn shape inside the document.
//
// It is an element exactly like the photo, the figure and the box: it leaves the
// text flow, hangs from a paragraph, turns, has a depth in the Layers window. All
// of that is inherited from `element-types.ts` + the free-layout engine; this
// file only declares WHAT a shape is and how its numbers travel in the markup.
//
// The drawing itself is not in the schema: ProseMirror creates DOM elements
// without the SVG namespace, so the markup carries the numbers (`data-aw-shape`
// and the markers below) and the drawing is painted by `shape-paint.ts`.
// ============================================================================

import type { NodeSpec } from "prosemirror-model";
import {
  FREE_LAYOUT_ATTRS,
  OPACITY_ATTR,
  ROTATION_FLIP_ATTRS,
  rotationFlipGetDOM,
  rotationFlipToDOM,
} from "./enriched-schema";
import { freeLayoutGetDOM, freeLayoutToDOM } from "./free-layout";
import { textConditionFromMarker, textConditionMarker, textConditionOf, isWrapping } from "./element-condition";
import { floatGapPx } from "./text-obstacles";
import { transformStyleOf } from "./element-view";
import { buildShapeSvg } from "./shape-paint";
import {
  DEFAULT_HEAD_SIZE_PX,
  DEFAULT_SHAPE_WIDTH_PX,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH_PX,
  isShapeKind,
  normalizeShapeParams,
  shapeBoxSize,
} from "./shape-params";

const SHAPE_ALIGNS = ["left", "center", "right"] as const;

function oneOfAlign(value: string | null): "left" | "center" | "right" {
  const v = (value ?? "").trim();
  return (SHAPE_ALIGNS as readonly string[]).includes(v) ? (v as "left" | "center" | "right") : "center";
}

/** Number from a data-* marker; NaN becomes the fallback the caller names. */
function markerNumber(dom: HTMLElement, name: string, fallback: number | null): number | null {
  const raw = dom.getAttribute(name);
  if (raw === null || raw.trim() === "") return fallback;
  const n = parseFloat(raw);
  return isFinite(n) ? n : fallback;
}

/** The shape's own attributes, spread into the schema in `editor.ts`. */
export const SHAPE_NODE_SPEC: NodeSpec = {
  inline: false,
  group: "block",
  selectable: true,
  attrs: {
    shape: { default: "line" },
    // The box that hugs the shape (§6): the line's height is its stroke's, so
    // only the arrow stores a height (that of its head).
    width: { default: DEFAULT_SHAPE_WIDTH_PX },
    height: { default: DEFAULT_HEAD_SIZE_PX },
    strokeWidth: { default: DEFAULT_STROKE_WIDTH_PX },
    strokeColor: { default: DEFAULT_STROKE_COLOR },
    headSize: { default: DEFAULT_HEAD_SIZE_PX },
    // A drawn shape is never aspect-locked: the width is its length and the
    // height is its stroke (line) or its head's width (arrow) - two free axes.
    aspectLocked: { default: false },
    // Every element speaks the same three conditions and the same alignment.
    align: { default: "center" },
    wrap: { default: "wrapped" },
    // F3: depth and free position, the shared spec every element carries.
    ...FREE_LAYOUT_ATTRS,
    // U5: rotation and mirroring, like every other element.
    ...ROTATION_FLIP_ATTRS,
    // U1: opacity is shared by every element.
    ...OPACITY_ATTR,
  },
  parseDOM: [
    {
      tag: "div[data-aw-shape]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        const layout = freeLayoutGetDOM(dom);
        const kind = dom.getAttribute("data-aw-shape") || "";
        return {
          shape: isShapeKind(kind) ? kind : "line",
          width: markerNumber(dom, "data-width", DEFAULT_SHAPE_WIDTH_PX),
          height: markerNumber(dom, "data-height", DEFAULT_HEAD_SIZE_PX),
          strokeWidth: markerNumber(dom, "data-stroke-width", DEFAULT_STROKE_WIDTH_PX),
          strokeColor: dom.getAttribute("data-stroke-color") || DEFAULT_STROKE_COLOR,
          headSize: markerNumber(dom, "data-head-size", DEFAULT_HEAD_SIZE_PX),
          align: oneOfAlign(dom.getAttribute("data-align")),
          wrap: textConditionFromMarker(dom.getAttribute("data-wrap")),
          opacity: markerNumber(dom, "data-opacity", 100),
          free: layout.free,
          zLevel: layout.zLevel,
          ...rotationFlipGetDOM(dom),
        };
      },
    },
  ],
  toDOM(node) {
    const params = normalizeShapeParams(node.attrs as Record<string, unknown>);
    const box = shapeBoxSize(node.attrs as Record<string, unknown>);
    const align = oneOfAlign(String(node.attrs.align ?? ""));
    const condition = textConditionOf(node);

    const attrs: Record<string, string> = {
      class: "aw-shape",
      "data-aw-shape": params.kind,
      "data-align": align,
      "data-width": String(box.width),
      "data-height": String(box.height),
    };
    if (params.strokeWidth !== DEFAULT_STROKE_WIDTH_PX) {
      attrs["data-stroke-width"] = String(params.strokeWidth);
    }
    if (params.strokeColor.toLowerCase() !== DEFAULT_STROKE_COLOR) {
      attrs["data-stroke-color"] = params.strokeColor;
    }
    if (params.headSize !== DEFAULT_HEAD_SIZE_PX) {
      attrs["data-head-size"] = String(params.headSize);
    }
    const wrapMarker = textConditionMarker(condition);
    if (wrapMarker !== null) attrs["data-wrap"] = wrapMarker;
    Object.assign(attrs, freeLayoutToDOM(node));
    Object.assign(attrs, rotationFlipToDOM(node));
    const opacity = Number(node.attrs.opacity);
    if (isFinite(opacity) && opacity < 100) {
      attrs["data-opacity"] = String(Math.max(0, Math.round(opacity)));
    }

    // D10 rule 1: the exported markup must stand on its own — the sheet and the
    // HTML file have no AuraWrite stylesheet, so size, alignment and air travel
    // inline, with the same numbers the calculator used.
    const style: string[] = [
      `width: ${box.width}px`,
      `height: ${box.height}px`,
      "display: block",
      "box-sizing: border-box",
    ];
    const floating = !node.attrs.free && isWrapping(condition) && (align === "left" || align === "right");
    if (floating) {
      const gap = floatGapPx(node.attrs as Record<string, unknown>, "shape");
      style.push(`float: ${align}`);
      style.push(align === "left" ? `margin: 0 ${gap}px 0 0` : `margin: 0 0 0 ${gap}px`);
    } else if (align === "center") {
      style.push("margin-left: auto");
      style.push("margin-right: auto");
    } else if (align === "right") {
      style.push("margin-left: auto");
      style.push("margin-right: 0");
    } else {
      style.push("margin-left: 0");
      style.push("margin-right: auto");
    }
    if (isFinite(opacity) && opacity < 100) style.push(`opacity: ${Math.max(0, opacity) / 100}`);
    const transform = transformStyleOf(node.attrs as Record<string, unknown>);
    if (transform) style.push(`transform: ${transform}`);
    attrs.style = style.join("; ");

    return ["div", attrs, buildShapeSvg(params, box)];
  },
};
