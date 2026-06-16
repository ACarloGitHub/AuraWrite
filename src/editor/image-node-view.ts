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
  private rotateHandle: HTMLElement | null = null;
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
    this.applyOffset(attrs);

    this.img = document.createElement("img");
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    this.applySize(attrs);
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.img.draggable = false;

    this.wrapper.appendChild(this.img);
    this.createHandles();
    this.createRotateHandle();
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

  private applyOffset(attrs: Record<string, unknown>): void {
    const offsetLeft = (attrs.offsetLeft as number) || 0;
    const offsetTop = (attrs.offsetTop as number) || 0;
    if (offsetLeft) this.wrapper.style.marginLeft = `${offsetLeft}px`;
    else this.wrapper.style.removeProperty("margin-left");
    if (offsetTop) this.wrapper.style.marginTop = `${offsetTop}px`;
    else this.wrapper.style.removeProperty("margin-top");
  }

  private applySize(attrs: Record<string, unknown>): void {
    const w = attrs.width as number | null;
    const h = attrs.height as number | null;
    if (w) this.img.style.width = `${w}px`;
    else this.img.style.removeProperty("width");
    if (h) this.img.style.height = `${h}px`;
    else this.img.style.removeProperty("height");
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

  private createRotateHandle(): void {
    this.rotateHandle = document.createElement("div");
    this.rotateHandle.className = "image-rotate-handle";
    this.rotateHandle.addEventListener("mousedown", (e) => this.onRotateMouseDown(e));
    this.wrapper.appendChild(this.rotateHandle);
  }

  private bindEvents(): void {
    this.wrapper.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectNodeInEditor();
    });
    this.wrapper.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.classList.contains("image-resize-handle")) return;
      if (target.classList.contains("image-rotate-handle")) return;
      e.preventDefault();
      this.onDragStart(e);
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

  private onRotateMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const startRotation = (node.attrs.rotation as number) || 0;
    const rect = this.wrapper.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const computeRotation = (ev: MouseEvent): number => {
      const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI) + 90;
      return ((Math.round(angle) % 360) + 360) % 360;
    };

    const onMove = (ev: MouseEvent) => {
      const deg = computeRotation(ev);
      const parts: string[] = [];
      parts.push(`rotate(${deg}deg)`);
      const flipH = node.attrs.flipH as boolean;
      const flipV = node.attrs.flipV as boolean;
      if (flipH && flipV) parts.push("scale(-1, -1)");
      else if (flipH) parts.push("scaleX(-1)");
      else if (flipV) parts.push("scaleY(-1)");
      this.wrapper.style.transform = parts.join(" ");
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const deg = computeRotation(ev);
      const tr = this.view.state.tr.setNodeMarkup(pos!, undefined, {
        ...node.attrs,
        rotation: deg,
      });
      this.view.dispatch(tr);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private onDragStart(e: MouseEvent): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const startOffsetLeft = (node.attrs.offsetLeft as number) || 0;
    const startOffsetTop = (node.attrs.offsetTop as number) || 0;
    const startX = e.clientX;
    const startY = e.clientY;

    this.selectNodeInEditor();

    const computeOffset = (ev: MouseEvent): { offsetLeft: number; offsetTop: number } => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      return {
        offsetLeft: Math.max(0, startOffsetLeft + dx),
        offsetTop: Math.max(0, startOffsetTop + dy),
      };
    };

    const onMove = (ev: MouseEvent) => {
      const { offsetLeft, offsetTop } = computeOffset(ev);
      this.wrapper.style.marginLeft = `${offsetLeft}px`;
      this.wrapper.style.marginTop = `${offsetTop}px`;
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const { offsetLeft, offsetTop } = computeOffset(ev);
      const tr = this.view.state.tr.setNodeMarkup(pos!, undefined, {
        ...node.attrs,
        offsetLeft,
        offsetTop,
      });
      this.view.dispatch(tr);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
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
    this.applySize(attrs);
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
    this.applyOffset(attrs);
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
    this.rotateHandle = null;
  }
}