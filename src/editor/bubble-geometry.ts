// ============================================================================
// Bubble geometry — the numbers of a speech balloon, and nothing else.
//
// A bubble is a BOX with text inside plus a TAIL that hangs off it. The body is
// a rectangle (with rounded corners) or an ellipse; the tail leaves the body at
// a point of its outline chosen by `at` and ends in a tip the hand can move.
// Body and tail are ONE outline, not two: the tail's base is an ARC OF THE
// BODY'S OUTLINE, and the contour walks the body, turns into the tail and comes
// back. That is why the border and the shadow are continuous (the contract of
// chapter A, S6).
//
// The rectangle and the ellipse share ONE way of reading `at`: 0 is the
// top-left point of the outline, the walk goes clockwise, each quarter is a
// side (the ellipse's quarter is 90 degrees). So 12.5 is the top, 37.5 the
// right, 62.5 the bottom and 87.5 the left for both bodies, and the default
// (62.5) hangs the tail straight down.
//
// Units: page pixels, exactly like the shapes. Nothing here touches the DOM.
// ============================================================================

export type BubbleBody = "rect" | "ellipse";
export type BubbleDash = "solid" | "dashed" | "dotted";

export interface BubbleParams {
  /** Shape of the body. */
  body: BubbleBody;
  /** Inside of the body; empty = transparent (only the contour is painted). */
  fill: string;
  strokeColor: string;
  strokeWidth: number;
  /** Pattern of the contour. */
  dash: BubbleDash;
  /** Corner rounding of the rectangle, px (the ellipse ignores it). */
  radius: number;
  /** Width of the BODY (what the bar calls W). */
  width: number;
  /**
   * Height of the BODY, chosen by the author like the width. It is NOT the
   * text's height: the words can overflow the balloon, and that is a decision
   * the document records, not a defect to heal (Carlo, 01-11).
   */
  height: number;
  /** Where the tail leaves the body, 0..100 along the outline. */
  at: number;
  /**
   * The tip, in the body's own frame at the attachment point: how far OUT of the
   * body (along its outward normal) and how far ALONG the body (to the right of
   * that normal). Storing the frame and not a pair of screen offsets is what lets
   * the tail follow `at`: moved to another side, it still leaves the body
   * outward instead of pointing into it.
   */
  tailOut: number;
  tailAlong: number;
  /** How much of the body's outline the tail's base takes, px. */
  base: number;
}

export interface Pt {
  x: number;
  y: number;
}

export const BUBBLE_WIDTH_MIN = 80;
export const BUBBLE_WIDTH_MAX = 1600;
export const BUBBLE_WIDTH_DEFAULT = 320;
export const BUBBLE_HEIGHT_MIN = 40;
export const BUBBLE_HEIGHT_MAX = 2000;
export const BUBBLE_HEIGHT_DEFAULT = 100;
export const BUBBLE_AT_DEFAULT = 62.5;
export const BUBBLE_TAIL_DEFAULT_OUT = 64;
export const BUBBLE_TAIL_DEFAULT_ALONG = 28;
export const BUBBLE_BASE_MIN = 10;
export const BUBBLE_BASE_MAX = 240;
export const BUBBLE_BASE_DEFAULT = 44;
/** Longest tail the hand may pull, px (contract). */
export const BUBBLE_TAIL_MAX = 400;
/** A tail shorter than this, measured from the outline outward, is not a tail. */
export const BUBBLE_TAIL_MIN_GAP = 8;
export const BUBBLE_STROKE_MIN = 1;
export const BUBBLE_STROKE_MAX = 24;
export const BUBBLE_STROKE_DEFAULT = 1;
export const BUBBLE_STROKE_COLOR_DEFAULT = "#333333";
/** The balloon's inside: a sheet of paper, so the page cannot show through. */
export const BUBBLE_FILL_DEFAULT = "#ffffff";
export const BUBBLE_RADIUS_DEFAULT = 8;
export const BUBBLE_RADIUS_MAX = 120;
/** Air between the text and the body's edge: the box's own padding (box.css). */
export const BUBBLE_PAD_X = 16;
export const BUBBLE_PAD_Y = 14;
/**
 * How much of the body the text may use when the body is an ellipse: the
 * rectangle inscribed in it (1/sqrt(2) of each side), so the words stay clear
 * of the curve.
 */
export const BUBBLE_ELLIPSE_INSET = Math.SQRT1_2;

