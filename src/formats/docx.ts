import mammoth from "mammoth";
import JSZip from "jszip";
import { invoke } from "@tauri-apps/api/core";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  ExternalHyperlink,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  TableLayoutType,
  VerticalAlign,
  HeightRule,
  ImageRun,
  Tab,
  TabStopType,
  LeaderType,
  TextWrappingType,
  TextWrappingSide,
  HorizontalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionRelativeFrom,
  VerticalPositionAlign,
  SimpleField,
  LevelFormat,
  DropCapType,
  FrameWrap,
  FrameAnchorType,
} from "docx";
import type { ILevelsOptions } from "docx";
import { getPageFormat, isHeaderRow } from "../editor/pagination-cassie";
import { getEditorMetrics } from "../editor/text-metrics";
import { isWrapping, textConditionOf } from "../editor/element-condition";
import { getMargins } from "../editor/pagination-state";
import { extractTablesFromDocx, tableToHtml } from "./docx-tables";
import { assertNeverKind, elementTypeOf } from "../editor/element-types";
import { parseBorder } from "../editor/table-borders";
import { columnPercents, columnTwips, columnWeights } from "../editor/table-widths";
import { cellPaddingOf, cellPaddingTwips } from "../editor/table-padding";
import { CM_TO_TWIP } from "../editor/paragraph-indent";
import { docxPicture, findFormat } from "../editor/field-value";
import { formatTabStops, parseTabStops, type TabAlign } from "../editor/paragraph-tabs";
import { shapeBitmap, type ShapeBitmap } from "./shape-word";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function getDOMParser(): any {
  const g: any = globalThis as any;
  if (typeof g.DOMParser !== "undefined") return new g.DOMParser();
  return null;
}

function contentToArray(content: any): any[] {
  if (!content) return [];
  const result: any[] = [];
  if (typeof content.forEach === "function") {
    content.forEach((node: any) => result.push(node));
  }
  return result;
}

function normalizeColor(color: string | undefined | null): string | undefined {
  if (!color) return undefined;
  const s = String(color).trim();
  if (!s) return undefined;
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const hex =
      Number(rgbMatch[1]).toString(16).padStart(2, "0") +
      Number(rgbMatch[2]).toString(16).padStart(2, "0") +
      Number(rgbMatch[3]).toString(16).padStart(2, "0");
    return hex.toUpperCase();
  }
  const hexClean = s.replace(/^#/, "");
  if (/^[0-9A-Fa-f]{6}$/.test(hexClean)) return hexClean.toUpperCase();
  if (/^[0-9A-Fa-f]{3}$/.test(hexClean)) {
    return (hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2]).toUpperCase();
  }
  return undefined;
}

function hexToHighlightName(hex: string): string | null {
  const m = hex.replace(/^#/, "").toLowerCase();
  const map: Record<string, string> = {
    "ffff00": "yellow",
    "00ff00": "green",
    "00ffff": "cyan",
    "ff00ff": "magenta",
    "0000ff": "blue",
    "ff0000": "red",
    "000000": "black",
    "ffffff": "white",
  };
  return map[m] ?? null;
}

function fontSizeFromPx(px: string | number | undefined): number | undefined {
  if (px == null) return undefined;
  const num = typeof px === "string" ? parseFloat(px) : px;
  if (isNaN(num) || num <= 0) return undefined;
  const pt = num * 0.75;
  return Math.round(pt * 2);
}

function lineHeightToTwips(lh: string | number | undefined): number | undefined {
  if (lh == null || lh === "") return undefined;
  const num = typeof lh === "string" ? parseFloat(lh) : lh;
  if (isNaN(num) || num <= 0) return undefined;
  // A chosen spacing is a Word multiple: w:line counts 240ths of a SINGLE
  // line (the font's natural one), which is exactly what the editor now means.
  return Math.round(num * 240);
}

/**
 * "Default" (no attr) as Word reads it: the document's own rhythm is 1.5
 * in CSS units, i.e. 1.5/natural single lines. Writing THIS makes Word open
 * the paragraph with the line the editor shows, instead of Word's own single.
 */
function defaultRhythmTwips(): number {
  const natural = getEditorMetrics().naturalBody || 1.15;
  return Math.round((1.5 / natural) * 240);
}

function alignToDocx(a: string | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  if (!a) return undefined;
  switch (a) {
    case "left":
      return AlignmentType.LEFT;
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}

const MAMMOTH_STYLE_MAP = [
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='List Bullet'] => ul li:fresh",
  "p[style-name='List Bullet 2'] => ul li:fresh",
  "p[style-name='List Number'] => ol li:fresh",
];

export async function fromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // E5: a `w:fldSimple` is DROPPED by mammoth (probed 2026-11-25: only a
  // warning, and the value with it) while a complex field keeps its visible
  // text but loses its instruction. Both are marked here with private-use
  // sentinels, so the field arrives as an atom instead of vanishing or
  // freezing into the string it happened to show.
  const instrumented = await instrumentFields(arrayBuffer);
  const source = instrumented ?? arrayBuffer;
  // mammoth in Node requires `buffer` (Node Buffer); in browser it accepts `arrayBuffer`
  const mammothInput: any = (globalThis as any).Buffer
    ? { buffer: (globalThis as any).Buffer.from(source) }
    : { arrayBuffer: source };
  const result = await mammoth.convertToHtml(mammothInput, { styleMap: MAMMOTH_STYLE_MAP });
  const enriched = await enrichHtml(arrayBuffer, restoreFields(result.value));
  return enriched;
}

/** The sentinels that carry a field through mammoth (private use area). */
const FIELD_START = "\uE000";
const FIELD_MARK = "\uE001";
const FIELD_END = "\uE002";

function fieldPayload(kind: string, picture: string, auto: boolean): string {
  const json = JSON.stringify({ k: kind, f: picture, a: auto });
  return btoa(unescape(encodeURIComponent(json)));
}

/** Word's instruction (`DATE \@ "dd.MM.yyyy"`) → our kind and picture. */
function readFieldInstruction(instr: string): { kind: string; picture: string } | null {
  const m = /^\s*(DATE|TIME|AUTHOR)\b/i.exec(instr);
  if (!m) return null;
  const kind = m[1].toUpperCase() === "AUTHOR" ? "name"
    : m[1].toUpperCase() === "TIME" ? "time" : "date";
  const pic = /@\s*"([^"]*)"/.exec(instr);
  return { kind, picture: pic ? pic[1] : "" };
}

