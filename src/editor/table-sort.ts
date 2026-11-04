// ============================================================================
// Ordinamento delle righe di una tabella.
//
// Una tabella si ordina per una colonna, in su o in giù, come testo o come numero
// (con il numero «9» che viene prima di «10», cosa che come testo non succede).
// La riga di intestazione resta in cima; le righe di corpo si riordinano tutte
// intere, con i loro attributi, il loro formato e i loro riquadri.
//
// L'ordinamento è **stabile**: due righe con la stessa chiave restano nell'ordine
// in cui erano. È quello che permette le tre chiavi senza costruirle: si ordina
// prima la meno importante, poi la più importante, e il risultato è lo stesso di
// un ordinamento a tre chiavi (Word e LibreOffice fanno così).
//
// Una tabella con celle unite in verticale non si ordina: le righe non sono più
// intercambiabili, e il risultato sarebbe una tabella rotta. Il comando rifiuta
// invece di indovinare.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { TableMap } from "prosemirror-tables";
import { numericValueOf } from "./table-formula";

export type SortDirection = "asc" | "desc";
export type SortType = "text" | "number";

export interface SortSpec {
  /** 0-based column the sort reads. */
  column: number;
  direction: SortDirection;
  type: SortType;
}

/**
 * Un testo si confronta all'italiana, lettera per lettera: «10» viene prima di
 * «3», come nell'ordinamento per testo di Word. Chi vuole i numeri in ordine li
 * ordina come numeri.
 */
const COLLATOR = new Intl.Collator("it", { sensitivity: "base" });

/** La posizione della riga di testa, se la tabella ne ha una. */
function headerRowIndex(table: PMNode): number {
  const first = table.firstChild;
  if (!first || first.childCount === 0) return -1;
  let header = true;
  first.forEach((cell) => {
    if (cell.type.name !== "table_header") header = false;
  });
  return header ? 0 : -1;
}

/** Le celle di ogni riga nell'ordine della griglia, con la loro colonna d'inizio. */
function rowCells(row: PMNode): { cell: PMNode; start: number; span: number; rowspan: number }[] {
  const cells: { cell: PMNode; start: number; span: number; rowspan: number }[] = [];
  let col = 0;
  row.forEach((cell) => {
    const span = Math.max(1, Number(cell.attrs.colspan) || 1);
    const rowspan = Math.max(1, Number(cell.attrs.rowspan) || 1);
    cells.push({ cell, start: col, span, rowspan });
    col += span;
  });
  return cells;
}

/** Il testo che una riga ha nella colonna della chiave, o `null` se non la copre. */
function keyTextOf(row: PMNode, column: number): string | null {
  for (const { cell, start, span } of rowCells(row)) {
    if (column >= start && column < start + span) return cell.textContent;
  }
  return null;
}

/**
 * La tabella con le righe di corpo ordinate, o `null` quando non si può: colonna
 * che non esiste, tabella con celle unite in verticale.
 */
export function sortTableRows(table: PMNode, spec: SortSpec): PMNode | null {
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  const header = headerRowIndex(table);
  const body = rows.slice(header + 1);
  if (body.length < 2) return table;

  // Una cella che copre più righe tiene insieme righe che l'ordinamento vorrebbe
  // separate: qui non si prova nemmeno.
  for (const row of body) {
    for (const { rowspan } of rowCells(row)) if (rowspan > 1) return null;
  }
  if (spec.column < 0 || spec.column >= TableMap.get(table).width) return null;

  const keyed = body.map((row, index) => {
    const text = keyTextOf(row, spec.column) ?? "";
    const number = spec.type === "number" ? numericValueOf(text) : null;
    return { row, index, text, number };
  });

  keyed.sort((a, b) => {
    let order: number;
    if (spec.type === "number") {
      // Un numero manca? Va in fondo, sempre, in tutti e due i versi.
      const aMissing = a.number === null;
      const bMissing = b.number === null;
      if (aMissing && bMissing) order = a.index - b.index;
      else if (aMissing) return 1;
      else if (bMissing) return -1;
      else order = (a.number ?? 0) - (b.number ?? 0);
    } else {
      order = COLLATOR.compare(a.text, b.text);
    }
    if (order === 0) order = a.index - b.index; // stabile
    return spec.direction === "asc" ? order : -order;
  });

  const ordered = keyed.map((entry) => entry.row);
  return table.type.create(table.attrs, header >= 0 ? [rows[header], ...ordered] : ordered);
}
