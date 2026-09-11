/**
 * F1.5 print pages builder — PURE core (no Tauri): turns the CURRENT editor
 * document into a list of A4 sheets using the SAME page-break computation the
 * live editor draws (calculatePageBreaks). Single pagination engine
 * principle: what the editor splits, print splits identically.
 *
 * Print architecture (lesson from the 218MB PDF of 2026-08-31): the paper is
 * NOT drawn as fixed 793x1122 boxes. Print dialogs vary their margins and
 * paper, and a box that exceeds the printable area explodes into a grid of
 * extra pages. Instead, print mode lets the browser paginate a FLOW: each
 * page-chunk is content-only (column width = engine's content width, height
 * <= the engine's content height + one line of slack) followed by a forced
 * break. The chunks are therefore smaller than the smallest plausible
 * printable area (A4 or Letter, any margin preset) -> exactly one physical
 * page per engine page, never more. On screen the same markup is dressed as
 * paper sheets (fixed frame, margins, page number) for the preview window.
 */
import { DOMSerializer } from "prosemirror-model";
import type { Node as PMNode } from "prosemirror-model";
import {
  calculatePageBreaks,
  getContentHeight,
  getContentWidth,
  PAGE_WIDTH_PX,
  PAGE_HEIGHT_PX,
  PAGE_HEADER_PX,
  type FreeGeometry,
  type PageMargins,
} from "./pagination-cassie";
import { freeElementWidth, freeLeftPx, isFreeNode, parseFreeSpec, stackDepthOf, zLevelOf, type FreeSpec, type FreeWrapBand } from "./free-layout";
import { isOverlap, textConditionOf } from "./element-condition";

export interface PrintSheet {
  html: string;
  pageNumber: number;
  continued: boolean;
  /** Free elements drawn on this sheet (overlay), serialized WITHOUT flow. */
  freeHtml: string;
}

export interface PrintDoc {
  sheets: PrintSheet[];
  margins: PageMargins;
  contentWidth: number;
  contentHeight: number;
  totalPages: number;
}

