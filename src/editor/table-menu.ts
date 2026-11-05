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
import { TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  selectedRect,
  setCellAttr,
  isInTable,
} from "prosemirror-tables";
import { splitCellInto } from "./table-split";
import { hideBordersPanel, toggleBordersPanel } from "./table-borders-panel";
import { sortTableRows, type SortDirection, type SortSpec, type SortType } from "./table-sort";
import { columnName, numericValueOf } from "./table-formula";
import { cellPaddingOf, type CellPadding } from "./table-padding";
import {
  insertColumnAfter,
  insertColumnBefore,
  insertRowAfter,
  insertRowBefore,
} from "./table-insert";

const MIN_SPLIT = 1;
const MAX_SPLIT = 20;

let splitPanel: HTMLElement | null = null;

/**
 * La cella su cui il campo della formula sta lavorando: si prende quando il campo
 * riceve il fuoco, e da lì in poi è quella. Senza, il secondo scatto (l'uscita dal
 * campo, che segue l'Invio) applicava la formula alla cella dove il cursore era
 * finito nel frattempo — cioè quella accanto.
 */
let formulaTarget: number | null = null;

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

// ---------------------------------------------------------------------------
// Ordinamento: una colonna, un verso, un tipo. Ripetendo il comando su un'altra
// colonna si ottiene l'ordinamento a più chiavi, perché l'ordinamento è stabile
// (table-sort.ts).
// ---------------------------------------------------------------------------

let sortPanel: HTMLElement | null = null;

function ensureSortPanel(view: EditorView): HTMLElement {
  if (sortPanel) return sortPanel;

  sortPanel = document.createElement("div");
  sortPanel.className = "table-dropdown table-sort-panel hidden";
  sortPanel.innerHTML =
    '<label class="table-picker-field">Column <select id="tbl-sort-column" class="table-picker-select"></select></label>' +
    '<label class="table-picker-field">Order <select id="tbl-sort-direction" class="table-picker-select">' +
    '<option value="asc">A → Z</option><option value="desc">Z → A</option></select></label>' +
    '<label class="table-picker-field">As <select id="tbl-sort-type" class="table-picker-select">' +
    '<option value="text">Text</option><option value="number">Number</option></select></label>' +
    '<button id="tbl-sort-apply" type="button" class="table-picker-apply">Sort</button>';
  document.body.appendChild(sortPanel);

  const apply = () => {
    const column = Number(el<HTMLSelectElement>("tbl-sort-column")?.value ?? "0");
    const direction = (el<HTMLSelectElement>("tbl-sort-direction")?.value ?? "asc") as SortDirection;
    const type = (el<HTMLSelectElement>("tbl-sort-type")?.value ?? "text") as SortType;
    sortTable(view, { column, direction, type });
    hideSortPanel();
  };

  sortPanel.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("#tbl-sort-apply")) {
      event.preventDefault();
      apply();
    }
  });
  sortPanel.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSortPanel();
      view.focus();
    }
  });
  document.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!sortPanel || sortPanel.classList.contains("hidden")) return;
    if (target.closest("#tbl-sort") || sortPanel.contains(target)) return;
    hideSortPanel();
  });

  return sortPanel;
}

function hideSortPanel(): void {
  sortPanel?.classList.add("hidden");
}

/** Riempie la colonna e il verso con quelli della cella sotto il cursore. */
function openSortPanel(view: EditorView, button: HTMLElement): void {
  const panel = ensureSortPanel(view);
  const { state } = view;
  const rect = selectedRect(state);
  const columns = el<HTMLSelectElement>("tbl-sort-column");
  if (columns) {
    columns.innerHTML = "";
    for (let col = 0; col < rect.map.width; col++) {
      const option = document.createElement("option");
      option.value = String(col);
      option.textContent = columnName(col);
      columns.appendChild(option);
    }
    // La colonna del cursore, se si riesce a leggerla: la scelta più probabile.
    let caretCol = 0;
    const $from = state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === "table_cell" || node.type.name === "table_header") {
        caretCol = rect.map.colCount($from.before(depth) - rect.tableStart);
        break;
      }
    }
    columns.value = String(Math.max(0, Math.min(rect.map.width - 1, caretCol)));
  }
  const box = button.getBoundingClientRect();
  panel.style.left = `${Math.round(box.left)}px`;
  panel.style.top = `${Math.round(box.bottom + 4)}px`;
  panel.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Riempimento interno: quattro campi in cm, il valore della tabella o quello di
