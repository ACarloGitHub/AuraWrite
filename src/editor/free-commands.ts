// ============================================================================
// Free-layout commands (F3) — the ONLY way the free state changes.
//
// Contract §4/§5 (revised 2026-09-07):
//  - "Free" takes an element out of the flow; its position is recorded as a
//    distance from the anchor (the block that precedes it), never as a page
//    coordinate, and it lands IN FRONT of the words (Word's behaviour);
//  - "Return to flow" clears the position;
//  - depth lives in a per-page GROUP: each free element is one row of its
//    group, the group's name is a label carried by its members, and reordering
//    happens by dragging rows in the Layers window;
//  - every user gesture is ONE ProseMirror transaction, so one undo undoes
//    exactly what the user did.
//
// The page of an element comes from the SAME calculator that draws the page
// divisions, so groups, screen and print can never disagree (legge dei motori).
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { NodeSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import {
  clampFreeOffset,
  defaultFreeSpec,
  freeLevelAboveText,
  groupNameOf,
  isAnchorBlock,
  isFreeCapable,
  isFreeNode,
  layerLevelOf,
  parseFreeSpec,
  planGroupLevels,
  zLevelOf,
  type FreeSpec,
  type FreeXFrom,
} from "./free-layout";
import { freeElementWidth } from "./free-style";
import { calculatePageBreaks, type FreeGeometry, type PageMargins } from "./pagination-cassie";
import { getMargins } from "./pagination-state";

export interface FreeTarget {
  pos: number;
  node: PMNode;
}

/** One row of a group. */
export interface FreeEntry {
  /** Document position of the element (its identity inside this pass). */
  pos: number;
  label: string;
  level: number;
  /** Name stored on this member (the group's name is `groupNameOf`). */
  name: string;
}

/** A group = the free elements DRAWN on one page (their page comes from the
 * calculator, not from where they sit in the tree). */
export interface FreeGroup {
  page: number;
  name: string;
  entries: FreeEntry[];
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Absolute document position of the top-level child at `index`. */
function topLevelPosOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** Top-level index whose start equals `pos` (-1 when not found). */
function indexOfPos(doc: PMNode, pos: number): number {
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += doc.child(i).nodeSize;
  }
  return -1;
}

/** The top-level block at `index`, or null when out of range. */
function topLevelAt(doc: PMNode, index: number): FreeTarget | null {
  if (index < 0 || index >= doc.childCount) return null;
  return { pos: topLevelPosOf(doc, index), node: doc.child(index) };
}

/** The top-level block containing (or equal to) the selection anchor. */
export function topLevelBlockAt(view: EditorView): FreeTarget | null {
  const { $from } = view.state.selection;
  if ($from.depth === 0) return null;
  return { pos: $from.before(1), node: $from.node(1) };
}

/**
 * The element the free-layout controls act on: a NodeSelected element, the
 * element the cursor sits in, or the element right after the cursor's block.
 */
export function selectedElement(view: EditorView): FreeTarget | null {
  const { state } = view;
  const { selection } = state;
  if (selection instanceof NodeSelection && isFreeCapable(selection.node)) {
    return { pos: selection.from, node: selection.node };
  }
  const block = topLevelBlockAt(view);
  if (!block) return null;
  if (isFreeCapable(block.node)) return block;
  const next = topLevelAt(state.doc, indexOfPos(state.doc, block.pos) + 1);
  return next && isFreeCapable(next.node) ? next : null;
}

function setAttrs(view: EditorView, target: FreeTarget, attrs: Record<string, unknown>): boolean {
  try {
    view.dispatch(view.state.tr.setNodeMarkup(target.pos, undefined, attrs));
    return true;
  } catch {
    return false;
  }
}

/** Keep the element selected after an attribute change (the toolbar stays). */
function reselect(view: EditorView, target: FreeTarget): void {
  if (!view.state.doc.nodeAt(target.pos)) return;
  try {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.pos)));
  } catch {
    /* node types that refuse node-selection keep the previous selection */
  }
}

// ---------------------------------------------------------------------------
// Pages and groups
// ---------------------------------------------------------------------------

/** Page ranges from the live calculator: [{from, to}] in document positions. */
function pageRanges(view: EditorView): { from: number; to: number }[] {
  const { doc } = view.state;
  const margins = getMargins() as PageMargins;
  const { breaks } = calculatePageBreaks(doc, margins);
  const ranges: { from: number; to: number }[] = [];
  let from = 0;
  for (const b of breaks) {
    if (b.pos > from && b.pos < doc.content.size) {
      ranges.push({ from, to: b.pos });
      from = b.pos;
    }
  }
  ranges.push({ from, to: doc.content.size });
  return ranges;
}

