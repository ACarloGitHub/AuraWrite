// ============================================================================
// Figure node view — Phase 1 (G3, refactor 2026-08-29). Dedicated view manager
// owning the figure DOM, same ownership model as ImageNodeView / StyledBoxNodeView:
//   - idempotent cached style writes (no spurious DOM churn);
//   - ignoreMutation shield for our own attribute changes;
//   - the photo is an <img> built from the node ATTRS (NOT a PM child), and the
//     caption is editable content inside <figcaption> (contentDOM).
//
// Anti-deformation rules (spec G3 — piano-rifacimento-caption §9):
//   FIX 1 — the figure is NEVER re-probed/self-healed: an inserted photo
//           already carries explicit width/height, and re-deriving the ratio
//           from the asset probe is what made circles become ellipses.
//   FIX 2 — height stays "auto" while the aspect is locked (default): the
//           browser preserves the intrinsic ratio. Explicit height is applied
//           only when the aspect is unlocked (user's explicit choice).
// The CSS exemption for the container ("element not to reduce") lives in
// styles.css (.ProseMirror .aw-figure img).
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView, type ViewMutationRecord } from "prosemirror-view";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import { resolveImageSrc } from "./image-uploader";
import { computeImageCss, normalizeImageStyle } from "./image-style";
import { isLightBgColor } from "./box-style";

type Corner = "tl" | "tr" | "bl" | "br";

interface HandleEl extends HTMLElement {
  _corner: Corner;
}

const FIGURE_NODE = "figure";

/**
 * Figure typing guard:
 *  - printable key over a surface-selected figure ENTERS the caption instead
 *    of replacing the whole figure (the "typing deletes the image" bug this
 *    refactor removes at the root);
 *  - Backspace/Delete at the seams or at the first/last caption position
 *    removes the figure ATOMICALLY (photo + caption, like images/boxes).
 */
export function createFigureTypeGuardPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          const sel = view.state.selection;

          // Atomic deletion (whole figure: photo + caption).
          if ((event.key === "Backspace" || event.key === "Delete") && sel.empty) {
            const goingBack = event.key === "Backspace";
            const $pos = view.state.doc.resolve(sel.from);
            let atomicFigure: { pos: number; node: PMNode } | null = null;

            // Direct seam neighbour.
            const seamNeighbour = goingBack ? $pos.nodeBefore : $pos.nodeAfter;
            if (seamNeighbour && seamNeighbour.type.name === FIGURE_NODE) {
              const pos = goingBack ? sel.from - seamNeighbour.nodeSize : sel.from;
              atomicFigure = { pos, node: seamNeighbour };
            }

            // Caret at the boundary of an adjacent textblock.
            if (!atomicFigure) {
              const atBlockEdge = goingBack
                ? $pos.parentOffset === 0
                : $pos.parentOffset === $pos.parent.content.size;
              if (atBlockEdge && $pos.depth >= 1) {
                const blockStart = $pos.before($pos.depth);
                const blockEnd = $pos.after($pos.depth);
                const sibling = goingBack
                  ? view.state.doc.resolve(blockStart).nodeBefore
                  : view.state.doc.resolve(blockEnd).nodeAfter;
                if (sibling && sibling.type.name === FIGURE_NODE) {
                  const pos = goingBack ? blockStart - sibling.nodeSize : blockEnd;
                  atomicFigure = { pos, node: sibling };
                }
              }
            }

            // Caret inside the caption at its first/last text position.
            if (!atomicFigure) {
              for (let d = $pos.depth; d >= 1; d--) {
                const n = $pos.node(d);
                if (n.type.name !== FIGURE_NODE) continue;
                const figPos = $pos.before(d);
                const figStart = figPos + 1;
                const figEnd = figPos + n.nodeSize - 1;
                const atEdge = goingBack ? sel.from === figStart : sel.from === figEnd;
                if (atEdge) atomicFigure = { pos: figPos, node: n };
                break;
              }
            }

            if (atomicFigure) {
              const size = atomicFigure.node.nodeSize;
              let tr = view.state.tr.delete(atomicFigure.pos, atomicFigure.pos + size);
              if (tr.doc.childCount === 0) {
                const paragraph = view.state.schema.nodes.paragraph;
                if (paragraph) tr = tr.insert(0, paragraph.create());
              }
              view.dispatch(tr);
              view.focus();
              return true;
            }
            return false;
          }

          // Printable keys over a surface-selected figure: enter the caption.
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== FIGURE_NODE) {
            return false;
          }
          const key = event.key;
          if (event.ctrlKey || event.metaKey || event.altKey) return false;
          if (key.length !== 1) return false;
          const $inside = view.state.doc.resolve(sel.from + 1);
          const caret = TextSelection.near($inside, 1);
          if (caret.from >= sel.to) return false;
          view.dispatch(view.state.tr.setSelection(caret));
          return false;
        },
      },
    },
  });
}

