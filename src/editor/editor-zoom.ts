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
// the scrollbar stay correct. Layout units (offsetTop/offsetWidth, and every
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

/** Store the factor and re-apply the transform + scroll area. */
export function applyEditorZoom(percent: number): void {
  zoom = Math.max(0.5, Math.min(2, percent / 100));
  syncEditorZoom(currentParts);
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
  mount.style.width = `${baseWidth}px`;
  mount.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
  mount.style.transformOrigin = "top left";
  sizer.style.width = `${Math.round(baseWidth * zoom)}px`;
  sizer.style.height = `${Math.round(mount.offsetHeight * zoom)}px`;
}
