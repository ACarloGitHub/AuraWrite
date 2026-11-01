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
  MAX_CURVE_PX,
  MAX_CUSP_PX,
  MAX_SHAPE_WIDTH_PX,
  MIN_BODY_HEIGHT_PX,
  MIN_CUSP_PX,
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
export const SHAPE_PARTS = [
  "tip",
  "rear",
  "base",
  "mirror",
  "body",
  "bend",
  "scale",
  "east",
  "west",
  "north",
  "south",
  "cusp",
] as const;

export type ShapePart = (typeof SHAPE_PARTS)[number];

export type ShapeAnchors = Partial<Record<ShapePart, ShapePoint>>;

export interface ShapeGeometry {
  /** A plain line's stroke; null for a closed shape. */
  shaft: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The closed outline; null for a plain line. */
  outline: [number, number][] | null;
  /** A stroked path (curves), for the kinds that are not a polygon: the brace. */
  path?: string;
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

/**
 * The head's own height and the line it is centred on, in the box.
 *
 * For the straight shapes the head is as tall as the box. For the curved one the
 * head keeps its OWN height (the `Head` number) and the room above it belongs to
 * the bend, so bending cannot deform it. It sits at the bottom when the bend goes
 * up and at the top when it goes down.
 */
function headOf(params: ShapeParams, box: ShapeBox, inset: number): { height: number; centreY: number } {
  if (params.kind !== "arrow_curve") {
    return { height: Math.max(2, box.height - inset * 2), centreY: box.height / 2 };
  }
  const headHeight = Math.min(Math.max(6, params.headSize), Math.max(6, box.height - inset * 2));
  const centreY = params.curve >= 0 ? box.height - inset - headHeight / 2 : inset + headHeight / 2;
  return { height: headHeight, centreY };
}

/** One point of the curved centreline, as a quadratic between the two ends. */
function curvePoint(params: ShapeParams, box: ShapeBox, inset: number, t: number): ShapePoint {
  const head = headOf(params, box, inset);
  const baseX = box.width - inset - headLengthOf(params, box, inset);
  const x0 = inset;
  const controlX = (x0 + baseX) / 2;
  const controlY = head.centreY - 2 * params.curve;
  const one = 1 - t;
  return {
    x: one * one * x0 + 2 * one * t * controlX + t * t * baseX,
    y: one * one * head.centreY + 2 * one * t * controlY + t * t * head.centreY,
  };
}

/** One tenth of a pixel is enough resolution for a drawn curve. */
function round10(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * The brace's drawing: two hooks, a straight stem and the central cusp, as ONE
 * stroked path (it has no inside, so it is never a polygon). `opening` says
 * which way it opens — "right" is "{".
 */
function bracePath(params: ShapeParams, width: number, height: number, inset: number): string {
  const midY = height / 2;
  const xL = inset;
  const xR = width - inset;
  // The hooks' rounding, kept small on a short brace.
  const r = Math.max(2, Math.min(14, (height - inset * 2) / 6));
  // The cusp's tip is always on the box's edge; `cusp` is how far the stem is
  // from it. The arms' reach is what the box keeps.
  const cusp = Math.max(MIN_CUSP_PX, Math.min(params.cusp, width - inset * 2 - 8));
  const stemX = xL + cusp;
  const flip = (x: number): number => (params.opening === "left" ? width - x : x);
  const p = (x: number, y: number): string => `${round10(flip(x))} ${round10(y)}`;
  return [
    `M ${p(xR, inset)}`,
    `Q ${p(stemX, inset)} ${p(stemX, inset + r)}`,
    `L ${p(stemX, midY - r)}`,
    `Q ${p(stemX, midY)} ${p(xL, midY)}`,
    `Q ${p(stemX, midY)} ${p(stemX, midY + r)}`,
    `L ${p(stemX, height - inset - r)}`,
    `Q ${p(stemX, height - inset)} ${p(xR, height - inset)}`,
  ].join(" ");
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

  if (params.kind === "brace") {
    return { shaft: null, outline: null, path: bracePath(params, width, height, inset) };
  }

  if (params.kind === "ellipse" || params.kind === "star") {
    const cx = width / 2;
    const cy = height / 2;
    const rx = Math.max(0.5, width / 2 - inset);
    const ry = Math.max(0.5, height / 2 - inset);
    const points: [number, number][] = [];
    if (params.kind === "star") {
      const spokes = Math.max(3, Math.min(24, Math.round(params.points)));
      const inner = 0.85 - (params.depth / 100) * 0.7;
      for (let i = 0; i < spokes * 2; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / spokes;
        const k = i % 2 === 0 ? 1 : inner;
        points.push([cx + rx * k * Math.cos(angle), cy + ry * k * Math.sin(angle)]);
      }
      return { shaft: null, outline: points };
    }
    const steps = 72;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    return { shaft: null, outline: points };
  }

  const headLength = headLengthOf(params, { width, height }, inset);
  const half = bodyHalfHeight(params, { width, height }, inset);

  if (params.kind === "arrow_curve") {
    // A ribbon around the curved centreline, closed by the head.
    const head = headOf(params, { width, height }, inset);
    const steps = 26;
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point = curvePoint(params, { width, height }, inset, t);
      const ahead = curvePoint(params, { width, height }, inset, Math.min(1, t + 0.01));
      const behind = curvePoint(params, { width, height }, inset, Math.max(0, t - 0.01));
      const dx = ahead.x - behind.x;
      const dy = ahead.y - behind.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      top.push([point.x + nx * half, point.y + ny * half]);
      bottom.push([point.x - nx * half, point.y - ny * half]);
    }
    const tipX = width - inset;
    const baseX = tipX - headLength;
    return {
      shaft: null,
      outline: [
        ...top,
        [baseX, head.centreY - head.height / 2],
        [tipX, head.centreY],
        [baseX, head.centreY + head.height / 2],
        ...bottom.reverse(),
      ],
    };
  }

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

  if (params.kind === "brace") {
    const tipX = params.opening === "left" ? width - inset : inset;
    return { cusp: { x: tipX, y: midY } };
  }

  if (params.kind === "ellipse" || params.kind === "star") {
    return {
      east: { x: width - inset, y: midY },
      west: { x: inset, y: midY },
      north: { x: width / 2, y: inset },
      south: { x: width / 2, y: height - inset },
      // A corner of the box: it grows and shrinks both axes together, which is
      // how an ellipse becomes a circle and a circle stays one.
      scale: { x: width - inset, y: inset },
    };
  }

  const headLength = headLengthOf(params, { width, height }, inset);
  const half = bodyHalfHeight(params, { width, height }, inset);
  const tipX = width - inset;
  const baseX = tipX - headLength;
  if (params.kind === "arrow_both") {
    // The drawing is symmetric, so its handles are: one tip, one head corner and
    // the body's handle in the middle, equidistant from the two tips.
    return {
      tip: { x: tipX, y: midY },
      base: { x: baseX, y: inset },
      body: { x: width / 2, y: midY - half },
    };
  }
  if (params.kind === "arrow_curve") {
    const head = headOf(params, { width, height }, inset);
    const peak = curvePoint(params, { width, height }, inset, 0.5);
    return {
      tip: { x: tipX, y: head.centreY },
      base: { x: baseX, y: head.centreY - head.height / 2 },
      mirror: { x: baseX, y: head.centreY + head.height / 2 },
      body: { x: inset, y: head.centreY - half },
      bend: peak,
    };
  }
  return {
    tip: { x: tipX, y: midY },
    base: { x: baseX, y: inset },
    mirror: { x: baseX, y: height - inset },
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
 * own corner must move (in page units, along the shape's own axes) so the end
 * that must not move stays put.
 */
export interface ShapeDrag extends ShapeState {
  shiftX: number;
  shiftY: number;
}

/** Keep head and body inside the box after any change. */
function fit(state: ShapeState): ShapeState {
  if (state.params.kind === "line" || state.params.kind === "ellipse" || state.params.kind === "brace") {
    return state;
  }
  const inset = shapeStrokeInset(state.params, state.box);
  const headSize = headLengthOf(state.params, state.box, inset);
  const room = Math.max(MIN_BODY_HEIGHT_PX, state.box.height - 2 * inset);
  const bodyHeight = clamp(state.params.bodyHeight, MIN_BODY_HEIGHT_PX, room);
  if (headSize === state.params.headSize && bodyHeight === state.params.bodyHeight) return state;
  return { params: { ...state.params, headSize, bodyHeight }, box: state.box };
}

/**
 * The TIP: longer or shorter head. On the single arrow the box's right edge
 * travels with it; on the double arrow the head at the other end grows the same
 * way, so the shape gets longer on both sides and the box's corner travels half
 * the change.
 */
export function dragShapeTip(start: ShapeState, dx: number): ShapeDrag {
  const headSize = Math.round(start.params.headSize + dx);
  if (start.params.kind === "arrow_both") {
    const width = clamp(start.box.width + 2 * dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
    const grown = width - start.box.width;
    const state = fit({
      box: { width: Math.round(width), height: start.box.height },
      params: { ...start.params, headSize },
    });
    return { ...state, shiftX: -Math.round(grown / 2), shiftY: 0 };
  }
  const width = clamp(start.box.width + dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const state = fit({
    box: { width: Math.round(width), height: start.box.height },
    params: { ...start.params, headSize },
  });
  return { ...state, shiftX: 0, shiftY: 0 };
}

/**
 * The brace's CUSP: how far it sticks out of the stem. Pulling it outward
 * deepens it and lengthens the box; the arms stay where they are, so the box's
 * origin travels with the cusp (opening right) or stays with the arms (opening
 * left).
 */
export function dragBraceCusp(start: ShapeState, dx: number): ShapeDrag {
  const opening = start.params.opening;
  const outward = opening === "right" ? -dx : dx;
  const cusp = clamp(start.params.cusp + outward, MIN_CUSP_PX, MAX_CUSP_PX);
  const grown = cusp - start.params.cusp;
  const width = clamp(start.box.width + grown, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  return {
    params: { ...start.params, cusp: Math.round(cusp) },
    box: { width: Math.round(width), height: start.box.height },
    shiftX: opening === "right" ? Math.round(dx) : 0,
    shiftY: 0,
  };
}

/**
 * The REAR tip was removed on Carlo's request (31-10): the double arrow is
 * symmetric, so the one handle on the right tip carries both. `dragShapeRear`
 * no longer exists on purpose — a second grab point for the same gesture is a
 * duplication, not a help.
 */

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

/**
 * The BODY: height of the body on the vertical axis, and on the horizontal the
 * shape gets longer or shorter.
 *
 * On the double arrow everything happens symmetrically about the middle — the
 * handle sits in the middle, equidistant from the two tips — so the box grows on
 * both sides and its own corner travels half the change, without moving the
 * centre.
 */
export function dragShapeBody(start: ShapeState, dx: number, dy: number): ShapeDrag {
  if (start.params.kind === "arrow_both") {
    const width = clamp(start.box.width + 2 * dx, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
    const grown = width - start.box.width;
    const state = fit({
      box: { width: Math.round(width), height: start.box.height },
      params: { ...start.params, bodyHeight: Math.round(start.params.bodyHeight - 2 * dy) },
    });
    return { ...state, shiftX: -Math.round(grown / 2), shiftY: 0 };
  }
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

/**
 * The ELLIPSE's corner: both axes grow or shrink by the same factor, so a
 * circle stays a circle and anything else becomes one. The centre does not
 * move, which is why the box's corner travels half of each change.
 */
export function dragShapeScale(start: ShapeState, dx: number, dy: number): ShapeDrag {
  const inset = shapeStrokeInset(start.params, start.box);
  const rx = Math.max(1, start.box.width / 2 - inset);
  const ry = Math.max(1, start.box.height / 2 - inset);
  const reach = Math.hypot(rx, ry) || 1;
  const factor = Math.max(0.1, Math.hypot(rx + dx, ry + dy) / reach);
  const width = clamp(start.box.width * factor, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  const height = clamp(start.box.height * factor, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  return {
    box: { width: Math.round(width), height: Math.round(height) },
    params: start.params,
    shiftX: (start.box.width - width) / 2,
    shiftY: (start.box.height - height) / 2,
  };
}

/** The BEND of a curved arrow: the box grows by what the bend needs. */
export function dragShapeBend(start: ShapeState, dy: number): ShapeDrag {
  if (start.params.kind !== "arrow_curve") {
    return { ...start, shiftX: 0, shiftY: 0 };
  }
  const inset = shapeStrokeInset(start.params, start.box);
  const curve = clamp(Math.round(start.params.curve - dy), -MAX_CURVE_PX, MAX_CURVE_PX);
  const height = start.params.headSize + Math.abs(curve) + 2 * inset;
  const shiftY = curve >= 0 ? -(height - start.box.height) : 0;
  return {
    box: { width: start.box.width, height: Math.round(height) },
    params: { ...start.params, curve },
    shiftX: 0,
    shiftY,
  };
}