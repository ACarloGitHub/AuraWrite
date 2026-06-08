import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { resolveImageSrc } from "./image-uploader";
import { setImageSize } from "./image-commands";

interface HandleEl extends HTMLElement {
  _corner: "tl" | "tr" | "bl" | "br";
}

export class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private wrapper: HTMLElement;
  private img: HTMLImageElement;
  private handles: HandleEl[] = [];
  private resolved = false;
  private naturalWidth = 0;
  private naturalHeight = 0;

  constructor(node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "image-node-wrapper";
    const attrs = node.attrs;
    this.wrapper.setAttribute("data-align", (attrs.align as string) || "center");

    this.img = document.createElement("img");
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    if (attrs.width) this.img.setAttribute("width", String(attrs.width));
    if (attrs.height) this.img.setAttribute("height", String(attrs.height));
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.img.draggable = false;

    this.wrapper.appendChild(this.img);
    this.createHandles();

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
        this.naturalWidth = probe.naturalWidth;
        this.naturalHeight = probe.naturalHeight;
        resolve();
      };
      probe.onerror = () => resolve();
      const url = this.img.getAttribute("src") || src;
      probe.src = url;
    });
  }

  private createHandles(): void {
    const corners: Array<"tl" | "tr" | "bl" | "br"> = ["tl", "tr", "bl", "br"];
    for (const corner of corners) {
      const handle = document.createElement("div") as unknown as HandleEl;
      handle._corner = corner;
      handle.className = `image-resize-handle image-resize-handle--${corner}`;
      handle.addEventListener("mousedown", (e) => this.onHandleMouseDown(e, corner));
      this.wrapper.appendChild(handle);
      this.handles.push(handle);
    }
  }

  private onHandleMouseDown(e: MouseEvent, _corner: "tl" | "tr" | "bl" | "br"): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = this.img.clientWidth;
    const startHeight = this.img.clientHeight;
    const aspect = startHeight / startWidth;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + dx);
      const newHeight = aspect > 0 ? Math.round(newWidth * aspect) : startHeight;
      this.img.style.width = `${newWidth}px`;
      this.img.style.height = `${newHeight}px`;
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const dx = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + dx);
      const newHeight = aspect > 0 ? Math.round(newWidth * aspect) : startHeight;
      void this.persistSize(newWidth, newHeight);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private async persistSize(width: number, height: number): Promise<void> {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.view.state.doc.nodeAt(pos)?.attrs,
      width,
      height,
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
