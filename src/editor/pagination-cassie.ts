/**
 * Cassie-style deterministic pagination measurements.
 *
 * This module replaces DOM-based block height measurement with a
 * deterministic text-based estimate. The previous approach used
 * `scrollHeight`, which is asynchronous and often returned stale
 * values right after a ProseMirror transaction. That made the
 * pagination plugin decide badly: text would "slide" to page 2 and
 * could never come back because every subsequent rebalance saw the
 * same stale measurement.
 *
 * The approach here is borrowed from CassieEditor (see
 * https://github.com/Cassielxd/CassieEditor and its PAGE.md):
 * use Pretext to measure the height of each line of a block given
 * a font, a content width, and a line height. Pretext is a fast,
 * pure-JS text shaper that does not need the browser layout
 * pipeline, so the measurements are stable across transactions.
 *
 * Why this is sound:
 *
 * - The editor uses Lora at 11pt (=14.67px). With 1.5 line-height
 *   that is 22px per line, and ~7.3px per character average.
 * - Content width inside the A4 page is 794px - 2*96px = 602px
 *   (matches the CSS in src/styles.css).
 * - Content height per page is 1123 - 2*96 - 48 (header) - 24
 *   (footer) = 859px (matches the constant below).
 *
 * The functions in this module are pure: given a node, return
 * metrics. They have no side effects, no DOM access, and no state.
 * That makes them trivial to test in isolation.
 */

import { prepare, layout, prepareWithSegments, layoutWithLines, layoutNextLine } from "@chenglou/pretext";
import type { Node as PMNode } from "prosemirror-model";
import { normalizeBoxStyle } from "./box-style";

export const PAGE_WIDTH_PX = 794;
export const PAGE_HEIGHT_PX = 1123;
export const PAGE_HEADER_PX = 48;
export const PAGE_FOOTER_PX = 24;

export const DEFAULT_MARGIN_TOP = 96;
export const DEFAULT_MARGIN_BOTTOM = 96;
export const DEFAULT_MARGIN_LEFT = 96;
export const DEFAULT_MARGIN_RIGHT = 96;

export const MARGIN_MIN = 0;
export const MARGIN_MAX = 200;

export const PAGE_MARGIN_PX = 96;

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function getContentWidth(margins: PageMargins): number {
  return PAGE_WIDTH_PX - margins.left - margins.right;
}

export function getContentHeight(margins: PageMargins): number {
  return PAGE_HEIGHT_PX - margins.top - margins.bottom - PAGE_HEADER_PX - PAGE_FOOTER_PX;
}

export const CONTENT_WIDTH_PX = PAGE_WIDTH_PX - DEFAULT_MARGIN_LEFT - DEFAULT_MARGIN_RIGHT;
export const CONTENT_HEIGHT_PX =
  PAGE_HEIGHT_PX - DEFAULT_MARGIN_TOP - DEFAULT_MARGIN_BOTTOM - PAGE_HEADER_PX - PAGE_FOOTER_PX;

// ---- Live editor metrics (R-b) ---------------------------------------------
// Pagination must measure the CSS the editor ACTUALLY renders with:
//  - the container computed style (.ProseMirror: family, size, line-height);
//  - the DOCUMENT itself: every paragraph carries its own `lineHeight` attr
//    (toolbar "Line Height": 1.0/1.15/1.5/2.0) and inline `fontSize` marks;
//  - the cascade per node type (h1..h6, pre/code, caption strips), PROBED
//    once per sync from a hidden sample so no CSS value is ever duplicated
//    as a constant here.
// Before the first DOM sync (non-browser use) a static fallback matching the
// current styles.css applies.
export interface TextMetrics {
  font: string;
  sizePx: number;
  linePx: number;
}

interface BlockSpacing { beforePx: number; afterPx: number; }

interface EditorMetrics {
  familyStack: string;
  body: TextMetrics;
  caption: TextMetrics; // .image-caption / .aw-figure__caption base (12px)
  headings: TextMetrics[]; // index 0..5 = level 1..6
  code: TextMetrics;
  // vertical margins the renderer applies per top-level block type
  // (adjacent margins collapse, like the browser does)
  spacing: { paragraph: BlockSpacing; heading: BlockSpacing; image: BlockSpacing; figure: BlockSpacing; code: BlockSpacing; other: BlockSpacing };
}

function fallbackMetrics(): EditorMetrics {
  const size = 11 * 96 / 72; // 11pt at 96 DPI
  const body: TextMetrics = { font: `${size.toFixed(2)}px Lora, Georgia, serif`, sizePx: size, linePx: size * 1.5 };
  const headingSize = [2, 1.5, 1.17, 1, 0.83, 0.67].map((em) => size * em);
  const headingFactor = [1.2, 1.3, 1.4, 1.4, 1.4, 1.4];
  return {
    familyStack: "Lora, Georgia, serif",
    body,
    caption: { font: `${12}px Lora, Georgia, serif`, sizePx: 12, linePx: 12 * 1.5 },
    headings: headingSize.map((s, i) => ({
      font: `${s.toFixed(2)}px Inter, system-ui, sans-serif`,
      sizePx: s,
      linePx: s * headingFactor[i],
    })),
    code: { font: `${12}px JetBrains Mono, monospace`, sizePx: 12, linePx: 12 * 1.5 },
    spacing: {
      paragraph: { beforePx: 0, afterPx: size }, // ~1em del corpo
      heading: { beforePx: 0, afterPx: size / 2 },
      image: { beforePx: 8, afterPx: 8 },
      figure: { beforePx: 8, afterPx: 8 },
      code: { beforePx: 0, afterPx: 0 },
      other: { beforePx: 0, afterPx: 0 },
    },
  };
}

