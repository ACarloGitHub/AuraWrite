import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { freeWrapBand, freeLayoutMap, paintedBoxOf, parseFreeSpec, type FreeSpec } from "./free-layout";
import { isOverlap, textConditionOf } from "./element-condition";
import { elementDecorationExtent } from "./element-decoration";
import { textColumn } from "./free-style";
import type { Node as PMNode } from "prosemirror-model";
import { calculatePageBreaks, getPageFormat } from "./pagination-cassie";
import { syncEditorMetricsFromDom, getMetricsGeneration } from "./text-metrics";
import { appliedScale } from "./editor-zoom";
import { getPagedMode, getCassiePagedMode, getMargins } from "./pagination-state";

export const cassiePaginationPluginKey = new PluginKey("cassiePagination");

/**
 * One piece of a reservation, on ONE painted page.
 *
 * This is the shape Carlo asked for (18-09, third time): the print sheet must not
 * derive the text from where the picture ends up. It must receive, page by page,
 * which lines the editor shortens, how wide, on which side, and how deep - so a
 * reservation that crosses a page's bottom arrives as TWO pieces, one per page,
 * and the second page is not left unshortened (that omission was the defect of
 * A20 page 4, and it was introduced on 17-09 by excluding the carried float
 * without replacing it with the editor's numbers).
 */
export interface BandPiece {
  /** 0-based index of the painted page: the sheets are numbered the same way. */
  page: number;
  /** Start of the text block that carries this piece's spacer. */
  insertPos: number;
  /** Distance from that block's top to the piece's top, in layout pixels. */
  marginTop: number;
  side: "left" | "right";
  widthPx: number;
  heightPx: number;
  full: boolean;
}

/** One band, measured on the screen. */
export interface DomBand {
  /** The free element this band belongs to. */
  pos: number;
  /**
   * Document position inside the text, at the start of the first line the band
   * shortens. A float can only begin on a line: its line-avoidance box starts at
   * the top of the line it is inserted in, and `margin-top` does NOT move that
   * box (measured: a float pushed down 400px still shortens the paragraph's
   * first line), so the insertion POSITION is the only control there is.
   */
  insertPos: number;
  /**
   * Distance from the anchor block's top to the band's top, in the editor's own
   * pixels. The float is inserted at the block's start and pushed down by this;
   * `shape-outside` keeps it from narrowing the lines above.
   */
  marginTop: number;
  side: "left" | "right";
  widthPx: number;
  heightPx: number;
  /** Unwrapped: the spacer claims the whole column, so no line sits beside it. */
  full: boolean;
  /**
   * The band split per painted page. The FIRST piece is the one the screen uses
   * (same block, same margin - so the screen cannot drift from what is shipped);
   * the pieces after it are the continuation on the next page's lines, which the
   * screen gets for free from one continuous flow and the paper cannot.
   */
  pieces: BandPiece[];
}

/** The painted pages as vertical ranges, in the host's own layout units. */
function paintedPageAreas(host: HTMLElement, scale: number): { top: number; bottom: number }[] {
  const hostTop = host.getBoundingClientRect().top;
  const rel = (el: HTMLElement): { top: number; bottom: number } => {
    const r = el.getBoundingClientRect();
    return { top: (r.top - hostTop) / scale, bottom: (r.bottom - hostTop) / scale };
  };
  // A page-break widget draws the two pages' margins (and header/footer): what
  // lies ABOVE it is this page's lines, what lies BELOW it is the next page's.
  // The strip inside the widget has no line to shorten on paper either, because
  // on paper that strip is a margin - so clipping a reservation to the ranges
  // BETWEEN widgets is exactly what the sheets must be told.
  const widgets = Array.from(host.querySelectorAll<HTMLElement>(".aw-page-break"))
    .map(rel)
    .sort((a, b) => a.top - b.top);
  const out: { top: number; bottom: number }[] = [];
  let cursor = 0;
  for (const w of widgets) {
    out.push({ top: cursor, bottom: w.top });
    cursor = w.bottom;
  }
  out.push({ top: cursor, bottom: Number.MAX_SAFE_INTEGER });
  return out;
}

function pageOfArea(areas: { top: number; bottom: number }[], y: number): number {
  for (let i = 0; i < areas.length; i++) if (y < areas[i].bottom) return i;
  return areas.length - 1;
}

/**
 * Split a reservation into one piece per painted page it touches.
 *
 * Every piece is computed the same way, the first one included, and that is the
 * point: the first piece used to be handed over as "the anchor's block plus the
 * anchor's margin" while its PAGE was decided by the band's own top - and a
 * picture dropped into the space BETWEEN two pages has the top inside the page
 * break widget, whose strip belongs to the page below. Block from one page, page
 * from the next: the sheet could not place it, and since the element was also
 * marked as measured (which switches the calculator's own band off), NOTHING was
 * shortened on any sheet. Seen by Carlo on A20 right after the 06:56 build: the
 * text distribution was worse than before, not better.
 *
 * The block that carries a piece is the last text block starting at or above the
 * piece's top (for the first piece it is the anchor itself) - the same rule
 * `freeWrapPlacement` uses, for the same reason: a float cannot rise out of the
 * block it sits in, so the block before the gap is the only one that can begin
 * the shortening at the right line.
 */
function bandPieces(input: {
  /** The anchor block: what carries the first piece, as on the screen. */
  anchor: { pos: number; top: number };
  /** The reservation's painted span, in the host's own layout units. */
  top: number;
  bottom: number;
  side: "left" | "right";
  widthPx: number;
  full: boolean;
  areas: { top: number; bottom: number }[];
  blocks: { pos: number; top: number }[];
}): BandPiece[] {
  const { anchor, top, bottom, side, widthPx, full, areas, blocks } = input;
  if (blocks.length === 0 || bottom <= top) return [];
  // The pages to look at are those whose LINES the span overlaps: the strip of a
  // page break (a page's bottom margin, the separator, the next page's top
  // margin) is white space on paper too, so it has no line to shorten and gets no
  // piece of its own.
  const firstPage = pageOfArea(areas, anchor.top);
  const lastPage = pageOfArea(areas, bottom - 1);
  const out: BandPiece[] = [];
  for (let page = firstPage; page <= lastPage; page++) {
    const lo = Math.max(top, areas[page].top);
    const hi = Math.min(bottom, areas[page].bottom);
    if (hi - lo <= 0.5) continue; // the strip on this page is margin, not lines
    let carrier = page === firstPage ? anchor : blocks[0];
    if (page !== firstPage) {
      for (const b of blocks) {
        if (b.top <= lo + 0.5) carrier = b;
        else break;
      }
    }
    out.push({
      page,
      insertPos: carrier.pos + 1,
      marginTop: Math.max(0, Math.round(lo - carrier.top)),
      side,
      widthPx,
      heightPx: Math.max(1, Math.round(hi - lo)),
      full,
    });
  }
  return out;
}

