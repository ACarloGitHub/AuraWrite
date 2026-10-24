// ============================================================================
// Free-anchor page rule (F3.2d) — a picture and the text it hangs from have to
// live on the SAME page.
//
// NOT INVOKED SINCE 2026-10-24. Kept as a reference, not as behaviour: the
// module is no longer imported by anything. It used to run 900 ms after every
// paint and, on a picture straddling two pages, it moved the node in the
// document and rewrote the distance every single time - a second rule writing
// the position the drop had just decided, which re-flowed the text and changed
// the wrap a couple of seconds after the release (Carlo, 24-10). The print
// sheets no longer need the anchor to live on the same sheet: when it is not
// there they fall back to the written position (print-preview-mode.ts).
// Re-enabling this module means re-enabling that competition; read
// wiki/todo/_priorita-1.md first.
//
// Why this is a rule and not a preference: the print sheet rebuilds the editor's
// page by finding the anchor block ON THE SHEET and measuring the picture from
// it (see `print-preview-mode.ts`). A picture that slid into the page below its
// anchor has no anchor in that sheet, so there is nothing to measure from, and
// the only number left is the one the page calculator guessed - which is how a
// copy ended up a whole page off (measured 17-09, C01: 1200px).
//
// HOW the anchor becomes another block. The anchor is NOT stored: it is read
// from the document order (the last text block before the picture -
// `freeLayoutMap`). That is also why deleting the anchor line kills the picture
// with it. So the only way to hang a picture from a LATER block is to move the
// picture's own block after it, which is precisely what the drag already does
// when the user drops a picture onto another paragraph (`free-drag.ts` deletes
// and re-inserts it after the block that receives it). This module applies the
// same move, automatically, and keeps the picture exactly where it is: the
// distance below the new line is rewritten from the position the picture is
// painted at, so no pixel moves.
//
// When it runs: never while the user is writing or dragging. The caller arms a
// timer after the last repaint, and one element is settled per pass - the
// transaction that moves one repaints, which re-arms the check for the next.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { freeLayoutMap, isAnchorBlock, isFreeNode, parseFreeSpec } from "./free-layout";
import { appliedScale } from "./editor-zoom";

/** Meta marker: this transaction is the program moving a picture, not the user. */
export const FREE_ANCHOR_MOVE_META = "aw-free-anchor-move";

/** One pending move: which picture, onto which line, at what distance. */
export interface AnchorMove {
  /** Start of the free element in the document. */
  elementPos: number;
  /** Start of the block that must become its anchor. */
  newAnchorPos: number;
  /** Pixels below that block's top edge where the picture is PAINTED now. */
  newYOff: number;
  /** The picture's painted middle and the page it is on, for the report. */
  drawnTop: number;
  fromPage: number;
  toPage: number;
}

/** The editor's page separators, as tops in the host's own layout units. */
function separatorTops(view: EditorView, toLayoutTop: (el: HTMLElement) => number): number[] {
  const host = view.dom as HTMLElement;
  const tops: number[] = [];
  host.querySelectorAll<HTMLElement>(".aw-page-break").forEach((widget) => {
    // The widget draws both pages' margins: the boundary is its separator line,
    // not its box. Without a line (older markup) fall back to the box top.
    const line = widget.querySelector<HTMLElement>(".aw-page-break-separator, .aw-page-break-line");
    tops.push(toLayoutTop(line ?? widget));
  });
  return tops.sort((a, b) => a - b);
}

/**
 * The first picture that is drawn on a page other than its anchor's, or null
 * when every picture already hangs from a line of its own page.
 *
 * The page of a picture is the page holding its MIDDLE - the same rule the page
 * calculator uses, so the two surfaces cannot mean two different things by
 * "which page is this on".
 */
export function planAnchorMove(view: EditorView): AnchorMove | null {
  const host = view.dom as HTMLElement;
  const scale = appliedScale(host) || 1;
  const hostTop = host.getBoundingClientRect().top;
  const layoutTop = (el: HTMLElement): number => (el.getBoundingClientRect().top - hostTop) / scale;

  const seps = separatorTops(view, layoutTop);
  if (seps.length === 0) return null; // continuous mode: the whole document is one page
  const pageOf = (top: number): number => {
    let page = 0;
    for (const s of seps) {
      if (s <= top) page++;
      else break;
    }
    return page;
  };

  const domAt = (pos: number): HTMLElement | null => {
    const d = view.nodeDOM(pos);
    return d instanceof HTMLElement ? d : null;
  };

  // Text blocks that can hold an anchor, in document order, with their page.
  const lines: { pos: number; top: number; page: number }[] = [];
  view.state.doc.forEach((node, offset) => {
    if (!isAnchorBlock(node)) return;
    const el = domAt(offset);
    if (!el) return;
    const top = layoutTop(el);
    lines.push({ pos: offset, top, page: pageOf(top) });
  });
  if (lines.length === 0) return null;

  for (const entry of freeLayoutMap(view.state.doc)) {
    if (entry.anchorPos === null) continue;
    const node = view.state.doc.nodeAt(entry.pos);
    if (!node || !isFreeNode(node)) continue;
    const spec = parseFreeSpec(node.attrs?.free);
    if (!spec) continue;
    const picture = domAt(entry.pos);
    const anchor = lines.find((l) => l.pos === entry.anchorPos);
    if (!picture || !anchor) continue;

    const drawnTop = layoutTop(picture);
    const page = pageOf(drawnTop + picture.offsetHeight / 2);
    if (page === anchor.page) continue;

    // The rule: the FIRST text line of the page the picture is drawn on. When
    // that page holds no text at all there is nothing to hang it from, and the
    // picture keeps its anchor: the print falls back to the written number.
    const target = lines.find((l) => l.page === page);
    if (!target || target.pos === anchor.pos) continue;

    return {
      elementPos: entry.pos,
      newAnchorPos: target.pos,
      newYOff: Math.round(drawnTop - target.top),
      drawnTop: Math.round(drawnTop),
      fromPage: anchor.page,
      toPage: page,
    };
  }
  return null;
}

/**
 * Move the picture's block right after its new anchor line and rewrite the
 * distance, so the painted position is the one it already had.
 *
 * `addToHistory: false`: the user did not ask for this edit, and Ctrl+Z has to
 * keep undoing what they did do. The move is marked with its own meta so the
 * settle rule can tell its own writes from the user's.
 */
export function applyAnchorMove(view: EditorView, move: AnchorMove): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(move.elementPos);
  const spec = node ? parseFreeSpec(node.attrs?.free) : null;
  const anchorBlock = state.doc.nodeAt(move.newAnchorPos);
  if (!node || !spec || !anchorBlock) return false;

  const insertAt = move.newAnchorPos + anchorBlock.nodeSize; // directly after the new line
  let tr = state.tr.delete(move.elementPos, move.elementPos + node.nodeSize);
  const target = tr.mapping.map(insertAt);
  const moved = node.type.create(
    { ...node.attrs, free: { ...spec, yOff: move.newYOff } },
    node.content,
    node.marks,
  );
  tr = tr.insert(target, moved).setMeta("addToHistory", false).setMeta(FREE_ANCHOR_MOVE_META, true);
  // Keep the element under its own toolbar if it was the selected thing.
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.from === move.elementPos) {
    try {
      tr = tr.setSelection(NodeSelection.create(tr.doc, target));
    } catch {
      /* the move stands even if the selection cannot follow it */
    }
  }
  view.dispatch(tr);
  return true;
}
