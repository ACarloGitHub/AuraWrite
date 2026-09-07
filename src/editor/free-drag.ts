// ============================================================================
// Free drag (F3) — the gesture that takes an element out of the flow, and the
// one that moves it once it is free.
//
// Contract §4 ("Trascinare", "Rilasciare", "Dopo"), revised 2026-09-07: the
// first delivery of this feature had no gesture at all, and Carlo stopped the
// review there. This file is the behaviour he was promised:
//
//  - the element follows the pointer with TOTAL precision and stops exactly
//    where it is released (no snapping: §2.8, snap stays an off option);
//  - during the flight the original is hidden and a transparent copy of the
//    SAME size follows the pointer, which is how the styled box already moves
//    in the flow: one idiom, not two;
//  - the anchor is the block the pointer is over, shown by a thin guide line,
//    and the node is repositioned in the tree right after it on release;
//  - the position is stored as distances from that anchor (xFrom + xOff from
//    the column edges, yOff from its top), never as a page coordinate;
//  - the move of the node AND its new distances are ONE transaction, so one
//    undo gives back exactly what the user had.
//
// The text does not re-flow while the copy flies: free elements start shortening
// lines in the next step (contract §9.2), and dispatching a transaction per
// pointer move would flood the undo history for a movement nobody can read.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import {
  clampFreeOffset,
  freeLeftPx,
  freeLevelAboveText,
  parseFreeSpec,
  type FreeSpec,
  type FreeXFrom,
} from "./free-layout";
import { ensureAnchorParagraph } from "./free-commands";
import { freeElementWidth, textColumn } from "./free-style";

/** Distance the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

export interface FreeDragHooks {
  /** Called after the drop so the panel and the toolbar can refresh. */
  onDone?: () => void;
}

/**
 * Start a possible drag of the element rendered by `dom`. Returns true when the
 * press turned into a drag (the caller must then not treat it as a click).
 */
