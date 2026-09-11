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
 * measurements. They have no side effects, no DOM access, and no state.
 * That makes them trivial to test in isolation.
 */

import { prepare, layout, prepareWithSegments, layoutWithLines, layoutNextLine } from "@chenglou/pretext";
import type { Node as PMNode } from "prosemirror-model";
import { normalizeBoxStyle } from "./box-style";
import {
  isAnchorBlock, isFreeNode, parseFreeSpec, zLevelOf, freeWrapBand, freeElementWidth,
  type FreeWrapBand,
} from "./free-layout";
import { isOverlap, isUnwrapped, isWrapping, textConditionOf } from "./element-condition";
import { elementDecorationExtent } from "./element-decoration";
// The rule "how wide is a text line at this height" lives in its own module:
// the three text conditions (Wrapped / Unwrapped / Overlap) are three answers
// to that one question, and they must be written once for screen, paper and
// page count alike.
import {
  ObstacleSet,
  OBSTACLE_MARGIN_PX,
  type Obstacle,
  type ObstacleSide,
  type SolidStrip,
} from "./text-obstacles";
// Text metrics (fonts, line heights, block spacing) live in their own module:
// this file answers "where do the pages break", that one answers "how tall is a
// line and how wide is a word". The generation counter is what invalidates the
// per-block cache when a probe finds different styles.
import {
  baseMetricsFor,
  fontOfChild,
  getEditorMetrics,
  getMetricsGeneration,
  lineHeightFactor,
  paragraphStyle,
  textStyleFor,
  type BlockSpacing,
  type EditorMetrics,
  type TextMetrics,
} from "./text-metrics";

// The probed metrics, read through the module so every call sees the latest
// probe without this file having to hold a second copy of the state.
function metrics(): EditorMetrics {
  return getEditorMetrics();
}

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
 * own attrs (`lineHeight`) and its inline `fontSize` marks (dominant size â€”
 * exact per-run measurement lands with v2b). Composite elements
 * (styled_box, figure, image) are measured structurally from their attrs.
 * Tables and lists keep deliberate simplifications. What matters is that
 * the decision is consistent, follows the document, and does not depend on
 * the browser having laid out the page already.
 */
export function measureBlock(node: PMNode | null | undefined, margins?: PageMargins): BlockMetrics {
  if (!node) {
    return { heightPx: metrics().body.linePx, lineCount: 1 };
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

/**
 * Line-start offsets of a text block, for the callers that need to know WHICH
 * CHARACTER a line begins at without measuring the live page.
 *
 * The screen's wrap band cannot ask the browser which line a picture sits on:
 * once a float is published the paragraph reports merged rectangles instead of
 * lines, and reading them back feeds the previous pass into the next
 * measurement. The font metrics here are the same ones the `R-b` probe keeps in
 * step with the DOM (`syncEditorMetricsFromDom`), so the line the screen picks
 * is the line the paper picks.
 */
export function blockLineStartOffsets(
  node: PMNode,
  contentWidth: number,
): number[] | null {
  if (node.type.name !== "paragraph" && node.type.name !== "heading") return null;
  return paragraphLineOffsets(node, contentWidth, baseMetricsFor(node));
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
 * resolved from the block itself â€” node type cascade base (body/heading/
 * code), its `lineHeight` attr, its dominant inline size â€” unless an
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
      ? measureParagraph(child, innerWidth, metrics().body)
      : measureTextBlock(child, innerWidth);
    height += m.heightPx;
    lines += m.lineCount;
  });
  if (lines === 0) {
    height += metrics().body.linePx;
    lines = 1;
  }
  return { heightPx: height, lineCount: lines };
}

const FALLBACK_IMAGE_HEIGHT_PX = 220;

