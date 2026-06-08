import { Node as PMNode } from "prosemirror-model";
import { NodeView } from "prosemirror-view";
import { resolveImageSrc } from "./image-uploader";

export class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private resolved = false;

  constructor(node: PMNode) {
    this.img = document.createElement("img");
    const attrs = node.attrs;
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    if (attrs.width) this.img.setAttribute("width", String(attrs.width));
    if (attrs.height) this.img.setAttribute("height", String(attrs.height));
    this.img.setAttribute("data-align", (attrs.align as string) || "center");
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.dom = this.img;
    void this.resolveSrc(attrs.src as string);
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
    if (this.img.getAttribute("width") !== newWidth) {
      if (newWidth) this.img.setAttribute("width", newWidth);
      else this.img.removeAttribute("width");
    }
    const newHeight = attrs.height ? String(attrs.height) : null;
    if (this.img.getAttribute("height") !== newHeight) {
      if (newHeight) this.img.setAttribute("height", newHeight);
      else this.img.removeAttribute("height");
    }
    const newAlign = (attrs.align as string) || "center";
    if (this.img.getAttribute("data-align") !== newAlign) {
      this.img.setAttribute("data-align", newAlign);
    }
    return true;
  }
}
