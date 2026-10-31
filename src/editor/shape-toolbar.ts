// ============================================================================
// Shape toolbar — the commands that only a drawn shape has.
//
// Free, alignment, the text condition, rotation, mirroring, opacity and delete
// are NOT here: they are the shared block of `element-bar.ts`, shown for every
// element. This module owns the shape's own numbers: which shape it is, its box,
// and its stroke.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedShape, setShapeAttrs } from "./shape-commands";
import {
  MAX_STROKE_WIDTH_PX,
  MIN_STROKE_WIDTH_PX,
  hasBody,
  hasHead,
  isClosedShape,
  normalizeShapeParams,
  shapeBoxSize,
} from "./shape-params";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function intOrNaN(value: string): number {
  return parseInt(value, 10);
}

/** Bind the shape's own controls once. */
export function setupShapeToolbar(view: EditorView): void {
  const bar = el("shape-controls");
  if (!bar) return;

  const kind = el<HTMLSelectElement>("shape-kind");
  kind?.addEventListener("change", () => {
    void setShapeAttrs(view, { shape: kind.value });
  });

  const width = el<HTMLInputElement>("shape-width");
  width?.addEventListener("change", () => {
    const value = intOrNaN(width.value);
    if (isNaN(value)) return;
    void setShapeAttrs(view, { width: value });
  });
  const height = el<HTMLInputElement>("shape-height");
  height?.addEventListener("change", () => {
    const value = intOrNaN(height.value);
    if (isNaN(value)) return;
    void setShapeAttrs(view, { height: value });
  });

  // Stroke: the contour of the drawing.
  const strokeColor = el<HTMLInputElement>("shape-stroke-color");
  strokeColor?.addEventListener("input", () => {
    if (!strokeColor.value) return;
    void setShapeAttrs(view, { strokeColor: strokeColor.value });
  });
  const strokeWidth = el<HTMLInputElement>("shape-stroke-width");
  strokeWidth?.addEventListener("change", () => {
    const value = intOrNaN(strokeWidth.value);
    if (isNaN(value)) return;
    void setShapeAttrs(view, {
      strokeWidth: Math.max(MIN_STROKE_WIDTH_PX, Math.min(MAX_STROKE_WIDTH_PX, value)),
    });
  });

  // Fill: the inside of the closed part (the arrow's head). Empty means "the
  // inside takes the contour's colour", which is what the × clears it back to.
  const fill = el<HTMLInputElement>("shape-fill");
  fill?.addEventListener("input", () => {
    if (!fill.value) return;
    void setShapeAttrs(view, { fill: fill.value });
  });
  el("shape-fill-clear")?.addEventListener("click", () => {
    void setShapeAttrs(view, { fill: "" });
  });

  const headSize = el<HTMLInputElement>("shape-head-size");
  headSize?.addEventListener("change", () => {
    const value = intOrNaN(headSize.value);
    if (isNaN(value)) return;
    void setShapeAttrs(view, { headSize: value });
  });

  const bodyHeight = el<HTMLInputElement>("shape-body-height");
  bodyHeight?.addEventListener("change", () => {
    const value = intOrNaN(bodyHeight.value);
    if (isNaN(value)) return;
    void setShapeAttrs(view, { bodyHeight: value });
  });
}

/** Refresh the shape's own controls for the current selection. */
export function syncShapeToolbar(view: EditorView): void {
  const info = getSelectedShape(view);
  if (!info) return;
  const attrs = info.node.attrs as Record<string, unknown>;
  const params = normalizeShapeParams(attrs);
  const box = shapeBoxSize(attrs);

  const kind = el<HTMLSelectElement>("shape-kind");
  if (kind) kind.value = params.kind;

  const width = el<HTMLInputElement>("shape-width");
  if (width) width.value = String(box.width);

  // A line's height IS its stroke: there is nothing to type, so the field goes
  // away instead of offering a number that cannot be honoured.
  const heightField = el("shape-height-field");
  if (heightField) heightField.hidden = params.kind === "line";
  const height = el<HTMLInputElement>("shape-height");
  if (height) height.value = params.kind === "line" ? "" : String(box.height);

  const color = el<HTMLInputElement>("shape-stroke-color");
  if (color) color.value = params.strokeColor;
  const stroke = el<HTMLInputElement>("shape-stroke-width");
  if (stroke) stroke.value = String(params.strokeWidth);

  // Each control exists for the kinds that can honour it: a line has no inside
  // and no head, an ellipse has no head and no body.
  const closed = isClosedShape(params.kind);
  const withHead = hasHead(params.kind);
  const withBody = hasBody(params.kind);
  const fillField = el("shape-fill-field");
  if (fillField) fillField.hidden = !closed;
  const fillClear = el("shape-fill-clear");
  if (fillClear) fillClear.hidden = !closed;
  const headField = el("shape-head-field");
  if (headField) headField.hidden = !withHead;
  const bodyField = el("shape-body-field");
  if (bodyField) bodyField.hidden = !withBody;
  const fill = el<HTMLInputElement>("shape-fill");
  // An empty fill means "the contour's colour": the swatch shows that colour,
  // because that is what is painted.
  if (fill) fill.value = params.fill || params.strokeColor;
  const head = el<HTMLInputElement>("shape-head-size");
  if (head) head.value = closed ? String(params.headSize) : "";
  const body = el<HTMLInputElement>("shape-body-height");
  if (body) body.value = closed ? String(params.bodyHeight) : "";
}
