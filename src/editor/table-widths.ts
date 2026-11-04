// ============================================================================
// Table column widths as RATIOS.
//
// `colwidth` on the cells is a list of WEIGHTS: only the proportions between
// them mean anything. Documents written before this rule store pixels there —
// pixels are weights too, so they keep working untouched, and the first drag
// rewrites them as basis points (percent × 100) anyway.
//
// The view turns the weights into percentages of the text column and keeps the
// table at 100%, so a table follows the page format, the margins and the print
// sheet instead of being nailed to the width it had the day it was resized. Word
// receives the same proportions, converted to twips against the page's text
// width (docx.ts), and the page count already scales the weights to the column
// (pagination-cassie.ts, `tableColumnWidths`): one meaning, three places.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The first row's cells, expanded to one weight per grid column. A column
 * without a weight is `null` — it takes the average of the known ones, so a
 * table half resized keeps looking sane.
 */
export function columnWeights(table: PMNode): (number | null)[] {
  const weights: (number | null)[] = [];
  const first = table.firstChild;
  if (!first) return weights;
  first.forEach((cell) => {
    const colspan = Math.max(1, Number(cell.attrs.colspan) || 1);
    const colwidth = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth : null;
    for (let i = 0; i < colspan; i++) {
      const weight = colwidth ? Number(colwidth[i]) : NaN;
      weights.push(Number.isFinite(weight) && weight > 0 ? weight : null);
    }
  });
  return weights;
}

/** The widths as percentages of the text column, summing to 100. */
export function columnPercents(weights: (number | null)[]): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const known = weights.filter((weight): weight is number => weight !== null && weight > 0);
  if (known.length === 0) return weights.map(() => 100 / count);
  const average = known.reduce((sum, weight) => sum + weight, 0) / known.length;
  const filled = weights.map((weight) => (weight !== null && weight > 0 ? weight : average));
  const total = filled.reduce((sum, weight) => sum + weight, 0);
  return filled.map((weight) => (weight / total) * 100);
}

/** Percentages → the basis points written into `colwidth` (never below 1). */
export function percentWeights(percents: number[]): number[] {
  return percents.map((percent) => Math.max(1, Math.round(percent * 100)));
}

/**
 * Percentages → twips against the page's text width (1 px = 15 twips), the unit
 * Word wants: a column is a length there, not a proportion (docx.ts).
 */
export function columnTwips(percents: number[], contentPx: number): number[] {
  return percents.map((percent) => Math.max(1, Math.round((percent / 100) * contentPx * 15)));
}

/** The `colwidth` array of a cell that starts at `col` and covers `colspan`. */
export function cellColwidth(weights: number[], col: number, colspan: number): number[] {
  const last = weights[weights.length - 1] ?? 1;
  return Array.from({ length: colspan }, (_, i) => weights[col + i] ?? last);
}

/**
 * The live table: the colgroup carries the widths as percentages and the table
 * stays at 100% of the text column. This is the node view; the static paths (the
 * print sheet, the HTML export) get the same colgroup from the node's `toDOM`.
 */
export class TableWidthView {
  node: PMNode;
  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLElement;
  contentDOM: HTMLElement;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.table.style.width = "100%";
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.writeColumns();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.writeColumns();
    return true;
  }

  /** The view owns the table's chrome; only the rows are ProseMirror's. */
  ignoreMutation(mutation: { type: string; target: Node }): boolean {
    return (
      mutation.type === "attributes" &&
      (mutation.target === this.table || this.colgroup.contains(mutation.target))
    );
  }

  private writeColumns(): void {
    const percents = columnPercents(columnWeights(this.node));
    while (this.colgroup.childNodes.length > percents.length) {
      this.colgroup.removeChild(this.colgroup.lastChild as Node);
    }
    while (this.colgroup.childNodes.length < percents.length) {
      this.colgroup.appendChild(document.createElement("col"));
    }
    const cols = this.colgroup.childNodes;
    percents.forEach((percent, i) => {
      const style = `${round2(percent)}%`;
      const col = cols[i] as HTMLElement;
      if (col.style.width !== style) col.style.width = style;
    });
  }
}