export function startFreeDrag(
  view: EditorView,
  getPos: () => number | undefined,
  dom: HTMLElement,
  event: MouseEvent,
  hooks: FreeDragHooks = {},
): boolean {
  const pos = getPos();
  if (pos === undefined) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;

  const originX = event.clientX;
  const originY = event.clientY;
  // Where inside the element the user grabbed: the copy must keep that offset
  // or the element jumps under the pointer at the first move.
  const rect = dom.getBoundingClientRect();
  const grabOffsetX = originX - rect.left;
  const grabOffsetY = originY - rect.top;
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  let dragging = false;
  // Held in an object on purpose: the elements are created inside the pointer
  // handlers, and TypeScript narrows plain locals to `null` when it cannot see
  // the assignment on the path (it did, and the cleanup became dead code).
  const flight: { ghost: HTMLElement | null; guide: HTMLElement | null } = {
    ghost: null,
    guide: null,
  };
  let anchorTopClient = rect.top;
  let anchorIndex = -1;

  const ensureGhost = (): HTMLElement => {
    if (flight.ghost) return flight.ghost;
    const g = dom.cloneNode(true) as HTMLElement;
    g.classList.remove("aw-box--selected", "image-node-wrapper--selected", "aw-figure--selected");
    g.classList.add("aw-free-ghost");
    g.style.position = "fixed";
    g.style.left = "0px";
    g.style.top = "0px";
    g.style.width = `${width}px`;
    g.style.height = `${height}px`;
    g.style.margin = "0";
    g.style.pointerEvents = "none";
    g.style.zIndex = "1200";
    g.style.opacity = "0.75";
    document.body.appendChild(g);
    // The original hides during the flight, so the words show the space the
    // element is about to leave.
    dom.style.visibility = "hidden";
    flight.ghost = g;
    return g;
  };

  const ensureGuide = (): HTMLElement => {
    if (flight.guide) return flight.guide;
    const g = document.createElement("div");
    g.className = "aw-free-guide";
    document.body.appendChild(g);
    flight.guide = g;
    return g;
  };

  const onMove = (ev: MouseEvent): void => {
    if (!dragging) {
      if (Math.abs(ev.clientX - originX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - originY) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      // Select the element first: the toolbar and the panel follow the same
      // thing the pointer holds.
      selectElement(view, pos);
      ensureGhost();
    }
    const g = ensureGhost();
    g.style.transform = `translate(${Math.round(ev.clientX - grabOffsetX)}px, ${Math.round(ev.clientY - grabOffsetY)}px)`;

    // The anchor is the TEXT block under the pointer (contract §4): asking the
    // editor itself keeps margins, decorations and re-flowing honest.
    const found = findAnchorAt(view, ev.clientY);
    if (found) {
      anchorIndex = found.index;
      anchorTopClient = found.top;
      const line = ensureGuide();
      const col = columnOf(view);
      line.style.left = `${col.viewportLeft}px`;
      line.style.width = `${col.width}px`;
      line.style.top = `${found.top - 1}px`;
      line.style.display = "block";
    } else {
      anchorIndex = -1;
      if (flight.guide) flight.guide.style.display = "none";
    }
    // Remember where the copy is, so the release can turn it into distances.
    lastPointerX = ev.clientX;
    lastPointerY = ev.clientY;
  };

  let lastPointerX = originX;
  let lastPointerY = originY;

  const onUp = (ev: MouseEvent): void => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    flight.ghost?.remove();
    flight.guide?.remove();
    dom.style.visibility = "";
    if (!dragging) return;

    lastPointerX = ev.clientX;
    lastPointerY = ev.clientY;
    const startTop = Math.round(lastPointerY - grabOffsetY);
    const startLeft = Math.round(lastPointerX - grabOffsetX);
    applyDrop(view, getPos, {
      width,
      startLeft,
      startTop,
      // Where the element itself sat when the press began: the reference used
      // when the drop has no text block above it and a line must be opened.
      pressTopClient: rect.top,
      anchorTopClient,
      anchorIndex,
    });
    hooks.onDone?.();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  // The press is consumed: the browser must not start a native image drag.
  return true;
}

// ---------------------------------------------------------------------------
// Geometry helpers (the same formulas as free-layout.ts, fed by the DOM)
// ---------------------------------------------------------------------------

/** Column of the editor, in viewport coordinates. */
function columnOf(view: EditorView): { viewportLeft: number; width: number } {
  const host = view.dom;
  const rect = host.getBoundingClientRect();
  const cs = getComputedStyle(host);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  return {
    viewportLeft: rect.left + padLeft + host.scrollLeft,
    width: Math.max(1, host.clientWidth - padLeft - padRight),
  };
}

function blockStartPos(view: EditorView, index: number): number {
  let pos = 0;
  for (let i = 0; i < index && i < view.state.doc.childCount; i++) {
    pos += view.state.doc.child(i).nodeSize;
  }
  return pos;
}

/**
 * The TEXT block the pointer is over, with its viewport top.
 *
 * Only paragraphs and headings qualify (contract §2.3: the anchor is a
 * paragraph, and an empty line is still a paragraph). Pictures, figures, boxes,
 * lists and tables are skipped: hanging one element off another would measure
 * distances from a moving box, and deleting the first would teleport the
 * second. Returning null is meaningful too - it is the case the program answers
 * by opening an anchor line (see free-commands.ensureAnchorParagraph).
 */
function findAnchorAt(
  view: EditorView,
  clientY: number,
): { index: number; top: number } | null {
  const blocks = topLevelAnchors(view);
  if (blocks.length === 0) return null;
  const first = blocks[0].el.getBoundingClientRect();
  if (clientY < first.top) return null; // above every line: no anchor yet
  for (let i = blocks.length - 1; i >= 0; i--) {
    const r = blocks[i].el.getBoundingClientRect();
    if (clientY >= r.top) return { index: blocks[i].index, top: r.top };
  }
  return null;
}

/** Paragraphs and headings in the editor, with their top-level node index. */
function topLevelAnchors(view: EditorView): { index: number; el: HTMLElement }[] {
  const out: { index: number; el: HTMLElement }[] = [];
  let index = 0;
  let child = view.dom.firstElementChild;
  while (child) {
    if (!child.matches(FREE_DRAG_SKIP_SELECTOR)) {
      if (child.matches(ANCHOR_ELEMENT_SELECTOR)) out.push({ index, el: child as HTMLElement });
      index++;
    }
    child = child.nextElementSibling;
  }
  return out;
}

/** Decoration widgets the pagination plugin inserts between blocks. */
const FREE_DRAG_SKIP_SELECTOR = ".aw-page-break, .page-break-widget, [data-page]";

/** The elements a text block can be: the only blocks that anchor anything. */
const ANCHOR_ELEMENT_SELECTOR = "p, h1, h2, h3, h4, h5, h6";

// ---------------------------------------------------------------------------
// The drop
// ---------------------------------------------------------------------------

function selectElement(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  try {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  } catch {
    /* node types that refuse node-selection keep the caret where it is */
  }
}

interface DropInfo {
  width: number;
  /** Viewport coordinates of the released box. */
  startLeft: number;
  startTop: number;
  /** Viewport top of the element when the press began. */
  pressTopClient: number;
  anchorTopClient: number;
  /** -1 when the pointer sits above every text block (no anchor exists). */
  anchorIndex: number;
}

/**
 * Write the drop: the node moves right after its new anchor and receives the
 * distances from it, in ONE transaction. A block element that was still in the
 * flow becomes free here (contract §9.1: the same gesture that places it also
 * takes it out of the line).
 *
 * All coordinates are converted to the editor's own space (the one
 * free-style.ts paints in, i.e. offsets inside the scrollable content) before
 * any distance is computed: viewport coordinates are only used to follow the
 * pointer and to draw the guide.
 */
function applyDrop(view: EditorView, getPos: () => number | undefined, drop: DropInfo): void {
  const pos = getPos();
  if (pos === undefined) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const { state } = view;
  const oldEnd = pos + node.nodeSize;
  const currentIndex = indexOfPos(view, pos);
  const wasFree = parseFreeSpec(node.attrs?.free) !== null;

  const host = view.dom as HTMLElement;
  const hostRect = host.getBoundingClientRect();
  const column = textColumn(host);
  const leftInHost = drop.startLeft - hostRect.left;
  const topInHost = drop.startTop - hostRect.top;

  // The anchor is a TEXT block (contract §2.3). When the pointer sits above
  // every line there is none, and Carlo's rule applies: an empty paragraph is
  // opened at the element's own slot and becomes the anchor, in this very
  // transaction - so one undo removes the picture and the line together, and
  // ordinary insertions are never touched.
  const anchorless = drop.anchorIndex < 0;
  const anchorIndex = anchorless ? -1 : Math.max(0, Math.min(drop.anchorIndex, state.doc.childCount - 1));
  const anchorTopInHost = anchorless
    ? drop.pressTopClient - hostRect.top // the new line takes the element's old slot
    : drop.anchorTopClient - hostRect.top;
  const yOff = Math.round(topInHost - anchorTopInHost);

  const spec = distanceSpec(column, leftInHost, drop.width, yOff, node, wasFree);
  const attrs: Record<string, unknown> = {
    ...node.attrs,
    free: spec,
    // A freshly freed element lands in front of the words (Word's default);
    // one that was already free keeps the depth the user gave it.
    zLevel: wasFree ? (node.attrs?.zLevel ?? freeLevelAboveText()) : freeLevelAboveText(),
  };
  // A box without an explicit width would collapse once it leaves the column,
  // so the size it had on screen is recorded (contract §5).
  if (freeElementWidth(node) === null) {
    if (node.type.name === "styled_box") attrs.widthPx = drop.width;
    else attrs.width = drop.width;
  }

  let tr = state.tr;
  let caretAnchorIndex = anchorIndex;
  try {
    if (anchorless) {
      // The same single rule the menu command uses, imported instead of written
      // twice: open the anchor line, then free the element that now hangs from
      // it. Positions are computed before any mutation - the line goes at
      // `pos`, the element follows it at `pos + line size` - so no mapping
      // arithmetic is needed here and none can go stale.
      const anchored = ensureAnchorParagraph(state, tr, pos);
      if (!anchored.created) return;
      tr = anchored.tr.setNodeMarkup(anchored.pos, undefined, attrs);
      caretAnchorIndex = currentIndex; // the new line took the element's old slot
    } else if (anchorIndex + 1 !== currentIndex) {
      const anchor = state.doc.child(anchorIndex);
      const anchorEndPos = blockStartPos(view, anchorIndex) + anchor.nodeSize;
      const newNode = node.type.create(attrs, node.content, node.marks);
      tr = tr.delete(pos, oldEnd);
      // Mapping makes the target right whether the element travelled down or
      // up the document.
      tr = tr.insert(tr.mapping.map(anchorEndPos), newNode);
    } else {
      tr = tr.setNodeMarkup(pos, undefined, attrs);
    }
  } catch {
    return;
  }
  view.dispatch(tr);
  // The caret goes to the anchor's text: the writer keeps typing where the
  // element now hangs, instead of losing the selection on a moving node.
  focusAnchor(view, caretAnchorIndex);
}

/** Top-level index whose start equals `pos`. */
function indexOfPos(view: EditorView, pos: number): number {
  let cursor = 0;
  for (let i = 0; i < view.state.doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += view.state.doc.child(i).nodeSize;
  }
  return 0;
}

/** Put the caret in the anchor block (no-op when the anchor is an element). */
function focusAnchor(view: EditorView, anchorIndex: number): void {
  const doc = view.state.doc;
  if (anchorIndex < 0 || anchorIndex >= doc.childCount) return;
  const node = doc.child(anchorIndex);
  if (!node.isTextblock) return;
  const pos = blockStartPos(view, anchorIndex) + 1;
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    view.focus();
  } catch {
    /* keep the drop even if the caret cannot be placed */
  }
}

/**
 * Convert a released left edge into `xFrom` + `xOff`: the nearest third of the
 * column decides the reference edge, so the element reads the way the writer
 * placed it (contract §4: "pixel a sinistra, destra o centro").
 */
function distanceSpec(
  column: { left: number; width: number },
  releasedLeftInHost: number,
  elementWidth: number,
  yOff: number,
  node: PMNode,
  wasFree: boolean,
): FreeSpec {
  const previous = wasFree ? parseFreeSpec(node.attrs?.free) : null;
  const rel = releasedLeftInHost - column.left;
  const centre = rel + elementWidth / 2;
  const thirds = column.width / 3;
  let xFrom: FreeXFrom = "left";
  if (centre < thirds) xFrom = "left";
  else if (centre > column.width - thirds) xFrom = "right";
  else xFrom = "center";

  const base = freeLeftPx(column, { xFrom, xOff: 0, yOff: 0, g: "" }, elementWidth);
  return {
    xFrom,
    xOff: clampFreeOffset(releasedLeftInHost - base),
    yOff: clampFreeOffset(yOff),
    g: previous?.g ?? "",
  };
}
