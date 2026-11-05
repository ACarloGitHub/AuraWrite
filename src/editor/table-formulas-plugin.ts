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
import type { EditorView } from "prosemirror-view";
import { TableMap } from "prosemirror-tables";
import { evaluateFormula, formatCellValue, numericValueOf } from "./table-formula";

/** Quello che la cella scrive quando la sua formula non si può calcolare. */
export const FORMULA_ERROR = "** Expression is faulty **";

interface CellEdit {
  /** Position of the cell node's content start. */
  pos: number;
  text: string;
}

interface AttrEdit {
  /** Position of the cell node itself. */
  pos: number;
  attrs: Record<string, unknown>;
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
export function recomputeTables(doc: PMNode, tr: Transaction, skip?: ReadonlySet<number>): boolean {
  const edits: CellEdit[] = [];
  const attrEdits: AttrEdit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const table = node;
    const map = TableMap.get(table);
    // Il valore di una cella: il suo numero, il risultato della sua formula, o
    // niente. `busy` è la catena in corso: rivedere una cella già in cammino è un
    // ciclo, e un ciclo vale niente.
    const cache = new Map<number, number | null>();
    const busy = new Set<number>();
    // The number a formatted cell keeps behind its text, valid only while the
    // text is still the one written for it. A date's text cannot be read back as
    // a number, so without this a date could not take part in a formula.
    const storedValueOf = (cell: PMNode): number | null => {
      const stored = typeof cell.attrs.cellValue === "number" ? cell.attrs.cellValue : null;
      return stored !== null && cell.attrs.cellText === cell.textContent ? stored : null;
    };
    const valueOf = (cellPos: number): number | null => {
      if (cache.has(cellPos)) return cache.get(cellPos) ?? null;
      const cell = table.nodeAt(cellPos);
      if (!cell) return null;
      const formula = formulaOf(cell);
      if (!formula) {
        const value = storedValueOf(cell) ?? numericValueOf(cell.textContent);
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
    const newAttrs: { cellPos: number; attrs: Record<string, unknown> }[] = [];
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      // Le celle la cui formula l'utente ha appena cancellato non si ricalcolano:
      // il loro testo ora è roba sua.
      if (skip?.has(pos + 1 + cellPos)) continue;
      const cell = table.nodeAt(cellPos);
      if (!cell) continue;
      const formula = formulaOf(cell);
      const format = formatOf(cell);
      if (!formula && !format) {
        // Niente da scrivere: un numero rimasto da un formato tolto se ne va.
        if (cell.attrs.cellValue !== null || cell.attrs.cellText !== null) {
          newAttrs.push({ cellPos, attrs: { ...cell.attrs, cellValue: null, cellText: null } });
        }
        continue;
      }
      let value: number | null;
      if (formula) {
        value = valueOf(cellPos);
      } else {
        // Senza formula, il formato si applica al numero che c'è scritto. Il
        // numero conservato vale solo finché il testo è ancora quello scritto
        // per lui: se il writer l'ha toccato, il testo è la verità.
        value = storedValueOf(cell) ?? numericValueOf(cell.textContent);
        if (value === null) continue;
      }
      const text = value === null ? FORMULA_ERROR : formatCellValue(value, format);
      const attrs = { ...cell.attrs, cellValue: value, cellText: value === null ? null : text };
      if (text !== cell.textContent) newTexts.push({ cellPos, text });
      if (cell.attrs.cellValue !== attrs.cellValue || cell.attrs.cellText !== attrs.cellText) {
        newAttrs.push({ cellPos, attrs });
      }
    }
    for (const { cellPos, text } of newTexts) {
      edits.push({ pos: pos + 1 + cellPos + 1, text });
    }
    for (const { cellPos, attrs } of newAttrs) {
      attrEdits.push({ pos: pos + 1 + cellPos, attrs });
    }
    // Dentro le celle non ci sono altre tabelle da contare per il ricalcolo.
    return false;
  });