let metrics: EditorMetrics = fallbackMetrics();

function lineHeightPxOf(spec: string, sizePx: number): number {
  const v = parseFloat(spec);
  if (!isFinite(v) || v <= 0) return sizePx * 1.2;
  return v < 6 ? v * sizePx : v; // a bare number is a factor, otherwise px
}

function lineHeightFactor(raw: unknown, sizePx: number, fallbackFactor: number): number {
  const s = String(raw ?? "").trim();
  if (!s) return fallbackFactor;
  if (s.endsWith("px")) {
    const px = parseFloat(s);
    return isFinite(px) && px > 0 && sizePx > 0 ? px / sizePx : fallbackFactor;
  }
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : fallbackFactor;
}


/** Family portion of a base font string (e.g. 'Lora, Georgia, serif'). */
function baseFamilyOf(base: TextMetrics): string {
  const i = base.font.lastIndexOf("px ");
  return i >= 0 ? base.font.slice(i + 3) : metrics.familyStack;
}

/** Italic prefix of a base font string (caption bases are italic). */
function baseStylePrefixOf(base: TextMetrics): string {
  const m = /^(italic |oblique )/.exec(base.font);
  return m ? m[0] : "";
}

/**
 * v2b: the CSS font a text child actually renders with, from its marks
 * (fontSize, fontFamily, em, strong, code) layered on the block's base.
 */
function fontOfChild(child: PMNode, base: TextMetrics): { font: string; sizePx: number } {
  if (child.marks.length === 0) return { font: base.font, sizePx: base.sizePx };
  let sizePx = base.sizePx;
  let family = baseFamilyOf(base);
  let stylePrefix = baseStylePrefixOf(base);
  let weightPrefix = "";
  for (const m of child.marks) {
    switch (m.type.name) {
      case "fontSize": {
        const px = parseFloat(String(m.attrs.size));
        if (isFinite(px) && px > 0) sizePx = px;
        break;
      }
      case "fontFamily": {
        const fam = String(m.attrs.font || "").trim();
        if (fam) family = fam + ", " + baseFamilyOf(base);
        break;
      }
      case "em": stylePrefix = "italic "; weightPrefix = ""; break;
      case "strong": weightPrefix = "700 "; break;
      case "code": family = '"Courier New", Courier, monospace'; break;
      default: break;
    }
  }
  return { font: stylePrefix + weightPrefix + sizePx.toFixed(2) + "px " + family, sizePx };
}

const WORD_TOKENIZER = new Intl.Segmenter(undefined, { granularity: "word" });

const WORD_WIDTH_CACHE = new Map<string, number>();

/** Width of one word (or whitespace run) in a given font, via the shaper. */
function measureWord(word: string, font: string): number {
  const key = font + "\u0000" + word;
  const hit = WORD_WIDTH_CACHE.get(key);
  if (hit !== undefined) return hit;
  let w: number;
  try {
    const prepared = prepareWithSegments(word, font, WS_OPTIONS);
    const ln = layoutNextLine(prepared, { segmentIndex: 0, graphemeIndex: 0 }, 1e6);
    w = ln ? ln.width : word.length * 7;
  } catch {
    w = word.length * 7;
  }
  if (WORD_WIDTH_CACHE.size > 80000) WORD_WIDTH_CACHE.clear();
  WORD_WIDTH_CACHE.set(key, w);
  return w;
}

interface ParagraphStyle {
  mixed: boolean;
  /** Uniform style when !mixed; first-child style otherwise (fallback metrics). */
  style: TextMetrics;
}

/** v2b: does every text child render with the same font? */
function paragraphStyle(node: PMNode, base: TextMetrics): ParagraphStyle {
  const baseFactor = base.linePx / base.sizePx;
  let only: { font: string; sizePx: number } | null = null;
  let mixed = false;
  node.forEach((c) => {
    if (!c.isText || !(c.text || "").length) return;
    const f = fontOfChild(c, base);
    if (!only) only = f;
    else if (only.font !== f.font) mixed = true;
  });
  const first = only as { font: string; sizePx: number } | null;
  const sizePx = first ? first.sizePx : base.sizePx;
  const factor = lineHeightFactor((node.attrs as Record<string, unknown> | undefined)?.lineHeight, sizePx, baseFactor);
  const style: TextMetrics = {
    font: first ? first.font : base.font,
    sizePx,
    linePx: sizePx * factor,
  };
  return { mixed, style };
}

/** v2a-compatible single-style resolution (kept for call sites that need one). */
function textStyleFor(node: PMNode, base: TextMetrics): TextMetrics {
  return paragraphStyle(node, base).style;
}

/**
 * v2b greedy line breaker for MIXED-style paragraphs: each word measured in
 * its own font, line height = max of the inline boxes on the line (CSS line
 * box model), trailing whitespace hangs at line end (never counted toward
 * fit), widths come from the same shaper the browser-matching batch uses.
 * `widthAt(relY)` gives the available width at a line's RELATIVE height
 * (floats). Returns lines with absolute-from-0 y and their own height.
 */
