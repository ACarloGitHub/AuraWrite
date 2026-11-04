// ============================================================================
// Split cells — divide a cell, or a rectangular selection of cells, into
// cols x rows.
//
// `prosemirror-tables` ships `splitCell`, which only un-merges. This is Word's
// "Split Cells…" instead: the grid is widened and heightened, and the cells
// that cross the new lines bridge over them, which is what Word does. The shape
// of the algorithm is EdenText's `tableSplit.ts` (read, not copied); the column
// weights are the same proportions the rest of the editor uses (table-widths.ts):
// only the ratios matter, so splitting a 20% column into two gives 10% and 10%.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { TableMap, isInTable, selectedRect } from "prosemirror-tables";

const MAX_SPLIT = 20;

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_SPLIT, Math.round(value)));
}

/** How `total` units are shared out in `parts` groups, larger ones first. */
function groupOffsets(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rest = total % parts;
  const offsets = [0];
  for (let i = 0; i < parts; i++) offsets.push(offsets[i] + base + (i < rest ? 1 : 0));
  return offsets;
}

/**
 * The column weights a table carries, read off the first row's cells.
 * `null` where the table has none: a table never resized has no widths, and the
 * columns share the width equally.
 */
function columnWeights(table: PMNode, width: number): (number | null)[] {
  const weights: (number | null)[] = new Array(width).fill(null);
  const first = table.firstChild;
  if (!first) return weights;
  let col = 0;
  first.forEach((cell) => {
    const raw = cell.attrs.colwidth;
    const span = Math.max(1, Number(cell.attrs.colspan) || 1);
    if (Array.isArray(raw)) {
      for (let i = 0; i < span && col + i < width; i++) {
        const w = Number(raw[i]);
        if (Number.isFinite(w) && w > 0) weights[col + i] = w;
      }
    }
    col += span;
  });
  return weights;
}

