import { Node as PMNode } from "prosemirror-model";
import { NodeView, EditorView } from "prosemirror-view";
import { NodeSelection } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { resolveImageSrc, uploadImageFile } from "./image-uploader";
import { computeImageCss, normalizeImageStyle } from "./image-style";

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
  private captionEl: HTMLElement | null = null;
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
    if (attrs.wrap) this.wrapper.setAttribute("data-wrap", "");
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
    this.applyCaption(attrs);
    this.bindEvents();

    this.dom = this.wrapper;
    // Resolve the asset URL first, THEN probe natural dimensions: probing the
    // raw internal path fails silently and skips sizing/self-heal entirely.
    void this.resolveAndProbe((attrs.src as string) || "");
  }

  /** Write an inline style property only when its value actually changes.
   *  A value of null/undefined removes the property (falls back to CSS). */
  private setStyleCached(
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
    const rotation = (attrs.rotation as number) || 0;
    const flipH = attrs.flipH as boolean;
    const flipV = attrs.flipV as boolean;
    const parts: string[] = [];
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (flipH && flipV) parts.push("scale(-1, -1)");
    else if (flipH) parts.push("scaleX(-1)");
    else if (flipV) parts.push("scaleY(-1)");
    this.setStyleCached(this.appliedWrapper, this.wrapper, "transform", parts.length ? parts.join(" ") : undefined);
  }

  /**
   * Frame (cornice) and shadow are DECORATIVE and wrap the whole unit (photo +
   * caption): the photo keeps only its corner radius; the frame is drawn as an
   * `outline` on the wrapper and the shadow as a `box-shadow` on the wrapper.
   * Neither participates in layout, so the photo/caption are NEVER reduced and
   * there is NO gap between them or between frame and content (the frame hugs
   * the unit's outer edge, offset 0).
   */
  private applyStyle(attrs: Record<string, unknown>): void {
    const css = computeImageCss(normalizeImageStyle(attrs));
    const radius = css.borderRadius ?? null;
    const frame = css.border ?? null; // e.g. "2px solid #333" → used as outline
    const shadow = css.boxShadow ?? null;

    // Wrapper = the whole unit: rounded outline (frame) + drop shadow.
    this.setStyleCached(this.appliedWrapper, this.wrapper, "border-radius", radius);
    this.setStyleCached(this.appliedWrapper, this.wrapper, "outline", frame);
    this.setStyleCached(this.appliedWrapper, this.wrapper, "outline-offset", frame ? "0px" : null);
    this.setStyleCached(this.appliedWrapper, this.wrapper, "box-shadow", shadow);

    // Photo: rounded corners only (matches the wrapper), no frame/shadow of its
    // own — a border on the <img> would shrink it (border-box) and split the
    // frame away from the caption.
    this.setStyleCached(this.appliedImg, this.img, "border-radius", radius);
    this.setStyleCached(this.appliedImg, this.img, "border", null);
    this.setStyleCached(this.appliedImg, this.img, "box-shadow", null);
  }

  private applyCaption(attrs: Record<string, unknown>): void {
    const caption = (attrs.caption as string) || "";
    if (caption) {
      if (!this.captionEl) {
        this.captionEl = document.createElement("div");
        this.captionEl.className = "image-caption";
        this.wrapper.appendChild(this.captionEl);
      }
      if (this.captionEl.textContent !== caption) {
        this.captionEl.textContent = caption;
      }
    } else if (this.captionEl) {
      this.captionEl.remove();
      this.captionEl = null;
    }
  }

  private applySize(attrs: Record<string, unknown>): void {
    const w = attrs.width as number | null;
    const h = attrs.height as number | null;
    this.setStyleCached(this.appliedImg, this.img, "width", w ? `${w}px` : null);
    this.setStyleCached(this.appliedImg, this.img, "height", h ? `${h}px` : null);
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
    this.wrapper.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      void this.replaceImage();
    });
    this.wrapper.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.classList.contains("image-resize-handle")) return;
      if (target.classList.contains("image-rotate-handle")) return;
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
    const _startRotation = (node.attrs.rotation as number) || 0;
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
    if (attrs.wrap) {
      this.wrapper.setAttribute("data-wrap", "");
    } else {
      this.wrapper.removeAttribute("data-wrap");
    }
    this.applyTransform(attrs);
    this.applyStyle(attrs);
    this.applyCaption(attrs);
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
    this.captionEl = null;
  }
}