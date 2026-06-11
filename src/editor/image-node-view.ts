import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { resolveImageSrc } from "./image-uploader";

type Corner = "tl" | "tr" | "bl" | "br";

interface HandleEl extends HTMLElement {
  _corner: Corner;
}

const ALIGN_VALUES = ["left", "center", "right"] as const;
type Align = (typeof ALIGN_VALUES)[number];

function nextAlign(current: string): Align {
  const i = ALIGN_VALUES.indexOf(current as Align);
  if (i < 0) return "center";
  return ALIGN_VALUES[(i + 1) % ALIGN_VALUES.length] as Align;
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
    this.applyOffset(attrs.offsetX as number, attrs.offsetY as number);

    this.img = document.createElement("img");
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    if (attrs.width) this.img.setAttribute("width", String(attrs.width));
    if (attrs.height) this.img.setAttribute("height", String(attrs.height));
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.img.draggable = false;

    this.wrapper.appendChild(this.img);
    this.createHandles();
    this.bindWrapperDrag();

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

  private bindWrapperDrag(): void {
    this.wrapper.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.cycleAlignment();
    });
    this.wrapper.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).classList.contains("image-resize-handle")) return;
      void this.onWrapperMouseDown(e);
    });
  }

  private async onWrapperMouseDown(e: MouseEvent): Promise<void> {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const startOffsetX = (node.attrs.offsetX as number) || 0;
    const startOffsetY = (node.attrs.offsetY as number) || 0;
    const DRAG_THRESHOLD = 3;
    let dragging = false;
    let lastX = startOffsetX;
    let lastY = startOffsetY;

    const applyPreview = (x: number, y: number): void => {
      this.applyOffset(x, y);
    };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        this.wrapper.classList.add("image-node-wrapper--dragging");
        e.stopPropagation();
      }
      const newX = startOffsetX + dx;
      const newY = startOffsetY + dy;
      lastX = newX;
      lastY = newY;
      applyPreview(newX, newY);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this.wrapper.classList.remove("image-node-wrapper--dragging");
      if (dragging) {
        void this.persistOffset(Math.round(lastX), Math.round(lastY));
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private applyOffset(x: number, y: number): void {
    const ox = Math.round(x || 0);
    const oy = Math.round(y || 0);
    if (ox === 0 && oy === 0) {
      this.wrapper.style.removeProperty("transform");
      this.wrapper.removeAttribute("data-offset-x");
      this.wrapper.removeAttribute("data-offset-y");
    } else {
      this.wrapper.style.transform = `translate(${ox}px, ${oy}px)`;
      this.wrapper.setAttribute("data-offset-x", String(ox));
      this.wrapper.setAttribute("data-offset-y", String(oy));
    }
  }

  private async persistOffset(x: number, y: number): Promise<void> {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      offsetX: x,
      offsetY: y,
    });
    this.view.dispatch(tr);
  }

  private async cycleAlignment(): Promise<void> {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const current = (node.attrs.align as string) || "center";
    const newAlign = nextAlign(current);
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      align: newAlign,
    });
    this.view.dispatch(tr);
  }

  private onHandleMouseDown(e: MouseEvent, corner: Corner): void {
    e.preventDefault();
    e.stopPropagation();
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
      if (e.shiftKey) {
        const ratio = aspect > 0 ? aspect : startHeight / startWidth;
        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          newHeight = Math.round(newWidth * ratio);
        } else {
          newWidth = Math.round(newHeight / ratio);
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
    const newOffsetX = (attrs.offsetX as number) || 0;
    const newOffsetY = (attrs.offsetY as number) || 0;
    const currentX = parseInt(this.wrapper.getAttribute("data-offset-x") || "0", 10) || 0;
    const currentY = parseInt(this.wrapper.getAttribute("data-offset-y") || "0", 10) || 0;
    if (newOffsetX !== currentX || newOffsetY !== currentY) {
      this.applyOffset(newOffsetX, newOffsetY);
    }
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