/**
 * Measure the bands from the painted page (F3.2c, the fix Carlo's collaudo
 * asked for).
 *
 * Two numbers, two authorities, and the split is not symmetric on purpose:
 *  - WHERE the band starts (its line, its top): the DOM. That is what the user
 *    sees moving, and the page axis has no dividers in it - a band placed with
 *    the calculator's ruler sits below its picture (the lesson of F3.2c);
 *  - HOW WIDE a claim it is and on WHICH side: the shared `freeWrapBand`, fed
 *    with the element's OWN box and its turn - the same inputs the page count
 *    uses. Feeding it the painted width instead produced a rectangle that was
 *    neither box: it started at the registered edge and ended at half the
 *    turn's growth, so the first letters of every line ran under the picture
 *    wherever the element was anchored to a side (defect 17).
 *
 * The calculator keeps booking its own bands in flow coordinates: that is the
 * axis the PAGES are counted on, and the print sheets have no dividers, so there
 * the two rulers agree.
 */
/**
 * The DOM element of a block, remembered by NODE identity.
 *
 * ProseMirror keeps the element of a block it did not touch and, when it does
 * rebuild one, it does so from a NEW node object: the same node therefore
 * answers with the same element until it is replaced. `nodeDOM` is a walk from
 * the root, and calling it for every one of the 4.267 blocks on every pass was
 * one of the costs measured on 26-10 (the `descAt` entries of the profile). The
 * cache keeps the answer and checks the element is still in the document.
 */
const domOfNode = new WeakMap<PMNode, HTMLElement>();

function elementOf(view: EditorView, node: PMNode, offset: number): HTMLElement | null {
  const remembered = domOfNode.get(node);
  if (remembered && remembered.isConnected) return remembered;
  const el = view.nodeDOM(offset);
  if (!(el instanceof HTMLElement)) return null;
  domOfNode.set(node, el);
  return el;
}

