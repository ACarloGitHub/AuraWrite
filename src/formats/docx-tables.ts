import JSZip from "jszip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface ImportedTableCell {
  paragraphs: ImportedCellParagraph[];
  colspan: number;
  rowspan: number;
  /** `w:vMerge`: this cell opens a vertical merge, continues the one above, or nothing. */
  vMerge?: "restart" | "continue" | null;
  colwidth?: number;
  /** The cell's fill, as `#RRGGBB` (`w:shd` in the file). */
  background?: string;
  /** Where the text sits in the cell (`w:vAlign`); `top` is the default and stays absent. */
  verticalAlign?: "middle" | "bottom";
  /**
   * The cell's own borders (`w:tcBorders`), per side, as the editor's attribute
   * values: `"none"` or `"<W>pt solid #RRGGBB"`. A side the file does not
   * declare is absent, and the cell keeps the table's default line.
   */
  borders?: Partial<Record<"top" | "right" | "bottom" | "left", string>>;
}

export interface ImportedCellParagraph {
  text: string;
  runs: { text: string; bold: boolean; italic: boolean }[];
}

export interface ImportedTable {
  rows: ImportedTableCell[][];
  gridCols?: number[];
  /** Minimum height of each row, in px, parallel to `rows`; null where the file sets none. */
  rowHeights?: (number | null)[];
}

function getDOMParser(): any {
  const g: any = globalThis as any;
  if (typeof g.DOMParser !== "undefined") return new g.DOMParser();
  return null;
}

function getElementsByTagNameNS(root: any, ns: string, localName: string): any[] {
  if (!root) return [];
  const out: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.namespaceURI === ns && node.localName === localName) {
      out.push(node);
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(root);
  return out;
}

function readGridSpan(tc: any): number {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return 1;
  const gridSpan = getFirstChildByNS(tcPr, W_NS, "gridSpan");
  if (!gridSpan) return 1;
  const val = gridSpan.getAttribute("w:val");
  const n = val ? parseInt(val, 10) : 1;
  return isNaN(n) || n < 1 ? 1 : n;
}

/**
 * `w:vMerge`: `restart` opens a vertical merge, no `w:val` (or `continue`)
 * continues the one above, and no element at all is a cell of its own.
 */
function readVMerge(tc: any): "restart" | "continue" | null {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return null;
  const vMerge = getFirstChildByNS(tcPr, W_NS, "vMerge");
  if (!vMerge) return null;
  const val = String(vMerge.getAttribute("w:val") || "").toLowerCase();
  return val === "restart" ? "restart" : "continue";
}

function readTcW(tc: any): number | undefined {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return undefined;
  const tcW = getFirstChildByNS(tcPr, W_NS, "tcW");
  if (!tcW) return undefined;
  const w = tcW.getAttribute("w:w");
  const type = tcW.getAttribute("w:type");
  if (!w) return undefined;
  const n = parseInt(w, 10);
  if (isNaN(n)) return undefined;
  if (type === "dxa") return Math.round(n / 20);
  return n;
}

function getFirstChildByNS(node: any, ns: string, localName: string): any {
  if (!node) return null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === ns && child.localName === localName) return child;
  }
  return null;
}

function readTextFromRun(r: any): { text: string; bold: boolean; italic: boolean } {
  let text = "";
  for (let child = r.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      text += child.nodeValue || "";
    } else if (child.namespaceURI === W_NS && child.localName === "t") {
      text += child.textContent || "";
    } else if (child.namespaceURI === W_NS && child.localName === "tab") {
      text += "\t";
    } else if (child.namespaceURI === W_NS && child.localName === "br") {
      text += "\n";
    }
  }
  const rPr = getFirstChildByNS(r, W_NS, "rPr");
  let bold = false;
  let italic = false;
  if (rPr) {
    if (getFirstChildByNS(rPr, W_NS, "b")) bold = true;
    if (getFirstChildByNS(rPr, W_NS, "i")) italic = true;
  }
  return { text, bold, italic };
}

function readCellParagraph(p: any): ImportedCellParagraph {
  const runs: { text: string; bold: boolean; italic: boolean }[] = [];
  for (let child = p.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "r") {
      const r = readTextFromRun(child);
      if (r.text) runs.push(r);
    }
  }
  return {
    text: runs.map((r) => r.text).join(""),
    runs,
  };
}

function readCellBackground(tc: any): string | undefined {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return undefined;
  const shd = getFirstChildByNS(tcPr, W_NS, "shd");
  if (!shd) return undefined;
  const fill = String(shd.getAttribute("w:fill") || "").trim();
  // "auto" is Word's "no fill", and a white fill is the same nothing here.
  if (!/^[0-9A-Fa-f]{6}$/.test(fill)) return undefined;
  if (fill.toUpperCase() === "FFFFFF") return undefined;
  return `#${fill.toUpperCase()}`;
}