function mixedParagraphLines(node: PMNode, widthAt: (relY: number) => number, base: TextMetrics): LaidLine[] {
  const lines: LaidLine[] = [];
  const factor = lineHeightFactor(
    (node.attrs as Record<string, unknown> | undefined)?.lineHeight,
    base.sizePx,
    base.linePx / base.sizePx,
  );
  let y = 0;
  let x = 0;
  // CSS line boxes include the block STRUT (base font line-height): every
  // line is at least base.linePx tall, whatever sits on it.
  let curH = base.linePx;
  let pendingSpace = 0;
  let lineStart = 0;
  let lineOpen = false;
  let charInRun = 0;
  let runPmStart = 0;
  let pm = 0;
  const flushLine = (nextStart: number) => {
    lines.push({ off: lineStart, y, h: curH });
    y += curH;
    x = 0;
    curH = base.linePx;
    pendingSpace = 0;
    lineStart = nextStart;
  };
  node.forEach((child) => {
    if (child.isText) {
      const { font, sizePx } = fontOfChild(child, base);
      const h = sizePx * factor;
      // Intl word granularity: break opportunities match the browser's
      // (hyphenated words split after the hyphen). Apostrophes GLUE: the
      // word splitter cuts "l'orlo" into "l'"+"orlo" but the browser never
      // breaks there - merge glue tokens back together.
      const parts: string[] = [];
      for (const s of WORD_TOKENIZER.segment(child.text || "")) parts.push(s.segment);
      const merged: string[] = [];
      for (const tok of parts) {
        const prev = merged[merged.length - 1];
        if (prev && !/\s/.test(prev) && /['\u2019\u02BC]$/u.test(prev) && /^[\p{L}]/u.test(tok)) {
          merged[merged.length - 1] = prev + tok;
        } else {
          merged.push(tok);
        }
      }
      for (const part of merged) {
        const w = measureWord(part, font);
        if (/^\s/.test(part)) {
          pendingSpace += w;
          charInRun += part.length;
          continue;
        }
        const avail = widthAt(y);
        if (lineOpen && x + pendingSpace + w > avail) {
          flushLine(runPmStart + charInRun);
        }
        if (!lineOpen) {
          lineStart = runPmStart + charInRun;
          lineOpen = true;
        } else {
          x += pendingSpace;
        }
        pendingSpace = 0;
        x += w;
        curH = Math.max(curH, h);
        charInRun += part.length;
      }
      pm += child.nodeSize;
      return;
    }
    // hard break: ends the line; the next run starts fresh after it
    if (lineOpen) flushLine(pm + 1);
    else {
      lines.push({ off: runPmStart + charInRun, y, h: curH });
      y += curH;
      curH = base.linePx;
    }
    pm += child.nodeSize;
    runPmStart = pm;
    charInRun = 0;
    lineOpen = false;
  });
  if (lineOpen) flushLine(runPmStart + charInRun);
  else lines.push({ off: lineStart, y, h: curH });
  return lines;
}

/** Height of a paragraph/heading measured exactly (uniform batch or mixed). */
function measureParagraph(node: PMNode, contentWidth: number, base: TextMetrics): BlockMetrics {
  const ps = paragraphStyle(node, base);
  if (!ps.mixed) {
    if (!hasHardBreak(node)) {
      // cheap batch height (line count only); exact line positions are
      // computed later, and only for paragraphs that cross a boundary
      return measureTextBlock(node, contentWidth, ps.style);
    }
    const offs = paragraphLineOffsets(node, contentWidth, ps.style);
    const n = Math.max(1, offs.length);
    return { heightPx: n * ps.style.linePx, lineCount: n };
  }
  const lines = mixedParagraphLines(node, () => contentWidth, base);
  const last = lines[lines.length - 1];
  return { heightPx: last.y + last.h, lineCount: lines.length };
}

export function getEditorMetrics(): EditorMetrics {
  return metrics;
}

/**
 * Refresh metrics by probing the real cascade. Attach a hidden sample to the
 * editor's own parent so descendant selectors (`.ProseMirror h1`,
 * `.aw-figure__caption`...) match exactly as in the live editor.
 */
export function syncEditorMetricsFromDom(el: Element | null | undefined): void {
  if (!el || typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const cs = window.getComputedStyle(el);
    const bodySizePx = parseFloat(cs.fontSize);
    if (!isFinite(bodySizePx) || bodySizePx <= 0) return;
    const bodyLinePx = cs.lineHeight && cs.lineHeight !== "normal"
      ? lineHeightPxOf(cs.lineHeight, bodySizePx)
      : bodySizePx * 1.5;
    const host = document.createElement("div");
    host.className = "ProseMirror";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;width:auto;padding:0;margin:0;";
    host.innerHTML =
      "<p>x</p>" +
      "<h1>x</h1><h2>x</h2><h3>x</h3><h4>x</h4><h5>x</h5><h6>x</h6>" +
      "<pre><code>x</code></pre>" +
      "<div class=\"image-caption\">x</div>" +
      "<div class=\"image-node-wrapper\"><img src=\"x\"></div>" +
      "<figure class=\"aw-figure\"><img src=\"x\"><figcaption class=\"aw-figure__caption\"><p>x</p></figcaption></figure>";
    const parent = el.parentElement ?? document.body;
    parent.appendChild(host);
    const read = (q: string, sizePx: number): TextMetrics => {
      const found = host.querySelector(q) as Element | null;
      if (!found) return { font: `${sizePx.toFixed(2)}px ${metrics.familyStack}`, sizePx, linePx: sizePx * 1.5 };
      const s = window.getComputedStyle(found);
      const sz = parseFloat(s.fontSize) || sizePx;
      const lh = s.lineHeight && s.lineHeight !== "normal" ? lineHeightPxOf(s.lineHeight, sz) : sz * 1.5;
      const style = s.fontStyle === "italic" || s.fontStyle === "oblique" ? `${s.fontStyle} ` : "";
      return { font: `${style}${sz.toFixed(2)}px ${s.fontFamily}`, sizePx: sz, linePx: lh };
    };
    const readSpacing = (q: string): BlockSpacing => {
      const found = host.querySelector(q) as Element | null;
      if (!found) return { beforePx: 0, afterPx: 0 };
      const s = window.getComputedStyle(found);
      const before = parseFloat(s.marginTop);
      const after = parseFloat(s.marginBottom);
      return {
        beforePx: isFinite(before) && before > 0 ? before : 0,
        afterPx: isFinite(after) && after > 0 ? after : 0,
      };
    };
    const next: EditorMetrics = {
      familyStack: cs.fontFamily || metrics.familyStack,
      body: { font: `${bodySizePx.toFixed(2)}px ${cs.fontFamily}`, sizePx: bodySizePx, linePx: bodyLinePx },
      caption: read(".image-caption", 12),
      headings: (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((tag, i) =>
        read(tag, metrics.headings[i]?.sizePx ?? bodySizePx),
      ),
      code: read("pre code", 12),
      spacing: {
        paragraph: readSpacing("p"),
        heading: readSpacing("h1"),
        image: readSpacing(".image-node-wrapper"),
        figure: readSpacing(".aw-figure"),
        code: readSpacing("pre"),
        other: { beforePx: 0, afterPx: 0 },
      },
    };
    parent.removeChild(host);
    metrics = next;
  } catch {
    // keep the last known metrics
  }
}

// Grapheme splitter used to resolve line-start cursors that fall inside a
// fragment (same segmentation the layout engine works with).
const LINE_START_GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// The editor renders paragraphs with `white-space: pre-wrap` (styles.css),
// so pagination MUST measure in the same mode: spaces preserved, no
// collapsing, fragment lengths identical to the source. The default "normal"
// mode collapses runs and desyncs line starts from document positions.
const WS_OPTIONS = { whiteSpace: "pre-wrap" } as const;

export interface BlockMetrics {
  heightPx: number;
  lineCount: number;
}

export interface LineInfo {
  heightPx: number;
  lines: string[];
  fullText: string;
}

/**
 * Measure a single block node's height in CSS pixels using Pretext.
 *
 * R-b: styles come from the LIVE cascade (probed node types), the block's
 * own attrs (`lineHeight`) and its inline `fontSize` marks (dominant size —
 * exact per-run measurement lands with v2b). Composite elements
 * (styled_box, figure, image) are measured structurally from their attrs.
 * Tables and lists keep deliberate simplifications. What matters is that
 * the decision is consistent, follows the document, and does not depend on
 * the browser having laid out the page already.
 */
export function measureBlock(node: PMNode | null | undefined, margins?: PageMargins): BlockMetrics {
  if (!node) {
    return { heightPx: metrics.body.linePx, lineCount: 1 };
  }
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  if (node.type.name === "styled_box") {
    return measureBoxNode(node, contentWidth);
  }
  if (node.type.name === "figure") {
    return measureFigureNode(node, contentWidth);
  }
  if (node.type.name === "image") {
    return measureImageNode(node, contentWidth);
  }
  // R-b/v2b: paragraphs and headings are measured through the line model
  // (hard breaks split runs, mixed styles measure word by word).
  if (node.type.name === "paragraph" || node.type.name === "heading") {
    return measureParagraph(node, contentWidth, baseMetricsFor(node));
  }
  return measureTextBlock(node, contentWidth);
}

/** The cascade metrics a node type starts from (before its own attrs/marks). */
function baseMetricsFor(node: PMNode): TextMetrics {
  if (node.type.name === "code_block") return metrics.code;
  if (node.type.name === "heading") {
    const level = Number(node.attrs.level);
    return metrics.headings[Number.isFinite(level) ? Math.min(6, Math.max(1, level)) - 1 : 0];
  }
  return metrics.body;
}

/** Measure a text string at an explicit width with an explicit style. */
function measureTextHeight(
  text: string,
  contentWidth: number,
  font: string,
  lineHeight: number,
): BlockMetrics {
  if (!text.trim()) {
    return { heightPx: lineHeight, lineCount: 1 };
  }
  try {
    const prepared = prepare(text, font, WS_OPTIONS);
    const result = layout(prepared, contentWidth, lineHeight);
    const lineCount = Math.max(1, result.lineCount ?? Math.ceil(result.height / lineHeight));
    return { heightPx: result.height, lineCount };
  } catch {
    const charPerLine = 70;
    const lineCount = Math.max(1, Math.ceil(text.length / charPerLine));
    return { heightPx: lineCount * lineHeight, lineCount };
  }
}

/**
 * Measure a text block at an explicit content width. R-b: the style is
 * resolved from the block itself — node type cascade base (body/heading/
 * code), its `lineHeight` attr, its dominant inline size — unless an
 * explicit style is passed (caption strips measure at 12px italic).
 */
function measureTextBlock(
  node: PMNode,
  contentWidth: number,
  explicit?: TextMetrics,
): BlockMetrics {
  const style = explicit ?? textStyleFor(node, baseMetricsFor(node));
  return measureTextHeight(node.textContent || "", contentWidth, style.font, style.linePx);
}

/**
 * Caption vertical paddings (attrs shared by `image` and `figure`, clamped
 * exactly like the NodeViews do: 0..60 px).
 */
function captionPaddings(node: PMNode): { top: number; bottom: number } {
  const rawTop = Number(node.attrs.captionPadTop);
  const rawBottom = Number(node.attrs.captionPadBottom);
  const top = isFinite(rawTop) ? Math.max(0, Math.min(60, rawTop)) : 0;
  const bottom = isFinite(rawBottom) ? Math.max(0, Math.min(60, rawBottom)) : 0;
  return { top, bottom };
}

const BOX_PADDING_X_PX = 32; // 16px left + 16px right
const BOX_PADDING_Y_PX = 28; // 14px top + 14px bottom

/**
 * styled_box: inner lines at the box's inner width + vertical paddings and
 * borders (contract "Interazione con la paginazione Cassie").
 */
function measureBoxNode(node: PMNode, contentWidth: number): BlockMetrics {
  const style = normalizeBoxStyle(node.attrs as Record<string, unknown>);
  const outerWidth = style.widthPx ?? contentWidth;
  const borders = style.borderWidth > 0 && style.borderStyle !== "none" ? style.borderWidth * 2 : 0;
  const innerWidth = Math.max(120, outerWidth - BOX_PADDING_X_PX - borders);
  let height = BOX_PADDING_Y_PX + borders;
  let lines = 0;
  node.forEach((child) => {
    const m = child.type.name === "paragraph"
      ? measureParagraph(child, innerWidth, metrics.body)
      : measureTextBlock(child, innerWidth);
    height += m.heightPx;
    lines += m.lineCount;
  });
  if (lines === 0) {
    height += metrics.body.linePx;
    lines = 1;
  }
  return { heightPx: height, lineCount: lines };
}

const FALLBACK_IMAGE_HEIGHT_PX = 220;

/**
 * image (F1.1): the block's vertical footprint is the photo height from the
 * stored attrs (set at insertion and on resize; the NodeView also self-heals
 * missing sizes by persisting the natural ones) plus the legacy caption strip
 * when `caption` carries text. Rotation is a CSS transform: the layout box —
 * the space subsequent blocks actually see — is always the unrotated one, so
 * rotation does NOT change the measured height.
 */
function measureImageNode(node: PMNode, contentWidth: number): BlockMetrics {
  const w = Number(node.attrs.width);
  const h = Number(node.attrs.height);
  const imageWidth = isFinite(w) && w > 0 ? w : contentWidth;
  const imageHeight = isFinite(h) && h > 0 ? h : FALLBACK_IMAGE_HEIGHT_PX;

  let height = imageHeight;
  const caption = String(node.attrs.caption || "");
  if (caption.trim()) {
    const pad = captionPaddings(node);
    const captionWidth = Math.max(120, Math.min(imageWidth, contentWidth));
    const strip = measureTextHeight(caption, captionWidth, metrics.caption.font, metrics.caption.linePx);
    height += pad.top + pad.bottom + strip.heightPx;
  }
  return { heightPx: height, lineCount: Math.ceil(height / metrics.body.linePx) };
}

/**
 * figure (Phase 1 G3, refactor 2026-08-29; caption metrics fixed in F1.1):
 * the photo is carried as node attrs and the caption is real text content.
 * Height = photo height (from the stored attrs; documented fallback when
 * missing) + gap + caption block (12px italic lines + vertical paddings).
 * While the aspect is locked the rendered photo keeps its ratio, so the
 * stored height attr is the authoritative value.
 */
function measureFigureNode(node: PMNode, contentWidth: number): BlockMetrics {
  const rawGap = Number(node.attrs.captionGap);
  const gap = isFinite(rawGap) ? Math.max(0, Math.min(120, rawGap)) : 0;

  const w = Number(node.attrs.width);
  const h = Number(node.attrs.height);
  const imageWidth = isFinite(w) && w > 0 ? w : contentWidth;
  const imageHeight = isFinite(h) && h > 0 ? h : FALLBACK_IMAGE_HEIGHT_PX;

  // Caption spans the figure width (= the photo width, capped to the column).
  const captionWidth = Math.max(120, Math.min(imageWidth, contentWidth));
  let captionHeight = 0;
  let captionLines = 0;
  node.forEach((child) => {
    const m = child.type.name === "paragraph"
      ? measureParagraph(child, captionWidth, metrics.caption)
      : measureTextBlock(child, captionWidth, textStyleFor(child, metrics.caption));
    captionHeight += m.heightPx;
    captionLines += m.lineCount;
  });
  if (captionLines === 0) {
    captionHeight += textStyleFor(node, metrics.caption).linePx;
    captionLines = 1;
  }
  const pad = captionPaddings(node);
  captionHeight += pad.top + pad.bottom;

  const height = imageHeight + gap + captionHeight;
  return { heightPx: height, lineCount: Math.ceil(height / metrics.body.linePx) };
}

/**
 * Get per-line information for a block. Used by mid-paragraph features.
 * R-b: line height and font follow the block's own style resolution.
 */
export function getBlockLines(node: PMNode | null | undefined, margins?: PageMargins): LineInfo {
  const style = node ? textStyleFor(node, baseMetricsFor(node)) : metrics.body;
  if (!node) {
    return { heightPx: style.linePx, lines: [], fullText: "" };
  }
  const text = node.textContent || "";
  if (!text.trim()) {
    return { heightPx: style.linePx, lines: [], fullText: text };
  }
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  try {
    const prepared = prepareWithSegments(text, style.font, WS_OPTIONS);
    const result = layoutWithLines(prepared, contentWidth, style.linePx);
    const lines = (result.lines ?? []).map((l: { text: string }) => l.text);
    return { heightPx: result.height, lines, fullText: text };
  } catch {
    return { heightPx: style.linePx, lines: [], fullText: text };
  }
}

export interface PageBreakAt {
  pos: number;
  pageNumber: number;
  /** True when the break falls INSIDE a paragraph (mid-paragraph split). */
  midParagraph?: boolean;
}

export interface PaginationCalculation {
  breaks: PageBreakAt[];
  totalPages: number;
}

/**
 * F1.2 / R-b: mid-paragraph splitting.
 *
 * Top-level `paragraph` nodes whose inline content is text and/or HARD
 * BREAKS are splittable. Position mapping is exact: offsets are relative to
 * the paragraph's content start (blockStart + 1 + offset); a hard break
 * consumes one position and starts a fresh visual line, so each run between
 * breaks is laid out independently from the left edge. Anything else keeps
 * the all-or-nothing placement (still counted for the pages it occupies).
 *
 * Line starts come from the fragment cursor mapping (see
 * `lineStartOffsets`): exact, no string guessing, no silent give-up.
 */
const MIN_LINES_PER_PAGE_FRAGMENT = 2; // widow/orphan guard (Word-style minimum)


function hasHardBreak(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (!child.isText && child.type.name === "hard_break") found = true;
  });
  return found;
}