function makeSentinelRun(doc: any, text: string): any {
  const run = doc.createElementNS(doc.documentElement.namespaceURI, "w:r");
  const t = doc.createElementNS(doc.documentElement.namespaceURI, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.textContent = text;
  run.appendChild(t);
  return run;
}

/**
 * Rewrite the document's fields into sentinel-marked runs, so mammoth carries
 * the instruction and the value through. Returns null when the file cannot be
 * read (the caller then keeps the plain mammoth answer).
 */
async function instrumentFields(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  const parser = getDOMParser();
  if (!parser) return null;
  let zip: any;
  let xml: string;
  try {
    zip = await JSZip.loadAsync(arrayBuffer);
    const file = zip.file("word/document.xml");
    if (!file) return null;
    xml = await file.async("text");
  } catch {
    return null;
  }
  let xmlDoc: any;
  try {
    xmlDoc = parser.parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  if (!xmlDoc?.documentElement) return null;
  const paragraphs: any[] = Array.from(xmlDoc.getElementsByTagName("w:p") as any);
  let changed = false;

  for (const paragraph of paragraphs) {
    const children: any[] = Array.from(paragraph.childNodes as any) as any[];
    // Simple fields: dropped by mammoth, so they are replaced outright.
    for (const child of children) {
      if (child.nodeType !== 1 || child.localName !== "fldSimple") continue;
      const field = readFieldInstruction(child.getAttribute("w:instr") ?? "");
      if (!field) continue;
      const cached = Array.from(child.getElementsByTagName("w:t") as any)
        .map((t: any) => t.textContent ?? "").join("");
      const marker = makeSentinelRun(xmlDoc,
        FIELD_START + fieldPayload(field.kind, field.picture, true) + FIELD_MARK + cached + FIELD_END);
      paragraph.replaceChild(marker, child);
      changed = true;
    }
    // Complex fields: the instruction is in the runs, the value between the
    // `separate` and the `end`. The sentinels go around that value.
    const runs: any[] = Array.from(paragraph.childNodes as any)
      .filter((n: any) => n.nodeType === 1 && n.localName === "r");
    let instr = "";
    let collecting: string | null = null;
    let open: { payload: string; first: any; last: any } | null = null;
    for (const run of runs) {
      const chars: any[] = Array.from(run.childNodes as any)
        .filter((n: any) => n.nodeType === 1 && n.localName === "fldChar");
      const charType = chars[0]?.getAttribute("w:fldCharType") ?? null;
      if (charType === "begin") {
        instr = "";
        collecting = "";
        open = null;
        continue;
      }
      if (collecting !== null) {
        const texts = Array.from(run.getElementsByTagName("w:instrText") as any)
          .map((t: any) => t.textContent ?? "").join("");
        collecting += texts;
      }
      if (charType === "separate") {
        const field = readFieldInstruction(collecting ?? instr);
        collecting = null;
        if (field) {
          const payload = FIELD_START + fieldPayload(field.kind, field.picture, true) + FIELD_MARK;
          const marker = makeSentinelRun(xmlDoc, payload);
          run.parentNode.insertBefore(marker, run.nextSibling);
          open = { payload, first: marker, last: marker };
          changed = true;
        }
        continue;
      }
      if (charType === "end") {
        if (open) {
          const marker = makeSentinelRun(xmlDoc, FIELD_END);
          run.parentNode.insertBefore(marker, run);
          changed = true;
          open = null;
        }
        continue;
      }
    }
  }

  if (!changed) return null;
  try {
    const Serializer = (globalThis as any).XMLSerializer;
    if (!Serializer) return null;
    zip.file("word/document.xml", new Serializer().serializeToString(xmlDoc));
    const out = await zip.generateAsync({ type: "arraybuffer" });
    return out as ArrayBuffer;
  } catch {
    return null;
  }
}

/** Sentinel-marked text → the `span[data-aw-field]` the schema reads back. */
function restoreFields(html: string): string {
  const re = new RegExp(FIELD_START + "([A-Za-z0-9+/=]+)" + FIELD_MARK + "([^]*?)" + FIELD_END, "g");
  return html.replace(re, (_all: string, payload: string, shown: string) => {
    let field: { k?: string; f?: string; a?: boolean } = {};
    try {
      field = JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch {
      return shown;
    }
    const kind = field.k === "time" ? "time" : field.k === "name" ? "name" : "date";
    const format = (field.f ?? "").replace(/"/g, "&quot;");
    const auto = field.a === false ? "false" : "true";
    return `<span data-aw-field="${kind}" data-format="${format}" data-value="" data-auto="${auto}" class="aw-field">${shown}</span>`;
  });
}

async function enrichHtml(arrayBuffer: ArrayBuffer, html: string): Promise<string> {
  let docXml: string;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const file = zip.file("word/document.xml");
    if (!file) return html;
    docXml = await file.async("text");
  } catch {
    return html;
  }

  const parser = getDOMParser();
  if (!parser) return html;
  let xmlDoc: any;
  try {
    xmlDoc = parser.parseFromString(docXml, "application/xml");
  } catch {
    return html;
  }

  const wParagraphs: any[] = collectWParagraphs(xmlDoc);
  if (wParagraphs.length === 0) return html;

  const htmlParser = getDOMParser();
  if (!htmlParser) return html;
  const htmlDoc = htmlParser.parseFromString(`<div id="aw-root">${html}</div>`, "text/html");
  const root = htmlDoc.getElementById ? htmlDoc.getElementById("aw-root") : null;
  const container = root || htmlDoc.documentElement;
  if (!container) return html;

  const htmlBlocks = collectHtmlBlocks(container);
  if (htmlBlocks.length === 0) return html;

  const limit = Math.min(wParagraphs.length, htmlBlocks.length);
  for (let i = 0; i < limit; i++) {
    const wP = wParagraphs[i];
    const el = htmlBlocks[i];
    applyParagraphMeta(wP, el);
    applyRunMeta(wP, el);
    applyDrawingMeta(wP, el);
  }

  // Greedy fallback: for any wParagraphs not yet matched (i.e. when htmlBlocks
  // has fewer entries because mammoth merged/transformed them), try to find a
  // matching block by leading text.
  for (let i = limit; i < wParagraphs.length; i++) {
    const wP = wParagraphs[i];
    const wText = wParagraphText(wP).trim();
    if (!wText) continue;
    const el = findHtmlBlockByText(container, wText, htmlBlocksConsumed);
    if (el) {
      applyParagraphMeta(wP, el);
        applyRunMeta(wP, el);
      applyDrawingMeta(wP, el);
    }
  }

  postProcessBlocks(container, wParagraphs, htmlBlocks);

  // Replace mammoth-generated <table> elements with richer tables extracted
  // directly from word/document.xml (preserves colspan/rowspan/colwidth).
  await replaceMammothTables(container, arrayBuffer);

  return serializeContainer(container);
}

async function replaceMammothTables(container: any, arrayBuffer: ArrayBuffer): Promise<void> {
  if (!container) return;
  const ownerDoc = container.ownerDocument || container;
  const mammothTables: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.nodeType === 1 && node.localName === "table") {
      mammothTables.push(node);
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(container);
  if (mammothTables.length === 0) return;

  const importedTables = await extractTablesFromDocx(arrayBuffer);
  if (importedTables.length === 0) return;

  const count = Math.min(mammothTables.length, importedTables.length);
  for (let i = 0; i < count; i++) {
    const oldTbl = mammothTables[i];
    const newHtml = tableToHtml(importedTables[i]);
    const fragment = ownerDoc.createElement ? ownerDoc.createElement("div") : null;
    let newTbl: any = null;
    if (fragment) {
      fragment.innerHTML = newHtml;
      newTbl = fragment.firstElementChild;
    } else {
      const tmp = (ownerDoc.implementation
        ? ownerDoc.implementation.createHTMLDocument("")
        : ownerDoc);
      const tmpBody = tmp.body || tmp;
      tmpBody.innerHTML = newHtml;
      newTbl = tmpBody.firstElementChild;
    }
    if (newTbl && oldTbl.parentNode) {
      oldTbl.parentNode.replaceChild(newTbl, oldTbl);
    }
  }
}

function postProcessBlocks(container: any, wParagraphs: any[], htmlBlocks: any[]): void {
  const blockByWPara = new Map<number, any>();
  for (let i = 0; i < Math.min(wParagraphs.length, htmlBlocks.length); i++) {
    blockByWPara.set(i, htmlBlocks[i]);
  }
  for (let i = htmlBlocks.length; i < wParagraphs.length; i++) {
    const wText = wParagraphText(wParagraphs[i]).trim();
    if (!wText) continue;
    const el = findHtmlBlockByText(container, wText, htmlBlocksConsumed);
    if (el) blockByWPara.set(i, el);
  }

  const codeMono = /Consolas|Courier|JetBrains|Menlo|Monaco|monospace/i;
  const codeGroup: { wIdx: number; el: any }[] = [];
  const flushCode = () => {
    if (codeGroup.length < 1) return;
    if (codeGroup.length >= 2 || isExplicitCodeBlock(wParagraphs[codeGroup[0].wIdx])) {
      const ownerDoc = container.ownerDocument || container;
      const wrapper = createWrapper(ownerDoc, "pre");
      wrapper.setAttribute("class", "code-block");
      const first = codeGroup[0].el;
      const parent = first?.parentNode;
      if (parent) {
        parent.insertBefore(wrapper, first);
        for (const g of codeGroup) {
          stripCodeStyling(g.el);
          wrapper.appendChild(g.el);
        }
        flattenPreChildren(wrapper, ownerDoc);
      }
    }
    codeGroup.length = 0;
  };

  for (let i = 0; i < wParagraphs.length; i++) {
    const wP = wParagraphs[i];
    const el = blockByWPara.get(i);
    if (!el) continue;

    if (isCodeBlockParagraph(wP, codeMono)) {
      codeGroup.push({ wIdx: i, el });
    } else {
      flushCode();
      if (isBlockquoteParagraph(wP)) {
        // mammoth styleMap may have already produced <blockquote>; only wrap if not.
        if ((el.tagName || "").toUpperCase() !== "BLOCKQUOTE") {
          wrapInContainer(el, container.ownerDocument || container, "blockquote", "blockquote");
        }
      } else if (isTitleParagraph(wP)) {
        // mammoth styleMap may have already produced <h1 class="title">; only wrap if not.
        const elTag = (el.tagName || "").toUpperCase();
        const elClass = el.getAttribute?.("class") || "";
        if (!(elTag === "H1" && elClass.includes("title"))) {
          const ownerDoc = container.ownerDocument || container;
          const h = createWrapper(ownerDoc, "h1");
          h.setAttribute("class", "title");
          const parent = el.parentNode;
          if (parent) {
            parent.insertBefore(h, el);
            h.appendChild(el);
            flattenPreChildren(h, ownerDoc);
          }
        }
      }
      if (hasPageBreak(wP)) {
        addClass(el, "page-break-before");
      }
    }
  }
  flushCode();
}

function isCodeBlockParagraph(wP: any, monoRe: RegExp): boolean {
  const wRuns = Array.from(wP.getElementsByTagNameNS(W_NS, "r") || []);
  if (wRuns.length === 0) return false;
  for (const r of wRuns) {
    const rPr = (r as any).getElementsByTagNameNS(W_NS, "rPr")?.[0];
    if (!rPr) continue;
    const rFonts = rPr.getElementsByTagNameNS(W_NS, "rFonts")?.[0];
    const font = attrValue(rFonts, W_NS, "ascii") || attrValue(rFonts, W_NS, "cs");
    if (font && monoRe.test(font)) return true;
  }
  return false;
}

function isExplicitCodeBlock(wP: any): boolean {
  const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
  return !!pPr?.getElementsByTagNameNS(W_NS, "ind")?.[0];
}

function stripCodeStyling(el: any): void {
  const style = el.getAttribute?.("style") || "";
  const next = style
    .replace(/\bfont-family\s*:[^;]*;?/gi, "")
    .replace(/\bbackground-color\s*:[^;]*;?/gi, "")
    .replace(/^\s*;\s*/, "")
    .trim();
  if (next) el.setAttribute("style", next);
  else el.removeAttribute("style");
}

function isBlockquoteParagraph(wP: any): boolean {
  const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
  if (!pPr) return false;
  const pStyle = pPr.getElementsByTagNameNS(W_NS, "pStyle")?.[0];
  const styleVal = attrValue(pStyle, W_NS, "val") || "";
  if (/quote/i.test(styleVal)) return true;
  const ind = pPr.getElementsByTagNameNS(W_NS, "ind")?.[0];
  const left = parseInt(attrValue(ind, W_NS, "left") || "0", 10);
  const wRuns = Array.from(wP.getElementsByTagNameNS(W_NS, "r") || []);
  const allItalic = wRuns.length > 0 && wRuns.every((r: any) => {
    const rPr = (r as any).getElementsByTagNameNS(W_NS, "rPr")?.[0];
    if (!rPr) return false;
    return !!rPr.getElementsByTagNameNS(W_NS, "i")?.[0];
  });
  return allItalic && left > 0;
}

function isTitleParagraph(wP: any): boolean {
  const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
  if (!pPr) return false;
  const pStyle = pPr.getElementsByTagNameNS(W_NS, "pStyle")?.[0];
  return (attrValue(pStyle, W_NS, "val") || "").toLowerCase() === "title";
}

function hasPageBreak(wP: any): boolean {
  const wBr = wP.getElementsByTagNameNS(W_NS, "br")?.[0];
  if (wBr && (attrValue(wBr, W_NS, "type") || "") === "page") return true;
  const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
  return !!pPr?.getElementsByTagNameNS(W_NS, "pageBreakBefore")?.[0];
}

function addClass(el: any, cls: string): void {
  if (!el) return;
  if (el.classList && !el.classList.contains(cls)) {
    el.classList.add(cls);
    return;
  }
  const cur = el.getAttribute?.("class") || "";
  if (!cur.split(/\s+/).includes(cls)) {
    el.setAttribute("class", cur ? cur + " " + cls : cls);
  }
}

function wrapInContainer(el: any, ownerDoc: any, tag: string, cls: string): void {
  const parent = el.parentNode;
  if (!parent) return;
  const wrapper = createWrapper(ownerDoc, tag);
  wrapper.setAttribute("class", cls);
  parent.insertBefore(wrapper, el);
  wrapper.appendChild(el);
}

function flattenPreChildren(pre: any, ownerDoc: any): void {
  // Replace child <p> with their text content joined by newlines, so the
  // pre contains only text nodes (matching ProseMirror code_block content
  // model "text*").
  const doc = ownerDoc;
  const paragraphs = Array.from(pre.childNodes || []).filter(
    (n: any) => n.nodeType === 1 && (n.tagName || "").toUpperCase() === "P",
  );
  if (paragraphs.length === 0) return;
  for (const p of paragraphs) pre.removeChild(p);
  for (let i = 0; i < paragraphs.length; i++) {
    const p: any = paragraphs[i];
    if (i > 0) {
      pre.appendChild(doc.createTextNode("\n"));
    }
    const children = Array.from(p.childNodes || []);
    for (let j = 0; j < children.length; j++) {
      pre.appendChild((children[j] as any).cloneNode(true));
    }
  }
}

const htmlBlocksConsumed = new WeakSet();

function wParagraphText(wP: any): string {
  const runs = Array.from(wP.getElementsByTagNameNS(W_NS, "r") || []);
  let out = "";
  for (const r of runs) {
    const t = (r as any).getElementsByTagNameNS(W_NS, "t")?.[0];
    if (t) out += t.textContent || "";
  }
  return out;
}

function findHtmlBlockByText(container: any, needle: string, consumed: any): any {
  if (!needle) return null;
  const blocks = collectHtmlBlocks(container);
  for (const b of blocks) {
    if (consumed.has(b)) continue;
    const t = (b.textContent || "").trim();
    if (!t) continue;
    if (t.startsWith(needle) || needle.startsWith(t.substring(0, Math.min(40, t.length)))) {
      consumed.add(b);
      return b;
    }
  }
  return null;
}

function collectWParagraphs(xmlDoc: any): any[] {
  return Array.from(xmlDoc.getElementsByTagNameNS(W_NS, "p") || []);
}

function collectHtmlBlocks(container: any): any[] {
  const blocks: any[] = [];
  const blockTags = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR"]);
  const walk = (node: any) => {
    if (!node) return;
    for (let i = 0; i < (node.childNodes || []).length; i++) {
      const child = node.childNodes[i];
      if (!child) continue;
      if (child.nodeType === 1) {
        const tag = (child.tagName || "").toUpperCase();
        if (blockTags.has(tag)) {
          blocks.push(child);
          if (tag === "UL" || tag === "OL" || tag === "TABLE") {
            walk(child);
          }
        } else {
          walk(child);
        }
      }
    }
  };
  walk(container);
  return blocks;
}

function applyParagraphMeta(wP: any, el: any): void {
  const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
  if (!pPr) return;

  const jc = pPr.getElementsByTagNameNS(W_NS, "jc")?.[0];
  if (jc) {
    const val = attrValue(jc, W_NS, "val");
    if (val) setStyle(el, "text-align", val);
  }

  // E1: direct w:spacing before/after (twips -> pt). Only what the paragraph
  // itself declares: a style's spacing lives in styles.xml and stays with the
  // named-styles work, so an ordinary Word file keeps the look it has today.
  // The channel's OWN rhythms are not choices and come back as Default:
  // after=200 is what the exporter writes on every unchosen paragraph, and
  // before=after=80 is the table-cell rhythm. A choice equal to a rhythm
  // flattens to Default (documented, like Word's # grid).
  const wSpacing = pPr.getElementsByTagNameNS(W_NS, "spacing")?.[0];
  if (wSpacing) {
    const twipsToPt = (raw: string | null): number | null => {
      if (raw == null || raw === "") return null;
      const n = Number(raw) / 20;
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    };
    let before = twipsToPt(attrValue(wSpacing, W_NS, "before"));
    let after = twipsToPt(attrValue(wSpacing, W_NS, "after"));
    const inCell = typeof el.closest === "function" && !!el.closest("td, th");
    if (inCell && before === 4 && after === 4) {
      before = null;
      after = null;
    } else if (after === 10) {
      after = null;
    }
    if (before != null) el.setAttribute("data-space-before", String(before));
    if (after != null) el.setAttribute("data-space-after", String(after));
  }

  // E2: direct w:ind (twips -> cm). A list paragraph keeps Word's numbering
  // indent out: in AuraWrite lists indent by nesting, and importing the
  // numbers would double the shift. firstLine minus hanging = the signed
  // first-line indent (negative = sporgente).
  const wInd = pPr.getElementsByTagNameNS(W_NS, "ind")?.[0];
  if (wInd && !(typeof el.closest === "function" && el.closest("li"))) {
    const twipsToCm = (raw: string | null): number => {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round((n / CM_TO_TWIP) * 100) / 100 : 0;
    };
    const left = twipsToCm(attrValue(wInd, W_NS, "left"));
    const right = twipsToCm(attrValue(wInd, W_NS, "right"));
    const first = Math.round((twipsToCm(attrValue(wInd, W_NS, "firstLine")) - twipsToCm(attrValue(wInd, W_NS, "hanging"))) * 100) / 100;
    if (left > 0) el.setAttribute("data-indent-left", String(left));
    if (right > 0) el.setAttribute("data-indent-right", String(right));
    if (first !== 0) el.setAttribute("data-indent-first", String(first));
  }

  // E3: direct w:tabs (twips -> cm, the text margin's origin). Word's default
  // tab pitch is not written on the file and is not a choice of ours: only the
  // stops the paragraph really declares come back.
  const wTabs = pPr.getElementsByTagNameNS(W_NS, "tabs")?.[0];
  if (wTabs) {
    const alignOf = (val: string | null): TabAlign | null => {
      switch (val) {
        case "left":
        case "start":
          return "left";
        case "center":
          return "center";
        case "right":
        case "end":
          return "right";
        case "decimal":
          return "decimal";
        default:
          return null;
      }
    };
    const leaderOf = (val: string | null): string | null => {
      switch (val) {
        case "dot":
          return ".";
        case "hyphen":
          return "-";
        case "underscore":
          return "_";
        case "middleDot":
          return "·";
        default:
          return null;
      }
    };
    const stops = Array.from(wTabs.getElementsByTagNameNS(W_NS, "tab") || []) as any[];
    const list = stops
      .map((t) => {
        const align = alignOf(attrValue(t, W_NS, "val"));
        const pos = Number(attrValue(t, W_NS, "pos"));
        if (!align || !Number.isFinite(pos)) return null;
        return { pos: Math.round((pos / CM_TO_TWIP) * 100) / 100, align, leader: leaderOf(attrValue(t, W_NS, "leader")) };
      })
      .filter((s): s is { pos: number; align: TabAlign; leader: string | null } => s !== null);
    const value = formatTabStops(list);
    if (value) el.setAttribute("data-tab-stops", value);
  }
}

function applyRunMeta(wP: any, el: any): void {  const wRuns: any[] = Array.from(wP.getElementsByTagNameNS(W_NS, "r") || []);
  const ownerDoc = el.ownerDocument || el;

  for (const wR of wRuns) {
    const rPr = wR.getElementsByTagNameNS(W_NS, "rPr")?.[0];
    if (!rPr) continue;
    const rText = runText(wR);
    if (!rText) continue;

    const targetLeaf = findLeafForText(el, rText);
    if (!targetLeaf) continue;

    const styles = collectRunStyles(rPr);
    const vertAlign = vertAlignOf(rPr);
    if (vertAlign) {
      wrapVertAlign(targetLeaf, vertAlign, ownerDoc);
    }
    if (Object.keys(styles).length > 0) {
      wrapWithStyles(targetLeaf, styles, ownerDoc);
    }
  }
}

function applyDrawingMeta(wP: any, el: any): void {
  const wDrawings: any[] = Array.from(wP.getElementsByTagNameNS(W_NS, "drawing") || []);
  if (wDrawings.length === 0) return;

  const htmlImgs: any[] = [];
  const collectImgs = (node: any) => {
    if (!node) return;
    if (node.nodeType === 1 && (node.tagName || "").toUpperCase() === "IMG") {
      htmlImgs.push(node);
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      collectImgs(c);
    }
  };
  collectImgs(el);

  if (htmlImgs.length === 0) return;

  for (let dIdx = 0; dIdx < wDrawings.length && dIdx < htmlImgs.length; dIdx++) {
    const drawing = wDrawings[dIdx];
    const img = htmlImgs[dIdx];
    const attrs = extractDrawingAttrs(drawing);
    if (!attrs) continue;

    if (attrs.wrap) img.setAttribute("data-wrap", "");
    if (attrs.rotation) img.setAttribute("data-rotation", String(attrs.rotation));
    if (attrs.flipH) img.setAttribute("data-flip-h", "");
    if (attrs.flipV) img.setAttribute("data-flip-v", "");
    if (attrs.align) img.setAttribute("data-align", attrs.align);
    if (attrs.widthPx) img.setAttribute("width", String(attrs.widthPx));
    if (attrs.heightPx) img.setAttribute("height", String(attrs.heightPx));
  }
}

interface DrawingAttrs {
  wrap: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  align: string;
  widthPx: number | null;
  heightPx: number | null;
}

function extractDrawingAttrs(drawing: any): DrawingAttrs | null {
  const anchor = drawing.getElementsByTagNameNS(WP_NS, "anchor")?.[0];
  const inline = drawing.getElementsByTagNameNS(WP_NS, "inline")?.[0];
  const container = anchor || inline;
  if (!container) return null;

  const result: DrawingAttrs = {
    wrap: false,
    rotation: 0,
    flipH: false,
    flipV: false,
    align: "center",
    widthPx: null,
    heightPx: null,
  };

  result.wrap = !!anchor;
  if (anchor) {
    const wrapSquare = anchor.getElementsByTagNameNS(WP_NS, "wrapSquare")?.[0];
    const wrapTight = anchor.getElementsByTagNameNS(WP_NS, "wrapTight")?.[0];
    const wrapTopAndBottom = anchor.getElementsByTagNameNS(WP_NS, "wrapTopAndBottom")?.[0];
    if (!wrapSquare && !wrapTight && !wrapTopAndBottom) {
      result.wrap = false;
    }

    const posH = anchor.getElementsByTagNameNS(WP_NS, "positionH")?.[0];
    if (posH) {
      const alignEl = posH.getElementsByTagNameNS(WP_NS, "align")?.[0];
      if (alignEl) {
        const alignText = (alignEl.textContent || "").trim().toLowerCase();
        if (alignText === "left" || alignText === "right" || alignText === "center") {
          result.align = alignText;
        }
      }
    }
  }

  const extent = container.getElementsByTagNameNS(WP_NS, "extent")?.[0];
  if (extent) {
    const cx = attrValue(extent, WP_NS, "cx");
    const cy = attrValue(extent, WP_NS, "cy");
    if (cx) result.widthPx = Math.round(parseInt(cx, 10) / 9525);
    if (cy) result.heightPx = Math.round(parseInt(cy, 10) / 9525);
  }

  const xfrmElements = drawing.getElementsByTagNameNS(A_NS, "xfrm");
  if (xfrmElements && xfrmElements.length > 0) {
    const xfrm = xfrmElements[0];
    const rot = attrValue(xfrm, A_NS, "rot");
    if (rot) {
      const rotVal = parseInt(rot, 10);
      if (!isNaN(rotVal) && rotVal !== 0) {
        result.rotation = rotVal / 60000;
      }
    }
    const flipHAttr = attrValue(xfrm, A_NS, "flipH");
    if (flipHAttr === "1" || flipHAttr === "true") result.flipH = true;
    const flipVAttr = attrValue(xfrm, A_NS, "flipV");
    if (flipVAttr === "1" || flipVAttr === "true") result.flipV = true;
  }

  return result;
}

function runText(wR: any): string {
  const texts = Array.from(wR.getElementsByTagNameNS(W_NS, "t") || []);
  return texts.map((t: any) => t.textContent || "").join("");
}

function vertAlignOf(rPr: any): "superscript" | "subscript" | null {
  const v = rPr.getElementsByTagNameNS(W_NS, "vertAlign")?.[0];
  if (!v) return null;
  const val = attrValue(v, W_NS, "val");
  if (val === "superscript") return "superscript";
  if (val === "subscript") return "subscript";
  return null;
}

function findLeafForText(el: any, text: string): any {
  const allNodes: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node === el) {
      for (let i = 0; i < (node.childNodes || []).length; i++) walk(node.childNodes[i]);
      return;
    }
    if (node.nodeType === 3) {
      allNodes.push(node);
      return;
    }
    if (node.nodeType === 1) {
      if (isInlineTag(node)) allNodes.push(node);
      for (let i = 0; i < (node.childNodes || []).length; i++) walk(node.childNodes[i]);
    }
  };
  walk(el);

  for (const n of allNodes) {
    if (n.nodeType === 1) {
      const t = n.textContent || "";
      if (!t) continue;
      if (t === text || t.includes(text)) {
        return n;
      }
    } else if (n.nodeType === 3) {
      const t = n.textContent || "";
      if (!t) continue;
      if (t === text) return n;
      const idx = t.indexOf(text);
      if (idx >= 0) {
        const split = splitTextNode(n, idx, text.length);
        return split;
      }
    }
  }
  return null;
}

function splitTextNode(textNode: any, idx: number, len: number): any {
  const fullText = textNode.textContent || "";
  const before = fullText.substring(0, idx);
  const after = fullText.substring(idx + len);
  const parent = textNode.parentNode;
  if (!parent) return textNode;

  if (before) {
    const beforeNode = textNode.cloneNode(false);
    beforeNode.textContent = before;
    parent.insertBefore(beforeNode, textNode);
  }
  if (after) {
    const afterNode = textNode.cloneNode(false);
    afterNode.textContent = after;
    if (textNode.nextSibling) {
      parent.insertBefore(afterNode, textNode.nextSibling);
    } else {
      parent.appendChild(afterNode);
    }
  }
  textNode.textContent = fullText.substring(idx, idx + len);
  return textNode;
}

function isInlineTag(node: any): boolean {
  const inlineTags = new Set(["SPAN", "STRONG", "EM", "A", "B", "I", "U", "S", "CODE", "SUB", "SUP"]);
  return inlineTags.has((node.tagName || "").toUpperCase());
}

function collectRunStyles(rPr: any): Record<string, string> {
  const styles: Record<string, string> = {};

  const color = rPr.getElementsByTagNameNS(W_NS, "color")?.[0];
  if (color) {
    const v = attrValue(color, W_NS, "val");
    if (v && v !== "auto") styles["color"] = "#" + v;
  }

  const sz = rPr.getElementsByTagNameNS(W_NS, "sz")?.[0];
  if (sz) {
    const v = attrValue(sz, W_NS, "val");
    if (v) {
      const px = Math.round((parseInt(v, 10) / 2) * 1.333);
      styles["font-size"] = px + "px";
    }
  }

  const rFonts = rPr.getElementsByTagNameNS(W_NS, "rFonts")?.[0];
  if (rFonts) {
    const v = attrValue(rFonts, W_NS, "ascii") || attrValue(rFonts, W_NS, "cs");
    if (v) styles["font-family"] = v;
  }

  const highlight = rPr.getElementsByTagNameNS(W_NS, "highlight")?.[0];
  if (highlight) {
    const v = attrValue(highlight, W_NS, "val");
    if (v && v !== "none") {
      const css = highlightToCss(v);
      if (css) styles["background-color"] = css;
    }
  }

  const shd = rPr.getElementsByTagNameNS(W_NS, "shd")?.[0];
  if (shd) {
    const fill = attrValue(shd, W_NS, "fill");
    if (fill && fill !== "auto" && fill !== "FFFFFF") {
      styles["background-color"] = "#" + fill;
    }
  }

  const u = rPr.getElementsByTagNameNS(W_NS, "u")?.[0];
  const strike = rPr.getElementsByTagNameNS(W_NS, "strike")?.[0];
  if (u || strike) {
    const parts: string[] = [];
    if (u) parts.push("underline");
    if (strike) parts.push("line-through");
    styles["text-decoration"] = parts.join(" ");
  }

  return styles;
}

function wrapWithStyles(leaf: any, styles: Record<string, string>, ownerDoc: any): void {
  if (leaf.nodeType === 1) {
    for (const [k, v] of Object.entries(styles)) setStyle(leaf, k, v);
    return;
  }
  const parent = leaf.parentNode;
  if (!parent) return;

  const span = createSpan(ownerDoc);
  for (const [k, v] of Object.entries(styles)) {
    const cur = span.getAttribute("style") || "";
    span.setAttribute("style", cur + `${k}: ${v}; `);
  }
  parent.replaceChild(span, leaf);
  span.appendChild(leaf);
}

function wrapVertAlign(leaf: any, kind: "superscript" | "subscript", ownerDoc: any): void {
  if (leaf.nodeType === 1) {
    const tag = (leaf.tagName || "").toUpperCase();
    if (tag === "SUB" || tag === "SUP") return;
  }
  const parent = leaf.parentNode;
  if (!parent) return;

  const wrapper = createWrapper(ownerDoc, kind === "superscript" ? "sup" : "sub");
  parent.replaceChild(wrapper, leaf);
  wrapper.appendChild(leaf);
}

function createSpan(ownerDoc: any): any {
  if (ownerDoc.createElementNS) {
    return ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  }
  return ownerDoc.createElement("span");
}

function createWrapper(ownerDoc: any, tag: string): any {
  if (ownerDoc.createElementNS) {
    return ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  }
  return ownerDoc.createElement(tag);
}

function attrValue(node: any, ns: string, name: string): string | null {
  if (!node) return null;
  const v = node.getAttributeNS?.(ns, name);
  if (v) return v;
  if (ns === W_NS) {
    const wv = node.getAttribute?.("w:" + name);
    if (wv) return wv;
  }
  return node.getAttribute?.(name) || null;
}

function setStyle(el: any, prop: string, value: string): void {
  if (!el || typeof el.setAttribute !== "function") return;
  const existing = el.getAttribute("style") || "";
  const re = new RegExp("(?:^|;)\\s*" + cssEscape(prop) + "\\s*:[^;]*", "i");
  const decl = `${prop}: ${value}`;
  let next: string;
  if (re.test(existing)) {
    next = existing.replace(re, "; " + decl).replace(/^;\s*/, "");
  } else {
    next = existing ? existing + "; " + decl : decl;
  }
  el.setAttribute("style", next);
}

function cssEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightToCss(name: string): string {
  const map: Record<string, string> = {
    yellow: "#ffff00",
    green: "#00ff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    blue: "#0000ff",
    red: "#ff0000",
    darkBlue: "#00008b",
    darkCyan: "#008b8b",
    darkGreen: "#006400",
    darkMagenta: "#8b008b",
    darkRed: "#8b0000",
    darkYellow: "#808000",
    darkGray: "#a9a9a9",
    lightGray: "#d3d3d3",
    black: "#000000",
    white: "#ffffff",
  };
  return map[name] || "";
}

function serializeContainer(container: any): string {
  if (typeof container.innerHTML !== "undefined") return container.innerHTML;
  const out: string[] = [];
  const children = container.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    out.push((children[i] as any).toString?.() || "");
  }
  return out.join("");
}

