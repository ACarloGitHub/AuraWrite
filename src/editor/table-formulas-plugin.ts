// ============================================================================
// Ricalcolo delle formule di cella.
//
// Una cella con una formula (`=SUM(ABOVE)`) tiene il suo testo come RISULTATO: la
// formula vive nell'attributo `formula`, il numero nel testo. Così la misura, il
// foglio di stampa e Word vedono un numero e non devono calcolare niente; qui il
// risultato si tiene aggiornato — quando un valore cambia, i totali cambiano.
//
// Si ricalcola il testo solo quando è diverso: un secondo giro non scrive nulla,
// niente cicli, e il cursore non viene toccato dove non serve. La stessa strada
// applica il formato numerico alle celle che ne hanno uno (anche senza formula).
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { TableMap } from "prosemirror-tables";
import { evaluateFormula, formatCellValue, numericValueOf, type CellGrid } from "./table-formula";

interface CellEdit {
  /** Position of the cell node's content start. */
  pos: number;
  text: string;
}

/** The text a cell should hold: its formula's result, or its number as formatted. */
function desiredText(cell: PMNode, grid: CellGrid, at: { row: number; col: number }): string | null {
  const formula = typeof cell.attrs.formula === "string" ? cell.attrs.formula : null;
  if (formula) {
    const value = evaluateFormula(formula, grid, at);
    return value === null ? null : formatCellValue(value, cell.attrs.cellFormat);
  }
  const format = typeof cell.attrs.cellFormat === "string" ? cell.attrs.cellFormat : null;
  if (format) {
    const value = numericValueOf(cell.textContent);
    if (value !== null) return formatCellValue(value, format);
  }
  return null;
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
    const map = TableMap.get(node);
    const grid: CellGrid = [];
    for (let row = 0; row < map.height; row++) {
      const line: string[] = [];
      for (let col = 0; col < map.width; col++) {
        line.push(node.nodeAt(map.map[row * map.width + col])?.textContent ?? "");
      }
      grid.push(line);
    }
    const seen = new Set<number>();
    for (const cellPos of map.map) {
      if (seen.has(cellPos)) continue;
      seen.add(cellPos);
      const cell = node.nodeAt(cellPos);
      if (!cell) continue;
      if (!cell.attrs.formula && !cell.attrs.cellFormat) continue;
      const found = map.findCell(cellPos);
      const text = desiredText(cell, grid, { row: found.top, col: found.left });
      if (text === null || text === cell.textContent) continue;
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
 * number typed, a row added, a table edited) brings the totals up to date.
 */
export function createTableFormulasPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("tableFormulas"),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = state.tr;
      return recomputeTables(state.doc, tr) ? tr : null;
    },
  });
}
