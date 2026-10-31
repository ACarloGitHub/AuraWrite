// ============================================================================
// Shape commands (chapter A, step S1) — inserting a shape and changing its
// numbers. One command = one attribute patch, like the image and the box: the
// behaviour (drag, free, depth) is not written here, it is inherited.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import { ensureParagraphAfter, getSelectedElement, setNodeAttrs } from "./element-commands";
import {
  defaultShapeBox,
  normalizeShapeParams,
  shapeBoxSize,
  type ShapeKind,
} from "./shape-params";

const SHAPE_NODE = "shape";

export interface SelectedShapeInfo {
  pos: number;
  node: PMNode;
}

/** The shape under a NodeSelection or enclosing the caret, if any. */
export function getSelectedShape(view: EditorView): SelectedShapeInfo | null {
  return getSelectedElement(view, [SHAPE_NODE]);
}

/**
 * Insert a shape at the caret and select it, so its bar appears at once — the
 * same gesture the image uses. The element is a whole block: mid-paragraph it
 * splits the paragraph, at a boundary it goes before or after.
 */
export function insertShape(view: EditorView, kind: ShapeKind): boolean {
  const { state } = view;
  const shapeType = state.schema.nodes[SHAPE_NODE];
  if (!shapeType) return false;

  const box = defaultShapeBox(kind);
  const params = normalizeShapeParams({ shape: kind });
  const shapeNode = shapeType.create({
    shape: params.kind,
    width: box.width,
    height: box.height,
    strokeWidth: params.strokeWidth,
    strokeColor: params.strokeColor,
    headSize: params.headSize,
  });

  const { $from } = state.selection;
  let tr = state.tr;
  let insertedPos: number;
  const inTextblock = $from.parent.isTextblock;
  const atEnd = inTextblock && $from.parentOffset === $from.parent.content.size;
  const atStart = inTextblock && $from.parentOffset === 0;

  if (inTextblock && !atEnd && !atStart) {
    tr = tr.split($from.pos, 1);
    insertedPos = $from.pos + 1;
    tr = tr.insert(insertedPos, shapeNode);
  } else if (inTextblock && atEnd) {
    insertedPos = $from.after($from.depth);
    tr = tr.insert(insertedPos, shapeNode);
  } else if (inTextblock && atStart) {
    insertedPos = $from.before($from.depth);
    tr = tr.insert(insertedPos, shapeNode);
  } else {
    insertedPos = $from.pos;
    tr = tr.insert(insertedPos, shapeNode);
  }

  tr = tr.setSelection(NodeSelection.create(tr.doc, insertedPos));
  // The same shared rule as images and boxes: a paragraph after the element, so
  // the caret has a place to land below it.
  tr = ensureParagraphAfter(tr, insertedPos + shapeNode.nodeSize, state.schema);

  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Patch any subset of the shape's attributes.
 *
 * The box is kept hugging the shape (§6): a line is always as tall as its
 * stroke, and switching to an arrow gives it a head-high box again. Derived
 * here, in ONE place, so the bar's W/H fields, the kind selector and the
 * stroke field can never leave a box with air inside it.
 */
export function setShapeAttrs(view: EditorView, patch: Record<string, unknown>): boolean {
  const info = getSelectedShape(view);
  if (!info) return false;
  const merged = { ...info.node.attrs, ...patch } as Record<string, unknown>;
  const params = normalizeShapeParams(merged);
  const kindChanged = params.kind !== normalizeShapeParams(info.node.attrs as Record<string, unknown>).kind;
  // A line's height is its stroke; a new arrow gets a head-high box instead of
  // inheriting the line's two pixels, which would leave a flat arrow.
  const height = params.kind === "line" ? params.strokeWidth : kindChanged ? params.headSize : merged.height;
  const box = shapeBoxSize({ ...merged, height });
  return setNodeAttrs(view, info.pos, {
    ...merged,
    shape: params.kind,
    strokeWidth: params.strokeWidth,
    strokeColor: params.strokeColor,
    fill: params.fill,
    headSize: params.headSize,
    width: box.width,
    height: box.height,
  });
}
