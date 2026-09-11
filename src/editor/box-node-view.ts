// ============================================================================
// Styled box node view — Phase 1 (G2). Dedicated view manager owning the box
// DOM, same ownership model as ImageNodeView:
//   - idempotent cached style writes (no spurious DOM churn);
//   - ignoreMutation shield for our own attribute changes;
//   - self-managed interactions: surface selection, flow drag with a drop
//     line (ONE transaction at drop), continuous width resize persisted once.
//
// Native HTML5 drag and raw style pokes are deliberately avoided: they fight
// ProseMirror's DOM manager on content-bearing blocks and produce flicker and
// stutter (observed and rolled back 2026-08-25 — see wiki fase1 page, G2).
//
// Inner text is normal editable content: events on paragraphs are never
// stopped; only the frame parts we own (grip, handle, padding) are managed.
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView, type ViewMutationRecord } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import {
  BOX_WIDTH_MAX,
  BOX_WIDTH_MIN,
  computeBoxCss,
  isLightBgColor,
  normalizeBoxStyle,
} from "./box-style";
import { parseFreeSpec } from "./free-layout";
import { setStyleCached } from "./element-view";

const DRAG_THRESHOLD_PX = 6;

// The box keyboard guard is the shared one (element-view.ts); editor.ts
// registers `createAtomicElementGuardPlugin("styled_box")`.

