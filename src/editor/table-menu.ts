// ============================================================================
// Table menu — the commands that CHANGE a table, in the one secondary bar.
//
// The menu on the main bar only creates a table. These controls appear while the
// caret is inside a table — row and column, merging and splitting, the header
// row, deleting the table — so each command lives in one place and the bar of
// the elements keeps its own.
//
// "Split" opens a small window with two fields, as Word's "Split Cells…" does:
// the count of cells is chosen there, not guessed from the selection. One cell
// split into two columns is also how a merged cell is un-merged.
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
  toggleHeaderRow,
} from "prosemirror-tables";
import { splitCellInto } from "./table-split";

const MIN_SPLIT = 1;
const MAX_SPLIT = 20;

let splitPanel: HTMLElement | null = null;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function run(view: EditorView, command: Command): void {
  command(view.state, view.dispatch, view);
  view.focus();
}

function clampCount(value: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_SPLIT;
  return Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, n));
}

function ensureSplitPanel(view: EditorView): HTMLElement {
  if (splitPanel) return splitPanel;

  splitPanel = document.createElement("div");
  splitPanel.className = "table-dropdown table-split-panel hidden";
  splitPanel.innerHTML =
    '<label class="table-picker-field">Cols <input id="table-split-cols" type="text" inputmode="numeric" value="2" /></label>' +
    '<label class="table-picker-field">Rows <input id="table-split-rows" type="text" inputmode="numeric" value="1" /></label>' +
    '<button id="table-split-apply" type="button" class="table-picker-apply">Split</button>';
  document.body.appendChild(splitPanel);

  const apply = () => {
    const cols = clampCount(el<HTMLInputElement>("table-split-cols")?.value ?? "2");
    const rows = clampCount(el<HTMLInputElement>("table-split-rows")?.value ?? "1");
    splitCellInto(view, cols, rows);
    hideSplitPanel();
  };

  splitPanel.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("#table-split-apply")) {
      event.preventDefault();
      apply();
    }
  });
  splitPanel.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSplitPanel();
      view.focus();
    }
  });
  document.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!splitPanel || splitPanel.classList.contains("hidden")) return;
    if (target.closest("#tbl-split") || splitPanel.contains(target)) return;
    hideSplitPanel();
  });

  return splitPanel;
}

function hideSplitPanel(): void {
  splitPanel?.classList.add("hidden");
}

function openSplitPanel(view: EditorView, button: HTMLElement): void {
  const panel = ensureSplitPanel(view);
  const rect = button.getBoundingClientRect();
  panel.style.left = `${Math.round(rect.left)}px`;
  panel.style.top = `${Math.round(rect.bottom + 4)}px`;
  panel.classList.remove("hidden");

  const cols = el<HTMLInputElement>("table-split-cols");
  cols?.focus();
  cols?.select();
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
  el("tbl-header")?.addEventListener("click", () => run(view, toggleHeaderRow));
  el("tbl-delete")?.addEventListener("click", () => run(view, deleteTable));

  el("tbl-split")?.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLElement;
    if (splitPanel && !splitPanel.classList.contains("hidden")) hideSplitPanel();
    else openSplitPanel(view, button);
  });
}