function isSplittableParagraph(node: PMNode): boolean {
  if (node.type.name !== "paragraph") return false;
  let ok = node.textContent.trim().length > 0;
  node.forEach((child) => {
    if (!child.isText && child.type.name !== "hard_break") ok = false;
  });
  return ok;
}

/**
 * EXACT line-start offsets for a run of text, derived from the prepared
 * fragments themselves (layoutWithLines): fragment k of the source begins
 * at sum(lengths of fragments 0..k-1), so a line starts exactly where its
 * FIRST fragment starts. Whitespace swallowed at a break cannot desync the
 * mapping — there is no string guessing and no silent give-up path.
 * Returns null only when the text cannot be measured at all.
 */
export function lineStartOffsets(
  text: string,
  contentWidth: number,
  style: TextMetrics = metrics.body,
): number[] | null {
  try {
    const prepared = prepareWithSegments(text, style.font, WS_OPTIONS);
    const result = layoutWithLines(prepared, contentWidth, style.linePx);
    const lines = result.lines;
    if (!lines || lines.length < 2) return null;
    const segments: string[] | undefined = (prepared as unknown as { segments?: string[] }).segments;
    if (!segments) return null;
    const segStart: number[] = new Array(segments.length + 1);
    segStart[0] = 0;
    for (let i = 0; i < segments.length; i++) {
      segStart[i + 1] = segStart[i] + (segments[i]?.length ?? 0);
    }
    const offsets: number[] = [];
    for (const line of lines as { start: { segmentIndex: number; graphemeIndex: number } }[]) {
      const si = line.start.segmentIndex;
      let off = segStart[Math.min(si, segments.length)] ?? text.length;
      // A line may start INSIDE a fragment (the previous line broke in the
      // middle of a long word): advance by graphemes to be exact.
      const gi = line.start.graphemeIndex;
      if (gi > 0 && segments[si]) {
        let g = 0;
        for (const gr of LINE_START_GRAPHEMES.segment(segments[si])) {
          if (g++ >= gi) break;
          off += gr.segment.length;
        }
      }
      while (off < text.length && /\s/.test(text[off])) off++; // never cut inside whitespace
      // If a mid-word snap were ever needed (overflow-wrap cases), it must
      // land on a WORD START: snap back to the word boundary, then forward
      // to its first visible character. Trailing whitespace HANGS at line
      // end in the renderer (Chromium lets it overflow without breaking),
      // so a cut sitting on spaces would misattribute the break: always
      // advance past spaces. Never snap back onto an end-of-line space run.
      if (off > 0 && off < text.length && !/\s/.test(text[off - 1])) {
        let b = off;
        while (b > 0 && !/\s/.test(text[b - 1])) b--;
        off = b;
        while (off < text.length && /\s/.test(text[off])) off++;
      }
      // Keep line starts strictly increasing (two snapped lines sharing a
      // word start collapse into one).
      if (offsets.length && off <= offsets[offsets.length - 1]) continue;
      if (!offsets.length && off <= 0) {
        offsets.push(0); // line 0 anchor
        continue;
      }
      offsets.push(off);
    }
    return offsets;
  } catch {
    return null;
  }
}