async function collectImageSources(node: any, sources: Set<string>): Promise<void> {
  if (!node) return;
  if (node.type?.name === "image") {
    const src = node.attrs?.src;
    if (src && !sources.has(src)) sources.add(src);
    return;
  }
  if (node.content) {
    for (const child of contentToArray(node.content)) {
      await collectImageSources(child, sources);
    }
  }
}

async function loadImageBytes(src: string): Promise<Uint8Array | null> {
  try {
    if (
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:") ||
      src.startsWith("blob:")
    ) {
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    }
    const raw = await invoke<number[]>("read_image_asset", { relativePath: src });
    return new Uint8Array(raw);
  } catch (e) {
    console.warn("[docx export] failed to read image asset, skipping:", src, e);
    return null;
  }
}

/** The pictures of the drawn shapes, for the duration of one export. */
let shapeBitmaps: Map<unknown, ShapeBitmap> | null = null;

export async function toDocx(doc: any): Promise<Document> {
  const sources = new Set<string>();
  await collectImageSources(doc, sources);
  const imageCache = new Map<string, Uint8Array>();
  await Promise.all(
    Array.from(sources).map(async (src) => {
      const bytes = await loadImageBytes(src);
      if (bytes) imageCache.set(src, bytes);
    })
  );

  // The drawn shapes become pictures here, once, before the walk: Word has no
  // shapes of ours, and a picture is what the format can carry.
  shapeBitmaps = new Map();
  const rasterTasks: Promise<void>[] = [];
  doc.descendants((node: any) => {
    if (node.type?.name !== "shape") return;
    rasterTasks.push(
      shapeBitmap(node).then((bitmap) => {
        if (bitmap) shapeBitmaps?.set(node, bitmap);
      }),
    );
  });
  await Promise.all(rasterTasks);

  const margins = getMargins();
  const page = getPageFormat();

  resetListInstances();
  const children: any[] = [];
  for (const node of contentToArray(doc.content)) {
    // E7: Word's own drop cap is a FRAME on a paragraph that holds the letter
    // alone, with the rest of the text in the next paragraph. So the paragraph
    // is split here, exactly as Word writes it.
    if ((node.type?.name === "paragraph" || node.type?.name === "heading") && dropCapLines(node) > 0) {
      children.push(...dropCapParagraphs(node, imageCache));
      continue;
    }
    const nodeChildren = nodeToChildren(node, imageCache, false);
    children.push(...nodeChildren);
  }

  const pxToTwip = (px: number) => px * 15;

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pxToTwip(page.widthPx),
              height: pxToTwip(page.heightPx),
            },
            margin: {
              top: pxToTwip(margins.top),
              bottom: pxToTwip(margins.bottom),
              left: pxToTwip(margins.left),
              right: pxToTwip(margins.right),
              header: pxToTwip(page.headerPx),
              footer: pxToTwip(page.footerPx),
            },
          },
        },
        children,
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "IntenseQuote",
          name: "Intense Quote",
          basedOn: "Normal",
          next: "Normal",
          paragraph: {
            indent: { left: 720 },
            border: {
              left: { color: "2E74B5", size: 24, space: 4, style: "single" },
              bottom: { color: "2E74B5", size: 8, space: 1, style: "single" },
            },
            spacing: { before: 200, after: 200 },
          },
          run: { color: "2E74B5", bold: true, italics: true },
        },
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          paragraph: {
            alignment: AlignmentType.CENTER,
            border: {
              bottom: { color: "2E74B5", size: 8, space: 4, style: "single" },
            },
            spacing: { after: 240 },
          },
          run: { bold: true, size: 56, color: "2E74B5" },
        },
        {
          id: "Caption",
          name: "Caption",
          basedOn: "Normal",
          next: "Normal",
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 120 },
          },
          run: { italics: true, size: 18, color: "666666" },
        },
      ],
    },
    numbering: { config: numberingConfigFor(doc) },
  });
}

