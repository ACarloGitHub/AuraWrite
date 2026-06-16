import type { EditorView } from "prosemirror-view";
import type { Transaction } from "prosemirror-state";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { getCassiePagedMode, setCassiePagedMode } from "./pagination-state";
import {
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  mergeCells,
  splitCell,
  toggleHeaderRow,
  deleteTable,
  isInTable,
} from "prosemirror-tables";

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
    <div class="table-dropdown__divider"></div>
    <div class="table-dropdown__section">Row</div>
    <button class="table-dropdown__item" data-action="add-row-before">Add Row Above</button>
    <button class="table-dropdown__item" data-action="add-row-after">Add Row Below</button>
    <button class="table-dropdown__item" data-action="delete-row">Delete Row</button>
    <div class="table-dropdown__divider"></div>
    <div class="table-dropdown__section">Column</div>
    <button class="table-dropdown__item" data-action="add-col-before">Add Column Left</button>
    <button class="table-dropdown__item" data-action="add-col-after">Add Column Right</button>
    <button class="table-dropdown__item" data-action="delete-col">Delete Column</button>
    <div class="table-dropdown__divider"></div>
    <div class="table-dropdown__section">Cell</div>
    <button class="table-dropdown__item" data-action="merge-cells">Merge Cells</button>
    <button class="table-dropdown__item" data-action="split-cell">Split Cell</button>
    <button class="table-dropdown__item" data-action="toggle-header">Toggle Header Row</button>
    <div class="table-dropdown__divider"></div>
    <button class="table-dropdown__item table-dropdown__item--danger" data-action="delete-table">Delete Table</button>
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

function dispatchTableCommand(
  view: EditorView,
  command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean
): void {
  command(view.state, view.dispatch);
  view.focus();
}

function updateDropdownState(): void {
  if (!dropdownEl) return;

  const editorView = (window as Window & { __aurawrite_editor_view?: EditorView }).__aurawrite_editor_view;
  if (!editorView) return;

  const inTable = isInTable(editorView.state);

  const sections = dropdownEl.querySelectorAll(".table-dropdown__section");
  const allItems = dropdownEl.querySelectorAll(".table-dropdown__item");

  allItems.forEach((item) => {
    const action = (item as HTMLElement).dataset.action;
    if (!action) return;

    if (action.startsWith("insert-")) {
      (item as HTMLButtonElement).disabled = false;
    } else {
      (item as HTMLButtonElement).disabled = !inTable;
      (item as HTMLElement).classList.toggle("table-dropdown__item--disabled", !inTable);
    }
  });

  sections.forEach((section) => {
    const text = section.textContent || "";
    if (["Row", "Column", "Cell"].includes(text)) {
      (section as HTMLElement).style.opacity = inTable ? "" : "0.4";
    }
  });
}

export function setupTableToolbar(view: EditorView): void {
  const dropdown = createDropdown();

  (window as Window & { __aurawrite_editor_view?: EditorView }).__aurawrite_editor_view = view;

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
      case "add-row-before":
        dispatchTableCommand(view, addRowBefore);
        break;
      case "add-row-after":
        dispatchTableCommand(view, addRowAfter);
        break;
      case "delete-row":
        dispatchTableCommand(view, deleteRow);
        break;
      case "add-col-before":
        dispatchTableCommand(view, addColumnBefore);
        break;
      case "add-col-after":
        dispatchTableCommand(view, addColumnAfter);
        break;
      case "delete-col":
        dispatchTableCommand(view, deleteColumn);
        break;
      case "merge-cells":
        dispatchTableCommand(view, mergeCells);
        break;
      case "split-cell":
        dispatchTableCommand(view, splitCell);
        break;
      case "toggle-header":
        dispatchTableCommand(view, toggleHeaderRow);
        break;
      case "delete-table":
        dispatchTableCommand(view, deleteTable);
        break;
    }

    hideDropdown();
  });
}

export function showTableDropdown(): void {
  const dropdown = createDropdown();
  updateDropdownState();

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

export function hasTable(doc: PMNode): boolean {
  let found = false;
  doc.forEach((node: PMNode) => {
    if (node.type.name === "table") found = true;
  });
  return found;
}

// ============================================================================
// Table Monitor Plugin — disables paged mode when tables are present
// ============================================================================

let tableWarningBanner: HTMLElement | null = null;

function showTableWarningBanner(): void {
  if (tableWarningBanner) return;
  tableWarningBanner = document.createElement("div");
  tableWarningBanner.className = "table-warning-banner";
  tableWarningBanner.innerHTML =
    '<span class="table-warning-banner__icon">⚠️</span>' +
    '<span class="table-warning-banner__text">Tables are not compatible with paged view. Paged view has been disabled.</span>';
  const editorEl = document.getElementById("editor");
  if (editorEl) {
    editorEl.parentNode?.insertBefore(tableWarningBanner, editorEl.nextSibling);
  }
}

function hideTableWarningBanner(): void {
  if (tableWarningBanner) {
    tableWarningBanner.remove();
    tableWarningBanner = null;
  }
}

export function checkTablesAndPagedMode(view: EditorView): void {
  const doc = view.state.doc;
  const tablesFound = hasTable(doc);
  const isCassiePaged = getCassiePagedMode();

  if (tablesFound && isCassiePaged) {
    setCassiePagedMode(false);
    view.dom.classList.remove("is-cassie-paged");
    showTableWarningBanner();
  } else if (!tablesFound) {
    hideTableWarningBanner();
  }
}

export function createTableMonitorPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("tableMonitor"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanged = transactions.some((tr) => tr.docChanged);
      if (!docChanged) return null;

      const tablesFound = hasTable(newState.doc);
      const hadTables = hasTable(oldState.doc);

      if (tablesFound !== hadTables) {
        requestAnimationFrame(() => {
          const view = (window as any).__aurawrite_editor_view;
          if (view) {
            checkTablesAndPagedMode(view);
          }
        });
      }

      return null;
    },
  });
}
