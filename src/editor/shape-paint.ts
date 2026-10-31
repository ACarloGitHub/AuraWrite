// ============================================================================
// Shape paint — the ONE place that turns shape numbers into a drawing.
//
// The node view on screen and the node's own markup (print sheet, HTML export,
// native file) both call this function, so a shape cannot be a line in the
// editor and an arrow on paper. Vector, not bitmap: the sheet keeps the
// printer's resolution (drawn-shapes-project §8).
//
// Two colours, as in any vector drawing: the STROKE is the contour, the FILL is
// the inside of the closed part. An empty fill means "the inside takes the
// contour's colour", which is the plain black arrow. The shadow is drawn on the
// drawing itself, with a filter, so it prints like the rest.
// ============================================================================

import { shapeGeometry } from "./shape-geometry";
import type { ShapeBox, ShapeParams } from "./shape-params";
import { bearingToOffset, normalizeImageStyle } from "./image-style";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The shadow a shape carries, in the drawing's own terms. */
export interface ShapeShadow {
  dx: number;
  dy: number;
  blur: number;
  color: string;
  /** 0..1 */
  opacity: number;
}

/** Ids must be unique inside one document: inline SVGs share their id space. */
let shadowSeq = 0;

/** The shadow of a node, from the shared effect attributes, or null. */
export function shapeShadowOf(attrs: Record<string, unknown> | undefined): ShapeShadow | null {
  const s = normalizeImageStyle(attrs ?? {});
  if (!s.shadowEnabled) return null;
  const { dx, dy } = bearingToOffset((s.shadowAngle + 180) % 360, s.shadowDistance);
  const opacity = Math.max(0, Math.min(100, Number(s.shadowOpacity))) / 100;
  if (opacity <= 0) return null;
  return { dx, dy, blur: Math.max(0, s.shadowBlur), color: s.shadowColor, opacity };
}

/**
 * Build the drawing of one shape inside its own box.
 *
 * @param params the shape's numbers
 * @param box    the size of the box the shape is drawn in
 * @param shadow the shadow on the drawing, when the element has one
 */
export function buildShapeSvg(params: ShapeParams, box: ShapeBox, shadow?: ShapeShadow | null): SVGSVGElement {
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.display = "block";
  // The contour may sit half a stroke outside the box's edge and the shadow is
  // drawn beyond it: the drawing must be allowed to leave its own rectangle.
  svg.style.overflow = "visible";

  const layer = document.createElementNS(SVG_NS, "g");
  if (shadow) {
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", `aw-shape-shadow-${++shadowSeq}`);
    // Room for the shadow, or the browser clips it at the filter's own edge.
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

  // The contour's pattern is the user's choice; the drawing is the same.
  const dashArray = params.dash === "dashed" ? "6 4" : params.dash === "dotted" ? "0.1 4" : null;

  const geometry = shapeGeometry(params, box);
  if (geometry.shaft) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(geometry.shaft.x1));
    line.setAttribute("y1", String(geometry.shaft.y1));
    line.setAttribute("x2", String(geometry.shaft.x2));
    line.setAttribute("y2", String(geometry.shaft.y2));
    line.setAttribute("stroke", params.strokeColor);
    line.setAttribute("stroke-width", String(params.strokeWidth));
    line.setAttribute("stroke-linecap", "round");
    if (dashArray) line.setAttribute("stroke-dasharray", dashArray);
    layer.appendChild(line);
  }
  if (geometry.outline) {
    // One closed outline: body and head together. The inside is the fill, the
    // contour is the stroke — the two are independent of each other.
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", geometry.outline.map(([x, y]) => `${x},${y}`).join(" "));
    polygon.setAttribute("fill", params.fill || params.strokeColor);
    polygon.setAttribute("stroke", params.strokeColor);
    polygon.setAttribute("stroke-width", String(params.strokeWidth));
    if (dashArray) {
      polygon.setAttribute("stroke-dasharray", dashArray);
      polygon.setAttribute("stroke-linecap", "round");
    } else {
      polygon.setAttribute("stroke-linejoin", "round");
    }
    layer.appendChild(polygon);
  }
  return svg;
}

/**
 * A short signature of everything a drawing depends on: the view redraws only
 * when this changes, so a transaction that touches something else costs no DOM
 * work.
 */
export function shapePaintKey(
  params: ShapeParams,
  box: ShapeBox,
  shadow?: ShapeShadow | null
): string {
  return [
    params.kind,
    box.width,
    box.height,
    params.strokeWidth,
    params.strokeColor,
    params.fill,
    params.headSize,
    params.bodyHeight,
    params.dash,
    params.curve,
    shadow ? `${shadow.dx},${shadow.dy},${shadow.blur},${shadow.color},${shadow.opacity}` : "",
  ].join("|");
}
