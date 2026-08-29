// ============================================================================
// Figure commands — Phase 1 (G3, refactor 2026-08-29). Selection lookup for the
// composite figure node (figure itself, caret inside the caption), attribute
// patches, and the explicit conversions to/from the plain image node.
//
// The figure now CARRIES the photo as attrs and holds the caption text as
// content (canonical ProseMirror pattern). The conversions keep the photo
// attrs invariant — converting must never alter the photo's size or ratio.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";

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
  // Covers: caret in the caption AND NodeSelection on the inner image (the
  // resolved position sits inside the figure).
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === FIGURE_NODE) {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/** Patch figure attrs (captionLayout / captionGap / photo style, etc.). */
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
 * Convert the selected bare image into a figure with an EMPTY editable caption.
 * The photo moves into the figure attrs unchanged; the caption is a real
 * paragraph and the caret lands inside it so typing starts immediately.
 * This is the "Add Caption" gesture (no legacy caption field anymore).
 */
export function addCaptionToImage(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
    return false;
  }
  const image = selection.node;
  const schema = view.state.schema;
  const figureType = schema.nodes[FIGURE_NODE];
  const paragraph = schema.nodes.paragraph;
  if (!figureType || !paragraph) return false;

  // The figure carries every photo attr except the legacy `caption` attribute.
  const figAttrs: Record<string, unknown> = { ...image.attrs };
  delete figAttrs.caption;

  const figure = figureType.create(figAttrs, [paragraph.create()]);

  const pos = selection.from;
  let tr = view.state.tr.replaceWith(pos, pos + image.nodeSize, figure);
  const figureEnd = pos + figure.nodeSize;
  const nodeAfter = tr.doc.nodeAt(figureEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    tr = tr.insert(figureEnd, paragraph.create());
  }
  // Caret inside the caption (first text position), ready to type.
  const $caret = tr.doc.resolve(pos + 1);
  tr = tr.setSelection(TextSelection.near($caret, 1));
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Convert a figure back into a bare image (drops the caption). Photo attrs
 * unchanged. This is the "Remove Caption" gesture.
 */
export function removeFigureCaption(view: EditorView): boolean {
  const info = getSelectedFigure(view);
  if (!info) return false;
  const figure = info.node;
  const pos = info.pos;
  const schema = view.state.schema;
  const imageType = schema.nodes.image;
  const paragraph = schema.nodes.paragraph;
  if (!imageType || !paragraph) return false;

  const imageAttrs: Record<string, unknown> = { ...figure.attrs };
  delete imageAttrs.captionLayout;
  delete imageAttrs.captionGap;
  delete imageAttrs.captionBg;
  delete imageAttrs.captionPadTop;
  delete imageAttrs.captionPadBottom;
  delete imageAttrs.caption;
  const bareImage = imageType.create(imageAttrs);

  let tr = view.state.tr.replaceWith(pos, pos + figure.nodeSize, bareImage);
  const imageEnd = pos + bareImage.nodeSize;
  const nodeAfter = tr.doc.nodeAt(imageEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    tr = tr.insert(imageEnd, paragraph.create());
  }
  tr = tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  view.focus();
  return true;
}
