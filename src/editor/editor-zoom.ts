// ============================================================================
// Editor zoom — a PURELY VISUAL magnification (scale), never a layout change.
//
// The editor used the CSS `zoom` property, which redefines the CSS pixel: it
// can shrink the page's logical width and reflow the text, and it makes every
// measurement come out in a different unit depending on the zoom. Zoom must
// only make things look bigger.
//
// Here the page keeps its layout size and is scaled with a transform; a sizer
// element gives the scroll container the scaled dimensions, so scrolling and
// the scrollbar stay correct. The sizer is exactly the visual page - never the
// editor's width scaled - and the page is shifted inside it so it stays
// centred: a sheet narrower than the window must not drift to the right, and a
// horizontal scrollbar must appear only when the sheet is really wider.
// Layout units (offsetTop/offsetWidth, and every
// position written into the page) are the page's own and never depend on the
// zoom; only `getBoundingClientRect`/`coordsAtPos` are in visual units, and
// callers that cross the border convert with `appliedScale()` - measured on the
// page, never with the number the user asked for. That number stays private here:
// it exists to set the transform, and handing it out is how a document size ends up
// depending on the way the document is being looked at.
// ============================================================================

export interface EditorZoomParts {
  /** The scroll container (#editor). */
  host: HTMLElement;
  /** The element that reserves the scaled area for the scroll container. */
  sizer: HTMLElement;
  /** The element the page lives in; carries the transform. */
  mount: HTMLElement;
}

let zoom = 1;
let currentParts: EditorZoomParts | null = null;
let scheduled = 0;

/**
 * Breathing space the sheet keeps on both sides once it is wider than the
 * editor, so the page never touches the edge of the scroll area.
 */
const SHEET_EDGE = 24;

/** Store the elements the zoom works on (called once, after the boot). */
export function setEditorZoomParts(parts: EditorZoomParts | null): void {
  currentParts = parts;
}

/**
 * The magnification ACTUALLY applied to an element of the page, measured from the
 * element itself: its painted width over its layout width.
 *
 * `getEditorZoom()` is what the user asked for; this is what the browser really did.
 * They are normally the same number, but a document number must never be derived from
 * an intention: the one legal crossing from visual units into document units is a
 * division by this measurement, used by every caller - so a gesture, the bands it
 * paints and the numbers in the toolbar all convert with the same ruler, and the
 * visual magnification cannot leak into the document (Carlo, 2026-09-15: "lo zoom deve
 * essere solo un modo di visualizzare il documento").
 */
export function appliedScale(host: HTMLElement): number {
  const painted = host.getBoundingClientRect().width;
  return host.offsetWidth > 0 ? painted / host.offsetWidth : 1;
}

/**
 * The page that lives in the mount and whether it carries a width of its own -
 * the paged sheet, in whatever page format - instead of filling the editor.
 * The class is the same one the stylesheet uses to give the sheet that width.
 */
function pageIn(mount: HTMLElement): { el: HTMLElement; sheet: boolean } | null {
  const el = mount.firstElementChild;
  if (!(el instanceof HTMLElement)) return null;
  return { el, sheet: el.classList.contains("is-cassie-paged") };
}

/** Store the factor and re-apply the transform + scroll area. */
export function applyEditorZoom(percent: number): void {
  const next = Math.max(0.5, Math.min(2, percent / 100));
  const host = currentParts?.host ?? null;
  const top = host?.scrollTop ?? 0;
  const left = host?.scrollLeft ?? 0;
  const previous = zoom;
  zoom = next;
  syncEditorZoom(currentParts);
  // Changing the magnification must not move the reading position: the layout
  // point under the corner of the viewport keeps its distance in document
  // units, so the same text stays at the top and at the left of the view.
  if (host && next !== previous) {
    host.scrollTop = Math.round((top * next) / previous);
    host.scrollLeft = Math.round((left * next) / previous);
  }
}

/**
 * Coalesce a re-sync into the NEXT frame. Writing sizes from inside a
 * ResizeObserver callback makes the observer fire again in the same delivery
 * ("loop completed with undelivered notifications"); deferring the writes
 * breaks the cycle and the sync is idempotent once the numbers settle.
 */
export function scheduleEditorZoomSync(): void {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    syncEditorZoom(currentParts);
  });
}

/**
 * Re-sync the transform and the scrollable area. Called on zoom changes, on
 * window resize and whenever the page changes height.
 */
export function syncEditorZoom(parts: EditorZoomParts | null): void {
  if (!parts) return;
  const { host, sizer, mount } = parts;
  const baseWidth = Math.max(1, host.clientWidth);
  const page = pageIn(mount);
  // The sheet has a width of its own (the page format); the continuous page
  // fills the editor, so its width is the editor's. A hidden page (code mode)
  // measures zero and falls back to the editor's width: the zoom must not
  // collapse the box that holds it.
  const sheetWidth = page ? page.el.offsetWidth : 0;
  const pageWidth = page?.sheet && sheetWidth > 0 ? sheetWidth : baseWidth;
  // The mount is exactly as wide as the page, so its scaled box is the visual
  // page and nothing else: the empty side margins of a narrow sheet would
  // otherwise widen the scroll area and summon a scrollbar that nothing needs.
  if (mount.style.width !== `${pageWidth}px`) mount.style.width = `${pageWidth}px`;
  const visualWidth = pageWidth * zoom;
  const overflow = visualWidth > baseWidth;
  const sizerWidth = Math.max(
    baseWidth,
    Math.round(visualWidth + (page?.sheet && overflow ? 2 * SHEET_EDGE : 0)),
  );
  // While the sheet fits, it is centred in the view; once it is wider, it keeps
  // a margin and the horizontal scrollbar becomes a real one. At 100% the shift
  // is plain margin, so the page is laid out exactly as it is without zoom (no
  // compositing layer, no half-pixel text); above and below it, the shift comes
  // after the scale and therefore cannot depend on the zoom.
  const left = (sizerWidth - visualWidth) / 2;
  if (zoom === 1) {
    mount.style.transform = "";
    mount.style.marginLeft = `${Math.round(left)}px`;
  } else {
    mount.style.transform = `translateX(${left}px) scale(${zoom})`;
    mount.style.marginLeft = "0px";
  }
  mount.style.transformOrigin = "top left";
  sizer.style.width = `${sizerWidth}px`;
  sizer.style.height = `${Math.round(mount.offsetHeight * zoom)}px`;
}
