// ============================================================================
// Table menu — the commands that CHANGE a table, in the one secondary bar.
//
// The menu on the main bar only creates a table (3×3, 4×4, 5×5). These controls
// appear while the caret is inside a table — row and column, merging and
// splitting, the header row, deleting the table — so each command lives in one
// place and the bar of the elements keeps its own.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeaderRow,
} from "prosemirror-tables";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function run(view: EditorView, command: Command): void {
  command(view.state, view.dispatch, view);
  view.focus();
}

/** Bind the table's own controls once. */
export function setupTableMenu(view: EditorView): void {
  el("tbl-row-before")?.addEventListener("click", () => run(view, addRowBefore));
  el("tbl-row-after")?.addEventListener("click", () => run(view, addRowAfter));
  el("tbl-row-delete")?.addEventListener("click", () => run(view, deleteRow));

  el("tbl-col-before")?.addEventListener("click", () => run(view, addColumnBefore));
  el("tbl-col-after")?.addEventListener("click", () => run(view, addColumnAfter));
  el("tbl-col-delete")?.addEventListener("click", () => run(view, deleteColumn));

  el("tbl-merge")?.addEventListener("click", () => run(view, mergeCells));
  el("tbl-split")?.addEventListener("click", () => run(view, splitCell));
  el("tbl-header")?.addEventListener("click", () => run(view, toggleHeaderRow));

  el("tbl-delete")?.addEventListener("click", () => run(view, deleteTable));
}