export function buildPrintPages(doc: PMNode, margins: PageMargins): PrintDoc {
  const { breaks, totalPages, freeGeometry } = calculatePageBreaks(doc, margins);
  const cuts: number[] = [0];
  for (const b of breaks) {
    const last = cuts[cuts.length - 1];
    if (b.pos > last && b.pos < doc.content.size) cuts.push(b.pos);
  }
  cuts.push(doc.content.size);

  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const contentWidth = getContentWidth(margins);
  const contentHeight = getContentHeight(margins);
  const sheets: PrintSheet[] = [];

  // Free elements must NOT print in the line they live in: they are placed on
  // the sheet they are DRAWN on, with the same rectangle the editor paints
  // (contract §7, one source: the calculator). `inFlow` keeps them out of the
  // slice, `free` collects their overlay markup per page.
  const inFlow = (node: PMNode): boolean => !isFreeNode(node);
  const freeByPage = new Map<number, FreeGeometry[]>();
  for (const geo of freeGeometry) {
    const list = freeByPage.get(geo.page) ?? [];
    list.push(geo);
    freeByPage.set(geo.page, list);
  }

  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = doc.slice(cuts[i], cuts[i + 1], true);
    const host = document.createElement("div");
    // F3.2c: the bands whose rectangle touches this sheet. The band says which
    // block it starts shortening (`spacerPos`), so the spacer goes in front of
    // that block; a band that merely CONTINUES from a previous sheet is inserted
    // at the top of this one, clipped, which is what the one continuous flow
    // does on screen.
    const sheetTop = i * contentHeight;
    const sheetBottom = sheetTop + contentHeight;
    const affecting = freeGeometry.filter(
      (g) => g.band && g.band.y1 > sheetTop + 0.5 && g.band.y0 < sheetBottom - 0.5,
    );
    const bySpacerBlock = new Map<PMNode, FreeGeometry[]>();
    const startOfNode = new Map<PMNode, number>();
    for (const geo of affecting) {
      const insertPos = geo.band?.insertPos ?? null;
      if (insertPos === null) continue;
      const owner = blockStartOf(doc, insertPos);
      if (!owner) continue;
      startOfNode.set(owner.node, owner.start);
      const list = bySpacerBlock.get(owner.node);
      if (list) list.push(geo);
      else bySpacerBlock.set(owner.node, [geo]);
    }
    const placed = new Set<FreeGeometry>();
    slice.content.forEach((node) => {
      if (!inFlow(node)) return;
      const el = serializer.serializeNode(node, {}) as HTMLElement;
      if (isOverlap(textConditionOf(node))) {
        // Overlap in the flow: out of the page flow but keeping the place it
        // already had, exactly as on screen (free-style.applyOverlapLayout).
        el.style.position = "absolute";
        el.style.top = "auto";
        el.style.left = "auto";
        el.style.zIndex = String(stackDepthOf(zLevelOf(node)));
      }
      // The float goes INSIDE the block's text, at the line the picture touches.
      // In front of the block with a margin it would narrow the lines from its
      // margin box, i.e. from the block's first line: a column of narrowed text
      // above the picture, on paper as on screen.
      for (const geo of bySpacerBlock.get(node) ?? []) {
        placed.add(geo);
        const band = geo.band!;
        const start = startOfNode.get(node) ?? 0;
        // The float starts at the line it must shorten, so no margin is needed;
        // it is clipped at the sheet's own bottom edge, because a reserved area
        // taller than the paper would push the rest of the text off the sheet.
        const top = Math.max(band.y0, sheetTop);
        const height = Math.min(band.y1, sheetBottom) - top;
        insertFloatAtOffset(
          el,
          band,
          band.insertPos === null ? 0 : band.insertPos - start - 1,
          height,
        );
      }
      host.appendChild(el);
    });
    // Bands that came over from a previous sheet: they begin at the top of this
    // one, clipped, in document order.
    const carried = affecting.filter((g) => !placed.has(g));
    for (let k = carried.length - 1; k >= 0; k--) {
      const band = carried[k].band!;
      const el = wrapSpacerDom(band, Math.min(band.y1, sheetBottom) - sheetTop);
      if (host.firstChild) host.insertBefore(el, host.firstChild);
      else host.appendChild(el);
    }
    sheets.push({
      html: host.innerHTML,
      pageNumber: i + 1,
      continued: slice.openStart > 0,
      freeHtml: freeOverlayHtml(freeByPage.get(i + 1) ?? [], doc, serializer, contentHeight, contentWidth),
    });
  }
  return { sheets, margins, contentWidth, contentHeight, totalPages: Math.max(sheets.length, totalPages) };
}

