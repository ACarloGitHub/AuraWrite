// ============================================================================
// Shape geometry — from the parameters and the box to the points that are
// drawn, and from a hand's movement to new parameters.
//
// Pure: no DOM, so the same points serve the screen and the markup, and a
// preview cannot disagree with the page. It is also the place where a gesture
// becomes numbers, so the view only has to say WHICH handle moved and by how
// much.
//
// Every closed shape is ONE outline: the inside is the FILL, the contour is the
// STROKE, and the box HUGS the drawing (§6) — which is why everything is inset
// by half a stroke. The handles sit on the drawing's own corners.
//
//   line         a stroke
//   arrow        body rectangle + head (the head is taller than the body)
//   arrow_both   the same with a head at each end
//   ellipse      a closed ellipse filling the box, four handles on its extremes
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

/** The parts of a drawing a pointer can reshape, one name per corner it has. */
export const SHAPE_PARTS = ["tip", "rear", "base", "mirror", "body", "east", "west", "north", "south"] as const;

export type ShapePart = (typeof SHAPE_PARTS)[number];

export type ShapeAnchors = Partial<Record<ShapePart, ShapePoint>>;

export interface ShapeGeometry {
  /** A plain line's stroke; null for a closed shape. */
  shaft: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The closed outline; null for a plain line. */
  outline: [number, number][] | null;
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
  const room = Math.max(MIN_BODY_HEIGHT_PX, box.height - 2 * inset);
  return clamp(params.bodyHeight, MIN_BODY_HEIGHT_PX, room) / 2;
}

/** The length of one head: two heads must share the room behind the tips. */
function headLengthOf(params: ShapeParams, box: ShapeBox, inset: number): number {
  const tipX = box.width - inset;
  const heads = params.kind === "arrow_both" ? 2 : 1;
  const longest = Math.max(MIN_HEAD_SIZE_PX, (tipX - inset - MIN_SHAPE_BODY_PX) / heads);
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

  if (params.kind === "ellipse") {
    const cx = width / 2;
    const cy = height / 2;
    const rx = Math.max(0.5, width / 2 - inset);
    const ry = Math.max(0.5, height / 2 - inset);
    const points: [number, number][] = [];
    const steps = 72;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    return { shaft: null, outline: points };
  }

  const headLength = headLengthOf(params, { width, height }, inset);
  const half = bodyHalfHeight(params, { width, height }, inset);

  if (params.kind === "arrow") {
    const tipX = width - inset;
    const baseX = tipX - headLength;
    return {
      shaft: null,
      outline: [
        [inset, midY - half],
        [baseX, midY - half],
        [baseX, inset],
        [tipX, midY],
        [baseX, height - inset],
        [baseX, midY + half],
        [inset, midY + half],
      ],
    };
  }

  // arrow_both: two heads, one at each end, and the body between them.
  const leftTip = inset;
  const rightTip = width - inset;
  const leftBase = leftTip + headLength;
  const rightBase = rightTip - headLength;
  return {
    shaft: null,
    outline: [
      [leftTip, midY],
      [leftBase, inset],
      [leftBase, midY - half],
      [rightBase, midY - half],
      [rightBase, inset],
      [rightTip, midY],
      [rightBase, height - inset],
      [rightBase, midY + half],
      [leftBase, midY + half],
      [leftBase, height - inset],
    ],
  };
}

/** The points the handles are placed on: the drawing's own corners. */
export function shapeHandleAnchors(params: ShapeParams, box: ShapeBox): ShapeAnchors {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const inset = shapeStrokeInset(params, { width, height });
  const midY = height / 2;

  if (params.kind === "line") return {};

  if (params.kind === "ellipse") {
    return {
      east: { x: width - inset, y: midY },
      west: { x: inset, y: midY },
      north: { x: width / 2, y: inset },
      south: { x: width / 2, y: height - inset },
    };
  }

  const headLength = headLengthOf(params, { width, height }, inset);
  const half = bodyHalfHeight(params, { width, height }, inset);
  const tipX = width - inset;
  const baseX = tipX - headLength;
  const anchors: ShapeAnchors = {
    tip: { x: tipX, y: midY },
    base: { x: baseX, y: inset },
    mirror: { x: baseX, y: height - inset },
    body: { x: inset, y: midY - half },
  };
  if (params.kind === "arrow_both") anchors.rear = { x: inset, y: midY };
  return anchors;
}

