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
// callers that cross the border convert with `getEditorZoom()`.
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

/** The current magnification (1 = 100%), for callers mixing units. */
export function getEditorZoom(): number {
  return zoom;
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