function readCellVerticalAlign(tc: any): "middle" | "bottom" | undefined {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return undefined;
  const vAlign = getFirstChildByNS(tcPr, W_NS, "vAlign");
  if (!vAlign) return undefined;
  const value = String(vAlign.getAttribute("w:val") || "").toLowerCase();
  // Word's "center" is CSS's "middle"; "top" and "both" are the default here.
  if (value === "center") return "middle";
  if (value === "bottom") return "bottom";
  return undefined;
}

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * One side of `w:tcBorders` → the editor's value: `"none"`, or
 * `"<W>pt solid #RRGGBB"` (`w:sz` is in eighth-points). `undefined` when the
 * file does not declare the side at all.
 */
function readBorderSide(side: any): string | null | undefined {
  if (!side) return undefined;
  const val = String(side.getAttribute("w:val") || "").toLowerCase();
  if (!val || val === "none" || val === "nil") return "none";
  const sz = Number(side.getAttribute("w:sz"));
  const widthPt = Number.isFinite(sz) && sz > 0 ? Math.round((sz / 8) * 100) / 100 : 0.5;
  const raw = String(side.getAttribute("w:color") || "").trim();
  // "auto" is Word's default colour, which is black.
  const color = /^[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : "000000";
  // The default line this program exports comes back as "no border of its own",
  // so a table written and reopened keeps the attributes it had.
  if (Math.abs(widthPt - 0.5) < 0.01 && color === "999999") return null;
  return `${widthPt}pt solid #${color}`;
}

function readCellBorders(tc: any): ImportedTableCell["borders"] {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return undefined;
  const tcBorders = getFirstChildByNS(tcPr, W_NS, "tcBorders");
  if (!tcBorders) return undefined;
  const borders: NonNullable<ImportedTableCell["borders"]> = {};
  for (const name of BORDER_SIDES) {
    const value = readBorderSide(getFirstChildByNS(tcBorders, W_NS, name));
    if (typeof value === "string") borders[name] = value;
  }
  return Object.keys(borders).length > 0 ? borders : undefined;
}

function readCell(tc: any): ImportedTableCell {
  const colspan = readGridSpan(tc);
  const vMerge = readVMerge(tc);
  const colwidth = readTcW(tc);
  const background = readCellBackground(tc);
  const verticalAlign = readCellVerticalAlign(tc);
  const borders = readCellBorders(tc);
  const paragraphs: ImportedCellParagraph[] = [];
  for (let child = tc.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "p") {
      paragraphs.push(readCellParagraph(child));
    }
  }
  return {
    paragraphs,
    colspan,
    rowspan: 1,
    vMerge,
    colwidth,
    background,
    verticalAlign,
    borders,
  };
}

/**
 * `w:vMerge` says a cell continues the one above it, and the covered cell is
 * written out anyway: here those cells are dropped and the one above grows, so
 * the table arrives with its vertical merges (`rowspan`) instead of a column of
 * empty cells.
 */
export function resolveVerticalMerges(rows: ImportedTableCell[][]): ImportedTableCell[][] {
  const grown = rows.map((row) =>
    row.map((cell) => ({ ...cell, paragraphs: cell.paragraphs.slice() })),
  );
  const open: (ImportedTableCell | null)[] = [];
  for (const row of grown) {
    const kept: ImportedTableCell[] = [];
    let col = 0;
    for (const cell of row) {
      const span = Math.max(1, cell.colspan);
      if (cell.vMerge === "continue") {
        // Una cella sola può trovarsi su più colonne: si allunga una volta sola.
        const above = new Set<ImportedTableCell>();
        for (let k = col; k < col + span; k++) {
          const source = open[k];
          if (source) above.add(source);
        }
        for (const source of above) source.rowspan = (source.rowspan || 1) + 1;
        // Le colonne restano aperte: la fusione continua giù.
      } else {
        for (let k = col; k < col + span; k++) open[k] = cell;
        kept.push(cell);
      }
      col += span;
    }
    // Una riga più corta chiude le fusioni delle colonne che non copre.
    for (let k = col; k < open.length; k++) open[k] = null;
  }
  return grown.map((row) => row.filter((cell) => cell.vMerge !== "continue"));
}

function readRow(tr: any): ImportedTableCell[] {
  const cells: ImportedTableCell[] = [];
  for (let child = tr.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "tc") {
      cells.push(readCell(child));
    }
  }
  return cells;
}

