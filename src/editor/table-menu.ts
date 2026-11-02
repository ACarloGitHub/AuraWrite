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
import type { Node as PMNode } from "prosemirror-model";
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
  setCellAttr,
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

/** The cell the caret sits in, if any. */
function cellAt(view: EditorView): PMNode | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table_cell" || node.type.name === "table_header") return node;
  }
  return null;
}

/**
 * "#rrggbb" for the colour input. The attribute may hold an `rgb(...)` string:
 * that is what `prosemirror-tables` reads off a cell that came from markup.
 */
function toHex(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split("").map((c) => c + c).join("")}`.toLowerCase();
  }
  return null;
}

function ensureSplitPanel(view: EditorView): HTMLElement {
  if (splitPanel) return splitPanel;

  splitPanel = document.createElement("div");
  splitPanel.className = "table-dropdown table-split-panel hidden";
  splitPanel.innerHTML =
    '<label class="table-picker-field">Cols <input id="table-split-cols" type="text" inputmode="numeric" value="2" /></label>' +
    '<label class="table-picker-field">Rows <input id="table-split-rows" type="text" inputmode="numeric" value="1" /></label>' +
    '<button id="table-split-apply" type="button" class="table-picker-apply">Reorganise</button>';
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
  el("tbl-delete")?.addEventListener("click", () => run(view, deleteTable));

  // The fill of the selected cells: a colour input plus the × that clears it.
  el("tbl-bg")?.addEventListener("input", (event) => {
    run(view, setCellAttr("backgroundColor", (event.target as HTMLInputElement).value));
  });
  el("tbl-bg-clear")?.addEventListener("click", () => {
    run(view, setCellAttr("backgroundColor", null));
  });

  // Where the text sits in the cell: top (the default, stored as null), middle or
  // bottom — Word's w:vAlign.
  el("tbl-valign")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    run(view, setCellAttr("verticalAlign", value === "top" ? null : value));
  });

  el("tbl-split")?.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLElement;
    if (splitPanel && !splitPanel.classList.contains("hidden")) hideSplitPanel();
    else openSplitPanel(view, button);
  });
}

/** Show the fill of the cell under the caret in the bar's swatch. */
export function syncTableMenu(view: EditorView): void {
  const input = el<HTMLInputElement>("tbl-bg");
  const clear = el("tbl-bg-clear");
  const align = el<HTMLSelectElement>("tbl-valign");
  if (!input && !align) return;
  const cell = cellAt(view);
  if (!cell) return;

  const hex = toHex(cell.attrs.backgroundColor);
  if (input) {
    input.value = hex ?? "#ffffff";
    if (clear) clear.hidden = hex === null;
  }
  if (align) {
    const value = cell.attrs.verticalAlign;
    align.value = value === "middle" || value === "bottom" ? value : "top";
  }
}
