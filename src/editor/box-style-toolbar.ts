// ============================================================================
// Box style toolbar — Phase 1 (G2) wiring for the contextual styled-box
// panel (#box-toolbar). Loaded dynamically from toolbar.ts (thin hook).
//
// Two exported functions, mirroring the image-toolbar pattern:
//   - setupBoxToolbar(view): bind listeners once at startup;
//   - syncBoxToolbar(view): show/hide + refresh values on selection change
//     (called from updateImageToolbar on every transaction).
//
// Selection/drag/resize belong to the node view (box-node-view.ts); this
// module only drives the panel. Reuses .image-toolbar* classes so the look
// stays identical to the image bar without new CSS families.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { getSelectedBox, setBoxAttrs, removeSelectedBox } from "./box-commands";
import { normalizeBoxStyle } from "./box-style";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseIntOrNaN(v: string): number {
  return parseInt(v, 10);
}

/** Bind the box panel controls once. */
export function setupBoxToolbar(view: EditorView): void {
  const bar = el("box-toolbar");
  if (!bar) return;

  // Keep native controls interactive while preventing editor focus loss
  // (same protection as the image toolbar).
  bar.addEventListener("mousedown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT") return;
    e.preventDefault();
  });
  bar.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT") {
      e.stopPropagation();
    }
  });

  const variant = el<HTMLSelectElement>("box-variant");
  const alignLeft = el("box-align-left");
  const alignCenter = el("box-align-center");
  const alignRight = el("box-align-right");
  const bg = el<HTMLInputElement>("box-bg");
  const bgClear = el("box-bg-clear");
  const borderStyle = el<HTMLSelectElement>("box-border-style");
  const borderWidth = el<HTMLInputElement>("box-border-width");
  const borderColor = el<HTMLInputElement>("box-border-color");
  const radius = el<HTMLInputElement>("box-radius");
  const width = el<HTMLInputElement>("box-width");
  const deleteBtn = el("box-delete");

  variant?.addEventListener("change", () => {
    void setBoxAttrs(view, { variant: variant.value });
  });

  alignLeft?.addEventListener("click", () => void setBoxAttrs(view, { align: "left" }));
  alignCenter?.addEventListener("click", () => void setBoxAttrs(view, { align: "center" }));
  alignRight?.addEventListener("click", () => void setBoxAttrs(view, { align: "right" }));

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

  deleteBtn?.addEventListener("click", () => {
    removeSelectedBox(view);
  });
}

/** Show/hide the box panel and refresh its values for the current selection. */
export function syncBoxToolbar(view: EditorView): void {
  const bar = document.getElementById("box-toolbar");
  if (!bar) return;

  const info = getSelectedBox(view);
  if (!info) {
    bar.classList.remove("image-toolbar--visible");
    return;
  }
  bar.classList.add("image-toolbar--visible");

  const a = normalizeBoxStyle(info.node.attrs as Record<string, unknown>);

  const variant = el<HTMLSelectElement>("box-variant");
  if (variant) variant.value = a.variant;

  const alignButtons: Record<string, HTMLElement | null> = {
    left: el("box-align-left"),
    center: el("box-align-center"),
    right: el("box-align-right"),
  };
  for (const [value, btn] of Object.entries(alignButtons)) {
    btn?.classList.toggle("image-toolbar__btn--active", a.align === value);
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
