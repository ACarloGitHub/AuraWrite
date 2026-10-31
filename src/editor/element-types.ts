// ============================================================================
// Element types (TT) — the ONE table of the block elements that live in the
// document: photo, figure, styled box (and, tomorrow, the drawn shape).
//
// Every part of the program that has to know WHAT an element is asks here
// instead of keeping its own little list of names. A new type adds one row;
// the places that still decide per type switch over `ElementKind`, so a
// forgotten branch does not compile (see `assertNeverKind`).
//
// Behaviour is unchanged for the three types that exist today: the table only
// states what the code already did, one fact in one place.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export const ELEMENT_KINDS = ["image", "figure", "styled_box"] as const;

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
  toolbarSection: "image" | "box";
  /** How the Word export treats the element today. */
  word: "text";
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
    capabilities: { caption: false, aspectLock: true, background: false, rotation: true },
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
    capabilities: { caption: true, aspectLock: true, background: false, rotation: true },
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
    capabilities: { caption: false, aspectLock: false, background: true, rotation: true },
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
