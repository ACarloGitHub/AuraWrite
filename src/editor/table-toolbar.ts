// ============================================================================
// Table menu on the main bar — it only INSERTS a table.
//
// The commands that change a table (rows, columns, merge, split, header,
// delete) live in the secondary bar, `table-menu.ts`, which appears while the
// caret is inside a table. One command, one place.
// ============================================================================

import type { EditorView } from "prosemirror-view";

let dropdownEl: HTMLElement | null = null;

function createDropdown(): HTMLElement {
  if (dropdownEl) return dropdownEl;

  dropdownEl = document.createElement("div");
  dropdownEl.className = "table-dropdown hidden";
  dropdownEl.innerHTML = `
    <div class="table-dropdown__section">Insert</div>
    <button class="table-dropdown__item" data-action="insert-3x3">Table 3×3</button>
    <button class="table-dropdown__item" data-action="insert-4x4">Table 4×4</button>
    <button class="table-dropdown__item" data-action="insert-5x5">Table 5×5</button>
  `;

  document.body.appendChild(dropdownEl);
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
  view.dispatch(tr);
}

export function setupTableToolbar(view: EditorView): void {
  const dropdown = createDropdown();

  dropdown.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".table-dropdown__item") as HTMLElement;
    if (!item) return;

    const action = item.dataset.action;
    if (!action) return;

    e.preventDefault();
    e.stopPropagation();

    switch (action) {
      case "insert-3x3":
        createTable(3, 3, view);
        break;
      case "insert-4x4":
        createTable(4, 4, view);
        break;
      case "insert-5x5":
        createTable(5, 5, view);
        break;
    }

    hideDropdown();
  });
}

export function showTableDropdown(): void {
  const dropdown = createDropdown();

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
