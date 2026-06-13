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
 * - The editor uses Lora at 16px as the default. 8px per character
 *   and 24px line height are good approximations.
 * - Content width inside the A4 page is 794px - 2*96px = 602px
 *   (matches the CSS in src/styles.css).
 * - Content height per page is 1123 - 2*96 - 48 (header) - 24
 *   (footer) = 859px (matches the constant in pagination-plugin.ts).
 *
 * The functions in this module are pure: given a node, return
 * metrics. They have no side effects, no DOM access, and no state.
 * That makes them trivial to test in isolation.
 */

import { prepare, layout, prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
import type { Node as PMNode } from "prosemirror-model";

// Page geometry in CSS pixels. Kept in sync with the constants
// in pagination-plugin.ts and with src/styles.css (.pm-page).
export const PAGE_WIDTH_PX = 794;
export const PAGE_MARGIN_PX = 96;
export const PAGE_HEADER_PX = 48;
export const PAGE_FOOTER_PX = 24;
export const PAGE_HEIGHT_PX = 1123;

export const CONTENT_WIDTH_PX = PAGE_WIDTH_PX - 2 * PAGE_MARGIN_PX;
export const CONTENT_HEIGHT_PX =
  PAGE_HEIGHT_PX - 2 * PAGE_MARGIN_PX - PAGE_HEADER_PX - PAGE_FOOTER_PX;

// Font and metrics for the editor body text. Tuned for Lora at
// 16px with a 1.5 line-height. These constants are exported so
// tests and other modules can refer to the same values.
export const EDITOR_FONT = "16px Lora, Georgia, serif";
export const EDITOR_LINE_HEIGHT_PX = 24;
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
export function measureBlock(node: PMNode | null | undefined): BlockMetrics {
  if (!node) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lineCount: 1 };
  }
  const text = node.textContent || "";
  if (!text.trim()) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lineCount: 1 };
  }
  try {
    const prepared = prepare(text, EDITOR_FONT);
    const result = layout(prepared, CONTENT_WIDTH_PX, EDITOR_LINE_HEIGHT_PX);
    const lineCount = Math.max(1, result.lineCount ?? Math.ceil(result.height / EDITOR_LINE_HEIGHT_PX));
    return { heightPx: result.height, lineCount };
  } catch {
    const charPerLine = 70;
    const lineCount = Math.max(1, Math.ceil(text.length / charPerLine));
    return { heightPx: lineCount * EDITOR_LINE_HEIGHT_PX, lineCount };
  }
}

/**
 * Get per-line information for a block. Used by the optional
 * mid-paragraph split (future work). Each line is a substring of
 * the original text plus the line break that follows it.
 */
export function getBlockLines(node: PMNode | null | undefined): LineInfo {
  if (!node) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lines: [], fullText: "" };
  }
  const text = node.textContent || "";
  if (!text.trim()) {
    return { heightPx: EMPTY_BLOCK_HEIGHT_PX, lines: [], fullText: text };
  }
  try {
    const prepared = prepareWithSegments(text, EDITOR_FONT);
    const result = layoutWithLines(prepared, CONTENT_WIDTH_PX, EDITOR_LINE_HEIGHT_PX);
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
export function calculatePageBreaks(doc: PMNode): PaginationCalculation {
  const breaks: PageBreakAt[] = [];
  let currentPageHeight = 0;
  let pageNumber = 1;

  let pos = 0;
  doc.forEach((node) => {
    if (node.isInline) {
      pos += node.nodeSize;
      return;
    }
    const { heightPx } = measureBlock(node);
    if (heightPx <= 0) {
      pos += node.nodeSize;
      return;
    }
    if (currentPageHeight > 0 && currentPageHeight + heightPx > CONTENT_HEIGHT_PX) {
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
