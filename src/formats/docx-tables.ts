import JSZip from "jszip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface ImportedTableCell {
  paragraphs: ImportedCellParagraph[];
  colspan: number;
  rowspan: number;
  colwidth?: number;
}

export interface ImportedCellParagraph {
  text: string;
  runs: { text: string; bold: boolean; italic: boolean }[];
}

export interface ImportedTable {
  rows: ImportedTableCell[][];
  gridCols?: number[];
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

function readVMerge(tc: any): { start: boolean; restart: boolean } {
  const tcPr = getFirstChildByNS(tc, W_NS, "tcPr");
  if (!tcPr) return { start: false, restart: false };
  const vMerge = getFirstChildByNS(tcPr, W_NS, "vMerge");
  if (!vMerge) return { start: false, restart: false };
  const val = vMerge.getAttribute("w:val");
  if (val === "restart") return { start: true, restart: true };
  return { start: true, restart: false };
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

function readCell(tc: any): ImportedTableCell {
  const colspan = readGridSpan(tc);
  const rowspanStart = readVMerge(tc);
  const colwidth = readTcW(tc);
  const paragraphs: ImportedCellParagraph[] = [];
  for (let child = tc.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "p") {
      paragraphs.push(readCellParagraph(child));
    }
  }
  return {
    paragraphs,
    colspan,
    rowspan: rowspanStart.start ? 1 : 1,
    colwidth,
  };
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

function readTable(tbl: any): ImportedTable {
  const rows: ImportedTableCell[][] = [];
  for (let child = tbl.firstChild; child; child = child.nextSibling) {
    if (child.namespaceURI === W_NS && child.localName === "tr") {
      rows.push(readRow(child));
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
  return { rows, gridCols };
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
    .map(
      (row, i) =>
        `<tr>${row
          .map((c) => cellToHtml(c, i === 0))
          .join("")}</tr>`
    )
    .join("");

  return `<table data-aw-imported="true">${colgroup}<tbody>${rowsHtml}</tbody></table>`;
}

export async function extractTablesAsHtml(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const tables = await extractTablesFromDocx(arrayBuffer);
  return tables.map(tableToHtml);
}
