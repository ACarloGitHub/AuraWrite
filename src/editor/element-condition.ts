// ============================================================================
// Element text condition — how the text behaves around a block element.
//
// The three conditions (contract T1) are:
//   - wrapped:   the text flows around the element (and its caption/frame);
//   - unwrapped: the element occupies whole lines, text above and below;
//   - overlap:   the text ignores the element; depth decides who covers whom.
//
// Today the state is still stored as the `wrap` boolean. This is the ONE place
// that reads it into a named condition, so the screen, the page calculator, the
// print sheets and the exporters stop asking the raw attribute and a future
// tri-state change is a change here alone. Structural extraction: the mapping
// is exactly the old truthiness test.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export type TextCondition = "wrapped" | "unwrapped" | "overlap";

/** Normalise a stored value into a condition (defensive: unknown = wrapped). */
export function parseTextCondition(value: unknown): TextCondition {
  if (value === "wrapped" || value === "unwrapped" || value === "overlap") return value;
  // Back-compat with the stored boolean: only `false` meant "no wrap" = overlap.
  return value === false ? "overlap" : "wrapped";
}

/** The condition of a node, from its stored attribute. */
export function textConditionOf(node: PMNode | null | undefined): TextCondition {
  if (!node) return "wrapped";
  return parseTextCondition(node.attrs?.wrap);
}

/** True when the text flows around the element: a float/band claims room. */
export function isWrapping(condition: TextCondition): boolean {
  return condition === "wrapped";
}

/** True when the element ignores the text: depth alone decides who covers whom. */
export function isOverlap(condition: TextCondition): boolean {
  return condition === "overlap";
}