/**
 * E6 — the levels of a list, as Word writes them: nine, with the indent growing
 * by one step each, because Word's own dialog offers exactly nine and a deeper
 * nest has no definition to point at.
 */
const LIST_LEVELS = 9;
const LIST_INDENT = 720;
const LIST_HANGING = 360;
const BULLETS = ["\u2022", "\u25E6", "\u25AA"]; // • ◦ ▪, cycling by depth as Word does
const ORDERED_STEM = "aw-ol";

/** The nine levels of a bullet list (the glyph cycles every three depths). */
function bulletLevels(): ILevelsOptions[] {
  return Array.from({ length: LIST_LEVELS }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: BULLETS[level % BULLETS.length],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_HANGING } } },
  }));
}

/** The nine levels of a numbered list: %1. %2. … — each depth its own counter. */
function orderedLevels(start = 1): ILevelsOptions[] {
  return Array.from({ length: LIST_LEVELS }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: "%" + (level + 1) + ".",
    alignment: AlignmentType.LEFT,
    // The start belongs to the FIRST level: that is where a list says "begin at 5".
    ...(level === 0 && start !== 1 ? { start } : {}),
    style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_HANGING } } },
  }));
}

/**
 * The numbering definitions a document needs: one for bullets, one for ordered
 * lists starting at 1, and one per other start value the document actually uses
 * (ol start="5"). Nothing is invented for a start of 1, which is the default.
 */