function num(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function color(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(raw.trim()) ? raw.trim() : fallback;
}

/** Read the node's attributes into a complete, clamped set of numbers. */
export function normalizeBubbleParams(attrs: Record<string, unknown>): BubbleParams {
  const body: BubbleBody = attrs.body === "ellipse" ? "ellipse" : "rect";
  const dashRaw = String(attrs.borderStyle ?? "solid");
  const dash: BubbleDash = dashRaw === "dashed" || dashRaw === "dotted" ? dashRaw : "solid";
  return {
    body,
    fill: color(attrs.bgColor, BUBBLE_FILL_DEFAULT),
    strokeColor: color(attrs.borderColor, BUBBLE_STROKE_COLOR_DEFAULT),
    strokeWidth: num(attrs.borderWidth, BUBBLE_STROKE_DEFAULT, 0, BUBBLE_STROKE_MAX),
    dash,
    radius: num(attrs.cornerRadius, BUBBLE_RADIUS_DEFAULT, 0, BUBBLE_RADIUS_MAX),
    width: num(attrs.widthPx, BUBBLE_WIDTH_DEFAULT, BUBBLE_WIDTH_MIN, BUBBLE_WIDTH_MAX),
    height: num(attrs.heightPx, BUBBLE_HEIGHT_DEFAULT, BUBBLE_HEIGHT_MIN, BUBBLE_HEIGHT_MAX),
    at: num(attrs.at, BUBBLE_AT_DEFAULT, 0, 100),
    tailOut: num(attrs.tailOut, BUBBLE_TAIL_DEFAULT_OUT, -BUBBLE_TAIL_MAX, BUBBLE_TAIL_MAX),
    tailAlong: num(attrs.tailAlong, BUBBLE_TAIL_DEFAULT_ALONG, -BUBBLE_TAIL_MAX, BUBBLE_TAIL_MAX),
    base: num(attrs.base, BUBBLE_BASE_DEFAULT, BUBBLE_BASE_MIN, BUBBLE_BASE_MAX),
  };
}

export interface BubbleFrame {
  /** The rectangle the text lives in: the body, or the one inscribed in an ellipse. */
  w: number;
  h: number;
  /** Where that rectangle sits inside the body. */
  insetX: number;
  insetY: number;
}

/**
 * The frame the text lives in. A rectangle holds the whole body; an ellipse
 * holds the rectangle inscribed in it, so the words never cross the curve.
 */
export function bubbleFrame(params: BubbleParams): BubbleFrame {
  const w = params.body === "ellipse" ? Math.round(params.width * BUBBLE_ELLIPSE_INSET) : params.width;
  const h = params.body === "ellipse" ? Math.round(params.height * BUBBLE_ELLIPSE_INSET) : params.height;
  return {
    w,
    h,
    insetX: Math.max(0, Math.round((params.width - w) / 2)),
    insetY: Math.max(0, Math.round((params.height - h) / 2)),
  };
}

// ---------------------------------------------------------------------------
// The body's outline
// ---------------------------------------------------------------------------

/**
 * The body's outline as a closed ring of points, clockwise, starting at the
 * top-left corner (rectangle) or at the top-left point (ellipse).
 */
export function bubbleBodyRing(body: BubbleBody, width: number, height: number, radius: number): Pt[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (body === "ellipse") {
    const n = 120;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI * 1.25;
      pts.push({ x: w / 2 + (w / 2) * Math.cos(a), y: h / 2 + (h / 2) * Math.sin(a) });
    }
    return pts;
  }
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r < 0.5) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const pts: Pt[] = [];
  const steps = 10;
  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  pts.push({ x: r, y: 0 });
  pts.push({ x: w - r, y: 0 });
  arc(w - r, r, -Math.PI / 2, 0);
  pts.push({ x: w, y: h - r });
  arc(w - r, h - r, 0, Math.PI / 2);
  pts.push({ x: r, y: h });
  arc(r, h - r, Math.PI / 2, Math.PI);
  pts.push({ x: 0, y: r });
  arc(r, r, Math.PI, Math.PI * 1.5);
  return pts;
}

/** Cumulative length at each point of a closed ring, plus the total. */
export function ringLengths(ring: Pt[]): { at: number[]; total: number } {
  const at: number[] = [0];
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    at.push(total);
  }
  return { at, total };
}

/** The point at arc position `s` (wrapping), and the tangent there. */
export function ringPointAt(ring: Pt[], at: number[], total: number, s: number): { point: Pt; tangent: Pt } {
  const span = total > 0 ? total : 1;
  let pos = ((s % span) + span) % span;
  // Find the segment: `at[i] <= pos < at[i + 1]`.
  let i = 0;
  while (i < ring.length - 1 && at[i + 1] <= pos) i++;
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const len = Math.max(1e-6, at[i + 1] - at[i]);
  const t = (pos - at[i]) / len;
  return {
    point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
  };
}

