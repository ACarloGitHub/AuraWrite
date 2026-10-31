// ============================================================================
// Shape geometry (chapter A, step S1) — from the parameters and the box to the
// points that are drawn. Pure: no DOM, so the same points serve the screen and
// the markup, and a preview cannot disagree with the page.
//
// The box HUGS the shape (drawn-shapes-project §6): the line and the arrow head
// touch the box's own edges, so the room the text keeps clear and the element
// that is seen are the same rectangle.
// ============================================================================

import type { ShapeBox, ShapeParams } from "./shape-params";

export interface ShapeGeometry {
  /** The straight stroke, when the shape has one. */
  shaft: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The filled head, as a triangle; null for a plain line. */
  head: [number, number][] | null;
}

/**
 * The points of one shape inside its own box.
 *
 * @param params the shape's numbers (kind, stroke, head length)
 * @param box    the size of the box the shape is drawn in
 */
export function shapeGeometry(params: ShapeParams, box: ShapeBox): ShapeGeometry {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const stroke = Math.max(1, params.strokeWidth);
  // Half the stroke is the air a line must keep at its ends: the box's edge
  // cuts nothing, so the tip stays whole when the shape touches the border.
  const pad = Math.min(stroke / 2, Math.min(width, height) / 2);
  const midY = height / 2;

  if (params.kind === "line") {
    return { shaft: { x1: pad, y1: midY, x2: width - pad, y2: midY }, head: null };
  }

  // The head's LENGTH is its own number; its WIDTH is the box's height (§6).
  // Clamped so a very long head can never eat the whole shaft.
  const headLength = Math.max(stroke * 2, Math.min(params.headSize, width * 0.8));
  const baseX = Math.max(pad, width - headLength);
  return {
    shaft: { x1: pad, y1: midY, x2: baseX, y2: midY },
    head: [
      [width, midY],
      [baseX, 0],
      [baseX, height],
    ],
  };
}
