// ============================================================================
// Bubble toolbar — the commands that only the speech balloon has.
//
// Free, alignment, the text condition, rotation, mirroring, opacity, the shadow
// and delete are NOT here: they are the shared block of `element-bar.ts`. This
// module owns the balloon's own numbers: the shape of the body, where the tail
// leaves it, and the contour.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedBubble, setBubbleAttrs } from "./bubble-commands";
import {
  BUBBLE_RADIUS_MAX,
  BUBBLE_STROKE_MAX,
  BUBBLE_WIDTH_MAX,
  BUBBLE_WIDTH_MIN,
  normalizeBubbleParams,
} from "./bubble-geometry";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function intOrNaN(value: string): number {
  return parseInt(value, 10);
}

/** Bind the balloon's own controls once. */
export function setupBubbleToolbar(view: EditorView): void {
  const bar = el("bubble-controls");
  if (!bar) return;

  const body = el<HTMLSelectElement>("bubble-body");
  body?.addEventListener("change", () => {
    void setBubbleAttrs(view, { body: body.value });
  });

  const at = el<HTMLInputElement>("bubble-at");
  at?.addEventListener("change", () => {
    const value = intOrNaN(at.value);
    if (isNaN(value)) return;
    void setBubbleAttrs(view, { at: Math.max(0, Math.min(100, value)) });
  });

  const width = el<HTMLInputElement>("bubble-width");
  width?.addEventListener("change", () => {
    const value = intOrNaN(width.value);
    if (isNaN(value)) return;
    void setBubbleAttrs(view, { widthPx: Math.max(BUBBLE_WIDTH_MIN, Math.min(BUBBLE_WIDTH_MAX, value)) });
  });

  const bg = el<HTMLInputElement>("bubble-bg");
  bg?.addEventListener("input", () => {
    if (!bg.value) return;
    void setBubbleAttrs(view, { bgColor: bg.value });
  });
  el("bubble-bg-clear")?.addEventListener("click", () => {
    void setBubbleAttrs(view, { bgColor: "" });
  });

  const style = el<HTMLSelectElement>("bubble-border-style");
  style?.addEventListener("change", () => {
    void setBubbleAttrs(view, { borderStyle: style.value });
  });

  const borderWidth = el<HTMLInputElement>("bubble-border-width");
  borderWidth?.addEventListener("change", () => {
    const value = intOrNaN(borderWidth.value);
    if (isNaN(value)) return;
    void setBubbleAttrs(view, { borderWidth: Math.max(0, Math.min(BUBBLE_STROKE_MAX, value)) });
  });

  const borderColor = el<HTMLInputElement>("bubble-border-color");
  borderColor?.addEventListener("input", () => {
    if (!borderColor.value) return;
    void setBubbleAttrs(view, { borderColor: borderColor.value });
  });

  const radius = el<HTMLInputElement>("bubble-radius");
  radius?.addEventListener("change", () => {
    const value = intOrNaN(radius.value);
    if (isNaN(value)) return;
    void setBubbleAttrs(view, { cornerRadius: Math.max(0, Math.min(BUBBLE_RADIUS_MAX, value)) });
  });
}

/** Refresh the balloon's own controls for the current selection. */
export function syncBubbleToolbar(view: EditorView): void {
  const info = getSelectedBubble(view);
  if (!info) return;
  const params = normalizeBubbleParams(info.node.attrs as Record<string, unknown>);

  const body = el<HTMLSelectElement>("bubble-body");
  if (body) body.value = params.body;

  const at = el<HTMLInputElement>("bubble-at");
  if (at) at.value = String(Math.round(params.at));

  const width = el<HTMLInputElement>("bubble-width");
  if (width) width.value = String(params.width);

  const bg = el<HTMLInputElement>("bubble-bg");
  if (bg && params.fill) bg.value = params.fill;

  const style = el<HTMLSelectElement>("bubble-border-style");
  if (style) style.value = params.dash;

  const borderWidth = el<HTMLInputElement>("bubble-border-width");
  if (borderWidth) borderWidth.value = String(params.strokeWidth);

  const borderColor = el<HTMLInputElement>("bubble-border-color");
  if (borderColor) borderColor.value = params.strokeColor;

  // A rectangle has corners to round; an ellipse has none to offer.
  const radiusField = el("bubble-radius-field");
  if (radiusField) radiusField.hidden = params.body === "ellipse";
  const radius = el<HTMLInputElement>("bubble-radius");
  if (radius) radius.value = params.body === "ellipse" ? "" : String(params.radius);
}