export class FigureNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  private img: HTMLImageElement;
  private handles: HandleEl[] = [];
  private rotateHandle: HTMLElement | null = null;
  private aspect = 1;
  /** The raw src attr; the DOM <img> src may be the resolved asset URL. */
  private rawSrc = "";
  /** Last-applied inline style values on the figure wrapper (idempotent). */
  private applied: Record<string, string | undefined> = {};
  /** Last-applied inline style values on the inner <img> (idempotent). */
  private appliedImg: Record<string, string | undefined> = {};

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement("figure");
    this.dom.className = "aw-figure";
    this.dom.setAttribute("data-aw-figure", "");

    this.img = document.createElement("img");
    this.img.draggable = false;
    this.img.alt = (node.attrs.alt as string) || "";
    this.img.title = (node.attrs.title as string) || "";
    this.applySize(node.attrs as Record<string, unknown>);
    this.rawSrc = (node.attrs.src as string) || "";
    this.img.setAttribute("src", this.rawSrc);
    this.dom.appendChild(this.img);

    this.contentDOM = document.createElement("figcaption");
    this.contentDOM.className = "aw-figure__caption";
    this.dom.appendChild(this.contentDOM);

    this.syncAttrs(node.attrs as Record<string, unknown>);
    this.createHandles();
    this.createRotateHandle();
    this.bindEvents();

    // Resolve the asset URL asynchronously (like ImageNodeView) so the photo
    // shows once the internal path is translated. NO dimension probing here:
    // the figure is never re-sized (FIX 1).
    this.resolveSrc();
  }

  /** Resolve the internal asset path to a displayable URL (cached by rawSrc). */
  private resolveSrc(): void {
    const rawSrc = this.rawSrc;
    if (!rawSrc) return;
    void resolveImageSrc(rawSrc).then((resolved) => {
      if (resolved && this.rawSrc === rawSrc && this.img.getAttribute("src") === rawSrc) {
        this.img.setAttribute("src", resolved);
      }
    });
  }

  /** Write a style property only when its value actually changes. */
  private setStyle(
    cache: Record<string, string | undefined>,
    el: HTMLElement,
    prop: string,
    value: string | null | undefined
  ): void {
    const v = value ?? undefined;
    if (cache[prop] === v) return;
    cache[prop] = v;
    if (v === undefined) el.style.removeProperty(prop);
    else el.style.setProperty(prop, v);
  }

  /** Mirror node attrs onto the DOM (cached idempotent writes). */
  private syncAttrs(attrs: Record<string, unknown>): void {
    const align = (attrs.align as string) || "center";
    if (this.dom.getAttribute("data-align") !== align) {
      this.dom.setAttribute("data-align", align);
    }
    if (attrs.wrap) this.dom.setAttribute("data-wrap", "");
    else this.dom.removeAttribute("data-wrap");

    const layout = String(attrs.captionLayout ?? "below");
    if (this.dom.getAttribute("data-caption-layout") !== layout) {
      this.dom.setAttribute("data-caption-layout", layout);
    }

    const rawGap = Number(attrs.captionGap);
    const gap = isFinite(rawGap) ? Math.max(0, Math.min(120, rawGap)) : 0;
    if (this.dom.getAttribute("data-caption-gap") !== String(gap)) {
      this.dom.setAttribute("data-caption-gap", String(gap));
    }
    this.setStyle(this.applied, this.dom, "--aw-figure-gap", `${gap}px`);

    const bg = String(attrs.captionBg ?? "");
    if (this.dom.getAttribute("data-caption-bg") !== bg) {
      if (bg) this.dom.setAttribute("data-caption-bg", bg);
      else this.dom.removeAttribute("data-caption-bg");
    }

    this.applyCaptionStyle(attrs);

    this.applyTransform(attrs);
    this.applyStyle(attrs);

    if (this.img.alt !== (attrs.alt as string)) this.img.alt = (attrs.alt as string) || "";
    if (this.img.title !== (attrs.title as string)) this.img.title = (attrs.title as string) || "";
    const newSrc = (attrs.src as string) || "";
    if (newSrc !== this.rawSrc) {
      this.rawSrc = newSrc;
      this.img.setAttribute("src", newSrc);
      this.resolveSrc();
    }
    this.applySize(attrs);
  }

  /** Rotation + flips transform the whole figure unit. */
  private applyTransform(attrs: Record<string, unknown>): void {
    const rotation = (attrs.rotation as number) || 0;
    const flipH = attrs.flipH as boolean;
    const flipV = attrs.flipV as boolean;
    const parts: string[] = [];
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (flipH && flipV) parts.push("scale(-1, -1)");
    else if (flipH) parts.push("scaleX(-1)");
    else if (flipV) parts.push("scaleY(-1)");
    this.setStyle(this.applied, this.dom, "transform", parts.length ? parts.join(" ") : undefined);
  }

  /** Frame (outline, decorative) + shadow wrap the WHOLE figure (photo + caption)
   *  without reducing anything; the photo keeps only its corner radius. */
  private applyStyle(attrs: Record<string, unknown>): void {
    const css = computeImageCss(normalizeImageStyle(attrs));
    this.setStyle(this.applied, this.dom, "border-radius", css.borderRadius ?? null);
    this.setStyle(this.applied, this.dom, "outline", css.border ?? null);
    this.setStyle(this.applied, this.dom, "outline-offset", css.border ? "0px" : null);
    this.setStyle(this.applied, this.dom, "box-shadow", css.boxShadow ?? null);
    this.setStyle(this.appliedImg, this.img, "border-radius", css.borderRadius ?? null);
    this.setStyle(this.appliedImg, this.img, "border", null);
    this.setStyle(this.appliedImg, this.img, "box-shadow", null);
  }

  /** Caption look: background fills the strip, vertical whitespace via padding. */
  private applyCaptionStyle(attrs: Record<string, unknown>): void {
    const bg = String(attrs.captionBg ?? "");
    if (this.contentDOM.style.background !== bg) {
      this.contentDOM.style.background = bg;
    }
    const padTop = Number(attrs.captionPadTop);
    const padBottom = Number(attrs.captionPadBottom);
    const top = isFinite(padTop) ? Math.max(0, Math.min(60, padTop)) : 0;
    const bottom = isFinite(padBottom) ? Math.max(0, Math.min(60, padBottom)) : 0;
    const padding = `${top}px 8px ${bottom}px`;
    if (this.contentDOM.style.padding !== padding) {
      this.contentDOM.style.padding = padding;
    }
    const dark = !!bg && !isLightBgColor(bg);
    this.contentDOM.classList.toggle("image-caption--dark-bg", dark);
  }

  /**
   * FIX 2: explicit width always; explicit height ONLY when the aspect is
   * unlocked. While locked (default) the browser keeps the intrinsic ratio,
   * so the photo can never become an ellipse.
   */
  private applySize(attrs: Record<string, unknown>): void {
    const w = attrs.width as number | null;
    const h = attrs.height as number | null;
    const locked = attrs.aspectLocked !== false;
    this.setStyle(this.appliedImg, this.img, "width", w ? `${w}px` : null);
    this.setStyle(this.appliedImg, this.img, "height", locked ? null : h ? `${h}px` : null);
  }

  private createHandles(): void {
    const corners: Corner[] = ["tl", "tr", "bl", "br"];
    for (const corner of corners) {
      const handle = document.createElement("div") as unknown as HandleEl;
      handle._corner = corner;
      handle.className = `image-resize-handle image-resize-handle--${corner}`;
      handle.addEventListener("mousedown", (e) => this.onHandleMouseDown(e, corner));
      this.dom.appendChild(handle);
      this.handles.push(handle);
    }
  }

  private createRotateHandle(): void {
    this.rotateHandle = document.createElement("div");
    this.rotateHandle.className = "image-rotate-handle";
    this.rotateHandle.addEventListener("mousedown", (e) => this.onRotateMouseDown(e));
    this.dom.appendChild(this.rotateHandle);
  }

  private bindEvents(): void {
    this.dom.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.classList.contains("image-resize-handle")) return;
      if (target.classList.contains("image-rotate-handle")) return;
      // Click on the photo (not the caption text) selects the figure as a unit.
      if (target === this.img) {
        e.preventDefault();
        this.selectNodeInEditor();
      }
    });
  }

  /** PM must not process the parts we manage ourselves. */
  stopEvent(e: Event): boolean {
    if (e.target instanceof HTMLElement) {
      if (e.target.classList.contains("image-resize-handle")) return true;
      if (e.target.classList.contains("image-rotate-handle")) return true;
    }
    return false;
  }

  private selectNodeInEditor(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== FIGURE_NODE) return;
    const sel = NodeSelection.create(this.view.state.doc, pos);
    this.view.dispatch(this.view.state.tr.setSelection(sel));
    this.view.focus();
  }

  private onHandleMouseDown(e: MouseEvent, corner: Corner): void {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const aspectLocked = node.attrs.aspectLocked !== false;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = this.img.clientWidth;
    const startHeight = this.img.clientHeight;
    const aspect = startHeight / startWidth || this.aspect;

    const computeNewSize = (ev: MouseEvent): { width: number; height: number } => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let deltaX = dx;
      let deltaY = dy;
      if (corner === "tl" || corner === "bl") deltaX = -dx;
      if (corner === "tl" || corner === "tr") deltaY = -dy;
      let newWidth = Math.max(50, startWidth + deltaX);
      let newHeight = Math.max(20, startHeight + deltaY);
      if (aspectLocked) {
        const ratio = aspect > 0 ? aspect : startHeight / startWidth;
        const avg = (Math.abs(deltaX) + Math.abs(deltaY)) / 2;
        const sign = deltaX + deltaY >= 0 ? 1 : -1;
        newWidth = Math.max(50, startWidth + sign * avg);
        newHeight = Math.round(newWidth * ratio);
      }
      return { width: newWidth, height: newHeight };
    };

    const onMove = (ev: MouseEvent) => {
      const { width, height } = computeNewSize(ev);
      this.img.style.width = `${width}px`;
      this.img.style.height = `${height}px`;
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const { width, height } = computeNewSize(ev);
      void this.persistSize(width, height);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private async persistSize(width: number, height: number): Promise<void> {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    try {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        width: Math.round(width),
        height: Math.round(height),
      });
      this.view.dispatch(tr);
    } catch { /* ignore schema mismatch on resize */ }
  }

  private onRotateMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const rect = this.dom.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const computeRotation = (ev: MouseEvent): number => {
      const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI) + 90;
      return ((Math.round(angle) % 360) + 360) % 360;
    };

    const onMove = (ev: MouseEvent) => {
      const deg = computeRotation(ev);
      const parts: string[] = [`rotate(${deg}deg)`];
      const flipH = node.attrs.flipH as boolean;
      const flipV = node.attrs.flipV as boolean;
      if (flipH && flipV) parts.push("scale(-1, -1)");
      else if (flipH) parts.push("scaleX(-1)");
      else if (flipV) parts.push("scaleY(-1)");
      this.dom.style.transform = parts.join(" ");
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const deg = computeRotation(ev);
      try {
        const tr = this.view.state.tr.setNodeMarkup(pos!, undefined, {
          ...node.attrs,
          rotation: deg,
        });
        this.view.dispatch(tr);
      } catch { /* safeSetNodeMarkup: ignore invalid content errors */ }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== FIGURE_NODE) return false;
    this.syncAttrs(node.attrs as Record<string, unknown>);
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("aw-figure--selected");
  }

  deselectNode(): void {
    this.dom.classList.remove("aw-figure--selected");
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
    this.handles = [];
    this.rotateHandle = null;
  }
}