// Word. Un campo vuoto o sbagliato non passa: la cella non può diventare più
// larga del foglio per un numero sbagliato (table-padding.ts).
// ---------------------------------------------------------------------------

let paddingPanel: HTMLElement | null = null;

function readPaddingField(id: string, fallback: number): number {
  const raw = el<HTMLInputElement>(id)?.value.trim().replace(",", ".") ?? "";
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(5, Math.round(value * 100) / 100));
}

function ensurePaddingPanel(view: EditorView): HTMLElement {
  if (paddingPanel) return paddingPanel;

  paddingPanel = document.createElement("div");
  paddingPanel.className = "table-dropdown table-padding-panel hidden";
  paddingPanel.innerHTML =
    '<label class="table-picker-field">Top <input id="tbl-pad-top" type="text" inputmode="decimal" /></label>' +
    '<label class="table-picker-field">Right <input id="tbl-pad-right" type="text" inputmode="decimal" /></label>' +
    '<label class="table-picker-field">Bottom <input id="tbl-pad-bottom" type="text" inputmode="decimal" /></label>' +
    '<label class="table-picker-field">Left <input id="tbl-pad-left" type="text" inputmode="decimal" /></label>' +
    '<button id="tbl-pad-apply" type="button" class="table-picker-apply">Apply</button>' +
    '<button id="tbl-pad-reset" type="button" class="table-picker-apply table-picker-apply--quiet" title="Il margine di Word">Default</button>';
  document.body.appendChild(paddingPanel);

  paddingPanel.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#tbl-pad-apply")) {
      event.preventDefault();
      run(view, setTablePadding({
        top: readPaddingField("tbl-pad-top", 0),
        right: readPaddingField("tbl-pad-right", 0.19),
        bottom: readPaddingField("tbl-pad-bottom", 0),
        left: readPaddingField("tbl-pad-left", 0.19),
      }));
      hidePaddingPanel();
    } else if (target.closest("#tbl-pad-reset")) {
      event.preventDefault();
      run(view, setTablePadding(null));
      hidePaddingPanel();
    }
  });
  paddingPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hidePaddingPanel();
      view.focus();
    }
  });
  document.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement;
    if (!paddingPanel || paddingPanel.classList.contains("hidden")) return;
    if (target.closest("#tbl-padding") || paddingPanel.contains(target)) return;
    hidePaddingPanel();
  });

  return paddingPanel;
}

function hidePaddingPanel(): void {
  paddingPanel?.classList.add("hidden");
}

function openPaddingPanel(view: EditorView, button: HTMLElement): void {
  const panel = ensurePaddingPanel(view);
  const table = tableAt(view);
  const padding = cellPaddingOf(table?.attrs ?? {});
  const set = (id: string, value: number): void => {
    const input = el<HTMLInputElement>(id);
    if (input) input.value = String(value);
  };
  set("tbl-pad-top", padding.top);
  set("tbl-pad-right", padding.right);
  set("tbl-pad-bottom", padding.bottom);
  set("tbl-pad-left", padding.left);
  const box = button.getBoundingClientRect();
  panel.style.left = `${Math.round(box.left)}px`;
  panel.style.top = `${Math.round(box.bottom + 4)}px`;
  panel.classList.remove("hidden");
}

/** The body rows of the table under the caret, sorted by one column. */
function sortTable(view: EditorView, spec: SortSpec): void {
  const { state } = view;
  if (!isInTable(state)) return;
  const rect = selectedRect(state);
  const tablePos = rect.tableStart - 1;
  const table = state.doc.nodeAt(tablePos);
  if (!table) return;
  const sorted = sortTableRows(table, spec);
  if (!sorted || sorted === table) return;
  view.dispatch(state.tr.replaceWith(tablePos, tablePos + table.nodeSize, sorted));
  view.focus();
}

/**
 * A table's title and note are ordinary paragraphs, before and after the table,
 * marked with `tableCaption`. That is how the figure's caption works too: a piece
 * of text that belongs to the object, moves with it and exports as text — no new
 * node, nothing to keep in step.
 */