export function measureDomBands(
  view: EditorView,
  override?: Map<number, FlyingBox>,
  // Read-only: when a caller passes a list, the measurement writes down why it
  // skipped what it skipped. It is how the verification tool finds out why a
  // document that has just been opened gets no band at all.
  diagnosis?: Record<string, unknown>[],
): DomBand[] {  conta.misure++;
  const host = view.dom as HTMLElement;
  const out: DomBand[] = [];
  const pictures = Array.from(host.children).filter(
    (el) => (el as HTMLElement).dataset?.awFree === "1",
  ) as HTMLElement[];
  if (pictures.length === 0) {
    diagnosis?.push({ fermo: "nessun figlio del documento porta il segno degli elementi liberi" });
    return out;
  }

  const column = textColumn(host);
  const scale = hostScale(host);
  // Needed only to place a FLYING copy inside the column: the copy lives on the
  // document body, outside the scaled page, and its coordinates are viewport ones.
  const hostRect = host.getBoundingClientRect();
  // The painted pages on the SAME axis the band is measured on: what a reservation
  // shortens, page by page, is decided here - never by the print sheet re-deriving
  // it (Carlo, 18-09: the text must arrive measured).
  const pageAreas = paintedPageAreas(host, scale);

  // ONE walk of the document: the text blocks, by their OWN node positions (the
  // anchor lookup needs their DOM), and the free elements. Positions come from
  // the tree (`doc.forEach`), never from `posAtDOM`, which answers with an
  // offset INSIDE the block and would put every anchor one step off.
  const elsByPos = new Map<number, HTMLElement>();
  const freeEls = new Map<number, HTMLElement>();
  // The anchor of every free element, computed ONCE: asking `freeLayoutMap` for
  // each picture walked the whole document once per picture (266 walks on the
  // test book), which the 26-10 profile counted as document traversals.
  const anchorByPos = new Map<number, number | null>();
  for (const entry of freeLayoutMap(view.state.doc)) anchorByPos.set(entry.pos, entry.anchorPos);
  view.state.doc.forEach((childNode, offset) => {
    const isFree = parseFreeSpec((childNode.attrs as Record<string, unknown> | undefined)?.free) !== null;
    const isTextBlock = childNode.type.name === "paragraph" || childNode.type.name === "heading";
    if (!isFree && !isTextBlock) return;
    const el = elementOf(view, childNode, offset);
    if (!el) return;
    if (/^P$|^H[1-6]$/.test(el.tagName)) elsByPos.set(offset, el);
    if (isFree) freeEls.set(offset, el);
  });
  if (elsByPos.size === 0 || freeEls.size === 0) {
    diagnosis?.push({ fermo: "paragrafi o elementi liberi non trovati nel documento",
                      paragrafi: elsByPos.size, liberi: freeEls.size, figli: host.children.length });
    return out;
  }
  // The text blocks with their top on that same axis, in document order (which is
  // the order they are painted in): the carrier of a piece is the last block that
  // starts at or above the piece's top.
  const blockTops = Array.from(elsByPos.entries()).map(([pos, el]) => ({
    pos,
    top: (el.getBoundingClientRect().top - hostRect.top) / scale,
  }));

  for (const [pos, pic] of freeEls) {
    const node = view.state.doc.nodeAt(pos);
    const spec = node ? parseFreeSpec(node.attrs?.free) : null;
    if (!node || !spec) {
      diagnosis?.push({ pos, fermo: node ? "posizione free illeggibile" : "nessun nodo a questa posizione" });
      continue;
    }
    const condition = textConditionOf(node);
    if (isOverlap(condition)) {
      diagnosis?.push({ pos, fermo: "elemento sovrapposto: non chiede spazio" });
      continue;
    }

    // `offsetWidth`/`offsetHeight` are the element's OWN box in layout units: the
    // transform is not applied to them, which is exactly what makes them the unit
    // that turns, and what keeps the claim independent of the visual magnification.
    const ownWidthCss = pic.offsetWidth;
    const ownHeightCss = pic.offsetHeight;
    const rotationDeg = Number((node.attrs as Record<string, unknown>)?.rotation) || 0;
    if (ownWidthCss <= 0 || ownHeightCss <= 0) {
      diagnosis?.push({ pos, fermo: "misura dell'elemento nulla", largo: ownWidthCss, alto: ownHeightCss });
      continue;
    }
    const r = pic.getBoundingClientRect();
    // While the element flies the original is hidden in its old place, so the copy's
    // rectangle replaces the measured one for the VERTICAL; the claim's size stays the
    // element's own box, because that is the unit that turns.
    const flying = override?.get(pos);
    const painted = paintedBoxOf(ownWidthCss, ownHeightCss, rotationDeg);
    // The band's vertical start and the claim's horizontal position. At rest both come
    // from what is painted and registered; while the element flies, the copy is not in
    // the document to be measured, so its painted rectangle is DERIVED from its own box
    // and the turn by the same function the page count uses - never by adding a shift
    // in one file and subtracting it in another, which is how the sign got wrong twice.
    let lineTopClient: number;
    let paintedHeightClient: number;
    let claimSpec: FreeSpec = spec;
    if (flying) {
      lineTopClient = flying.top - painted.topShift * scale;
      paintedHeightClient = painted.heightPx * scale;
      // The live position, expressed the way a registered one is: the distance of the
      // copy's own left edge from the column's left content edge, in layout units.
      claimSpec = {
        ...spec,
        xFrom: "left",
        xOff: (flying.left - hostRect.left) / scale - column.left,
      };
    } else {
      lineTopClient = r.top;
      paintedHeightClient = r.height;
    }
    if (paintedHeightClient <= 0) {
      diagnosis?.push({ pos, fermo: "altezza dipinta nulla", dipinta: paintedHeightClient });
      continue;
    }

    const extent = elementDecorationExtent(node.attrs as Record<string, unknown>, node.type.name);
    let side: "left" | "right";
    let widthPx: number;
    if (condition === "unwrapped") {
      // Unwrapped: the whole column, so the text goes above and below.
      side = "left";
      widthPx = column.width;
    } else {
      const band = freeWrapBand({
        column: { left: 0, width: column.width },
        spec: claimSpec,
        elementWidthPx: ownWidthCss,
        elementHeightPx: ownHeightCss,
        rotationDeg,
        drawnTop: 0,
        wrapOn: true,
        extraClaimPx: extent.x,
        extraHeightPx: extent.y,
      });
      if (!band) {
        // The turned unit covers the whole column: there is no side left to claim.
        // The page count answers with the text above and below (same rule there);
        // skipping the band here too is what left the words running through the
        // picture on screen (defect 12, second half).
        side = "left";
        widthPx = column.width;
      } else {
        side = band.side;
        widthPx = band.widthPx;
      }
    }

    // WHICH LINE the band starts on.
    //
    // The line is found by BISECTION over the anchor's own characters: for a
    // candidate character offset, the browser tells us the top of the tiny
    // rectangle of that one character. That reading is honest (one character,
    // not a block) and it does not feed back - a float only pushes down the
    // lines BELOW its start, so the first character at or below the picture's
    // top edge stays the same one whatever the band currently is.
    //
    // Why not the two obvious shortcuts:
    //  - `Range.getClientRects()` on the whole block: a paragraph that already
    //    contains a float reports MERGED rects (one 247px strip instead of
    //    twelve 19px lines), so the "first touched line" was a whole screenful,
    //    the derived height was inflated, and the band landed 205px below the
    //    picture;
    //  - the calculator's line offsets: exact for the PAPER, but the screen and
    //    the paper wrap at different points when the two rulers disagree (41
    //    lines against the 99 the browser really draws), so the index points at
    //    the wrong character.
    const anchorPos = anchorByPos.get(pos) ?? null;
    if (anchorPos === null) {
      diagnosis?.push({ pos, fermo: "nessun paragrafo a cui appoggiare l'elemento" });
      continue;
    }
    const anchorEl = elsByPos.get(anchorPos);
    const anchorNode = view.state.doc.nodeAt(anchorPos);
    if (!anchorEl || !anchorNode) {
      diagnosis?.push({ pos, fermo: "paragrafo ancora non trovato", anchorPos,
                        haDom: !!anchorEl, haNodo: !!anchorNode });
      continue;
    }

    // The band starts at the anchor block's start and is pushed down to the
    // line by a margin, with `shape-outside` keeping it out of the lines above.
    // A float's reserved area normally begins at the top of the line it is
    // inserted in, and `margin-top` alone does NOT move that area down -
    // measured: a float pushed 100px down still shortened the paragraph's first
    // line. `shape-outside: inset(marginTop 0 0 0)` removes exactly that part of
    // the shape, so the text is narrowed only from the line the band belongs to.
    // Inserting at the block's start (instead of hunting the line) is also what
    // ends the measurement feedback: the anchor is a fixed point.
    const anchorTopClient = anchorEl.getBoundingClientRect().top;
    // Layout pixels, not viewport ones: the spacer lives INSIDE the magnified
    // page, so a margin read off the screen must lose the magnification first.
    // Left undivided, a zoomed editor reserved the space a fraction too low and
    // the sheet - never magnified - disagreed with it.
    const marginTop = Math.max(0, Math.round((lineTopClient - anchorTopClient) / scale));
    const height = paintedHeightClient;
    if (height <= 0) {
      diagnosis?.push({ pos, fermo: "altezza nulla prima di scrivere la fascia" });
      continue;
    }
    const heightPx = Math.max(1, Math.round(height / scale) + Math.round(extent.y));
    const bandTop = (lineTopClient - hostRect.top) / scale;
    const full = condition === "unwrapped";
    // The pieces are what the sheets get. The screen keeps painting its own
    // single spacer from the fields below (anchor block, anchor margin, full
    // height) - one continuous flow needs no split, and that is the behaviour
    // the six concordant documents were verified with.
    const pieces = bandPieces({
      anchor: { pos: anchorPos, top: (anchorTopClient - hostRect.top) / scale },
      top: bandTop,
      bottom: bandTop + heightPx,
      side,
      widthPx,
      full,
      areas: pageAreas,
      blocks: blockTops,
    });
    if (pieces.length === 0) {
      diagnosis?.push({ pos, fermo: "la riserva non tocca righe di nessuna pagina" });
    }
    out.push({
      pos,
      insertPos: anchorPos + 1,
      marginTop,
      side,
      widthPx,
      heightPx,
      full,
      pieces,
    });
  }
  return out;
}

