// ============================================================================
// Element decoration — how far frame and shadow reach BEYOND the element's own
// box, per axis. The text that wraps around an element must keep clear of the
// frame and the shadow too, not just the photo (contract T1.4).
//
// Pure calculation, one place. Used by the page calculator, by the on-screen
// float margins and by the print sheets, so the three cannot disagree about
// how much room the decorations claim.
// ============================================================================

import { bearingToOffset, normalizeImageStyle } from "./image-style";

export interface DecorationExtent {
  /** Extra horizontal room needed, in px (one side). */
  x: number;
  /** Extra vertical room needed, in px (one side). */
  y: number;
}

const ZERO: DecorationExtent = { x: 0, y: 0 };

/**
 * Extent of frame + shadow beyond the element box.
 *
 * Frame is drawn as an `outline` around the whole unit (photo + caption), so it
 * reaches `borderWidth` outward on every side. The shadow is cast from the
 * frame's outer edge (its spread already includes the frame width, see
 * image-style) toward the side opposite the light: horizontally by `|dx|`, plus
 * half the blur.
 *
 * U3: the box joins in too, but only for its SHADOW: the image/figure frame is
 * an `outline` drawn OUTSIDE the unit, while the box's border is a normal
 * border inside its own width, so the box's border claims no extra room.
 */
export function elementDecorationExtent(
  attrs: Record<string, unknown> | undefined,
  typeName: string | undefined,
): DecorationExtent {
  const imageLike = typeName === "image" || typeName === "figure";
  const box = typeName === "styled_box";
  if (!imageLike && !box) return ZERO;
  const s = normalizeImageStyle(attrs ?? {});
  const borderWidth = s.borderWidth > 0 && s.borderStyle !== "none" ? s.borderWidth : 0;
  const frame = imageLike ? borderWidth : 0;
  let x = frame;
  let y = frame;
  if (s.shadowEnabled) {
    const { dx, dy } = bearingToOffset((s.shadowAngle + 180) % 360, s.shadowDistance);
    const spread = borderWidth; // matches computeImageBoxShadow
    x += Math.abs(dx) + s.shadowBlur / 2 + spread;
    y += Math.abs(dy) + s.shadowBlur / 2 + spread;
  }
  return { x, y };
}
