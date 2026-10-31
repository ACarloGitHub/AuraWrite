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

/** The shapes of the first block. The other three arrive with S4. */
export const SHAPE_KINDS = ["line", "arrow"] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

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
  return {
    kind: normalizeShapeKind(a.shape),
    strokeWidth: clampInt(a.strokeWidth, DEFAULT_STROKE_WIDTH_PX, MIN_STROKE_WIDTH_PX, MAX_STROKE_WIDTH_PX),
    strokeColor: color || DEFAULT_STROKE_COLOR,
    fill,
    headSize: clampInt(a.headSize, DEFAULT_HEAD_SIZE_PX, MIN_HEAD_SIZE_PX, MAX_HEAD_SIZE_PX),
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
export function shapeBoxSize(attrs: Record<string, unknown> | undefined): ShapeBox {
  const a = attrs ?? {};
  const params = normalizeShapeParams(a);
  const width = clampInt(a.width, DEFAULT_SHAPE_WIDTH_PX, MIN_SHAPE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  if (params.kind === "line") return { width, height: params.strokeWidth };
  const height = clampInt(a.height, params.headSize, MIN_STROKE_WIDTH_PX, MAX_SHAPE_WIDTH_PX);
  return { width, height };
}

/** The box a shape is born with, per kind. */
export function defaultShapeBox(kind: ShapeKind): ShapeBox {
  const params = normalizeShapeParams({ shape: kind });
  return {
    width: DEFAULT_SHAPE_WIDTH_PX,
    height: params.kind === "line" ? params.strokeWidth : params.headSize,
  };
}

/**
 * The point a shape turns around, in its own box's coordinates, or null when it
 * turns around the centre like every other element.
 *
 * The LINE turns around its centre (the shared rule). The ARROW turns around its
 * tip: the tip is where an arrow touches what it points at, so it is the point
 * that must stay put (§5, point 3). This is the one exception to L2, and it is
 * written here — one place — so the view, the screen's band and the page count
 * all turn the arrow the same way.
 */
export function shapeRotationPivot(attrs: Record<string, unknown> | undefined): { x: number; y: number } | null {
  const params = normalizeShapeParams(attrs);
  if (params.kind !== "arrow") return null;
  const box = shapeBoxSize(attrs);
  // The drawn tip sits half a stroke inside the box, so the stroke's outline
  // does not spill over the edge: the pivot is that same point.
  const pad = Math.min(params.strokeWidth / 2, Math.min(box.width, box.height) / 2);
  return { x: box.width - pad, y: box.height / 2 };
}
