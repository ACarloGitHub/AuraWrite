// ============================================================================
// Shape node view (chapter A, step S1) — the shape on screen.
//
// What it does NOT do: position, depth, free state and the anchoring rule. Those
// live in the free-layout engine and reach this DOM exactly as they reach a
// photo's, because the shape is an element of the same kind.
//
// What lives here: the drawing (through `shape-paint.ts`, the same function the
// markup uses) and the grabbing area. A line two pixels thick could not be
// caught with the pointer, so a soft transparent area sits around it — outside
// the box, so it never inflates the room the text keeps clear (§7).
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { applyWrapMarker, selectNodeAt, setStyleCached, transformStyleOf } from "./element-view";
import {
  createCornerHandles,
  createRotateHandle,
  isCornerHandle,
  isRotateHandle,
  startCornerResize,
  startRotateDrag,
  type Corner,
} from "./element-handles";
import { isWrapping, parseTextCondition } from "./element-condition";
import { floatGapPx } from "./text-obstacles";
import { buildShapeSvg, shapePaintKey } from "./shape-paint";
import {
  MIN_SHAPE_WIDTH_PX,
  normalizeShapeParams,
  shapeBoxSize,
  type ShapeBox,
  type ShapeParams,
} from "./shape-params";
import { setShapeAttrs } from "./shape-commands";

export class ShapeNodeView implements NodeView {
  dom: HTMLElement;
  private hit: HTMLElement;
  private svg: SVGSVGElement | null = null;
  /** The four corner handles and the rotation handle, from `element-handles.ts`. */
  private handles: HTMLElement[] = [];
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
    this.applyNode(node);
    this.createHandles();
    this.bindEvents();
  }

  private createHandles(): void {
    // U7: the four corner handles and the rotation handle live in
    // `element-handles.ts`, shared with the photo, the figure and the box. A
    // shape is vectorial: the corner changes its measure, the handle turns it.
    this.handles = createCornerHandles(this.dom, (e, corner) => this.onHandleMouseDown(e, corner));
    this.rotateHandle = createRotateHandle(
      this.dom,
      (e) => startRotateDrag(this.view, this.getPos, this.dom, e),
      "Drag to rotate",
    );
  }

  private bindEvents(): void {
    this.dom.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectShape();
    });
    this.dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // The corner and rotation handles run their own gestures
      // (`element-handles.ts`); they never start a free drag.
      if (isCornerHandle(target) || isRotateHandle(target)) return;
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
    return isCornerHandle(e.target) || isRotateHandle(e.target);
  }

  private onHandleMouseDown(e: MouseEvent, corner: Corner): void {
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
      paint: (width, height) => this.paintResize(width, height, params),
      commit: (width, height) => this.commitResize(width, height, params),
    });
  }

  /** Live preview through owned DOM while a corner is dragged. */
  private paintResize(width: number, height: number, params: ShapeParams): void {
    const box: ShapeBox = {
      width: Math.max(MIN_SHAPE_WIDTH_PX, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
    setStyleCached(this.applied, this.dom, "width", `${box.width}px`);
    setStyleCached(this.applied, this.dom, "height", `${box.height}px`);
    this.repaint(box, params);
  }

  /** Write the new measure into the document, once, at release. */
  private commitResize(width: number, height: number, params: ShapeParams): void {
    const w = Math.max(MIN_SHAPE_WIDTH_PX, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const patch: Record<string, unknown> = { width: w };
    if (params.kind === "line") {
      // The line's box height IS its stroke: a vertical resize thickens it.
      patch.strokeWidth = h;
    } else {
      patch.height = h;
    }
    void setShapeAttrs(this.view, patch);
  }

  private selectShape(): void {
    const pos = this.getPos();
    if (pos == null) return;
    selectNodeAt(this.view, pos);
  }

  /** Everything the DOM has to show for one node: the drawing and its state. */
  private applyNode(node: PMNode): void {
    const attrs = node.attrs as Record<string, unknown>;
    const params = normalizeShapeParams(attrs);
    const box = shapeBoxSize(attrs);
    const align = String(attrs.align ?? "center");

    this.dom.setAttribute("data-aw-shape", params.kind);
    if (this.dom.getAttribute("data-align") !== align) this.dom.setAttribute("data-align", align);
    applyWrapMarker(this.dom, attrs);

    setStyleCached(this.applied, this.dom, "width", `${box.width}px`);
    setStyleCached(this.applied, this.dom, "height", `${box.height}px`);
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

    this.repaint(box, params);
  }

  /** Build (or rebuild) the drawing for one box and one set of parameters. */
  private repaint(box: ShapeBox, params: ShapeParams): void {
    // For a line the stroke IS the box's height, so a live vertical resize
    // thickens it; the arrow keeps its stroke and its head length.
    const paintParams: ShapeParams = {
      ...params,
      strokeWidth: params.kind === "line" ? box.height : params.strokeWidth,
    };
    const key = shapePaintKey(paintParams, box);
    if (key === this.paintKey && this.svg) return;
    this.paintKey = key;
    this.svg?.remove();
    this.svg = buildShapeSvg(paintParams, box);
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
    this.handles = [];
    this.rotateHandle = null;
  }
}
