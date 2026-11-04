// ============================================================================
// Inserting a row or a column that LOOKS like the one next to it.
//
// prosemirror-tables creates the new cells bare: a row added under a filled and
// bordered row arrives with no fill, no borders, default alignment and no height,
// and a column added beside a table with widths leaves the proportions to be
// shared out again. Word copies the neighbour instead, and that is what these
// commands do — the insert itself stays the library's (it is the one that knows
// how to widen a merged cell the new line crosses), and the formatting is copied
// onto the cells it has just created. EdenText's `tableInsert.ts` wraps the same
// commands for the same reason (read, not copied).
//
// The new column takes half of the width of the column it is inserted next to, so
// the proportions of the others do not move: same idea as dragging a border
// (table-columns.ts), done without a gesture.
// ============================================================================

import type { Command, Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import {
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  isInTable,
  selectedRect,
} from "prosemirror-tables";
import { cellColwidth, columnPercents, columnWeights, percentWeights } from "./table-widths";

type Axis = "row" | "column";
type Side = "before" | "after";

/** What a copied cell keeps: its look, not the grid it occupies. */
function lookOf(attrs: Record<string, unknown>): Record<string, unknown> {
  const { colspan: _colspan, rowspan: _rowspan, ...look } = attrs;
  return look;
}

/**
 * The cell paragraph's formatting. Only the two that mean "how the text is set":
 * `pageBreakBefore` has no meaning inside a cell and `tableCaption` would turn the
 * cell's paragraph into the table's title.
 */
function paragraphLook(node: PMNode): Record<string, unknown> {
  return { align: node.attrs.align, lineHeight: node.attrs.lineHeight };
}

/** Copy the look of the source line onto the cells the insert created. */
function copyLineLook(
  tr: Transaction,
  tableStart: number,
  table: PMNode,
  map: TableMap,
  axis: Axis,
  line: number,
  source: number,
): void {
  const horizontal = axis === "row";
  const length = horizontal ? map.width : map.height;
  const seen = new Set<number>();
  for (let k = 0; k < length; k++) {
    const cellPos = map.map[horizontal ? line * map.width + k : k * map.width + line];
    if (cellPos === undefined || seen.has(cellPos)) continue;
    seen.add(cellPos);
    const sourcePos = map.map[horizontal ? source * map.width + k : k * map.width + source];
    // A merged cell that the insert only widened is the same node: it is not new.
    if (sourcePos === undefined || sourcePos === cellPos) continue;
    const cell = table.nodeAt(cellPos);
    const from = table.nodeAt(sourcePos);
    if (!cell || !from) continue;
    tr.setNodeMarkup(tableStart + cellPos, null, { ...cell.attrs, ...lookOf(from.attrs) });
    const target = cell.firstChild;
    const look = from.firstChild ? paragraphLook(from.firstChild) : null;
    if (target && look && target.type.name === "paragraph") {
      tr.setNodeMarkup(tableStart + cellPos + 1, null, look);
    }
  }
}

/** Rewrite every cell's `colwidth` from the new proportions. */
function rewriteWidths(tr: Transaction, tableStart: number, weights: number[]): void {
  const table = tr.doc.nodeAt(tableStart - 1);
  if (!table) return;
  const map = TableMap.get(table);
  const seen = new Set<number>();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const cell = table.nodeAt(pos);
    if (!cell) continue;
    const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);
    const colwidth = cellColwidth(weights, map.colCount(pos), colspan);
    const current = cell.attrs.colwidth;
    if (Array.isArray(current) && current.length === colwidth.length && current.every((w, i) => w === colwidth[i])) {
      continue;
    }
    tr.setNodeMarkup(tableStart + pos, null, { ...cell.attrs, colwidth });
  }
}

/** A row whose every cell is a header cell: the table's header row. */
function isHeaderRow(table: PMNode, index: number): boolean {
  const row = table.child(index);
  if (!row || row.childCount === 0) return false;
  let header = true;
  row.forEach((cell) => {
    if (cell.type.name !== "table_header") header = false;
  });
  return header;
}

function addLine(side: Side, axis: Axis): Command {
  const insert =
    axis === "row"
      ? side === "before"
        ? addRowBefore
        : addRowAfter
      : side === "before"
        ? addColumnBefore
        : addColumnAfter;

  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const line = axis === "row"
      ? side === "after" ? rect.bottom : rect.top
      : side === "after" ? rect.right : rect.left;
    const oldWeights = axis === "column" ? columnWeights(rect.table) : null;

    return insert(
      state,
      dispatch
        ? (tr) => {
            const table = tr.doc.nodeAt(rect.tableStart - 1);
            if (table) {
              const map = TableMap.get(table);
              const size = axis === "row" ? map.height : map.width;
              // The neighbour the new line copies: the one above (or on the left).
              // On the first line there is none, and the insert has just moved the
              // old first line to index 1 — which is the one it was inserted beside.
              let source = line > 0 ? line - 1 : Math.min(1, size - 1);
              // Under a header row the new row is a body row, as in Word: it copies
              // the row below, not the header (EdenText's `tableInsert` chooses the
              // same body row). The library has already made the cells body cells.
              if (axis === "row" && line === 1 && map.height > 2 && isHeaderRow(table, 0)) {
                source = 2;
              }

              if (axis === "row") {
                let rowPos = rect.tableStart;
                for (let i = 0; i < line; i++) rowPos += table.child(i).nodeSize;
                tr.setNodeMarkup(rowPos, null, table.child(source).attrs);
              }
              copyLineLook(tr, rect.tableStart, table, map, axis, line, source);

              if (oldWeights && oldWeights.some((weight) => weight !== null)) {
                const percents = columnPercents(oldWeights);
                const donor = Math.max(0, line - 1);
                const half = percents[donor] / 2;
                percents[donor] -= half;
                percents.splice(line, 0, half);
                rewriteWidths(tr, rect.tableStart, percentWeights(percents));
              }
            }
            dispatch(tr);
          }
        : undefined,
    );
  };
}

/** The four commands of the table bar, each one copying the line it sits beside. */
export const insertRowBefore = addLine("before", "row");
export const insertRowAfter = addLine("after", "row");
export const insertColumnBefore = addLine("before", "column");
export const insertColumnAfter = addLine("after", "column");
