/**
 * Fake Pagination Module — Using Pretext
 * 
 * Provides paginated view for ProseMirror documents.
 * Uses Pretext for fast, accurate text measurement without DOM reflow.
 */

import { prepare, layout, prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { EditorView } from 'prosemirror-view';
import { Node as PMNode, Fragment } from 'prosemirror-model';

// A4 dimensions in mm
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
export const MARGIN_TOP_MM = 25;
export const MARGIN_BOTTOM_MM = 20;
export const MARGIN_LEFT_MM = 20;
export const MARGIN_RIGHT_MM = 20;

// Convert mm to px at 96 DPI
const MM_TO_PX = 3.78;

export const CONTENT_WIDTH_PX = Math.round((PAGE_WIDTH_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM) * MM_TO_PX);
export const CONTENT_HEIGHT_PX = Math.round((PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM) * MM_TO_PX);

export interface PageBreakpoint {
  node: PMNode;
  pos: number;
  splitIndex?: number; // line index where split occurs
}

export interface PaginationResult {
  pages: PageBreakpoint[][];
  totalPages: number;
}

export interface PaginationOptions {
  font?: string;
  lineHeight?: number;
  contentWidth?: number;
  contentHeight?: number;
}

const DEFAULT_OPTIONS: Required<PaginationOptions> = {
  font: '12pt Georgia, serif',
  lineHeight: 18.9,
  contentWidth: CONTENT_WIDTH_PX,
  contentHeight: CONTENT_HEIGHT_PX,
};

/**
 * Measure a single node's height using Pretext
 */
export function measureNode(node: PMNode, options: Required<PaginationOptions>): { height: number; lineCount: number } {
  const text = node.textContent;
  if (!text.trim()) {
    return { height: options.lineHeight, lineCount: 1 };
  }
  
  const prepared = prepare(text, options.font);
  const result = layout(prepared, options.contentWidth, options.lineHeight);
  
  return { height: result.height, lineCount: result.lineCount };
}

/**
 * Get line information for precise splitting
 */
export function getLineInfo(node: PMNode, options: Required<PaginationOptions>) {
  const text = node.textContent;
  if (!text.trim()) {
    return { height: options.lineHeight, lines: [], fullText: '' };
  }
  
  const prepared = prepareWithSegments(text, options.font);
  const result = layoutWithLines(prepared, options.contentWidth, options.lineHeight);
  
  return {
    height: result.height,
    lines: result.lines,
    fullText: text,
  };
}

/**
 * Check if a node is a manual page break
 */
export function isPageBreak(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.attrs.pageBreakBefore === true;
}

/**
 * Paginate a ProseMirror document using Pretext
 * 
 * Simple implementation: one block node per page.
 * Manual page breaks create empty pages (placeholders).
 */
export function paginate(
  doc: PMNode,
  options: PaginationOptions = {}
): PaginationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pages: PageBreakpoint[][] = [];
  
  let currentPage: PageBreakpoint[] = [];
  let currentHeight = 0;
  
  let pos = 0;
  doc.forEach((node, _nodeOffset) => {
    const absolutePos = pos;
    
    // Skip inline nodes
    if (node.isInline) {
      pos += node.nodeSize;
      return;
    }
    
    // Measure node height with Pretext
    const { height: nodeHeight } = measureNode(node, opts);
    
    // Check for manual page break
    const isBreak = isPageBreak(node);
    
    // If this is a manual page break, OR adding this node would overflow
    if (isBreak || (currentHeight + nodeHeight > opts.contentHeight && currentPage.length > 0)) {
      // Finalize current page if it has content
      if (currentPage.length > 0) {
        pages.push([...currentPage]);
        currentPage = [];
        currentHeight = 0;
      }
      
      // If manual break, add an empty placeholder page
      if (isBreak) {
        pages.push([{ node, pos: absolutePos, splitIndex: -1 }]);
        pos += node.nodeSize;
        return;
      }
    }
    
    // Add node to current page
    currentPage.push({ node, pos: absolutePos });
    currentHeight += nodeHeight;
    
    pos += node.nodeSize;
  });
  
  // Don't forget the last page
  if (currentPage.length > 0) {
    pages.push([...currentPage]);
  }
  
  // If no pages at all, create one empty page
  if (pages.length === 0) {
    pages.push([]);
  }
  
  return {
    pages,
    totalPages: pages.length,
  };
}

/**
 * Split a paragraph at a specific height
 * Returns the text that fits and what remains
 */