/**
 * Line starts (PM offsets relative to the paragraph content start) across
 * hard-break-separated runs. Each run wraps independently from the left
 * edge; an empty run still renders one line.
 */
function paragraphLineOffsets(node: PMNode, contentWidth: number, style: TextMetrics): number[] {
  const out: number[] = [];
  let runText = "";
  let runPmStart = 0;
  let pm = 0;
  const emitRun = () => {
    const starts = runText ? lineStartOffsets(runText, contentWidth, style) : null;
    if (starts) {
      for (const s of starts) out.push(runPmStart + s);
    } else {
      out.push(runPmStart); // empty or single-line run = one line
    }
    runText = "";
  };
  node.forEach((child) => {
    if (child.isText) {
      runText += child.text || "";
      pm += child.nodeSize;
    } else {
      emitRun();
      pm += child.nodeSize; // hard_break: size 1, contributes no text
      runPmStart = pm;
    }
  });
  emitRun();
  const clean: number[] = [];
  for (const o of out) {
    if (!clean.length || o > clean[clean.length - 1]) clean.push(o);
  }
  return clean;
}

// ---------------------------------------------------------------------------
// F1.3: float-aware page accounting.
//
// A wrapped image/figure (attrs.wrap + align left/right) renders as a CSS
// float: it does NOT advance the flow; text lines that overlap its vertical
// span are shorter by its width. The calculator models exactly that: floats
// keep absolute spans [y0,y1) on a shared global-y axis and every text line
// is measured at the width available at ITS height. Without floats the
// arithmetic reduces to the previous floor(space/line) model by
// construction, so no-float behaviour is unchanged.
// ---------------------------------------------------------------------------

