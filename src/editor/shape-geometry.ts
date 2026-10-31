// ============================================================================
// Shape geometry — from the parameters and the box to the points that are
// drawn, and from a hand's movement to new parameters.
//
// Pure: no DOM, so the same points serve the screen and the markup, and a
// preview cannot disagree with the page. It is also the place where a gesture
// becomes numbers, so the view only has to say WHICH handle moved and by how
// much.
//
// The box HUGS the shape (drawn-shapes-project §6): the stroke's outline stays
// inside it, which is why everything is inset by half a stroke. The handles sit
// on the shape's own vertices, never on the box's corners.
// ============================================================================

import {
  MAX_SHAPE_WIDTH_PX,
  MAX_STROKE_WIDTH_PX,
  MIN_HEAD_SIZE_PX,
  MIN_SHAPE_BODY_PX,
  MIN_SHAPE_WIDTH_PX,
  MIN_STROKE_WIDTH_PX,
  type ShapeBox,
  type ShapeParams,
} from "./shape-params";

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeGeometry {
  /** The straight stroke, when the shape has one. */
  shaft: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The outline of the filled head, as a triangle; null for a plain line. */
  head: [number, number][] | null;
}

/** Where the shape's own handles sit, in the box's coordinates. */
export interface ShapeAnchors {
  /** The tip (vertex A): its own handle, and the arrow's pivot. */
  tip: ShapePoint;
  /** The head's top vertex (B); the base handle. */
  base: ShapePoint;
  /** The head's bottom vertex (C); the same gesture as B, mirrored. */
  mirror: ShapePoint;
  /** The tail end of the body: lengthens it, and thickens the stroke. */
  body: ShapePoint;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Half a stroke: the air the drawing must keep from the box's edges. */
export function shapeStrokeInset(params: ShapeParams, box: ShapeBox): number {
  return Math.min(params.strokeWidth / 2, Math.min(box.width, box.height) / 2);
}

/** The length of the head that the current box can actually contain. */
function headLengthOf(params: ShapeParams, box: ShapeBox, inset: number): number {
  const tipX = box.width - inset;
  const longest = Math.max(MIN_HEAD_SIZE_PX, tipX - inset - MIN_SHAPE_BODY_PX);
  return clamp(params.headSize, MIN_HEAD_SIZE_PX, Math.min(longest, MAX_SHAPE_WIDTH_PX));
}

/** The points of one shape inside its own box. */
export function shapeGeometry(params: ShapeParams, box: ShapeBox): ShapeGeometry {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const inset = shapeStrokeInset(params, { width, height });
  const midY = height / 2;

  if (params.kind === "line") {
    return { shaft: { x1: inset, y1: midY, x2: width - inset, y2: midY }, head: null };
  }

  const tipX = width - inset;
  const baseX = tipX - headLengthOf(params, { width, height }, inset);
  const top = Math.min(inset, midY);
  const bottom = Math.max(height - inset, midY);
  return {
    shaft: { x1: inset, y1: midY, x2: baseX, y2: midY },
    head: [
      [tipX, midY],
      [baseX, top],
      [baseX, bottom],
    ],
  };
}

/**
 * The points the handles are placed on: the shape's own vertices, plus the tail
 * end of the body. A handle that is not on the drawing would be a handle on a
 * box, and the arrow has no box to grab.
 */
export function shapeHandleAnchors(params: ShapeParams, box: ShapeBox): ShapeAnchors {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const inset = shapeStrokeInset(params, { width, height });
  const midY = height / 2;
  if (params.kind === "line") {
    return {
      tip: { x: width - inset, y: midY },
      base: { x: width - inset, y: midY },
      mirror: { x: inset, y: midY },
      body: { x: inset, y: midY },
    };
  }
  const tipX = width - inset;
  const baseX = tipX - headLengthOf(params, { width, height }, inset);
  return {
    tip: { x: tipX, y: midY },
    base: { x: baseX, y: Math.min(inset, midY) },
    mirror: { x: baseX, y: Math.max(height - inset, midY) },
    body: { x: inset, y: midY },
  };
}

/** One shape's numbers after a gesture. */
export interface ShapeState {
  params: ShapeParams;
  box: ShapeBox;
}

/** Keep the head inside the box after any change of the box or the stroke. */
function fitHead(state: ShapeState): ShapeState {
  if (state.params.kind === "line") return state;
  const inset = shapeStrokeInset(state.params, state.box);
  const headSize = headLengthOf(state.params, state.box, inset);
  return headSize === state.params.headSize
    ? state
    : { params: { ...state.params, headSize }, box: state.box };
}

/**
 * The TIP handle: dragging it along the axis makes the head longer or shorter
 * and moves the box's right edge with it; the base of the head does not move.
 */
export function dragShapeTip(start: ShapeState, dx: number): ShapeState {
  const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const headSize = Math.round(start.params.headSize + dx);
  return fitHead({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, headSize },
  });
}

/**
 * The BASE handle (on B, or on C): the head widens or narrows symmetrically,
 * one vertex each side. `outward` is how far the grabbed vertex moved away from
 * the axis, in page units.
 */
export function dragShapeHead(start: ShapeState, outward: number): ShapeState {
  const minHeight = Math.max(start.params.strokeWidth + 2, 4);
  const height = clamp(start.box.height + 2 * outward, minHeight, MAX_SHAPE_WIDTH_PX);
  return fitHead({
    box: { width: start.box.width, height: Math.round(height) },
    params: start.params,
  });
}

/**
 * The BODY handle: horizontally the whole shape gets longer or shorter,
 * vertically the stroke gets thicker or thinner. The head keeps its length, so
 * the shaft is what changes.
 */
export function dragShapeBody(start: ShapeState, dx: number, dy: number): ShapeState {
  const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  // A stroke thicker than the head would spill over its contour.
  const maxStroke =
    start.params.kind === "line"
      ? MAX_STROKE_WIDTH_PX
      : Math.max(MIN_STROKE_WIDTH_PX, Math.min(MAX_STROKE_WIDTH_PX, start.box.height - 2));
  const strokeWidth = clamp(start.params.strokeWidth + dy, MIN_STROKE_WIDTH_PX, maxStroke);
  const box: ShapeBox =
    start.params.kind === "line"
      ? { width: Math.round(width), height: Math.round(strokeWidth) }
      : { width: Math.round(width), height: start.box.height };
  return fitHead({ box, params: { ...start.params, strokeWidth: Math.round(strokeWidth) } });
}
