// ============================================================================
// Free-layout drawing (F3) — how a free element is placed on screen.
//
// The element keeps living in the document tree after its anchor (that IS the
// anchor relation, contract §5), but it is painted outside the flow: absolutely
// positioned inside the editor's text column, at
//
//     top  = anchor's top + yOff
//     left = freeLeftPx(column, spec, width)
//     z-index = zLevel
//
// so the numbers on screen, the numbers the grouping uses and the numbers the
// print path will use (F3.2) all come from the same rule.
//
// The anchor element is PASSED IN by the plugin, which walks the document with
// `freeLayoutMap`. Guessing it from the DOM was the first version's mistake:
// the sibling before a picture can be another picture, or one of the page-break
// widgets the editor inserts between blocks, and neither is an anchor.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { freeElementWidth, freeLeftPx, freeTopPx, parseFreeSpec, stackDepthOf, zLevelOf, type FreeSpec, type FreeXFrom } from "./free-layout";

/** The style keys this module owns; clearing must not touch anything else. */
const OWNED_STYLE_KEYS = [
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "margin",
  "marginLeft",
  "marginRight",
  "zIndex",
  "float",
] as const;

/** Kept here for the importers that already used it (free-commands, free-drag). */
export { freeElementWidth } from "./free-layout";

/** Remove every style this module has ever applied. */
export function clearFreeLayout(dom: HTMLElement): void {
  if (dom.dataset.awFree !== "1") return;
  delete dom.dataset.awFree;
  for (const key of OWNED_STYLE_KEYS) {
    dom.style.removeProperty(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  }
}

/**
 * Paint the element according to its `free` attribute.
 *
 * @param anchorDom the DOM box of the text block this element hangs from, or
 *        null when the document has no text block before it (an element at the
 *        very top: it then measures from the start of the column).
 */
export function applyFreeLayout(
  dom: HTMLElement,
  node: PMNode,
  anchorDom: HTMLElement | null,
): void {
  const spec: FreeSpec | null = parseFreeSpec(node.attrs?.free);
  if (!spec) {
    clearFreeLayout(dom);
    return;
  }
  const host = dom.parentElement;
  if (!host) return;

  // Width first: measured while still in flow if the node carries no width.
  const width = freeElementWidth(node) ?? Math.round(dom.offsetWidth);
  if (width <= 0) return;

  const column = textColumn(host);
  const anchorTop = anchorDom && anchorDom !== dom ? anchorDom.offsetTop : 0;
  const top = freeTopPx(anchorTop, spec);
  const left = freeLeftPx({ left: column.left, width: column.width }, spec, width);

  // Measuring happens before the switch: reading offsetWidth after going
  // absolute would feed the shrink-to-fit width back on the next update.
  dom.style.position = "absolute";
  dom.style.top = `${Math.round(top)}px`;
  dom.style.left = `${Math.round(left)}px`;
  dom.style.right = "auto";
  dom.style.bottom = "auto";
  dom.style.width = `${width}px`;
  dom.style.margin = "0";
  // Negative for "behind the words", positive for "in front" (see
  // stackDepthOf: a positive number alone can never go under the text).
  dom.style.zIndex = String(stackDepthOf(zLevelOf(node)));
  dom.style.float = "none";
  dom.dataset.awFree = "1";
}

/**
 * Paint an element in the flow whose condition is Overlap (T1.2): it leaves the
 * page flow but keeps the place it already had, so the text that follows moves
 * up and passes over or under it according to the depth. `top: auto` is the
 * whole trick: for an absolutely positioned box it means "the static position",
 * i.e. exactly where the box sat before it was taken out of the flow.
 */
export function applyOverlapLayout(dom: HTMLElement, node: PMNode): void {
  const host = dom.parentElement;
  if (!host) return;
  const width = freeElementWidth(node) ?? Math.round(dom.offsetWidth);
  if (width <= 0) return;
  const column = textColumn(host);
  const align = String(node.attrs?.align ?? "center");
  const xFrom: FreeXFrom = align === "left" || align === "right" ? align : "center";
  const left = freeLeftPx({ left: column.left, width: column.width }, { xFrom, xOff: 0, yOff: 0, g: "" }, width);

  dom.style.position = "absolute";
  dom.style.top = "auto"; // static position: the place it already occupied
  dom.style.left = `${Math.round(left)}px`;
  dom.style.right = "auto";
  dom.style.bottom = "auto";
  dom.style.width = `${width}px`;
  dom.style.margin = "0";
  dom.style.zIndex = String(stackDepthOf(zLevelOf(node)));
  dom.style.float = "none";
  dom.dataset.awOverlap = "1";
}

/** Remove every style `applyOverlapLayout` has ever applied. */
export function clearOverlapLayout(dom: HTMLElement): void {
  if (dom.dataset.awOverlap !== "1") return;
  delete dom.dataset.awOverlap;
  for (const key of OWNED_STYLE_KEYS) {
    dom.style.removeProperty(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  }
}

/**
 * Depth of an in-flow element that claims space (Wrapped / Unwrapped) — Carlo,
 * 2026-09-11: every element has a depth, not only the free ones. It stays in
 * the flow, but `position: relative` makes z-index apply without moving it (no
 * offset is set), so the Layers order decides who covers whom even between
 * in-flow elements.
 */
export function applyFlowDepth(dom: HTMLElement, level: number): void {
  dom.style.position = "relative";
  dom.style.zIndex = String(stackDepthOf(level));
  dom.dataset.awFlowDepth = "1";
}

/** Remove the depth styles `applyFlowDepth` has applied. */
export function clearFlowDepth(dom: HTMLElement): void {
  if (dom.dataset.awFlowDepth !== "1") return;
  delete dom.dataset.awFlowDepth;
  dom.style.removeProperty("position");
  dom.style.removeProperty("z-index");
}

/** The text column of the editor: content box of the scrollable host. */
export function textColumn(host: HTMLElement): { left: number; width: number } {
  const cs = getComputedStyle(host);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const width = Math.max(1, host.clientWidth - padLeft - padRight);
  return { left: padLeft, width };
}