function numberingConfigFor(doc: any): Array<{ reference: string; levels: ILevelsOptions[] }> {
  const starts = new Set<number>();
  // The DOCUMENT is walked, not the exported paragraphs: a paragraph carries no
  // node type, and a list's start lives on the list.
  const walk = (node: any) => {
    if (!node) return;
    if (node.type?.name === "ordered_list") {
      const start = Number(node.attrs?.order);
      if (Number.isFinite(start) && start > 1) starts.add(Math.min(999, Math.round(start)));
    }
    if (node.content) for (const child of contentToArray(node.content)) walk(child);
  };
  walk(doc);
  return [
    { reference: "aw-bullet", levels: bulletLevels() },
    { reference: ORDERED_STEM, levels: orderedLevels() },
    ...[...starts].sort((a, b) => a - b).map((start) => ({
      reference: ORDERED_STEM + "-from-" + start,
      levels: orderedLevels(start),
    })),
  ];
}

/** The reference an ordered list uses, given the number it starts from. */
function orderedReferenceFor(listNode: any): string {
  const start = Number(listNode.attrs?.order);
  return Number.isFinite(start) && start > 1 ? ORDERED_STEM + "-from-" + Math.min(999, Math.round(start)) : ORDERED_STEM;
}

/**
 * E6 — a list, ALL of it: the numbered paragraph of every item, the paragraphs
 * that follow it inside the item, and the nested lists one level deeper, which
 * keep their parent's numbering so the levels stay one list. Before this, only
 * the first paragraph of every item was exported and nesting was flattened.
 */
function listToParagraphs(
  listNode: any,
  level: number,
  reference: string,
  instance: number,
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of contentToArray(listNode.content)) {
    if (item.type?.name !== "list_item") continue;
    let numbered = false;
    for (const child of contentToArray(item.content)) {
      const name = child.type?.name;
      if (name === "bullet_list" || name === "ordered_list") {
        out.push(...listToParagraphs(child, Math.min(LIST_LEVELS - 1, level + 1), reference, instance));
        continue;
      }
      const lh = lineHeightToTwips(child.attrs?.lineHeight) ?? defaultRhythmTwips();
      const spacing: any = lh ? { line: lh, lineRule: "auto" } : undefined;
      out.push(
        new Paragraph({
          children: nodeContentToRuns(child),
          ...(numbered
            ? {}
            : { numbering: { reference, level: Math.min(LIST_LEVELS - 1, level), instance } }),
          ...(spacing ? { spacing } : {}),
        }),
      );
      numbered = true;
    }
    // An item with no block at all still occupies its bullet in Word.
    if (!numbered && out.length === 0) {
      out.push(new Paragraph({ numbering: { reference, level: Math.min(LIST_LEVELS - 1, level), instance } }));
    }
  }
  return out;
}

/** The next numbering instance: one per top-level list, so each list restarts. */
let listInstanceCounter = 0;

/** Reset before a document is exported (the counter belongs to one document). */
function resetListInstances(): void {
  listInstanceCounter = 0;
}

