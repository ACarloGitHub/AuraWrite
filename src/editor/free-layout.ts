// ============================================================================
// Free layout (F3) — the data model of "distribuzione libera".
//
// A top-level element (image, figure, styled box) may leave the text flow:
// `free` then holds its position RELATIVE TO ITS ANCHOR, never an absolute
// page coordinate (legge dei motori: [[concepts/editor-enrichment-plan]]).
// The anchor is the block that precedes the node in the document, so no
// invisible marker is ever written into the text (contract §5).
//
// DEPTH (contract §3, revised 2026-09-07 after the rejected delivery):
//  - the text has ONE fixed level for the whole document: `TEXT_Z`. It is a
//    constant, not data: paragraphs and headings carry no depth attribute;
//  - depth is LOCAL TO THE PAGE. Free elements form a group per page and each
//    element is one level inside that group. Two elements on different pages
//    never overlap, so their numbers never need to be compared: a 300-page
//    book cannot produce a 900-row stack;
//  - numbers are a consequence of the row order in the Layers window: never
//    shown, never typed;
//  - a group is not a stored object: it exists while its elements exist, and
//    its name is derived from the first member in document order (see
//    `groupNameOf`), so an element that flows onto another page needs no
//    migration at all.
//
// This module has no DOM and no ProseMirror instances: pure functions, so the
// rules (validation, column geometry, group numbering) are probeable on their
// own and reusable by the print path (F3.2).
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

/** Which edge of the text column the horizontal offset is measured from. */
export type FreeXFrom = "left" | "center" | "right";

/** Position of a free element, always relative to its anchor block. */
export interface FreeSpec {
  xFrom: FreeXFrom;
  /** px from the xFrom reference edge (positive to the right). */
  xOff: number;
  /** px below the top of the anchor block. */
  yOff: number;
  /** Name of the group this element belongs to ("" = unnamed). */
  g: string;
}

/** Nodes that can leave the flow. Text blocks cannot: they have no depth data. */
export const FREE_CAPABLE_TYPES: readonly string[] = ["image", "figure", "styled_box"];

/**
 * Blocks an element can hang from: the text itself. Contract §2.3 makes the
 * anchor a paragraph (empty lines included). An element is never an anchor:
 * chaining pictures would measure one picture from another, so deleting the
 * first would teleport the second. Tables, lists and code blocks are not text
 * either, and never hold a floating element.
 */
export const ANCHOR_BLOCK_TYPES: readonly string[] = ["paragraph", "heading"];

export const LEVEL_MIN = 1;
/** In-flow elements carry the default; it has no effect until they are free. */
export const LEVEL_DEFAULT = 1;
/**
 * The text's fixed depth, contract §3.1 (rev. 2026-09-07). High and isolated
 * on purpose: the stack has room both below (behind the words) and above
 * (in front of them), and no element may ever sit exactly on it.
 */
export const TEXT_Z = 1000;

/** Upper bound for stored offsets: beyond this a value is certainly a mistake. */
export const FREE_OFFSET_MAX = 20000;

const X_FROMS: readonly FreeXFrom[] = ["left", "center", "right"];

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Normalise whatever is stored in the `free` attribute. Anything unusable
 * becomes null (= in flow), so a half-written or imported value can never
 * leave an element floating at an undefined position.
 */
export function parseFreeSpec(value: unknown): FreeSpec | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const xFrom = X_FROMS.includes(raw.xFrom as FreeXFrom) ? (raw.xFrom as FreeXFrom) : null;
  if (!xFrom) return null;
  if (typeof raw.xOff !== "number" || !isFinite(raw.xOff)) return null;
  if (typeof raw.yOff !== "number" || !isFinite(raw.yOff)) return null;
  return {
    xFrom,
    xOff: finiteInt(raw.xOff, 0, -FREE_OFFSET_MAX, FREE_OFFSET_MAX),
    yOff: finiteInt(raw.yOff, 0, -FREE_OFFSET_MAX, FREE_OFFSET_MAX),
    g: typeof raw.g === "string" ? raw.g.slice(0, 120) : "",
  };
}