/** Read-only: why the measurement of the bands skipped what it skipped. */
export function freeWrapDiagnosis(view: EditorView): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  measureDomBands(view, undefined, out);
  return out;
}

/**
 * Re-measure the bands and repaint them. Called after every paint by this
 * plugin's view, and every ~90 ms by the drag with the flying box as an
 * override. One measurement, two callers: the screen and the gesture cannot
 * drift apart, which is exactly what the rejected delivery did.
 *
 * The spacers of ours already in the layout are lifted out for the duration of
 * the measurement. This is not tidiness: a band narrows the lines of its anchor,
 * which moves the anchor, which moves the measurement. Reading the geometry
 * while our own floats are in the way fed every pass into the next one, and the
 * fixed point of that loop is a band a line or two off (measured: 205px, then
 * 64px, then 45px, depending on where the loop stopped). The geometry a band
 * must match is the picture against the text as the PRINTER sees it, that is,
 * with no bands at all, so the layout is read once with the spacers out and they
 * are put back exactly where they were. Synchronous, so nothing observes the
 * document in between: no flicker, no second paint.
 */
/**
 * Read-only look at the band machinery, for the verification tool: the numbers
 * the screen measured, how many more re-measures it is allowed to ask for, and
 * how many reservation pieces are actually painted. It changes nothing.
 */
export function freeWrapState(): {
  bands: DomBand[];
  republishLeft: number;
  painted: number;
  conta: Record<string, number>;
  /**
   * True when the last measurement was withheld: the screen has not painted it,
   * so the sheet has not received it either (they can never differ).
   */
  withheld: boolean;
} {
  return {
    bands: domBands,
    republishLeft,
    painted: document.querySelectorAll(".aw-free-wrap").length,
    conta: { ...conta },
    withheld,
  };
}

export function refreshFreeWrapBands(view: EditorView, options?: { force?: boolean }): void {
  // One walk of the page, not one per repaint.
  //
  // This used to run on EVERY view update and on EVERY paint, and a publish is
  // what causes a paint - so a single keystroke bought the whole allowance of
  // full-document walks. Measured on a real book (18-09: 4.267 blocks, 874 pages,
  // 266 pictures with the text around): one walk is 82 ms, a keystroke cost
  // 1.200 ms, and twenty characters produced 212 measurements and 124
  // republishes. Now: a document version is measured once, the publish that
  // follows is allowed exactly one more look (the publish moves the text, so the
  // numbers can genuinely shift), and a deliberate action (print, preview, a
  // gesture, new margins) can always force one.
  const fresh = view.state.doc !== measuredDoc;
  if (!options?.force && !fresh && !allowOneMore) return;
  // Un tasto dopo l'ultima foto non puo' spostare nessuno spazio riservato: gli
  // spazi dipendono dagli ancoraggi, e gli ancoraggi stanno tutti prima. Quindi la
  // passata intera si salta - e' la fetta piu' cara del tasto (profilo 26-10).
  if (!options?.force && fresh && lastEditStart !== null) {
    const lastFree = lastFreePos(view.state.doc);
    if (lastFree !== null && lastEditStart > lastFree) {
      measuredDoc = view.state.doc;
      allowOneMore = false;
      withheld = false;
      return;
    }
  }
  measuredDoc = view.state.doc;
  allowOneMore = false;
  const override = flightBox ? new Map([[flightBox.pos, flightBox.box]]) : undefined;
  // `force` is for a deliberate action (printing, opening the preview, opening
  // a document): nobody is typing, so the withheld numbers get their pass now
  // and the sheet is built on what the screen is showing at that moment.
  //
  // The allowance is 4 and not 1 because a fresh page needs SEVERAL passes to
  // settle: the band moves the text, the text moves the anchor, the anchor
  // moves the band. With one pass the third measurement was kept back and never
  // published - measured on L01 (2026-10-23): at open the lines ran UNDER the
  // picture (no band painted), and they only shortened when the preview forced
  // a new measurement. Bounded, so the loop still cannot run away.
  if (options?.force) republishLeft = Math.max(republishLeft, 4);
  const measured = measureDomBands(view, override);
  if (sameDomBands(measured, domBands)) {
    withheld = false;
    // An EMPTY measurement is not an answer when the document HAS free elements.
    //
    // Right after a drop the picture has not been painted as free yet (the
    // painter runs on the next frame), so this look finds nothing; comparing
    // "nothing" with "nothing" used to close the door - the document was marked
    // as measured and every later look returned at the top of this function.
    // The band then appeared only when something forced a measure, which is the
    // intermittent "sometimes the text does not wrap" reported on 2026-10-24:
    // the same drop worked or failed depending on how quickly the painter ran.
    // Re-open the door (no dispatch here, so this cannot loop): the next paint
    // asks again.
    if (measured.length === 0 && freeLayoutMap(view.state.doc).length > 0) allowOneMore = true;
    return;
  }
  if (republishLeft <= 0) {
    // The numbers moved but the screen cannot be repainted right now, so they are
    // NOT handed over: what the print sheet receives must be what AuraWrite is
    // showing, always. Shipping numbers the screen does not have is what left page
    // 30 of C01 with the sheet wrapping the text around the picture and the
    // writing window letting the picture cover it (Carlo, 18-09). The measurement
    // is kept back and the page gets one more publish when the writing stops.
    conta.trattenute++;
    armSettlePass(view);
    return;
  }
  domBands = measured;
  withheld = false;
  republishLeft--;
  conta.pubblicazioni++;
  bandsVersion++;
  // Painting the bands moves the lines they cover, and the pictures hang from
  // those lines: after a publish one more look is fair. Not more than one - that
  // is exactly what the allowance exists to bound.
  allowOneMore = true;
  view.dispatch(
    view.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
  );
  // A band narrows the lines it covers, and narrowing lines moves every block
  // below them - including the picture's own anchor. The picture was placed
  // against the text BEFORE the bands landed, so after a publish it hangs from
  // a paragraph that has since moved (measured: the first picture on the page
  // sat on its anchor, the second 88px above it, the third 176px, and so on).
  // Say so, once, and let the painter place the pictures again.
  window.dispatchEvent(new Event("aurawrite:bands-published"));
}

