// ============================================================================
// Element bar — the commands EVERY element shares, written once.
//
// The secondary bar is one bar with a section per element type (U4). Before
// this module each section carried its own copy of the same eleven controls —
// Free, alignment, the text condition, rotation and its quarter turns, the two
// mirrorings, transparency and delete — in its markup and in its wiring: three
// lists that had to be kept in step by hand, which is exactly the failure the
// element engine exists to prevent.
//
// Now those controls exist once, in `#element-common-controls`, and this module
// is their only wiring and their only sync. Each section keeps the commands that
// are its own (size, style, caption, stroke…) and asks `element-types.ts` which
// section to show.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedElement, removeSelectedElement, setNodeAttrs } from "./element-commands";
import { ELEMENT_KINDS } from "./element-types";
import { CONDITION_LABEL, isWrapping, nextCondition, textConditionOf } from "./element-condition";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** The element every command of this bar acts on. */
function selected(view: EditorView) {
  return getSelectedElement(view, ELEMENT_KINDS);
}

/** Patch the selected element's attributes (no-op when nothing is selected). */
function patch(view: EditorView, attrs: Record<string, unknown>): void {
  const target = selected(view);
  if (!target) return;
  setNodeAttrs(view, target.pos, { ...target.node.attrs, ...attrs });
}

/** Bind the common controls once, at startup. */
export function setupElementBar(view: EditorView): void {
  el("elem-free")?.addEventListener("click", () => {
    void import("./free-commands").then((m) => {
      m.toggleElementFree(view);
    });
  });

  el("elem-align-left")?.addEventListener("click", () => patch(view, { align: "left" }));
  el("elem-align-center")?.addEventListener("click", () => patch(view, { align: "center" }));
  el("elem-align-right")?.addEventListener("click", () => patch(view, { align: "right" }));

  el("elem-condition")?.addEventListener("click", () => {
    const target = selected(view);
    if (!target) return;
    patch(view, { wrap: nextCondition(textConditionOf(target.node)) });
  });

  const rotation = el<HTMLInputElement>("elem-rotation");
  rotation?.addEventListener("change", () => {
    const value = parseInt(rotation.value, 10);
    if (isNaN(value)) return;
    patch(view, { rotation: ((value % 360) + 360) % 360 });
  });
  const rotateBy = (delta: number): void => {
    const target = selected(view);
    if (!target) return;
    const current = Number(target.node.attrs.rotation) || 0;
    patch(view, { rotation: ((((current + delta) % 360) + 360) % 360) });
  };
  el("elem-rotate-left")?.addEventListener("click", () => rotateBy(-90));
  el("elem-rotate-right")?.addEventListener("click", () => rotateBy(90));

  el("elem-flip-h")?.addEventListener("click", () => {
    const target = selected(view);
    if (!target) return;
    patch(view, { flipH: !target.node.attrs.flipH });
  });
  el("elem-flip-v")?.addEventListener("click", () => {
    const target = selected(view);
    if (!target) return;
    patch(view, { flipV: !target.node.attrs.flipV });
  });

  const opacity = el<HTMLInputElement>("elem-opacity");
  opacity?.addEventListener("change", () => {
    const value = parseInt(opacity.value, 10);
    if (isNaN(value)) return;
    patch(view, { opacity: Math.max(0, Math.min(100, value)) });
  });

  el("elem-delete")?.addEventListener("click", () => {
    removeSelectedElement(view, ELEMENT_KINDS);
  });
}

/**
 * Show the block when an element is selected and mirror the element's state into
 * it. Called from `syncSecondaryToolbar` on every transaction, including the one
 * that takes the selection away from an element.
 */
export function syncElementBar(view: EditorView): void {
  const block = document.getElementById("element-common-controls");
  if (!block) return;
  const target = selected(view);
  block.hidden = !target;
  if (!target) return;

  const attrs = target.node.attrs as Record<string, unknown>;
  const isFree = !!attrs.free;

  const freeBtn = el<HTMLButtonElement>("elem-free");
  if (freeBtn) {
    // The button shows the element's CURRENT state, not the action.
    freeBtn.textContent = isFree ? "Free" : "In flow";
    freeBtn.title = isFree
      ? "Put this element back between the paragraphs"
      : "Take this element out of the text flow";
    freeBtn.classList.toggle("image-toolbar__btn--active", isFree);
  }

  const alignButtons: Record<string, HTMLElement | null> = {
    left: el("elem-align-left"),
    center: el("elem-align-center"),
    right: el("elem-align-right"),
  };
  for (const [value, btn] of Object.entries(alignButtons)) {
    btn?.classList.toggle("image-toolbar__btn--active", String(attrs.align ?? "center") === value);
  }
  // In Free the horizontal is decided by the mouse: hide Left/Center/Right.
  for (const btn of Object.values(alignButtons)) {
    if (btn) btn.hidden = isFree;
  }
  const alignSeparator = el("elem-align-separator");
  if (alignSeparator) alignSeparator.hidden = isFree;

  const condition = textConditionOf(target.node);
  const conditionBtn = el<HTMLButtonElement>("elem-condition");
  if (conditionBtn) {
    conditionBtn.textContent = CONDITION_LABEL[condition];
    conditionBtn.title = `Text around this element: ${CONDITION_LABEL[condition]}`;
    conditionBtn.classList.toggle("image-toolbar__btn--active", isWrapping(condition));
  }

  const rotation = el<HTMLInputElement>("elem-rotation");
  if (rotation) rotation.value = String(Number(attrs.rotation) || 0);
  const opacity = el<HTMLInputElement>("elem-opacity");
  if (opacity) opacity.value = String(attrs.opacity ?? 100);
  el("elem-flip-h")?.classList.toggle("image-toolbar__btn--active", !!attrs.flipH);
  el("elem-flip-v")?.classList.toggle("image-toolbar__btn--active", !!attrs.flipV);
}