function ensureCaption(view: EditorView, kind: "title" | "note"): void {
  const { state } = view;
  const { $from } = state.selection;

  let depth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "table") { depth = d; break; }
  }
  if (depth < 0) return;

  const table = $from.node(depth);
  const tablePos = $from.before(depth);
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return;

  // Already there: the caret goes into it, which is also how it is edited.
  const neighbour = kind === "title"
    ? state.doc.resolve(tablePos).nodeBefore
    : state.doc.resolve(tablePos + table.nodeSize).nodeAfter;
  if (neighbour && neighbour.type.name === "paragraph" && neighbour.attrs.tableCaption === kind) {
    const start = kind === "title" ? tablePos - neighbour.nodeSize : tablePos + table.nodeSize;
    const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(start + 2)));
    view.dispatch(tr);
    view.focus();
    return;
  }

  const insertAt = kind === "title" ? tablePos : tablePos + table.nodeSize;
  const tr = state.tr.insert(insertAt, paragraph.create({ tableCaption: kind }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
  view.dispatch(tr);
  view.focus();
}

/** The table the caret sits in, if any. */
function tableAt(view: EditorView): PMNode | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return node;
  }
  return null;
}

/** Il riempimento interno della tabella (o null = il margine di Word). */
function setTablePadding(padding: CellPadding | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const tablePos = rect.tableStart - 1;
    const table = state.doc.nodeAt(tablePos);
    if (!table) return false;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, cellPadding: padding }));
    }
    return true;
  };
}

/** Lo stile dell'intera tabella: vive sull'attributo del nodo, il disegno è nel CSS. */
function setTableStyle(style: string | null): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const tablePos = rect.tableStart - 1;
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.attrs.tableStyle === style) return false;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, tableStyle: style }));
    }
    return true;
  };
}

/** La posizione della cella sotto il cursore, se c'è. */
function cellPosAt(view: EditorView): number | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      return $from.before(depth);
    }
  }
  return null;
}

/**
 * La formula di UNA cella, indicata per posizione. Il cursore resta dove sta:
 * scrivendo il risultato il testo della cella cambia, e senza questo il cursore
 * scivolava nella cella accanto.
 */
function setFormulaAt(cellPos: number, formula: string | null): Command {
  return (state, dispatch) => {
    const cell = state.doc.nodeAt(cellPos);
    if (!cell) return false;
    if ((cell.attrs.formula ?? null) === formula) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, formula });
      // Il cursore resta nella cella. `TextSelection.near` guarda in AVANTI e
      // trova il primo testo libero, che è quello della cella accanto: con il
      // cursore nella cella sbagliata, il secondo scatto (l'uscita dal campo) e
      // l'idea di «dove sono» finivano nella cella a fianco.
      const end = Math.min(cellPos + 1 + cell.content.size - 1, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Toglie la formula e il formato da UNA cella e svuota il testo che la formula
 * aveva scritto: il numero era il risultato di un calcolo, non una cosa digitata.
 */
function clearCellAt(cellPos: number): Command {
  return (state, dispatch) => {
    const cell = state.doc.nodeAt(cellPos);
    if (!cell) return false;
    if (!cell.attrs.formula && !cell.attrs.cellFormat) return false;
    if (dispatch) {
      const tr = state.tr;
      tr.replaceWith(cellPos + 1, cellPos + cell.nodeSize - 1, state.schema.nodes.paragraph.create());
      tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, formula: null, cellFormat: null });
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(cellPos + 2, tr.doc.content.size))));
      dispatch(tr);
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Il vocabolario delle formule, nella barra: una funzione, una direzione, e il
// bottone Σ che fa la cosa più comune in un clic. La direzione si propone da sé
// guardando dove sono i numeri — sopra, a sinistra, a destra, sotto — così `A1` e
// `ABOVE` non vanno saputi a memoria.
// ---------------------------------------------------------------------------

export type AggregateDirection = "ABOVE" | "BELOW" | "LEFT" | "RIGHT";

/** Quanti numeri di fila ci sono in una direzione, fermandosi al primo che non lo è. */
function runOfNumbers(
  table: PMNode,
  map: { width: number; height: number; map: number[] },
  row: number,
  col: number,
  stepRow: number,
  stepCol: number,
): number {
  let count = 0;
  for (let r = row, c = col; r >= 0 && r < map.height && c >= 0 && c < map.width; r += stepRow, c += stepCol) {
    const cell = table.nodeAt(map.map[r * map.width + c]);
    if (numericValueOf(cell?.textContent ?? "") === null) break;
    count += 1;
  }
  return count;
}

