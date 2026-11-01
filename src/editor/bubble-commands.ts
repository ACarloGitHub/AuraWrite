// ============================================================================
// Bubble commands — insertion and attribute patches for the speech balloon.
// Same shape as `box-commands.ts`: one command = one attribute patch, loaded
// dynamically from the toolbar (anti-bloat rule D5). The gestures live in
// `bubble-node-view.ts`.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { ensureParagraphAfter, getSelectedElement, setNodeAttrs } from "./element-commands";

const BUBBLE_NODE = "bubble";

export interface SelectedBubbleInfo {
  pos: number;
  node: PMNode;
}

/** The balloon under a NodeSelection, or the one enclosing the caret, if any. */
export function getSelectedBubble(view: EditorView): SelectedBubbleInfo | null {
  return getSelectedElement(view, [BUBBLE_NODE]);
}

/**
 * Insert an empty balloon (one paragraph inside) at the current position and
 * put the caret in it, so the words go inside the balloon straight away. The
 * splitting rule is the box's and the image's: mid-paragraph it splits, at the
 * edges it goes before/after the block.
 */
export function insertBubble(view: EditorView): boolean {
  const { state } = view;
  const bubbleType = state.schema.nodes[BUBBLE_NODE];
  const paragraph = state.schema.nodes.paragraph;
  if (!bubbleType || !paragraph) return false;

  const bubbleNode = bubbleType.create(null, paragraph.create());
  const { $from } = state.selection;
  let tr = state.tr;
  let insertedPos: number;

  const inTextblock = $from.parent.isTextblock;
  const atEnd = inTextblock && $from.parentOffset === $from.parent.content.size;
  const atStart = inTextblock && $from.parentOffset === 0;

  if (inTextblock && !atEnd && !atStart) {
    tr = tr.split($from.pos, 1);
    insertedPos = $from.pos + 1;
    tr = tr.insert(insertedPos, bubbleNode);
  } else if (inTextblock && atEnd) {
    insertedPos = $from.after($from.depth);
    tr = tr.insert(insertedPos, bubbleNode);
  } else if (inTextblock && atStart) {
    insertedPos = $from.before($from.depth);
    tr = tr.insert(insertedPos, bubbleNode);
  } else {
    insertedPos = $from.pos;
    tr = tr.insert(insertedPos, bubbleNode);
  }

  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertedPos + 1), 1));
  tr = ensureParagraphAfter(tr, insertedPos + bubbleNode.nodeSize, state.schema);

  view.dispatch(tr);
  view.focus();
  return true;
}

/** Patch any subset of the balloon's attributes on the selected one. */
export function setBubbleAttrs(view: EditorView, patch: Record<string, unknown>): boolean {
  const info = getSelectedBubble(view);
  if (!info) return false;
  return setNodeAttrs(view, info.pos, { ...info.node.attrs, ...patch });
}