export function splitCellInto(view: EditorView, colsArg: number, rowsArg: number): boolean {
  const { state } = view;
  if (!isInTable(state)) return false;

  const cols = clampCount(colsArg);
  const rows = clampCount(rowsArg);

  const rect = selectedRect(state);
  const { map, table, tableStart } = rect;
  const width = map.width;
  const height = map.height;

  // The grid of owners: one id per distinct cell, so a merged cell appears once.
  const cells: PMNode[] = [];
  const idOfPos = new Map<number, number>();
  const owner: number[][] = [];
  for (let r = 0; r < height; r++) {
    const line: number[] = [];
    for (let c = 0; c < width; c++) {
      const pos = map.map[r * width + c];
      let id = idOfPos.get(pos);
      if (id === undefined) {
        id = cells.length;
        idOfPos.set(pos, id);
        cells.push(table.nodeAt(pos) as PMNode);
      }
      line.push(id);
    }
    owner.push(line);
  }

  const { top, left, bottom, right } = rect;
  const regionWidth = right - left;
  const regionHeight = bottom - top;

  // The region's border may not cut a cell that spans outside it: the same
  // refusal `mergeCells` makes.
  const bounds = new Map<number, { top: number; left: number; bottom: number; right: number }>();
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const id = owner[r][c];
      const b = bounds.get(id);
      if (!b) bounds.set(id, { top: r, left: c, bottom: r + 1, right: c + 1 });
      else {
        b.bottom = Math.max(b.bottom, r + 1);
        b.right = Math.max(b.right, c + 1);
      }
    }
  }
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) {
      const b = bounds.get(owner[r][c]);
      if (!b) return false;
      if (b.top < top || b.left < left || b.bottom > bottom || b.right > right) return false;
    }
  }

  // What the first new cell keeps: the region's blocks, in reading order. With a
  // single cell that is its content; with several it is a merge.
  const kept: PMNode[] = [];
  const seen = new Set<number>();
  for (let r = top; r < bottom; r++) {
    for (let c = left; c < right; c++) {
      const id = owner[r][c];
      if (seen.has(id)) continue;
      seen.add(id);
      cells[id].forEach((node) => kept.push(node));
    }
  }

  // The region grows to at least its own size: asking for fewer cells than it
  // already holds cannot shrink it.
  const newCols = Math.max(cols, regionWidth);
  const newRows = Math.max(rows, regionHeight);
  const extraCols = newCols - regionWidth;
  const extraRows = newRows - regionHeight;

  const weights = columnWeights(table, width);
  const sourceRow = Array.from({ length: height }, (_, r) => r);

  // A new grid line is made by duplicating the region's edge column or row, so
  // the cells crossing it simply bridge: the table widens, nothing is lost.
  if (extraCols > 0) {
    for (let r = 0; r < height; r++) {
      owner[r].splice(right, 0, ...Array(extraCols).fill(owner[r][right - 1]));
    }
    const last = weights[right - 1];
    weights.splice(right, 0, ...Array(extraCols).fill(last));
  }
  if (extraRows > 0) {
    const template = owner[bottom - 1];
    for (let k = 0; k < extraRows; k++) {
      owner.splice(bottom, 0, template.slice());
      sourceRow.splice(bottom, 0, sourceRow[bottom - 1]);
    }
  }
  const gridWidth = width + extraCols;
  const gridHeight = height + extraRows;

  // The region becomes cols x rows new cells; the first keeps the content.
  const colAt = groupOffsets(newCols, cols);
  const rowAt = groupOffsets(newRows, rows);
  const content = new Map<number, PMNode[] | null>();
  let first = true;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const id = cells.length;
      cells.push(cells[owner[top][left]]);
      content.set(id, first ? kept : null);
      first = false;
      const from = left + colAt[i];
      const to = left + colAt[i + 1];
      const firstRow = top + rowAt[j];
      const lastRow = top + rowAt[j + 1];
      for (let r = firstRow; r < lastRow; r++) {
        for (let c = from; c < to; c++) owner[r][c] = id;
      }
    }
  }

  // The region's width is shared equally between the new cells' column groups,
  // so the table keeps the width it had.
  let regionWeight = 0;
  let knownWeights = 0;
  for (let c = left; c < left + newCols; c++) {
    const w = weights[c];
    if (w !== null) {
      regionWeight += w;
      knownWeights += 1;
    }
  }
  if (knownWeights > 0) {
    const perGroup = regionWeight / cols;
    for (let i = 0; i < cols; i++) {
      const span = colAt[i + 1] - colAt[i];
      for (let c = left + colAt[i]; c < left + colAt[i + 1]; c++) {
        weights[c] = Math.max(1, Math.round(perGroup / span));
      }
    }
  }

  // Rebuild: every cell is written once, at its own top-left corner, with the
  // span the grid says it covers.
  const rowType = table.child(0).type;
  const newRowsNodes: PMNode[] = [];
  for (let r = 0; r < gridHeight; r++) {
    const line: PMNode[] = [];
    for (let c = 0; c < gridWidth; c++) {
      const id = owner[r][c];
      const isOrigin = (r === 0 || owner[r - 1][c] !== id) && (c === 0 || owner[r][c - 1] !== id);
      if (!isOrigin) continue;

      let colspan = 1;
      while (c + colspan < gridWidth && owner[r][c + colspan] === id) colspan++;
      let rowspan = 1;
      while (r + rowspan < gridHeight && owner[r + rowspan][c] === id) rowspan++;

      const source = cells[id];
      const spans = weights.slice(c, c + colspan);
      const colwidth = spans.some((w) => w !== null)
        ? spans.map((w) => Math.max(1, Math.round(w ?? 1)))
        : null;
      const attrs = { ...source.attrs, colspan, rowspan, colwidth };

      const own = content.get(id);
      line.push(
        own && own.length
          ? source.type.create(attrs, own)
          : source.type.createAndFill(attrs) ?? source.type.create(attrs, source.content),
      );
    }
    newRowsNodes.push(rowType.create(table.child(sourceRow[r]).attrs, line));
  }

  const newTable = table.type.create(table.attrs, newRowsNodes);
  const tablePos = tableStart - 1;
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable);

  const newMap = TableMap.get(newTable);
  const cellPos = tablePos + 1 + newMap.positionAt(top, left, newTable);
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
  view.dispatch(tr);
  view.focus();
  return true;
}