/** The top-level block containing `pos`, with its start position. */
function blockStartOf(doc: PMNode, pos: number): { node: PMNode; start: number } | null {
  let found: { node: PMNode; start: number } | null = null;
  doc.forEach((node, offset) => {
    if (offset > pos) return false;
    if (offset + node.nodeSize > pos) {
      found = { node, start: offset };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * The sheet's own spacer: the same float the editor paints, with the numbers the
 * calculator booked (contract §7: one source, no second geometry) and no margin,
 * because it is placed at the line it must shorten.
 */
function wrapSpacerDom(band: FreeWrapBand, height: number): HTMLElement {
  // A span, not a div: this markup is re-read by the browser's HTML parser when
  // the sheet is injected, and a div inside a paragraph would close the
  // paragraph. A floated span stays inside the text and floats the same way.
  const el = document.createElement("span");
  el.className = "aw-print-free-wrap";
  el.style.cssFloat = band.side;
  el.style.width = `${band.widthPx}px`;
  el.style.height = `${Math.max(1, Math.round(height))}px`;
  return el;
}

/**
 * Put the float at a character offset inside a serialized block: walk the text
 * nodes, split the one that holds the offset, and insert before the rest. That
 * is the paper equivalent of the editor's widget inside the paragraph.
 */
function insertFloatAtOffset(root: HTMLElement, band: FreeWrapBand, offset: number, height: number): void {
  const float = wrapSpacerDom(band, height);
  let left = Math.max(0, Math.round(offset));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    const len = text.data.length;
    if (left <= len) {
      if (left < len) text.splitText(left);
      text.parentElement?.insertBefore(float, text);
      return;
    }
    left -= len;
  }
  root.insertBefore(float, root.firstChild); // no text at that offset: start the block
}

/**
 * Overlay markup for one sheet. Coordinates come from the engine's own
 * `freeGeometry`: `top` minus the page's first flow position, `left` from the
 * same `freeLeftPx` the editor uses. A free element that hangs over the sheet
 * edge is clipped by the sheet, which is what the contract promises (§4:
 * intero a schermo, tagliato in stampa).
 */
function freeOverlayHtml(
  list: FreeGeometry[],
  doc: PMNode,
  serializer: DOMSerializer,
  contentHeight: number,
  contentWidth: number,
): string {
  if (list.length === 0) return "";
  const parts: string[] = [];
  for (const geo of list) {
    const node = doc.nodeAt(geo.pos);
    const spec: FreeSpec | null = node ? parseFreeSpec(node.attrs?.free) : null;
    if (!node || !spec) continue;
    // Serialize a copy WITHOUT the free state: the wrapper carries the
    // position, and an element that still thought it was wrapped/absolute
    // would offset itself a second time.
    const plain = node.type.create({ ...node.attrs, free: null, wrap: "overlap", zLevel: 1 }, node.content, node.marks);
    const holder = document.createElement("div");
    holder.appendChild(serializer.serializeNode(plain, {}));
    const width = freeElementWidth(node) ?? contentWidth;
    const left = Math.round(freeLeftPx({ left: 0, width: contentWidth }, spec, width));
    const top = Math.round(geo.top - (geo.page - 1) * contentHeight);
    parts.push(
      `<div class="aw-print-free" style="left:${left}px;top:${top}px;` +
        `z-index:${stackDepthOf(geo.level)}">${holder.innerHTML}</div>`,
    );
  }
  return parts.join("");
}

/** Sheet markup (screen-dressed and print-safe; see file header). */
export function renderPrintBody(printDoc: PrintDoc): string {
  const m = printDoc.margins;
  const bodyTop = m.top + PAGE_HEADER_PX;
  return printDoc.sheets
    .map(
      (s) =>
        `<section class="aw-print-sheet" data-page="${s.pageNumber}"` +
        ` style="--sheet-w:${PAGE_WIDTH_PX - 1}px;--sheet-h:${PAGE_HEIGHT_PX - 1}px;--bl:${m.left}px;--bt:${bodyTop}px;--cw:${printDoc.contentWidth}px;--ch:${printDoc.contentHeight}px;--foot:${Math.round(m.bottom / 2)}px;">` +
        `<div class="ProseMirror aw-print-body${s.continued ? " aw-print-cont" : ""}">${s.html}</div>` +
        (s.freeHtml ? `<div class="aw-print-free-layer">${s.freeHtml}</div>` : "") +
        `<div class="aw-print-pagenum">${s.pageNumber}</div>` +
        `</section>`,
    )
    .join("\n");
}

/**
 * Base CSS shared by screen and print. @page asks for A4 with a modest
 * margin: dialogs that honor it get nice paper margins; dialogs that ignore
 * it (their own presets) still find the flow-chunks smaller than the
 * printable area. Either way: one chunk, one page.
 */
export const PRINT_BASE_CSS = `
@page { size: A4; margin: 12mm; }
#aw-print-doc { display: none; color: #111; background: #fff; }
.aw-print-sheet { position: relative; box-sizing: border-box; z-index: 0; }
.ProseMirror.aw-print-body {
  position: static;
  margin: 0 auto; padding: 0;
  background: transparent; box-shadow: none; white-space: pre-wrap;
}
/* a page that starts mid-paragraph continues from the page edge: the
   engine gives that fragment no leading gap, so strip the block's own */
.ProseMirror.aw-print-body.aw-print-cont > :first-child { margin-top: 0; }
.aw-print-pagenum {
  position: absolute; left: 0; right: 0; bottom: var(--foot);
  text-align: center; font: 11px Georgia, serif; color: #666;
}

/* Free elements (F3.2). Layer above the flow, coordinates already resolved by
   the engine. In paper mode the sheet must stay height:auto (fixed-height boxes
   are what exploded print into page grids on 2026-08-31), so the layer is
   anchored to the sheet with a zero-size anchor: an absolutely positioned box
   inside a position:relative sheet would otherwise stretch the sheet and
   generate extra pages. */
.aw-print-free-layer { position: absolute; left: var(--bl); top: var(--bt); width: 0; height: 0; }
.aw-print-free { position: absolute; }
.aw-print-free img, .aw-print-free figure { margin: 0; }
.aw-print-free-wrap { background: transparent; border: 0; padding: 0; margin-left: 0; margin-right: 0; }
/* T1.4/T1.6: a wrapped element in the flow floats on the sheet too, with the
   same gap the editor uses (frame and shadow included). The image serializes as
   a bare <img> (no wrapper), so it needs its own rule here; the figure keeps
   class aw-figure and would match the editor rules, mirrored here for the
   preview window. */
.aw-print-body > img[data-wrap][data-align="left"] { float: left; margin: 0 var(--aw-float-gap, 12px) 0 0; }
.aw-print-body > img[data-wrap][data-align="right"] { float: right; margin: 0 0 0 var(--aw-float-gap, 12px); }
.aw-print-body .aw-figure[data-wrap][data-align="left"] { float: left; margin: 0 var(--aw-float-gap, 12px) 0 0; }
.aw-print-body .aw-figure[data-wrap][data-align="right"] { float: right; margin: 0 0 0 var(--aw-float-gap, 12px); }
`;

/** Screen dressing used ONLY by the preview window (paper look). */
export const PRINT_SCREEN_CSS = `
@media screen {
  #aw-print-doc.aw-print-visible { display: block !important; padding: 18px 0 48px; }
  #aw-print-doc.aw-print-visible .aw-print-sheet {
    width: var(--sheet-w); height: var(--sheet-h);
    background: #fff; overflow: hidden;
    margin: 0 auto 18px; box-shadow: 0 1px 6px rgba(0,0,0,.25);
  }
  #aw-print-doc.aw-print-visible .ProseMirror.aw-print-body {
    left: var(--bl); top: var(--bt); width: var(--cw); height: var(--ch); position: absolute;
  }
  #aw-print-doc.aw-print-visible .aw-print-pagenum {
    position: absolute; bottom: var(--foot);
  }
}
`;

/** The print-critical overrides (must come after every other print style). */
export const PRINT_PRINT_CSS = `
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#aw-print-doc) { display: none !important; }
  #aw-print-doc { display: block !important; }
  .aw-print-sheet {
    width: auto !important; height: auto !important; overflow: visible !important;
    margin: 0 !important; padding: 0 !important; box-shadow: none !important;
    background: transparent !important;
    /* relative + its own stacking context: the free-layer anchors here, and a
       free element sent BEHIND the words (negative depth) still paints above
       the paper. Page expansion is avoided because the height stays auto. */
    position: relative !important; z-index: 0;
    break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid;
  }
  .aw-print-sheet:last-child { break-after: auto; page-break-after: auto; }
  .ProseMirror.aw-print-body {
    position: static !important; left: auto !important; top: auto !important;
    width: auto !important; max-width: var(--cw) !important; height: auto !important;
    margin: 0 auto !important; overflow: visible !important;
  }
  .aw-print-pagenum {
    position: static !important; margin-top: 10px !important; bottom: auto !important;
  }
}
`;

/** Full style text for the preview window (screen + print layers). */
export const PRINT_CSS_ALL = `${PRINT_BASE_CSS}${PRINT_SCREEN_CSS}${PRINT_PRINT_CSS}`;
