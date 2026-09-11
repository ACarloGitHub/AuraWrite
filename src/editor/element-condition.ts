// ============================================================================
// Element text condition — how the text behaves around a block element.
//
// The three conditions (contract T1) are:
//   - wrapped:   the text flows around the element (and its caption/frame);
//   - unwrapped: the element occupies whole lines, text above and below;
//   - overlap:   the text ignores the element; depth decides who covers whom.
//
// This is the ONE place the stored state is read and written. The stored value
// is now the condition itself; old documents that still carry the boolean are
// still understood (`true` -> wrapped, `false` -> overlap), so nothing that was
// already on disk needs a migration pass.
//
// The D10 HTML marker keeps the historical `data-wrap` name:
//   present and empty = wrapped; "unwrapped" = unwrapped; absent = overlap.
// An old file with `data-wrap` (no value) therefore re-imports as wrapped,
// exactly as it did before.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export type TextCondition = "wrapped" | "unwrapped" | "overlap";

const CONDITIONS: readonly TextCondition[] = ["wrapped", "unwrapped", "overlap"];

/** Normalise a stored value into a condition (defensive: unknown = wrapped). */
export function parseTextCondition(value: unknown): TextCondition {
  if (typeof value === "string" && (CONDITIONS as readonly string[]).includes(value)) {
    return value as TextCondition;
  }
  // Back-compat with the stored boolean: only `false` meant "no wrap".
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

/** True when the element occupies whole lines (text above and below). */
export function isUnwrapped(condition: TextCondition): boolean {
  return condition === "unwrapped";
}

/** True when the element ignores the text: depth alone decides who covers whom. */
export function isOverlap(condition: TextCondition): boolean {
  return condition === "overlap";
}

/** The `data-wrap` marker value for export: null means "do not emit". */
export function textConditionMarker(condition: TextCondition): string | null {
  if (condition === "wrapped") return "";
  if (condition === "unwrapped") return "unwrapped";
  return null;
}

/** Read the condition from a `data-wrap` marker value (re-import side). */
export function textConditionFromMarker(value: string | null | undefined): TextCondition {
  if (value === null || value === undefined) return "overlap";
  return value === "unwrapped" ? "unwrapped" : "wrapped";
}
