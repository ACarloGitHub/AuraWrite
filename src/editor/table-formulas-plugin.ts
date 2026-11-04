// ============================================================================
// Ricalcolo delle formule di cella.
//
// Una cella con una formula (`=SUM(ABOVE)`) tiene il suo testo come RISULTATO: la
// formula vive nell'attributo `formula`, il numero nel testo. Così la misura, il
// foglio di stampa e Word vedono un numero e non devono calcolare niente; qui il
// risultato si tiene aggiornato — quando un valore cambia, i totali cambiano.
//
// Le formule si risolvono in UNA passata, anche quando una legge l'altra: il
// valore di una cella si chiede ricorsivamente (`valueOf`), con una cache e un
// insieme dei «visitati», così una catena si chiude subito e un ciclo risponde
// con l'errore invece di girare (EdenText `tableFormula.ts` fa lo stesso). Una
// formula che non si calcola scrive l'errore NEL TESTO della cella: il silenzio
// lascerebbe l'utente a chiedersi perché non succede niente.
//
// Il ricalcolo non entra nella storia: annullando, si annulla il numero che
// l'utente ha scritto, non i totali che ne sono seguiti (`addToHistory: false`).
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { TableMap } from "prosemirror-tables";
import { evaluateFormula, formatCellValue, numericValueOf } from "./table-formula";

/** Quello che la cella scrive quando la sua formula non si può calcolare. */
export const FORMULA_ERROR = "** Expression is faulty **";

interface CellEdit {
  /** Position of the cell node's content start. */
  pos: number;
  text: string;
}

/** La formula di una cella, se ne ha una. */
function formulaOf(cell: PMNode): string | null {
  return typeof cell.attrs.formula === "string" && cell.attrs.formula ? cell.attrs.formula : null;
}

/** Il formato numerico della cella, se ne ha uno. */
function formatOf(cell: PMNode): string | null {
  return typeof cell.attrs.cellFormat === "string" && cell.attrs.cellFormat
    ? cell.attrs.cellFormat
    : null;
}

/**
 * Bring every cell that carries a formula (or a number format) up to date; true
 * when something changed. Positions are collected on the untouched document and
 * applied from its END backwards, so one change never moves another.
 */
export function recomputeTables(doc: PMNode, tr: Transaction): boolean {
  const edits: CellEdit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const table = node;
    const map = TableMap.get(table);
    // Il valore di una cella: il suo numero, il risultato della sua formula, o
    // niente. `busy` è la catena in corso: rivedere una cella già in cammino è un
    // ciclo, e un ciclo vale niente.
    const cache = new Map<number, number | null>();
    const busy = new Set<number>();
    const valueOf = (cellPos: number): number | null => {
      if (cache.has(cellPos)) return cache.get(cellPos) ?? null;
      const cell = table.nodeAt(cellPos);
      if (!cell) return null;
      const formula = formulaOf(cell);
      if (!formula) {
        const value = numericValueOf(cell.textContent);
        cache.set(cellPos, value);
        return value;
      }
      if (busy.has(cellPos)) return null;
      busy.add(cellPos);
      const found = map.findCell(cellPos);
      const value = evaluateFormula(formula, { row: found.top, col: found.left }, (row, col) => {
        if (row < 0 || col < 0 || row >= map.height || col >= map.width) return null;
        return valueOf(map.map[row * map.width + col]);
      });
      busy.delete(cellPos);
      cache.set(cellPos, value);
      return value;
    };

    const newTexts: { cellPos: number; text: string }[] = [];
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const cell = table.nodeAt(cellPos);
      if (!cell) continue;
      const formula = formulaOf(cell);
      const format = formatOf(cell);
      if (!formula) {
        // Senza formula, il formato si applica al numero che c'è scritto.
        if (!format) continue;
        const value = numericValueOf(cell.textContent);
        if (value === null) continue;
        const text = formatCellValue(value, format);
        if (text !== cell.textContent) newTexts.push({ cellPos, text });
        continue;
      }
      const value = valueOf(cellPos);
      const text = value === null ? FORMULA_ERROR : formatCellValue(value, format);
      if (text !== cell.textContent) newTexts.push({ cellPos, text });
    }
    for (const { cellPos, text } of newTexts) {
      edits.push({ pos: pos + 1 + cellPos + 1, text });
    }
    // Dentro le celle non ci sono altre tabelle da contare per il ricalcolo.
    return false;
  });

  edits.sort((a, b) => b.pos - a.pos);
  for (const edit of edits) {
    const $pos = doc.resolve(edit.pos);
    const cell = $pos.parent;
    const first = cell.firstChild;
    const paragraph = first && first.type.name === "paragraph"
      ? first.type
      : doc.type.schema.nodes.paragraph;
    if (!paragraph) continue;
    const attrs = first && first.type.name === "paragraph" ? first.attrs : {};
    const content = edit.text ? [doc.type.schema.text(edit.text)] : [];
    tr.replaceWith(edit.pos, edit.pos + cell.content.size, paragraph.create(attrs, content));
  }
  return edits.length > 0;
}

/**
 * Keeps the results and the formats in step with the document: any change (a
 * number typed, a row added, a table edited) brings the totals up to date. The
 * recalculation stays out of the undo history, so one Ctrl+Z undoes what the
 * writer did and not the totals that followed.
 */
export function createTableFormulasPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("tableFormulas"),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = state.tr;
      if (!recomputeTables(state.doc, tr)) return null;
      return tr.setMeta("addToHistory", false);
    },
  });
}
