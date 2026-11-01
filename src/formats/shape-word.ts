// ============================================================================
// Shape → bitmap, for the one channel that cannot take vectors: Word.
//
// The .docx format has no idea of our shapes, and today they simply vanished from
// the exported file. Word does understand a picture, so the drawing is painted
// into a canvas at twice its size (the printer's own resolution) and handed over
// as a PNG: the choice belongs to the channel, there is no button for it.
//
// The bitmap carries the box's size plus a margin, so the contour's half stroke
// and the shadow are not cut off; the same margin is what Word is told the
// picture measures, or the drawing would come out smaller than it is.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { buildShapeSvg, shapeShadowOf } from "../editor/shape-paint";
import { normalizeShapeParams, shapeBoxSize } from "../editor/shape-params";

export interface ShapeBitmap {
  bytes: Uint8Array;
  /** Size of the picture in page units, margin included. */
  widthPx: number;
  heightPx: number;
}

/** Room around the drawing: half a stroke plus the shadow's reach. */
function marginOf(node: PMNode): number {
  const params = normalizeShapeParams(node.attrs as Record<string, unknown>);
  return Math.ceil(params.strokeWidth + 14);
}

/** The drawing as a PNG at twice its size; null when the browser cannot paint. */
export async function shapeBitmap(node: PMNode): Promise<ShapeBitmap | null> {
  const attrs = node.attrs as Record<string, unknown>;
  const params = normalizeShapeParams(attrs);
  const box = shapeBoxSize(attrs);
  if (box.width <= 0 || box.height <= 0) return null;

  const pad = marginOf(node);
  const widthPx = Math.round(box.width) + pad * 2;
  const heightPx = Math.round(box.height) + pad * 2;
  const svg = buildShapeSvg(params, box, shapeShadowOf(attrs));
  svg.setAttribute("width", String(widthPx));
  svg.setAttribute("height", String(heightPx));
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${widthPx} ${heightPx}`);

  const source = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  const image = await loadImage(url);
  if (!image) return null;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPx * scale);
  canvas.height = Math.round(heightPx * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), widthPx, heightPx };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
