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
  type PageMargins,
} from "./pagination-cassie";

export interface PrintSheet {
  html: string;
  pageNumber: number;
  continued: boolean;
}

export interface PrintDoc {
  sheets: PrintSheet[];
  margins: PageMargins;
  contentWidth: number;
  contentHeight: number;
  totalPages: number;
}

export function buildPrintPages(doc: PMNode, margins: PageMargins): PrintDoc {
  const { breaks, totalPages } = calculatePageBreaks(doc, margins);
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

  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = doc.slice(cuts[i], cuts[i + 1], true);
    const frag = serializer.serializeFragment(slice.content);
    const host = document.createElement("div");
    host.appendChild(frag);
    sheets.push({ html: host.innerHTML, pageNumber: i + 1, continued: slice.openStart > 0 });
  }
  return { sheets, margins, contentWidth, contentHeight, totalPages: Math.max(sheets.length, totalPages) };
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
.aw-print-sheet { position: relative; box-sizing: border-box; }
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
    background: transparent !important; position: static !important;
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
