import mammoth from "mammoth";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, ExternalHyperlink } from "docx";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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

function stripHash(color: string): string {
  return color.replace(/^#/, "");
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
    }
  }

  postProcessBlocks(container, wParagraphs, htmlBlocks);

  return serializeContainer(container);
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
  return node.getAttribute?.("w:" + name) || null;
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

export function toDocx(doc: any): Document {
  const children: Paragraph[] = [];

  contentToArray(doc.content).forEach((node: any) => {
    children.push(...nodeToParagraphs(node));
  });

  return new Document({
    sections: [
      {
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
    paragraphs.push(
      new Paragraph({
        children: nodeContentToRuns(firstPara),
        numbering: { reference: numberingRef, level: 0 },
      }),
    );
  }
  return paragraphs;
}

function nodeToParagraphs(node: any): Paragraph[] {
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
      return contentToArray(node.content).flatMap((child: any) => nodeToParagraphs(child));
    default:
      if (node.isBlock) {
        return [new Paragraph({ children: [new TextRun({ text: getTextContent(node) })] })];
      }
      return [];
  }
}

interface ParagraphExtras {
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  indent?: { left?: number; right?: number };
  italic?: boolean;
  style?: string;
}

function paragraphFromNode(node: any, extras: ParagraphExtras = {}): Paragraph {
  const runs = nodeContentToRuns(node);
  const opts: any = { children: runs };

  if (extras.heading) opts.heading = extras.heading;
  if (extras.style) opts.style = extras.style;
  if (extras.indent) opts.indent = extras.indent;
  if (extras.italic) {
    runs.forEach((r: RunOrLink) => {
      const o: any = (r as any).options;
      if (o) o.italics = true;
    });
  }

  const align = alignToDocx(node.attrs?.align) ?? extras.align;
  if (align) opts.alignment = align;

  const lh = lineHeightToTwips(node.attrs?.lineHeight);
  if (lh) opts.spacing = { ...(opts.spacing || {}), line: lh, lineRule: "auto" };

  if (node.attrs?.pageBreakBefore) {
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
          opts.color = stripHash(mark.attrs.color);
        }
        break;
      case "highlight":
        if (mark.attrs?.color) {
          const name = hexToHighlightName(mark.attrs.color);
          if (name) {
            opts.highlight = name;
          } else {
            opts.shading = { fill: stripHash(mark.attrs.color) };
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

function nodeContentToRuns(node: any): RunOrLink[] {
  if (!node.content) {
    const text = node.text || "";
    return text ? [new TextRun({ text })] : [];
  }

  return contentToArray(node.content).map((child: any) => {
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