/** Starting position when an element is freed: the column edge, at the anchor. */
export function defaultFreeSpec(groupName = ""): FreeSpec {
  return { xFrom: "left", xOff: 0, yOff: 0, g: groupName };
}

/** Clamp a user-typed offset (the drag produces floats, the data is integer). */
export function clampFreeOffset(value: unknown): number {
  return finiteInt(value, 0, -FREE_OFFSET_MAX, FREE_OFFSET_MAX);
}

/** Depth level of a node, clamped to the legal scale and off the text level. */
export function zLevelOf(node: PMNode | null | undefined): number {
  if (!node) return LEVEL_DEFAULT;
  const raw = finiteInt(node.attrs?.zLevel, LEVEL_DEFAULT, LEVEL_MIN, Number.MAX_SAFE_INTEGER);
  // Imported or half-written data must never land on the text's own level.
  return raw === TEXT_Z ? TEXT_Z + 1 : raw;
}

/** True when the block can serve as an anchor (text only). */
export function isAnchorBlock(node: PMNode | null | undefined): boolean {
  return !!node && !node.isInline && ANCHOR_BLOCK_TYPES.includes(node.type.name);
}

/**
 * The CSS depth a level becomes on screen and in print.
 *
 * A level below `TEXT_Z` has to turn NEGATIVE. This is not a stylistic choice:
 * in CSS painting order the in-flow text of a box is painted before its
 * positioned descendants, so an absolutely positioned element sits ON TOP of
 * the words whatever positive number it carries. Only a negative depth is
 * painted before the text, which is exactly the "image as background" the
 * contract promises (§4: wrap off / lower than the text). Front rows keep a
 * positive depth and cover the words, as Word does.
 *
 * `TEXT_Z` itself is never used (see planGroupLevels), so the mapping has no
 * collision: 1001 and above go in front, 999 and below go behind.
 */
export function stackDepthOf(level: number): number {
  // One subtraction does the whole job: 1001 becomes +1 (in front of the
  // words), 999 becomes -1 (behind them), and the text's own level 1000 would
  // become 0 - a value the allocator never produces.
  return level - TEXT_Z;
}

/** True when the element is painted behind the words. */
export function isBehindText(level: number): boolean {
  return level < TEXT_Z;
}

/**
 * Every free element of the document with the position of the block it hangs
 * from (null when nothing text-like precedes it: that is the case where the
 * program opens an empty line instead of leaving the element unanchored).
 *
 * ONE walk, used by the painter, by the anchoring rule and by the page groups,
 * so the four of them can never disagree about what an anchor is.
 */
export function freeLayoutMap(doc: PMNode): { pos: number; anchorPos: number | null }[] {
  const out: { pos: number; anchorPos: number | null }[] = [];
  let anchor: number | null = null;
  doc.forEach((node, offset) => {
    if (isAnchorBlock(node)) anchor = offset;
    else if (isFreeNode(node)) out.push({ pos: offset, anchorPos: anchor });
  });
  return out;
}

/** True when the node type can be taken out of the flow. */
export function isFreeCapable(node: PMNode | null | undefined): boolean {
  return !!node && FREE_CAPABLE_TYPES.includes(node.type.name);
}

/** True when the node is a block element sitting outside the text flow. */
export function isFreeNode(node: PMNode | null | undefined): boolean {
  if (!node || !isFreeCapable(node)) return false;
  return parseFreeSpec(node.attrs?.free) !== null;
}

/** The level a freshly freed element gets: just in front of the words (Word). */
export function freeLevelAboveText(): number {
  return TEXT_Z + 1;
}

/**
 * The name of a group = the name carried by its FIRST member in document
 * order. Deriving it instead of storing it separately is what makes an element
 * that flows onto another page correct with no write and no migration.
 */
export function groupNameOf(members: { name: string }[]): string {
  return members.length > 0 ? members[0].name : "";
}

// ---------------------------------------------------------------------------
// Column geometry. The SAME formulas are used on screen by the node views and,
// from F3.2, by the print sheets, so the two cannot drift apart.
// ---------------------------------------------------------------------------

