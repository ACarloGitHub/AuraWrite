// ============================================================================
// Bubble node view — the speech balloon on screen.
//
// What it does NOT do: position, depth and anchoring. Those live in the free
// engine and reach this DOM exactly as they reach a photo's.
//
// What lives here: the drawing (through `bubble-paint.ts`, the same function the
// markup uses), the text's frame inside the body, the grip, and the two handles
// that shape the tail. The MEANING of each handle is arithmetic and lives in
// `bubble-geometry.ts`; the pointer-to-numbers rule is shared and lives in
// `element-handles.ts`.
//
// The one thing this view knows that the page count cannot: the text's real
// height. The body grows around it on screen; the page count estimates the same
// height from the words and the metrics (pagination-cassie.ts), so the two
// numbers agree with the font the page is being written in.
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView, type ViewMutationRecord } from "prosemirror-view";
import { applyWrapMarker, selectNodeAt, setStyleCached, transformStyleOf } from "./element-view";
import {
  createRotateHandle,
  createShapeHandles,
  isRotateHandle,
  isShapeHandle,
  startRotateDrag,
  startShapePartDrag,
} from "./element-handles";
import { isWrapping, parseTextCondition } from "./element-condition";
import { floatGapPx } from "./text-obstacles";
import { buildBubbleSvg, bubblePaintKey, bubbleShadowOf } from "./bubble-paint";
import {
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  bubbleBodyHeightFromWrapper,
  bubbleLayout,
  bubbleWrapperWidth,
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
  private handles: Record<string, HTMLElement> | null = null;
  private svg: SVGSVGElement | null = null;
  private paintKey = "";
  private applied: Record<string, string | undefined> = {};
  /** Its own cache: the text frame and the element are different boxes. */
  private contentApplied: Record<string, string | undefined> = {};
  private observer: ResizeObserver | null = null;
  /** Scheduled repaint after a measurement, and what the last one drew. */
  private pendingPaint = 0;
  private lastBox = "";

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

    // The text changes height on its own (a typed line, a narrower width): the
    // body must follow it, or the balloon would be drawn around yesterday's text.
    // The repaint is DEFERRED to the next frame and skipped when the box would
    // not change: doing the layout inside the observer's own callback is what
    // makes the browser complain ("ResizeObserver loop completed with undelivered
    // notifications"), and the complaint is not harmless, it is a second pass.
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.scheduleRepaint());
      this.observer.observe(this.contentDOM);
    }
  }

  /** Repaint after a measurement, once per frame, only if the box moved. */
  private scheduleRepaint(): void {
    if (this.pendingPaint) return;
    this.pendingPaint = requestAnimationFrame(() => {
      this.pendingPaint = 0;
      const layout = this.layoutNow();
      const box = `${layout.boxW}x${layout.boxH}`;
      if (box === this.lastBox) return;
      this.paint(layout, this.currentAttrs());
    });
  }

  // ------------------------------------------------------------- the node

  private currentAttrs(): Record<string, unknown> {
    const pos = this.getPos();
    const node = pos == null ? null : this.view.state.doc.nodeAt(pos);
    return (node?.attrs ?? {}) as Record<string, unknown>;
  }

  /** The ballon's geometry right now: the text's measured height is the body's. */
  private layoutNow(attrs?: Record<string, unknown>): BubbleLayout {
    const base = normalizeBubbleParams(attrs ?? this.currentAttrs());
    const wrapperH = Math.max(1, this.contentDOM.offsetHeight);
    return bubbleLayout({ ...base, height: bubbleBodyHeightFromWrapper(base, wrapperH) });
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

    // The text's own frame: its width is fixed by the body, its padding is the
    // bubble's air. Both travel as inline style so the exported markup and the
    // screen cannot disagree.
    setStyleCached(this.contentApplied, this.contentDOM, "width", `${bubbleWrapperWidth(base)}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "padding", `${BUBBLE_PAD_Y}px ${BUBBLE_PAD_X}px`);
    setStyleCached(this.contentApplied, this.contentDOM, "box-sizing", "border-box");

    this.paint(this.layoutNow(attrs), attrs);
  }

  /** Everything the DOM shows for one geometry. */
  private paint(layout: BubbleLayout, attrs: Record<string, unknown>): void {
    const params = layout.params;
    this.lastBox = `${layout.boxW}x${layout.boxH}`;
    setStyleCached(this.applied, this.dom, "width", `${layout.boxW}px`);
    setStyleCached(this.applied, this.dom, "height", `${layout.boxH}px`);

    // The text's frame sits where the body sits, inside the element's box.
    setStyleCached(
      this.contentApplied,
      this.contentDOM,
      "margin",
      `${layout.bodyTop + layout.insetY}px 0 0 ${layout.bodyLeft + layout.insetX}px`,
    );

    // The grip lives in the body's own top padding, where the text does not go.
    if (this.grip) {
      this.grip.style.left = `${layout.bodyLeft + 12}px`;
      this.grip.style.top = `${layout.bodyTop + 4}px`;
    }

    if (this.dom.getAttribute("data-aw-bubble") !== params.body) {
      this.dom.setAttribute("data-aw-bubble", params.body);
    }

    const shadow = bubbleShadowOf(attrs);
    const key = bubblePaintKey(layout, shadow);
    if (key !== this.paintKey || !this.svg) {
      this.paintKey = key;
      this.svg?.remove();
      this.svg = buildBubbleSvg(layout, shadow);
      // Behind the text and out of the pointer's way: the balloon is dragged
      // from the element's surface, not from its drawing.
      this.svg.style.position = "absolute";
      this.svg.style.left = "0";
      this.svg.style.top = "0";
      this.svg.style.pointerEvents = "none";
      this.dom.insertBefore(this.svg, this.dom.firstChild);
    }
    this.placeHandles(layout);
  }

  private placeHandles(layout: BubbleLayout): void {
    if (!this.handles) return;
    const tip = this.handles.tip;
    if (tip) {
      tip.style.left = `${Math.round(layout.handles.tip.x)}px`;
      tip.style.top = `${Math.round(layout.handles.tip.y)}px`;
    }
    const base = this.handles.base;
    if (base) {
      base.style.left = `${Math.round(layout.handles.base.x)}px`;
      base.style.top = `${Math.round(layout.handles.base.y)}px`;
    }
  }

  // ------------------------------------------------------------- events

  private bindEvents(): void {
    this.dom.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Every handle runs its own gesture and never starts a free drag.
      if (isRotateHandle(target) || isShapeHandle(target)) return;
      // Pressing the balloon's surface (the grip, the tail's area, the body's
      // edge) selects it and moves it with the hand, the same gesture the photo
      // and the box use. A press on the text falls through to normal editing.
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
    if (isRotateHandle(e.target) || isShapeHandle(e.target)) return true;
    if (e.type === "mousedown" && e.target === this.dom) return true;
    return false;
  }

  private selectBubble(): void {
    const pos = this.getPos();
    if (pos == null) return;
    selectNodeAt(this.view, pos);
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

    /** The shift of the element's box, turned onto the element's own axes. */
    const shiftFor = (sx: number, sy: number): { sx: number; sy: number } => {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      return { sx: sx * cos - sy * sin, sy: sx * sin + sy * cos };
    };

    /** The geometry the hand is asking for, at the drag's current run. */
    const stateFor = (dx: number, dy: number): { params: BubbleParams; layout: BubbleLayout } => {
      const next =
        part === "tip" ? dragBubbleTip(startParams, dx, dy) : dragBubbleBase(startParams, dx, dy);
      const params: BubbleParams = { ...startParams, ...next };
      return { params, layout: bubbleLayout(params) };
    };

    startShapePartDrag({
      view: this.view,
      getPos: this.getPos,
      event: e,
      onMove: (dx, dy) => {
        const { layout } = stateFor(dx, dy);
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
        const { params, layout } = stateFor(dx, dy);
        const patch: Record<string, unknown> = { tailOut: params.tailOut, tailAlong: params.tailAlong, base: params.base };
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
  ignoreMutation(m: ViewMutationRecord): boolean {
    if (m.type === "selection") return false;
    const target = m.target as Node;
    const inContent =
      !!this.contentDOM && (target === this.contentDOM || this.contentDOM.contains(target));
    return !inContent;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pendingPaint) cancelAnimationFrame(this.pendingPaint);
    this.pendingPaint = 0;
    this.svg = null;
    this.handles = null;
  }
}