function nodeToChildren(node: any, imageCache: Map<string, Uint8Array>, pageBreakBefore: boolean = false): any[] {
  // The element table decides what each element becomes in Word (TT): a
  // picture run for the photo, its own text for figure and box today. A new
  // kind must declare its case here or the switch stops compiling.
  const element = elementTypeOf(node);
  if (element) {
    switch (element.kind) {
      case "image": {
        const bytes = imageCache.get(node.attrs?.src || "");
        if (!bytes) return [];
        return [
          new Paragraph({
            children: [buildImageRun(node, bytes)],
            alignment: paragraphAlignFromAttr(node.attrs?.align),
            pageBreakBefore,
          }),
        ];
      }
      case "figure":
      case "styled_box":
      case "bubble":
        // Word keeps the words. The balloon's tail is a drawing and has no Word
        // counterpart: the declared limit shared with the shapes' pictures.
        return [new Paragraph({ children: [new TextRun({ text: getTextContent(node) })] })];
      case "shape": {
        // Word cannot carry our shapes, so the drawing travels as a picture,
        // painted once before the walk. The format decides; there is no button.
        const bitmap = shapeBitmaps?.get(node);
        if (!bitmap) return [];
        const transformation: any = { width: bitmap.widthPx, height: bitmap.heightPx };
        const rotation = Number(node.attrs?.rotation) || 0;
        if (rotation) transformation.rotation = rotation;
        if (node.attrs?.flipH || node.attrs?.flipV) {
          transformation.flip = {
            horizontal: node.attrs?.flipH || undefined,
            vertical: node.attrs?.flipV || undefined,
          };
        }
        return [
          new Paragraph({
            children: [new ImageRun({ type: "png", data: bitmap.bytes, transformation })],
            alignment: paragraphAlignFromAttr(node.attrs?.align),
            pageBreakBefore,
          }),
        ];
      }
      default:
        return assertNeverKind(element.kind);
    }
  }
  switch (node.type.name) {
    case "table":
      return [tableNodeToDocx(node)];
    case "paragraph":
      return [paragraphFromNode(node, { align: node.attrs?.align, pageBreakBefore }, imageCache)];
    case "heading": {
      const isTitle = node.attrs?.level === 1 && node.attrs?.align === "center";
      return [
        paragraphFromNode(node, {
          heading: isTitle ? HeadingLevel.TITLE : getHeadingLevel(node.attrs.level),
          style: isTitle ? "Title" : undefined,
          align: node.attrs?.align,
          pageBreakBefore,
        }, imageCache),
      ];
    }
    case "blockquote":
      return contentToArray(node.content).map((child: any, i: number) =>
        paragraphFromNode(child, { style: "IntenseQuote", pageBreakBefore: pageBreakBefore && i === 0 }, imageCache)
      );
    case "code_block":
      return contentToArray(node.content).map((child: any, i: number) => {
        const txt = getTextContent(child);
        return new Paragraph({
          children: [new TextRun({ text: txt, font: "Courier New", size: 20 })],
          shading: { fill: "F5F5F5" },
          indent: { left: 360 },
          spacing: { before: 80, after: 80, line: 240 },
          pageBreakBefore: pageBreakBefore && i === 0,
        });
      });
    case "bullet_list":
      listInstanceCounter += 1;
      return listToParagraphs(node, 0, "aw-bullet", listInstanceCounter);
    case "ordered_list":
      listInstanceCounter += 1;
      return listToParagraphs(node, 0, orderedReferenceFor(node), listInstanceCounter);
    case "horizontal_rule":
      return [
        new Paragraph({
          children: [new TextRun("")],
          border: {
            bottom: { color: "CCCCCC", size: 1, space: 1, style: "single" },
          },
          pageBreakBefore,
        }),
      ];
    case "page":
      return contentToArray(node.content).flatMap((child: any) => nodeToChildren(child, imageCache));
    default:
      if (node.type?.spec?.tableRole === "table") {
        return [tableNodeToDocx(node)];
      }
      if (node.isBlock) {
        return [new Paragraph({ children: [new TextRun({ text: getTextContent(node) })] })];
      }
      return [];
  }
}

function paragraphAlignFromAttr(align: string | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  if (align === "left") return AlignmentType.LEFT;
  if (align === "right") return AlignmentType.RIGHT;
  if (align === "center") return AlignmentType.CENTER;
  return undefined;
}

function buildImageRun(node: any, bytes: Uint8Array): ImageRun {
  const alt: string = node.attrs?.alt || "";
  const width: number | null = node.attrs?.width ?? null;
  const height: number | null = node.attrs?.height ?? null;
  const imgWidth = width || 200;
  const imgHeight = height || 200;
  const src: string = (node.attrs?.src || "").toLowerCase();
  let type: "png" | "jpg" | "gif" | "bmp" | "webp" = "png";
  if (src.endsWith(".jpg") || src.endsWith(".jpeg")) type = "jpg";
  else if (src.endsWith(".gif")) type = "gif";
  else if (src.endsWith(".bmp")) type = "bmp";
  else if (src.endsWith(".webp")) type = "webp";

  const wrap = isWrapping(textConditionOf(node));
  const rotation: number = node.attrs?.rotation || 0;
  const flipH: boolean = !!node.attrs?.flipH;
  const flipV: boolean = !!node.attrs?.flipV;
  const align: string = node.attrs?.align || "center";

  // F3.a: wrapping became the born-default (contract §2.10), so it can no
  // longer be the only trigger for a floating Word object - that would turn
  // every centred image into a floating one on export. This mirrors the rule
  // the editor and the page calculator already use (floatSpecOf): a band
  // needs a SIDE. Free-positioned elements join this decision at F3.d, when
  // the output channels are defined.
  const needsFloating = wrap && (align === "left" || align === "right");
  const needsTransform = rotation !== 0 || flipH || flipV;

  const transformation: any = { width: imgWidth, height: imgHeight };
  if (needsTransform) {
    if (rotation !== 0) transformation.rotation = rotation;
    if (flipH || flipV) {
      transformation.flip = {
        horizontal: flipH || undefined,
        vertical: flipV || undefined,
      };
    }
  }

  const opts: any = {
    type,
    data: bytes,
    transformation,
  };

  if (alt) {
    opts.altText = { title: alt, description: alt, name: alt };
  }

  if (needsFloating) {
    const hPos: any = {
      relative: HorizontalPositionRelativeFrom.COLUMN,
    };
    let hAlign: (typeof HorizontalPositionAlign)[keyof typeof HorizontalPositionAlign];
    switch (align) {
      case "left":
        hAlign = HorizontalPositionAlign.LEFT;
        break;
      case "right":
        hAlign = HorizontalPositionAlign.RIGHT;
        break;
      default:
        hAlign = HorizontalPositionAlign.CENTER;
        break;
    }
    hPos.align = hAlign;

    const vPos: any = {
      relative: VerticalPositionRelativeFrom.PARAGRAPH,
      align: VerticalPositionAlign.TOP,
    };

    opts.floating = {
      horizontalPosition: hPos,
      verticalPosition: vPos,
      wrap: {
        type: TextWrappingType.SQUARE,
        side: TextWrappingSide.BOTH_SIDES,
      },
      margins: {
        top: 0,
        bottom: 0,
        left: 720,
        right: 720,
      },
      allowOverlap: true,
      behindDocument: false,
    };
  }

  return new ImageRun(opts);
}

// The default line a table has always exported with, and Word's explicit
// absence. "nil" rather than "none": a cell's "none" can still lose against a
// table-level border in Word, "nil" wins every conflict.
const DEFAULT_CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
/**
 * E6 — the tint of a banded body row, composed on white: the screen's
 * rgba(74,144,217,0.06) (05-document.css). The two sides quote the same colour:
 * a view that changes alone would give two different tables.
 */
const TABLE_BAND_FILL = "F4F8FD";
const NO_CELL_BORDER = { style: BorderStyle.NIL, size: 0, color: "auto" };

/** A cell's border on one side, in Word's units (w:tcBorders; size in eighth-points). */
function cellBorderForDocx(
  value: unknown,
  fallback: typeof DEFAULT_CELL_BORDER | typeof NO_CELL_BORDER = DEFAULT_CELL_BORDER,
) {
  const border = parseBorder(value);
  if (border === null) return fallback;
  if (border === "none") return NO_CELL_BORDER;
  return {
    style: BorderStyle.SINGLE,
    size: Math.max(2, Math.round(border.widthPt * 8)),
    color: border.color.replace("#", ""),
  };
}

