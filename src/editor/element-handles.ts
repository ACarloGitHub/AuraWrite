// ============================================================================
// Element handles — the ONE place where a pointer turns an element.
//
// The rotation gesture used to live twice, byte for byte, in the image and the
// figure node views (~50 lines each, different only in which element they
// paint). The box had no handle at all, so giving it one meant a third copy of
// a rule that has to stay in step across all of them. It lives here now: one
// way to drag a rotation, for every element that has one - the box included,
// and the drawn shapes that come after it.
//
// Behaviour is deliberately what the two copies always did, because the whole
// point is that nothing visible changes for images and figures:
//  - the angle is read off the centre of the PAINTED box, which is what the
//    turn pivots on (law L2: the centre decides which page the element lands
//    on, so it must not move);
//  - the live turn paints on the element itself and nowhere else (law L3: the
//    rotation is written in one place, not in a wrapper too);
//  - the number reaches the document only when the pointer is released, and
//    only as whole degrees, normalised to 0-359.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import { transformWithRotation } from "./element-view";

/** Class of the shared rotation handle (styled in `05-document.css`). */
export const ROTATE_HANDLE_CLASS = "aw-rotate-handle";

/** True when a pointer event lands on the rotation handle. */
export function isRotateHandle(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.classList.contains(ROTATE_HANDLE_CLASS);
}

/**
 * Build the rotation handle and hang it on the element that carries the turn.
 *
 * `title` is optional on purpose: images and figures never had a tooltip on
 * this handle, so they keep none, while an element gaining the handle for the
 * first time (the box) can explain itself.
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
 * @param view    the editor (the turn is committed through one transaction)
 * @param getPos  where the element lives, re-read at release like every other write
 * @param painted the element carrying the CSS transform - the same box whose
 *                centre the turn pivots on, so the handle and the paint cannot
 *                disagree about where the element is
 * @param event   the mousedown that grabbed the handle
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