/** 1-based page number holding a position, given precomputed ranges. */
function pageFor(pos: number, ranges: { from: number; to: number }[]): number {
  for (let i = 0; i < ranges.length; i++) {
    if (pos >= ranges[i].from && pos < ranges[i].to) return i + 1;
  }
  return ranges.length;
}

/**
 * The rule Carlo set on 2026-09-07: an element leaving the flow needs a text
 * block to hang from, and when the document offers none (an image as the very
 * first block, or a picture dropped above every line) an EMPTY PARAGRAPH is
 * created right before it, inside the same transaction, and becomes its anchor.
 *
 * Scope is deliberately narrow: it fires only in that case. An image inserted
 * between two paragraphs keeps the paragraph above as its anchor and no line is
 * invented, so ordinary writing never sees a stray empty paragraph. The line it
 * does create is a normal paragraph: it holds the page open, undo removes it
 * together with the element, and deleting it takes the element with it.
 *
 * Returns the transaction (with the new paragraph when needed) and the
 * element's position AFTER those steps.
 */
export function ensureAnchorParagraph(
  state: EditorState,
  tr: Transaction,
  pos: number,
): { tr: Transaction; pos: number; created: boolean } {
  let cursor = 0;
  for (let i = 0; i < tr.doc.childCount; i++) {
    const child = tr.doc.child(i);
    if (cursor >= pos) break;
    if (isAnchorBlock(child)) return { tr, pos, created: false };
    cursor += child.nodeSize;
  }
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return { tr, pos, created: false };
  const filler = paragraph.createAndFill() ?? paragraph.create();
  return { tr: tr.insert(pos, filler), pos: pos + filler.nodeSize, created: true };
}

/**
 * One engine pass, everything the layers window needs: which pages exist and
 * which free elements each page draws. The window repaints on every caret move,
 * so asking the calculator twice (once for the caret's page, once for the
 * groups) would double the price of typing while the window is open.
 */
export interface DocumentLayout {
  ranges: { from: number; to: number }[];
  groups: FreeGroup[];
}

export function documentLayout(view: EditorView): DocumentLayout {
  const { doc } = view.state;
  const margins = getMargins() as PageMargins;
  const { breaks, freeGeometry } = calculatePageBreaks(doc, margins);
  const ranges = rangesFrom(breaks, doc.content.size);
  return { ranges, groups: groupsFrom(ranges, freeGeometry, doc) };
}

/** Page ranges out of the engine's cut positions. */
function rangesFrom(breaks: { pos: number }[], size: number): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let from = 0;
  for (const b of breaks) {
    if (b.pos > from && b.pos < size) {
      ranges.push({ from, to: b.pos });
      from = b.pos;
    }
  }
  ranges.push({ from, to: size });
  return ranges;
}

/**
 * Groups bucketed by page, for EVERY free-capable element (Carlo, 2026-09-11):
 * the Layers window serves all images/figures/boxes, not only the free ones.
 * A free element uses the page it is DRAWN on (engine geometry); an in-flow one
 * uses the page of its position.
 */
function groupsFrom(
  ranges: { from: number; to: number }[],
  freeGeometry: FreeGeometry[],
  doc: PMNode,
): FreeGroup[] {
  const drawnPage = new Map<number, number>();
  for (const geo of freeGeometry) drawnPage.set(geo.pos, geo.page);
  const byPage = new Map<number, FreeEntry[]>();
  let cursor = 0;
  doc.forEach((node) => {
    if (isFreeCapable(node)) {
      const page = drawnPage.get(cursor) ?? pageFor(cursor, ranges);
      const list = byPage.get(page) ?? [];
      list.push({
        pos: cursor,
        label: elementLabel(node),
        level: layerLevelOf(node),
        name: parseFreeSpec(node.attrs?.free)?.g ?? "",
      });
      byPage.set(page, list);
    }
    cursor += node.nodeSize;
  });
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, entries]) => {
      const distinct = labelWithDedup(entries);
      return { page, name: groupNameOf(distinct), entries: distinct };
    });
}

/** Name already used by the group on the page holding `pos` ("" = new group). */
function groupNameForPosition(view: EditorView, pos: number, ranges: { from: number; to: number }[]): string {
  const page = pageFor(pos, ranges);
  let cursor = 0;
  let found = "";
  view.state.doc.forEach((node) => {
    if (!found && isFreeNode(node) && pageFor(cursor, ranges) === page) {
      found = parseFreeSpec(node.attrs?.free)?.g ?? "";
    }
    cursor += node.nodeSize;
  });
  return found;
}

/** Page number under the caret (0 when the caret is not in a block). */
export function caretPage(view: EditorView, ranges?: { from: number; to: number }[]): number {
  const block = topLevelBlockAt(view);
  if (!block) return 0;
  return pageFor(block.pos, ranges ?? pageRanges(view));
}

