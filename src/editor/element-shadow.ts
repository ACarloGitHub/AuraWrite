// ============================================================================
// Element shadow — the shadow controls, once.
//
// The box and the drawn shape carry the same effect attributes, so they get the
// same controls: one toggle and the numbers behind it (distance, blur, opacity,
// colour, light direction). The block lives once in the bar, and this module is
// its only wiring and its only sync. The image and the figure keep their own
// shadow inside the image style section, which is a different matter (it also
// carries radius, border and frame effect).
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedElement, setNodeAttrs } from "./element-commands";
import { elementTypeOf } from "./element-types";

/** The element kinds whose bar shows this block. */
const SHADOW_SECTIONS = new Set(["box", "shape"]);

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function selected(view: EditorView) {
  const info = getSelectedElement(view, ["styled_box", "shape"]);
  return info;
}

function patch(view: EditorView, attrs: Record<string, unknown>): void {
  const info = selected(view);
  if (!info) return;
  setNodeAttrs(view, info.pos, { ...info.node.attrs, ...attrs });
}

/** Bind the shadow controls once, at startup. */
export function setupElementShadow(view: EditorView): void {
  el("sh-toggle")?.addEventListener("click", () => {
    const info = selected(view);
    if (!info) return;
    patch(view, { shadowEnabled: !info.node.attrs.shadowEnabled });
  });

  const bindNumber = (id: string, key: string, min: number, max: number): void => {
    const input = el<HTMLInputElement>(id);
    input?.addEventListener("change", () => {
      const value = parseInt(input.value, 10);
      if (isNaN(value)) return;
      patch(view, { [key]: Math.max(min, Math.min(max, value)) });
    });
  };
  bindNumber("sh-distance", "shadowDistance", 0, 60);
  bindNumber("sh-blur", "shadowBlur", 0, 100);
  bindNumber("sh-opacity", "shadowOpacity", 0, 100);
  bindNumber("sh-angle", "shadowAngle", 0, 359);

  const color = el<HTMLInputElement>("sh-color");
  color?.addEventListener("input", () => {
    if (!color.value) return;
    patch(view, { shadowColor: color.value });
  });
}

/** Show the block for the elements that have it, and mirror their numbers. */
export function syncElementShadow(view: EditorView): void {
  const block = document.getElementById("element-shadow-controls");
  if (!block) return;
  const info = selected(view);
  const type = info ? elementTypeOf(info.node) : null;
  const wanted = !!type && SHADOW_SECTIONS.has(type.toolbarSection);
  block.hidden = !wanted;
  if (!info || !wanted) return;

  const attrs = info.node.attrs as Record<string, unknown>;
  const enabled = !!attrs.shadowEnabled;
  el("sh-toggle")?.classList.toggle("image-toolbar__btn--active", enabled);
  const fields = el("sh-fields");
  if (fields) fields.hidden = !enabled;
  if (!enabled) return;
  const distance = el<HTMLInputElement>("sh-distance");
  if (distance) distance.value = String(attrs.shadowDistance ?? "");
  const blur = el<HTMLInputElement>("sh-blur");
  if (blur) blur.value = String(attrs.shadowBlur ?? "");
  const opacity = el<HTMLInputElement>("sh-opacity");
  if (opacity) opacity.value = String(attrs.shadowOpacity ?? "");
  const color = el<HTMLInputElement>("sh-color");
  if (color) color.value = (attrs.shadowColor as string) || "#000000";
  const angle = el<HTMLInputElement>("sh-angle");
  if (angle) angle.value = String(attrs.shadowAngle ?? "");
}
