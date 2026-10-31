// ============================================================================
// Shape toolbar (chapter A, step S1) — the third section of the ONE secondary
// bar. It carries only the shape's own commands; Free, alignment, condition,
// rotation, mirroring, opacity, size, depth and delete are the element
// commands every element already has (U4), so they are reused, not rewritten.
//
// The parameters section proper (dash, fill, head/style for the other two
// arrows, the handles that regulate the shape) is step S4 of the chapter.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedShape, removeSelectedShape, setShapeAttrs } from "./shape-commands";
import { isWrapping, textConditionOf, type TextCondition } from "./element-condition";
import { MAX_STROKE_WIDTH_PX, MIN_STROKE_WIDTH_PX, normalizeShapeParams, shapeBoxSize } from "./shape-params";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const CONDITION_ORDER: TextCondition[] = ["wrapped", "unwrapped", "overlap"];
const CONDITION_LABEL: Record<TextCondition, string> = {
  wrapped: "Wrapped",
  unwrapped: "Unwrapped",
  overlap: "Overlap",
};

function nextCondition(condition: TextCondition): TextCondition {
  return CONDITION_ORDER[(CONDITION_ORDER.indexOf(condition) + 1) % CONDITION_ORDER.length];
}

function intOrNaN(value: string): number {
  return parseInt(value, 10);
}

/** Bind the shape section once, at startup. */
export function setupShapeToolbar(view: EditorView): void {
  const bar = el("shape-controls");
  if (!bar) return;

  // Same protection as the other sections: typing in a field must not be read
  // by the editor.
  bar.addEventListener("mousedown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT") return;
    e.preventDefault();
  });
  bar.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT") e.stopPropagation();
  });

  el("shape-free")?.addEventListener("click", async () => {
    const { toggleElementFree } = await import("./free-commands");
    toggleElementFree(view);
  });

  const kind = el<HTMLSelectElement>("shape-kind");
  kind?.addEventListener("change", () => {
    void setShapeAttrs(view, { shape: kind.value });
  });

  el("shape-align-left")?.addEventListener("click", () => void setShapeAttrs(view, { align: "left" }));
  el("shape-align-center")?.addEventListener("click", () => void setShapeAttrs(view, { align: "center" }));
  el("shape-align-right")?.addEventListener("click", () => void setShapeAttrs(view, { align: "right" }));

  el("shape-condition")?.addEventListener("click", () => {
    const info = getSelectedShape(view);
    if (!info) return;
    void setShapeAttrs(view, { wrap: nextCondition(textConditionOf(info.node)) });
  });

  const width = el<HTMLInputElement>("shape-width");
  width?.addEventListener("change", () => {
    const v = intOrNaN(width.value);
    if (isNaN(v)) return;
    void setShapeAttrs(view, { width: v });
  });
  const height = el<HTMLInputElement>("shape-height");
  height?.addEventListener("change", () => {
    const v = intOrNaN(height.value);
    if (isNaN(v)) return;
    void setShapeAttrs(view, { height: v });
  });

  const rotation = el<HTMLInputElement>("shape-rotation");
  rotation?.addEventListener("change", () => {
    const v = intOrNaN(rotation.value);
    if (isNaN(v)) return;
    void setShapeAttrs(view, { rotation: ((v % 360) + 360) % 360 });
  });
  const rotateBy = (delta: number): void => {
    const info = getSelectedShape(view);
    if (!info) return;
    const current = Number(info.node.attrs.rotation) || 0;
    void setShapeAttrs(view, { rotation: ((((current + delta) % 360) + 360) % 360) });
  };
  el("shape-rotate-left")?.addEventListener("click", () => rotateBy(-90));
  el("shape-rotate-right")?.addEventListener("click", () => rotateBy(90));

  el("shape-flip-h")?.addEventListener("click", () => {
    const info = getSelectedShape(view);
    if (!info) return;
    void setShapeAttrs(view, { flipH: !info.node.attrs.flipH });
  });
  el("shape-flip-v")?.addEventListener("click", () => {
    const info = getSelectedShape(view);
    if (!info) return;
    void setShapeAttrs(view, { flipV: !info.node.attrs.flipV });
  });

  const opacity = el<HTMLInputElement>("shape-opacity");
  opacity?.addEventListener("change", () => {
    const v = intOrNaN(opacity.value);
    if (isNaN(v)) return;
    void setShapeAttrs(view, { opacity: Math.max(0, Math.min(100, v)) });
  });

  // Stroke: the shape's own numbers (S4 will add dash, head and curve).
  const strokeColor = el<HTMLInputElement>("shape-stroke-color");
  strokeColor?.addEventListener("input", () => {
    if (!strokeColor.value) return;
    void setShapeAttrs(view, { strokeColor: strokeColor.value });
  });
  const strokeWidth = el<HTMLInputElement>("shape-stroke-width");
  strokeWidth?.addEventListener("change", () => {
    const v = intOrNaN(strokeWidth.value);
    if (isNaN(v)) return;
    void setShapeAttrs(view, { strokeWidth: Math.max(MIN_STROKE_WIDTH_PX, Math.min(MAX_STROKE_WIDTH_PX, v)) });
  });

  el("shape-delete")?.addEventListener("click", () => {
    removeSelectedShape(view);
  });
}

