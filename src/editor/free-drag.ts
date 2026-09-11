// ============================================================================
// Free drag (F3) — the gesture that MOVES an element. It never changes the
// element's nature (T1.1, 2026-09-11): an element in the flow is only
// reordered among the blocks; a free element follows the pointer. Only an
// explicit command (the Free button) takes an element out of the flow or puts
// it back, exactly as the contract rule wants: "un gesto non cambia la natura
// di un elemento".
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
// The text re-flows while the copy flies, for an element that was already free:
// the band it claims from the lines is rewritten live, without a single
// transaction (free-drag.ts, moveLiveBand). An element that is LEAVING the flow
// in this gesture re-flows when it lands, because until the drop the document
// still believes it is in the line - and a transaction per pointer move would
// flood the undo history for a movement nobody can read.
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
import { refreshFreeWrapBands, setFreeWrapFlightBox } from "./pagination-cassie-plugin";

/** Distance the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

/** Minimum gap between two live band rewrites, in milliseconds. */
const LIVE_BAND_MIN_INTERVAL_MS = 90;

/** Class marking the original of a flying element (see styles.css). */
const FLIGHT_CLASS = "aw-free--flight";

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

  // Sweep whatever a previous interrupted flight left behind, BEFORE reading
  // any geometry: a stale copy would keep floating over the page, and an
  // original still marked as flying would look like a missing image.
  document.querySelectorAll(`.${FLIGHT_CLASS}`).forEach((stale) => stale.classList.remove(FLIGHT_CLASS));
  document.querySelectorAll(".aw-free-ghost, .aw-free-guide").forEach((stale) => stale.remove());

  const originX = event.clientX;
  const originY = event.clientY;
  // Where inside the element the user grabbed: the copy must keep that offset
  // or the element jumps under the pointer at the first move.
  const rect = dom.getBoundingClientRect();
  const grabOffsetX = originX - rect.left;
  const grabOffsetY = originY - rect.top;
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  // F3.2b: an element that is ALREADY free follows the pointer with its text
  // band while it flies. The press records what the band hangs from - the
  // anchor's top, in the editor's own space - so the live rewrite can be
  // derived the same way the drop derives it.
  const wasFreeAtPress = parseFreeSpec(node.attrs?.free) !== null;
  let lastLiveBandAt = 0;

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
  /** Spot INSIDE a paragraph where an in-flow element lands (between lines). */
  let lastTextPos: number | null = null;

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
    // element is about to leave. A class rather than an inline style: a flight
    // interrupted by a release outside the window must be sweepable by the next
    // drag, or the picture stays invisible until the document is re-opened.
    dom.classList.add(FLIGHT_CLASS);
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
    } else {
      anchorIndex = -1;
    }
    // An element IN THE FLOW can land BETWEEN TWO LINES of a paragraph; a free
    // element keeps its free placement. The exact spot is the character under
    // the pointer, mapped by the editor itself (cross-engine safe).
    const precise = wasFreeAtPress ? null : preciseDropPos(view, ev.clientX, ev.clientY);
    lastTextPos = precise?.pos ?? null;
    const guideTop = precise ? precise.lineTop : found ? found.top : null;
    if (guideTop !== null) {
      const line = ensureGuide();
      const col = columnOf(view);
      line.style.left = `${col.viewportLeft}px`;
      line.style.width = `${col.width}px`;
      line.style.top = `${guideTop - 1}px`;
      line.style.display = "block";
    } else if (flight.guide) {
      flight.guide.style.display = "none";
    }
    if (wasFreeAtPress) moveLiveBand(ev.clientX - grabOffsetX, ev.clientY - grabOffsetY);
    // Remember where the copy is, so the release can turn it into distances.
    lastPointerX = ev.clientX;
    lastPointerY = ev.clientY;
  };

  /**
   * Follow the pointer with the text band WITHOUT touching the document.
   *
   * The numbers are not computed here: the plugin that paints the bands is
   * asked to re-measure with the flying box as its input (refreshFreeWrapBands).
   * One measurement, two callers, so the band under the user's hand and the band
   * that lands can never be two different calculations - which is what the
   * rejected delivery got wrong.
   */
  const moveLiveBand = (flyingLeftClient: number, flyingTopClient: number): void => {
    const now = Date.now();
    if (now - lastLiveBandAt < LIVE_BAND_MIN_INTERVAL_MS) return;
    lastLiveBandAt = now;
    // Viewport coordinates on both sides, on purpose: `getBoundingClientRect`
    // (what the band is measured from) and the flying copy live in this space,
    // and the placement uses only the DIFFERENCE between them, so the scroll of
    // `#editor` cancels out. Converting through host offsets plus scrollTop is
    // the trap three coordinate systems set in figure-resize.ts.
    setFreeWrapFlightBox(pos, {
      top: flyingTopClient,
      bottom: flyingTopClient + height,
      left: flyingLeftClient,
      width,
    });
    refreshFreeWrapBands(view);
  };

  let lastPointerX = originX;
  let lastPointerY = originY;

  /** Put the original back and drop the flying copy, once and only once. */
  const endFlight = (): void => {
    setFreeWrapFlightBox(pos, null);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    window.removeEventListener("blur", onBlur);
    flight.ghost?.remove();
    flight.guide?.remove();
    flight.ghost = null;
    flight.guide = null;
    dom.classList.remove(FLIGHT_CLASS);
  };

  /**
   * The pointer went somewhere we will never hear about (another window, a
   * menu, Alt+Tab): cancel the flight without writing anything, so the element
   * keeps the place it had instead of hiding behind a copy nobody released.
   */
  const onBlur = (): void => endFlight();

  const onUp = (ev: MouseEvent): void => {
    endFlight();
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
      textPos: lastTextPos,
    });
    hooks.onDone?.();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  window.addEventListener("blur", onBlur);
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

