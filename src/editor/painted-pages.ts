// ============================================================================
// Painted pages — the ONE answer to "which page of the editor is this point on".
//
// The editor's page boundary is NOT the edge of a widget. Between two pages the
// pagination plugin inserts one widget that draws, in this order: the bottom
// margin of the page above, its footer, a separator LINE, the header of the next
// page and its top margin. So "which page is this point on" is decided by where
// inside that widget the point falls - and until now TWO modules answered it with
// two different rulers:
//  - the anchoring rule (`free-anchor-page.ts`) counted the SEPARATOR LINE: what
//    is above it is still the page before, which is what the reader sees as the
//    end of that page;
//  - the reservation splitter (`pagination-cassie-plugin.ts`) counted the
//    widget's BOX, so any point inside the widget - even its very top - already
//    belonged to the page below.
//
// This module keeps ONE answer, and it is the line: Carlo's decision of 28-09
// ("il confine è la linea tratteggiata"). Note what this module does NOT decide:
// which part of a reservation each page has to shorten is a question about a
// RANGE of lines, not about a point, and its answer is `areas` - the strip
// inside a widget holds no line at all, on paper as on screen. The two questions
// stay visibly separate here so nobody merges them by accident.
//
// Measured while writing this (28-09, `_tools/boundary-agreement.js` outside the
// project, 202.617 reservations across three widgets): with the clip in
// `bandPieces` in place, the two rulers never produced a different set of pieces.
// So unifying them changes no number that is shipped today; what it removes is
// the drift - the first caller that uses "which page" to decide something that is
// shipped would have found two answers.
// ============================================================================

/** A vertical range in the editor host's OWN layout units, never visual pixels. */
export interface PaintedRange {
  top: number;
  bottom: number;
}

/** The painted pages of the editor, measured in one walk of the page. */
export interface PaintedPages {
  /**
   * The lines of each painted page, one range per page, in the same order as
   * the sheets. The gap between two ranges is a page-break widget: white space
   * on paper, with no line to shorten.
   */
  areas: PaintedRange[];
  /** False when the editor draws no boundary at all (continuous mode). */
  bounded: boolean;
  /**
   * Which painted page (0-based, the same numbering the sheets use) holds this
   * host-relative point. The boundary is the separator LINE inside the widget.
   */
  pageOf(top: number): number;
}

/**
 * Measure the painted pages once: the line ranges and the page boundaries.
 *
 * @param host  the editor's scrollable element (`view.dom`)
 * @param scale the magnification ACTUALLY applied to it (`appliedScale`): the
 *              rectangles come from `getBoundingClientRect`, so they have to be
 *              divided back into the page's own units before anyone stores or
 *              compares them with document numbers.
 */
export function measurePaintedPages(host: HTMLElement, scale: number): PaintedPages {
  const hostTop = host.getBoundingClientRect().top;
  const rel = (el: HTMLElement): PaintedRange => {
    const r = el.getBoundingClientRect();
    return { top: (r.top - hostTop) / scale, bottom: (r.bottom - hostTop) / scale };
  };
  const widgets = Array.from(host.querySelectorAll<HTMLElement>(".aw-page-break"))
    .map((widget) => ({
      box: rel(widget),
      // Without a line (older markup) the box top is the best answer there is,
      // which is what the anchoring rule already did on its own.
      line: rel(widget.querySelector<HTMLElement>(".aw-page-break-separator, .aw-page-break-line") ?? widget),
    }))
    .sort((a, b) => a.box.top - b.box.top);

  const areas: PaintedRange[] = [];
  let cursor = 0;
  for (const w of widgets) {
    areas.push({ top: cursor, bottom: w.box.top });
    cursor = w.box.bottom;
  }
  areas.push({ top: cursor, bottom: Number.MAX_SAFE_INTEGER });

  // Ascending, because `pageOf` walks the boundaries in order and stops at the
  // first one below the point. Sorting by the LINE, not by the box, keeps the
  // rule honest even if a widget's line were reported out of the box order.
  const lineTops = widgets.map((w) => w.line.top).sort((a, b) => a - b);
  const pageOf = (top: number): number => {
    let page = 0;
    for (const line of lineTops) {
      if (line <= top) page++;
      else break;
    }
    return page;
  };

  return { areas, bounded: widgets.length > 0, pageOf };
}
