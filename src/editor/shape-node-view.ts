// ============================================================================
// Shape node view — the shape on screen.
//
// What it does NOT do: position, depth, free state and the anchoring rule. Those
// live in the free-layout engine and reach this DOM exactly as they reach a
// photo's, because the shape is an element of the same kind.
//
// What lives here: the drawing (through `shape-paint.ts`, the same function the
// markup uses), the grabbing area, and WHICH handle a hand has grabbed. The
// meaning of each handle (what the tip does, what the base does) is arithmetic
// and lives in `shape-geometry.ts`; the pointer-to-numbers rule is shared and
// lives in `element-handles.ts`.
//
// Two sets of handles exist on the node and the stylesheet shows the right one:
//  - a LINE is a rectangle: the four shared corners and the centre pivot;
//  - an ARROW is not: tip, the two base vertices and the body, with the tip as
//    the turning pivot (drawn-shapes-project §6-§7).
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
import { buildShapeSvg, shapePaintKey } from "./shape-paint";
import {
  MIN_SHAPE_WIDTH_PX,
  hasHead,
  normalizeShapeParams,
  shapeBoxSize,
  shapeRotationPivot,
  type ShapeBox,
  type ShapeParams,
} from "./shape-params";
import {
  SHAPE_PARTS,
  dragShapeBody,
  dragShapeEdge,
  dragShapeHead,
  dragShapeScale,
  dragShapeTip,
  shapeHandleAnchors,
  type ShapeDrag,
  type ShapePart,
  type ShapeState,
} from "./shape-geometry";
import { setShapeAttrs } from "./shape-commands";
import { clampFreeOffset, parseFreeSpec } from "./free-layout";

/** Smallest grabbing area a shape offers, so a tiny arrow can still be caught. */
const MIN_HIT_PX = 26;