const FLOAT_MARGIN_PX = 12; // .image-node-wrapper / .aw-figure float margins (styles.css)
const MIN_LINE_WIDTH_PX = 120;

interface FloatBox { side: "left" | "right"; widthPx: number; y0: number; y1: number; }

function spacingFor(node: PMNode): BlockSpacing {
  const sp = metrics.spacing;
  switch (node.type.name) {
    case "paragraph": return sp.paragraph;
    case "heading": return sp.heading;
    case "image": return sp.image;
    case "figure": return sp.figure;
    case "code_block": return sp.code;
    default: return sp.other;
  }
}

function floatSpecOf(node: PMNode): { side: "left" | "right"; widthPx: number } | null {
  if (node.attrs.wrap !== true) return null;
  if (node.type.name !== "image" && node.type.name !== "figure") return null;
  const align = String(node.attrs.align ?? "");
  if (align !== "left" && align !== "right") return null;
  const w = Number(node.attrs.width);
  if (!isFinite(w) || w <= 0) return null;
  return { side: align, widthPx: Math.round(w) + FLOAT_MARGIN_PX };
}

/** Normalise a raw line-start to a word start (never inside whitespace). */
function normalizeCut(text: string, raw: number): number {
  let off = raw;
  while (off < text.length && /\s/.test(text[off])) off++;
  if (off > 0 && off < text.length && !/\s/.test(text[off - 1])) {
    let b = off;
    while (b > 0 && !/\s/.test(text[b - 1])) b--;
    off = b;
    while (off < text.length && /\s/.test(text[off])) off++;
  }
  return off;
}

