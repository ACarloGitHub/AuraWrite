// ============================================================================
// Box style toolbar — Phase 1 (G2) wiring for the box's OWN commands.
//
// Two exported functions, mirroring the image-toolbar pattern:
//   - setupBoxToolbar(view): bind listeners once at startup;
//   - syncBoxToolbar(view): refresh values on selection change (called from
//     `syncSecondaryToolbar` on every transaction).
//
// Free, alignment, the text condition, rotation, mirroring, opacity and delete
// are NOT here: they are the shared block of `element-bar.ts`, shown for every
// element. This module owns what only a box has — variant, colours, border,
// radius, width, shadow. Selection/drag/resize belong to the node view
// (box-node-view.ts); reuses the `.image-toolbar*` classes so the look stays
// identical without new CSS families.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedBox, setBoxAttrs } from "./box-commands";
import {
  DEFAULT_BOX_STYLE,
  NOTE_PRESET,
  TEXT_BOX_PRESET,
  normalizeBoxStyle,
} from "./box-style";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseIntOrNaN(v: string): number {
  return parseInt(v, 10);
}

/** Bind the box's own controls once. */
export function setupBoxToolbar(view: EditorView): void {
  const bar = el("box-controls");
  if (!bar) return;

  const variant = el<HTMLSelectElement>("box-variant");
  const bg = el<HTMLInputElement>("box-bg");
  const bgClear = el("box-bg-clear");
  const borderStyle = el<HTMLSelectElement>("box-border-style");
  const borderWidth = el<HTMLInputElement>("box-border-width");
  const borderColor = el<HTMLInputElement>("box-border-color");
  const radius = el<HTMLInputElement>("box-radius");
  const width = el<HTMLInputElement>("box-width");

  // Variant switch applies the FULL preset (background, border, radius,
  // width) merged over the defaults and normalized — not just the variant
  // label. Horizontal alignment is preserved across the switch.
  variant?.addEventListener("change", () => {
    const preset = variant.value === "note" ? NOTE_PRESET : TEXT_BOX_PRESET;
    const style = normalizeBoxStyle({ ...DEFAULT_BOX_STYLE, ...preset });
    const info = getSelectedBox(view);
    const current = info
      ? normalizeBoxStyle(info.node.attrs as Record<string, unknown>)
      : null;
    void setBoxAttrs(view, { ...style, align: current ? current.align : style.align });
  });

  // The same shadow commands as the image bar, on the shared effect attrs.
  const shadowToggle = el<HTMLButtonElement>("box-shadow-toggle");
  const shadowDistance = el<HTMLInputElement>("box-shadow-distance");
  const shadowBlur = el<HTMLInputElement>("box-shadow-blur");
  const shadowOpacity = el<HTMLInputElement>("box-shadow-opacity");
  const shadowColor = el<HTMLInputElement>("box-shadow-color");
  const shadowAngle = el<HTMLInputElement>("box-shadow-angle");

  shadowToggle?.addEventListener("click", () => {
    const info = getSelectedBox(view);
    if (!info) return;
    void setBoxAttrs(view, { shadowEnabled: !info.node.attrs.shadowEnabled });
  });

  const bindShadow = (input: HTMLInputElement | null, key: string, min: number, max: number) => {
    input?.addEventListener("change", () => {
      const v = parseIntOrNaN(input.value);
      if (isNaN(v)) return;
      void setBoxAttrs(view, { [key]: Math.max(min, Math.min(max, v)) });
    });
  };
  bindShadow(shadowDistance, "shadowDistance", 0, 60);
  bindShadow(shadowBlur, "shadowBlur", 0, 100);
  bindShadow(shadowOpacity, "shadowOpacity", 0, 100);
  bindShadow(shadowAngle, "shadowAngle", 0, 359);

  shadowColor?.addEventListener("input", () => {
    if (!shadowColor.value) return;
    void setBoxAttrs(view, { shadowColor: shadowColor.value });
  });

  bg?.addEventListener("input", () => {
    if (!bg.value) return;
    void setBoxAttrs(view, { bgColor: bg.value });
  });
  bgClear?.addEventListener("click", () => {
    void setBoxAttrs(view, { bgColor: "" });
  });

  // Choosing a stroke with width still 0 gives a sensible default width.
  borderStyle?.addEventListener("change", () => {
    const info = getSelectedBox(view);
    if (!info) return;
    const patch: Record<string, unknown> = { borderStyle: borderStyle.value };
    if (borderStyle.value !== "none" && !(info.node.attrs.borderWidth > 0)) {
      patch.borderWidth = 1;
    }
    void setBoxAttrs(view, patch);
  });

  borderWidth?.addEventListener("change", () => {
    const info = getSelectedBox(view);
    if (!info) return;
    const v = parseIntOrNaN(borderWidth.value);
    if (isNaN(v)) return;
    const w = Math.max(0, Math.min(24, v));
    const patch: Record<string, unknown> = { borderWidth: w };
    if (w > 0 && (info.node.attrs.borderStyle as string) === "none") {
      patch.borderStyle = "solid";
    }
    void setBoxAttrs(view, patch);
  });

  borderColor?.addEventListener("input", () => {
    if (!borderColor.value) return;
    void setBoxAttrs(view, { borderColor: borderColor.value });
  });

  radius?.addEventListener("change", () => {
    const v = parseIntOrNaN(radius.value);
    void setBoxAttrs(view, { cornerRadius: isNaN(v) || v < 0 ? 0 : v });
  });

  width?.addEventListener("change", () => {
    const v = parseIntOrNaN(width.value);
    // Empty field = full column (null).
    void setBoxAttrs(view, { widthPx: isNaN(v) || v < 60 ? null : v });
  });
}

