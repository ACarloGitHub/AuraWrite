// ============================================================================
// Shape parameters — the NUMBERS a drawn shape carries, and nothing else.
//
// The document stores numbers, not a drawing (drawn-shapes-project §2): the
// view on screen and the markup on the sheet both paint them through
// `shape-geometry.ts`, so the two cannot show different shapes.
//
// This module has no DOM and no ProseMirror: it only normalises what a
// document may contain, so a hand-written or imported value can never leave a
// shape with an impossible size.
// ============================================================================

/** The shapes of the first block. */
export const SHAPE_KINDS = ["line", "brace", "arrow", "arrow_both", "arrow_curve", "ellipse", "star"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The kinds that have at least one head, and so a tip to turn around. */
export function hasHead(kind: ShapeKind): boolean {
  return kind === "arrow" || kind === "arrow_both" || kind === "arrow_curve";
}

/** The kinds with a body rectangle behind the head. */
export function hasBody(kind: ShapeKind): boolean {
  return kind === "arrow" || kind === "arrow_both" || kind === "arrow_curve";
}

/** Every kind but the line and the brace is a closed outline: it has an inside to fill. */
export function isClosedShape(kind: ShapeKind): boolean {
  return kind !== "line" && kind !== "brace";
}

/** The stroke's pattern. */
export const SHAPE_DASHES = ["solid", "dashed", "dotted"] as const;
export type ShapeDash = (typeof SHAPE_DASHES)[number];
export const DEFAULT_DASH: ShapeDash = "solid";

/** Number of points of a star, and how deep its notches go (0-100). */
export const DEFAULT_STAR_POINTS = 5;
export const MIN_STAR_POINTS = 3;
export const MAX_STAR_POINTS = 24;
export const DEFAULT_STAR_DEPTH = 55;

/** Bend of the curved arrow, in px; positive bulges upwards. */
export const DEFAULT_CURVE_PX = 26;
export const MAX_CURVE_PX = 400;

/** Which way a brace opens: right = the cusp points left, like "{". */
export const SHAPE_OPENINGS = ["right", "left"] as const;
export type ShapeOpening = (typeof SHAPE_OPENINGS)[number];

/** A brace is born narrow and tall, with its cusp in proportion. */
export const DEFAULT_BRACE_WIDTH_PX = 44;
export const DEFAULT_BRACE_HEIGHT_PX = 120;
export const DEFAULT_CUSP_PX = 18;
export const MIN_CUSP_PX = 2;
export const MAX_CUSP_PX = 200;

export const DEFAULT_STROKE_WIDTH_PX = 2;
export const DEFAULT_STROKE_COLOR = "#333333";
export const MIN_STROKE_WIDTH_PX = 1;
export const MAX_STROKE_WIDTH_PX = 24;

/**
 * Colour of the INSIDE of the closed part (the arrow's head). Empty means "no
 * separate colour": the inside takes the stroke's colour, which is how a plain
 * black arrow has always looked.
 */
export const DEFAULT_FILL_COLOR = "";

/** Length of the arrow head, in px — independent of the box width (§6). */
export const DEFAULT_HEAD_SIZE_PX = 16;
export const MIN_HEAD_SIZE_PX = 4;
export const MAX_HEAD_SIZE_PX = 200;

/** Length a shape is born with, and the smallest it may be dragged to. */
export const DEFAULT_SHAPE_WIDTH_PX = 220;
export const MIN_SHAPE_WIDTH_PX = 24;

/**
 * Largest side a shape may have, in px. Beyond this a stored value is
 * certainly a mistake, and clamping it keeps the page count honest.
 */
export const MAX_SHAPE_WIDTH_PX = 20000;

/** Shortest free body a head may leave in front of itself, in px. */
export const MIN_SHAPE_BODY_PX = 4;

/**
 * Height of the arrow's BODY (the rectangle behind the head), in px.
 *
 * It is a measure of the drawing, not of its contour: the head is wider than the
 * body, which is what makes an arrow read as an arrow. The stroke is only the
 * outline around it.
 */
export const DEFAULT_BODY_HEIGHT_PX = 6;
export const MIN_BODY_HEIGHT_PX = 1;

export interface ShapeParams {
  kind: ShapeKind;
  /** Thickness of the stroke, in px. */
  strokeWidth: number;
  /** Colour of the stroke (the contour of the drawing). */
  strokeColor: string;
  /** Colour of the inside of the closed part; empty = the stroke's colour. */
  fill: string;
  /** Length of the arrow head, in px. */
  headSize: number;
  /** Height of the body rectangle, in px. */
  bodyHeight: number;
  /** Pattern of the contour. */
  dash: ShapeDash;
  /** Bend of the curved arrow, in px; positive bulges upwards. */
  curve: number;
  /** Points of a star and how deep its notches go (0-100). */
  points: number;
  depth: number;
  /** Which way a brace opens. */
  opening: ShapeOpening;
  /** How far a brace's cusp sticks out of its stem, in px. */
  cusp: number;
}

/** True when the value names one of the shapes this version can draw. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Unknown values fall back to a line: a shape that fails to read still shows. */
export function normalizeShapeKind(value: unknown): ShapeKind {
  return isShapeKind(value) ? value : "line";
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** The parameters of a shape, from whatever its attributes hold. */
export function normalizeShapeParams(attrs: Record<string, unknown> | undefined): ShapeParams {
  const a = attrs ?? {};
  const color = typeof a.strokeColor === "string" ? a.strokeColor.trim() : "";
  const fill = typeof a.fill === "string" ? a.fill.trim() : "";
  const dash = (SHAPE_DASHES as readonly string[]).includes(String(a.dash))
    ? (a.dash as ShapeDash)
    : DEFAULT_DASH;
  return {
    kind: normalizeShapeKind(a.shape),
    strokeWidth: clampInt(a.strokeWidth, DEFAULT_STROKE_WIDTH_PX, MIN_STROKE_WIDTH_PX, MAX_STROKE_WIDTH_PX),
    strokeColor: color || DEFAULT_STROKE_COLOR,
    fill,
    headSize: clampInt(a.headSize, DEFAULT_HEAD_SIZE_PX, MIN_HEAD_SIZE_PX, MAX_HEAD_SIZE_PX),
    bodyHeight: clampInt(a.bodyHeight, DEFAULT_BODY_HEIGHT_PX, MIN_BODY_HEIGHT_PX, MAX_SHAPE_WIDTH_PX),
    dash,
    curve: clampInt(a.curve, DEFAULT_CURVE_PX, -MAX_CURVE_PX, MAX_CURVE_PX),
    points: clampInt(a.points, DEFAULT_STAR_POINTS, MIN_STAR_POINTS, MAX_STAR_POINTS),
    depth: clampInt(a.depth, DEFAULT_STAR_DEPTH, 0, 100),
    opening: (SHAPE_OPENINGS as readonly string[]).includes(String(a.opening))
      ? (a.opening as ShapeOpening)
      : "right",
    cusp: clampInt(a.cusp, DEFAULT_CUSP_PX, MIN_CUSP_PX, MAX_CUSP_PX),
  };
}

/** The size of a shape's box, in page units. */
export interface ShapeBox {
  width: number;
  height: number;
}

/**
 * The box that HUGS the shape (§6): no air inside it, because air would inflate
 * the room the text keeps clear, the click area and the handles at once.
 *
 * A line is as tall as its stroke — its height is therefore NOT stored: it is
 * the stroke's, always. An arrow is as tall as its head, which IS stored so the
 * box can be made taller or shorter without touching the head's length.
 */
/** The height an ellipse is born with. */
export const DEFAULT_ELLIPSE_HEIGHT_PX = 120;

export function shapeBoxSize(attrs: Record<string, unknown> | undefined): ShapeBox {
  const a = attrs ?? {};
  const params = normalizeShapeParams(a);
  const width = clampInt(a.width, DEFAULT_SHAPE_WIDTH_PX, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  if (params.kind === "line") return { width, height: params.strokeWidth };
  if (params.kind === "arrow_curve") {
    // The head is its own height (the `Head` number) and the room above it is the
    // bend: the box is DERIVED, so moving the bend cannot deform the head.
    return { width, height: params.headSize + Math.abs(params.curve) + params.strokeWidth };
  }
  const height = clampInt(a.height, defaultHeightOf(params), MIN_STROKE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  return { width, height };
}

/**
 * The height a kind needs at least: an ellipse is drawn in its box, an arrow is
 * as tall as its head, and a curved arrow is as tall as its head PLUS the room
 * the bend needs above it.
 */
function defaultHeightOf(params: ShapeParams): number {
  if (params.kind === "ellipse") return DEFAULT_ELLIPSE_HEIGHT_PX;
  if (params.kind === "brace") return DEFAULT_BRACE_HEIGHT_PX;
  if (params.kind === "arrow_curve") return params.headSize + Math.abs(params.curve);
  return params.headSize;
}

/** The box a shape is born with, per kind. */
export function defaultShapeBox(kind: ShapeKind): ShapeBox {
  const params = normalizeShapeParams({ shape: kind });
  if (params.kind === "brace") {
    return { width: DEFAULT_BRACE_WIDTH_PX, height: DEFAULT_BRACE_HEIGHT_PX };
  }
  return {
    width: DEFAULT_SHAPE_WIDTH_PX,
    height: params.kind === "line" ? params.strokeWidth : defaultHeightOf(params),
  };
}

/**
 * The point a shape turns around, in its own box's coordinates, or null when it
 * turns around the centre like every other element.
 *
 * The LINE and the ELLIPSE turn around their centre (the shared rule). A shape
 * with a tip turns around that tip: it is where the arrow touches what it points
 * at, so it is what must stay put (§5, point 3). This is the one exception to L2,
 * written here — one place — so the view, the screen's band and the page count
 * all turn the same way.
 */
export function shapeRotationPivot(attrs: Record<string, unknown> | undefined): { x: number; y: number } | null {
  const params = normalizeShapeParams(attrs);
  if (!hasHead(params.kind)) return null;
  const box = shapeBoxSize(attrs);
  // The drawn tip sits half a stroke inside the box, so the stroke's outline
  // does not spill over the edge: the pivot is that same point.
  const pad = Math.min(params.strokeWidth / 2, Math.min(box.width, box.height) / 2);
  return { x: box.width - pad, y: box.height / 2 };
}