function cursorOffsetOf(
  text: string,
  segments: string[],
  segStart: number[],
  segmentIndex: number,
  graphemeIndex: number,
): number {
  let off = segStart[Math.min(segmentIndex, segments.length)] ?? text.length;
  if (graphemeIndex > 0 && segments[segmentIndex]) {
    let g = 0;
    for (const gr of LINE_START_GRAPHEMES.segment(segments[segmentIndex])) {
      if (g++ >= graphemeIndex) break;
      off += gr.segment.length;
    }
  }
  return off;
}

interface LaidLine { off: number; y: number; h: number; }

/**
 * Lay out one text run line by line (layoutNextLine: width may change per
 * line), tracking absolute y through float-affected widths.
 */
function walkRunLines(
  text: string,
  style: TextMetrics,
  startY: number,
  widthAt: (y: number) => number,
): LaidLine[] {
  const out: LaidLine[] = [];
  try {
    const prepared = prepareWithSegments(text, style.font, WS_OPTIONS);
    const segments = (prepared as unknown as { segments?: string[] }).segments;
    if (!segments || !text.trim()) return [{ off: 0, y: startY, h: style.linePx }];
    const segStart = new Array(segments.length + 1);
    segStart[0] = 0;
    for (let i = 0; i < segments.length; i++) {
      segStart[i + 1] = segStart[i] + (segments[i]?.length ?? 0);
    }
    let cursor = { segmentIndex: 0, graphemeIndex: 0 };
    let y = startY;
    for (let i = 0; i < 20000; i++) {
      const ln = layoutNextLine(prepared, cursor, widthAt(y));
      if (!ln) break;
      out.push({
        off: normalizeCut(text, cursorOffsetOf(text, segments, segStart, ln.start.segmentIndex, ln.start.graphemeIndex)),
        y,
        h: style.linePx,
      });
      cursor = ln.end;
      y += style.linePx;
    }
  } catch {
    // whatever was collected stands
  }
  if (!out.length) out.push({ off: 0, y: startY, h: style.linePx });
  return out;
}

/**
 * All visual lines of a splittable paragraph (runs split at hard breaks),
 * laid out with float-aware widths from absolute startY. Offsets are
 * relative to the paragraph content start.
 */
function walkParagraphLines(
  node: PMNode,
  style: TextMetrics,
  startY: number,
  widthAt: (y: number) => number,
): LaidLine[] {
  const all: LaidLine[] = [];
  let runText = "";
  let runPmStart = 0;
  let pm = 0;
  let y = startY;
  const emitRun = () => {
    if (!runText.trim()) {
      all.push({ off: runPmStart, y, h: style.linePx });
      y += style.linePx;
      runText = "";
      return;
    }
    const lines = walkRunLines(runText, style, y, widthAt);
    for (const l of lines) all.push({ off: runPmStart + l.off, y: l.y, h: l.h });
    y = lines[lines.length - 1].y + style.linePx;
    runText = "";
  };
  node.forEach((child) => {
    if (child.isText) {
      runText += child.text || "";
      pm += child.nodeSize;
    } else {
      emitRun();
      pm += child.nodeSize;
      runPmStart = pm;
    }
  });
  emitRun();
  const clean: LaidLine[] = [];
  for (const l of all) {
    if (clean.length && l.off <= clean[clean.length - 1].off) continue;
    clean.push(l);
  }
  return clean;
}

/**
 * Walk the top-level children of the document on a global-y axis and
 * decide where to insert page breaks (F1.2 splits, F1.3 floats, R-b
 * styles). See the block comment above for the model.
 */
