// ============================================================================
// Figure commands — Phase 1 (G3) for the composite figure node: selection
// lookup (figure node, image inside, or caret in the caption box), attribute
// patches, and the explicit conversion from the legacy image caption.
// Same pattern as box-commands.ts; loaded dynamically from toolbar.ts.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import { normalizeBoxStyle } from "./box-style";

const FIGURE_NODE = "figure";

export interface SelectedFigureInfo {
  pos: number;
  node: PMNode;
}

/**
 * The figure under a NodeSelection, the figure owning the selected inner
 * image, or the figure enclosing the caret (caption editing).
 */
export function getSelectedFigure(view: EditorView): SelectedFigureInfo | null {
  const { selection } = view.state;
  const $from = selection.$from;

  if (selection instanceof NodeSelection && selection.node.type.name === FIGURE_NODE) {
    return { pos: selection.from, node: selection.node };
  }
  // Covers: caret in the caption box, AND NodeSelection on the inner image
  // (the resolved position sits inside the figure).
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === FIGURE_NODE) {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/** Patch figure attrs (captionLayout / captionGap) on the selected figure. */
export function setFigureAttrs(view: EditorView, patch: Record<string, unknown>): boolean {
  const info = getSelectedFigure(view);
  if (!info) return false;
  try {
    view.dispatch(view.state.tr.setNodeMarkup(info.pos, undefined, { ...info.node.attrs, ...patch }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a composite figure BACK into a plain image with the legacy caption:
 * the caption box's text becomes the image caption attribute. Explicit
 * gesture only (button in the caption section).
 */
export function convertFigureToCaption(view: EditorView): boolean {
  // Locate the figure the same way the toolbar does (getSelectedFigure):
  // the figure node itself, the inner image, or the caret inside the caption
  // box. The old guard required a NodeSelection on the figure, so clicking
  // into the caption (the natural interaction) made the button a no-op.
  const info = getSelectedFigure(view);
  if (!info) return false;
  const figure = info.node;
  const pos = info.pos;

  let foundImage: PMNode | null = null;
  let foundCaptionBox: PMNode | null = null;
  figure.forEach((child) => {
    if (child.type.name === "image") foundImage = child;
    else if (child.type.name === "styled_box") foundCaptionBox = child;
  });
  const innerImage = foundImage as PMNode | null;
  const captionBox = foundCaptionBox as PMNode | null;
  if (!innerImage) return false;
  const caption = String(captionBox?.textContent ?? "").trim();

  const restoredImage = innerImage.type.create({ ...innerImage.attrs, caption });
  let tr = view.state.tr.replaceWith(pos, pos + figure.nodeSize, restoredImage);
  const paragraph = view.state.schema.nodes.paragraph;
  const imageEnd = pos + restoredImage.nodeSize;
  const nodeAfter = tr.doc.nodeAt(imageEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    if (paragraph) tr = tr.insert(imageEnd, paragraph.create());
  }
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Convert the selected image's LEGACY caption (plain text attribute) into a
 * composite figure: same image (caption attribute cleared) + a caption box
 * containing the old text. Explicit gesture only — no silent migrations.
 */
export function convertCaptionToFigure(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
    return false;
  }
  const image = selection.node;
  const caption = String(image.attrs.caption ?? "").trim();
  if (!caption) return false;

  const schema = view.state.schema;
  const figureType = schema.nodes[FIGURE_NODE];
  const boxType = schema.nodes.styled_box;
  const paragraph = schema.nodes.paragraph;
  if (!figureType || !boxType || !paragraph) return false;

  const innerImage = image.type.create({ ...image.attrs, caption: "" });
  const boxAttrs = normalizeBoxStyle({
    variant: "text",
    bgColor: "",
    borderWidth: 0,
    borderColor: "#999999",
    borderStyle: "solid",
    cornerRadius: 0,
    widthPx: null,
  });
  const captionBox = boxType.create(boxAttrs, paragraph.create(null, schema.text(caption)));
  const figure = figureType.create({ captionLayout: "below", captionGap: 12 }, [
    innerImage,
    captionBox,
  ]);

  const pos = selection.from;
  let tr = view.state.tr.replaceWith(pos, pos + image.nodeSize, figure);
  const figureEnd = pos + figure.nodeSize;
  const nodeAfter = tr.doc.nodeAt(figureEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    tr = tr.insert(figureEnd, paragraph.create());
  }
  view.dispatch(tr);
  view.focus();
  return true;
}
