// ============================================================================
// Styled box node view — Phase 1 (G2). Dedicated view manager owning the box
// DOM, same ownership model as ImageNodeView:
//   - idempotent cached style writes (no spurious DOM churn);
//   - ignoreMutation shield for our own attribute changes;
//   - self-managed interactions: surface selection, the SHARED free drag (the
//     same gesture as images), continuous width resize persisted once.
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
import { applyWrapMarker, setStyleCached, transformStyleOf } from "./element-view";
import { isWrapping, parseTextCondition } from "./element-condition";
import { elementDecorationExtent } from "./element-decoration";
import { OBSTACLE_MARGIN_PX } from "./text-obstacles";
import { computeImageBoxShadow, normalizeImageStyle } from "./image-style";
import { getEditorZoom } from "./editor-zoom";

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
    // U3: the box shows the same text condition (wrapped / unwrapped / overlap)
    // as the image and the figure.
    applyWrapMarker(this.dom, attrs);
    // U3: the float rule keys on the width being explicit. Without this marker
    // the box stayed a full-line block: it LOOKED narrow but kept the whole
    // line, so the text could never wrap around it.
    const boxWidth = normalizeBoxStyle(attrs).widthPx;
    if (boxWidth != null) {
      const marker = String(boxWidth);
      if (this.dom.getAttribute("data-width") !== marker) {
        this.dom.setAttribute("data-width", marker);
      }
    } else if (this.dom.hasAttribute("data-width")) {
      this.dom.removeAttribute("data-width");
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
    // U1: same effects as the image (shadow, frame effect) plus transparency.
    const shadow = computeImageBoxShadow(normalizeImageStyle(raw));
    setStyleCached(this.applied, this.dom, "box-shadow", shadow || null);
    // U5: rotation and mirroring, like every other element.
    setStyleCached(this.applied, this.dom, "transform", transformStyleOf(raw));
    const opacity = Number(raw.opacity);
    setStyleCached(
      this.applied,
      this.dom,
      "opacity",
      isFinite(opacity) && opacity < 100 ? String(Math.max(0, opacity) / 100) : null,
    );
    // U3: air the box keeps from the text when it floats in the flow, shadow
    // included - the same rule as image and figure.
    const align = String(raw.align ?? "left");
    const floating =
      !raw.free && isWrapping(parseTextCondition(raw.wrap)) && (align === "left" || align === "right");
    const gap = floating
      ? `${OBSTACLE_MARGIN_PX + Math.round(elementDecorationExtent(raw, "styled_box").x)}px`
      : null;
    setStyleCached(this.applied, this.dom, "--aw-float-gap", gap);
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
      // The grip and the box's own surface both MOVE the box with the shared
      // free drag, the same gesture images use: a press without movement is a
      // plain selection; a drag reorders it in the flow or moves it when free.
      // Clicks on the inner paragraphs fall through to normal text editing.
      if (target !== this.grip && target !== this.dom) return;
      e.preventDefault();
      e.stopPropagation();
      this.selectBox();
      void import("./free-drag").then((m) =>
        m.startFreeDrag(this.view, this.getPos, this.dom, e),
      );
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

  // ----------------------------------------------------------- width drag

  /** Live preview through owned DOM (smooth); persist once at release. */
  private startResize(originX: number): void {
    const startPos = this.getPos();
    if (startPos == null) return;
    const startWidth = this.dom.getBoundingClientRect().width;

    const onMove = (ev: MouseEvent): void => {
      const width = Math.round(
        Math.min(
          BOX_WIDTH_MAX,
          Math.max(BOX_WIDTH_MIN, startWidth + (ev.clientX - originX) / getEditorZoom()),
        )
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
