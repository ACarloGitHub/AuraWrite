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
  ImageRun,
  TextWrappingType,
  TextWrappingSide,
  HorizontalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionRelativeFrom,
  VerticalPositionAlign,
} from "docx";
import { calculatePageBreaks, PAGE_WIDTH_PX, PAGE_HEIGHT_PX, PAGE_HEADER_PX, PAGE_FOOTER_PX } from "../editor/pagination-cassie";
import { getMargins } from "../editor/pagination-state";
import { extractTablesFromDocx, tableToHtml } from "./docx-tables";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const _PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

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
  if (lh == null) return undefined;
  const num = typeof lh === "string" ? parseFloat(lh) : lh;
  if (isNaN(num) || num <= 0) return undefined;
  return Math.round(num * 240);
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
  // mammoth in Node requires `buffer` (Node Buffer); in browser it accepts `arrayBuffer`
  const mammothInput: any = (globalThis as any).Buffer
    ? { buffer: (globalThis as any).Buffer.from(arrayBuffer) }
    : { arrayBuffer };
  const result = await mammoth.convertToHtml(mammothInput, { styleMap: MAMMOTH_STYLE_MAP });
  const enriched = await enrichHtml(arrayBuffer, result.value);
  return enriched;
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

  mergeImageCaptions(container, wParagraphs, htmlBlocks);

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

