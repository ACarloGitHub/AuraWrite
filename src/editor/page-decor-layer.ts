/**
 * E8 — the screen's own drawing of the page decoration
 * ([[concepts/editor-enrichment-page-decor]]).
 *
 * One box per page, behind the text, `pointer-events: none`: not a container.
 * The page in a paged view is the interval between two dividers, and the
 * project's dead ends are exactly the attempts to wrap the text in a node
 * ([[concepts/abandoned-approaches]]). So this layer draws OVER the flat flow
 * and never touches it: no document node, no attribute, no second measurement.
 *
 * The geometry is the one the calculator already knows: page `n` occupies
 * `(n-1) × height` in the sheet's own axis, and the text area starts at the
 * margins. The layer is a sibling of the sheet, inside the element that carries
 * the visual zoom, so it scales and scrolls with the page and no coordinate has
 * to cross the zoom border.
 *
 * WHAT IS DRAWN, AND WHEN: only the pages the viewport shows (one page of
 * overscan). The sheets are painted even with no decoration, because the paper
 * lives here now (the sheet's own background is transparent, so the layer can
 * sit between paper and text); border and watermark join them when they exist.
 * A keystroke that does not change the page count changes no box, because the
 * boxes do not depend on where the text stopped — only on format and margins.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { getPageFormat, getContentWidth, getContentHeight } from "./pagination-cassie";
import { getMargins } from "./pagination-state";
import { appliedScale } from "./editor-zoom";
import {
  PAGE_DECOR_EVENT,
  WATERMARK_FONT_PX,
  borderBox,
  borderStrokePx,
  getPageDecor,
  watermarkOpacity,
  type PageWatermark,
} from "./page-decor";

const pageDecorPluginKey = new PluginKey("pageDecorLayer");

/** Pages drawn beyond the viewport, so a fast scroll does not show a gap. */
const OVERSCAN_PAGES = 1;

/** The text area of the sheet, in the sheet's own coordinates. */
function textAreaOf(): { left: number; top: number; width: number; height: number } {
  const margins = getMargins();
  return {
    left: margins.left,
    top: margins.top,
    width: getContentWidth(margins),
    height: getContentHeight(margins),
  };
}

function borderElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "aw-page-decor__border";
  return el;
}

function watermarkElement(watermark: PageWatermark): HTMLElement {
  const box = document.createElement("div");
  box.className = "aw-page-decor__watermark";
  const text = document.createElement("span");
  text.textContent = watermark.text;
  text.style.fontFamily = watermark.font;
  text.style.fontSize = `${WATERMARK_FONT_PX}px`;
  text.style.color = watermark.color;
  text.style.opacity = String(watermarkOpacity(watermark));
  // LibreOffice counts the angle counter-clockwise; CSS turns clockwise.
  text.style.transform = `rotate(${-watermark.angle}deg)`;
  box.appendChild(text);
  return box;
}

/**
 * The layer, as one element. It lives in the zoom mount (the sheet's own box)
 * and is positioned on the sheet's corner: the mount is the sheet's frame, the
 * padding of the paged editor is the page's margins, and the boxes below are in
 * layout pixels like every other page number in the project.
 */
class PageDecorLayer {
  private readonly view: EditorView;
  private readonly layer: HTMLElement;
  private readonly mount: HTMLElement | null;
  private frame = 0;
  private pages = 1;
  private pagesDirty = true;

  constructor(view: EditorView) {
    this.view = view;
    this.mount = view.dom.parentElement;
    this.layer = document.createElement("div");
    this.layer.className = "aw-page-decor";
    this.mount?.appendChild(this.layer);

    // The scroll does not bubble: capture is the only way to hear every
    // container the page may be scrolled in.
    window.addEventListener("scroll", this.schedule, { capture: true, passive: true });
    window.addEventListener("resize", this.schedule);
    window.addEventListener(PAGE_DECOR_EVENT, this.schedule);
    this.schedule();
  }

