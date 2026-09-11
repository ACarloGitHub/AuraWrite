// ============================================================================
// Element commands — shared lookup and patch helpers for the block elements
// (image, figure, styled_box).
//
// The three command modules had grown the same two functions each (find the
// selected/enclosing element, patch its attrs) plus the same "host paragraph"
// rule at insertion. This module is the ONE definition; corrections land once.
// Structural extraction only, identical behaviour.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode, type Schema } from "prosemirror-model";
import { NodeSelection, type Transaction } from "prosemirror-state";

export interface SelectedElementInfo {
  pos: number;
  node: PMNode;
}

/**
 * The element of one of `names` under the selection: a NodeSelection on it, or
 * the element enclosing the caret (content editing, e.g. inside a caption).
 */
export function getSelectedElement(
  view: EditorView,
  names: readonly string[],
): SelectedElementInfo | null {
  const { selection } = view.state;
  if (selection instanceof NodeSelection && names.includes(selection.node.type.name)) {
    return { pos: selection.from, node: selection.node };
  }
  const { $from } = selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (names.includes(node.type.name)) return { pos: $from.before(d), node };
  }
  return null;
}

/** `setNodeMarkup` guarded: returns false instead of throwing on schema drift. */
export function setNodeAttrs(
  view: EditorView,
  pos: number,
  attrs: Record<string, unknown>,
): boolean {
  try {
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, attrs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert an empty paragraph after `endPos` when nothing else follows, so the
 * caret always has a place to land below an inserted element (Google Docs and
 * Word behaviour). No-op when a block is already there.
 */
export function ensureParagraphAfter(tr: Transaction, endPos: number, schema: Schema): Transaction {
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return tr;
  const nodeAfter = tr.doc.nodeAt(endPos);
  if (!nodeAfter || nodeAfter.type !== paragraph) {
    return tr.insert(endPos, paragraph.create());
  }
  return tr;
}