export class ShapeNodeView implements NodeView {
  dom: HTMLElement;
  private hit: HTMLElement;
  private svg: SVGSVGElement | null = null;
  /** The shared corners (the line only) and the shape's own corners. */
  private corners: HTMLElement[] = [];
  private parts: Record<string, HTMLElement> | null = null;
  private rotateHandle: HTMLElement | null = null;
  private paintKey = "";
  /** Last-applied inline style values: idempotent writes, as the other views do. */
  private applied: Record<string, string | undefined> = {};

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "aw-shape";
    this.hit = document.createElement("div");
    this.hit.className = "aw-shape__hit";
    // The grabbing area is a child BEFORE anything is painted: the drawing goes
    // in front of it, and `insertBefore` needs a child to point at.
    this.dom.appendChild(this.hit);
    this.createHandles();
    this.applyNode(node);
    this.bindEvents();
  }

  private createHandles(): void {
    // The line keeps the shared engine exactly as the photo uses it.
    this.corners = createCornerHandles(this.dom, (e, corner) => this.onCornerGrab(e, corner));
    // Every closed shape gets its own handles, on the corners its geometry names.
    this.parts = createShapeHandles(this.dom, SHAPE_PARTS, (e, part) =>
      this.onPartGrab(e, part as ShapePart),
    );
    // One rotation handle for every kind; at press time it decides whether it
    // turns around the centre (line, ellipse) or around the tip (an arrow).
    this.rotateHandle = createRotateHandle(
      this.dom,
      (e) => {
        const withTip = hasHead(normalizeShapeParams(this.currentAttrs()).kind);
        startRotateDrag(
          this.view,
          this.getPos,
          this.dom,
          e,
          withTip && this.parts ? { pivot: this.parts.tip, relative: true } : {},
        );
      },
      "Drag to rotate",
    );
  }

  /** The attributes of the node this view is showing right now. */
  private currentAttrs(): Record<string, unknown> {
    const pos = this.getPos();
    const node = pos == null ? null : this.view.state.doc.nodeAt(pos);
    return (node?.attrs ?? {}) as Record<string, unknown>;
  }

  /** The kind of the node this view is showing right now. */
  private kindOf(): string {
    const pos = this.getPos();
    const node = pos == null ? null : this.view.state.doc.nodeAt(pos);
    return normalizeShapeParams((node?.attrs ?? {}) as Record<string, unknown>).kind;
  }

  private bindEvents(): void {
    this.dom.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectShape();
    });
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Every handle runs its own gesture and never starts a free drag.
      if (isCornerHandle(target) || isRotateHandle(target) || isShapeHandle(target)) return;
      e.preventDefault();
      this.selectShape();
      // The same gesture the photo and the box use: pressing and moving takes
      // the shape with the pointer (contract §4). It never changes its nature.
      void import("./free-drag").then((m) =>
        m.startFreeDrag(this.view, this.getPos, this.dom, e),
      );
    });
  }

  /** PM must not place a cursor or start a selection on the handles we own. */
  stopEvent(e: Event): boolean {
    return isCornerHandle(e.target) || isRotateHandle(e.target) || isShapeHandle(e.target);
  }

  private selectShape(): void {
    const pos = this.getPos();
    if (pos == null) return;
    selectNodeAt(this.view, pos);
  }

  // ------------------------------------------------------------- the line

  private onCornerGrab(e: MouseEvent, corner: Corner): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const attrs = node.attrs as Record<string, unknown>;
    const params = normalizeShapeParams(attrs);
    const box = shapeBoxSize(attrs);
    startCornerResize({
      view: this.view,
      getPos: this.getPos,
      event: e,
      corner,
      startWidth: box.width,
      startHeight: box.height,
      naturalRatio: box.height / box.width,
      // The shared minimums would snap a two-pixel line to 20 px tall; the shape
      // brings its own so a thin line stays thin while it is dragged.
      minWidthPx: MIN_SHAPE_WIDTH_PX,
      minHeightPx: 1,
      paint: (width, height) => this.paintState(this.resizeState({ params, box }, width, height)),
      commit: (width, height) => {
        const next = this.resizeState({ params, box }, width, height);
        setShapeAttrs(this.view, { width: next.box.width, height: next.box.height, strokeWidth: next.params.strokeWidth });
      },
    });
  }

  /** A corner drag is the box's own measure: the line thickens instead of growing air. */
  private resizeState(start: ShapeState, width: number, height: number): ShapeState {
    const w = Math.max(MIN_SHAPE_WIDTH_PX, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (start.params.kind === "line") {
      return { box: { width: w, height: h }, params: { ...start.params, strokeWidth: h } };
    }
    return { box: { width: w, height: h }, params: start.params };
  }

  // ------------------------------------------------------- the drawn shape

  private onPartGrab(e: MouseEvent, part: ShapePart): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const attrs = node.attrs as Record<string, unknown>;
    const start: ShapeState = { params: normalizeShapeParams(attrs), box: shapeBoxSize(attrs) };
    if (start.params.kind === "line") return;
    this.selectShape();

    // A handle can move the REAR or a SIDE: the part that must not move stays
    // where it is, so the box's own corner travels with the hand. Only a free
    // element has a position to move (in the flow the box's corner is where the
    // text put it).
    const freeSpec = parseFreeSpec(attrs.free);
    const rotation = (Number(attrs.rotation) || 0) * (Math.PI / 180);
    const originLeft = parseFloat(this.dom.style.left) || 0;
    const originTop = parseFloat(this.dom.style.top) || 0;

    /** The shift of the box's corner, turned onto the element's own axes. */
    const shiftFor = (drag: ShapeDrag): { sx: number; sy: number } => {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      return {
        sx: drag.shiftX * cos - drag.shiftY * sin,
        sy: drag.shiftX * sin + drag.shiftY * cos,
      };
    };

    startShapePartDrag({
      view: this.view,
      getPos: this.getPos,
      event: e,
      onMove: (dx, dy) => {
        const drag = this.partState(part, start, dx, dy);
        this.paintState(drag);
        if (freeSpec) {
          const { sx, sy } = shiftFor(drag);
          this.dom.style.left = `${Math.round(originLeft + sx)}px`;
          this.dom.style.top = `${Math.round(originTop + sy)}px`;
        }
      },
      onCommit: (dx, dy) => {
        const drag = this.partState(part, start, dx, dy);
        const patch: Record<string, unknown> = {
          width: drag.box.width,
          height: drag.box.height,
          strokeWidth: drag.params.strokeWidth,
          headSize: drag.params.headSize,
          bodyHeight: drag.params.bodyHeight,
        };
        if (freeSpec && (drag.shiftX !== 0 || drag.shiftY !== 0)) {
          const { sx, sy } = shiftFor(drag);
          patch.free = {
            ...freeSpec,
            xOff: clampFreeOffset(freeSpec.xOff + sx),
            yOff: clampFreeOffset(freeSpec.yOff + sy),
          };
        }
        setShapeAttrs(this.view, patch);
      },
    });
  }

  /**
   * What one corner's movement means.
   *
   * `base` is the head's top rear corner and `mirror` its bottom one: both change
   * the head's width, symmetrically, and the sign makes them behave the same for
   * a hand pulling away from the axis. The ellipse's four extremes move one side
   * each and leave the opposite one where it is.
   */
  private partState(part: ShapePart, start: ShapeState, dx: number, dy: number): ShapeDrag {
    switch (part) {
      case "tip":
        return dragShapeTip(start, dx);
      case "base":
        return dragShapeHead(start, -dy);
      case "mirror":
        return dragShapeHead(start, dy);
      case "body":
        return dragShapeBody(start, dx, dy);
      case "scale":
        return dragShapeScale(start, dx, dy);
      case "east":
      case "west":
      case "north":
      case "south":
        return dragShapeEdge(part, start, dx, dy);
      default:
        // A part this kind does not have: its handle is hidden, so no hand can
        // reach it. The document keeps the numbers it had.
        return { ...start, shiftX: 0, shiftY: 0 };
    }
  }

  // ------------------------------------------------------------- the paint

  /** Everything the DOM has to show for one node: the drawing and its state. */
  private applyNode(node: PMNode): void {
    const attrs = node.attrs as Record<string, unknown>;
    const params = normalizeShapeParams(attrs);
    const box = shapeBoxSize(attrs);
    const align = String(attrs.align ?? "center");

    this.dom.setAttribute("data-aw-shape", params.kind);
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
    // T1.4: when the shape floats in the flow, the air it keeps from the text is
    // the same number the calculator adds (one function, `floatGapPx`).
    const floating =
      !attrs.free && isWrapping(parseTextCondition(attrs.wrap)) && (align === "left" || align === "right");
    setStyleCached(this.applied, this.dom, "--aw-float-gap", floating ? `${floatGapPx(attrs, "shape")}px` : null);

    this.layout(box, params);
  }

  /** Size, grabbing area, drawing and handle positions for one state. */
  private layout(box: ShapeBox, params: ShapeParams): void {
    setStyleCached(this.applied, this.dom, "width", `${box.width}px`);
    setStyleCached(this.applied, this.dom, "height", `${box.height}px`);

    // L2's one exception, in one number: the arrow turns around its tip, and the
    // stylesheet, the markup and the page count read the same point.
    const pivot = shapeRotationPivot({
      shape: params.kind,
      strokeWidth: params.strokeWidth,
      width: box.width,
      height: box.height,
    });
    setStyleCached(
      this.applied,
      this.dom,
      "transform-origin",
      pivot ? `${pivot.x}px ${pivot.y}px` : null,
    );

    // A tiny arrow must still be catchable: the soft area is bigger than the
    // drawing, and it lives OUTSIDE the box so it changes no measure (§7).
    const hitWidth = Math.max(box.width + 12, MIN_HIT_PX);
    const hitHeight = Math.max(box.height + 12, MIN_HIT_PX);
    this.hit.style.width = `${hitWidth}px`;
    this.hit.style.height = `${hitHeight}px`;
    this.hit.style.left = `${Math.round((box.width - hitWidth) / 2)}px`;
    this.hit.style.top = `${Math.round((box.height - hitHeight) / 2)}px`;

    this.repaint(box, params);
    this.placeHandles(box, params);
  }

  /**
   * Put every handle on the corner its geometry names, and hide the ones this
   * kind does not have: a handle that cannot change anything is not a handle.
   */
  private placeHandles(box: ShapeBox, params: ShapeParams): void {
    if (!this.parts) return;
    const anchors = shapeHandleAnchors(params, box);
    for (const part of SHAPE_PARTS) {
      const el = this.parts[part];
      if (!el) continue;
      const point = anchors[part];
      if (!point) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      el.style.left = `${Math.round(point.x)}px`;
      el.style.top = `${Math.round(point.y)}px`;
    }
  }

  /** Live paint of a state while a handle is dragged (no document write yet). */
  private paintState(state: ShapeState): void {
    this.layout(state.box, state.params);
  }

  /** Build (or rebuild) the drawing for one box and one set of parameters. */
  private repaint(box: ShapeBox, params: ShapeParams): void {
    const key = shapePaintKey(params, box);
    if (key === this.paintKey && this.svg) return;
    this.paintKey = key;
    this.svg?.remove();
    this.svg = buildShapeSvg(params, box);
    this.dom.insertBefore(this.svg, this.hit);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "shape") return false;
    this.applyNode(node);
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("aw-shape--selected");
  }

  deselectNode(): void {
    this.dom.classList.remove("aw-shape--selected");
  }

  destroy(): void {
    this.svg = null;
    this.corners = [];
    this.parts = null;
    this.rotateHandle = null;
  }
}