  // First the attributes: they do not change the document's size, so every text
  // position collected on the untouched document stays valid.
  for (const edit of attrEdits) {
    tr.setNodeMarkup(edit.pos, undefined, edit.attrs);
  }
  edits.sort((a, b) => b.pos - a.pos);
  for (const edit of edits) {
    const $pos = doc.resolve(edit.pos);
    const cell = $pos.parent;
    const schema = doc.type.schema;
    const first = cell.firstChild;
    const replacement = edit.text ? [schema.text(edit.text)] : [];
    // Si riscrive il TESTO del primo paragrafo, non tutta la cella: sostituire il
    // contenuto intero mandava il cursore sul confine della cella, e il confine è
    // già la cella dopo — il «0 nella cella a fianco» nasceva da qui.
    if (first && first.type.name === "paragraph") {
      const textStart = edit.pos + 1;
      tr.replaceWith(textStart, textStart + first.content.size, replacement);
      // Una cella con più blocchi tiene il primo e perde gli altri: il risultato è
      // un numero, non un testo lungo.
      if (cell.childCount > 1) {
        const firstSize = first.nodeSize - first.content.size + replacement.reduce((n, node) => n + node.nodeSize, 0);
        tr.delete(edit.pos + firstSize, edit.pos + cell.content.size);
      }
    } else {
      const paragraph = schema.nodes.paragraph;
      if (!paragraph) continue;
      tr.replaceWith(edit.pos, edit.pos + cell.content.size, paragraph.create({}, replacement));
    }
  }
  return edits.length > 0 || attrEdits.length > 0;
}

/**
 * La formula se ne va quando il testo si accorcia: se l'utente cancella dentro
 * una cella calcolata, la cella torna sua e non si ricalcola più. È il
 * comportamento di Word, dove il campo e il suo testo sono la stessa cosa.
 *
 * Il confronto è sulla lunghezza perché il ricalcolo riscrive il testo a ogni
 * battuta: cancellando un carattere alla volta la cella non sarebbe mai vuota —
 * il risultato tornerebbe prima — e la formula resterebbe lì per sempre.
 */
export function dropFormulasOfEditedCells(
  doc: PMNode,
  transactions: readonly Transaction[],
  tr: Transaction,
): Set<number> {
  const done = new Set<number>();
  for (const source of transactions) {
    if (!source.docChanged) continue;
    // A language rewrite is ours, not the writer's: the text it changes is still
    // our own formatting, so the number behind it and the formula must stay.
    if (source.getMeta("formats-rewrite")) continue;
    const inverse = source.mapping.invert();
    doc.descendants((node, pos) => {
      if (node.type.name !== "table") return true;
      const map = TableMap.get(node);
      const seen = new Set<number>();
      for (const cellPos of map.map) {
        if (seen.has(cellPos)) continue;
        seen.add(cellPos);
        const cell = node.nodeAt(cellPos);
        if (!cell) continue;
        const abs = pos + 1 + cellPos;
        if (done.has(abs)) continue;
        const oldCell = source.before.nodeAt(inverse.map(abs));
        if (!oldCell) continue;
        // Il testo non è cambiato: nessuno l'ha toccato.
        if (cell.textContent === oldCell.textContent) continue;
        // The writer touched the cell: the number a format kept behind the text
        // no longer matches it, and a formula goes only when the text shrank
        // (a deletion) — the same rule that has always dropped formulas.
        const dropFormula = !!formulaOf(cell) &&
          cell.textContent.length < oldCell.textContent.trim().length;
        const clearValue = cell.attrs.cellValue !== null || cell.attrs.cellText !== null;
        if (!dropFormula && !clearValue) continue;
        const attrs: Record<string, unknown> = {
          ...cell.attrs,
          ...(clearValue ? { cellValue: null, cellText: null } : {}),
          ...(dropFormula ? { formula: null } : {}),
        };
        tr.setNodeMarkup(abs, undefined, attrs);
        if (dropFormula) done.add(abs);
      }
      return false;
    });
  }
  return done;
}

/**
 * Rewrite every formatted cell in the language now in force: the preference
 * changed, or (later) the document's own language did. Unlike the typing path
 * this is a real edit - it goes into the undo history and marks the document
 * modified, because the writer asked for it.
 */
export function reformatTables(view: EditorView): boolean {
  const tr = view.state.tr.setMeta("formats-rewrite", true);
  if (!recomputeTables(view.state.doc, tr)) return false;
  view.dispatch(tr);
  return true;
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
      const dropped = dropFormulasOfEditedCells(state.doc, transactions, tr);
      if (!recomputeTables(state.doc, tr, dropped) && dropped.size === 0) return null;
      return tr.setMeta("addToHistory", false);
    },
  });
}
