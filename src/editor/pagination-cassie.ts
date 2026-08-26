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

import { prepare, layout, prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
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

// Font and metrics for the editor body text. The editor uses Lora
// at 11pt (=14.67px at 96 DPI) with a 1.5 line-height, giving 22px
// per line. These constants are exported so tests and other modules
// can refer to the same values.
export const EDITOR_FONT = "11pt Lora, Georgia, serif";
export const EDITOR_LINE_HEIGHT_PX = 22;
const EMPTY_BLOCK_HEIGHT_PX = EDITOR_LINE_HEIGHT_PX;

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
 * The text content of the node is the only input that matters for
 * height. Inline marks, images, tables, and lists are NOT accounted
 * for: this is a deliberate simplification. The pagination plugin
 * uses this measurement to decide where to break pages, and the
 * inaccuracy is acceptable for visual pagination. The exact pixel
 * position will always be off by a bit; what matters is that the
 * decision is consistent and does not depend on the browser having
 * laid out the page already.
 */
export function measureBlock(node: PMNode | null | undefined, margins?: PageMargins): BlockMetrics {
  if (!node) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lineCount: 1 };
  }
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  // Phase 1 (G3): composite elements are measured structurally (box padding
  // + inner lines; figure = image height + gap + caption lines).
  if (node.type.name === "styled_box") {
    return measureBoxNode(node, contentWidth);
  }
  if (node.type.name === "figure") {
    return measureFigureNode(node, contentWidth);
  }
  return measureTextBlock(node, contentWidth);
}

/** Measure a text block at an explicit content width. */
function measureTextBlock(node: PMNode, contentWidth: number): BlockMetrics {
  const text = node.textContent || "";
  if (!text.trim()) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lineCount: 1 };
  }
  try {
    const prepared = prepare(text, EDITOR_FONT);
    const result = layout(prepared, contentWidth, EDITOR_LINE_HEIGHT_PX);
    const lineCount = Math.max(1, result.lineCount ?? Math.ceil(result.height / EDITOR_LINE_HEIGHT_PX));
    return { heightPx: result.height, lineCount };
  } catch {
    const charPerLine = 70;
    const lineCount = Math.max(1, Math.ceil(text.length / charPerLine));
    return { heightPx: lineCount * EDITOR_LINE_HEIGHT_PX, lineCount };
  }
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
    const m = measureTextBlock(child, innerWidth);
    height += m.heightPx;
    lines += m.lineCount;
  });
  if (lines === 0) {
    height += EMPTY_BLOCK_HEIGHT_PX;
    lines = 1;
  }
  return { heightPx: height, lineCount: lines };
}

const FIGURE_FALLBACK_IMAGE_HEIGHT_PX = 220;

/**
 * figure: image height (from stored attrs; documented fallback when missing)
 * + gap + caption box lines. Side layouts take the taller of the two.
 */
function measureFigureNode(node: PMNode, contentWidth: number): BlockMetrics {
  const layoutName = String(node.attrs.captionLayout ?? "below");
  const rawGap = Number(node.attrs.captionGap);
  const gap = isFinite(rawGap) ? Math.max(0, Math.min(120, rawGap)) : 12;

  let imageHeight = FIGURE_FALLBACK_IMAGE_HEIGHT_PX;
  let imageWidth = contentWidth;
  let captionBox: PMNode | null = null;
  node.forEach((child) => {
    if (child.type.name === "image") {
      const w = Number(child.attrs.width);
      const h = Number(child.attrs.height);
      if (isFinite(w) && w > 0) imageWidth = w;
      if (isFinite(h) && h > 0) imageHeight = h;
    } else if (child.type.name === "styled_box") {
      captionBox = child;
    }
  });

  if (layoutName === "left" || layoutName === "right") {
    const captionWidth = Math.max(120, contentWidth - imageWidth - gap);
    const captionHeight = captionBox ? measureBoxNode(captionBox, captionWidth).heightPx : 0;
    const height = Math.max(imageHeight, captionHeight);
    return { heightPx: height, lineCount: Math.ceil(height / EDITOR_LINE_HEIGHT_PX) };
  }

  const captionWidth = contentWidth;
  const captionHeight = captionBox ? measureBoxNode(captionBox, captionWidth).heightPx : 0;
  const height = imageHeight + gap + captionHeight;
  return { heightPx: height, lineCount: Math.ceil(height / EDITOR_LINE_HEIGHT_PX) };
}

/**
 * Get per-line information for a block. Used by the optional
 * mid-paragraph split (future work). Each line is a substring of
 * the original text plus the line break that follows it.
 */
export function getBlockLines(node: PMNode | null | undefined, margins?: PageMargins): LineInfo {
  if (!node) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lines: [], fullText: "" };
  }
  const text = node.textContent || "";
  if (!text.trim()) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lines: [], fullText: text };
  }
  const contentWidth = margins ? getContentWidth(margins) : CONTENT_WIDTH_PX;
  try {
    const prepared = prepareWithSegments(text, EDITOR_FONT);
    const result = layoutWithLines(prepared, contentWidth, EDITOR_LINE_HEIGHT_PX);
    const lines = (result.lines ?? []).map((l: { text: string }) => l.text);
    return { heightPx: result.height, lines, fullText: text };
  } catch {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lines: [], fullText: text };
  }
}

export interface PageBreakAt {
  pos: number;
  pageNumber: number;
}

export interface PaginationCalculation {
  breaks: PageBreakAt[];
  totalPages: number;
}

/**
 * Walk the top-level children of `doc` and decide where to insert
 * page breaks. A break is inserted before a block if adding it to
 * the current page would exceed CONTENT_HEIGHT_PX.
 *
 * This is the "simple" version: it only breaks between blocks, not
 * mid-paragraph. A single paragraph taller than one page will be
 * placed entirely on the next page, and the previous page will
 * have empty space at the bottom. The mid-paragraph split is a
 * separate, optional step.
 */
export function calculatePageBreaks(doc: PMNode, margins?: PageMargins): PaginationCalculation {
  const contentHeight = margins ? getContentHeight(margins) : CONTENT_HEIGHT_PX;
  const breaks: PageBreakAt[] = [];
  let currentPageHeight = 0;
  let pageNumber = 1;

  let pos = 0;
  doc.forEach((node) => {
    if (node.isInline) {
      pos += node.nodeSize;
      return;
    }
    const { heightPx } = measureBlock(node, margins);
    if (heightPx <= 0) {
      pos += node.nodeSize;
      return;
    }
    if (currentPageHeight > 0 && currentPageHeight + heightPx > contentHeight) {
      breaks.push({ pos, pageNumber: pageNumber + 1 });
      pageNumber++;
      currentPageHeight = heightPx;
    } else {
      currentPageHeight += heightPx;
    }
    pos += node.nodeSize;
  });

  return { breaks, totalPages: Math.max(1, pageNumber) };
}