export function calculatePageBreaks(doc: PMNode, margins?: PageMargins): PaginationCalculation {
  const contentHeight = margins ? getContentHeight(margins) : CONTENT_HEIGHT_PX;
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  const breaks: PageBreakAt[] = [];
  const floats: FloatBox[] = [];
  const sideBottom = { left: 0, right: 0 };
  let y = 0; // absolute flow height (bottom of last placed box, no trailing gap)
  let pendingAfter = 0; // margin-bottom of the previous in-flow block (collapses)

  const widthAt = (yq: number): number => {
    let used = 0;
    for (const f of floats) {
      if (yq >= f.y0 && yq < f.y1) used += f.widthPx;
    }
    return Math.max(MIN_LINE_WIDTH_PX, contentWidth - used);
  };
  const pageOf = (yq: number): number => Math.floor(yq / contentHeight) + 1;
  const pageRemainder = (yq: number): number => contentHeight - (yq % contentHeight);
  const pushBreak = (atPos: number, yTop: number, mid: boolean): void => {
    breaks.push(mid
      ? { pos: atPos, pageNumber: pageOf(yTop), midParagraph: true }
      : { pos: atPos, pageNumber: pageOf(yTop) });
  };

  let pos = 0;
  doc.forEach((node) => {
    if (node.isInline) {
      pos += node.nodeSize;
      return;
    }
    // F1.3: a wrapped image/figure floats - it does not consume the flow.
    const fl = floatSpecOf(node);
    if (fl) {
      const h = measureBlock(node, margins).heightPx;
      if (h > 0) {
        const sp = spacingFor(node);
        // collapsed gap like any in-flow block; the float box itself then
        // spans its margin box for line-avoidance purposes
        const y0 = Math.max(y + Math.max(pendingAfter, sp.beforePx), sideBottom[fl.side]);
        const y1 = y0 + h + sp.afterPx;
        floats.push({ side: fl.side, widthPx: fl.widthPx, y0, y1 });
        sideBottom[fl.side] = y1;
      }
      pos += node.nodeSize;
      return;
    }
    const { heightPx } = measureBlock(node, margins);
    if (heightPx <= 0) {
      pos += node.nodeSize;
      return;
    }
    const sp = spacingFor(node);
    if (isSplittableParagraph(node)) {
      const ps = paragraphStyle(node, baseMetricsFor(node));
      const style = ps.style;
      let startY = y + Math.max(pendingAfter, sp.beforePx);

      const overlapsFloat = (fromY: number, toY: number): boolean => {
        for (const f of floats) {
          if (fromY < f.y1 && toY > f.y0) return true;
        }
        return false;
      };
      // FAST PATH: no float overlap and the paragraph fits the current page
      // whole -> the batch height from measureBlock is exact; skip the walk.
      const boundaryEnd = pageOf(startY) * contentHeight;
      if (!overlapsFloat(startY, startY + heightPx) && startY + heightPx <= boundaryEnd) {
        y = startY + heightPx;
        pendingAfter = sp.afterPx;
        pos += node.nodeSize;
        return;
      }

      // Line model (v2b):
      //  - uniform + no float  -> batch driver (layoutWithLines, F1.2-proven)
      //  - uniform + floats    -> per-line walk (layoutNextLine, width/height)
      //  - mixed styles        -> greedy breaker (word widths in each word's
      //                           own font, line height = max inline box,
      //                           trailing spaces hanging, floats aware)
      const computeLines = (sy: number): LaidLine[] => {
        if (ps.mixed) {
          const rel = mixedParagraphLines(node, (relY) => widthAt(sy + relY), baseMetricsFor(node));
          return rel.map((l) => ({ ...l, y: sy + l.y }));
        }
        if (!overlapsFloat(sy, sy + heightPx)) {
          const offs = paragraphLineOffsets(node, contentWidth, style);
          return offs.map((off, i) => ({ off, y: sy + i * style.linePx, h: style.linePx }));
        }
        return walkParagraphLines(node, style, sy, widthAt);
      };

      let lines = computeLines(startY);
      // If not even the widow-guard minimum fits left on the page, move the
      // paragraph down first (matches the old whole-block semantics).
      if (pageRemainder(startY) < lines[0].h * MIN_LINES_PER_PAGE_FRAGMENT) {
        const moved = pageOf(startY) * contentHeight;
        pushBreak(pos, moved, false);
        y = moved;
        pendingAfter = 0; // the previous block's margin stays on the old page
        startY = y + sp.beforePx;
        lines = computeLines(startY);
      }
      const n = lines.length;
      let from = 0;
      let boundary = (Math.floor(lines[0].y / contentHeight) + 1) * contentHeight;
      for (;;) {
        if (from >= n - 1) break;
        let idx = -1;
        for (let i = from + 1; i < n; i++) {
          if (lines[i].y + lines[i].h > boundary) { idx = i; break; }
        }
        if (idx === -1) break; // the remainder fits before the boundary
        // orphan guard: never leave fewer than MIN lines on the NEXT page;
        // cutting EARLIER underfills the current page (Word behaviour) -
        // cutting later would overflow it, which is the worse failure.
        if (n - idx < MIN_LINES_PER_PAGE_FRAGMENT) {
          const maxCut = n - MIN_LINES_PER_PAGE_FRAGMENT;
          if (maxCut <= from) break;
          idx = maxCut;
        }
        pushBreak(pos + 1 + lines[idx].off, lines[idx].y, true);
        from = idx;
        // The cut line straddles the boundary: the NEXT boundary is the end
        // of the page containing that line's BOTTOM (deriving it from the
        // TOP was the empty-pages bug).
        boundary = (Math.floor((lines[idx].y + lines[idx].h) / contentHeight) + 1) * contentHeight;
      }
      y = lines[n - 1].y + lines[n - 1].h;
      pos += node.nodeSize;
      return;
    }
    // Unbreakable block: owns the pages it needs; pagination resumes below
    // (portion beyond the first page overflows visually - documented).
    let blockTop = y + Math.max(pendingAfter, sp.beforePx);
    if (heightPx > pageRemainder(blockTop) && blockTop % contentHeight !== 0) {
      const moved = pageOf(blockTop) * contentHeight;
      pushBreak(pos, moved, false);
      y = moved;
      blockTop = y + sp.beforePx;
      pendingAfter = 0;
    }
    y = blockTop + heightPx;
    pendingAfter = sp.afterPx;
    pos += node.nodeSize;
  });

  const totalPages = y <= 0 ? 1 : Math.max(1, Math.ceil((y - 0.0001) / contentHeight));
  return { breaks, totalPages };
}
