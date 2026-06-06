import mammoth from "mammoth";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";

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

export async function fromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  // mammoth in Node requires `buffer` (Node Buffer); in browser it accepts `arrayBuffer`
  const mammothInput: any = (globalThis as any).Buffer
    ? { buffer: (globalThis as any).Buffer.from(arrayBuffer) }
    : { arrayBuffer };
  const result = await mammoth.convertToHtml(mammothInput);
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

  return serializeContainer(container);
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
  const inlineLeaves = collectInlineLeaves(el);
  const limit = Math.min(wRuns.length, inlineLeaves.length);
  for (let i = 0; i < limit; i++) {
    applyRunProperties(wRuns[i], inlineLeaves[i]);
  }
}

function collectInlineLeaves(el: any): any[] {
  const leaves: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    const childNodes = Array.from(node.childNodes || []);
    let hasElementChild = false;
    for (const child of childNodes) {
      if ((child as any).nodeType === 1) {
        hasElementChild = true;
        walk(child);
      }
    }
    if (!hasElementChild && node !== el && (node.nodeType === 3 || isInlineTag(node))) {
      leaves.push(node);
    }
  };
  walk(el);
  return leaves;
}

function isInlineTag(node: any): boolean {
  const inlineTags = new Set(["SPAN", "STRONG", "EM", "A", "B", "I", "U", "S", "CODE"]);
  return inlineTags.has((node.tagName || "").toUpperCase());
}

function applyRunProperties(wR: any, leaf: any): void {
  const rPr = wR.getElementsByTagNameNS(W_NS, "rPr")?.[0];
  if (!rPr) return;

  const target = leaf.nodeType === 1 ? leaf : leaf.parentNode;
  if (!target || target.nodeType !== 1) return;

  const color = rPr.getElementsByTagNameNS(W_NS, "color")?.[0];
  if (color) {
    const v = attrValue(color, W_NS, "val");
    if (v && v !== "auto") setStyle(target, "color", "#" + v);
  }

  const sz = rPr.getElementsByTagNameNS(W_NS, "sz")?.[0];
  if (sz) {
    const v = attrValue(sz, W_NS, "val");
    if (v) {
      const px = Math.round((parseInt(v, 10) / 2) * 1.333);
      setStyle(target, "font-size", px + "px");
    }
  }

  const rFonts = rPr.getElementsByTagNameNS(W_NS, "rFonts")?.[0];
  if (rFonts) {
    const v = attrValue(rFonts, W_NS, "ascii") || attrValue(rFonts, W_NS, "cs");
    if (v) setStyle(target, "font-family", v);
  }

  const highlight = rPr.getElementsByTagNameNS(W_NS, "highlight")?.[0];
  if (highlight) {
    const v = attrValue(highlight, W_NS, "val");
    if (v && v !== "none") {
      const css = highlightToCss(v);
      if (css) setStyle(target, "background-color", css);
    }
  }

  const u = rPr.getElementsByTagNameNS(W_NS, "u")?.[0];
  if (u) {
    setStyle(target, "text-decoration", "underline");
  }

  const strike = rPr.getElementsByTagNameNS(W_NS, "strike")?.[0];
  if (strike) {
    setStyle(target, "text-decoration", "line-through");
  }
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

function nodeToParagraphs(node: any): Paragraph[] {
  switch (node.type.name) {
    case "paragraph":
      return [paragraphFromNode(node, { align: node.attrs?.align })];
    case "heading": {
      const p = paragraphFromNode(node, {
        heading: getHeadingLevel(node.attrs.level),
        align: node.attrs?.align,
      });
      return [p];
    }
    case "blockquote":
      return contentToArray(node.content).map((child: any) =>
        paragraphFromNode(child, { indent: { left: 720 }, italic: true }),
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
      return contentToArray(node.content).map((item: any) =>
        new Paragraph({
          children: nodeContentToRuns(item),
          numbering: { reference: "aw-bullet", level: 0 },
        }),
      );
    case "ordered_list":
      return contentToArray(node.content).map((item: any) =>
        new Paragraph({
          children: nodeContentToRuns(item),
          numbering: { reference: "aw-ordered", level: 0 },
        }),
      );
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
}

function paragraphFromNode(node: any, extras: ParagraphExtras = {}): Paragraph {
  const runs = nodeContentToRuns(node);
  const opts: any = { children: runs };

  if (extras.heading) opts.heading = extras.heading;
  if (extras.indent) opts.indent = extras.indent;
  if (extras.italic) {
    runs.forEach((r: TextRun) => {
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

function nodeContentToRuns(node: any): TextRun[] {
  if (!node.content) {
    const text = node.text || "";
    return text ? [new TextRun({ text })] : [];
  }

  return contentToArray(node.content).map((child: any) => {
    if (child.type.name !== "text") {
      return new TextRun({ text: getTextContent(child) });
    }
    return makeRun(child.text || "", child.marks || []);
  });
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