/**
 * One more chance to publish, when the writing has stopped.
 *
 * The allowance exists to stop a loop (a band moves the lines, the lines move the
 * anchor, the anchor moves the band). Paying for it by letting the two surfaces
 * drift apart was the wrong price: now a withheld measurement is kept back, and
 * the page is given ONE more publish once the typing has stopped - the moment when
 * the numbers can no longer move again - so the screen catches up and the sheet
 * gets exactly what the screen shows.
 */
function armSettlePass(view: EditorView): void {
  withheld = true;
  window.clearTimeout(settlePassTimer);
  settlePassTimer = window.setTimeout(() => {
    if (view.isDestroyed) return;
    republishLeft = Math.max(republishLeft, 1);
    refreshFreeWrapBands(view);
  }, SETTLE_MS_BANDS);
}

function sameDomBands(a: DomBand[], b: DomBand[]): boolean {
  if (a.length !== b.length) return false;
  const firma = (p: BandPiece): string =>
    `${p.page}:${p.insertPos}:${p.marginTop}:"${p.side}":${p.widthPx}:${p.heightPx}:${p.full}`;
  return a.every((x, i) => {
    const y = b[i];
    return x.pos === y.pos && x.insertPos === y.insertPos && x.marginTop === y.marginTop
      && x.side === y.side && x.widthPx === y.widthPx && x.heightPx === y.heightPx
      && x.full === y.full
      // The split per page has to be part of the signature too: a reservation that
      // starts covering the same line but now reaches (or no longer reaches) the
      // page below is a different sheet, and must be republished.
      && x.pieces.length === y.pieces.length
      && x.pieces.every((p, k) => firma(p) === firma(y.pieces[k]));
  });
}


/** How much the page is scaled on screen (1 when there is no zoom). */
function hostScale(host: HTMLElement): number {
  return appliedScale(host);
}

/**
 * The invisible float that shortens the lines a free element crosses.
 *
 * A float is the one CSS construct the browser and the page counter read the
 * same way, and the spacer holds no content and takes no flow height. It goes in
 * front of the block the picture really crosses, offset inside that block by the
 * distance the picture is offset - the same numbers, the same ruler.
 */
function freeWrapSpacerDom(band: DomBand): HTMLElement {
  const el = document.createElement("div");
  el.className = "aw-free-wrap";
  el.dataset.awFreeWrap = String(band.pos);
  el.style.cssFloat = band.side;
  el.style.width = `${band.widthPx}px`;
  el.style.height = `${Math.max(1, band.heightPx)}px`;
  // The reserved area begins at the band's own top edge, never at the top of the
  // block: without this the float narrows every line from the block's first one
  // (measured: a float with `margin-top: 100px` still shortened the first line).
  el.style.marginTop = `${Math.max(0, band.marginTop)}px`;
  el.style.shapeOutside = `inset(${Math.max(0, band.marginTop)}px 0 0 0)`;
  el.contentEditable = "false";
  return el;
}

/** One widget per band measured on the screen. */
function freeWrapDecorations(bands: DomBand[]): Decoration[] {
  return bands.map((band) =>
    Decoration.widget(band.insertPos, () => freeWrapSpacerDom(band), {
      side: -1,
      ignoreSelection: true,
      // The drag rewrites this box's numbers live (free-drag.ts): the widget is
      // not document content, so its own mutations must not be read back.
      ignoreMutation: () => true,
      key: `aw-free-wrap-${band.pos}-${band.side}-${band.widthPx}-${band.insertPos}-${band.heightPx}-${band.marginTop}-${band.full ? 1 : 0}`,
    }),
  );
}

/** Where the copy of an element under the pointer is, right now. */
export interface FlyingBox {
  /**
   * The copy's OWN top-left corner, in viewport (client) pixels - the same space
   * `getBoundingClientRect` uses. Only the corner: the size is the element's own box,
   * which does not change in flight, and the rectangle it paints comes out of
   * `paintedBoxOf`, so no caller has to know which way a turn displaces an edge.
   */
  top: number;
  left: number;
}

/** The bands, as last measured on the painted page (module state: one editor). */
let domBands: DomBand[] = [];
/** The document version the last measurement was taken from. */
let measuredDoc: PMNode | null = null;
/** True when one more look is allowed even if the document did not change. */
let allowOneMore = false;
/** Bumped every time new band numbers are published: the page must reclose. */
let bandsVersion = 0;
/** The document, format, margins and band version the last closing pass saw. */
let closedDoc: PMNode | null = null;
let closedKey = "";
let closedLayoutKey = "";
let closedBandsVersion = -1;
/** Where the last document change starts (null when the document did not change). */
let lastEditStart: number | null = null;

/** Start position of the LAST free element of the document, or null. */
function lastFreePos(doc: PMNode): number | null {
  let end: number | null = null;
  doc.forEach((node, offset) => {
    if (parseFreeSpec((node.attrs as Record<string, unknown> | undefined)?.free) !== null) {
      // The END, not the start: editing the last picture's own caption changes
      // its height and therefore its space, so only a change strictly AFTER the
      // whole element can leave every band untouched.
      end = offset + node.nodeSize;
    }
  });
  return end;
}

/**
 * Contatori di sola lettura (17-09). Servono allo strumento di verifica per
 * sapere quali strade hanno davvero percorso il codice: quante volte la misura
 * e' stata chiesta, quante volte il codice ha pubblicato le fasce, quanti
 * aggiornamenti e quanti eventi sono arrivati. Non cambiano il comportamento.
 */
const conta = { misure: 0, pubblicazioni: 0, trattenute: 0, aggiornamenti: 0, metriche: 0, dipinto: 0 };

