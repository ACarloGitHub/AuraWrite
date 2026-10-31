// ============================================================================
// Element types (TT) — the ONE table of the block elements that live in the
// document: photo, figure, styled box and the drawn shape.
//
// Every part of the program that has to know WHAT an element is asks here
// instead of keeping its own little list of names. A new type adds one row;
// the places that still decide per type switch over `ElementKind`, so a
// forgotten branch does not compile (see `assertNeverKind`).
//
// Behaviour is unchanged for the three types that existed before: the table
// only states what the code already did, one fact in one place.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export const ELEMENT_KINDS = ["image", "figure", "styled_box", "shape"] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** What an element can do, beyond having a size and a depth. */
export interface ElementCapabilities {
  /** Editable caption under/over the photo (figure only). */
  caption: boolean;
  /** Corner drag keeps the photo's proportions (photo and figure). */
  aspectLock: boolean;
  /** The element can carry a fill colour (the box). */
  background: boolean;
  /** The element can turn and mirror (every element). */
  rotation: boolean;
  /**
   * True when mirroring the element vertically changes anything. A drawn line
   * or arrow is symmetric about its own axis, so for them the command would do
   * nothing: a control that does nothing is not shown (Carlo, 31-10).
   */
  flipVertical: boolean;
}

export interface ElementType {
  kind: ElementKind;
  /** The name the Layers window shows for this kind. */
  layerName: string;
  /** The attribute that carries the element's own width. */
  widthAttr: "width" | "widthPx";
  /**
   * True when the element's own box carries the width in the DOM (the box);
   * false when an inner <img> does (photo and figure).
   */
  widthOnOwnBox: boolean;
  /** True when the element can be taken out of the text flow. */
  freeCapable: boolean;
  /**
   * True when the frame is drawn INSIDE the element's box (the box border);
   * false when it is an outline drawn OUTSIDE it (photo and figure), where it
   * claims extra room around the element.
   */
  frameInside: boolean;
  /** Which measured block spacing follows the element in the page count. */
  spacingKey: "image" | "figure" | "other";
  /** Which section of the secondary toolbar the element shows. */
  toolbarSection: "image" | "box" | "shape";
  /** How the Word export treats the element today. */
  word: "text" | "none";
  capabilities: ElementCapabilities;
}

export const ELEMENT_TYPES = {
  image: {
    kind: "image",
    layerName: "Image",
    widthAttr: "width",
    widthOnOwnBox: false,
    freeCapable: true,
    frameInside: false,
    spacingKey: "image",
    toolbarSection: "image",
    word: "text",
    capabilities: { caption: false, aspectLock: true, background: false, rotation: true, flipVertical: true },
  },
  figure: {
    kind: "figure",
    layerName: "Figure",
    widthAttr: "width",
    widthOnOwnBox: false,
    freeCapable: true,
    frameInside: false,
    spacingKey: "figure",
    toolbarSection: "image",
    word: "text",
    capabilities: { caption: true, aspectLock: true, background: false, rotation: true, flipVertical: true },
  },
  styled_box: {
    kind: "styled_box",
    layerName: "Box",
    widthAttr: "widthPx",
    widthOnOwnBox: true,
    freeCapable: true,
    frameInside: true,
    spacingKey: "other",
    toolbarSection: "box",
    word: "text",
    capabilities: { caption: false, aspectLock: false, background: true, rotation: true, flipVertical: true },
  },
  shape: {
    kind: "shape",
    layerName: "Shape",
    // The shape owns its box, like the box, but keeps the common width name so
    // the free engine and the page count read it with no extra branch.
    widthAttr: "width",
    widthOnOwnBox: true,
    freeCapable: true,
    // No frame of its own: the drawn stroke IS the outline, inside the box.
    frameInside: true,
    spacingKey: "other",
    toolbarSection: "shape",
    // Word has no shape of its own; the bitmap copy is step S5 of the chapter.
    word: "none",
    capabilities: { caption: false, aspectLock: false, background: false, rotation: true, flipVertical: false },
  },
} as const satisfies Record<ElementKind, ElementType>;

/** True when the name is one of the table's kinds. */
export function isElementKind(name: string | null | undefined): name is ElementKind {
  return !!name && (ELEMENT_KINDS as readonly string[]).includes(name);
}

/** The table row for a node name (null when it is not an element). */
export function elementTypeByName(name: string | null | undefined): ElementType | null {
  return isElementKind(name) ? ELEMENT_TYPES[name] : null;
}

/** The table row for a node (null for everything that is not an element). */
export function elementTypeOf(node: PMNode | null | undefined): ElementType | null {
  return node ? elementTypeByName(node.type.name) : null;
}

/**
 * Compile-time guard: a new kind makes every exhaustive switch fail here, at
 * the point that must decide what to do with it, instead of silently falling
 * into the default branch.
 */
export function assertNeverKind(kind: never): never {
  throw new Error(`unhandled element kind: ${String(kind)}`);
}
