// ============================================================================
// Table menu on the main bar — it only INSERTS a table.
//
// The commands that change a table (rows, columns, merge, split, header,
// delete) live in the secondary bar, `table-menu.ts`, which appears while the
// caret is inside a table. One command, one place.
//
// How a size is chosen: the grid is the quick gesture (8 rows by 10 columns,
// the block under the pointer lights up), the two fields are the free one, the
// way EdenText's TablePicker does it. The fields are clamped: more than 20
// columns does not fit the text column, and 50 rows are already a table that
// spans page after page.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";

const GRID_ROWS = 8;
const GRID_COLS = 10;
const MAX_ROWS = 50;
const MAX_COLS = 20;

let dropdownEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let gridEl: HTMLElement | null = null;
let rowsInput: HTMLInputElement | null = null;
let colsInput: HTMLInputElement | null = null;

function clamp(value: string, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function createGrid(): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "table-picker-grid";
  for (let rows = 1; rows <= GRID_ROWS; rows++) {
    const line = document.createElement("div");
    line.className = "table-picker-grid__row";
    for (let cols = 1; cols <= GRID_COLS; cols++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "table-picker-grid__cell";
      cell.dataset.rows = String(rows);
      cell.dataset.cols = String(cols);
      cell.setAttribute("aria-label", `${cols} × ${rows}`);
      line.appendChild(cell);
    }
    grid.appendChild(line);
  }
  return grid;
}

/** Light up the block from the top-left corner to the cell under the pointer. */
function highlight(rows: number, cols: number): void {
  if (!gridEl) return;
  for (const cell of gridEl.querySelectorAll<HTMLElement>(".table-picker-grid__cell")) {
    const r = Number(cell.dataset.rows);
    const c = Number(cell.dataset.cols);
    cell.classList.toggle("is-hot", r <= rows && c <= cols);
  }
  if (labelEl) {
    labelEl.textContent = rows > 0 && cols > 0 ? `${cols} × ${rows}` : "Insert table";
  }
}

function createDropdown(): HTMLElement {
  if (dropdownEl) return dropdownEl;

  dropdownEl = document.createElement("div");
  dropdownEl.className = "table-dropdown hidden";

  labelEl = document.createElement("div");
  labelEl.className = "table-picker-label";
  labelEl.textContent = "Insert table";
  dropdownEl.appendChild(labelEl);

  gridEl = createGrid();
  dropdownEl.appendChild(gridEl);

  const manual = document.createElement("div");
  manual.className = "table-picker-manual";
  manual.innerHTML =
    '<label class="table-picker-field">Rows <input id="table-insert-rows" type="text" inputmode="numeric" value="3" /></label>' +
    '<label class="table-picker-field">Cols <input id="table-insert-cols" type="text" inputmode="numeric" value="3" /></label>' +
    '<button id="table-insert-apply" type="button" class="table-picker-apply">Insert</button>';
  dropdownEl.appendChild(manual);

  document.body.appendChild(dropdownEl);
  rowsInput = dropdownEl.querySelector<HTMLInputElement>("#table-insert-rows");
  colsInput = dropdownEl.querySelector<HTMLInputElement>("#table-insert-cols");
  return dropdownEl;
}

function createTable(rows: number, cols: number, view: EditorView): void {
  if (!view || !view.state) return;

  view.focus();

  const { state } = view;
  const { table, table_row, table_cell, table_header, paragraph } = state.schema.nodes;

  if (!table || !table_row || !table_cell || !table_header) return;

  const cellContent = paragraph ? [paragraph.create()] : [];
  let tableNode;
  try {
    const headerCells = Array.from({ length: cols }, () => table_header.create(null, cellContent));
    const dataCells = Array.from({ length: cols }, () => table_cell.create(null, cellContent));
    const headerRow = table_row.create(null, headerCells);
    const dataRows = Array.from({ length: rows - 1 }, () => table_row.create(null, dataCells));
    tableNode = table.create(null, [headerRow, ...dataRows]);
  } catch (e) {
    console.error("[table] FAILED to create tableNode:", e);
    return;
  }

  const { $from } = state.selection;
  let foundDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const parent = $from.node(d);
    const match = parent.contentMatchAt($from.index(d)).matchType(table);
    if (match) { foundDepth = d; break; }
  }

  if (foundDepth < 0) {
    console.error("[table] FAILED: no valid depth found");
    return;
  }

  const insertPos = $from.end(foundDepth);
  const tr = state.tr.insert(insertPos, tableNode);
  if (tr.doc.content.size <= state.doc.content.size) {
    console.error("[table] FAILED: insert did not change doc size");
    return;
  }
  // The caret goes into the first cell, as both word processors do — and that is
  // also what makes the new table lay itself out once: without a view update after
  // the insert, a wide table kept the width it measured before the column had one
  // (780px for twenty columns, until the first click).
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 4)));
  view.dispatch(tr);
}

export function setupTableToolbar(view: EditorView): void {
  const dropdown = createDropdown();

  const insert = (rows: number, cols: number) => {
    createTable(rows, cols, view);
    hideDropdown();
  };

  // The grid: hovering lights the block up, a click inserts that size.
  dropdown.addEventListener("mouseover", (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".table-picker-grid__cell");
    if (!cell) return;
    highlight(Number(cell.dataset.rows), Number(cell.dataset.cols));
  });
  dropdown.addEventListener("mouseleave", () => highlight(0, 0));

  dropdown.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    const cell = target.closest<HTMLElement>(".table-picker-grid__cell");
    if (cell) {
      e.preventDefault();
      insert(Number(cell.dataset.rows), Number(cell.dataset.cols));
      return;
    }

    if (target.closest("#table-insert-apply")) {
      e.preventDefault();
      insert(
        clamp(rowsInput?.value ?? "3", 1, MAX_ROWS),
        clamp(colsInput?.value ?? "3", 1, MAX_COLS),
      );
    }
  });

  // Enter in either field inserts, as in the picker both word processors show.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    insert(
      clamp(rowsInput?.value ?? "3", 1, MAX_ROWS),
      clamp(colsInput?.value ?? "3", 1, MAX_COLS),
    );
  };
  rowsInput?.addEventListener("keydown", onKey);
  colsInput?.addEventListener("keydown", onKey);
}

export function showTableDropdown(): void {
  const dropdown = createDropdown();
  highlight(0, 0);

  const btn = document.getElementById("btn-table");
  if (btn) {
    const rect = btn.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
  }

  dropdown.classList.remove("hidden");
}

export function hideDropdown(): void {
  if (dropdownEl) {
    dropdownEl.classList.add("hidden");
  }
}

export function toggleTableDropdown(): void {
  if (dropdownEl && !dropdownEl.classList.contains("hidden")) {
    hideDropdown();
  } else {
    showTableDropdown();
  }
}