/**
 * Where a flying element is right now, while the user drags it. The original is
 * hidden in its old place, so without this the next repaint would measure the
 * OLD position and drag the band back under it: the text would flicker between
 * two layouts on every frame of the gesture. The drag sets it, and clears it on
 * release; while it is set, every measurement uses it.
 */
let flightBox: { pos: number; box: FlyingBox } | null = null;

/** Tell the bands where a dragged element is (or clear it with `null`). */
export function setFreeWrapFlightBox(pos: number, box: FlyingBox | null): void {
  flightBox = box ? { pos, box } : null;
  republishLeft = REPUBLISH_BUDGET; // a moving picture is allowed to move the band again
  allowOneMore = true;              // and to be measured again: the document does not change while it flies
}

/**
 * True while a picture is flying under the pointer. Nothing that WRITES to the
 * document may run in that state: the picture has no measured position yet, and
 * the gesture is not over. The page rule for anchors asks for this before it
 * touches anything (free-anchor-page.ts).
 */
export function freeWrapFlightActive(): boolean {
  return flightBox !== null;
}

/**
 * How many more re-measures this document version is allowed to ask for.
 *
 * A band shortens the lines it covers, the lines it covers move the anchor, the
 * anchor moves the picture, and the picture moves the band: reflow is a loop,
 * and loops need a stopping condition. Layout engines settle it the same way -
 * iterate a bounded number of times and keep the last answer. Without the
 * budget the editor repainted itself forever (the bench froze on exactly this).
 */
const REPUBLISH_BUDGET = 2;
let republishLeft = REPUBLISH_BUDGET;
/** How long the writing must be still before the withheld numbers get their pass. */
const SETTLE_MS_BANDS = 260;
let settlePassTimer = 0;
/** True when the last measurement was kept back (the screen has not painted it). */
let withheld = false;

function buildDecorations(
  doc: PMNode,
  cassieEnabled: boolean,
  cassiePaged: boolean,
  editorDom: HTMLElement | null,
): DecorationSet {
  // Nothing paged at all: no dividers and no bands to book, and the walk is
  // skipped exactly as it was before F3.2b.
  if (!getPagedMode() && !cassieEnabled && !cassiePaged) return DecorationSet.empty;
  // R-b full style probe kept on EVERY rebuild (Carlo's call 2026-08-31):
  // it is only ~3 ms and it is the self-healing guarantee — the calculator
  // always measures with the styles the editor is ACTUALLY rendering, no
  // matter how or when they changed. The F1.4 cache auto-invalidates when
  // the probe sees a real change.
  syncEditorMetricsFromDom(editorDom);
  const margins = getMargins();
  const paintsDividers = cassieEnabled || cassiePaged;
  const { breaks } = calculatePageBreaks(doc, margins);
  // The wrap bands apply in EVERY view mode - an element that shortens lines on
  // paper must shorten them on screen, paged or continuous. They arrive already
  // measured on the screen (measureDomBands), never converted from the
  // calculator's axis. The page dividers stay this plugin's business only in the
  // continuous modes, exactly as before.
  const wrapDecorations = freeWrapDecorations(domBands);
  const withWraps = (rest: Decoration[]): DecorationSet =>
    DecorationSet.create(doc, rest.length || !wrapDecorations.length ? rest.concat(wrapDecorations) : wrapDecorations);
  if (getPagedMode() || !paintsDividers || breaks.length === 0) return withWraps([]);

  // F1.4 stable keys: a break on the SAME line of the SAME page keeps its
  // identity across keystrokes even though its document position shifts as
  // text grows (ProseMirror compares widget decorations by spec.key). That
  // lets the view reuse the existing DOM instead of tearing down every page
  // marker after every character. The key embeds everything the widget DOM
  // depends on: visual mode, page number, mid-paragraph flag, margin heights.
  const modeTag = cassiePaged ? "p" : "l";
  const breakDecorations: Decoration[] = breaks.map((bp) =>
    Decoration.widget(
      bp.pos,
      () => {
        const wrap = document.createElement("div");
        wrap.className = cassiePaged ? "aw-page-break aw-page-break--paged" : "aw-page-break";
        wrap.setAttribute("data-page", String(bp.pageNumber));
        if (bp.midParagraph) wrap.setAttribute("data-mid-paragraph", "1");
        wrap.contentEditable = "false";

        if (cassiePaged) {
          const topMargin = document.createElement("div");
          topMargin.className = "aw-page-break-margin-top";
          topMargin.style.height = `${margins.bottom}px`;

          const separator = document.createElement("div");
          separator.className = "aw-page-break-separator";

          const footerArea = document.createElement("div");
          footerArea.className = "aw-page-break-footer";
          footerArea.textContent = String(bp.pageNumber - 1);

          const headerArea = document.createElement("div");
          headerArea.className = "aw-page-break-header";
          headerArea.textContent = String(bp.pageNumber);

          const bottomMargin = document.createElement("div");
          bottomMargin.className = "aw-page-break-margin-bottom";
          bottomMargin.style.height = `${margins.top}px`;

          wrap.appendChild(topMargin);
          wrap.appendChild(footerArea);
          wrap.appendChild(separator);
          wrap.appendChild(headerArea);
          wrap.appendChild(bottomMargin);
        } else {
          const topSpacer = document.createElement("div");
          topSpacer.className = "aw-page-break-spacer-top";
          topSpacer.style.height = `${margins.bottom}px`;

          const line = document.createElement("div");
          line.className = "aw-page-break-line";

          const label = document.createElement("span");
          label.className = "aw-page-break-label";
          label.textContent = `Pagina ${bp.pageNumber}`;

          const bottomSpacer = document.createElement("div");
          bottomSpacer.className = "aw-page-break-spacer-bottom";
          bottomSpacer.style.height = `${margins.top}px`;

          wrap.appendChild(topSpacer);
          wrap.appendChild(line);
          wrap.appendChild(label);
          wrap.appendChild(bottomSpacer);
        }

        return wrap;
      },
      {
        side: -1,
        ignoreSelection: true,
        key: `cassie-pb-${modeTag}-${bp.pageNumber}-${bp.midParagraph ? 1 : 0}-${margins.top}-${margins.bottom}`,
      },
    ),
  );

  return withWraps(breakDecorations);
}

