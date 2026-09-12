// ============================================================================
// Free-layout plugin (F3.a) — paints the free elements and enforces the
// anchoring rule.
//
// Two jobs, both cheap and both driven by document changes:
//
//  1. PAINT: every top-level free element is placed by free-style.ts from its
//     own attributes and the live position of its anchor block. Painting
//     happens one frame after the state update because an element that has
//     just been mounted has no geometry yet.
//
//  2. ANCHORING RULE (contract §2.5, §5): the anchor of a free element is the
//     block that precedes it, and when that block is deleted the elements
//     hanging off it die in the SAME transaction, so one undo brings both
//     back.
//
//     Detection follows the positions through ProseMirror's step maps, which
//     is the only mechanism that can tell the two cases apart:
//      - the anchor block EDITED (typing in it) keeps its content alive ->
//        the element must survive;
//      - the anchor block DELETED -> its content range disappears -> the
//        element dies with it.
//     Comparing node object identity instead would be wrong: an edited
//     paragraph is a NEW object, so typing in the anchor would have killed the
//     element. That was the first version of this rule, caught by the
//     temporary check before it ever reached the editor.
//
//     The probe position is one step INSIDE the anchor, so a paragraph that is
//     merely joined with its neighbour (backspace at its start) keeps the
//     elements attached to it: the text they hang from is still there. An
//     EMPTY anchor that gets merged away does count as deleted, because
//     nothing of it survives.
// ============================================================================

import { Plugin, PluginKey, EditorState, type Transaction } from "prosemirror-state";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { freeLayoutMap, isFreeCapable, isFreeNode, layerLevelOf } from "./free-layout";
import {
  applyFlowDepth,
  applyFreeLayout,
  applyOverlapLayout,
  clearFlowDepth,
  clearFreeLayout,
  clearOverlapLayout,
} from "./free-style";
import { isOverlap, textConditionOf } from "./element-condition";

export const freeLayoutPluginKey = new PluginKey("awFreeLayout");

interface AnchorRecord {
  /** Start of the free element in the document this record describes. */
  elementPos: number;
  /** Start of the TEXT block it hangs from, or null when there is none. */
  anchorPos: number | null;
  /** That text block's content disappeared - the element must die. */
  anchorLost: boolean;
}

/**
 * Snapshot of every free element and its anchor, taken from `freeLayoutMap`:
 * the ONE definition of "what is my anchor", shared by the painter, the page
 * groups and the pagination engine.
 *
 * This function used to walk back to the previous block whatever it was, so two
 * pictures on the same line recorded the FIRST PICTURE as the second one's
 * anchor: deleting the line killed one picture and left the other behind, still
 * measured from a block that no longer existed (caught by the temporary check,
 * not by reading the code).
 */
function snapshot(doc: PMNode): AnchorRecord[] {
  return freeLayoutMap(doc).map((entry) => ({
    elementPos: entry.pos,
    anchorPos: entry.anchorPos,
    anchorLost: false,
  }));
}

/** Track one record through a transaction; null when the element is gone. */
function advanceRecord(
  record: AnchorRecord,
  tr: Transaction,
  newState: EditorState,
): AnchorRecord | null {
  if (!tr.docChanged) return record;
  const map = tr.mapping;
  // assoc +1 on the element's start: we ask about the element's OWN token, not
  // about the block that used to precede it. With assoc -1 a plain deletion of
  // the anchor reported the element's position as "deleted" and the element
  // was silently forgotten (found by the temporary check, not by luck).
  const moved = map.mapResult(record.elementPos, 1);
  if (moved.deletedAcross) return null;
  const node = newState.doc.nodeAt(moved.pos);
  // Deleted outright, or moved back into the flow: nothing left to police.
  if (!node || !isFreeCapable(node) || !isFreeNode(node)) return null;

  let anchorLost = record.anchorLost;
  if (record.anchorPos !== null) {
    // Probe INSIDE the anchor and ask for a cut that covers the position from
    // both sides: that is a deleted block. Joining the anchor with its
    // neighbour keeps the text (and the element); editing it keeps it too.
    const probe = map.mapResult(record.anchorPos + 1, -1);
    if (probe.deletedAcross) anchorLost = true;
  }
  // The anchor is re-read from the new document through the SAME rule, so an
  // element that lost its old anchor cannot keep pointing at a stale position.
  const fresh = freeLayoutMap(newState.doc).find((e) => e.pos === moved.pos);
  return {
    elementPos: moved.pos,
    anchorPos: fresh ? fresh.anchorPos : record.anchorPos,
    anchorLost,
  };
}

/** Delete every element whose anchor vanished (from the end backwards). */
function pruneOrphanedFree(state: EditorState, records: AnchorRecord[]): Transaction | null {
  const doomed = records.filter((r) => r.anchorLost).map((r) => r.elementPos);
  if (doomed.length === 0) return null;
  const cuts: { at: number; size: number }[] = [];
  state.doc.forEach((node, offset) => {
    if (doomed.includes(offset) && isFreeNode(node)) cuts.push({ at: offset, size: node.nodeSize });
  });
  if (cuts.length === 0) return null;
  let tr = state.tr;
  for (const cut of cuts.reverse()) tr = tr.delete(cut.at, cut.at + cut.size);
  return tr;
}

/**
 * Keyboard guard (bug 9 in [[todo/_bug-aperti]]): with an image or a
 * figure selected, typing a letter used to REPLACE the element - the writer
 * lost the picture and the caret never moved past it. Word's behaviour is the
 * opposite: the element stays where it is and the text starts after it. The
 * styled box keeps its own older guard (typing enters the box), which runs on
 * keydown and therefore lands before this hook: by then the selection is a
 * text cursor and this guard does not apply.
 *
 * Deletion is deliberately NOT touched: Backspace/Delete on a selected element
 * must still delete it, exactly as it does today.
 */