/** Refresh the section's values for the selected shape (called on every sync). */
export function syncShapeToolbar(view: EditorView): void {
  const info = getSelectedShape(view);
  if (!info) return;
  const attrs = info.node.attrs as Record<string, unknown>;
  const params = normalizeShapeParams(attrs);
  const box = shapeBoxSize(attrs);
  const isFree = !!attrs.free;

  const kind = el<HTMLSelectElement>("shape-kind");
  if (kind) kind.value = params.kind;

  const alignButtons: Record<string, HTMLElement | null> = {
    left: el("shape-align-left"),
    center: el("shape-align-center"),
    right: el("shape-align-right"),
  };
  for (const [value, btn] of Object.entries(alignButtons)) {
    btn?.classList.toggle("image-toolbar__btn--active", String(attrs.align ?? "center") === value);
  }
  // In Free the horizontal is decided by the mouse: hide Left/Center/Right.
  for (const btn of Object.values(alignButtons)) {
    if (btn) btn.hidden = isFree;
  }
  const alignSeparator = el("shape-align-separator");
  if (alignSeparator) alignSeparator.hidden = isFree;

  const condition = textConditionOf(info.node);
  const conditionBtn = el<HTMLButtonElement>("shape-condition");
  if (conditionBtn) {
    conditionBtn.textContent = CONDITION_LABEL[condition];
    conditionBtn.title = `Text around this element: ${CONDITION_LABEL[condition]}`;
    conditionBtn.classList.toggle("image-toolbar__btn--active", isWrapping(condition));
  }

  const width = el<HTMLInputElement>("shape-width");
  if (width) width.value = String(box.width);
  // A line's height IS its stroke: there is nothing to type, so the field goes
  // away instead of offering a number that cannot be honoured (§6).
  const heightField = el("shape-height-field");
  if (heightField) heightField.hidden = params.kind === "line";
  const height = el<HTMLInputElement>("shape-height");
  if (height) height.value = params.kind === "line" ? "" : String(box.height);

  const rotation = el<HTMLInputElement>("shape-rotation");
  if (rotation) rotation.value = String(Number(attrs.rotation) || 0);
  const opacity = el<HTMLInputElement>("shape-opacity");
  if (opacity) opacity.value = String(attrs.opacity ?? 100);
  el("shape-flip-h")?.classList.toggle("image-toolbar__btn--active", !!attrs.flipH);
  el("shape-flip-v")?.classList.toggle("image-toolbar__btn--active", !!attrs.flipV);

  const color = el<HTMLInputElement>("shape-stroke-color");
  if (color) color.value = params.strokeColor;
  const stroke = el<HTMLInputElement>("shape-stroke-width");
  if (stroke) stroke.value = String(params.strokeWidth);

  const freeBtn = el<HTMLButtonElement>("shape-free");
  if (freeBtn) {
    freeBtn.textContent = isFree ? "Free" : "In flow";
    freeBtn.title = isFree
      ? "Put this shape back between the paragraphs"
      : "Take this shape out of the text flow";
    freeBtn.classList.toggle("image-toolbar__btn--active", isFree);
  }
}
