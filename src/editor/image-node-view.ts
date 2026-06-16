import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { resolveImageSrc } from "./image-uploader";

type Corner = "tl" | "tr" | "bl" | "br";

interface HandleEl extends HTMLElement {
  _corner: Corner;
}

export class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private wrapper: HTMLElement;
  private img: HTMLImageElement;
  private handles: HandleEl[] = [];
  private resolved = false;
  private aspect = 1;

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "image-node-wrapper";
    const attrs = node.attrs;
    this.wrapper.setAttribute("data-align", (attrs.align as string) || "center");
    if (attrs.wrap) this.wrapper.setAttribute("data-wrap", "");
    this.applyTransform(attrs);

    this.img = document.createElement("img");
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    if (attrs.width) this.img.setAttribute("width", String(attrs.width));
    if (attrs.height) this.img.setAttribute("height", String(attrs.height));
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.img.draggable = false;

    this.wrapper.appendChild(this.img);
    this.createHandles();
    this.bindEvents();

    this.dom = this.wrapper;
    void this.resolveSrc(attrs.src as string);
    void this.loadNaturalDimensions(attrs.src as string);
  }

  private async resolveSrc(src: string): Promise<void> {
    if (this.resolved) return;
    this.resolved = true;
    try {
      const resolved = await resolveImageSrc(src);
      if (resolved && resolved !== this.img.getAttribute("src")) {
        this.img.setAttribute("src", resolved);
      }
    } catch (e) {
      console.warn("[image] resolve failed, using original src:", e);
    }
  }

  private async loadNaturalDimensions(src: string): Promise<void> {
    return new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth > 0) {
          this.aspect = probe.naturalHeight / probe.naturalWidth;
        }
        resolve();
      };
      probe.onerror = () => resolve();
      const url = this.img.getAttribute("src") || src;
      probe.src = url;
    });
  }

  private applyTransform(attrs: Record<string, unknown>): void {
    const rotation = (attrs.rotation as number) || 0;
    const flipH = attrs.flipH as boolean;
    const flipV = attrs.flipV as boolean;
    const parts: string[] = [];
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (flipH && flipV) parts.push("scale(-1, -1)");
    else if (flipH) parts.push("scaleX(-1)");
    else if (flipV) parts.push("scaleY(-1)");
    if (parts.length) {
      this.wrapper.style.transform = parts.join(" ");
    } else {
      this.wrapper.style.removeProperty("transform");
    }
  }

  private createHandles(): void {
    const corners: Corner[] = ["tl", "tr", "bl", "br"];
    for (const corner of corners) {
      const handle = document.createElement("div") as unknown as HandleEl;
      handle._corner = corner;
      handle.className = `image-resize-handle image-resize-handle--${corner}`;
      handle.addEventListener("mousedown", (e) => this.onHandleMouseDown(e, corner));
      this.wrapper.appendChild(handle);
      this.handles.push(handle);
    }
  }

  private bindEvents(): void {
    this.wrapper.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectNodeInEditor();
    });
    this.wrapper.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).classList.contains("image-resize-handle")) return;
      e.preventDefault();
      this.selectNodeInEditor();
    });
  }

  private selectNodeInEditor(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
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
        if (corner === "tl" || corner === "br") {
          const avg = (Math.abs(deltaX) + Math.abs(deltaY)) / 2;
          const sign = (deltaX + deltaY) >= 0 ? 1 : -1;
          newWidth = Math.max(50, startWidth + sign * avg);
          newHeight = Math.round(newWidth * ratio);
        } else {
          const avg = (Math.abs(deltaX) + Math.abs(deltaY)) / 2;
          const sign = (deltaX - deltaY) >= 0 ? 1 : -1;
          newWidth = Math.max(50, startWidth + sign * avg);
          newHeight = Math.round(newWidth * ratio);
        }
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
      this.img.style.width = "";
      this.img.style.height = "";
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
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      width: Math.round(width),
      height: Math.round(height),
    });
    this.view.dispatch(tr);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "image") return false;
    const attrs = node.attrs;
    if (this.img.alt !== (attrs.alt as string)) {
      this.img.alt = (attrs.alt as string) || "";
    }
    if (this.img.title !== (attrs.title as string)) {
      this.img.title = (attrs.title as string) || "";
    }
    const newWidth = attrs.width ? String(attrs.width) : null;
    if (newWidth) this.img.setAttribute("width", newWidth);
    else this.img.removeAttribute("width");
    const newHeight = attrs.height ? String(attrs.height) : null;
    if (newHeight) this.img.setAttribute("height", newHeight);
    else this.img.removeAttribute("height");
    const newAlign = (attrs.align as string) || "center";
    if (this.wrapper.getAttribute("data-align") !== newAlign) {
      this.wrapper.setAttribute("data-align", newAlign);
    }
    if (attrs.wrap) {
      this.wrapper.setAttribute("data-wrap", "");
    } else {
      this.wrapper.removeAttribute("data-wrap");
    }
    this.applyTransform(attrs);
    return true;
  }

  selectNode(): void {
    this.wrapper.classList.add("image-node-wrapper--selected");
  }

  deselectNode(): void {
    this.wrapper.classList.remove("image-node-wrapper--selected");
  }

  destroy(): void {
    this.handles = [];
  }
}