function mergeImageCaptions(container: any, wParagraphs: any[], htmlBlocks: any[]): void {
  const blockByWPara = new Map<number, any>();
  for (let i = 0; i < Math.min(wParagraphs.length, htmlBlocks.length); i++) {
    blockByWPara.set(i, htmlBlocks[i]);
  }

  for (let i = 1; i < wParagraphs.length; i++) {
    const wP = wParagraphs[i];
    const pPr = wP.getElementsByTagNameNS(W_NS, "pPr")?.[0];
    if (!pPr) continue;
    const pStyle = pPr.getElementsByTagNameNS(W_NS, "pStyle")?.[0];
    const styleVal = (attrValue(pStyle, W_NS, "val") || "").toLowerCase();
    if (styleVal !== "caption") continue;

    const el = blockByWPara.get(i);
    if (!el) continue;
    const captionText = (el.textContent || "").trim();
    if (!captionText) continue;

    for (let j = i - 1; j >= 0; j--) {
      const prevEl = blockByWPara.get(j);
      if (!prevEl) continue;
      const imgs = prevEl.getElementsByTagName ? prevEl.getElementsByTagName("img") : [];
      if (imgs.length > 0) {
        const img = imgs[imgs.length - 1];
        img.setAttribute("data-caption", captionText);
        if (prevEl.parentNode) prevEl.parentNode.removeChild(el);
        break;
      }
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
}

function applyRunMeta(wP: any, el: any): void {
  const wRuns: any[] = Array.from(wP.getElementsByTagNameNS(W_NS, "r") || []);
  const ownerDoc = el.ownerDocument || el;

  for (const wR of wRuns) {
    const rPr = wR.getElementsByTagNameNS(W_NS, "rPr")?.[0];
    if (!rPr) continue;
    const rText = runText(wR);
    if (!rText) continue;

    const targetLeaf = findLeafForText(el, rText);
    const dbg = (globalThis as any).__DBG_RUN;
    if (dbg) dbg.push(`run="${rText.substring(0, 20)}" leaf=${targetLeaf ? (targetLeaf.nodeType + "/" + (targetLeaf.textContent || "").substring(0, 20)) : "null"}`);
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
    if (attrs.offsetLeft) img.setAttribute("data-offset-left", String(attrs.offsetLeft));
    if (attrs.offsetTop) img.setAttribute("data-offset-top", String(attrs.offsetTop));
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
  offsetLeft: number;
  offsetTop: number;
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
    offsetLeft: 0,
    offsetTop: 0,
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
      const posOffsetH = posH.getElementsByTagNameNS(WP_NS, "posOffset")?.[0];
      if (posOffsetH) {
        const emuH = parseInt(posOffsetH.textContent || "0", 10);
        if (emuH > 0) result.offsetLeft = Math.round(emuH / 9525);
      }
    }

    const posV = anchor.getElementsByTagNameNS(WP_NS, "positionV")?.[0];
    if (posV) {
      const posOffsetV = posV.getElementsByTagNameNS(WP_NS, "posOffset")?.[0];
      if (posOffsetV) {
        const emuV = parseInt(posOffsetV.textContent || "0", 10);
        if (emuV > 0) result.offsetTop = Math.round(emuV / 9525);
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

  const cassieBreaks = new Set<number>();
  const margins = getMargins();
  try {
    const { breaks } = calculatePageBreaks(doc, margins);
    for (const bp of breaks) {
      cassieBreaks.add(bp.pos);
    }
  } catch { /* page breaks may fail on some docs */ }

  const children: any[] = [];
  let pos = 0;
  for (const node of contentToArray(doc.content)) {
    const isFirstOnNewPage = cassieBreaks.has(pos);
    const nodeChildren = nodeToChildren(node, imageCache, isFirstOnNewPage);
    children.push(...nodeChildren);
    pos += node.nodeSize;
  }

  const pxToTwip = (px: number) => px * 15;

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pxToTwip(PAGE_WIDTH_PX),
              height: pxToTwip(PAGE_HEIGHT_PX),
            },
            margin: {
              top: pxToTwip(margins.top),
              bottom: pxToTwip(margins.bottom),
              left: pxToTwip(margins.left),
              right: pxToTwip(margins.right),
              header: pxToTwip(PAGE_HEADER_PX),
              footer: pxToTwip(PAGE_FOOTER_PX),
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
    numbering: {
      config: [
        {
          reference: "aw-bullet",
          levels: [
            {
              level: 0,
              format: "bullet",
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
        {
          reference: "aw-ordered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
  });
}

function listItemToParagraphs(item: any, numberingRef: string): Paragraph[] {
  // ProseMirror: list_item content: "paragraph block*"
  // The first child is always a paragraph. Subsequent blocks (nested lists) are
  // not supported by the schema yet, so we take only the first paragraph.
  const paragraphs: Paragraph[] = [];
  let firstPara: any = null;
  item.content?.forEach((child: any) => {
    if (!firstPara && child.type?.name === "paragraph") {
      firstPara = child;
    }
  });
  if (firstPara) {
    const lh = lineHeightToTwips(firstPara.attrs?.lineHeight);
    const spacing: any = lh ? { line: lh, lineRule: "auto" } : undefined;
    paragraphs.push(
      new Paragraph({
        children: nodeContentToRuns(firstPara),
        numbering: { reference: numberingRef, level: 0 },
        ...(spacing ? { spacing } : {}),
      }),
    );
  }
  return paragraphs;
}

function _nodeToParagraphs(node: any): Paragraph[] {
  switch (node.type.name) {
    case "paragraph":
      return [paragraphFromNode(node, { align: node.attrs?.align })];
    case "heading": {
      // Title style: heading level 1 with center alignment (set by schema toDOM)
      const isTitle = node.attrs?.level === 1 && node.attrs?.align === "center";
      const p = paragraphFromNode(node, {
        heading: isTitle ? HeadingLevel.TITLE : getHeadingLevel(node.attrs.level),
        style: isTitle ? "Title" : undefined,
        align: node.attrs?.align,
      });
      return [p];
    }
    case "blockquote":
      return contentToArray(node.content).map((child: any) =>
        paragraphFromNode(child, { style: "IntenseQuote" }),
      );
    case "code_block":
      return contentToArray(node.content).map((child: any) => {
        const txt = getTextContent(child);
        return new Paragraph({
          children: [new TextRun({ text: txt, font: "Courier New", size: 20 })],
          shading: { fill: "F5F5F5" },
          indent: { left: 360 },
          spacing: { before: 80, after: 80, line: 240 },
        });
      });
    case "bullet_list":
      return contentToArray(node.content).flatMap((item: any) => listItemToParagraphs(item, "aw-bullet"));
    case "ordered_list":
      return contentToArray(node.content).flatMap((item: any) => listItemToParagraphs(item, "aw-ordered"));
    case "horizontal_rule":
      return [
        new Paragraph({
          children: [new TextRun("")],
          border: {
            bottom: { color: "CCCCCC", size: 1, space: 1, style: "single" },
          },
        }),
      ];
    case "page":
      return contentToArray(node.content).flatMap((child: any) => _nodeToParagraphs(child));
    default:
      if (node.isBlock) {
        return [new Paragraph({ children: [new TextRun({ text: getTextContent(node) })] })];
      }
      return [];
  }
}

function nodeToChildren(node: any, imageCache: Map<string, Uint8Array>, pageBreakBefore: boolean = false): any[] {
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
      return contentToArray(node.content).flatMap((item: any) => listItemToParagraphs(item, "aw-bullet"));
    case "ordered_list":
      return contentToArray(node.content).flatMap((item: any) => listItemToParagraphs(item, "aw-ordered"));
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
    case "image": {
      const bytes = imageCache.get(node.attrs?.src || "");
      if (!bytes) return [];
      const imgParagraph = new Paragraph({
        children: [buildImageRun(node, bytes)],
        alignment: paragraphAlignFromAttr(node.attrs?.align),
        pageBreakBefore,
      });
      const caption = (node.attrs?.caption as string) || "";
      const captionAlign = paragraphAlignFromAttr(node.attrs?.align) || AlignmentType.CENTER;
      if (caption) {
        return [
          imgParagraph,
          new Paragraph({
            children: [new TextRun({ text: caption, italics: true, size: 18 })],
            alignment: captionAlign,
            style: "Caption",
          }),
        ];
      }
      return [imgParagraph];
    }
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

  const wrap: boolean = !!node.attrs?.wrap;
  const rotation: number = node.attrs?.rotation || 0;
  const flipH: boolean = !!node.attrs?.flipH;
  const flipV: boolean = !!node.attrs?.flipV;
  const align: string = node.attrs?.align || "center";
  const offsetLeft: number = node.attrs?.offsetLeft || 0;
  const offsetTop: number = node.attrs?.offsetTop || 0;

  const needsFloating = wrap;
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
    if (offsetLeft > 0) {
      hPos.offset = offsetLeft * 9525;
    } else {
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
    }

    const vPos: any = {
      relative: VerticalPositionRelativeFrom.PARAGRAPH,
      align: VerticalPositionAlign.TOP,
    };
    if (offsetTop > 0) {
      vPos.offset = offsetTop * 9525;
    }

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

function tableNodeToDocx(tableNode: any): Table {
  const rows: TableRow[] = [];
  const colwidths: number[] = [];

  contentToArray(tableNode.content).forEach((row: any, rowIdx: number) => {
    if (row.type.name !== "table_row") return;
    const cells: TableCell[] = [];

    contentToArray(row.content).forEach((cell: any) => {
      if (cell.type.name !== "table_cell" && cell.type.name !== "table_header") return;
      const colspan = Math.max(1, cell.attrs?.colspan || 1);
      const rowspan = Math.max(1, cell.attrs?.rowspan || 1);
      const colwidth = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth[0] : null;
      if (colwidth) colwidths.push(colwidth);

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
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
        },
      };
      if (rowIdx === 0 && cell.type.name === "table_header") {
        cellOpts.shading = { fill: "F5F5F5" };
      }
      cells.push(new TableCell(cellOpts));
    });

    rows.push(new TableRow({ children: cells }));
  });

  const totalWidth = colwidths.length > 0
    ? colwidths.reduce((a, b) => a + b, 0)
    : 9000;

  return new Table({
    rows,
    width: { size: totalWidth, type: WidthType.DXA },
  });
}

interface ParagraphExtras {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  indent?: { left?: number; right?: number };
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
  if (extras.italic) {
    runs.forEach((r: RunOrLinkOrImage) => {
      const o: any = (r as any).options;
      if (o && o.text != null) o.italics = true;
    });
  }

  const align = alignToDocx(node.attrs?.align) ?? extras.align;
  if (align) opts.alignment = align;

  const lh = lineHeightToTwips(node.attrs?.lineHeight);
  const spacing: any = { ...(opts.spacing || {}) };
  if (lh) {
    spacing.line = lh;
    spacing.lineRule = "auto";
  }
  if (node.type?.name === "paragraph" && !extras.style) {
    spacing.after = 200;
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

  return new TextRun(opts);
}

type RunOrLink = TextRun | ExternalHyperlink;
type RunOrLinkOrImage = RunOrLink | ImageRun;

function nodeContentToRuns(node: any, imageCache?: Map<string, Uint8Array>): RunOrLinkOrImage[] {
  if (!node.content) {
    const text = node.text || "";
    return text ? [new TextRun({ text })] : [];
  }

  return contentToArray(node.content).map((child: any) => {
    if (child.type.name === "image") {
      if (!imageCache) return new TextRun({ text: "" });
      const bytes = imageCache.get(child.attrs?.src || "");
      if (!bytes) return new TextRun({ text: "" });
      return buildImageRun(child, bytes);
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