/** La direzione in cui ci sono numeri, cominciando da sopra: è la proposta. */
export function guessDirection(view: EditorView): AggregateDirection {
  if (!isInTable(view.state)) return "ABOVE";
  const rect = selectedRect(view.state);
  const table = view.state.doc.nodeAt(rect.tableStart - 1);
  if (!table) return "ABOVE";
  if (runOfNumbers(table, rect.map, rect.top - 1, rect.left, -1, 0) > 0) return "ABOVE";
  if (runOfNumbers(table, rect.map, rect.top, rect.left - 1, 0, -1) > 0) return "LEFT";
  if (runOfNumbers(table, rect.map, rect.top, rect.left + 1, 0, 1) > 0) return "RIGHT";
  if (runOfNumbers(table, rect.map, rect.top + 1, rect.left, 1, 0) > 0) return "BELOW";
  return "ABOVE";
}

/** Applica una funzione aggregata alla direzione scelta, sulla cella del campo. */
function applyAggregate(view: EditorView, fn: string, direction: AggregateDirection): void {
  const cellPos = formulaTarget ?? cellPosAt(view);
  if (cellPos === null) return;
  run(view, setFormulaAt(cellPos, `${fn}(${direction})`));
  const input = el<HTMLInputElement>("tbl-formula");
  if (input) {
    input.value = `=${fn}(${direction})`;
    formulaTarget = cellPos;
  }
}

/** Bind the table's own controls once. */
export function setupTableMenu(view: EditorView): void {
  el("tbl-row-before")?.addEventListener("click", () => run(view, insertRowBefore));
  el("tbl-row-after")?.addEventListener("click", () => run(view, insertRowAfter));
  el("tbl-row-delete")?.addEventListener("click", () => run(view, deleteRow));

  el("tbl-col-before")?.addEventListener("click", () => run(view, insertColumnBefore));
  el("tbl-col-after")?.addEventListener("click", () => run(view, insertColumnAfter));
  el("tbl-col-delete")?.addEventListener("click", () => run(view, deleteColumn));

  el("tbl-merge")?.addEventListener("click", () => run(view, mergeCells));
  el("tbl-delete")?.addEventListener("click", () => run(view, deleteTable));

  // The fill of the selected cells: a colour input plus the × that clears it.
  el("tbl-bg")?.addEventListener("input", (event) => {
    run(view, setCellAttr("backgroundColor", (event.target as HTMLInputElement).value));
  });
  el("tbl-bg-clear")?.addEventListener("click", () => {
    // The empty string is "no fill, explicitly" (the schema's "no colour"), not
    // "unset": a header cell with no attribute takes the default tint again.
    run(view, setCellAttr("backgroundColor", ""));
  });

  // The borders of the selected cells: a panel with the pen and the presets
  // (table-borders-panel.ts), because ten presets do not fit in the bar.
  el("tbl-borders")?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleBordersPanel(view, event.currentTarget as HTMLElement);
  });

  // Where the text sits in the cell: top (the default, stored as null), middle or
  // bottom — Word's w:vAlign.
  el("tbl-valign")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    run(view, setCellAttr("verticalAlign", value === "top" ? null : value));
  });

  // La formula della cella: si applica con Invio o uscendo dal campo, e il
  // risultato lo scrive il plugin (table-formulas-plugin.ts). Il formato sceglie
  // come si scrive il numero, che ci sia una formula o no.
  //
  // La cella si prende PRIMA di applicare: applicare il risultato sposta il
  // cursore (il testo della cella è riscritto), e con il cursore spostato il
  // secondo scatto — l'uscita dal campo, che segue l'Invio — metteva la formula
  // nella cella accanto.
  const formulaInput = el<HTMLInputElement>("tbl-formula");
  const applyFormula = (): void => {
    const value = formulaInput?.value.trim() ?? "";
    const cellPos = formulaTarget ?? cellPosAt(view);
    if (cellPos === null) return;
    run(view, setFormulaAt(cellPos, value || null));
  };
  // Il fuoco fissa la cella: da qui in poi il campo scrive su quella, anche se il
  // cursore nell'editor si muove perché il risultato è stato riscritto.
  formulaInput?.addEventListener("focus", () => {
    formulaTarget = cellPosAt(view);
  });
  formulaInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFormula();
    } else if (event.key === "Escape") {
      event.preventDefault();
      formulaInput.value = "";
      view.focus();
    }
  });
  formulaInput?.addEventListener("blur", applyFormula);
  // Σ: somma quello che sta sopra (o dove sono i numeri), in un clic.
  el("tbl-sum")?.addEventListener("click", (event) => {
    event.preventDefault();
    applyAggregate(view, "SUM", guessDirection(view));
  });
  // Funzione e direzione: il vocabolario si sceglie, non si scrive.
  const applyChosen = (): void => {
    const fn = el<HTMLSelectElement>("tbl-fn")?.value ?? "SUM";
    const direction = (el<HTMLSelectElement>("tbl-dir")?.value ?? "ABOVE") as AggregateDirection;
    applyAggregate(view, fn, direction);
  };
  el("tbl-fn")?.addEventListener("change", applyChosen);
  el("tbl-dir")?.addEventListener("change", applyChosen);
  el("tbl-formula-clear")?.addEventListener("click", () => {
    if (formulaInput) formulaInput.value = "";
    const cellPos = formulaTarget ?? cellPosAt(view);
    if (cellPos !== null) run(view, clearCellAt(cellPos));
  });
  el("tbl-format")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    run(view, setCellAttr("cellFormat", value === "general" ? null : value));
  });

  // Lo stile dell'intera tabella: griglia com'è, senza linee, o a bande.
  el("tbl-style")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    run(view, setTableStyle(value || null));
  });

  el("tbl-split")?.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLElement;
    if (splitPanel && !splitPanel.classList.contains("hidden")) hideSplitPanel();
    else openSplitPanel(view, button);
  });

  el("tbl-sort")?.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLElement;
    if (sortPanel && !sortPanel.classList.contains("hidden")) hideSortPanel();
    else openSortPanel(view, button);
  });

  el("tbl-padding")?.addEventListener("click", (event) => {
    event.preventDefault();
    const button = event.currentTarget as HTMLElement;
    if (paddingPanel && !paddingPanel.classList.contains("hidden")) hidePaddingPanel();
    else openPaddingPanel(view, button);
  });

  el("tbl-title")?.addEventListener("click", () => ensureCaption(view, "title"));
  el("tbl-note")?.addEventListener("click", () => ensureCaption(view, "note"));
}