/**
 * Every group of the document, bucketed by the page each element is DRAWN on.
 *
 * The page and the depth numbers come from the pagination engine itself: an
 * element dropped into the white space under the last line of page 2 is painted
 * on page 3, so it must be listed - and covered - as page 3. Deriving the group
 * from the element's place in the tree was the first version, and it made the
 * window disagree with the eye.
 */
export function collectGroups(view: EditorView): FreeGroup[] {
  return documentLayout(view).groups;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Take the element out of the flow. Its position starts at the reference edge
 * of the column with zero offsets - which is where it already is on screen, so
 * becoming free never makes it jump - and in front of the words. The rendered
 * width is recorded in the same transaction because an absolutely positioned
 * box would otherwise shrink to its content.
 */
export function freeElement(view: EditorView, spec?: Partial<FreeSpec>): boolean {
  const target = selectedElement(view);
  if (!target || isFreeNode(target.node)) return false;
  // One engine pass: the page ranges decide which group the element joins.
  const ranges = documentLayout(view).ranges;
  const next: FreeSpec = {
    ...defaultFreeSpec(groupNameForPosition(view, target.pos, ranges)),
    ...parseFreeSpec(target.node.attrs?.free),
    ...spec,
  };
  const attrs: Record<string, unknown> = {
    ...target.node.attrs,
    free: next,
    zLevel: freeLevelAboveText(),
  };
  const measured = renderedWidthOf(view, target);
  if (measured !== null && freeElementWidth(target.node) === null) {
    if (target.node.type.name === "styled_box") attrs.widthPx = measured;
    else attrs.width = measured;
  }
  // One transaction: the anchor line (when the document had none) and the
  // element's new state, so a single undo gives back the previous document.
  try {
    let tr = view.state.tr;
    const anchored = ensureAnchorParagraph(view.state, tr, target.pos);
    tr = anchored.tr;
    const node = tr.doc.nodeAt(anchored.pos);
    if (!node) return false;
    tr = tr.setNodeMarkup(anchored.pos, undefined, { ...node.attrs, ...attrs });
    view.dispatch(tr);
    reselect(view, { pos: anchored.pos, node });
    return true;
  } catch {
    return false;
  }
}

/** The element's own width on screen right now (null when it cannot be seen). */
function renderedWidthOf(view: EditorView, target: FreeTarget): number | null {
  const dom = view.nodeDOM(target.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const w = Math.round(dom.offsetWidth);
  return w > 0 ? w : null;
}

/** Put the element back in the flow: the saved distances are cleared (§4). */
export function returnElementToFlow(view: EditorView): boolean {
  const target = selectedElement(view);
  if (!target || !isFreeNode(target.node)) return false;
  const ok = setAttrs(view, target, { ...target.node.attrs, free: null });
  if (ok) reselect(view, target);
  return ok;
}

/** Toggle helper for the element's secondary toolbar. */
export function toggleElementFree(view: EditorView): boolean {
  const target = selectedElement(view);
  if (!target) return false;
  return isFreeNode(target.node) ? returnElementToFlow(view) : freeElement(view);
}

/**
 * Set the free position in one step - the release of a canvas drag. The page
 * guide and the anchor follow from the element's place in the tree, so the
 * caller moves the node first and writes the numbers here (contract §5).
 */
export function setFreePosition(
  view: EditorView,
  part: { xFrom?: FreeXFrom; xOff?: number; yOff?: number },
): boolean {
  const target = selectedElement(view);
  if (!target || !isFreeNode(target.node)) return false;
  const current = parseFreeSpec(target.node.attrs?.free) ?? defaultFreeSpec();
  const next: FreeSpec = {
    ...current,
    xFrom: part.xFrom ?? current.xFrom,
    xOff: part.xOff !== undefined ? clampFreeOffset(part.xOff) : current.xOff,
    yOff: part.yOff !== undefined ? clampFreeOffset(part.yOff) : current.yOff,
  };
  return setAttrs(view, target, { ...target.node.attrs, free: next });
}

/**
 * Rename a group: the label lives on its members, so this writes them all in
 * ONE transaction (one undo, one result - contract §5).
 */
export function renameGroup(view: EditorView, group: FreeGroup, name: string): boolean {
  const clean = name.slice(0, 120);
  let tr = view.state.tr;
  let applied = 0;
  for (const entry of group.entries) {
    const node = view.state.doc.nodeAt(entry.pos);
    const spec = node ? parseFreeSpec(node.attrs?.free) : null;
    if (!node || !spec || spec.g === clean) continue;
    tr = tr.setNodeMarkup(entry.pos, undefined, { ...node.attrs, free: { ...spec, g: clean } });
    applied++;
  }
  if (applied === 0) return false;
  view.dispatch(tr);
  return true;
}

/**
 * Apply a new row order to a group (the Layers window finished a drag).
 * `orderedPositions` is topmost row first and `textRow` is where the fixed
 * text row sits in that order; the numbers are derived from them (contract
 * §3.4-§3.5).
 */
export function setGroupOrder(
  view: EditorView,
  group: FreeGroup,
  orderedPositions: number[],
  textRow: number,
): boolean {
  const levels = planGroupLevels(orderedPositions.length, textRow);
  let tr = view.state.tr;
  let applied = 0;
  for (let i = 0; i < orderedPositions.length; i++) {
    const pos = orderedPositions[i];
    const node = view.state.doc.nodeAt(pos);
    if (!node || !isFreeCapable(node)) continue;
    if (zLevelOf(node) === levels[i]) continue;
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, zLevel: levels[i] });
    applied++;
  }
  if (applied === 0) return false;
  view.dispatch(tr);
  return true;
}