export function splitAtHeight(
  node: PMNode,
  maxHeight: number,
  options: PaginationOptions = {}
): { first: string; second: string; splitLineIndex: number } | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lineInfo = getLineInfo(node, opts);
  
  let accumulatedHeight = 0;
  let splitIndex = lineInfo.lines.length;
  
  for (let i = 0; i < lineInfo.lines.length; i++) {
    accumulatedHeight += opts.lineHeight;
    if (accumulatedHeight > maxHeight) {
      splitIndex = i;
      break;
    }
  }
  
  if (splitIndex === 0) {
    return null; // Can't fit even first line
  }
  
  const firstLines = lineInfo.lines.slice(0, splitIndex);
  const secondLines = lineInfo.lines.slice(splitIndex);
  
  return {
    first: firstLines.map(l => l.text).join(''),
    second: secondLines.map(l => l.text).join(''),
    splitLineIndex: splitIndex,
  };
}

/**
 * Get the CSS for paginated view
 */
export function getPaginationCSS(): string {
  return `
    .aw-paginated-container {
      height: 100vh;
      overflow-y: auto;
      scroll-snap-type: y mandatory;
      background: #e0e0e0;
      padding: 40px 20px;
    }
    
    .aw-page {
      width: ${PAGE_WIDTH_MM}mm;
      min-height: ${PAGE_HEIGHT_MM}mm;
      margin: 0 auto 40px auto;
      background: #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      border: 1px solid #ddd;
      scroll-snap-align: start;
      box-sizing: border-box;
      padding: ${MARGIN_TOP_MM}mm ${MARGIN_RIGHT_MM}mm ${MARGIN_BOTTOM_MM}mm ${MARGIN_LEFT_MM}mm;
      position: relative;
    }
    
    .aw-page-content {
      width: 100%;
      min-height: calc(${PAGE_HEIGHT_MM}mm - ${MARGIN_TOP_MM}mm - ${MARGIN_BOTTOM_MM}mm);
      box-sizing: border-box;
      color: #222;
      font-family: Georgia, serif;
      font-size: 12pt;
      line-height: 1.6;
    }
    
    .aw-page-content p {
      margin: 0 0 1em 0;
      color: #222;
    }
    
    .aw-page-content h1, .aw-page-content h2, .aw-page-content h3 {
      color: #111;
      margin: 0 0 0.5em 0;
    }
    
    .aw-page-footer {
      position: absolute;
      bottom: ${MARGIN_BOTTOM_MM / 2}mm;
      left: ${MARGIN_LEFT_MM}mm;
      right: ${MARGIN_RIGHT_MM}mm;
      text-align: center;
      color: #888;
      font-size: 10pt;
      font-family: Georgia, serif;
    }
    
    .aw-page-break {
      display: none;
    }
  `;
}

/**
 * Render pages to a container element
 */
export function renderPages(
  container: HTMLElement,
  pages: PageBreakpoint[][],
  serializer: { serializeFragment: (fragment: Fragment) => Node }
): void {
  container.innerHTML = '';
  container.classList.add('aw-paginated-container');
  
  // Inject CSS if not already present
  if (!document.getElementById('aw-pagination-styles')) {
    const style = document.createElement('style');
    style.id = 'aw-pagination-styles';
    style.textContent = getPaginationCSS();
    document.head.appendChild(style);
  }
  
  pages.forEach((pageBreakpoints, pageIndex) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'aw-page';
    
    const contentEl = document.createElement('div');
    contentEl.className = 'aw-page-content';
    
    // Render each node in the page
    const fragment = Fragment.empty;
    pageBreakpoints.forEach(({ node }) => {
      const dom = serializer.serializeFragment(Fragment.from(node));
      contentEl.appendChild(dom);
    });
    
    pageEl.appendChild(contentEl);
    
    // Footer with page number
    const footer = document.createElement('div');
    footer.className = 'aw-page-footer';
    footer.textContent = `Pagina ${pageIndex + 1} di ${pages.length}`;
    pageEl.appendChild(footer);
    
    container.appendChild(pageEl);
  });
}

/**
 * Get page dimensions for external use
 */
export function getPageDimensions() {
  return {
    widthMm: PAGE_WIDTH_MM,
    heightMm: PAGE_HEIGHT_MM,
    contentWidthPx: CONTENT_WIDTH_PX,
    contentHeightPx: CONTENT_HEIGHT_PX,
    margins: {
      top: MARGIN_TOP_MM,
      bottom: MARGIN_BOTTOM_MM,
      left: MARGIN_LEFT_MM,
      right: MARGIN_RIGHT_MM,
    },
  };
}
