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
import { isWrapping, textConditionOf, type TextCondition } from "./element-condition";
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

// U3: the one button cycles through the three text conditions, exactly as the
// image bar does (same order, same labels).
const CONDITION_ORDER: TextCondition[] = ["wrapped", "unwrapped", "overlap"];
const CONDITION_LABEL: Record<TextCondition, string> = {
  wrapped: "Wrapped",
  unwrapped: "Unwrapped",
  overlap: "Overlap",
};

function nextCondition(condition: TextCondition): TextCondition {
  return CONDITION_ORDER[(CONDITION_ORDER.indexOf(condition) + 1) % CONDITION_ORDER.length];
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

  alignLeft?.addEventListener("click", () => void setBoxAttrs(view, { align: "left" }));
  alignCenter?.addEventListener("click", () => void setBoxAttrs(view, { align: "center" }));
  alignRight?.addEventListener("click", () => void setBoxAttrs(view, { align: "right" }));

  // U3: same condition command as the image bar, via the shared element state.
  el("box-condition")?.addEventListener("click", () => {
    const info = getSelectedBox(view);
    if (!info) return;
    void setBoxAttrs(view, { wrap: nextCondition(textConditionOf(info.node)) });
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

  deleteBtn?.addEventListener("click", () => {
    removeSelectedBox(view);
  });

  // F3.a: free / back into the flow. The same command the image bar uses, so
  // every free-capable element behaves identically.
  el("box-free")?.addEventListener("click", async () => {
    const { toggleElementFree } = await import("./free-commands");
    toggleElementFree(view);
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
  // In Free the horizontal is decided by the mouse: hide Left/Center/Right.
  const isFree = !!info.node.attrs.free;
  for (const btn of Object.values(alignButtons)) {
    if (btn) btn.hidden = isFree;
  }
  const alignSeparator = el("box-align-separator");
  if (alignSeparator) alignSeparator.hidden = isFree;

  // U3: show the current text condition (same wording as the image bar).
  const condition = textConditionOf(info.node);
  const conditionBtn = el<HTMLButtonElement>("box-condition");
  if (conditionBtn) {
    conditionBtn.textContent = CONDITION_LABEL[condition];
    conditionBtn.title = `Text around this element: ${CONDITION_LABEL[condition]}`;
    conditionBtn.classList.toggle("image-toolbar__btn--active", isWrapping(condition));
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

  // F3.a: the free button always reads as the action it performs.
  const freeBtn = el<HTMLButtonElement>("box-free");
  if (freeBtn) {
    const free = !!info.node.attrs.free;
    // The button shows the element's CURRENT state, not the action.
    freeBtn.textContent = free ? "Free" : "In flow";
    freeBtn.title = free
      ? "Put this box back between the paragraphs"
      : "Take this box out of the text flow";
    freeBtn.classList.toggle("image-toolbar__btn--active", free);
  }
}
