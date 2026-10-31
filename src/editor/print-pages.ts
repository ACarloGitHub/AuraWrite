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
  getPageFormat,
  type FreeBandInput,
  type FreeGeometry,
  type PageMargins,
} from "./pagination-cassie";
import { freeElementWidth, freeLayoutMap, freeLeftPx, isFreeNode, parseFreeSpec, stackDepthOf, zLevelOf, type FreeSpec, type FreeWrapBand } from "./free-layout";
import { isOverlap, textConditionOf } from "./element-condition";
import type { BandPiece, DomBand } from "./pagination-cassie-plugin";

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

export function buildPrintPages(
  doc: PMNode,
  margins: PageMargins,
  /**
   * Le fasce misurate sulla pagina di AuraWrite (17-09). Quando ci sono, sono
   * LORO i numeri dello spazio riservato al testo sul foglio: il foglio
   * ricostruisce la pagina dell'editor invece di rifarla per conto suo, che e'
   * quello che Carlo pretende - il testo deve essere identico, riga per riga, a
   * prescindere da dove sta l'immagine. Senza questo elenco si torna ai numeri
   * del calcolo, come prima.
   */
  editorBands: DomBand[] = [],
): PrintDoc {
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
  // Quale foglio disegna un elemento libero. Il calcolo indica una pagina, ma il
  // disegno del foglio parte dalla riga-ancora: se l'ancora sta in un foglio
  // DIVERSO, in quella pagina non c'e' nulla a cui misurarsi, e il numero resta
  // quello ipotizzato dal calcolo (e' cosi' che una copia finiva 1200 pixel piu'
  // in basso). Il foglio dell'ancora e' quello che puo' ricostruire la pagina
  // dell'editor: quando i due non coincidono, comanda l'ancora.
  const anchorOfFree = new Map(freeLayoutMap(doc).map((e) => [e.pos, e.anchorPos]));
  const sheetHolding = (pos: number): number => {
    for (let k = cuts.length - 2; k >= 0; k--) if (pos >= cuts[k]) return k + 1;
    return 1;
  };
  const freeByPage = new Map<number, FreeGeometry[]>();
  for (const geo of freeGeometry) {
    const anchorPos = anchorOfFree.get(geo.pos) ?? null;
    const sheet = anchorPos === null ? geo.page : sheetHolding(anchorPos);
    const list = freeByPage.get(sheet) ?? [];
    list.push(geo);
    freeByPage.set(sheet, list);
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
    // Le fasce misurate sulla pagina arrivano SPEZZATE PER PAGINA: l'editor dice
    // quali righe di QUESTO foglio accorciare, di quanto, da quale lato e da quale
    // blocco. Non c'e' piu' niente da ricavare da dove l'immagine e' finita sul
    // foglio - che e' la richiesta di Carlo del 18-09: il testo arriva misurato,
    // non come conseguenza della foto. Una riserva che scavalca il fondo pagina
    // arriva con un pezzo anche sul foglio dopo (che e' il caso A20 pagina 4).
    // I blocchi che questo foglio stampera', con la loro posizione nel documento:
    // servono perche' un pezzo misurato puo' indicare un paragrafo che su questo
    // foglio NON c'e' (paragrafo spezzato a meta', o riserva che entra dal bianco
    // sopra la prima riga). In quel caso lo porta il primo blocco del foglio, dal
    // suo bordo alto. Mappare i pezzi per identita' del nodo li faceva cadere nel
    // vuoto - ed e' il perche', dopo la build delle 06:56, la distribuzione del
    // testo di A20 era peggiore di prima: non era accorciata da nessuna parte.
    // Le posizioni VERE nel documento dei blocchi che questo foglio stampa: gli
    // offset della fetta non coincidono con le posizioni del documento quando il
    // foglio comincia a meta' paragrafo (openStart), e il pezzo di fascia indica
    // il blocco con la posizione del documento.
    const nodiDelDocumento: { pos: number; end: number }[] = [];
    {
      let p = 0;
      doc.forEach((n) => {
        nodiDelDocumento.push({ pos: p, end: p + n.nodeSize });
        p += n.nodeSize;
      });
    }
    const delFoglio = nodiDelDocumento.filter((t) => t.pos < cuts[i + 1] && t.end > cuts[i]);
    const iniziDelFoglio = new Set<number>();
    {
      let k = 0;
      slice.content.forEach((node) => {
        if (inFlow(node) && delFoglio[k]) iniziDelFoglio.add(delFoglio[k].pos);
        k++;
      });
    }
    const primoBlocco = iniziDelFoglio.size > 0 ? Math.min(...iniziDelFoglio) : null;
    const fascePerInizio = new Map<number, BandPiece[]>();
    // Due elementi liberi appesi allo stesso paragrafo (le due immagini
    // affiancate, l'immagine e la nota sovrapposte): il blocco ha BISOGNO di
    // tutte e due le fasce. Mapparne una sola per blocco lasciava il testo girare
    // attorno a una immagine e passare sotto l'altra.
    const fasceMisurate = new Set<number>();
    for (const b of editorBands) {
      // Chi ha una misura dell'editor non riceve niente dal calcolo, neppure in
      // cima al foglio: i pezzi dicono gia' dove il calcolo doveva intervenire.
      fasceMisurate.add(b.pos);
      for (const pezzo of b.pieces) {
        if (pezzo.page !== i) continue; // it belongs to another sheet's lines
        let pz = pezzo;
        if (!iniziDelFoglio.has(pz.insertPos - 1)) {
          if (primoBlocco === null) continue;
          // Il margine NON si azzera: per un pezzo che continua dal foglio prima
          // e' gia' misurato dal bordo alto di questa pagina (bandPieces), ed e'
          // quello che tiene la fascia all'altezza giusta.
          pz = { ...pz, insertPos: primoBlocco + 1 };
        }
        const lista = fascePerInizio.get(pz.insertPos - 1);
        if (lista) lista.push(pz);
        else fascePerInizio.set(pz.insertPos - 1, [pz]);
      }
    }
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
    let indiceBlocco = 0;
    slice.content.forEach((node, offsetInSlice) => {
      const docStart = delFoglio[indiceBlocco]?.pos ?? cuts[i] + offsetInSlice;
      indiceBlocco++;
      if (!inFlow(node)) return;
      const el = serializer.serializeNode(node, {}) as HTMLElement;
      // Il blocco porta la sua posizione nel documento: all'anteprima serve per
      // ritrovare il paragrafo a cui un elemento libero e' appeso.
      el.dataset.awPos = String(docStart);
      if (isOverlap(textConditionOf(node))) {
        // Overlap in the flow: out of the page flow but keeping the place it
        // already had, exactly as on screen (free-style.applyOverlapLayout).
        // The horizontal comes from the alignment, not from the natural left.
        const width = freeElementWidth(node) ?? 0;
        const align = String(node.attrs.align ?? "center");
        const xFrom = align === "left" || align === "right" ? align : "center";
        const left =
          width > 0
            ? freeLeftPx({ left: 0, width: contentWidth }, { xFrom, xOff: 0, yOff: 0, g: "" }, width)
            : 0;
        el.style.position = "absolute";
        el.style.top = "auto";
        el.style.left = `${Math.round(left)}px`;
        if (width > 0) el.style.width = `${width}px`;
        el.style.margin = "0";
        el.style.zIndex = String(stackDepthOf(zLevelOf(node)));
      }
      // La fascia MISURATA sulla pagina dell'editor ha la precedenza: stessi
      // numeri, stesso punto, quindi stesso testo. Senza misura, la fascia del
      // calcolo (strada di prima).
      const mioInizio = docStart;
      for (const m of fascePerInizio.get(mioInizio) ?? []) {
        // The piece is already clipped to its page by the editor; the sheet's own
        // content box is the last word, because a reserved area taller than the
        // paper would push the rest of the text off the sheet.
        const altezza = Math.min(m.heightPx, contentHeight - m.marginTop);
        if (altezza <= 0) continue;
        insertNodeAtOffset(
          el,
          wrapSpacerDom({ side: m.side, widthPx: m.widthPx } as FreeWrapBand, altezza, m.marginTop),
          m.insertPos - mioInizio - 1,
        );
      }
      // The float goes INSIDE the block's text, at the line the picture touches.
      // In front of the block with a margin it would narrow the lines from its
      // margin box, i.e. from the block's first line: a column of narrowed text
      // above the picture, on paper as on screen.
      for (const geo of bySpacerBlock.get(node) ?? []) {
        placed.add(geo);
        // Chi ha la fascia dell'editor e' gia' sistemata qui sopra: il conto del
        // calcolo non deve aggiungere una seconda riserva nello stesso blocco.
        if (fasceMisurate.has(geo.pos)) continue;
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
    //
    // Only the ones the editor did NOT measure. For a measured element the
    // numbers are already on the sheet, inside its own block: adding the
    // calculator's band as well put a SECOND float at the top of the sheet with
    // no margin, which narrowed the whole page - measured on A20 (title wrapped
    // into 5 lines on paper against 3 on screen, and the lines beside the picture
    // shortened twice). The measured numbers cannot say where an overflow past
    // the sheet's bottom edge begins, so an editor band that CONTINUES on the
    // next sheet is not reproduced there yet: a known limit, smaller than the
    // error it replaces.
    const carried = affecting.filter((g) => !placed.has(g) && !fasceMisurate.has(g.pos));
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
      freeHtml: freeOverlayHtml(freeByPage.get(i + 1) ?? [], i + 1, doc, serializer, contentHeight, contentWidth),
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
function wrapSpacerDom(band: FreeWrapBand, height: number, marginTop = 0): HTMLElement {
  // A span, not a div: this markup is re-read by the browser's HTML parser when
  // the sheet is injected, and a div inside a paragraph would close the
  // paragraph. A floated span stays inside the text and floats the same way.
  const el = document.createElement("span");
  el.className = "aw-print-free-wrap";
  el.style.cssFloat = band.side;
  el.style.width = `${band.widthPx}px`;
  el.style.height = `${Math.max(1, Math.round(height))}px`;
  if (marginTop > 0) {
    // The reserved area must begin where the picture is DRAWN, not at the top
    // of the line: same trick the editor uses (margin + shape-outside), or the
    // text reserves a band higher than the image and does not hug it.
    el.style.marginTop = `${marginTop}px`;
    el.style.shapeOutside = `inset(${marginTop}px 0 0 0)`;
  }
  return el;
}

/**
 * Put the float at a character offset inside a serialized block: walk the text
 * nodes, split the one that holds the offset, and insert before the rest. That
 * is the paper equivalent of the editor's widget inside the paragraph.
 */
function insertFloatAtOffset(root: HTMLElement, band: FreeBandInput, offset: number, height: number): void {
  const marginTop = Math.max(0, Math.round(band.y0 - band.lineTop));
  insertNodeAtOffset(root, wrapSpacerDom(band, height, marginTop), offset);
}

/** Mettere un pezzo (il galleggiante) a un certo carattere dentro un blocco. */
function insertNodeAtOffset(root: HTMLElement, float: Node, offset: number): void {
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
  sheetPage: number,
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
    // `sheetPage`, not `geo.page`: the two differ when the element was booked on
    // the sheet that holds its anchor, and the number written here is only the
    // starting point - the preview replaces it with the anchor's own top edge.
    const top = Math.round(geo.top - (sheetPage - 1) * contentHeight);
    // The wrapper gets a DEFINITE width, the same number the calculator
    // reserved: it is the element's drawn rectangle. Without it the box hangs
    // on shrink-to-fit, and the generic image cap (`max-width: 100%`) resolves
    // against a zero-width container: the photo collapses and never shows.
    parts.push(
      `<div class="aw-print-free" data-aw-free-pos="${geo.pos}" style="left:${left}px;top:${top}px;width:${Math.round(width)}px;` +
        `z-index:${stackDepthOf(geo.level)}">${holder.innerHTML}</div>`,
    );
  }
  return parts.join("");
}

/** Sheet markup (screen-dressed and print-safe; see file header). */
export function renderPrintBody(printDoc: PrintDoc): string {
  const m = printDoc.margins;
  // The sheet is the page: same width and height as the editor draws, from the
  // same datum (getPageFormat). 1122 was the A4 height minus one, a correction
  // that made the sheets agree with nothing in particular; the extra pixel is
  // gone and the page is the page.
  const page = getPageFormat();
  // The body starts at the top margin, exactly like the editor and like Word.
  // The header and footer bands are reserved inside the CONTENT HEIGHT
  // (getContentHeight), not as an empty offset above the body: adding them here
  // pushed every text and free element 48px below the editor (Carlo, 2026-09-13).
  const bodyTop = m.top;
  return printDoc.sheets
    .map(
      (s) =>
        `<section class="aw-print-sheet" data-page="${s.pageNumber}"` +
        ` style="--sheet-w:${page.widthPx}px;--sheet-h:${page.heightPx}px;--bl:${m.left}px;--bt:${bodyTop}px;--cw:${printDoc.contentWidth}px;--ch:${printDoc.contentHeight}px;--foot:${Math.round(m.bottom / 2)}px;">` +
        // The free layer lives INSIDE the body: text and free elements then
        // share one origin, so a free element cannot end up lower than the
        // text on the sheet (T1.6, Carlo 2026-09-11).
        `<div class="ProseMirror aw-print-body${s.continued ? " aw-print-cont" : ""}">${s.html}` +
        (s.freeHtml ? `<div class="aw-print-free-layer">${s.freeHtml}</div>` : "") +
        `</div>` +
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
    position: relative !important; left: auto !important; top: auto !important;
    width: auto !important; max-width: var(--cw) !important; height: auto !important;
    margin: 0 auto !important; overflow: visible !important;
  }
  .aw-print-pagenum {
    position: static !important; margin-top: 10px !important; bottom: auto !important;
  }
}
`;

/** Full style text for the preview window (screen + print layers). */
/* The preview window gets its screen/print dressing from src/styles/11-print-sheet.css;
   only the paper context is injected here (see plan law CS-L5). */
export const PRINT_CSS_ALL = `${PRINT_BASE_CSS}${PRINT_PRINT_CSS}`;
