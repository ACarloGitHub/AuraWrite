// ============================================================================
// Shape geometry — from the parameters and the box to the points that are
// drawn, and from a hand's movement to new parameters.
//
// Pure: no DOM, so the same points serve the screen and the markup, and a
// preview cannot disagree with the page. It is also the place where a gesture
// becomes numbers, so the view only has to say WHICH handle moved and by how
// much.
//
// The ARROW is one closed outline: a rectangle (the body) with a triangle (the
// head) in front of it, the head being taller than the body. The inside of that
// outline is the FILL; the contour around it is the STROKE. The box HUGS the
// drawing (§6), which is why everything is inset by half a stroke; the handles
// sit on the drawing's own corners, never on the box's.
// ============================================================================

import {
  MAX_SHAPE_WIDTH_PX,
  MIN_BODY_HEIGHT_PX,
  MIN_HEAD_SIZE_PX,
  MIN_SHAPE_BODY_PX,
  MIN_SHAPE_WIDTH_PX,
  type ShapeBox,
  type ShapeParams,
} from "./shape-params";

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeGeometry {
  /** A plain line's stroke; null for a closed shape. */
  shaft: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The closed outline of the arrow (body + head); null for a plain line. */
  outline: [number, number][] | null;
}

/** Where the shape's own handles sit, in the box's coordinates. */
export interface ShapeAnchors {
  /** The tip (vertex A): its own handle, and the arrow's pivot. */
  tip: ShapePoint;
  /** The head's top rear corner; dragging it widens the head. */
  base: ShapePoint;
  /** The head's bottom rear corner; the same gesture as `base`, mirrored. */
  mirror: ShapePoint;
  /** The body's top-left corner: its height, and the whole shape's length. */
  body: ShapePoint;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Half a stroke: the air the drawing must keep from the box's edges. */
export function shapeStrokeInset(params: ShapeParams, box: ShapeBox): number {
  return Math.min(params.strokeWidth / 2, Math.min(box.width, box.height) / 2);
}

/** Half the body's height, kept inside the head and inside the stroke. */
function bodyHalfHeight(params: ShapeParams, box: ShapeBox, inset: number): number {
  const room = Math.max(1, box.height - 2 * inset);
  return clamp(params.bodyHeight, MIN_BODY_HEIGHT_PX, room) / 2;
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
    return { shaft: { x1: inset, y1: midY, x2: width - inset, y2: midY }, outline: null };
  }

  const tipX = width - inset;
  const baseX = tipX - headLengthOf(params, { width, height }, inset);
  const half = bodyHalfHeight(params, { width, height }, inset);
  const top = Math.min(inset, midY);
  const bottom = Math.max(height - inset, midY);
  return {
    shaft: null,
    outline: [
      [inset, midY - half],
      [baseX, midY - half],
      [baseX, top],
      [tipX, midY],
      [baseX, bottom],
      [baseX, midY + half],
      [inset, midY + half],
    ],
  };
}

/**
 * The points the handles are placed on: the drawing's own corners. A handle that
 * is not on the drawing would be a handle on a box, and an arrow has no box to
 * grab.
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
  const half = bodyHalfHeight(params, { width, height }, inset);
  return {
    tip: { x: tipX, y: midY },
    base: { x: baseX, y: Math.min(inset, midY) },
    mirror: { x: baseX, y: Math.max(height - inset, midY) },
    body: { x: inset, y: midY - half },
  };
}

/** One shape's numbers after a gesture. */
export interface ShapeState {
  params: ShapeParams;
  box: ShapeBox;
}

/**
 * The result of one handle's gesture: the new numbers, plus how far the box's
 * own top-left corner must move (in page units, along the shape's x axis) so the
 * end that must not move stays put. Zero for every handle but the body's.
 */
export interface ShapeDrag extends ShapeState {
  shiftX: number;
}

/** Keep the head inside the box after any change of the box or the stroke. */
function fit(state: ShapeState): ShapeState {
  if (state.params.kind === "line") return state;
  const inset = shapeStrokeInset(state.params, state.box);
  const headSize = headLengthOf(state.params, state.box, inset);
  const room = Math.max(MIN_BODY_HEIGHT_PX, state.box.height - 2 * inset);
  const bodyHeight = clamp(state.params.bodyHeight, MIN_BODY_HEIGHT_PX, room);
  if (headSize === state.params.headSize && bodyHeight === state.params.bodyHeight) return state;
  return { params: { ...state.params, headSize, bodyHeight }, box: state.box };
}

/**
 * The TIP handle: dragging it along the axis makes the head longer or shorter
 * and moves the box's right edge with it; the head's rear corners do not move.
 */
export function dragShapeTip(start: ShapeState, dx: number): ShapeDrag {
  const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const headSize = Math.round(start.params.headSize + dx);
  const state = fit({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, headSize },
  });
  return { ...state, shiftX: 0 };
}

/**
 * The HEAD handles (the two rear corners): the head widens or narrows
 * symmetrically, one corner each side. `outward` is how far the grabbed corner
 * moved away from the axis, in page units.
 */
export function dragShapeHead(start: ShapeState, outward: number): ShapeDrag {
  const minHeight = Math.max(start.params.strokeWidth + 2, 4);
  const height = clamp(start.box.height + 2 * outward, minHeight, MAX_SHAPE_WIDTH_PX);
  const state = fit({
    box: { width: start.box.width, height: Math.round(height) },
    params: start.params,
  });
  return { ...state, shiftX: 0 };
}

/**
 * The BODY handle (the rectangle's top-left corner).
 *
 * Vertically it makes the body thicker or thinner, symmetrically around the
 * axis, so the grabbed corner follows the hand. Horizontally it moves the REAR
 * end: the shape gets longer or shorter and the tip stays where it is — which is
 * why the box's own corner must travel with the hand, and `shiftX` says by how
 * much.
 *
 * The stroke is not touched: its thickness belongs to the Th command, not to a
 * handle that resizes the drawing.
 */
export function dragShapeBody(start: ShapeState, dx: number, dy: number): ShapeDrag {
  const width = clamp(start.box.width - dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const inset = shapeStrokeInset(start.params, start.box);
  const room = Math.max(MIN_BODY_HEIGHT_PX, start.box.height - 2 * inset);
  const bodyHeight = clamp(start.params.bodyHeight - 2 * dy, MIN_BODY_HEIGHT_PX, room);
  const state = fit({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, bodyHeight: Math.round(bodyHeight) },
  });
  // Only the part of the run that actually changed the width may move the box:
  // pushing against the minimum must not slide the shape.
  const applied = start.box.width - state.box.width;
  return { ...state, shiftX: applied };
}