/** One shape's numbers after a gesture. */
export interface ShapeState {
  params: ShapeParams;
  box: ShapeBox;
}

/**
 * The result of one handle's gesture: the new numbers, plus how far the box's
 * own corner must move (in page units, along the shape's own axes) so the end
 * that must not move stays put.
 */
export interface ShapeDrag extends ShapeState {
  shiftX: number;
  shiftY: number;
}

/** Keep head and body inside the box after any change. */
function fit(state: ShapeState): ShapeState {
  if (state.params.kind === "line" || state.params.kind === "ellipse") return state;
  const inset = shapeStrokeInset(state.params, state.box);
  const headSize = headLengthOf(state.params, state.box, inset);
  const room = Math.max(MIN_BODY_HEIGHT_PX, state.box.height - 2 * inset);
  const bodyHeight = clamp(state.params.bodyHeight, MIN_BODY_HEIGHT_PX, room);
  if (headSize === state.params.headSize && bodyHeight === state.params.bodyHeight) return state;
  return { params: { ...state.params, headSize, bodyHeight }, box: state.box };
}

/** The TIP: longer or shorter head; the box's right edge travels with it. */
export function dragShapeTip(start: ShapeState, dx: number): ShapeDrag {
  const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const headSize = Math.round(start.params.headSize + dx);
  const state = fit({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, headSize },
  });
  return { ...state, shiftX: 0, shiftY: 0 };
}

/** The REAR tip (double arrow): the rear end moves, the front tip stays. */
export function dragShapeRear(start: ShapeState, dx: number): ShapeDrag {
  const width = clamp(start.box.width - dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const state = fit({ box: { width: Math.round(width), height: start.box.height }, params: start.params });
  return { ...state, shiftX: start.box.width - state.box.width, shiftY: 0 };
}

/** The HEAD's rear corners: the head widens or narrows symmetrically. */
export function dragShapeHead(start: ShapeState, outward: number): ShapeDrag {
  const minHeight = Math.max(start.params.strokeWidth + 2, 6);
  const height = clamp(start.box.height + 2 * outward, minHeight, MAX_SHAPE_WIDTH_PX);
  const state = fit({
    box: { width: start.box.width, height: Math.round(height) },
    params: start.params,
  });
  return { ...state, shiftX: 0, shiftY: 0 };
}

/** The BODY's rear corner: height of the body, length of the shape. */
export function dragShapeBody(start: ShapeState, dx: number, dy: number): ShapeDrag {
  const width = clamp(start.box.width - dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const state = fit({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, bodyHeight: Math.round(start.params.bodyHeight - 2 * dy) },
  });
  return { ...state, shiftX: start.box.width - state.box.width, shiftY: 0 };
}

/**
 * The ELLIPSE's edge handles: each moves one side and leaves the opposite side
 * where it is, so the box's own corner travels with the hand.
 */
export function dragShapeEdge(
  part: "east" | "west" | "north" | "south",
  start: ShapeState,
  dx: number,
  dy: number
): ShapeDrag {
  if (part === "east") {
    const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
    return {
      box: { width: Math.round(width), height: start.box.height },
      params: start.params,
      shiftX: 0,
      shiftY: 0,
    };
  }
  if (part === "west") {
    const width = clamp(start.box.width - dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
    return {
      box: { width: Math.round(width), height: start.box.height },
      params: start.params,
      shiftX: start.box.width - width,
      shiftY: 0,
    };
  }
  if (part === "north") {
    const height = clamp(start.box.height - dy, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
    return {
      box: { width: start.box.width, height: Math.round(height) },
      params: start.params,
      shiftX: 0,
      shiftY: start.box.height - height,
    };
  }
  const height = clamp(start.box.height + dy, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  return {
    box: { width: start.box.width, height: Math.round(height) },
    params: start.params,
    shiftX: 0,
    shiftY: 0,
  };
}