export class StyledBoxNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private grip: HTMLElement;
  private resizeHandle: HTMLElement;
  private applied: Record<string, string | undefined> = {};

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "aw-box";
    this.syncVariant(node);

    this.grip = document.createElement("div");
    this.grip.className = "aw-box__grip";
    this.grip.title = "Drag to move";

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "aw-box__content";

    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "aw-box__resize-handle";
    this.resizeHandle.title = "Drag to resize width";

    this.dom.append(this.grip, this.contentDOM, this.resizeHandle);
    this.applyStyle(node.attrs as Record<string, unknown>);
    this.bindEvents();
  }

  // ------------------------------------------------------------- styling

  private syncVariant(node: PMNode): void {
    const attrs = node.attrs as Record<string, unknown>;
    const variant = String(attrs.variant ?? "text");
    if (this.dom.getAttribute("data-variant") !== variant) {
      this.dom.setAttribute("data-variant", variant);
    }
    const align = String(attrs.align ?? "left");
    if (this.dom.getAttribute("data-align") !== align) {
      this.dom.setAttribute("data-align", align);
    }
    // Screen-only legibility: dark text over light backgrounds. Exports and
    // print are untouched (they read the doc, not the editor DOM).
    const light = isLightBgColor(normalizeBoxStyle(attrs).bgColor) ? "true" : "false";
    if (this.dom.getAttribute("data-light-bg") !== light) {
      this.dom.setAttribute("data-light-bg", light);
    }
  }

  private applyStyle(raw: Record<string, unknown>): void {
    const css = computeBoxCss(normalizeBoxStyle(raw));
    setStyleCached(this.applied, this.dom, "background", css.background ?? null);
    setStyleCached(this.applied, this.dom, "border", css.border ?? null);
    setStyleCached(this.applied, this.dom, "border-radius", css.borderRadius ?? null);
    setStyleCached(this.applied, this.dom, "width", css.width ?? null);
  }

  // -------------------------------------------------------------- events

  private bindEvents(): void {
    this.dom.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (target === this.resizeHandle) {
        e.preventDefault();
        e.stopPropagation();
        this.selectBox();
        this.startResize(e.clientX);
        return;
      }
      // F3: the grip is the "take this where I want" handle - it starts the
      // free drag whether or not the box is already out of the flow.
      if (target === this.grip) {
        e.preventDefault();
        e.stopPropagation();
        this.selectBox();
        void import("./free-drag").then((m) =>
          m.startFreeDrag(this.view, this.getPos, this.dom, e),
        );
        return;
      }
      // Only the box surface selects/drags the box; clicks on inner paragraphs
      // fall through to normal text editing.
      if (target !== this.dom) return;
      e.preventDefault();
      e.stopPropagation();
      this.selectBox();
      // A free box must not be reordered by the flow drag: moving it in the
      // tree would move its anchor and teleport it (contract §5).
      const pos = this.getPos();
      const node = pos === undefined ? null : this.view.state.doc.nodeAt(pos);
      if (node && parseFreeSpec(node.attrs?.free)) return;
      this.startFlowDrag(e.clientY, e.clientX);
    });
  }

  /** PM must not process events on the parts we manage ourselves. */
  stopEvent(e: Event): boolean {
    if (e.target === this.grip || e.target === this.resizeHandle) return true;
    if (e.type === "mousedown" && e.target === this.dom) return true;
    return false;
  }

  private selectBox(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "styled_box") return;
    this.view.dispatch(
      this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
    );
    this.view.focus();
  }

  // ------------------------------------------------------------ flow drag

  /**
   * Landing decided by the POINTER alone: the top-level block under the
   * cursor splits at its vertical midpoint — pointer above the middle means
   * "before that block", below means "after it". Returns null when released
   * outside the page or on the box itself (no-op).
   *
   * Both axes are captured here on purpose: pointerX is RESERVED for the
   * free-floating phase (Fase 3) and travels with the drop decision so no
   * rework will be needed there.
   */
  private findPointerBoundary(
    pointerX: number,
    pointerY: number,
    boxPos: number
  ): { boundary: number; pointerX: number } | null {
    void pointerX; // reserved for Fase 3 (floating placement)
    const view = this.view;
    const found = view.posAtCoords({ left: pointerX, top: pointerY });
    if (!found) return null;
    const doc = view.state.doc;
    const boxNode = doc.nodeAt(boxPos);
    if (!boxNode || boxNode.type.name !== "styled_box") return null;
    const boxEnd = boxPos + boxNode.nodeSize;

    let $pos;
    try {
      $pos = doc.resolve(found.pos);
    } catch {
      return null;
    }

    let childStart: number;
    let childEnd: number;
    if ($pos.depth < 1) {
      childStart = Math.max(0, Math.min(found.pos, doc.content.size));
      childEnd = childStart;
    } else {
      try {
        childStart = $pos.before(1);
        childEnd = childStart + $pos.node(1).nodeSize;
      } catch {
        return null;
      }
    }

    // Released over the box itself: nearest edge, but that equals "stay put",
    // so treat it as an intentional no-op.
    if (
      (childStart === boxPos && childEnd === boxEnd) ||
      (childStart <= boxPos && childEnd >= boxEnd && childEnd - childStart === boxNode.nodeSize)
    ) {
      return null;
    }
    if (childStart === boxPos || childEnd === boxEnd) return null;

    let midY = pointerY;
    try {
      const startCoords = view.coordsAtPos(childStart);
      const endCoords = view.coordsAtPos(Math.min(childEnd, doc.content.size));
      if (startCoords && endCoords) midY = (startCoords.top + endCoords.bottom) / 2;
    } catch {
      /* fall back to pointer Y: upper half wins */
    }

    const boundary = pointerY <= midY ? childStart : childEnd;
    if (boundary === boxPos || boundary === boxEnd) return null;
    return { boundary, pointerX };
  }

  /**
   * Track the drag ourselves. A semi-transparent GHOST of the box follows the
   * pointer fluidly (grab offset preserved, both axes) while a short snapped
   * line inside the editor column marks the landing boundary. ONE move
   * transaction happens at release — nothing moves mid-drag.
   */
  private startFlowDrag(originClientY: number, originClientX: number): void {
    const startPos = this.getPos();
    if (startPos == null) return;
    let armed = false;

    const rect = this.dom.getBoundingClientRect();
    const grabOffsetX = originClientX - rect.left;
    const grabOffsetY = originClientY - rect.top;

    let ghost: HTMLElement | null = null;
    const makeGhost = (): HTMLElement => {
      const g = this.dom.cloneNode(true) as HTMLElement;
      g.classList.remove("aw-box--selected");
      g.classList.add("aw-box--ghost");
      // Lock the ghost to the CURRENT visual size: fixed positioning would
      // otherwise re-measure content and distort full-column boxes.
      g.style.width = `${Math.round(rect.width)}px`;
      // The original is display:none during flight; the clone must NOT
      // inherit that or the ghost vanishes with it.
      g.style.display = "block";
      g.style.top = "0px";
      g.style.left = "0px";
      g.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      document.body.appendChild(g);
      return g;
    };

    const onMove = (ev: MouseEvent): void => {
      if (
        !armed &&
        Math.abs(ev.clientY - originClientY) < DRAG_THRESHOLD_PX &&
        Math.abs(ev.clientX - originClientX) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      if (!armed) {
        armed = true;
        ghost = makeGhost();
        // Hide the original in the SAME instant the ghost appears: no flash
        // of missing content between the two states.
        this.dom.style.display = "none";
      }
      if (ghost) {
        const x = ev.clientX - grabOffsetX;
        const y = ev.clientY - grabOffsetY;
        ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    };

    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      ghost?.remove();
      ghost = null;

      // Decide the landing while the box is STILL hidden: the coordinates
      // must reflect the document without it, or tall boxes correlate the
      // landing with their own height (defect observed 2026-08-26).
      const drop =
        armed && this.dom.style.display === "none"
          ? this.findPointerBoundary(ev.clientX, ev.clientY, startPos)
          : null;
      const size = this.view.state.doc.nodeAt(startPos)?.nodeSize ?? 0;
      const sameSpot = drop == null || drop.boundary === startPos || drop.boundary === startPos + size;

      this.dom.style.display = "";
      if (!sameSpot) this.moveTo(drop!.boundary, startPos);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /** Move the box to a top-level boundary with ONE transaction (no flicker). */
  private moveTo(boundary: number, boxPos: number): void {
    const view = this.view;
    const node = view.state.doc.nodeAt(boxPos);
    if (!node || node.type.name !== "styled_box") return;
    const { paragraph } = view.state.schema.nodes;
    const size = node.nodeSize;

    const tr = view.state.tr.delete(boxPos, boxPos + size);
    let insertAt = boundary > boxPos ? boundary - size : boundary;
    insertAt = Math.max(0, Math.min(insertAt, tr.doc.content.size));

    tr.insert(insertAt, node);

    // Host paragraph below the box when it lands as the last node, so the
    // caret always has somewhere to go after it (same rule as images).
    const end = insertAt + size;
    if (!tr.doc.nodeAt(end) && paragraph) {
      tr.insert(end, paragraph.create());
    }

    tr.setSelection(NodeSelection.create(tr.doc, insertAt));
    view.dispatch(tr);
    view.focus();
  }

  // ----------------------------------------------------------- width drag

  /** Live preview through owned DOM (smooth); persist once at release. */
  private startResize(originX: number): void {
    const startPos = this.getPos();
    if (startPos == null) return;
    const startWidth = this.dom.getBoundingClientRect().width;

    const onMove = (ev: MouseEvent): void => {
      const width = Math.round(
        Math.min(BOX_WIDTH_MAX, Math.max(BOX_WIDTH_MIN, startWidth + ev.clientX - originX))
      );
      setStyleCached(this.applied, this.dom, "width", `${width}px`);
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const match = /^(\d+)px$/.exec(this.dom.style.getPropertyValue("width"));
      if (!match) return;
      const widthPx = parseInt(match[1], 10);
      const node = this.view.state.doc.nodeAt(startPos);
      if (node && node.type.name === "styled_box") {
        try {
          this.view.dispatch(
            this.view.state.tr.setNodeMarkup(startPos, undefined, { ...node.attrs, widthPx })
          );
        } catch {
          /* schema drift during drag: ignore */
        }
      }
      this.view.focus();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ------------------------------------------------------ node view hooks

  update(node: PMNode): boolean {
    if (node.type.name !== "styled_box") return false;
    this.syncVariant(node);
    this.applyStyle(node.attrs as Record<string, unknown>);
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("aw-box--selected");
  }

  deselectNode(): void {
    this.dom.classList.remove("aw-box--selected");
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
    document.querySelector(".aw-box--ghost")?.remove();
    // Safety: never leave a box invisible if destroyed mid-drag.
    this.dom.style.display = "";
  }
}
