// ============================================================================
// Bubble node view — the speech balloon on screen.
//
// The model is the note's: a box with its own width and height, real text
// inside, and the main toolbar's commands working on that text. What the bubble
// adds is the tail: a drawing that leaves the box, so the box keeps the
// author's measure and the hand can pull the four corners like an image's.
//
// What it does NOT do: position, depth and anchoring. Those live in the free
// engine and reach this DOM exactly as they reach a photo's.
//
// The drawing lives in an SVG placed around the box (the tail may leave it) and
// BEHIND the text: the text frame is positioned, so it paints after the
// drawing and the fill can never cover the words.
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { applyWrapMarker, selectNodeAt, setStyleCached, transformStyleOf } from "./element-view";
import {
  createCornerHandles,
  createRotateHandle,
  createShapeHandles,
  isCornerHandle,
  isRotateHandle,
  isShapeHandle,
  startCornerResize,
  startRotateDrag,
  startShapePartDrag,
  type Corner,
} from "./element-handles";
import { isWrapping, parseTextCondition } from "./element-condition";
import { floatGapPx } from "./text-obstacles";
import { buildBubbleSvg, bubblePaintKey, bubbleShadowOf } from "./bubble-paint";
import {
  BUBBLE_HEIGHT_MIN,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  BUBBLE_WIDTH_MIN,
  bubbleLayout,
  dragBubbleBase,
  dragBubbleTip,
  normalizeBubbleParams,
  type BubbleLayout,
  type BubbleParams,
} from "./bubble-geometry";
import { setBubbleAttrs } from "./bubble-commands";
import { clampFreeOffset, parseFreeSpec } from "./free-layout";

/** The two handles the balloon's tail has. */
const PARTS = ["tip", "base"] as const;
type BubblePart = (typeof PARTS)[number];

