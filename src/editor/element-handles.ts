// ============================================================================
// Element handles — the ONE place where a pointer reshapes an element.
//
// Two gestures live here, because each of them used to be written twice, once
// per node view, and a rule written twice drifts:
//
//  - TURNING an element (`startRotateDrag`, created 2026-09-15 for voice U7.1):
//    the image and the figure each had ~50 identical lines, and the box had no
//    handle at all, so giving the box one meant a third copy.
//  - RESIZING from a corner (`startCornerResize`, voice U7.3, the same day):
//    reading the two copies side by side showed they had ALREADY drifted - see
//    "the drift" below. That is the whole argument for this file, stated as a
//    fact instead of a warning.
//
// What is deliberately NOT here: which element each view paints and which
// attributes the size or the angle is written into. The gesture is shared; the
// data stays with the element that owns it. The box's single width handle is
// not here either: it has no second axis (its height is the text's, Carlo's
// decision of 2026-09-15), so it keeps its own small rule and shares the
// helpers that make it honest - `pointerInElementAxes` and the measured zoom.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { appliedScale } from "./editor-zoom";
import { pointerInElementAxes, transformWithRotation } from "./element-view";

// ---------------------------------------------------------------------------
// The corner handles: resize
// ---------------------------------------------------------------------------

/** The four corners, named as the stylesheet names them. */
export const CORNER_HANDLES = ["tl", "tr", "bl", "br"] as const;

export type Corner = (typeof CORNER_HANDLES)[number];

/**
 * Class of the corner handles. The name says "image" and is kept on purpose:
 * the figure has been reusing the image's rules since the single-element engine
 * (U1-U6), the stylesheet speaks that name, and renaming it would move six
 * rules to change nothing on screen - the stylesheet reorder's own law says a
 * rename is not part of a reorganisation. The drawn shapes will hang their own
 * handles next to these; the name can be settled then, in one pass.
 */
const CORNER_CLASS = "image-resize-handle";

/** Smallest size a handle may drive an element to, in page units. */
const MIN_WIDTH_PX = 50;
const MIN_HEIGHT_PX = 20;

/** True when a pointer event lands on a corner handle. */
export function isCornerHandle(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.classList.contains(CORNER_CLASS);
}

/** Create the four corner handles on `host`; `onCorner` gets each mousedown. */
export function createCornerHandles(
  host: HTMLElement,
  onCorner: (event: MouseEvent, corner: Corner) => void
): HTMLElement[] {
  const handles: HTMLElement[] = [];
  for (const corner of CORNER_HANDLES) {
    const handle = document.createElement("div");
    handle.className = `${CORNER_CLASS} ${CORNER_CLASS}--${corner}`;
    handle.addEventListener("mousedown", (e) => onCorner(e, corner));
    host.appendChild(handle);
    handles.push(handle);
  }
  return handles;
}

export interface CornerResize {
  view: EditorView;
  getPos: () => number | undefined;
  event: MouseEvent;
  corner: Corner;
  /** The size the element has NOW, in page units (its own photo box). */
  startWidth: number;
  startHeight: number;
  /** Ratio (height / width) to fall back on before any size is stored. */
  naturalRatio: number;
  /** Overrides for the minimum sizes, in page units. */
  minWidthPx?: number;
  minHeightPx?: number;
  /** Paint the running size while the pointer moves. */
  paint: (widthPx: number, heightPx: number) => void;
  /** Write the size into the document, once, at release. */
  commit: (widthPx: number, heightPx: number) => void;
}

/**
 * Drag a corner: the element follows the hand, along its OWN axes.
 *
 * **The drift this function ends.** After the per-corner signs, BOTH growth
 * numbers mean "bigger", so the direction of a locked (proportional) resize can
 * only be the sign of their SUM. The figure did that. The image had a second
 * branch that SUBTRACTED them for the top-right and bottom-left corners, so
 * with the proportions locked and the pointer running mostly up or down, those
 * two corners moved the photo the OPPOSITE way to the hand. Nobody had seen it
 * because the FR chapter's proofs deliberately UNLOCKED the proportions: a
 * locked resize pulled vertically was never tested. One rule survives: the sum.
 *
 * The two laws the gesture obeys are the same the rest of the engine obeys: the
 * pointer's run is divided by the magnification MEASURED on the page (L5) and
 * only then turned onto the element's axes (L4).
 */