function tableNodeToDocx(tableNode: any): Table {
  const rows: TableRow[] = [];

  // The columns are proportions of the text column (table-widths.ts). Word wants
  // lengths, so the proportions are turned into twips against the width the page
  // gives the text — the same width the editor and the page count use.
  const margins = getMargins();
  const page = getPageFormat();
  const contentPx = Math.max(1, page.widthPx - margins.left - margins.right);
  const twips = columnTwips(columnPercents(columnWeights(tableNode)), contentPx);
  const totalTwips = twips.reduce((sum, value) => sum + value, 0) || Math.round(contentPx * 15);
  // Lo stile "plain" toglie le linee anche nel file: una tabella senza linee a
  // schermo e con le linee in Word sarebbe la stessa tabella in due modi diversi.
  // Le bande non viaggiano: sono una scelta della vista, e il canale ha i
  // riempimenti delle celle.
  const defaultBorder = tableNode.attrs?.tableStyle === "plain" ? NO_CELL_BORDER : DEFAULT_CELL_BORDER;
  // E6: the bands of the view become a real fill. Body rows are counted as the
  // screen counts them (the head is not a body row), and a cell with a fill of
  // its own wins, exactly as in 05-document.css.
  const banded = tableNode.attrs?.tableStyle === "banded";
  let bodyRow = 0;

  contentToArray(tableNode.content).forEach((row: any, rowIndex: number) => {
    if (row.type.name !== "table_row") return;
    // E6: the body rows are counted BEFORE the cells are filled, so this row
    // knows its own number (the head is not a body row): 1, 2, 3…
    if (!isHeaderRow(row)) bodyRow += 1;
    const cells: TableCell[] = [];
    let col = 0;

    contentToArray(row.content).forEach((cell: any) => {
      if (cell.type.name !== "table_cell" && cell.type.name !== "table_header") return;
      const colspan = Math.max(1, cell.attrs?.colspan || 1);
      const rowspan = Math.max(1, cell.attrs?.rowspan || 1);
      const cellTwips = twips.slice(col, col + colspan).reduce((sum, value) => sum + value, 0);
      col += colspan;

      const paragraphs: Paragraph[] = contentToArray(cell.content).map((child: any) =>
        paragraphFromNode(child, {})
      );
      if (paragraphs.length === 0) {
        paragraphs.push(new Paragraph({ children: [] }));
      }

      const cellOpts: any = {
        children: paragraphs,
        columnSpan: colspan,
        rowSpan: rowspan,
        // The cell's share of the text column, in twips.
        width: cellTwips > 0 ? { size: cellTwips, type: WidthType.DXA } : undefined,
        // One line per side: the cell's own border, the default, or "no line".
        // A boundary between two cells is drawn by Word out of both sides, the
        // same rule the editor's panel writes both sides for.
        borders: {
          top: cellBorderForDocx(cell.attrs?.borderTop, defaultBorder),
          bottom: cellBorderForDocx(cell.attrs?.borderBottom, defaultBorder),
          left: cellBorderForDocx(cell.attrs?.borderLeft, defaultBorder),
          right: cellBorderForDocx(cell.attrs?.borderRight, defaultBorder),
        },
      };
      // The cell's fill. Three states, as on screen: a colour, "no fill" (the empty
      // string the × leaves), or nothing at all — and a header cell with nothing at
      // all carries the stylesheet's default tint, so the file gets the same colour.
      const rawFill = cell.attrs?.backgroundColor;
      const cellFill = normalizeColor(rawFill);
      if (cellFill) {
        cellOpts.shading = { fill: cellFill };
      } else if (rawFill !== "" && cell.type.name === "table_header") {
        cellOpts.shading = { fill: "F1F6FC" };
      } else if (rawFill !== "" && banded && bodyRow > 0 && bodyRow % 2 === 0) {
        cellOpts.shading = { fill: TABLE_BAND_FILL };
      }
      // Where the text sits in the cell (Word's w:vAlign). `top` is the default of
      // both formats and is left out.
      if (cell.attrs?.verticalAlign === "middle") cellOpts.verticalAlign = VerticalAlign.CENTER;
      else if (cell.attrs?.verticalAlign === "bottom") cellOpts.verticalAlign = VerticalAlign.BOTTOM;
      cells.push(new TableCell(cellOpts));
    });

    const rowOpts: any = { children: cells };
    // A row breaks whole: the table is cut BETWEEN rows, both on screen and in
    // the file (`w:cantSplit`), never through the middle of one.
    rowOpts.cantSplit = true;
    // The head of the table is repeated at the top of every sheet it continues
    // on: `w:tblHeader` is Word's way of saying the same thing the screen draws
    // (pagination-cassie-plugin.ts, `headCopy`).
    if (rowIndex === 0 && isHeaderRow(row)) rowOpts.tableHeader = true;
    // A row's height is a minimum (w:trHeight with the "at least" rule): the row
    // grows when its cells need more, which is what the editor draws.
    const rowHeight = Number(row.attrs?.rowHeight);
    if (Number.isFinite(rowHeight) && rowHeight > 0) {
      rowOpts.height = { value: Math.round(rowHeight * 15), rule: HeightRule.ATLEAST };
    }
    rows.push(new TableRow(rowOpts));
  });

  return new Table({
    rows,
    width: { size: totalTwips, type: WidthType.DXA },
    // The grid as well as the cells: Word reads this one when it lays the table out.
    columnWidths: twips,
    // Word's own "fixed" layout, which is what percentages mean here: a long word
    // wraps instead of widening the column the writer sized.
    layout: TableLayoutType.FIXED,
    // Il margine interno della cella in twip (w:tblCellMar): quello della tabella,
    // o il margine di Word — 0,19 cm a destra e a sinistra, niente sopra e sotto —
    // senza il quale Word applica il suo in silenzio e le celle escono più strette
    // di come l'editor le disegna (05-document.css, table-padding.ts).
    margins: cellPaddingTwips(cellPaddingOf(tableNode.attrs ?? {})),
  });
}

interface ParagraphExtras {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  indent?: { left?: number; right?: number; firstLine?: number; hanging?: number };
  italic?: boolean;
  style?: string;
  pageBreakBefore?: boolean;
}

function paragraphFromNode(node: any, extras: ParagraphExtras = {}, imageCache?: Map<string, Uint8Array>): Paragraph {
  const runs = nodeContentToRuns(node, imageCache);
  const opts: any = { children: runs };

  if (extras.heading) opts.heading = extras.heading;
  if (extras.style) opts.style = extras.style;
  if (extras.indent) opts.indent = extras.indent;
  // E2: the chosen indent trio is direct formatting (cm -> twips). A negative
  // first line is Word's hanging; the two never travel together.
  const indLeft = node.attrs?.indentLeft;
  const indRight = node.attrs?.indentRight;
  const indFirst = node.attrs?.indentFirst;
  const chosenIndent: { left?: number; right?: number; firstLine?: number; hanging?: number } = {};
  if (typeof indLeft === "number" && indLeft > 0) chosenIndent.left = Math.round(indLeft * CM_TO_TWIP);
  if (typeof indRight === "number" && indRight > 0) chosenIndent.right = Math.round(indRight * CM_TO_TWIP);
  if (typeof indFirst === "number" && indFirst !== 0) {
    if (indFirst > 0) chosenIndent.firstLine = Math.round(indFirst * CM_TO_TWIP);
    else chosenIndent.hanging = Math.round(-indFirst * CM_TO_TWIP);
  }
  if (Object.keys(chosenIndent).length > 0) {
    opts.indent = { ...(opts.indent || {}), ...chosenIndent };
  }
  // E3: the tab stops as Word's own `w:pPr/w:tabs` (twips from the text margin,
  // the origin both programs count from). A stop Word does not know (a fill
  // character we keep) simply travels without its leader.
  const stops = parseTabStops(node.attrs?.tabStops);
  if (stops.length) {
    const leaderOf = (ch: string | null): (typeof LeaderType)[keyof typeof LeaderType] | undefined => {
      switch (ch) {
        case ".":
          return LeaderType.DOT;
        case "-":
          return LeaderType.HYPHEN;
        case "_":
          return LeaderType.UNDERSCORE;
        case "·":
          return LeaderType.MIDDLE_DOT;
        default:
          return undefined;
      }
    };
    opts.tabStops = stops.map((s) => ({
      type: TabStopType[(s.align === "left" ? "LEFT" : s.align === "center" ? "CENTER" : s.align === "right" ? "RIGHT" : "DECIMAL") as keyof typeof TabStopType],
      position: Math.round(s.pos * CM_TO_TWIP),
      leader: leaderOf(s.leader),
    }));
  }
  if (extras.italic) {
    runs.forEach((r: RunOrLinkOrImage) => {
      const o: any = (r as any).options;
      if (o && (o.text != null || o.children)) o.italics = true;
    });
  }

  // A table's title and note are small italic captions in the editor (12px); in
  // Word they go out as Word's own caption size, 9pt in half-points, italic.
  if (node.attrs?.tableCaption) {
    runs.forEach((r: RunOrLinkOrImage) => {
      const o: any = (r as any).options;
      if (o && (o.text != null || o.children)) {
        o.italics = true;
        o.size = 18;
      }
    });
  }

  const align = alignToDocx(node.attrs?.align) ?? extras.align;
  if (align) opts.alignment = align;

  const lh = lineHeightToTwips(node.attrs?.lineHeight)
    ?? (node.type?.name === "paragraph" && !node.attrs?.tableCaption ? defaultRhythmTwips() : undefined);
  const spacing: any = { ...(opts.spacing || {}) };
  if (lh) {
    spacing.line = lh;
    spacing.lineRule = "auto";
  }
  if (node.type?.name === "paragraph" && !extras.style) {
    spacing.after = 200;
  }
  // E1: a chosen before/after is direct formatting: it beats the style's
  // defaults and the channel's own rhythm. Word counts twentieths of a pt.
  const chosenBefore = node.attrs?.spaceBefore;
  const chosenAfter = node.attrs?.spaceAfter;
  if (typeof chosenBefore === "number" && Number.isFinite(chosenBefore)) {
    spacing.before = Math.round(chosenBefore * 20);
  }
  if (typeof chosenAfter === "number" && Number.isFinite(chosenAfter)) {
    spacing.after = Math.round(chosenAfter * 20);
  }
  if (Object.keys(spacing).length > 0) {
    opts.spacing = spacing;
  }

  if (node.attrs?.pageBreakBefore || extras.pageBreakBefore) {
    opts.pageBreakBefore = true;
  }

  return new Paragraph(opts);
}

function makeRun(text: string, marks: any[]): TextRun {
  const opts: any = { text };

  for (const mark of marks) {
    switch (mark.type.name) {
      case "strong":
        opts.bold = true;
        break;
      case "em":
        opts.italics = true;
        break;
      case "underline":
        opts.underline = { type: "single" };
        break;
      case "strikethrough":
        opts.strike = true;
        break;
      case "textColor":
        if (mark.attrs?.color) {
          const c = normalizeColor(mark.attrs.color);
          if (c) opts.color = c;
        }
        break;
      case "highlight":
        if (mark.attrs?.color) {
          const c = normalizeColor(mark.attrs.color);
          if (!c) break;
          const name = hexToHighlightName(c);
          if (name) {
            opts.highlight = name;
          } else {
            opts.shading = { fill: c };
          }
        }
        break;
      case "fontSize":
        if (mark.attrs?.size) {
          const halfPt = fontSizeFromPx(mark.attrs.size);
          if (halfPt) opts.size = halfPt;
        }
        break;
      case "fontFamily":
        if (mark.attrs?.font) {
          opts.font = mark.attrs.font;
        }
        break;
      case "code":
        opts.font = "Courier New";
        opts.shading = { fill: "F5F5F5" };
        break;
      case "link":
        if (mark.attrs?.href) {
          opts.hyperlink = mark.attrs.href;
        }
        break;
    }
  }

  // E3: a tabulation is not a character in Word — it is a `<w:tab/>` element of
  // its own. The text is split around every `\t` and a Tab goes between the
  // pieces, so the run keeps its marks (the file says what the screen shows).
  if (text.includes("\t")) {
    const children: any[] = [];
    const pieces = text.split("\t");
    pieces.forEach((piece, i) => {
      if (i > 0) children.push(new Tab());
      if (piece) children.push(piece);
    });
    opts.children = children;
  } else {
    opts.text = text;
  }

  return new TextRun(opts);
}

