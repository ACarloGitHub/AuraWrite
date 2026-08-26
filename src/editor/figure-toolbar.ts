// ============================================================================
// Figure toolbar — Phase 1 (G3) wiring for the caption section of the image
// toolbar (#figure-section) and the legacy-caption conversion button
// (#img-make-figure). Loaded dynamically from toolbar.ts (thin hook).
//
// Visibility rules (syncFigureControls, called on every transaction):
//   - figure selected (node, inner image, or caret in caption) → caption
//     section visible, conversion button hidden;
//   - plain image with a legacy caption → conversion button visible;
//   - otherwise both hidden.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import {
  getSelectedFigure,
  setFigureAttrs,
  convertCaptionToFigure,
  convertFigureToCaption,
} from "./figure-commands";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseIntOrNaN(v: string): number {
  return parseInt(v, 10);
}

/** Bind the caption section controls once. */
export function setupFigureToolbar(view: EditorView): void {
  const layout = el<HTMLSelectElement>("fig-caption-layout");
  const gap = el<HTMLInputElement>("fig-caption-gap");
  const makeFigure = el("img-make-figure");
  const toCaption = el("fig-to-caption");

  layout?.addEventListener("change", () => {
    void setFigureAttrs(view, { captionLayout: layout.value });
  });

  gap?.addEventListener("change", () => {
    const v = parseIntOrNaN(gap.value);
    void setFigureAttrs(view, { captionGap: isNaN(v) || v < 0 ? 0 : Math.min(120, v) });
  });

  makeFigure?.addEventListener("click", () => {
    convertCaptionToFigure(view);
  });

  toCaption?.addEventListener("click", () => {
    convertFigureToCaption(view);
  });
}

/** Show/hide the caption section and the conversion button, refresh values. */
export function syncFigureControls(view: EditorView): void {
  const section = el("figure-section");
  const makeFigure = el("img-make-figure");
  if (!section || !makeFigure) return;

  const figure = getSelectedFigure(view);
  if (figure) {
    section.hidden = false;
    makeFigure.hidden = true;

    const layout = el<HTMLSelectElement>("fig-caption-layout");
    if (layout) layout.value = String(figure.node.attrs.captionLayout ?? "below");

    const gap = el<HTMLInputElement>("fig-caption-gap");
    const gapValue = Number(figure.node.attrs.captionGap ?? 12);
    if (gap && isFinite(gapValue)) gap.value = String(gapValue);
    return;
  }

  section.hidden = true;

  // Conversion offer: plain image selected with a legacy caption.
  const sel = view.state.selection;
  const legacyCaption =
    sel instanceof NodeSelection &&
    sel.node.type.name === "image" &&
    String(sel.node.attrs.caption ?? "").trim() !== "";
  makeFigure.hidden = !legacyCaption;
}
