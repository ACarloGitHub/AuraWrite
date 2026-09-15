import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { invoke } from "@tauri-apps/api/core";
import { resolveImageSrc, uploadImageFile } from "./image-uploader";
import {
  applyFrameAndShadow,
  applyWrapMarker,
  selectNodeAt,
  setStyleCached,
  transformStyleOf,
} from "./element-view";
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
import { elementDecorationExtent } from "./element-decoration";
import { OBSTACLE_MARGIN_PX } from "./text-obstacles";

export class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private wrapper: HTMLElement;
  private img: HTMLImageElement;
  private handles: HTMLElement[] = [];
  private rotateHandle: HTMLElement | null = null;
  private aspect = 1;
  /** Last-applied inline style values (idempotent writes: avoid spurious
   *  DOM mutations that ProseMirror's observer misreads as document edits). */
  private appliedImg: Record<string, string | undefined> = {};
  private appliedWrapper: Record<string, string | undefined> = {};

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.wrapper = document.createElement("div");
    this.wrapper.className = "image-node-wrapper";
    const attrs = node.attrs;
    this.wrapper.setAttribute("data-align", (attrs.align as string) || "center");
    applyWrapMarker(this.wrapper, attrs);
    this.applyTransform(attrs);

    this.img = document.createElement("img");
    this.img.alt = (attrs.alt as string) || "";
    this.img.title = (attrs.title as string) || "";
    this.applySize(attrs);
    this.applyStyle(attrs);
    this.img.setAttribute("src", (attrs.src as string) || "");
    this.img.draggable = false;

    this.wrapper.appendChild(this.img);
    this.createHandles();
    this.createRotateHandle();
    this.bindEvents();

    this.dom = this.wrapper;
    // Resolve the asset URL first, THEN probe natural dimensions: probing the
    // raw internal path fails silently and skips sizing/self-heal entirely.
    void this.resolveAndProbe((attrs.src as string) || "");
  }

  private async resolveAndProbe(rawSrc: string): Promise<void> {
    let url = rawSrc;
    try {
      const resolved = await resolveImageSrc(rawSrc);
      if (resolved) {
        url = resolved;
        if (this.img.getAttribute("src") === rawSrc) this.img.setAttribute("src", resolved);
      }
    } catch (e) {
      console.warn("[image] resolve failed, using original src:", e);
    }
    this.probeNaturalDimensions(url);
  }

  private probeNaturalDimensions(url: string): void {
    if (!url) return;
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth > 0) {
        this.aspect = probe.naturalHeight / probe.naturalWidth;
        // Self-heal: correct distorted or missing sizes once the natural
        // aspect is known (bad import data, legacy docs, unknown formats).
        void this.selfHealSize(probe.naturalWidth, probe.naturalHeight);
      }
    };
    probe.onerror = () => {
      /* dimension probe unavailable — leave stored size untouched */
    };
    probe.src = url;
  }

  /**
   * Once natural dimensions are known:
   *  - an image with NO explicit size gets sized from naturals, capped to the
   *    editor width so wide images fit instead of overflowing;
   *  - an ASPECT-LOCKED image whose stored w/h contradict the natural ratio
   *    (stretched import) gets its height corrected back to the true ratio.
   * Unlocked images with explicit size are left untouched (user's choice).
   */
  private async selfHealSize(naturalWidth: number, naturalHeight: number): Promise<void> {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "image") return;

    const w = node.attrs.width as number | null;
    const h = node.attrs.height as number | null;
    const containerWidth = this.measureContentWidth();

    // Virgin insert storing raw natural size wider than the content column:
    // fit it to the column, preserving the ratio (high-resolution photos).
    if (
      node.attrs.aspectLocked !== false &&
      w != null && h != null &&
      w === naturalWidth && h === naturalHeight &&
      w > containerWidth
    ) {
      const target = Math.max(200, containerWidth);
      await this.persistSize(target, Math.round((target * naturalHeight) / naturalWidth));
      return;
    }

    if (w == null && h == null) {
      const target = Math.max(120, Math.min(naturalWidth, Math.max(200, containerWidth)));
      await this.persistSize(target, Math.round((target * naturalHeight) / naturalWidth));
      return;
    }

    if (node.attrs.aspectLocked === false || w == null || h == null || w <= 0) return;
    const currentRatio = h / w;
    const naturalRatio = naturalHeight / naturalWidth;
    if (Math.abs(currentRatio - naturalRatio) > 0.02) {
      await this.persistSize(w, Math.round(w * naturalRatio));
    }
  }

  /** Usable content width of the editor (client width minus its paddings). */
  private measureContentWidth(): number {
    const dom = this.view.dom as HTMLElement | null;
    if (!dom) return 602;
    const cs = window.getComputedStyle(dom);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    return Math.max(200, dom.clientWidth - padL - padR);
  }

  private applyTransform(attrs: Record<string, unknown>): void {
    setStyleCached(this.appliedWrapper, this.wrapper, "transform", transformStyleOf(attrs));
  }

  /** Frame + shadow wrap the whole painted unit, one shared rule. */
  private applyStyle(attrs: Record<string, unknown>): void {
    applyFrameAndShadow(this.appliedWrapper, this.wrapper, this.appliedImg, this.img, attrs);
    // T1.4: when the image floats in the flow, the air it keeps from the text
    // must include the frame and the shadow, not just the photo.
    const align = String(attrs.align ?? "center");
    const floating =
      !attrs.free && isWrapping(parseTextCondition(attrs.wrap)) && (align === "left" || align === "right");
    const gap = floating
      ? `${OBSTACLE_MARGIN_PX + Math.round(elementDecorationExtent(attrs, "image").x)}px`
      : null;
    setStyleCached(this.appliedWrapper, this.wrapper, "--aw-float-gap", gap);
  }

  private applySize(attrs: Record<string, unknown>): void {
    const w = attrs.width as number | null;
    const h = attrs.height as number | null;
    setStyleCached(this.appliedImg, this.img, "width", w ? `${w}px` : null);
    setStyleCached(this.appliedImg, this.img, "height", h ? `${h}px` : null);
  }

  private createHandles(): void {
    // U7.3: the four corner handles and their gesture live in
    // `element-handles.ts`, shared with the figure.
    this.handles = createCornerHandles(this.wrapper, (e, corner) =>
      this.onHandleMouseDown(e, corner)
    );
  }

  private createRotateHandle(): void {
    // U7: the gesture itself lives in `element-handles.ts`, shared with the
    // figure and the box. The image never had a tooltip here, so it keeps none.
    this.rotateHandle = createRotateHandle(this.wrapper, (e) =>
      startRotateDrag(this.view, this.getPos, this.wrapper, e)
    );
  }

  private bindEvents(): void {
    this.wrapper.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectNodeInEditor();
    });
    this.wrapper.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      void this.replaceImage();
    });
    this.wrapper.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (isCornerHandle(target)) return;
      if (isRotateHandle(target)) return;
      e.preventDefault();
      this.selectNodeInEditor();
      // F3: pressing the photo and moving starts the free drag (contract §4).
      // A press without movement stays a plain selection, as it always was.
      void import("./free-drag").then((m) =>
        m.startFreeDrag(this.view, this.getPos, this.wrapper, e),
      );
    });
  }

  private selectNodeInEditor(): void {
    const pos = this.getPos();
    if (pos == null) return;
    selectNodeAt(this.view, pos);
  }

  private onHandleMouseDown(e: MouseEvent, corner: Corner): void {
    startCornerResize({
      view: this.view,
      getPos: this.getPos,
      event: e,
      corner,
      startWidth: this.img.clientWidth,
      startHeight: this.img.clientHeight,
      naturalRatio: this.aspect,
      paint: (width, height) => {
        this.img.style.width = `${width}px`;
        this.img.style.height = `${height}px`;
      },
      commit: (width, height) => void this.persistSize(width, height),
    });
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

  private async replaceImage(): Promise<void> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const fileName = selected.split(/[\\/]/).pop() || "image";
      const base64 = await invoke<string>("load_binary_file", { path: selected });
      const fakeFile = this.makeFileLike(fileName, this.mimeFromFilename(fileName), base64);
      const uploaded = await uploadImageFile(fakeFile);
      const pos = this.getPos();
      if (pos == null) return;
      const node = this.view.state.doc.nodeAt(pos);
      if (!node) return;
      try {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: uploaded.src,
          alt: uploaded.filename,
          title: uploaded.filename,
          width: uploaded.width,
          height: uploaded.height,
        });
        this.view.dispatch(tr);
      } catch { /* safeSetNodeMarkup: ignore invalid content errors */ }
    } catch (e) {
      console.warn("[image] replace failed:", e);
    }
  }

  private makeFileLike(name: string, type: string, base64: string): File {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type });
    return new File([blob], name, { type });
  }

  private mimeFromFilename(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".bmp")) return "image/bmp";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
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
    const newSrc = (attrs.src as string) || "";
    const currentSrc = this.img.getAttribute("src") || "";
    if (newSrc && newSrc !== currentSrc && newSrc !== this.img.dataset?.pendingSrc) {
      this.img.dataset.pendingSrc = newSrc;
      const pendingSrc = newSrc;
      void resolveImageSrc(newSrc).then((resolved: string) => {
        if (resolved && this.img.dataset.pendingSrc === pendingSrc) {
          this.img.setAttribute("src", resolved);
          delete this.img.dataset.pendingSrc;
        }
      });
    }
    this.applySize(attrs);
    const newAlign = (attrs.align as string) || "center";
    if (this.wrapper.getAttribute("data-align") !== newAlign) {
      this.wrapper.setAttribute("data-align", newAlign);
    }
    applyWrapMarker(this.wrapper, attrs);
    this.applyTransform(attrs);
    this.applyStyle(attrs);
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