export function startCornerResize(opts: CornerResize): void {
  const { view, getPos, event, corner, startWidth, startHeight, naturalRatio, paint, commit } =
    opts;
  const minWidth = opts.minWidthPx ?? MIN_WIDTH_PX;
  const minHeight = opts.minHeightPx ?? MIN_HEIGHT_PX;

  event.preventDefault();
  event.stopPropagation();
  const pos = getPos();
  if (pos == null) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const aspectLocked = node.attrs.aspectLocked !== false;
  const startX = event.clientX;
  const startY = event.clientY;
  const ratio = startHeight / startWidth || naturalRatio;
  const zoom = appliedScale(view.dom) || 1;
  const rotation = (node.attrs.rotation as number) || 0;

  const computeNewSize = (ev: MouseEvent): { width: number; height: number } => {
    // Divided by the zoom FIRST, then turned onto the element's own axes (defect 13).
    const turned = pointerInElementAxes(
      (ev.clientX - startX) / zoom,
      (ev.clientY - startY) / zoom,
      rotation
    );
    // After these two signs, both numbers mean "bigger", whichever corner is held.
    const growX = corner === "tl" || corner === "bl" ? -turned.dx : turned.dx;
    const growY = corner === "tl" || corner === "tr" ? -turned.dy : turned.dy;
    const width = Math.max(minWidth, startWidth + growX);
    const height = Math.max(minHeight, startHeight + growY);
    if (!aspectLocked) return { width, height };
    const travel = (Math.abs(growX) + Math.abs(growY)) / 2;
    const newWidth = Math.max(minWidth, startWidth + (growX + growY >= 0 ? travel : -travel));
    return { width: newWidth, height: Math.round(newWidth * ratio) };
  };

  const onMove = (ev: MouseEvent) => {
    const { width, height } = computeNewSize(ev);
    paint(width, height);
  };
  const onUp = (ev: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const { width, height } = computeNewSize(ev);
    commit(Math.round(width), Math.round(height));
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// ---------------------------------------------------------------------------
// The rotation handle: turn
// ---------------------------------------------------------------------------

/** Class of the shared rotation handle (styled in `05-document.css`). */
export const ROTATE_HANDLE_CLASS = "aw-rotate-handle";

/** True when a pointer event lands on the rotation handle. */
export function isRotateHandle(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.classList.contains(ROTATE_HANDLE_CLASS);
}

/**
 * Build the rotation handle and hang it on the element that carries the turn.
 *
 * `title` is optional on purpose: images and figures never had a tooltip on this
 * handle and keep none, while an element gaining it for the first time (the box)
 * can explain itself.
 */
export function createRotateHandle(
  painted: HTMLElement,
  onStart: (event: MouseEvent) => void,
  title?: string
): HTMLElement {
  const handle = document.createElement("div");
  handle.className = ROTATE_HANDLE_CLASS;
  if (title) handle.title = title;
  handle.addEventListener("mousedown", onStart);
  painted.appendChild(handle);
  return handle;
}

/**
 * Start a rotation drag.
 *
 * Behaviour is what the two copies always did, so that nothing visible changes
 * for images and figures: the angle is read off the centre of the PAINTED box
 * (law L2 - the centre is what decides the page, so it must not move), it is
 * painted on the element that already carries the transform (law L3 - one place,
 * not a wrapper too), and it reaches the document only when the pointer is
 * released, in whole degrees normalised to 0-359.
 */
export function startRotateDrag(
  view: EditorView,
  getPos: () => number | undefined,
  painted: HTMLElement,
  event: MouseEvent
): void {
  event.preventDefault();
  event.stopPropagation();
  const pos = getPos();
  if (pos == null) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;

  const rect = painted.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  /** The pointer's bearing from the centre, in whole degrees, 0-359. */
  const computeRotation = (ev: MouseEvent): number => {
    const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI) + 90;
    return ((Math.round(angle) % 360) + 360) % 360;
  };

  const onMove = (ev: MouseEvent) => {
    painted.style.transform = transformWithRotation(
      computeRotation(ev),
      node.attrs.flipH as boolean,
      node.attrs.flipV as boolean
    );
  };

  const onUp = (ev: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const deg = computeRotation(ev);
    try {
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, rotation: deg })
      );
    } catch {
      /* schema drift during the turn: the document keeps the angle it had */
    }
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}