export interface CassiePaginationOptions {
  enabled: () => boolean;
}

// ---------------------------------------------------------------------------
// CLOSING THE PAGE (the divider takes the space that is left)
//
// What was wrong, measured: a full page of prose ends its last line at 858px
// (39 lines x 22px) and the divider drew 249px of fixed margins, so the next
// page started at 1107 instead of 1123. Sixteen pixels short, on every page,
// accumulating: by page 30 the text sat half a page above the paper. The same
// arithmetic made a page that ends on a block boundary 1.3px short and one
// whose block was moved to the next page short by the whole gap.
//
// The fault was not the 16px alone: it was that the divider carried a CONSTANT
// height while the space left on the page is anything but constant. So the
// divider now measures where the text really stopped and takes the rest:
//
//     next page's content top = padTop + (page - 1) x pageHeight
//
// That single rule covers every way a page can end (mid-paragraph, block moved,
// manual break, image) and every page format, and it needs no second pagination
// engine: it reads the layout the browser has already done.
//
// Cost, and why it is two passes: writing a spacer and then reading the next
// divider forces a layout on every page. All the reads happen first, all the
// writes after (the fills of the previous dividers are carried in `shift`), so
// one layout per update, not one per page.
// ---------------------------------------------------------------------------

/** One divider, as the last closing pass left it (read-only, for the tool). */
export interface PageGeometryRow {
  page: number;
  /** Measured top of the divider = where this page's text stopped. */
  top: number;
  /** Where the next page's content must start (padTop + (page-1) x height). */
  wanted: number;
  /** Pixels the divider had to add to its bottom margin. */
  fill: number;
  /** Measured height of footer + separator + header + top margin. */
  rest: number;
  /** True when this pass changed it. */
  applied: boolean;
}

let lastPageGeometry: PageGeometryRow[] = [];

/** The last closing pass, for the verification tool (read-only). */
export function pageGeometry(): PageGeometryRow[] {
  return lastPageGeometry.map((r) => ({ ...r }));
}

interface DividerRead {
  el: HTMLElement;
  page: number;
  spacer: HTMLElement;
  top: number;
  rest: number;
  oldFill: number;
}

export function closePageHeights(view: EditorView): void {
  const host = view.dom as HTMLElement;
  if (!host.classList.contains("is-cassie-paged")) {
    lastPageGeometry = [];
    return;
  }
  const format = getPageFormat();
  // The page box itself is the same datum: the stylesheet reads these two.
  const wantW = `${format.widthPx}px`;
  const wantH = `${format.heightPx}px`;
  if (host.style.getPropertyValue("--aw-page-w") !== wantW) host.style.setProperty("--aw-page-w", wantW);
  if (host.style.getPropertyValue("--aw-page-h") !== wantH) host.style.setProperty("--aw-page-h", wantH);

  const dividers = Array.from(host.querySelectorAll<HTMLElement>(".aw-page-break--paged"));
  if (dividers.length === 0) {
    lastPageGeometry = [];
    return;
  }
  const scale = appliedScale(host) || 1;
  const hostTop = host.getBoundingClientRect().top;
  const padTop = parseFloat(getComputedStyle(host).paddingTop) || 0;
  const margins = getMargins();

  // Una pagina si richiude solo quando qualcosa che la sposta e' cambiato: il
  // documento, il formato, i margini o le fasce appena pubblicate. Un semplice
  // movimento del cursore non cambia nessuna altezza; la chiusura invece costa
  // due rettangoli per ognuno degli 874 divisori, e il profilo del 26-10 la
  // vedeva partire a ogni aggiornamento.
  const closeKey = `${format.id}:${format.widthPx}/${format.heightPx}:` +
    `${margins.top}/${margins.right}/${margins.bottom}/${margins.left}:${bandsVersion}:${getMetricsGeneration()}`;
  if (view.state.doc === closedDoc && closeKey === closedKey) return;

  // Un tasto cambia solo cio' che sta DALLA SUA PAGINA IN Giu': le pagine sopra
  // sono gia' chiuse e il loro contenuto non si e' mosso, quindi si leggono solo
  // i divisori da li' in poi. La riga di partenza si ricava dal punto modificato
  // con l'aritmetica delle pagine (il passo delle pagine e' esatto per
  // costruzione), non rileggendo i divisori per trovarne la pagina.
  // Un cambio di formato, di margini o di spazi pubblicati invece riguarda tutto.
  const layoutKey = `${format.id}:${format.widthPx}/${format.heightPx}:` +
    `${margins.top}/${margins.right}/${margins.bottom}/${margins.left}:${getMetricsGeneration()}`;
  const layoutChanged = layoutKey !== closedLayoutKey;
  const bandsChanged = bandsVersion !== closedBandsVersion;
  let firstPage = 2;
  if (!layoutChanged && !bandsChanged && lastEditStart !== null) {
    try {
      const c = view.coordsAtPos(lastEditStart);
      if (c) {
        const y = (c.top - hostTop) / scale - padTop;
        const index = Math.max(0, Math.floor(y / format.heightPx));
        firstPage = Math.max(2, index + 2);
      }
    } catch {
      firstPage = 2;
    }
  }

  // ---- pass 1: read everything (one layout, no writes in between) --------
  // Two rectangles per divider (the whole widget and its top spacer): `rest`
  // comes out exact by subtraction, where summing five `offsetHeight`s would
  // round each part to a whole pixel.
  const reads: DividerRead[] = [];
  for (const el of dividers) {
    const page = Number(el.dataset.page || "0");
    if (!page || page < 2) continue;
    if (page < firstPage) continue; // above the edit: already closed, nothing moved
    let spacer: HTMLElement | null = null;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.classList.contains("aw-page-break-margin-top")) {
        spacer = child;
        break;
      }
    }
    if (!spacer) continue;
    const box = el.getBoundingClientRect();
    const spacerBox = spacer.getBoundingClientRect();
    const spacerHeight = spacerBox.height / scale;
    reads.push({
      el,
      page,
      spacer,
      top: (box.top - hostTop) / scale,
      rest: box.height / scale - spacerHeight,
      oldFill: spacerHeight - margins.bottom,
    });
  }

  // ---- pass 2: arithmetic, then the writes -------------------------------
  const out: PageGeometryRow[] = [];
  let shift = 0;
  for (const r of reads) {
    const wanted = padTop + (r.page - 1) * format.heightPx;
    const top = r.top + shift;
    // With no fill the divider is: bottom margin + footer + separator + header + top margin.
    const natural = margins.bottom + r.rest;
    // The fill can be NEGATIVE, and it must be: a page that ends between two
    // blocks carries the last paragraph's margin-bottom into the divider (in
    // the model that margin is not content, in the DOM it is drawn). Refusing
    // to shrink made every such page ~7-15px too tall, and the error then piled
    // up page after page. Shrinking the bottom margin is visually free: those
    // pixels are white either way.
    const wantedFill = wanted - (top + natural);
    const spacerHeight = Math.max(0, margins.bottom + wantedFill);
    const fill = spacerHeight - margins.bottom;
    let applied = false;
    if (Math.abs(fill - r.oldFill) >= 0.5) {
      r.spacer.style.height = `${Math.round(spacerHeight * 100) / 100}px`;
      applied = true;
    }
    shift += fill - r.oldFill;
    out.push({
      page: r.page,
      top: Math.round(top * 100) / 100,
      wanted: Math.round(wanted * 100) / 100,
      fill: Math.round(fill * 100) / 100,
      rest: Math.round(r.rest * 100) / 100,
      applied,
    });
  }
  // Le righe sopra il punto modificato tengono i numeri di prima: descrivono
  // pagine il cui contenuto non si e' mosso.
  const kept = firstPage > 2
    ? lastPageGeometry.filter((r) => r.page < firstPage)
    : [];
  lastPageGeometry = kept.concat(out);
  closedDoc = view.state.doc;
  closedKey = closeKey;
  closedLayoutKey = layoutKey;
  closedBandsVersion = bandsVersion;
}