type RunOrLink = TextRun | ExternalHyperlink;
type RunOrLinkOrImage = RunOrLink | ImageRun;

function nodeContentToRuns(node: any, imageCache?: Map<string, Uint8Array>): RunOrLinkOrImage[] {
  if (!node.content) {
    const text = node.text || "";
    return text ? [makeRun(text, [])] : [];
  }

  return contentToArray(node.content).map((child: any) => {
    if (child.type.name === "image") {
      if (!imageCache) return new TextRun({ text: "" });
      const bytes = imageCache.get(child.attrs?.src || "");
      if (!bytes) return new TextRun({ text: "" });
      return buildImageRun(child, bytes);
    }
    if (child.type.name === "hard_break") {
      // Shift+Enter break -> Word line break (w:br) at this point of the run sequence
      return new TextRun({ text: "", break: 1 });
    }
    // E5: a field is a REAL field in Word — DATE, TIME or AUTHOR with the cached
    // text this document shows — not the string frozen into a run.
    if (child.type.name === "field") {
      return fieldRun(child);
    }
    if (child.type.name !== "text") {
      return new TextRun({ text: getTextContent(child) });
    }
    const marks = child.marks || [];
    const linkMark = marks.find((m: any) => m.type.name === "link");
    if (linkMark && linkMark.attrs?.href) {
      const innerRun = makeRun(child.text || "", marks.filter((m: any) => m.type.name !== "link"));
      const innerText = (innerRun as any).options?.text ?? child.text ?? "";
      const run = new TextRun({
        text: innerText,
        color: "0563C1",
        underline: { type: "single" },
        bold: (innerRun as any).options?.bold,
        italics: (innerRun as any).options?.italics,
        size: (innerRun as any).options?.size,
        font: (innerRun as any).options?.font,
        shading: (innerRun as any).options?.shading,
        highlight: (innerRun as any).options?.highlight,
        strike: (innerRun as any).options?.strike,
      });
      return new ExternalHyperlink({
        link: linkMark.attrs.href,
        children: [run],
      });
    }
    return makeRun(child.text || "", marks);
  });
}

/**
 * The Word field for a `field` atom: the instruction Word re-computes, and the
 * text this document shows as the cached value. The picture is the one the atom
 * carries, so the format the writer chose survives the round trip.
 */
function fieldRun(node: any): TextRun {
  const attrs = node.attrs || {};
  const kind = attrs.kind === "time" ? "time" : attrs.kind === "name" ? "name" : "date";
  const text = typeof attrs.text === "string" ? attrs.text : getTextContent(node);
  if (kind === "name") {
    return new SimpleField("AUTHOR", text) as unknown as TextRun;
  }
  const field = kind === "time" ? "TIME" : "DATE";
  // The picture defaults to the catalog's own, never to an empty switch.
  const picture = docxPicture(findFormat(attrs.format, kind) ?? findFormat(null, kind)!);
  // A quote inside the picture would end Word's switch early.
  const safe = picture.replace(/"/g, "");
  return new SimpleField(`${field} \\@ "${safe}"`, text) as unknown as TextRun;
}

/** E7: how many lines a block drops, or 0. */
function dropCapLines(node: any): number {
  const raw = Number(node.attrs?.dropCapLines);
  if (!Number.isFinite(raw) || raw < 2) return 0;
  return Math.min(6, Math.round(raw));
}

/**
 * E7 — the drop cap as Word stores it: a paragraph carrying `w:framePr` with
 * `w:dropCap="drop"` and the letter alone, then the paragraph with the rest of
 * the text. Word computes the letter's size from the lines it is given; the
 * width and height below only keep the frame well-formed.
 */
function dropCapParagraphs(node: any, imageCache?: Map<string, Uint8Array>): Paragraph[] {
  const lines = dropCapLines(node);
  const text = getTextContent(node);
  const index = text.search(/\S/);
  if (index < 0) return nodeToChildren(node, imageCache ?? new Map(), false) as Paragraph[];
  const letter = text[index];
  const rest = text.slice(0, index) + text.slice(index + 1);
  const gapCm = Number(node.attrs?.dropCapGap);
  const gapTwips = Math.round((Number.isFinite(gapCm) && gapCm >= 0 ? gapCm : 0.2) * CM_TO_TWIP);
  // The letter keeps the marks it had, and the rest of the text keeps its own:
  // the first visible character is taken out of the runs, not re-typed.
  let letterMarks: any[] = [];
  node.forEach((child: any) => {
    if (letterMarks.length || !child.isText) return;
    if (/\S/.test(child.text ?? "")) letterMarks = child.marks ?? [];
  });
  const letterRun = makeRun(letter, letterMarks);
  const frame = {
    dropCap: DropCapType.DROP,
    lines,
    wrap: FrameWrap.AROUND,
    width: Math.round(gapTwips + 360),
    height: lines * 240,
    space: { horizontal: gapTwips, vertical: 0 },
    anchor: { horizontal: FrameAnchorType.MARGIN, vertical: FrameAnchorType.TEXT },
  } as any;
  const letterParagraph = new Paragraph({
    children: [letterRun],
    frame,
    // No rhythm of its own: the letter is a float, not a line of the text.
    spacing: { before: 0, after: 0, line: 240 },
  });
  const restParagraph = new Paragraph({
    children: runsWithoutFirstLetter(node).length
      ? runsWithoutFirstLetter(node)
      : [new TextRun({ text: rest })],
    spacing: { before: 0, after: 0, line: 240 },
    indent: { left: 0 },
  });
  return [letterParagraph, restParagraph];
}

/** E7: the runs of a paragraph, minus the first visible character. */
function runsWithoutFirstLetter(node: any): TextRun[] {
  const out: TextRun[] = [];
  let taken = false;
  node.forEach((child: any) => {
    if (!child.isText) {
      out.push(new TextRun({ text: getTextContent(child) }));
      return;
    }
    let text = child.text ?? "";
    if (!taken) {
      const index = text.search(/\S/);
      if (index >= 0) {
        text = text.slice(0, index) + text.slice(index + 1);
        taken = true;
      }
    }
    if (text) out.push(makeRun(text, child.marks ?? []));
  });
  return out;
}

function getTextContent(node: any): string {
  if (!node.content) return node.text || "";
  return contentToArray(node.content)
    .map((child: any) => (child.type?.name === "text" ? child.text || "" : getTextContent(child)))
    .join("");
}

function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    case 6:
      return HeadingLevel.HEADING_6;
    default:
      return HeadingLevel.HEADING_1;
  }
}

export { Packer };

export function fromMarkdownToDocx(markdown: string): Document {
  const lines = markdown.split("\n");
  const children: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("#")) {
      const match = line.match(/^(#{1,6})\s+(.*)/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        children.push(new Paragraph({
          heading: getHeadingLevel(level),
          children: [new TextRun({ text })],
        }));
        i++;
        continue;
      }
    }

    if (line.startsWith(">")) {
      const quoteLines = [line.substring(1).trim()];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].substring(1).trim());
        i++;
      }
      children.push(new Paragraph({
        style: "IntenseQuote",
        children: [new TextRun({ text: quoteLines.join(" ") })],
      }));
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      children.push(new Paragraph({
        children: [new TextRun({ text: codeLines.join("\n"), font: "Courier New", size: 20 })],
        shading: { fill: "F5F5F5" },
        indent: { left: 360 },
        spacing: { before: 80, after: 80, line: 240 },
      }));
      continue;
    }

    if (line.startsWith("|") && line.includes("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|") && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseMdTableToDocxRows(tableLines);
      if (parsed) {
        children.push(parsed);
      }
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        items.push(lines[i].substring(2).trim());
        i++;
      }
      for (const item of items) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `\u2022 ${item}` })],
          indent: { left: 360 },
        }));
      }
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, "").trim());
        i++;
      }
      for (let j = 0; j < items.length; j++) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${j + 1}. ${items[j]}` })],
          indent: { left: 360 },
        }));
      }
      continue;
    }

    if (line === "---" || line === "***") {
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const runs = parseInlineMarkdownToRuns(line);
    children.push(new Paragraph({ children: runs, spacing: { after: 200 } }));
    i++;
  }

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  const margins = getMargins();
  const page = getPageFormat();
  const pxToTwip = (px: number) => px * 15;

  return new Document({
    sections: [{
      properties: {
        page: {
          size: { width: pxToTwip(page.widthPx), height: pxToTwip(page.heightPx) },
          margin: {
            top: pxToTwip(margins.top),
            bottom: pxToTwip(margins.bottom),
            left: pxToTwip(margins.left),
            right: pxToTwip(margins.right),
            header: pxToTwip(page.headerPx),
            footer: pxToTwip(page.footerPx),
          },
        },
      },
      children,
    }],
  });
}

function parseInlineMarkdownToRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\)|[^*[`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: "Courier New" }));
    } else if (match[6] && match[7]) {
      runs.push(new ExternalHyperlink({
        link: match[7],
        children: [new TextRun({ text: match[6] })],
      }));
    } else if (match[0]) {
      runs.push(new TextRun({ text: match[0] }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }

  return runs;
}

function parseMdTableToDocxRows(tableLines: string[]): Table | null {
  if (tableLines.length < 2) return null;

  const dataLines = tableLines.filter((line, idx) => idx !== 1);
  if (dataLines.length === 0) return null;

  const rows: TableRow[] = [];
  for (const line of dataLines) {
    const cells = line.split("|").map(c => c.trim()).filter(c => c.length > 0);
    rows.push(new TableRow({
      children: cells.map(cell => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
        width: { size: Math.floor(9000 / Math.max(cells.length, 1)), type: WidthType.DXA },
      })),
    }));
  }

  return new Table({ rows, width: { size: 9000, type: WidthType.DXA } });
}
