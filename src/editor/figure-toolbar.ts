// ============================================================================
// Figure toolbar — Phase 1 (G3) wiring for the caption section of the image
// toolbar. The caption is now a real editable block inside the figure; there
// is no legacy caption field anymore. Loaded dynamically from toolbar.ts.
//
// Visibility rules (syncFigureControls, called on every transaction):
//   - figure selected (node or caret in caption) → caption controls visible:
//     position (above/below), background, Above/Below whitespace, Remove Caption;
//   - plain image selected → "Add Caption" button visible;
//   - otherwise both hidden.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import {
  getSelectedFigure,
  setFigureAttrs,
  addCaptionToImage,
  removeFigureCaption,
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
  const addCaption = el("img-add-caption");
  const removeCaption = el("img-remove-caption");
  const captionBg = el<HTMLInputElement>("img-caption-bg");
  const captionBgClear = el("img-caption-bg-clear");
  const padTop = el<HTMLInputElement>("img-caption-pad-top");
  const padBottom = el<HTMLInputElement>("img-caption-pad-bottom");

  layout?.addEventListener("change", () => {
    void setFigureAttrs(view, { captionLayout: layout.value });
  });

  gap?.addEventListener("change", () => {
    const v = parseIntOrNaN(gap.value);
    void setFigureAttrs(view, { captionGap: isNaN(v) || v < 0 ? 0 : Math.min(120, v) });
  });

  addCaption?.addEventListener("click", () => {
    addCaptionToImage(view);
  });

  removeCaption?.addEventListener("click", () => {
    removeFigureCaption(view);
  });

  captionBg?.addEventListener("input", () => {
    if (captionBg.value) void setFigureAttrs(view, { captionBg: captionBg.value });
  });
  captionBgClear?.addEventListener("click", () => {
    void setFigureAttrs(view, { captionBg: "" });
  });

  padTop?.addEventListener("change", () => {
    const v = parseIntOrNaN(padTop.value);
    void setFigureAttrs(view, { captionPadTop: isNaN(v) || v < 0 ? 0 : v });
  });
  padBottom?.addEventListener("change", () => {
    const v = parseIntOrNaN(padBottom.value);
    void setFigureAttrs(view, { captionPadBottom: isNaN(v) || v < 0 ? 0 : v });
  });
}

/** Show/hide and refresh the caption controls for the current selection. */
export function syncFigureControls(view: EditorView): void {
  const section = el("figure-section");
  const addCaption = el("img-add-caption");
  if (!section || !addCaption) return;

  const figure = getSelectedFigure(view);
  if (figure) {
    section.hidden = false;
    addCaption.hidden = true;

    const layout = el<HTMLSelectElement>("fig-caption-layout");
    if (layout) layout.value = String(figure.node.attrs.captionLayout ?? "below");

    const gap = el<HTMLInputElement>("fig-caption-gap");
    if (gap) gap.value = String(Number(figure.node.attrs.captionGap ?? 0));

    const bg = el<HTMLInputElement>("img-caption-bg");
    if (bg) bg.value = String(figure.node.attrs.captionBg ?? "") || "#ffffff";

    const padTop = el<HTMLInputElement>("img-caption-pad-top");
    if (padTop) padTop.value = String(figure.node.attrs.captionPadTop ?? "");

    const padBottom = el<HTMLInputElement>("img-caption-pad-bottom");
    if (padBottom) padBottom.value = String(figure.node.attrs.captionPadBottom ?? "");
    return;
  }

  section.hidden = true;

  // "Add Caption" offer: a plain image is selected.
  const sel = view.state.selection;
  const isImage = sel instanceof NodeSelection && sel.node.type.name === "image";
  addCaption.hidden = !isImage;
}
