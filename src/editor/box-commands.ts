// ============================================================================
// Box commands — Phase 1 (G2) insertions and style commands for the
// styled_box node. Same pattern as image-commands.ts: one command = one
// attribute patch. Loaded dynamically from toolbar.ts (anti-bloat rule D5).
// Interaction logic (drag/resize) lives in box-node-view.ts.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import {
  DEFAULT_BOX_STYLE,
  NOTE_PRESET,
  TEXT_BOX_PRESET,
  normalizeBoxStyle,
  type BoxVariant,
} from "./box-style";

const BOX_NODE = "styled_box";

export interface SelectedBoxInfo {
  pos: number;
  node: PMNode;
}

/** The box under a NodeSelection, or the box enclosing the caret, if any. */
export function getSelectedBox(view: EditorView): SelectedBoxInfo | null {
  const { selection } = view.state;
  if (selection instanceof NodeSelection && selection.node.type.name === BOX_NODE) {
    return { pos: selection.from, node: selection.node };
  }
  const { $from } = selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === BOX_NODE) {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/**
 * Insert an empty box (one paragraph inside) at the current position and
 * place the caret inside it. Splitting behaviour mirrors image insertion:
 * mid-paragraph splits, boundaries insert before/after the current block.
 */
export function insertStyledBox(view: EditorView, variant: BoxVariant): boolean {
  const { state } = view;
  const boxType = state.schema.nodes[BOX_NODE];
  const paragraph = state.schema.nodes.paragraph;
  if (!boxType || !paragraph) return false;

  const preset = variant === "note" ? NOTE_PRESET : TEXT_BOX_PRESET;
  const attrs = normalizeBoxStyle({ ...DEFAULT_BOX_STYLE, ...preset });
  const boxNode = boxType.create(attrs, paragraph.create());

  const { $from } = state.selection;
  let tr = state.tr;
  let insertedPos: number;

  const inTextblock = $from.parent.isTextblock;
  const atEnd = inTextblock && $from.parentOffset === $from.parent.content.size;
  const atStart = inTextblock && $from.parentOffset === 0;

  if (inTextblock && !atEnd && !atStart) {
    tr = tr.split($from.pos, 1);
    insertedPos = $from.pos + 1;
    tr = tr.insert(insertedPos, boxNode);
  } else if (inTextblock && atEnd) {
    insertedPos = $from.after($from.depth);
    tr = tr.insert(insertedPos, boxNode);
  } else if (inTextblock && atStart) {
    insertedPos = $from.before($from.depth);
    tr = tr.insert(insertedPos, boxNode);
  } else {
    insertedPos = $from.pos;
    tr = tr.insert(insertedPos, boxNode);
  }

  // Caret goes INSIDE the box's first paragraph so typing starts immediately.
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertedPos + 1), 1));

  // Host paragraph after the box: without it a box as last document node
  // would leave nowhere to continue writing below (same rationale as images).
  const boxEnd = insertedPos + boxNode.nodeSize;
  const nodeAfter = tr.doc.nodeAt(boxEnd);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    tr = tr.insert(boxEnd, paragraph.create());
  }

  view.dispatch(tr);
  view.focus();
  return true;
}

function safeSetBoxMarkup(
  view: EditorView,
  pos: number,
  attrs: Record<string, unknown>
): boolean {
  try {
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs));
    return true;
  } catch {
    return false;
  }
}

/** Patch any subset of the box style attrs on the selected/enclosing box. */
export function setBoxAttrs(view: EditorView, patch: Record<string, unknown>): boolean {
  const info = getSelectedBox(view);
  if (!info) return false;
  return safeSetBoxMarkup(view, info.pos, { ...info.node.attrs, ...patch });
}

/** Remove the selected/enclosing box; keep the caret where it was. */
export function removeSelectedBox(view: EditorView): boolean {
  const info = getSelectedBox(view);
  if (!info) return false;
  const { paragraph } = view.state.schema.nodes;
  let tr = view.state.tr.delete(info.pos, info.pos + info.node.nodeSize);
  // Never leave an empty document: host a paragraph where the box was.
  if (tr.doc.childCount === 0 && paragraph) {
    tr = tr.insert(0, paragraph.create());
  }
  view.dispatch(tr);
  view.focus();
  return true;
}
