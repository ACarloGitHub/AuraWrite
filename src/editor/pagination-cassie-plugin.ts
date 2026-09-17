import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import { freeWrapBand, freeLayoutMap, paintedBoxOf, parseFreeSpec, type FreeSpec } from "./free-layout";
import { isOverlap, textConditionOf } from "./element-condition";
import { elementDecorationExtent } from "./element-decoration";
import { textColumn } from "./free-style";
import type { Node as PMNode } from "prosemirror-model";
import { calculatePageBreaks } from "./pagination-cassie";
import { syncEditorMetricsFromDom } from "./text-metrics";
import { appliedScale } from "./editor-zoom";
import { getPagedMode, getCassiePagedMode, getMargins } from "./pagination-state";

export const cassiePaginationPluginKey = new PluginKey("cassiePagination");

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
export function measureDomBands(
  view: EditorView,
  override?: Map<number, FlyingBox>,
  // Read-only: when a caller passes a list, the measurement writes down why it
  // skipped what it skipped. It is how the verification tool finds out why a
  // document that has just been opened gets no band at all.
  diagnosis?: Record<string, unknown>[],
): DomBand[] {
  conta.misure++;
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

  // ONE walk of the document: the text blocks, by their OWN node positions (the
  // anchor lookup needs their DOM), and the free elements. Positions come from
  // the tree (`doc.forEach`), never from `posAtDOM`, which answers with an
  // offset INSIDE the block and would put every anchor one step off.
  const elsByPos = new Map<number, HTMLElement>();
  const freeEls = new Map<number, HTMLElement>();
  view.state.doc.forEach((childNode, offset) => {
    const el = view.nodeDOM(offset);
    if (!(el instanceof HTMLElement)) return;
    if (/^P$|^H[1-6]$/.test(el.tagName)) elsByPos.set(offset, el);
    if (el.dataset?.awFree === "1") freeEls.set(offset, el);
  });
  if (elsByPos.size === 0 || freeEls.size === 0) {
    diagnosis?.push({ fermo: "paragrafi o elementi liberi non trovati nel documento",
                      paragrafi: elsByPos.size, liberi: freeEls.size, figli: host.children.length });
    return out;
  }

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
    const anchorPos = freeLayoutMap(view.state.doc).find((e) => e.pos === pos)?.anchorPos ?? null;
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
    const marginTop = Math.max(0, Math.round(lineTopClient - anchorTopClient));
    const height = paintedHeightClient;
    if (height <= 0) {
      diagnosis?.push({ pos, fermo: "altezza nulla prima di scrivere la fascia" });
      continue;
    }
    out.push({
      pos,
      insertPos: anchorPos + 1,
      marginTop,
      side,
      widthPx,
      heightPx: Math.max(1, Math.round(height / scale) + Math.round(extent.y)),
      full: condition === "unwrapped",
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
} {
  return {
    bands: domBands,
    republishLeft,
    painted: document.querySelectorAll(".aw-free-wrap").length,
    conta: { ...conta },
  };
}

export function refreshFreeWrapBands(view: EditorView): void {
  const override = flightBox ? new Map([[flightBox.pos, flightBox.box]]) : undefined;
  const measured = measureDomBands(view, override);
  if (sameDomBands(measured, domBands)) return;
  domBands = measured;
  conta.pubblicazioni++;
  if (republishLeft <= 0) return; // settled enough: the last numbers stay
  republishLeft--;
  view.dispatch(
    view.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
  );
}

function sameDomBands(a: DomBand[], b: DomBand[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.pos === y.pos && x.insertPos === y.insertPos && x.marginTop === y.marginTop
      && x.side === y.side && x.widthPx === y.widthPx && x.heightPx === y.heightPx
      && x.full === y.full;
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

/**
 * Contatori di sola lettura (17-09). Servono allo strumento di verifica per
 * sapere quali strade hanno davvero percorso il codice: quante volte la misura
 * e' stata chiesta, quante volte il codice ha pubblicato le fasce, quanti
 * aggiornamenti e quanti eventi sono arrivati. Non cambiano il comportamento.
 */
const conta = { misure: 0, pubblicazioni: 0, aggiornamenti: 0, metriche: 0, dipinto: 0 };

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
const REPUBLISH_BUDGET = 4;
let republishLeft = REPUBLISH_BUDGET;

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
      init: (_, state) => buildDecorations(state.doc, options.enabled(), getCassiePagedMode(), editorDom),
      apply: (tr, old, _oldState, newState) => {
        // The bands are re-published by the view after every paint, so a
        // rebuild is asked for with the same meta the metrics probe already
        // uses; nothing here reads the DOM.
        if (tr.getMeta("force-cassie-recompute")) {
          return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
        }
        if (!tr.docChanged) return old;
        republishLeft = REPUBLISH_BUDGET; // a new edit gets its own allowance
        return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
      },
    },

    view() {
      let dom: HTMLElement | null = null;
      const onMetricsChanged = () => {
        conta.metriche++;
        syncEditorMetricsFromDom(dom);
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
        update(view, prevState) {
          conta.aggiornamenti++;
          liveView = view;
          // A document that has just been REPLACED (opened, not edited) brings
          // its own allowance for the band measurement. Without this the budget
          // could already be spent by the previous document: the picture would
          // be on screen with no band under it, and the text would run through
          // it until the first keystroke or drag - measured: zero band pieces on
          // an opened document, three after typing a single character.
          // The recompute transactions this view dispatches do not change the
          // document, so they cannot renew the allowance: the loop stays bounded.
          if (prevState.doc !== view.state.doc) republishLeft = REPUBLISH_BUDGET;
          // F3.2c: measure the bands on the painted page and republish them when
          // they moved. Two paints settle it: the first places the picture with
          // its anchor, the second puts the band where the picture now is.
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
