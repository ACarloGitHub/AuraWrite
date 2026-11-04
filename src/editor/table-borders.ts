// ============================================================================
// Cell borders — a border for each side of a cell.
//
// A cell carries four attributes (`borderTop`, `borderRight`, `borderBottom`,
// `borderLeft`). Each holds `null` — the table's own line, the one the
// stylesheet draws — `"none"`, or the canonical `"<W>pt solid #RRGGBB"`. Word
// reads the same four out of `w:tcBorders` (`formats/docx.ts`,
// `formats/docx-tables.ts`).
//
// Two things here are not obvious, and both come from a collapsed border:
//
// 1. THE TWO SIDES. A line between two cells is drawn once, out of the two
//    sides facing it, and the winner is a border over "none", then the wider.
//    So a preset writes BOTH cells that share the line: writing one leaves the
//    neighbour free to disagree, and the screen would show a line the document
//    does not carry. The walk over boundaries is EdenText's
//    `tableCellBorders.ts` (read, not copied).
// 2. THE DEFAULT HERE IS NOT WORD'S. `null` is the 1px line of
//    `05-document.css`, not Word's 0.5pt black, so a stroke of the pen is
//    always stored as written and never collapses into "the default".
// ============================================================================

import type { Command } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { isInTable, selectedRect } from "prosemirror-tables";

export const BORDER_SIDES = ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

export type BorderPreset =
  | "all"
  | "outer"
  | "inner"
  | "innerH"
  | "innerV"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "none";

export interface BorderPen {
  widthPt: number;
  color: string;
}

/** The line the stylesheet draws where a cell has no border of its own. */
export const DEFAULT_BORDER_PX = 1;

export const BORDER_SIDE_CSS: Record<BorderSide, string> = {
  borderTop: "border-top",
  borderRight: "border-right",
  borderBottom: "border-bottom",
  borderLeft: "border-left",
};

export const BORDER_SIDE_DATA: Record<BorderSide, string> = {
  borderTop: "data-border-top",
  borderRight: "data-border-right",
  borderBottom: "data-border-bottom",
  borderLeft: "data-border-left",
};

const BORDER_PATTERN = /^([\d.]+)pt solid (#[0-9A-Fa-f]{6})$/;

/** The attribute value a stroke of the pen leaves on a cell. */
export function borderValue(pen: BorderPen): string {
  const width = Math.round(Math.max(0.25, pen.widthPt) * 100) / 100;
  return `${width}pt solid ${pen.color.toUpperCase()}`;
}

/** `null` = no border of its own, `"none"` = no line, else width and colour. */
export function parseBorder(
  value: unknown,
): { widthPt: number; color: string } | "none" | null {
  if (typeof value !== "string" || !value) return null;
  if (value === "none") return "none";
  const match = BORDER_PATTERN.exec(value);
  if (!match) return null;
  return { widthPt: Number(match[1]), color: match[2].toUpperCase() };
}

/** Chromium floors every border to a whole pixel: a 0.5pt stroke is drawn as 1px. */
function widthPx(widthPt: number): number {
  return Math.max(1, Math.round((widthPt * 96) / 72));
}

/** The CSS a side renders, or `null` when the cell has no border of its own. */
export function cssBorder(value: unknown): string | null {
  const border = parseBorder(value);
  if (border === null) return null;
  if (border === "none") return "none";
  return `${widthPx(border.widthPt)}px solid ${border.color}`;
}

/**
 * The pixels a side takes: the default line, none, or the declared width — the
 * same number the browser uses, which is what the pagination measure needs.
 */
export function borderWidthPx(value: unknown): number {
  const border = parseBorder(value);
  if (border === "none") return 0;
  if (border === null) return DEFAULT_BORDER_PX;
  return widthPx(border.widthPt);
}

/**
 * Every boundary a preset touches, reported as both facing (cell, side) pairs.
 * A position is `null` at the outer edge of the table; a boundary that runs
 * inside a merged cell is skipped, as it draws nothing.
 */
function forEachBoundary(
  rect: ReturnType<typeof selectedRect>,
  preset: BorderPreset,
  cb: (aPos: number | null, aSide: BorderSide, bPos: number | null, bSide: BorderSide) => void,
): void {
  const { map } = rect;
  // "none" is "all" with a value that erases: every boundary has to be written,
  // on both of its sides, or the neighbour's line wins the collapse.
  const every = preset === "all" || preset === "none";
  const wants = {
    topEdge: every || preset === "outer" || preset === "top",
    bottomEdge: every || preset === "outer" || preset === "bottom",
    leftEdge: every || preset === "outer" || preset === "left",
    rightEdge: every || preset === "outer" || preset === "right",
    innerH: every || preset === "inner" || preset === "innerH",
    innerV: every || preset === "inner" || preset === "innerV",
  };

  // Horizontal lines: y separates the row above from the row below.
  for (let y = rect.top; y <= rect.bottom; y++) {
    const isTop = y === rect.top;
    const isBottom = y === rect.bottom;
    if (isTop && !wants.topEdge) continue;
    if (isBottom && !wants.bottomEdge) continue;
    if (!isTop && !isBottom && !wants.innerH) continue;
    for (let x = rect.left; x < rect.right; x++) {
      const below = y < map.height ? map.map[y * map.width + x] : null;
      const above = y > 0 ? map.map[(y - 1) * map.width + x] : null;
      if (above === below) continue;
      cb(above, "borderBottom", below, "borderTop");
    }
  }

  // Vertical lines: x separates the column on the left from the one on the right.
  for (let x = rect.left; x <= rect.right; x++) {
    const isLeft = x === rect.left;
    const isRight = x === rect.right;
    if (isLeft && !wants.leftEdge) continue;
    if (isRight && !wants.rightEdge) continue;
    if (!isLeft && !isRight && !wants.innerV) continue;
    for (let y = rect.top; y < rect.bottom; y++) {
      const right = x < map.width ? map.map[y * map.width + x] : null;
      const left = x > 0 ? map.map[y * map.width + (x - 1)] : null;
      if (left === right) continue;
      cb(left, "borderRight", right, "borderLeft");
    }
  }
}

/** Paint a preset of borders over the selected rectangle of cells. */
export function setTableBorders(preset: BorderPreset, pen: BorderPen | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (!dispatch) return true;

    const value = preset === "none" ? "none" : pen ? borderValue(pen) : null;
    if (value === null) return false;

    const rect = selectedRect(state);
    // Cell position (relative to the table) → the sides that change on it.
    const changes = new Map<number, Partial<Record<BorderSide, string>>>();
    const set = (pos: number | null, side: BorderSide) => {
      if (pos === null) return;
      const sides = changes.get(pos) ?? {};
      sides[side] = value;
      changes.set(pos, sides);
    };
    forEachBoundary(rect, preset, (aPos, aSide, bPos, bSide) => {
      set(aPos, aSide);
      set(bPos, bSide);
    });
    if (changes.size === 0) return false;

    const tr = state.tr;
    for (const [pos, sides] of changes) {
      const cell: PMNode | null = state.doc.nodeAt(rect.tableStart + pos);
      if (!cell) continue;
      const next = { ...cell.attrs, ...sides };
      // A stroke that changes nothing must not leave an undo step behind.
      if (BORDER_SIDES.every((side) => next[side] === cell.attrs[side])) continue;
      tr.setNodeMarkup(rect.tableStart + pos, undefined, next);
    }
    if (!tr.docChanged) return false;
    dispatch(tr);
    return true;
  };
}
