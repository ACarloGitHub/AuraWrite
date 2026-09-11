// ============================================================================
// Text obstacles — how wide a text line is at a given height.
//
// One question, answered in one place: "at this height on the flow axis, how
// much room does the text have?". Everything that reserves room in the column
// is an OBSTACLE with a side, a width and a vertical span:
//
//  - a float already in the flow (image/figure with wrap, aligned left/right);
//  - a free element that claims a band from the text while it is dragged around.
//
// The answer is what the page count, the screen and the paper must all agree
// on, so it lives here and not inside the page walk. Extracted from the
// calculator during the T1 reordering (2026-09-10), because the three text
// conditions Carlo defined - Wrapped, Unwrapped, Overlap - are three different
// answers to this same question, and writing them inside a 1650-line file three
// times is how the two surfaces drift apart.
//
// What this module is NOT allowed to do: refuse an obstacle, impose a minimum
// width, or merge two claims. Carlo's collaudo of F3.2b settled that (the
// refused-second-element rule must never come back). The only thing that is
// ever booked as unwritable is the strip where two OPPOSITE obstacles would
// meet with no room for a line - which is what the browser does too.
//
// Terminologia (AGENTS.md regola 12):
//  - banda / band: the rectangle one obstacle claims from the text;
//  - ostacolo / obstacle: anything that shortens lines;
//  - striscia solida / solid strip: a height where no line fits at all.
// ============================================================================

/** Which side of the column an obstacle occupies. */
export type ObstacleSide = "left" | "right";

/** One claim on the column: this side, this width, over this vertical span. */
export interface Obstacle {
  side: ObstacleSide;
  /** Column width it claims, air gap included. */
  widthPx: number;
  /** Flow y of its top edge. */
  y0: number;
  /** Flow y of its bottom edge. */
  y1: number;
}

/**
 * Air kept between an element and the text passing it, in px. The same value
 * the renderer uses for its float margins (styles.css): if the two disagree,
 * the reserved space is narrower than the drawn element and the text touches
 * it.
 */
export const OBSTACLE_MARGIN_PX = 12;

/**
 * Narrowest line the calculator will ever report. It is a floor, not a
 * refusal: a line narrower than this is still reported as this wide, so the
 * text keeps flowing instead of disappearing.
 */
export const MIN_LINE_WIDTH_PX = 120;

/** A height range where no line fits at all. */
export interface SolidStrip {
  y0: number;
  y1: number;
}

/**
 * The obstacles, indexed for the two questions the page walk asks: "how wide
 * at this height" (thousands of times per walk) and "what is solid" (once).
 */
export class ObstacleSet {
  private readonly items: Obstacle[];
  private readonly solidStrips: SolidStrip[];
  private readonly columnWidth: number;

  /**
   * @param columnWidth the text column
   * @param obstacles   every claim on the column (flow floats AND free bands)
   * @param solidFrom   the claims that may pair up into an unwritable strip.
   * @param extraSolid  strips where no line fits at all, stated directly (an
   *                    Unwrapped element claims the whole width, so no pair of
   *                    facing obstacles is involved).
   *
   * `solidFrom` is a separate argument on purpose, and it is not cosmetic: the
   * page count has always built the unwritable strips from the FREE BANDS
   * alone, never from the wrapped images of the flow. Widening it to every
   * obstacle introduced strips where there were none, moved the text, and
   * silently dropped a page divider (the bench's I5 invariant caught it). What
   * pairs up into "no line fits here" is a property of the bands, not of the
   * column in general.
   */
  constructor(
    columnWidth: number,
    obstacles: Obstacle[],
    solidFrom: Obstacle[] = obstacles,
    extraSolid: SolidStrip[] = [],
  ) {
    this.columnWidth = columnWidth;
    this.items = obstacles;
    const strips = buildSolidStrips(columnWidth, solidFrom);
    this.solidStrips = extraSolid.length ? strips.concat(extraSolid) : strips;
  }

  /** Every obstacle, in the order given. */
  all(): readonly Obstacle[] {
    return this.items;
  }

  /**
   * Width available to a text line whose TOP edge is at `y`.
   *
   * The obstacles overlapping that height each take their width off the
   * column. Two obstacles on the SAME side do not stack here (the browser
   * queues them vertically instead; `queueBottom` answers that question for
   * the caller placing a new float).
   */
  widthAt(y: number): number {
    let used = 0;
    for (const o of this.items) {
      if (y >= o.y0 && y < o.y1) used += o.widthPx;
    }
    return Math.max(MIN_LINE_WIDTH_PX, this.columnWidth - used);
  }