/**
 * The exact document spot BETWEEN TWO LINES an in-flow element can land on.
 *
 * The pointer chooses a BOUNDARY, never a character: the visual line under the
 * pointer decides, its top half means "before this line" and its bottom half
 * means "after it". The returned `lineTop` is the SAME boundary the insertion
 * uses, so the guide and the landing can never disagree (Carlo's report: with
 * the guide above line 1 the element used to land above line 2).
 *
 * Returns null when the pointer is on a non-paragraph block (image, figure,
 * box, table), on a heading, or between blocks: the drop then falls back to
 * changing which block the element follows. Headings are excluded on purpose:
 * splitting one would produce two headings.
 */
function preciseDropPos(
  view: EditorView,
  clientX: number,
  clientY: number,
): { pos: number; lineTop: number } | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;
  const { doc } = view.state;
  let $pos;
  try {
    $pos = doc.resolve(coords.pos);
  } catch {
    return null;
  }
  if ($pos.depth < 1) return null;
  const block = $pos.node(1);
  if (!block.isTextblock || block.type.name !== "paragraph") return null;
  const blockStart = $pos.before(1);
  const contentStart = blockStart + 1;
  const contentEnd = contentStart + block.content.size;

  const el = view.nodeDOM(blockStart);
  if (!(el instanceof HTMLElement)) return null;
  const rects = lineRects(el);
  if (rects.length === 0) return null;

  const first = rects[0];
  const last = rects[rects.length - 1];
  // Above every line: before the paragraph. Below every line: after it.
  if (clientY < first.top) return { pos: contentStart, lineTop: first.top };
  if (clientY >= last.bottom) return { pos: contentEnd, lineTop: last.bottom };

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (clientY < r.top || clientY >= r.bottom) continue;
    if (clientY < r.top + r.height / 2) {
      // Top half: before this line.
      return { pos: lineStartPos(view, rects, i, contentStart, contentEnd), lineTop: r.top };
    }
    // Bottom half: after this line (the boundary is the next line's top).
    const nextTop = i + 1 < rects.length ? rects[i + 1].top : r.bottom;
    return { pos: lineStartPos(view, rects, i + 1, contentStart, contentEnd), lineTop: nextTop };
  }
  return null;
}

/** The visual lines of a block, one rectangle each (for inline content). */
function lineRects(el: HTMLElement): DOMRect[] {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).filter((r) => r.height > 0.5);
  } catch {
    return [];
  }
}