/** Arc position of the ring point nearest to `p`, and the tangent there. */
export function ringNearest(ring: Pt[], at: number[], total: number, p: Pt): { s: number; tangent: Pt } {
  let bestS = 0;
  let bestD = Infinity;
  let bestT = { x: 1, y: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = (p.x - qx) ** 2 + (p.y - qy) ** 2;
    if (d < bestD) {
      bestD = d;
      const len = Math.sqrt(len2) || 1;
      bestS = at[i] + len * t;
      bestT = { x: dx / len, y: dy / len };
    }
  }
  return { s: bestS, tangent: bestT };
}

/**
 * The point of the outline that `at` names. Rectangles read the four sides as
 * equal quarters (so the number does not lie when the box is long and thin);
 * the ellipse reads four 90-degree quarters.
 */
export function bubblePointAt(params: BubbleParams, fraction: number): Pt {
  const f = ((fraction % 1) + 1) % 1;
  const w = params.width;
  const h = params.height;
  if (params.body === "ellipse") {
    const a = ((225 + f * 360) * Math.PI) / 180;
    return { x: w / 2 + (w / 2) * Math.cos(a), y: h / 2 + (h / 2) * Math.sin(a) };
  }
  const q = Math.min(3, Math.floor(f * 4));
  const local = f * 4 - q;
  switch (q) {
    case 0:
      return { x: local * w, y: 0 };
    case 1:
      return { x: w, y: local * h };
    case 2:
      return { x: w * (1 - local), y: h };
    default:
      return { x: 0, y: h * (1 - local) };
  }
}

// ---------------------------------------------------------------------------
// The whole balloon: body + tail as one outline
// ---------------------------------------------------------------------------

export interface BubbleLayout {
  params: BubbleParams;
  bodyW: number;
  bodyH: number;
  /**
   * The drawing's own rectangle: the body plus whatever the tail reaches
   * beyond it. The element's box is the BODY; this rectangle only says how far
   * the drawing leaves it, so the view (and the markup) can place the SVG.
   */
  boxW: number;
  boxH: number;
  /** Where the body sits inside the drawing's rectangle. */
  bodyLeft: number;
  bodyTop: number;
  /** The frame the text lives in: the body for a rectangle, its inscribed rectangle for an ellipse. */
  frameW: number;
  frameH: number;
  /** Where the text's frame sits inside the body. */
  insetX: number;
  insetY: number;
  /** The one outline, in the ELEMENT's coordinates. */
  outline: Pt[];
  /** The body's outline only, in the element's coordinates (for the text). */
  bodyRing: Pt[];
  attach: Pt;
  tip: Pt;
  /** Outward normal and tangent where the tail leaves the body. */
  normal: Pt;
  tangent: Pt;
  /** The tail's own sideways direction: "along" to the right of the normal. */
  side: Pt;
  handles: { tip: Pt; base: Pt };
}

/**
 * Build the balloon. `params.width` and `params.height` are the body's, chosen
 * by the author: nothing here measures the text.
 */
export function bubbleLayout(params: BubbleParams): BubbleLayout {
  const bodyW = Math.max(1, Math.round(params.width));
  const bodyH = Math.max(1, Math.round(params.height));
  const ring = bubbleBodyRing(params.body, bodyW, bodyH, params.radius);
  const { at: cum, total } = ringLengths(ring);

  const A = bubblePointAt({ ...params, width: bodyW, height: bodyH }, params.at / 100);
  const near = ringNearest(ring, cum, total, A);
  const tangent = near.tangent;
  // Clockwise ring with y down: (ty, -tx) points out of the body.
  const normal = { x: tangent.y, y: -tangent.x };
  // The tail's own frame: out along the normal, "along" to its right.
  const side = { x: normal.y, y: -normal.x };

  const tail = clampTail(params);
  const tipBody = {
    x: A.x + normal.x * tail.out + side.x * tail.along,
    y: A.y + normal.y * tail.out + side.y * tail.along,
  };

  const halfBase = Math.max(BUBBLE_BASE_MIN / 2, params.base / 2);
  const s1 = near.s - halfBase;
  const s2 = near.s + halfBase;
  const bodyPath = ringSlice(ring, cum, total, s2, s1 + total);

  const bodyLeft = Math.max(0, -Math.min(0, tipBody.x));
  const bodyTop = Math.max(0, -Math.min(0, tipBody.y));
  const boxW = Math.max(bodyW + bodyLeft, bodyLeft + tipBody.x);
  const boxH = Math.max(bodyH + bodyTop, bodyTop + tipBody.y);

  const outline: Pt[] = [
    ...bodyPath.map((p) => ({ x: p.x + bodyLeft, y: p.y + bodyTop })),
    { x: tipBody.x + bodyLeft, y: tipBody.y + bodyTop },
  ];
  const attach = { x: A.x + bodyLeft, y: A.y + bodyTop };
  const tip = { x: tipBody.x + bodyLeft, y: tipBody.y + bodyTop };

  const frame = bubbleFrame({ ...params, width: bodyW, height: bodyH });

  return {
    params: { ...params, width: bodyW, height: bodyH },
    bodyW,
    bodyH,
    boxW: Math.round(boxW),
    boxH: Math.round(boxH),
    bodyLeft: Math.round(bodyLeft),
    bodyTop: Math.round(bodyTop),
    frameW: frame.w,
    frameH: frame.h,
    insetX: frame.insetX,
    insetY: frame.insetY,
    outline,
    bodyRing: ring.map((p) => ({ x: p.x + bodyLeft, y: p.y + bodyTop })),
    attach,
    tip,
    normal,
    tangent,
    side,
    handles: {
      tip,
      // A small step off the outline, so the handle is not under the border.
      base: { x: attach.x + normal.x * 12, y: attach.y + normal.y * 12 },
    },
  };
}