export function createElementTypeGuardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput: (view, from, to, text) => {
        const tr = guardTypingOverElement(view.state, from, to, text);
        if (!tr) return false;
        view.dispatch(tr);
        view.focus();
        return true;
      },
    },
  });
}

/**
 * The rule, apart from any view: when the replaced range IS a node-selected
 * element, typing must write next to it instead of destroying it. Returns the
 * transaction to dispatch, or null when the keystroke is an ordinary edit.
 *
 * Kept as a plain function over the state so the rule can be probed without a
 * browser: the guard itself is a two-line wrapper around it.
 */
export function guardTypingOverElement(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || !isFreeCapable(sel.node)) return null;
  if (from !== sel.from || to !== sel.to) return null;
  return typingAfterElement(state, text, sel.from, sel.node);
}

/**
 * Transaction that inserts `text` AFTER the element at `pos`, creating the
 * paragraph needed when the element is the last block or is followed by
 * another non-text block. Returns null when nothing can be done.
 */
function typingAfterElement(
  state: EditorState,
  text: string,
  pos: number,
  node: PMNode,
): Transaction | null {
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  const after = pos + node.nodeSize;
  const next = state.doc.resolve(after).nodeAfter;
  // The text goes NEXT TO the element, never inside whatever follows it:
  //  - a text block right after the element receives it at its own start
  //    (one step past the block's opening token);
  //  - anything else (another picture, a box, end of document) needs a fresh
  //    paragraph, whose content starts one step past its opening token.
  const opensParagraph = !next || !next.isTextblock;
  try {
    let tr = state.tr;
    if (opensParagraph) {
      tr = tr.insert(after, paragraph.createAndFill() ?? paragraph.create());
    }
    const caret = after + 1;
    tr = tr.insertText(text, caret, caret);
    return tr.setSelection(TextSelection.create(tr.doc, caret + text.length));
  } catch {
    return null;
  }
}

export function createFreeLayoutPlugin(): Plugin {
  return new Plugin({
    key: freeLayoutPluginKey,
    state: {
      init: (_config, state) => snapshot(state.doc),
      apply: (tr, previous, _oldState, newState) => {
        if (!tr.docChanged) return previous;
        const next: AnchorRecord[] = [];
        for (const record of previous) {
          const advanced = advanceRecord(record, tr, newState);
          if (advanced) next.push(advanced);
        }
        return next;
      },
    },
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const records = freeLayoutPluginKey.getState(newState) as AnchorRecord[] | undefined;
      if (!records || records.length === 0) return null;
      return pruneOrphanedFree(newState, records);
    },
    view: (view) => {
      let frame = 0;

      const paint = (): void => {
        // One walk decides the anchors, then each element is painted from the
        // DOM of ITS anchor (never from whatever sibling happens to be there).
        const anchors = new Map(freeLayoutMap(view.state.doc).map((e) => [e.pos, e.anchorPos]));
        const domAt = (pos: number | null): HTMLElement | null => {
          if (pos === null) return null;
          const d = view.nodeDOM(pos);
          return d instanceof HTMLElement ? d : null;
        };
        view.state.doc.forEach((node, offset) => {
          const dom = view.nodeDOM(offset);
          if (!(dom instanceof HTMLElement)) return;
          if (isFreeNode(node)) {
            clearOverlapLayout(dom);
            clearFlowDepth(dom);
            applyFreeLayout(dom, node, domAt(anchors.get(offset) ?? null));
          } else if (isFreeCapable(node) && isOverlap(textConditionOf(node))) {
            // Overlap in the flow: leaves the page flow but keeps its place.
            clearFreeLayout(dom);
            clearFlowDepth(dom);
            applyOverlapLayout(dom, node);
          } else if (isFreeCapable(node)) {
            // In-flow image/figure/box: paint its depth so the Layers order is
            // effective here too (no layout move, only the stacking).
            clearFreeLayout(dom);
            clearOverlapLayout(dom);
            applyFlowDepth(dom, layerLevelOf(node));
          } else {
            clearFreeLayout(dom);
            clearOverlapLayout(dom);
            clearFlowDepth(dom);
          }
        });
      };

      const schedule = (): void => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          paint();
          // The bands live on the painted page: whoever paints the pictures has
          // to say so, or the bands keep the numbers of the previous layout.
          // An event, not a transaction: a paint that dispatched a transaction
          // would schedule the next paint, and that loop has no end.
          window.dispatchEvent(new CustomEvent("aurawrite:free-painted"));
        });
      };

      const onResize = (): void => schedule();
      window.addEventListener("resize", onResize);
      // Self-healing, same idea as the calculator's style probe: when the user
      // changes the document font or the margins from Preferences, the column
      // and the block heights move without any document change.
      const onMetrics = (): void => schedule();
      window.addEventListener("aurawrite:editor-metrics-changed", onMetrics);
      schedule(); // first mount: nothing is measurable during construction

      return {
        update: (editorView, prevState) => {
          // PluginView.update receives the VIEW plus the previous state; the
          // document lives behind editorView.state.
          if (prevState && editorView.state.doc !== prevState.doc) schedule();
        },
        destroy: () => {
          if (frame) cancelAnimationFrame(frame);
          window.removeEventListener("resize", onResize);
          window.removeEventListener("aurawrite:editor-metrics-changed", onMetrics);
        },
      };
    },
  });
}