/** Document position where visual line `index` of a paragraph starts. */
function lineStartPos(
  view: EditorView,
  rects: DOMRect[],
  index: number,
  contentStart: number,
  contentEnd: number,
): number {
  if (index <= 0) return contentStart;
  if (index >= rects.length) return contentEnd;
  const r = rects[index];
  // Ask the editor for the position just inside the line's own left edge, at
  // its vertical middle: the honest way to name a line start from a rectangle.
  const probe = view.posAtCoords({ left: r.left + 1, top: r.top + r.height / 2 });
  if (!probe) return contentStart;
  return Math.max(contentStart, Math.min(contentEnd, probe.pos));
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
  /** Inside a paragraph, the exact spot for a between-lines drop; null for a
   *  block-level move. */
  textPos: number | null;
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

  // The anchor is a TEXT block (contract §2.3). When the pointer sits above
  // every line there is none: -1 (the caller answers by opening a line, and
  // only for an element that is leaving the flow).
  const anchorless = drop.anchorIndex < 0;
  const anchorIndex = anchorless ? -1 : Math.max(0, Math.min(drop.anchorIndex, state.doc.childCount - 1));

  // T1.1: a gesture MOVES an element, it never changes its nature. An element
  // that was in the flow STAYS in the flow: the drop only changes which block
  // it follows, because in flow the order in the document IS the position. The
  // horizontal is the business of Left/Center/Right, not of the pointer. Only
  // an explicit command takes an element out of the flow.
  if (!wasFree) {
    // Between two lines of a paragraph: split it and land the element in
    // between, in one transaction.
    if (drop.textPos !== null) {
      dropInFlowBetweenLines(view, pos, oldEnd, node, drop.textPos);
      return;
    }
    // Otherwise only the block it follows changes.
    const targetIndex = anchorless ? 0 : anchorIndex + 1;
    if (targetIndex !== currentIndex) {
      try {
        const insertPosBefore =
          targetIndex >= state.doc.childCount
            ? state.doc.content.size
            : blockStartPos(view, targetIndex);
        let tr = state.tr.delete(pos, oldEnd);
        // Mapping makes the target right whether the element travelled down or
        // up the document.
        tr = tr.insert(tr.mapping.map(insertPosBefore), node);
        view.dispatch(tr);
      } catch {
        /* the document stays exactly as it was */
      }
    }
    // The caret follows the element's new place, as it does after a free drop.
    focusAnchor(view, anchorless ? 0 : anchorIndex);
    return;
  }

  const host = view.dom as HTMLElement;
  const hostRect = host.getBoundingClientRect();
  const column = textColumn(host);
  const leftInHost = drop.startLeft - hostRect.left;
  const topInHost = drop.startTop - hostRect.top;

  // Carlo's rule for an element leaving the flow with no text block above it:
  // an empty paragraph is opened at the element's own slot and becomes the
  // anchor, in this very transaction - so one undo removes the picture and the
  // line together, and ordinary insertions are never touched.
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

/**
 * Land an in-flow element BETWEEN TWO LINES: split the paragraph at `textPos`
 * and put the element between the two halves, in ONE transaction (one undo).
 * At the very start or end of the paragraph the element simply goes before or
 * after it, so no empty paragraph is ever invented.
 */
function dropInFlowBetweenLines(
  view: EditorView,
  pos: number,
  oldEnd: number,
  node: PMNode,
  textPos: number,
): void {
  const { state } = view;
  try {
    // Remove the element first; the split target is mapped through the
    // deletion so it is right whether the element travelled up or down.
    let tr = state.tr.delete(pos, oldEnd);
    const mapped = tr.mapping.map(textPos);
    const $t = tr.doc.resolve(mapped);
    if ($t.depth < 1) return;
    const blockStart = $t.before(1);
    const block = $t.node(1);
    if (!block.isTextblock || block.type.name !== "paragraph") return;
    const offset = mapped - (blockStart + 1);

    let newPos: number;
    if (offset <= 0) {
      newPos = blockStart;
      tr = tr.insert(blockStart, node);
    } else if (offset >= block.content.size) {
      newPos = blockStart + block.nodeSize;
      tr = tr.insert(newPos, node);
    } else {
      const before = block.type.create(block.attrs, block.content.cut(0, offset), block.marks);
      const after = block.type.create(block.attrs, block.content.cut(offset), block.marks);
      newPos = blockStart + before.nodeSize;
      tr = tr.replaceWith(blockStart, blockStart + block.nodeSize, [before, node, after]);
    }
    try {
      tr = tr.setSelection(NodeSelection.create(tr.doc, newPos));
    } catch {
      /* keep the caret wherever the transaction left it */
    }
    view.dispatch(tr);
  } catch {
    /* the document stays exactly as it was */
  }
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