/** The tip's offset from the attachment point, clamped (outside, ≥ 8 px out). */
function clampTail(params: BubbleParams): { out: number; along: number } {
  let out = params.tailOut;
  let along = params.tailAlong;
  const len = Math.hypot(out, along);
  if (len > BUBBLE_TAIL_MAX) {
    out = (out / len) * BUBBLE_TAIL_MAX;
    along = (along / len) * BUBBLE_TAIL_MAX;
  }
  if (out < BUBBLE_TAIL_MIN_GAP) out = BUBBLE_TAIL_MIN_GAP;
  return { out, along };
}

/**
 * The ring's points from arc position `from` forward to `to` (`to` may wrap).
 *
 * The points must come out IN ARC ORDER: the ring is a closed list and the walk
 * starts in the middle of a segment, so a plain index scan would take the points
 * before the start first and cut across the body with a straight chord (seen on
 * screen, 01-11: a diagonal line through the balloon). The walk therefore starts
 * at the point AFTER the start and wraps around the list once.
 */
function ringSlice(ring: Pt[], at: number[], total: number, from: number, to: number): Pt[] {
  const span = total > 0 ? total : 1;
  const f = ((from % span) + span) % span;
  let t = to;
  while (t <= f) t += span;
  const n = ring.length;
  const out: Pt[] = [ringPointAt(ring, at, total, f).point];
  // The segment `f` falls in: at[i0] <= f < at[i0 + 1].
  let i0 = 0;
  while (i0 < n - 1 && at[i0 + 1] <= f) i0++;
  for (let k = 1; k <= n; k++) {
    const j = i0 + k;
    const wraps = Math.floor(j / n);
    const pos = at[j - wraps * n] + wraps * span;
    if (pos >= t) break;
    out.push(ring[j % n]);
  }
  out.push(ringPointAt(ring, at, total, t).point);
  return out;
}

// ---------------------------------------------------------------------------
// The two handles
// ---------------------------------------------------------------------------

/** New tip offset after a drag of (dx, dy) in the element's own axes. */
export function dragBubbleTip(
  params: BubbleParams,
  dx: number,
  dy: number,
): { tailOut: number; tailAlong: number } {
  const layout = bubbleLayout(params);
  const rel = {
    x: layout.tip.x - layout.attach.x + dx,
    y: layout.tip.y - layout.attach.y + dy,
  };
  const clamped = clampTail({
    ...params,
    tailOut: rel.x * layout.normal.x + rel.y * layout.normal.y,
    tailAlong: rel.x * layout.side.x + rel.y * layout.side.y,
  });
  return { tailOut: Math.round(clamped.out), tailAlong: Math.round(clamped.along) };
}

/**
 * New base width after a drag of (dx, dy) in the element's own axes: the hand
 * moves the handle along the body's outline, and both feet move with it.
 */
export function dragBubbleBase(
  params: BubbleParams,
  dx: number,
  dy: number,
): { base: number } {
  const layout = bubbleLayout(params);
  const run = dx * layout.tangent.x + dy * layout.tangent.y;
  const base = params.base + run * 2;
  return { base: Math.round(Math.min(BUBBLE_BASE_MAX, Math.max(BUBBLE_BASE_MIN, base))) };
}