/**
 * Name the panel shows for an element. The user reads a LIST, so the name must
 * tell the rows apart: the caption wins (it is the author's own words), then
 * the file name the reader remembers, then the type alone.
 *
 * The stored path is `images/<stamp>-<original name>` (see save_image_to_assets
 * in src-tauri/src/lib.rs), so the original name is recoverable from it; the
 * `alt`/`title` attributes carry it too, and are preferred when present.
 */
export function elementLabel(node: PMNode): string {
  const kind = kindName(node);
  const caption = node.textContent.trim();
  if (node.type.name === "image") {
    const own = String(node.attrs.caption ?? "").trim();
    if (own) return `${kind}: ${truncate(own)}`;
  } else if (caption) {
    // Figures and boxes are named by the text they hold (their caption/note).
    return `${kind}: ${truncate(caption)}`;
  }
  const alt = String(node.attrs.alt ?? "").trim() || String(node.attrs.title ?? "").trim();
  const candidate = alt || originalNameOf(String(node.attrs.src ?? ""));
  // A name that is a hex digest or a machine id tells the writer nothing: those
  // images are numbered instead (Carlo's request: "il nome del file, o almeno
  // essere numerate").
  const fromFile = readableName(candidate);
  return fromFile ? `${kind}: ${truncate(fromFile)}` : kind;
}

/** The name only when a human could recognise it. */
function readableName(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  if (/^[0-9a-f]{12,}$/i.test(clean)) return ""; // content digest
  if (/^\d{9,}$/.test(clean)) return ""; // bare timestamp
  if (/^(blob|data|ocr-result|image)$/i.test(clean)) return "";
  return clean;
}

/** The word the list shows for the element kind. */
function kindName(node: PMNode): string {
  switch (node.type.name) {
    case "figure":
      return "Figure";
    case "styled_box":
      return "Box";
    default:
      return "Image";
  }
}

/** `images/1723-My Photo.png` -> `My Photo`; empty when there is no real name. */
export function originalNameOf(src: string): string {
  if (!src) return "";
  const clean = src.split(/[?#]/)[0];
  // Both separators: the stored path is relative with forward slashes, but a
  // local absolute path can arrive with backslashes (Windows).
  const base = clean.split(/[/\\]+/).filter(Boolean).pop() ?? "";
  const withoutStamp = base.replace(/^\d{9,}-/, "");
  const stem = withoutStamp.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  if (!stem) return "";
  let decoded = stem;
  try {
    decoded = decodeURIComponent(stem);
  } catch {
    decoded = stem;
  }
  return decoded.replace(/[_-]+/g, " ").trim();
}

/**
 * Make the rows of one group distinguishable. Named elements repeat with a
 * counter ("Cover", "Cover 2"); nameless ones are numbered from the start
 * ("Image 1", "Image 2"), because a list reading "Image, Image, Image" is the
 * defect reported at the review.
 */
export function labelWithDedup(entries: FreeEntry[]): FreeEntry[] {
  const kindCount = new Map<string, number>();
  const seen = new Map<string, number>();
  const kinds = new Set(["Image", "Figure", "Box"]);
  return entries.map((entry) => {
    if (kinds.has(entry.label)) {
      const n = (kindCount.get(entry.label) ?? 0) + 1;
      kindCount.set(entry.label, n);
      return { ...entry, label: `${entry.label} ${n}` };
    }
    const times = (seen.get(entry.label) ?? 0) + 1;
    seen.set(entry.label, times);
    return times === 1 ? entry : { ...entry, label: `${entry.label} ${times}` };
  });
}

function truncate(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 38 ? `${clean.slice(0, 38)}…` : clean;
}