export class BubbleNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private grip: HTMLElement;
  private corners: HTMLElement[] = [];
  private handles: Record<string, HTMLElement> | null = null;
  private svg: SVGSVGElement | null = null;
  private paintKey = "";
  private applied: Record<string, string | undefined> = {};
  /** Its own cache: the text frame and the element are different boxes. */
  private contentApplied: Record<string, string | undefined> = {};

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "aw-bubble";

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "aw-bubble__content";

    this.grip = document.createElement("div");
    this.grip.className = "aw-bubble__grip";
    this.grip.title = "Drag to move";

    this.dom.append(this.contentDOM, this.grip);

    // The image's own four corners: the balloon has a width and a height of its
    // own, so both axes are the hand's to pull.
    this.corners = createCornerHandles(this.dom, (e, corner) => this.onCornerGrab(e, corner));
    // The tail's two handles ride on the same look and the same gestures.
    this.handles = createShapeHandles(this.dom, PARTS, (e, part) =>
      this.onHandleGrab(e, part as BubblePart),
    );
    createRotateHandle(
      this.dom,
      (e) => startRotateDrag(this.view, this.getPos, this.dom, e),
      "Drag to rotate",
    );

    this.applyNode(node);
    this.bindEvents();
  }

  // ------------------------------------------------------------- the node

  private currentAttrs(): Record<string, unknown> {
    const pos = this.getPos();
    const node = pos == null ? null : this.view.state.doc.nodeAt(pos);
    return (node?.attrs ?? {}) as Record<string, unknown>;
  }

  /** The balloon's geometry right now: the body's measure is the author's. */
  private layoutNow(attrs?: Record<string, unknown>): BubbleLayout {
    return bubbleLayout(normalizeBubbleParams(attrs ?? this.currentAttrs()));
  }

  private applyNode(node: PMNode): void {
    const attrs = node.attrs as Record<string, unknown>;
    const base = normalizeBubbleParams(attrs);
    const align = String(attrs.align ?? "center");

    this.dom.setAttribute("data-aw-bubble", base.body);
    if (this.dom.getAttribute("data-align") !== align) this.dom.setAttribute("data-align", align);
    applyWrapMarker(this.dom, attrs);

    setStyleCached(this.applied, this.dom, "transform", transformStyleOf(attrs));
    const opacity = Number(attrs.opacity);
    setStyleCached(
      this.applied,
      this.dom,
      "opacity",
      isFinite(opacity) && opacity < 100 ? String(Math.max(0, opacity) / 100) : null,
    );
    const floating =
      !attrs.free && isWrapping(parseTextCondition(attrs.wrap)) && (align === "left" || align === "right");
    setStyleCached(this.applied, this.dom, "--aw-float-gap", floating ? `${floatGapPx(attrs, "bubble")}px` : null);

    // The text's air: the same padding the note has.
    setStyleCached(this.contentApplied, this.contentDOM, "padding", `${BUBBLE_PAD_Y}px ${BUBBLE_PAD_X}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "box-sizing", "border-box");

    this.paint(this.layoutNow(attrs), attrs);
  }

  /** Everything the DOM shows for one geometry. */
  private paint(layout: BubbleLayout, attrs: Record<string, unknown>): void {
    const params = layout.params;
    // The element's box IS the body.
    setStyleCached(this.applied, this.dom, "width", `${layout.bodyW}px`);
    setStyleCached(this.applied, this.dom, "height", `${layout.bodyH}px`);

    // The text's frame: the body for a rectangle, its inscribed rectangle for an
    // ellipse, so the words never cross the curve.
    setStyleCached(this.contentApplied, this.contentDOM, "left", `${layout.insetX}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "top", `${layout.insetY}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "width", `${layout.frameW}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "height", `${layout.frameH}px`);

    if (this.dom.getAttribute("data-aw-bubble") !== params.body) {
      this.dom.setAttribute("data-aw-bubble", params.body);
    }

    const shadow = bubbleShadowOf(attrs);
    const key = bubblePaintKey(layout, shadow);
    if (key !== this.paintKey || !this.svg) {
      this.paintKey = key;
      this.svg?.remove();
      this.svg = buildBubbleSvg(layout, shadow);
      // The drawing's rectangle: the body's box, moved by how far the tail
      // reaches beyond it. It never takes the pointer: the balloon is dragged
      // from the box's surface.
      this.svg.style.position = "absolute";
      this.svg.style.left = `${-layout.bodyLeft}px`;
      this.svg.style.top = `${-layout.bodyTop}px`;
      this.svg.style.pointerEvents = "none";
      this.dom.insertBefore(this.svg, this.dom.firstChild);
    }
    this.placeHandles(layout);
  }

  private placeHandles(layout: BubbleLayout): void {
    if (!this.handles) return;
    // The tail's handles are placed in the box's own coordinates: the layout
    // works from the drawing's corner, the box starts `bodyLeft` inside it.
    const tip = this.handles.tip;
    if (tip) {
      tip.style.left = `${Math.round(layout.handles.tip.x - layout.bodyLeft)}px`;
      tip.style.top = `${Math.round(layout.handles.tip.y - layout.bodyTop)}px`;
    }
    const base = this.handles.base;
    if (base) {
      base.style.left = `${Math.round(layout.handles.base.x - layout.bodyLeft)}px`;
      base.style.top = `${Math.round(layout.handles.base.y - layout.bodyTop)}px`;
    }
  }

  // ------------------------------------------------------------- events

  private bindEvents(): void {
    this.dom.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Every handle runs its own gesture and never starts a free drag.
      if (isCornerHandle(target) || isRotateHandle(target) || isShapeHandle(target)) return;
      // Pressing the balloon's surface (the grip, the box's air, the tail's
      // area) selects it and moves it with the hand. A press on the text falls
      // through to normal editing.
      if (target !== this.grip && target !== this.dom) return;
      e.preventDefault();
      e.stopPropagation();
      this.selectBubble();
      void import("./free-drag").then((m) =>
        m.startFreeDrag(this.view, this.getPos, this.dom, e),
      );
    });
  }

  stopEvent(e: Event): boolean {
    if (e.target === this.grip) return true;
    if (isCornerHandle(e.target) || isRotateHandle(e.target) || isShapeHandle(e.target)) return true;
    if (e.type === "mousedown" && e.target === this.dom) return true;
    return false;
  }

  private selectBubble(): void {
    const pos = this.getPos();
    if (pos == null) return;
    selectNodeAt(this.view, pos);
  }

  // ------------------------------------------------------- the four corners

  private onCornerGrab(e: MouseEvent, corner: Corner): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "bubble") return;
    const attrs = node.attrs as Record<string, unknown>;
    const base = normalizeBubbleParams(attrs);
    this.selectBubble();

    startCornerResize({
      view: this.view,
      getPos: this.getPos,
      event: e,
      corner,
      startWidth: base.width,
      startHeight: base.height,
      naturalRatio: base.height / base.width,
      minWidthPx: BUBBLE_WIDTH_MIN,
      minHeightPx: BUBBLE_HEIGHT_MIN,
      paint: (width, height) => {
        const params: BubbleParams = { ...base, width, height };
        this.paint(bubbleLayout(params), attrs);
      },
      commit: (width, height) => {
        setBubbleAttrs(this.view, { widthPx: width, heightPx: height });
      },
    });
  }

  // ----------------------------------------------------- the tail handles

  private onHandleGrab(e: MouseEvent, part: BubblePart): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "bubble") return;
    const attrs = node.attrs as Record<string, unknown>;
    const base = normalizeBubbleParams(attrs);
    const startLayout = this.layoutNow(attrs);
    const startParams: BubbleParams = { ...base, height: startLayout.bodyH };
    this.selectBubble();

    const freeSpec = parseFreeSpec(attrs.free);
    const rotation = (Number(attrs.rotation) || 0) * (Math.PI / 180);
    const originLeft = parseFloat(this.dom.style.left) || 0;
    const originTop = parseFloat(this.dom.style.top) || 0;

    /** The shift of the box, turned onto the element's own axes. */
    const shiftFor = (sx: number, sy: number): { sx: number; sy: number } => {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      return { sx: sx * cos - sy * sin, sy: sx * sin + sy * cos };
    };

    /** The geometry the hand is asking for, at the drag's current run. */
    const stateFor = (dx: number, dy: number): BubbleLayout => {
      const next =
        part === "tip" ? dragBubbleTip(startParams, dx, dy) : dragBubbleBase(startParams, dx, dy);
      return bubbleLayout({ ...startParams, ...next });
    };

    startShapePartDrag({
      view: this.view,
      getPos: this.getPos,
      event: e,
      onMove: (dx, dy) => {
        const layout = stateFor(dx, dy);
        this.paint(layout, attrs);
        if (freeSpec) {
          const { sx, sy } = shiftFor(
            startLayout.bodyLeft - layout.bodyLeft,
            startLayout.bodyTop - layout.bodyTop,
          );
          this.dom.style.left = `${Math.round(originLeft + sx)}px`;
          this.dom.style.top = `${Math.round(originTop + sy)}px`;
        }
      },
      onCommit: (dx, dy) => {
        const layout = stateFor(dx, dy);
        const params = layout.params;
        const patch: Record<string, unknown> = {
          tailOut: params.tailOut,
          tailAlong: params.tailAlong,
          base: params.base,
        };
        if (freeSpec) {
          const { sx, sy } = shiftFor(
            startLayout.bodyLeft - layout.bodyLeft,
            startLayout.bodyTop - layout.bodyTop,
          );
          if (sx !== 0 || sy !== 0) {
            patch.free = {
              ...freeSpec,
              xOff: clampFreeOffset(freeSpec.xOff + sx),
              yOff: clampFreeOffset(freeSpec.yOff + sy),
            };
          }
        }
        setBubbleAttrs(this.view, patch);
      },
    });
  }

  // ------------------------------------------------------ node view hooks

  update(node: PMNode): boolean {
    if (node.type.name !== "bubble") return false;
    this.applyNode(node);
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("aw-bubble--selected");
  }

  deselectNode(): void {
    this.dom.classList.remove("aw-bubble--selected");
  }

  /** Never re-parse our own attribute writes; always track content changes. */
  ignoreMutation(m: { type: string; target: Node }): boolean {
    if (m.type === "selection") return false;
    const target = m.target as Node;
    const inContent =
      !!this.contentDOM && (target === this.contentDOM || this.contentDOM.contains(target));
    return !inContent;
  }

  destroy(): void {
    this.svg = null;
    this.corners = [];
    this.handles = null;
  }
}