/** A row's minimum height: `w:trHeight` in twips, "at least" rule only. */
function readRowHeight(tr: any): number | null {
  const trPr = getFirstChildByNS(tr, W_NS, "trPr");
  if (!trPr) return null;
  const trHeight = getFirstChildByNS(trPr, W_NS, "trHeight");
  if (!trHeight) return null;
  const rule = String(trHeight.getAttribute("w:hRule") || "").toLowerCase();
  if (rule === "auto") return null;
  const twips = Number(trHeight.getAttribute("w:val"));
  if (!Number.isFinite(twips) || twips <= 0) return null;
  return Math.round(twips / 15);
}

function readTable(tbl: any): ImportedTable {
  const rows: ImportedTableCell[][] = [];
  const rowHeights: (number | null)[] = [];
  for (let child = tbl.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "tr") {
      rows.push(readRow(child));
      rowHeights.push(readRowHeight(child));
    }
  }
  const tblGrid = getFirstChildByNS(tbl, W_NS, "tblGrid");
  let gridCols: number[] | undefined;
  if (tblGrid) {
    const cols: number[] = [];
    for (let c = tblGrid.firstChild; c; c = c.nextSibling) {
      if (c.namespaceURI === W_NS && c.localName === "gridCol") {
        const w = c.getAttribute("w:w");
        const n = w ? parseInt(w, 10) : 0;
        cols.push(isNaN(n) ? 0 : n);
      }
    }
    if (cols.length > 0) gridCols = cols;
  }
  return { rows: resolveVerticalMerges(rows), gridCols, rowHeights };
}

export async function extractTablesFromDocx(
  arrayBuffer: ArrayBuffer
): Promise<ImportedTable[]> {
  let docXml: string;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const file = zip.file("word/document.xml");
    if (!file) return [];
    docXml = await file.async("text");
  } catch {
    return [];
  }

  const parser = getDOMParser();
  if (!parser) return [];
  let xmlDoc: any;
  try {
    xmlDoc = parser.parseFromString(docXml, "application/xml");
  } catch {
    return [];
  }

  const body = getFirstChildByNS(xmlDoc.documentElement, W_NS, "body");
  if (!body) return [];

  const tblNodes = getElementsByTagNameNS(body, W_NS, "tbl");
  return tblNodes.map(readTable);
}

export function tableToHtml(table: ImportedTable): string {
  const colwidths = table.gridCols || [];
  const colgroup =
    colwidths.length > 0
      ? `<colgroup>${colwidths
          .map((w) => `<col style="width:${Math.round(w / 20)}px">`)
          .join("")}</colgroup>`
      : "";

  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const runToHtml = (r: { text: string; bold: boolean; italic: boolean }): string => {
    const text = escapeHtml(r.text).replace(/\n/g, "<br>");
    let html = text;
    if (r.bold) html = `<strong>${html}</strong>`;
    if (r.italic) html = `<em>${html}</em>`;
    return html;
  };

  const cellToHtml = (cell: ImportedTableCell, isHeader: boolean): string => {
    const tag = isHeader ? "th" : "td";
    const attrs: string[] = [];
    if (cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
    if (cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
    if (cell.colwidth) attrs.push(`data-colwidth="${cell.colwidth}"`);
    // The fill and the vertical alignment go on the inline style, which is where
    // the cell's parser reads them back (editor.ts, `backgroundColor` and
    // `verticalAlign`).
    const style: string[] = [];
    if (cell.background) style.push(`background-color: ${cell.background}`);
    if (cell.verticalAlign) style.push(`vertical-align: ${cell.verticalAlign}`);
    if (style.length) attrs.push(`style="${style.join("; ")}"`);
    // The borders travel as data attributes: the cell's parser reads them back
    // (editor.ts, `borderSideAttribute`) and paints them from there, which also
    // keeps a border this program wrote from being read as a default one.
    for (const side of BORDER_SIDES) {
      const value = cell.borders?.[side];
      if (value) attrs.push(`data-border-${side}="${value}"`);
    }
    const inner =
      cell.paragraphs.length === 0
        ? "<p></p>"
        : cell.paragraphs
            .map(
              (p) =>
                `<p>${p.runs.length === 0 ? escapeHtml(p.text) : p.runs.map(runToHtml).join("")}</p>`
            )
            .join("");
    return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${inner}</${tag}>`;
  };

  const rowsHtml = table.rows
    .map((row, i) => {
      const height = table.rowHeights?.[i];
      const rowAttrs = height ? ` data-row-height="${height}"` : "";
      return `<tr${rowAttrs}>${row.map((c) => cellToHtml(c, i === 0)).join("")}</tr>`;
    })
    .join("");

  return `<table data-aw-imported="true">${colgroup}<tbody>${rowsHtml}</tbody></table>`;
}

export async function extractTablesAsHtml(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const tables = await extractTablesFromDocx(arrayBuffer);
  return tables.map(tableToHtml);
}