export function createCassiePaginationPlugin(
  options: CassiePaginationOptions,
): Plugin {
  let editorDom: HTMLElement | null = null;
  // The bands, as measured on the screen. Module state on purpose: the
  // decorations read it and the view writes it, and the loop closes as soon as
  // the numbers stop changing.

  return new Plugin({
    key: cassiePaginationPluginKey,

    state: {
      init: (_, state) => {
        // A state built from scratch is a DIFFERENT document: opening one goes
        // through here (the loader creates a new EditorState), and because that
        // new state carries a NEW plugins array, ProseMirror recreates the plugin
        // views instead of updating them (verified in prosemirror-view), so this
        // is the only place where "a new document is starting" is reliably seen.
        // Two things follow: the bands measured on the previous document must go
        // (they describe pictures that are not here - painting them was measured
        // to leave the page one document behind), and the allowance to measure
        // and paint the new ones must be given here, because no edit
        // transaction and no view update ever runs for this event.
        domBands = [];
        measuredDoc = null;
        allowOneMore = false;
        lastEditStart = null;
        republishLeft = REPUBLISH_BUDGET;
        return buildDecorations(state.doc, options.enabled(), getCassiePagedMode(), editorDom);
      },
      apply: (tr, old, _oldState, newState) => {
        // The bands are re-published by the view after every paint, so a
        // rebuild is asked for with the same meta the metrics probe already
        // uses; nothing here reads the DOM.
        if (tr.getMeta("force-cassie-recompute")) {
          return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
        }
        if (!tr.docChanged) return old;
        // Dove inizia il cambiamento: serve alla regola "un tasto dopo l'ultima
        // foto non muove nessuno spazio riservato". Costa una discesa, non una
        // passata sul documento.
        lastEditStart = newState.doc.content.findDiffStart(_oldState.doc.content);
        republishLeft = REPUBLISH_BUDGET; // a new edit gets its own allowance
        return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
      },
    },

    view() {
      let dom: HTMLElement | null = null;
      const onMetricsChanged = () => {
        conta.metriche++;
        syncEditorMetricsFromDom(dom);
        // New margins, new font, new line height: the document did not change,
        // but every band may sit elsewhere, so the next look is allowed.
        allowOneMore = true;
        const v = liveView;
        if (v && !v.isDestroyed) {
          v.dispatch(
            v.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
          );
        }
      };
      let liveView: import("prosemirror-view").EditorView | null = null;
      window.addEventListener("aurawrite:editor-metrics-changed", onMetricsChanged);
      const onFreePainted = () => {
        conta.dipinto++;
        const v = liveView;
        if (v && !v.isDestroyed) refreshFreeWrapBands(v);
      };
      window.addEventListener("aurawrite:free-painted", onFreePainted);
      return {
        update(view) {
          conta.aggiornamenti++;
          liveView = view;
          // The page frame first: the dividers have just been rendered, so this
          // is the only moment at which "where did the text stop" is readable.
          closePageHeights(view);
          // No allowance renewal here on purpose: opening a document builds a new
          // EditorState, ProseMirror then recreates the plugin views and never
          // calls this update (verified in prosemirror-view). The allowance for a
          // new document is given where a new document actually begins -
          // `state.init` above.
          refreshFreeWrapBands(view);
          if (!dom) {
            dom = view.dom as HTMLElement;
            editorDom = dom;
            syncEditorMetricsFromDom(dom);
            // Fonts may still be loading at startup: re-probe once when they
            // are ready, and one refresh so a doc opened directly in a paged
            // mode uses the live metrics even before the first keystroke.
            const refreshSoon = () => {
              if (!view.isDestroyed) {
                view.dispatch(
                  view.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
                );
              }
            };
            setTimeout(refreshSoon, 0);
            if (document.fonts?.ready) {
              document.fonts.ready.then(() => {
                if (dom) syncEditorMetricsFromDom(dom);
                refreshSoon();
              }).catch(() => { /* metrics stay as probed */ });
            }
          }
        },
        destroy() {
          window.removeEventListener("aurawrite:editor-metrics-changed", onMetricsChanged);
          window.removeEventListener("aurawrite:free-painted", onFreePainted);
          window.clearTimeout(settlePassTimer);
        },
      };
    },

    props: {
      decorations(state) {
        return cassiePaginationPluginKey.getState(state) || DecorationSet.empty;
      },
    },
  });
}
