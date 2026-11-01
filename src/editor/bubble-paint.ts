// ============================================================================
// Bubble paint — the ONE place that turns a balloon's numbers into a drawing.
//
// Body and tail are one path (see `bubble-geometry.ts`), so the contour and the
// shadow run around the whole balloon without a seam. Same idea as
// `shape-paint.ts`: the editor, the sheet and the exported HTML all call this
// function, so the balloon cannot be one thing on screen and another on paper.
//
// Vector, not bitmap: the printer keeps its resolution.
// ============================================================================

import { type BubbleLayout } from "./bubble-geometry";
import { shapeShadowOf, type ShapeShadow } from "./shape-paint";

const SVG_NS = "http://www.w3.org/2000/svg";

let bubbleShadowSeq = 0;

/**
 * Build the drawing of one balloon, in the element's own coordinates (the body
 * starts at `layout.bodyLeft`, `layout.bodyTop`).
 */
export function buildBubbleSvg(
  layout: BubbleLayout,
  shadow?: ShapeShadow | null,
): SVGSVGElement {
  const params = layout.params;
  const width = Math.max(1, layout.boxW);
  const height = Math.max(1, layout.boxH);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // The contour sits half a stroke outside the outline and the shadow is drawn
  // beyond the box: the drawing must be allowed to leave its own rectangle.
  svg.style.overflow = "visible";

  const layer = document.createElementNS(SVG_NS, "g");
  if (shadow) {
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", `aw-bubble-shadow-${++bubbleShadowSeq}`);
    filter.setAttribute("x", "-50%");
    filter.setAttribute("y", "-50%");
    filter.setAttribute("width", "200%");
    filter.setAttribute("height", "200%");
    const drop = document.createElementNS(SVG_NS, "feDropShadow");
    drop.setAttribute("dx", String(shadow.dx));
    drop.setAttribute("dy", String(shadow.dy));
    drop.setAttribute("stdDeviation", String(Math.max(0.01, shadow.blur / 2)));
    drop.setAttribute("flood-color", shadow.color);
    drop.setAttribute("flood-opacity", String(shadow.opacity));
    filter.appendChild(drop);
    svg.appendChild(filter);
    layer.setAttribute("filter", `url(#${filter.getAttribute("id")})`);
  }
  svg.appendChild(layer);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", bubblePathData(layout));
  // An empty fill means a transparent body: the tail is then an outline that
  // leaves the body and comes back, with nothing painted inside.
  path.setAttribute("fill", params.fill || "none");
  path.setAttribute("fill-rule", "nonzero");
  if (params.strokeWidth > 0) {
    path.setAttribute("stroke", params.strokeColor);
    path.setAttribute("stroke-width", String(params.strokeWidth));
    path.setAttribute("stroke-linejoin", "round");
    if (params.dash === "dashed") path.setAttribute("stroke-dasharray", "6 4");
    else if (params.dash === "dotted") path.setAttribute("stroke-dasharray", "0.1 4");
  } else {
    path.setAttribute("stroke", "none");
  }
  layer.appendChild(path);
  return svg;
}

/** The path of the balloon in the element's coordinates, as SVG path data. */
export function bubblePathData(layout: BubbleLayout): string {
  const points = layout.outline;
  if (points.length < 3) return "";
  const round = (n: number): string => (Math.round(n * 10) / 10).toString();
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${round(points[i].x)} ${round(points[i].y)}`;
  }
  return `${d} Z`;
}

/** The shadow a balloon carries, from the shared effect attributes, or null. */
export function bubbleShadowOf(attrs: Record<string, unknown> | undefined): ShapeShadow | null {
  return shapeShadowOf(attrs);
}

/**
 * A short signature of everything the drawing depends on: the view redraws only
 * when it changes.
 */
export function bubblePaintKey(
  layout: BubbleLayout,
  shadow?: ShapeShadow | null,
): string {
  const p = layout.params;
  return [
    p.body,
    p.fill,
    p.strokeColor,
    p.strokeWidth,
    p.dash,
    p.radius,
    layout.boxW,
    layout.boxH,
    p.at,
    p.tailOut,
    p.tailAlong,
    p.base,
    shadow ? `${shadow.dx},${shadow.dy},${shadow.blur},${shadow.color},${shadow.opacity}` : "",
  ].join("|");
}