  /** True when any obstacle overlaps the height range [from, to). */
  overlaps(from: number, to: number): boolean {
    for (const o of this.items) {
      if (from < o.y1 && to > o.y0) return true;
    }
    return false;
  }

  get solid(): readonly SolidStrip[] {
    return this.solidStrips;
  }

  /** True when the range [from, to) crosses a strip where no line fits. */
  crossesSolid(from: number, to: number): boolean {
    return this.solidStrips.some((z) => from < z.y1 && to > z.y0);
  }

  /**
   * Move a line's top edge below every solid strip it would fall into.
   * Repeated until stable: moving past one strip can land the line in another.
   */
  pushPastSolid(y: number, lineHeightPx: number): number {
    let out = y;
    for (let guard = 0; guard <= this.solidStrips.length; guard++) {
      let moved = false;
      for (const z of this.solidStrips) {
        if (out < z.y1 && out + lineHeightPx > z.y0) {
          out = z.y1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return out;
  }

  /**
   * Bottom edge of the obstacles on `side` that overlap [y, y+h).
   *
   * A new float cannot be written where an obstacle on its own side already
   * sits: the browser queues it BELOW, and the page count has to say the same
   * thing or the sheet overflows. This is placement, not refusal - the new
   * element keeps its full band, it simply starts lower.
   */
  queueBottom(side: ObstacleSide, y: number, heightPx: number): number {
    let bottom = 0;
    for (const o of this.items) {
      if (o.side === side && o.y0 < y + heightPx && o.y1 > y) bottom = Math.max(bottom, o.y1);
    }
    return bottom;
  }
}

/**
 * Build the height ranges where two OPPOSITE obstacles would meet with no room
 * left for a line.
 *
 * What the browser does with two floats facing each other over a gap too
 * narrow: it does NOT write a two-pixel line between them, it moves the line
 * BELOW both. That is CSS, not a rule invented here, and the page count has to
 * say what the screen shows. So the overlap of two facing obstacles is booked
 * as solid: no line lives there, and the text resumes under it.
 *
 * This is NOT the refusal Carlo rejected in the F3.2b collaudo: no obstacle
 * loses its band, both keep their own, both shorten the text. Only the strip
 * where the two claims would meet is unwritable.
 */
function buildSolidStrips(columnWidth: number, obstacles: Obstacle[]): SolidStrip[] {
  const out: SolidStrip[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i];
      const b = obstacles[j];
      if (a.side === b.side) continue;
      const y0 = Math.max(a.y0, b.y0);
      const y1 = Math.min(a.y1, b.y1);
      if (y1 <= y0) continue;
      if (columnWidth - a.widthPx - b.widthPx >= MIN_LINE_WIDTH_PX) continue;
      out.push({ y0, y1 });
    }
  }
  return out;
}

/**
 * The band a free element claims from the text: which side it sits on and how
 * wide it is, from the element's own drawn rectangle and the column.
 *
 * Returns null only when the GEOMETRY says there is nothing to claim: no
 * usable size, the box entirely outside the column, or the box covering the
 * column (no side is left). It never refuses an element and never imposes a
 * minimum width - see the note about the F3.2b collaudo above.
 *
 * The text keeps the WIDER side. A browser cannot split one line into a left
 * and a right half, so a centred element shortens lines from one side only.
 */
export function bandOfRect(input: {
  columnWidth: number;
  /** Column-side edge the element's offset is measured from. */
  xFrom: "left" | "center" | "right";
  /** px from that edge, positive to the right. */
  xOff: number;
  elementWidthPx: number;
  elementHeightPx: number;
  /** Flow y of the element's DRAWN top edge, sign included. */
  drawnTop: number;
}): Obstacle | null {
  const { columnWidth: cw, elementWidthPx: w, elementHeightPx: h, drawnTop, xFrom, xOff } = input;
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return null;
  if (!Number.isFinite(cw) || cw <= 0 || !Number.isFinite(drawnTop)) return null;

  const left = (xFrom === "left" ? 0 : xFrom === "center" ? (cw - w) / 2 : cw - w) + xOff;
  const right = left + w;
  const roomLeft = Math.max(0, left);
  const roomRight = Math.max(0, cw - right);
  if (roomLeft <= 0 && roomRight <= 0) return null; // nothing inside the column

  const side: ObstacleSide = roomLeft >= roomRight ? "right" : "left";
  const claimed = (side === "right" ? cw - roomLeft : cw - roomRight) + OBSTACLE_MARGIN_PX;
  if (claimed <= 0) return null;
  return {
    side,
    widthPx: Math.round(Math.min(claimed, cw)),
    y0: Math.round(drawnTop),
    y1: Math.round(drawnTop + h),
  };
}