/**
 * image (F1.1): the block's vertical footprint is the photo height from the
 * stored attrs (set at insertion and on resize; the NodeView also self-heals
 * missing sizes by persisting the natural ones) plus the legacy caption strip
 * when `caption` carries text. Rotation is a CSS transform: the layout box â€”
 * the space subsequent blocks actually see â€” is always the unrotated one, so
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
    const strip = measureTextHeight(caption, captionWidth, metrics().caption.font, metrics().caption.linePx);
    height += pad.top + pad.bottom + strip.heightPx;
  }
  return { heightPx: height, lineCount: Math.ceil(height / metrics().body.linePx) };
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
      ? measureParagraph(child, captionWidth, metrics().caption)
      : measureTextBlock(child, captionWidth, textStyleFor(child, metrics().caption));
    captionHeight += m.heightPx;
    captionLines += m.lineCount;
  });
  if (captionLines === 0) {
    captionHeight += textStyleFor(node, metrics().caption).linePx;
    captionLines = 1;
  }
  const pad = captionPaddings(node);
  captionHeight += pad.top + pad.bottom;

  const height = imageHeight + gap + captionHeight;
  return { heightPx: height, lineCount: Math.ceil(height / metrics().body.linePx) };
}

/**
 * Get per-line information for a block. Used by mid-paragraph features.
 * R-b: line height and font follow the block's own style resolution.
 */