/** Show the fill of the cell under the caret in the bar's swatch. */
export function syncTableMenu(view: EditorView): void {
  const input = el<HTMLInputElement>("tbl-bg");
  const clear = el("tbl-bg-clear");
  const align = el<HTMLSelectElement>("tbl-valign");
  const formula = el<HTMLInputElement>("tbl-formula");
  const format = el<HTMLSelectElement>("tbl-format");
  const tableStyle = el<HTMLSelectElement>("tbl-style");
  // A panel left open over a table that is no longer selected would paint a
  // table the caret has left.
  if (!isInTable(view.state)) hideBordersPanel();
  if (!input && !align && !formula) return;
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
  // Il campo della formula non si tocca mentre lo si scrive: la sinfonia a ogni
  // transazione lo cancellerebbe a metà parola.
  if (formula && document.activeElement !== formula) {
    formula.value = typeof cell.attrs.formula === "string" ? cell.attrs.formula : "";
    // Con il campo a riposo la cella di lavoro è quella del cursore: è quella che
    // il campo mostrerà.
    formulaTarget = cellPosAt(view);
  }
  // La direzione proposta si legge dalla tabella, e il campo la mostra come
  // esempio: è così che `SUM(ABOVE)` si impara senza saperlo.
  const direction = el<HTMLSelectElement>("tbl-dir");
  if (direction && document.activeElement !== formula) {
    direction.value = guessDirection(view);
    if (formula) {
      const fn = el<HTMLSelectElement>("tbl-fn")?.value ?? "SUM";
      formula.placeholder = `=${fn}(${direction.value})`;
    }
  }
  if (format) {
    format.value = typeof cell.attrs.cellFormat === "string" ? cell.attrs.cellFormat : "general";
  }
  if (tableStyle) {
    const table = tableAt(view);
    tableStyle.value = typeof table?.attrs.tableStyle === "string" ? table.attrs.tableStyle : "";
  }
}
