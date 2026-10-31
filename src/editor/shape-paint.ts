// ============================================================================
// Shape paint (chapter A, step S1) — the ONE place that turns shape numbers into
// a drawing.
//
// The node view on screen and the node's own markup (print sheet, HTML export,
// native file) both call this function, so a shape cannot be a line in the editor
// and an arrow on paper. Vector, not bitmap: the sheet keeps the printer's
// resolution (drawn-shapes-project §8).
// ============================================================================

import { shapeGeometry } from "./shape-geometry";
import type { ShapeBox, ShapeParams } from "./shape-params";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the drawing of one shape inside its own box.
 *
 * @param params the shape's numbers
 * @param box    the size of the box the shape is drawn in
 */
export function buildShapeSvg(params: ShapeParams, box: ShapeBox): SVGSVGElement {
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.display = "block";

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
    svg.appendChild(line);
  }
  if (geometry.head) {
    const head = document.createElementNS(SVG_NS, "polygon");
    head.setAttribute("points", geometry.head.map(([x, y]) => `${x},${y}`).join(" "));
    head.setAttribute("fill", params.strokeColor);
    svg.appendChild(head);
  }
  return svg;
}

/**
 * A short signature of everything a drawing depends on: the view redraws only
 * when this changes, so a transaction that touches something else costs no DOM
 * work.
 */
export function shapePaintKey(params: ShapeParams, box: ShapeBox): string {
  return [params.kind, box.width, box.height, params.strokeWidth, params.strokeColor, params.headSize].join("|");
}