  /** A document changed: the number of pages may have, the boxes have not. */
  update(): void {
    this.pagesDirty = true;
    this.schedule();
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    window.removeEventListener("scroll", this.schedule, { capture: true });
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener(PAGE_DECOR_EVENT, this.schedule);
    this.layer.remove();
  }

  private readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  };

  /** How many sheets the document has, read from the dividers it already drew. */
  private countPages(host: HTMLElement): number {
    let pages = 1;
    host.querySelectorAll<HTMLElement>(".aw-page-break--paged").forEach((divider) => {
      const page = Number(divider.dataset.page || "0");
      if (page > pages) pages = page;
    });
    return pages;
  }

  private paint(): void {
    const host = this.view.dom as HTMLElement;
    const mount = this.mount;
    const decor = getPageDecor();
    const paged = host.classList.contains("is-cassie-paged") && !document.body.classList.contains("codemirror-mode");
    if (!mount || !paged) {
      this.layer.replaceChildren();
      return;
    }

    if (this.pagesDirty) {
      this.pages = this.countPages(host);
      this.pagesDirty = false;
    }

    // The sheet's corner inside the mount (the mount carries a strip of
    // background above the page in the paged view). The mount is the offset
    // parent now (position: relative), so the host's own offsets are already
    // relative to the layer's containing block.
    this.layer.style.top = `${host.offsetTop}px`;
    this.layer.style.left = `${host.offsetLeft}px`;
    this.layer.style.width = `${host.offsetWidth}px`;
    this.layer.style.height = `${host.offsetHeight}px`;

    // Which sheets the screen shows, in the sheet's own (unscaled) pixels.
    const page = getPageFormat();
    const scale = appliedScale(host) || 1;
    const scroller = host.closest("#editor") as HTMLElement | null;
    const sheetTop = host.getBoundingClientRect().top;
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewHeight = scroller ? scroller.clientHeight : window.innerHeight;
    const visibleTop = Math.max(0, viewTop - sheetTop) / scale;
    const visibleBottom = visibleTop + viewHeight / scale;
    const first = Math.max(1, Math.floor(visibleTop / page.heightPx) + 1 - OVERSCAN_PAGES);
    const last = Math.min(
      this.pages,
      Math.floor(visibleBottom / page.heightPx) + 1 + OVERSCAN_PAGES,
    );
    if (last < first) {
      this.layer.replaceChildren();
      return;
    }

    const area = textAreaOf();
    const sheetArea = { ...area, sheetWidth: page.widthPx, sheetHeight: page.heightPx };
    const fragment = document.createDocumentFragment();
    for (let number = first; number <= last; number++) {
      const sheet = document.createElement("div");
      sheet.className = "aw-page-decor__sheet";
      sheet.style.top = `${(number - 1) * page.heightPx}px`;
      sheet.style.width = `${page.widthPx}px`;
      sheet.style.height = `${page.heightPx}px`;

      if (decor.watermark) {
        const mark = watermarkElement(decor.watermark);
        mark.style.left = `${area.left}px`;
        mark.style.top = `${area.top}px`;
        mark.style.width = `${area.width}px`;
        mark.style.height = `${area.height}px`;
        sheet.appendChild(mark);
      }      if (decor.border) {
        const box = borderBox(sheetArea, decor.border);
        const rule = borderElement();
        rule.style.left = `${box.left}px`;
        rule.style.top = `${box.top}px`;
        rule.style.width = `${box.width}px`;
        rule.style.height = `${box.height}px`;
        rule.style.border = `${borderStrokePx(decor.border)}px solid ${decor.border.color}`;
        sheet.appendChild(rule);
      }
      fragment.appendChild(sheet);
    }
    this.layer.replaceChildren(fragment);
  }
}

/**
 * Draw the page decoration on screen. Registered AFTER the pagination plugin:
 * ProseMirror updates plugin views in order, so this one paints with the
 * dividers the closing pass has just put in place.
 */
export function createPageDecorLayerPlugin(): Plugin {
  return new Plugin({
    key: pageDecorPluginKey,
    view: (view) => {
      const layer = new PageDecorLayer(view);
      return {
        update: () => layer.update(),
        destroy: () => layer.destroy(),
      };
    },
  });
}