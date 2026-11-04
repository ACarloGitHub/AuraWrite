// ============================================================================
// Column widths by dragging the border between two columns.
//
// The two columns trade width and the table keeps its own: what changes is their
// proportion, never the table's, which is 100% of the text column by definition
// (table-widths.ts). During the drag only the <col> elements are poked, so the
// document is not rewritten on every mouse move; on release the new proportions
// are written once, as weights, into every cell of those columns.
//
// The table's outer edges are not handles: the table is as wide as the text, so
// there is nothing there to trade — Word's own "fixed" table behaves the same.
// EdenText's `tableColumnResize` is the model (read, not copied); the shape of
// this harness is `row-height.ts`, which drags the line under a row the same way.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { TableMap, cellAround } from "prosemirror-tables";
import { cellColwidth, columnPercents, columnWeights, percentWeights } from "./table-widths";

/** How close to a column border the pointer has to be to grab it. */
const EDGE_PX = 5;
/** A column cannot be dragged narrower than this. */
const MIN_COL_PX = 30;

interface CellGeometry {
  $cell: ReturnType<typeof cellAround>;
  table: PMNode;
  map: TableMap;
  /** Position of the table's content, the origin of `map`. */
  start: number;
  /** First grid column the cell covers. */
  colStart: number;
  colspan: number;
}

function geometryOf(view: EditorView, cellEl: HTMLElement): CellGeometry | null {
  let domPos: number;
  try {
    domPos = view.posAtDOM(cellEl, 0);
  } catch {
    return null;
  }
  const $cell = cellAround(view.state.doc.resolve(domPos));
  if (!$cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const colspan = Math.max(1, Number($cell.nodeAfter?.attrs.colspan) || 1);
  return { $cell, table, map, start, colStart: map.colCount($cell.pos - start), colspan };
}

/** Which border of the hovered cell the pointer is on: the column to its left. */
function borderAt(view: EditorView, event: MouseEvent): { cell: CellGeometry; leftCol: number } | null {
  const target = event.target as HTMLElement | null;
  const cellEl = target?.closest("td, th") as HTMLElement | null;
  if (!cellEl) return null;
  const cell = geometryOf(view, cellEl);
  if (!cell) return null;

  const rect = cellEl.getBoundingClientRect();
  const onRight = rect.right - event.clientX <= EDGE_PX;
  const onLeft = event.clientX - rect.left <= EDGE_PX;
  if (!onRight && !onLeft) return null;

  // The right border of a cell is the border after its last column; the left one
  // is the border before its first. Both name the column on their left.
  const leftCol = onRight ? cell.colStart + cell.colspan - 1 : cell.colStart - 1;
  if (leftCol < 0 || leftCol >= cell.map.width - 1) return null;
  return { cell, leftCol };
}

interface Drag {
  view: EditorView;
  cell: CellGeometry;
  leftCol: number;
  cols: HTMLElement[];
  startX: number;
  startLeft: number;
  sum: number;
  tableWidth: number;
  scale: number;
  minPct: number;
  lastLeft: number;
  lastRight: number;
  moved: boolean;
}

function columnsOf(table: HTMLElement): HTMLElement[] {
  const colgroup = table.querySelector(":scope > colgroup");
  return colgroup ? (Array.from(colgroup.children) as HTMLElement[]) : [];
}

/** Write the new proportions into every cell of the table, as weights. */
function commit(view: EditorView, drag: Drag): void {
  const { cell } = drag;
  const percents = columnPercents(columnWeights(cell.table));
  percents[drag.leftCol] = drag.lastLeft;
  percents[drag.leftCol + 1] = drag.lastRight;
  const weights = percentWeights(percents);

  const tr = view.state.tr;
  const seen = new Set<number>();
  let changed = false;
  for (let row = 0; row < cell.map.height; row++) {
    for (let col = 0; col < cell.map.width; col++) {
      const pos = cell.map.map[row * cell.map.width + col];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const node = cell.table.nodeAt(pos);
      if (!node) continue;
      const colStart = cell.map.colCount(pos);
      const colspan = Math.max(1, Number(node.attrs.colspan) || 1);
      const colwidth = cellColwidth(weights, colStart, colspan);
      const current = node.attrs.colwidth;
      if (Array.isArray(current) && current.length === colwidth.length && current.every((w, i) => w === colwidth[i])) {
        continue;
      }
      tr.setNodeMarkup(cell.start + pos, undefined, { ...node.attrs, colwidth });
      changed = true;
    }
  }
  if (changed) view.dispatch(tr);
}

export function createTableColumnsPlugin(): Plugin {
  let drag: Drag | null = null;
  let lastX = 0;

  const onMove = (event: MouseEvent): void => {
    if (!drag) return;
    event.preventDefault();
    // The drag is in painted pixels; the column is in layout pixels. The page can
    // be zoomed by a transform (editor-zoom.ts), so the two are converted with the
    // table's own ruler, never with the number the user asked for.
    const delta = (event.clientX - drag.startX) / drag.scale;
    const wanted = drag.startLeft + (delta / drag.tableWidth) * 100;
    const left = Math.max(drag.minPct, Math.min(drag.sum - drag.minPct, wanted));
    const right = drag.sum - left;
    if (drag.cols[drag.leftCol]) drag.cols[drag.leftCol].style.width = `${left}%`;
    if (drag.cols[drag.leftCol + 1]) drag.cols[drag.leftCol + 1].style.width = `${right}%`;
    drag.lastLeft = left;
    drag.lastRight = right;
    drag.moved = true;
    lastX = event.clientX;
  };

  const onUp = (): void => {
    if (!drag) return;
    const { view } = drag;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (drag.moved && Math.abs(lastX - drag.startX) > 1) commit(view, drag);
    drag = null;
  };

  return new Plugin({
    key: new PluginKey("tableColumnWidths"),
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          if (!view.editable || event.button !== 0 || drag) return false;
          const found = borderAt(view, event);
          if (!found) return false;

          const tableEl = (event.target as HTMLElement).closest("table") as HTMLElement | null;
          if (!tableEl) return false;
          const tableWidth = tableEl.offsetWidth;
          if (tableWidth <= 0) return false;

          const percents = columnPercents(columnWeights(found.cell.table));
          const sum = percents[found.leftCol] + percents[found.leftCol + 1];
          drag = {
            view,
            cell: found.cell,
            leftCol: found.leftCol,
            cols: columnsOf(tableEl),
            startX: event.clientX,
            startLeft: percents[found.leftCol],
            sum,
            tableWidth,
            scale: tableEl.getBoundingClientRect().width / tableWidth || 1,
            minPct: Math.min(sum / 2, (MIN_COL_PX / tableWidth) * 100),
            lastLeft: percents[found.leftCol],
            lastRight: percents[found.leftCol + 1],
            moved: false,
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          event.preventDefault();
          return true;
        },

        // The pointer says what the border does, before anything is clicked.
        // It only ever sets the cursor: the row drag clears it (row-height.ts).
        mousemove(view: EditorView, event: MouseEvent) {
          if (drag || !view.editable) return false;
          if (borderAt(view, event)) view.dom.style.cursor = "col-resize";
          return false;
        },
      },
    },
  });
}