/** Left edge of a free element inside the text column (contract §5). */
export function freeLeftPx(
  column: { left: number; width: number },
  spec: FreeSpec,
  elementWidth: number,
): number {
  const anchorX =
    spec.xFrom === "left"
      ? column.left
      : spec.xFrom === "center"
        ? column.left + (column.width - elementWidth) / 2
        : column.left + column.width - elementWidth;
  return anchorX + spec.xOff;
}

/** Top edge of a free element: always measured from the anchor's top. */
export function freeTopPx(anchorTop: number, spec: FreeSpec): number {
  return anchorTop + spec.yOff;
}

// ---------------------------------------------------------------------------
// Group numbering (contract §3.2-§3.5 rev. 2026-09-07).
//
// The Layers window shows ONE group: the free elements of one page, topmost
// first, with the fixed text row somewhere in the list. The user drags rows;
// the program turns that order into numbers. Nothing is stored as an order.
// ---------------------------------------------------------------------------

/**
 * Turn the rows of a group into depth numbers.
 *
 * @param count    number of element rows
 * @param textRow  index (0-based, 0..count) where the fixed text row sits:
 *                 rows BEFORE it are in front of the words, rows AFTER it are
 *                 behind them
 * @returns        `count` levels, one per row, in the row order given
 *
 * The topmost row is the front-most element, so it gets the highest number;
 * the level TEXT_Z is never handed out (§3.1).
 */
export function planGroupLevels(count: number, textRow: number): number[] {
  const clamped = Math.max(0, Math.min(count, textRow));
  const levels: number[] = [];
  // Rows above the text row: in front of the words, highest at the top.
  for (let i = 0; i < clamped; i++) levels.push(TEXT_Z + (clamped - i));
  // Rows below it: behind the words, the closest to the text the deepest.
  for (let i = clamped + 1; i <= count; i++) {
    const rank = i - (clamped + 1);
    levels.push(Math.max(LEVEL_MIN, TEXT_Z - 1 - rank));
  }
  return levels;
}

/** Where the text row sits, given the current levels of a group's rows. */
export function textRowOf(levels: number[]): number {
  let row = 0;
  while (row < levels.length && levels[row] > TEXT_Z) row++;
  return row;
}

// ---------------------------------------------------------------------------
// D10 dialect for the free-layout attributes.
//
// D10 rule 1: emit BOTH a stable marker and the inline style, and only when
// the value differs from the default, so exported HTML stays clean and
// re-imports exactly. Geometry travels as its own markers (never as a JSON
// string in an attribute: HTML editors and Word round-trips mangle payloads).
// ---------------------------------------------------------------------------

/** Markers for the export side; empty object when in flow at default level. */
export function freeLayoutToDOM(node: PMNode): Record<string, string> {
  const out: Record<string, string> = {};
  const spec = parseFreeSpec(node.attrs?.free);
  if (spec) {
    out["data-free"] = "";
    out["data-free-x-from"] = spec.xFrom;
    out["data-free-x"] = String(spec.xOff);
    out["data-free-y"] = String(spec.yOff);
    if (spec.g) out["data-free-group"] = spec.g;
  }
  const z = zLevelOf(node);
  if (z !== LEVEL_DEFAULT) out["data-z-level"] = String(z);
  return out;
}

/** Re-import side: markers win over anything else on the element. */
export function freeLayoutGetDOM(
  dom: HTMLElement,
): { free: FreeSpec | null; zLevel: number } {
  let free: FreeSpec | null = null;
  if (dom.hasAttribute("data-free")) {
    free = parseFreeSpec({
      xFrom: dom.getAttribute("data-free-x-from") || "left",
      xOff: parseFloat(dom.getAttribute("data-free-x") || "0"),
      yOff: parseFloat(dom.getAttribute("data-free-y") || "0"),
      g: dom.getAttribute("data-free-group") || "",
    });
    // A bare `data-free` with unusable geometry still means "free": land it at
    // the reference edge instead of silently dropping the user's intent.
    if (!free) free = defaultFreeSpec(dom.getAttribute("data-free-group") || "");
  }
  const z = finiteInt(dom.getAttribute("data-z-level"), LEVEL_DEFAULT, LEVEL_MIN, Number.MAX_SAFE_INTEGER);
  return { free, zLevel: z === TEXT_Z ? TEXT_Z + 1 : z };
}