/** Refresh the box's own controls for the current selection. */
export function syncBoxToolbar(view: EditorView): void {
  const info = getSelectedBox(view);
  if (!info) {
    document.querySelectorAll(".aw-box--active").forEach((el) => el.classList.remove("aw-box--active"));
    return;
  }

  // The handles follow the SAME rule as this bar: the box is "active" whenever
  // it is node-selected OR the caret is inside it, so in flow they appear as
  // soon as the box is picked, exactly like in Free.
  document.querySelectorAll(".aw-box--active").forEach((el) => el.classList.remove("aw-box--active"));
  const boxDom = view.nodeDOM(info.pos);
  if (boxDom instanceof HTMLElement) boxDom.classList.add("aw-box--active");

  const a = normalizeBoxStyle(info.node.attrs as Record<string, unknown>);

  const variant = el<HTMLSelectElement>("box-variant");
  if (variant) variant.value = a.variant;

  // The same shadow commands as the image bar: state and values from the node.
  const shadowEnabled = !!info.node.attrs.shadowEnabled;
  el("box-shadow-toggle")?.classList.toggle("image-toolbar__btn--active", shadowEnabled);
  const shadowFields = el<HTMLElement>("box-shadow-fields");
  if (shadowFields) shadowFields.hidden = !shadowEnabled;
  if (shadowEnabled) {
    const shadowDistance = el<HTMLInputElement>("box-shadow-distance");
    if (shadowDistance) shadowDistance.value = String(info.node.attrs.shadowDistance ?? "");
    const shadowBlur = el<HTMLInputElement>("box-shadow-blur");
    if (shadowBlur) shadowBlur.value = String(info.node.attrs.shadowBlur ?? "");
    const shadowOpacity = el<HTMLInputElement>("box-shadow-opacity");
    if (shadowOpacity) shadowOpacity.value = String(info.node.attrs.shadowOpacity ?? "");
    const shadowColor = el<HTMLInputElement>("box-shadow-color");
    if (shadowColor) shadowColor.value = (info.node.attrs.shadowColor as string) || "#000000";
    const shadowAngle = el<HTMLInputElement>("box-shadow-angle");
    if (shadowAngle) shadowAngle.value = String(info.node.attrs.shadowAngle ?? "");
  }

  const bg = el<HTMLInputElement>("box-bg");
  if (bg) bg.value = a.bgColor || "#ffffff";

  const borderStyle = el<HTMLSelectElement>("box-border-style");
  if (borderStyle) borderStyle.value = a.borderStyle;

  const borderWidth = el<HTMLInputElement>("box-border-width");
  if (borderWidth) borderWidth.value = a.borderWidth ? String(a.borderWidth) : "";

  const borderColor = el<HTMLInputElement>("box-border-color");
  if (borderColor) borderColor.value = a.borderColor || "#999999";

  const radius = el<HTMLInputElement>("box-radius");
  if (radius) radius.value = String(a.cornerRadius);

  const width = el<HTMLInputElement>("box-width");
  if (width) width.value = a.widthPx != null ? String(a.widthPx) : "";
}