export function getBlockLines(node: PMNode | null | undefined, margins?: PageMargins): LineInfo {
  const style = node ? textStyleFor(node, baseMetricsFor(node)) : metrics().body;
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

/**
 * Where a free element is DRAWN, in the same flow-y axis the calculator uses
 * internally (contract §6: one source for screen, print and the bench).
 * `page` is the page holding the element's middle, not the page of the block
 * it hangs from: a picture dropped into the white space below the last line of
 * page 2 belongs to page 3, because that is where it covers and is covered.
 */
export interface FreeGeometry {
  pos: number;
  page: number;
  /** Flow y of the element's top edge. */
  top: number;
  /** Flow y of the block the element is anchored to. */
  anchorTop: number;
  /** Measured height of the element itself (0 when it cannot be measured). */
  heightPx: number;
  level: number;
  /**
   * F3.2b: the band it claims from the text, or null when it wraps nothing
   * (wrap off, no measured size, or it covers the column). `top` above and
   * `topPx` here are different numbers: `topPx` is measured from the anchor and
   * is the one a screen spacer and a print spacer both position themselves by.
   */
  band: FreeBandInput | null;
}

export interface PaginationCalculation {
  breaks: PageBreakAt[];
  totalPages: number;
  freeGeometry: FreeGeometry[];
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
 * mapping â€” there is no string guessing and no silent give-up path.
 * Returns null only when the text cannot be measured at all.
 */
export function lineStartOffsets(
  text: string,
  contentWidth: number,
  style: TextMetrics = metrics().body,
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

function spacingFor(node: PMNode): BlockSpacing {
  const sp = metrics().spacing;
  switch (node.type.name) {
    case "paragraph": return sp.paragraph;
    case "heading": {
      const level = Number(node.attrs.level);
      const per = sp.headings && Number.isFinite(level)
        ? sp.headings[Math.min(6, Math.max(1, level)) - 1]
        : undefined;
      return per ?? sp.heading;
    }
    case "image": return sp.image;
    case "figure": return sp.figure;
    case "code_block": return sp.code;
    default: return sp.other;
  }
}

function floatSpecOf(node: PMNode): { side: "left" | "right"; widthPx: number } | null {
  if (!isWrapping(textConditionOf(node))) return null;
  if (node.type.name !== "image" && node.type.name !== "figure") return null;
  const align = String(node.attrs.align ?? "");
  if (align !== "left" && align !== "right") return null;
  // ONE definition of the element's own width, shared with the free bands.
  const w = freeElementWidth(node);
  if (w === null) return null;
  // Frame and shadow reach beyond the photo: the text must keep clear of them
  // too (T1.4).
  const extent = elementDecorationExtent(node.attrs as Record<string, unknown>, node.type.name);
  return { side: align, widthPx: w + OBSTACLE_MARGIN_PX + Math.round(extent.x) };
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

// ---------------------------------------------------------------------------
// F1.4: incremental measurement cache.
//
// ProseMirror nodes are persistent: an edit rebuilds only the touched block
// (and its ancestors), every other top-level block keeps its object identity.
// So a block's OWN layout (height, uniform line starts, mixed-style lines at
// full width) can be cached per node and reused as long as the probed styles
// and the content width are unchanged â€” page arithmetic then re-runs over
// cheap cached numbers on every keystroke, while text shaping runs ONLY on
// blocks that actually changed. Float-overlapping lines are NOT cached:
// their widths depend on absolute float bands, so those blocks keep being
// measured fresh (translation-invariance would not hold).
// ---------------------------------------------------------------------------

interface CachedLayout {
  /** metrics generation + content width the entry was computed with */
  g: number;
  w: number;
  splittable: boolean;
  heightPx: number;
  /** resolved style for splittable paragraphs (uniform; first-child fallback) */
  style: TextMetrics;
  mixed: boolean;
  /** uniform line starts relative to content start (full width); lazy */
  relOffsets: number[] | null;
  /** mixed-style relative lines (full width); null until computed */
  relMixed: LaidLine[] | null;
}

const LAYOUT_CACHE = new WeakMap<PMNode, CachedLayout>();

function computeLayout(node: PMNode, margins: PageMargins | undefined, contentWidth: number): CachedLayout {
  const base = baseMetricsFor(node);
  const e: CachedLayout = {
    g: getMetricsGeneration(), w: contentWidth, splittable: false,
    heightPx: 0, style: base, mixed: false, relOffsets: null, relMixed: null,
  };
  if (!isSplittableParagraph(node)) {
    e.heightPx = measureBlock(node, margins).heightPx;
    return e;
  }
  e.splittable = true;
  const ps = paragraphStyle(node, base);
  e.style = ps.style;
  e.mixed = ps.mixed;
  if (ps.mixed) {
    const lines = mixedParagraphLines(node, () => contentWidth, base);
    e.relMixed = lines;
    const last = lines[lines.length - 1];
    e.heightPx = last.y + last.h;
  } else if (hasHardBreak(node)) {
    e.relOffsets = paragraphLineOffsets(node, contentWidth, ps.style);
    e.heightPx = Math.max(1, e.relOffsets.length) * ps.style.linePx;
  } else {
    e.heightPx = measureTextBlock(node, contentWidth, ps.style).heightPx;
  }
  return e;
}

function cachedMeasure(node: PMNode, margins: PageMargins | undefined, contentWidth: number): CachedLayout {
  const hit = LAYOUT_CACHE.get(node);
  if (hit && hit.g === getMetricsGeneration() && hit.w === contentWidth) return hit;
  const made = computeLayout(node, margins, contentWidth);
  LAYOUT_CACHE.set(node, made);
  return made;
}

function ensureRelOffsets(e: CachedLayout, node: PMNode, contentWidth: number): number[] {
  if (!e.relOffsets) e.relOffsets = paragraphLineOffsets(node, contentWidth, e.style);
  return e.relOffsets;
}


/**
 * Walk the top-level children of the document on a global-y axis and
 * decide where to insert page breaks (F1.2 splits, F1.3 floats, R-b
 * styles, F1.4 incremental cache). See the block comment above for the model.
 *
 * MEMOISED (F3.2b): more than one plugin needs the same calculation on the same
 * keystroke - the page dividers, the free-element wrap bands, the layers window
 * and, on demand, the print sheets. The result is shared read-only, and the key
 * is everything the walk depends on: the document object identity (the F1.4
 * cache already invalidates per node), the metrics generation the DOM probe
 * bumps on a style change, and the four margin numbers.
 */
let calcMemo: {
  doc: PMNode;
  gen: number;
  width: number;
  height: number;
  marginKey: string;
  result: PaginationCalculation;
} | null = null;

export function calculatePageBreaks(doc: PMNode, margins?: PageMargins): PaginationCalculation {
  const contentHeight = margins ? getContentHeight(margins) : CONTENT_HEIGHT_PX;
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  const marginKey = margins
    ? `${margins.top}/${margins.right}/${margins.bottom}/${margins.left}`
    : "default";
  const memo = calcMemo;
  if (
    memo &&
    memo.doc === doc &&
    memo.gen === getMetricsGeneration() &&
    memo.width === contentWidth &&
    memo.height === contentHeight &&
    memo.marginKey === marginKey
  ) {
    return memo.result;
  }
  const first = computePageBreaks(doc, margins, []);
  const finish = (run: CalcRun): PaginationCalculation => {
    const { bands: _bands, ...publicResult } = run;
    calcMemo = { doc, gen: getMetricsGeneration(), width: contentWidth, height: contentHeight, marginKey, result: publicResult };
    return publicResult;
  };
  if (first.bands.length === 0) return finish(first); // no wrapping free element: one walk

  // The rectangles depend on where the anchors ended up, and the anchors ended
  // up where the text broke around those rectangles. The first pass answered
  // "where is the text without any band"; feed its rectangles back in and the
  // second pass answers the real question. A third pass confirms: if the
  // rectangles stop moving, the answer is stable, and the last run is the one
  // whose page breaks and bands agree with each other.
  let bands = first.bands;
  let run = first;
  for (let pass = 0; pass < 3; pass++) {
    run = computePageBreaks(doc, margins, bands);
    if (sameBands(run.bands, bands)) return finish(run);
    bands = run.bands;
  }
  return finish(run);
}

/** Did any band move, between one pass and the next? */
function sameBands(a: FreeBandInput[], b: FreeBandInput[]): boolean {
  if (a.length !== b.length) return false;
  const byPos = new Map(a.map((x) => [x.pos, x]));
  for (const x of b) {
    const y = byPos.get(x.pos);
    if (!y) return false;
    if (y.side !== x.side || y.widthPx !== x.widthPx || y.full !== x.full) return false;
    if (Math.abs(y.y0 - x.y0) > 0.5 || Math.abs(y.y1 - x.y1) > 0.5) return false;
  }
  return true;
}

/**
 * F3.2c: one free element's band, positioned on the flow axis by the PREVIOUS
 * pass, plus where its spacer must go.
 *
 * `spacerPos` is the top-level block whose lines the band starts shortening -
 * the first block its rectangle crosses, which is NOT necessarily the element's
 * anchor (contract §13 rev. 2026-09-07: the anchor gives coordinates, nothing
 * else). `spacerTop` is where the invisible float begins, and the screen and
 * the print sheets position themselves by it.
 */
export interface FreeBandInput extends FreeWrapBand {
  pos: number;
  /**
   * Document position INSIDE the text, at the start of the first line the band
   * touches, and the flow y of that line. Print puts its float there - never in
   * front of the block with a `margin-top`, because a float narrows the lines
   * from its margin box and that leaves a column of narrowed text above the
   * picture (the defect of the rejected F3.2c delivery, on paper as on screen).
   */
  insertPos: number | null;
  lineTop: number;
  /**
   * True for an Unwrapped free element: the band claims the WHOLE width, so no
   * line lives beside it (the text resumes under it). It is booked as a solid
   * strip, not as a sided obstacle.
   */
  full: boolean;
}

/** A pass of the walk: the public result plus the bands the NEXT pass should use. */
interface CalcRun extends PaginationCalculation {
  bands: FreeBandInput[];
}

function computePageBreaks(doc: PMNode, margins: PageMargins | undefined, bands: FreeBandInput[]): CalcRun {
  const contentHeight = margins ? getContentHeight(margins) : CONTENT_HEIGHT_PX;
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  const breaks: PageBreakAt[] = [];
  const freeGeometry: FreeGeometry[] = [];
  // Every claim on the column, in one set: floats already in the flow and the
  // bands the free elements claim. The width of a line at a height, the
  // unwritable strips and the queueing of a new float all come from here.
  const obstacles: Obstacle[] = [];
  // The bands claimed by the free elements, kept as their own list: they are
  // the only claims that may pair up into an unwritable strip (see
  // `ObstacleSet`). The wrapped images of the flow shorten lines but never
  // make a height unwritable, which is how the page count has always worked.
  const bandObstacles: Obstacle[] = [];
  // Unwrapped free elements: strips where no line fits at all, stated directly.
  const fullStrips: SolidStrip[] = [];
  let obstacleSet = new ObstacleSet(contentWidth, obstacles, bandObstacles, fullStrips);
  const sideBottom: Record<ObstacleSide, number> = { left: 0, right: 0 };
  let y = 0; // absolute flow height (bottom of last placed box, no trailing gap)
  let pendingAfter = 0; // margin-bottom of the previous in-flow block (collapses)
  // Top of the last ANCHOR block (free-layout.ts), settled one step late, at
  // the start of the next block, so a block moved to the following page reports
  // the position it really ended up with. It is only used to say WHERE the free
  // element is drawn - the wrap itself ignores it (contract §13 rev. 2026-09-07).
  let lastBlockHeight = 0;
  let lastBlockWasAnchor = false;
  let anchorTopY = 0;
  let hasAnchor = false;

  const widthAt = (yq: number): number => obstacleSet.widthAt(yq);
  const pageOf = (yq: number): number => Math.floor(yq / contentHeight) + 1;
  const pageRemainder = (yq: number): number => contentHeight - (yq % contentHeight);
  const pushBreak = (atPos: number, yTop: number, mid: boolean): void => {
    // UNIFIED LABEL SEMANTICS (F1.4 fix): pageNumber is ALWAYS the page that
    // STARTS after this divider. Mid-paragraph cuts used to carry the page
    // they left, which could equal the number already used by a block-level
    // divider earlier in the list (out-of-order labels, merged-page audits).
    const bp: PageBreakAt = mid
      ? { pos: atPos, pageNumber: pageOf(yTop) + 1, midParagraph: true }
      : { pos: atPos, pageNumber: pageOf(yTop) };
    // dedup: the same boundary must not be emitted twice (e.g. a gap
    // divider and a whole-block move computed for one and the same cut).
    // Two DIFFERENT boundaries may share a block-start position (an empty
    // page between them is legitimate) and are both kept.
    const prev = breaks[breaks.length - 1];
    if (prev && prev.pos === bp.pos && prev.pageNumber === bp.pageNumber && !!prev.midParagraph === !!bp.midParagraph) return;
    breaks.push(bp);
  };

  // F3.2c: bands arrive ALREADY POSITIONED on the flow axis. They are the
  // drawn rectangles of the free elements, and they are positioned by the
  // caller's previous pass (see the memo loop in `calculatePageBreaks`): the
  // rectangle of an element depends on where its anchor paragraph ended up,
  // and that depends on how the text broke, which depends on the rectangles.
  // Two passes settle it, and a third only confirms.
  const outBands: FreeBandInput[] = [];
  const bandByPos = new Map<number, FreeBandInput>();
  for (const b of bands) bandByPos.set(b.pos, b);
  // The bands arrive ALREADY POSITIONED on the flow axis: they are the drawn
  // rectangles of the free elements, and the width they claim, the unwritable
  // strips and the vertical queueing all come from `ObstacleSet`.
  for (const b of bands) {
    if (b.full) {
      // Unwrapped: no line beside it, the text resumes under it.
      fullStrips.push({ y0: b.y0, y1: b.y1 });
    } else {
      const box: Obstacle = { side: b.side, widthPx: b.widthPx, y0: b.y0, y1: b.y1 };
      bandObstacles.push(box);
      obstacles.push(box);
    }
  }
  obstacleSet = new ObstacleSet(contentWidth, obstacles, bandObstacles, fullStrips);

  /** Bottom of the same-side bands overlapping [y, y+h): a float queues below. */
  const bandQueue = (side: ObstacleSide, y: number, h: number): number => {
    let bottom = 0;
    for (const b of bands) {
      if (b.side === side && b.y0 < y + h && b.y1 > y) bottom = Math.max(bottom, b.y1);
    }
    return bottom;
  };

  /**
   * Does any obstacle overlap the height range [from, to)?
   *
   * Every obstacle, bands of the free elements included: that is what the page
   * walk has always asked here, and narrowing it to the flow floats alone
   * changed which lane the walk took - and silently dropped a page divider
   * (caught by the bench's I5 invariant, not by reading the code).
   */
  const overlapsFloat = (from: number, to: number): boolean => obstacleSet.overlaps(from, to);
  const pushPastSolid = (y: number, lineH: number): number => obstacleSet.pushPastSolid(y, lineH);
  const crossesSolid = (from: number, to: number): boolean => obstacleSet.crossesSolid(from, to);
  // Bands still needing a spacer, and the blocks they will shorten.
  const pendingSpacers = new Map<number, FreeBandInput>();
  for (const b of bands) pendingSpacers.set(b.pos, b);
  /**
   * File a band where it belongs: the first line of the first block it touches.
   * The line comes from the same cached layout the page cuts use, so the float
   * on paper sits at exactly the line the calculator shortened.
   */
  const placeSpacers = (node: PMNode, e: CachedLayout, topOfBlock: number, bottomOfBlock: number, atPos: number): void => {
    for (const b of pendingSpacers.values()) {
      if (b.y1 <= topOfBlock || b.y0 >= bottomOfBlock) continue;
      const spot = bandLineSpot(node, e, b.y0, topOfBlock, atPos);
      b.insertPos = spot.pos;
      b.lineTop = spot.lineTop;
      pendingSpacers.delete(b.pos);
    }
  };

  /** Where the band's first line is, inside this block. */
  const bandLineSpot = (
    node: PMNode, e: CachedLayout, bandTop: number, topOfBlock: number, atPos: number,
  ): { pos: number; lineTop: number } => {
    const fallback = { pos: atPos + 1, lineTop: topOfBlock };
    if (!e.splittable) return fallback;
    if (e.mixed) {
      const rel = e.relMixed ?? mixedParagraphLines(node, () => widthAt(topOfBlock), baseMetricsFor(node));
      let hit = rel[0];
      for (const l of rel) {
        if (topOfBlock + l.y + l.h <= bandTop) hit = l;
        else break;
      }
      return hit ? { pos: atPos + 1 + hit.off, lineTop: topOfBlock + hit.y } : fallback;
    }
    const offs = ensureRelOffsets(e, node, contentWidth);
    const lh = e.style.linePx;
    if (lh <= 0 || offs.length === 0) return fallback;
    const idx = Math.max(0, Math.min(offs.length - 1, Math.floor((bandTop - topOfBlock) / lh)));
    return { pos: atPos + 1 + offs[idx], lineTop: topOfBlock + idx * lh };
  };

  let pos = 0;
  doc.forEach((node) => {
    if (node.isInline) {
      pos += node.nodeSize;
      return;
    }
    // The previous block is over: if it was text, its top is now final.
    if (lastBlockWasAnchor) {
      anchorTopY = y - lastBlockHeight;
      hasAnchor = true;
      lastBlockWasAnchor = false;
    }
    // F3: a free element consumes NO flow (contract §6): it never moves a page
    // boundary by itself. With wrap on it shortens the lines its DRAWN rectangle
    // crosses - the band it was given for this pass - and that is all.
    if (isFreeNode(node)) {
      const spec = parseFreeSpec(node.attrs?.free);
      if (spec) {
        const h = cachedMeasure(node, margins, contentWidth).heightPx;
        const w = freeElementWidth(node) ?? 0;
        const anchorTop = hasAnchor ? anchorTopY : 0;
        const top = anchorTop + spec.yOff;
        const given = bandByPos.get(pos) ?? null;
        freeGeometry.push({
          pos,
          page: pageOf(top + (h > 0 ? h / 2 : 0)),
          top,
          anchorTop,
          heightPx: h,
          level: zLevelOf(node),
          band: given,
        });
        // The band the NEXT pass will use: same rectangle, but the anchor top
        // is now the one this pass settled on.
        const cond = textConditionOf(node);
        const extent = elementDecorationExtent(node.attrs as Record<string, unknown>, node.type.name);
        let next: FreeWrapBand | null = null;
        let full = false;
        if (isWrapping(cond)) {
          next = freeWrapBand({
            column: { left: 0, width: contentWidth },
            spec,
            elementWidthPx: w,
            elementHeightPx: h,
            drawnTop: top,
            wrapOn: true,
            extraClaimPx: extent.x,
            extraHeightPx: extent.y,
          });
        } else if (isUnwrapped(cond) && h > 0) {
          // Unwrapped claims the WHOLE width over its drawn rectangle: the text
          // above stays, the text below resumes under the element.
          next = { side: "left", widthPx: contentWidth, y0: top, y1: top + h + extent.y };
          full = true;
        }
        if (next) outBands.push({ ...next, pos, insertPos: null, lineTop: next.y0, full });
      }
      pos += node.nodeSize;
      return;
    }
    // F1.3: a wrapped image/figure floats - it does not consume the flow.
    const fl = floatSpecOf(node);
    if (fl) {
      const h = cachedMeasure(node, margins, contentWidth).heightPx;
      if (h > 0) {
        const sp = spacingFor(node);
        // collapsed gap like any in-flow block; the float box itself then
        // spans its margin box for line-avoidance purposes
        const natural = y + Math.max(pendingAfter, sp.beforePx);
        const y0 = Math.max(natural, sideBottom[fl.side], bandQueue(fl.side, natural, h));
        const y1 = y0 + h + sp.afterPx;
        obstacles.push({ side: fl.side, widthPx: fl.widthPx, y0, y1 });
        obstacleSet = new ObstacleSet(contentWidth, obstacles, bandObstacles, fullStrips);
        sideBottom[fl.side] = y1;
      }
      pos += node.nodeSize;
      return;
    }
    // T1.2: Overlap takes the element out of the page flow. The text flows as
    // if it were not there; on screen the element is painted absolutely at the
    // place it already had (free-style.applyOverlapLayout).
    if (isOverlap(textConditionOf(node))) {
      pos += node.nodeSize;
      return;
    }
    // F1.5: manual page break (`pageBreakBefore`, imported from markdown
    // `---` or set by document conventions): force the block to the TOP of the
    // next page. The calculator used to ignore it, so the divider lived
    // only in DOCX/HTML export and the live pages disagreed with print.
    if (node.attrs?.pageBreakBefore === true && y > 0) {
      const rem = y % contentHeight;
      if (rem > 0.01 && rem < contentHeight - 0.01) {
        const forced = (Math.floor(y / contentHeight) + 1) * contentHeight;
        pushBreak(pos, forced, false);
        y = forced;
        pendingAfter = 0;
      }
    }
    // F1.4: per-block layout comes from the cache; only untouched nodes
    // (object identity) are trusted, so any edit re-measures exactly its
    // own block and everything downstream reuses cached numbers.
    const e = cachedMeasure(node, margins, contentWidth);
    const heightPx = e.heightPx;
    if (heightPx <= 0) {
      pos += node.nodeSize;
      return;
    }
    // F3.2c: this block is the first one some band crosses? Then the band's
    // spacer goes here, both on screen and on paper. Recorded for every block,
    // splittable or not, before any of the layout lanes decides where to go.
    {
      const bsp = spacingFor(node);
      const btop = y + Math.max(pendingAfter, bsp.beforePx);
      placeSpacers(node, e, btop, btop + heightPx, pos);
    }
    // A text block that consumes the flow is somebody's anchor: the number that
    // matters is its top, settled at the start of the NEXT block.
    lastBlockHeight = heightPx;
    lastBlockWasAnchor = isAnchorBlock(node);
    const sp = spacingFor(node);
    // F1.4 boundary-gap fix: the flow can cross a page boundary INSIDE the
    // collapsed margin between two blocks (previous content ends just before
    // the cut line, the gap pushes the next block just past it). No block
    // spans the boundary, so historically no divider was emitted and the
    // pages silently merged (defect present since the first version).
    // Any boundary crossed inside the gap gets a divider at this block.
    const gapFromY = y;
    const gapBreaksUpTo = (topY: number): void => {
      for (let k = Math.max(1, Math.floor(gapFromY / contentHeight - 1e-6) + 1); k * contentHeight <= topY + 1e-6; k++) {
        pushBreak(pos, k * contentHeight, false);
      }
    };
    if (e.splittable) {
      const style = e.style;
      let startY = y + Math.max(pendingAfter, sp.beforePx);
      gapBreaksUpTo(startY);

      // Lines that would land inside a solid strip are moved below it, in order,
      // and the paragraph grows by exactly the space the browser keeps empty.
      const pushPastSolidLines = (laid: LaidLine[], fromY: number): LaidLine[] => {
        if (obstacleSet.solid.length === 0) return laid;
        let bottom = fromY;
        return laid.map((l) => {
          const y = pushPastSolid(Math.max(l.y, bottom), l.h);
          bottom = y + l.h;
          return { ...l, y };
        });
      };
      // FAST PATH: no float overlap and the paragraph fits the current page
      // whole -> the batch height from measureBlock is exact; skip the walk.
      const boundaryEnd = pageOf(startY) * contentHeight;
      if (
        !overlapsFloat(startY, startY + heightPx) &&
        !crossesSolid(startY, startY + heightPx) &&
        startY + heightPx <= boundaryEnd
      ) {
        y = startY + heightPx;
        pendingAfter = sp.afterPx;
        pos += node.nodeSize;
        return;
      }

      // F1.4 ARITHMETIC LANE: uniform paragraph, no float interference ->
      // cached line offsets + closed-form page-crossing maths. Zero line
      // objects allocated per keystroke; cost is O(pages the paragraph
      // spans), not O(its lines).
      if (!e.mixed && !overlapsFloat(startY, startY + heightPx) && !crossesSolid(startY, startY + heightPx)) {
        const offs = ensureRelOffsets(e, node, contentWidth);
        const lh = style.linePx;
        const n = offs.length;
        let y0 = startY;
        if (contentHeight - (y0 % contentHeight) < lh * MIN_LINES_PER_PAGE_FRAGMENT) {
          const moved = pageOf(y0) * contentHeight;
          pushBreak(pos, moved, false);
          y = moved;
          pendingAfter = 0; // the previous block's margin stays on the old page
          y0 = y + sp.beforePx;
        }
        let from = 0;
        let boundary = (Math.floor(y0 / contentHeight) + 1) * contentHeight;
        for (;;) {
          if (from >= n - 1) break;
          const idx0 = Math.max(from + 1, Math.floor((boundary - y0) / lh));
          if (idx0 >= n || y0 + idx0 * lh + lh <= boundary) break; // the remainder fits
          let idx = idx0;
          if (n - idx < MIN_LINES_PER_PAGE_FRAGMENT) {
            const maxCut = n - MIN_LINES_PER_PAGE_FRAGMENT;
            // maxCut <= from cannot make a boundary silent: a paragraph that
            // small near the boundary is moved whole down by the initial
            // guard above (or the fast path fit it). Keep the historical
            // break here.
            if (maxCut <= from) break;
            idx = maxCut;
          }
          pushBreak(pos + 1 + offs[idx], y0 + idx * lh, true);
          from = idx;
          // cut line straddles the boundary: next boundary from its BOTTOM
          boundary = (Math.floor((y0 + idx * lh + lh) / contentHeight) + 1) * contentHeight;
        }
        y = y0 + n * lh;
        pos += node.nodeSize;
        return;
      }

      // Line model (v2b) over the F1.4 cache â€” remaining lanes:
      //  - mixed   + no float  -> cached relative mixed lines (v2b breaker at
      //                           full width, translation-invariant)
      //  - floats overlapping  -> fresh per-line walk (widthAt not cacheable)
      const computeLines = (sy: number): LaidLine[] => {
        if (e.mixed) {
          if (e.relMixed && !overlapsFloat(sy, sy + heightPx)) {
            return e.relMixed.map((l) => ({ off: l.off, y: sy + l.y, h: l.h }));
          }
          const rel = mixedParagraphLines(node, (relY) => widthAt(sy + relY), baseMetricsFor(node));
          return rel.map((l) => ({ ...l, y: sy + l.y }));
        }
        return walkParagraphLines(node, style, sy, widthAt);
      };

      let lines = pushPastSolidLines(computeLines(startY), startY);
      // If not even the widow-guard minimum fits left on the page, move the
      // paragraph down first (matches the old whole-block semantics).
      if (pageRemainder(startY) < lines[0].h * MIN_LINES_PER_PAGE_FRAGMENT) {
        const moved = pageOf(startY) * contentHeight;
        pushBreak(pos, moved, false);
        y = moved;
        pendingAfter = 0; // the previous block's margin stays on the old page
        startY = y + sp.beforePx;
        lines = pushPastSolidLines(computeLines(startY), startY);
      }
      let n = lines.length;
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
          // (same reasoning as the arithmetic lane: never silent here)
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
    gapBreaksUpTo(blockTop);
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
  return { breaks, totalPages, freeGeometry, bands: outBands };
}
