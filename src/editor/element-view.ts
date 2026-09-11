// ============================================================================
// Element view — shared helpers for the three block elements that live in the
// document (image, figure, styled_box).
//
// The three families had grown three copies of the same view/command code
// (cached style writes, rotation transform, frame and shadow painting, caption
// strip, keyboard guard). This module is the ONE place those rules live, so a
// correction lands once instead of three times and the three cannot drift
// apart. Structural extraction only: behaviour is byte-for-byte what the three
// separate copies did.
// ============================================================================

import { Node as PMNode } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { computeImageCss, normalizeImageStyle } from "./image-style";
import { isLightBgColor } from "./box-style";
import { isWrapping, parseTextCondition } from "./element-condition";

/** Per-element cache of the inline style values this code has written. */
export type StyleCache = Record<string, string | undefined>;

/**
 * Write an inline style property only when its value actually changes.
 * A value of null/undefined removes the property (falls back to CSS). The
 * cache is what keeps ProseMirror's mutation observer from reading our own
 * idempotent writes back as document edits.
 */
export function setStyleCached(
  cache: StyleCache,
  el: HTMLElement,
  prop: string,
  value: string | null | undefined,
): void {
  const v = value ?? undefined;
  if (cache[prop] === v) return;
  cache[prop] = v;
  if (v === undefined) el.style.removeProperty(prop);
  else el.style.setProperty(prop, v);
}

/** The CSS transform string for a node's rotation and flips (or undefined). */
export function transformStyleOf(attrs: Record<string, unknown>): string | undefined {
  const rotation = (attrs.rotation as number) || 0;
  const flipH = attrs.flipH as boolean;
  const flipV = attrs.flipV as boolean;
  const parts: string[] = [];
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  if (flipH && flipV) parts.push("scale(-1, -1)");
  else if (flipH) parts.push("scaleX(-1)");
  else if (flipV) parts.push("scaleY(-1)");
  return parts.length ? parts.join(" ") : undefined;
}

/** The same transform during a live rotation drag, with an explicit angle. */
export function transformWithRotation(deg: number, flipH: boolean, flipV: boolean): string {
  const parts: string[] = [`rotate(${deg}deg)`];
  if (flipH && flipV) parts.push("scale(-1, -1)");
  else if (flipH) parts.push("scaleX(-1)");
  else if (flipV) parts.push("scaleY(-1)");
  return parts.join(" ");
}

/**
 * Frame (cornice) and shadow are DECORATIVE and wrap the whole unit (photo +
 * caption): the photo keeps only its corner radius; the frame is drawn as an
 * `outline` on the wrapper and the shadow as a `box-shadow` on the wrapper.
 * Neither participates in layout, so the photo/caption are NEVER reduced and
 * there is NO gap between frame and content (offset 0).
 */
export function applyFrameAndShadow(
  wrapperCache: StyleCache,
  wrapper: HTMLElement,
  imgCache: StyleCache,
  img: HTMLElement,
  attrs: Record<string, unknown>,
): void {
  const css = computeImageCss(normalizeImageStyle(attrs));
  const radius = css.borderRadius ?? null;
  const frame = css.border ?? null; // e.g. "2px solid #333" -> used as outline
  const shadow = css.boxShadow ?? null;

  setStyleCached(wrapperCache, wrapper, "border-radius", radius);
  setStyleCached(wrapperCache, wrapper, "outline", frame);
  setStyleCached(wrapperCache, wrapper, "outline-offset", frame ? "0px" : null);
  setStyleCached(wrapperCache, wrapper, "box-shadow", shadow);

  // A border on the <img> would shrink it (border-box) and split the frame
  // away from the caption, so the photo only mirrors the corner radius.
  setStyleCached(imgCache, img, "border-radius", radius);
  setStyleCached(imgCache, img, "border", null);
  setStyleCached(imgCache, img, "box-shadow", null);
}

/** Mirror the element's text condition onto the visual `data-wrap` marker. */
export function applyWrapMarker(el: HTMLElement, attrs: Record<string, unknown>): void {
  if (isWrapping(parseTextCondition(attrs.wrap))) el.setAttribute("data-wrap", "");
  else el.removeAttribute("data-wrap");
}

/** Background, vertical padding and dark-background legibility of a caption. */
export function applyCaptionStripStyle(el: HTMLElement, attrs: Record<string, unknown>): void {
  const bg = String(attrs.captionBg ?? "");
  if (el.style.background !== bg) {
    el.style.background = bg;
  }
  const padTop = Number(attrs.captionPadTop);
  const padBottom = Number(attrs.captionPadBottom);
  const top = isFinite(padTop) ? Math.max(0, Math.min(60, padTop)) : 0;
  const bottom = isFinite(padBottom) ? Math.max(0, Math.min(60, padBottom)) : 0;
  const padding = `${top}px 8px ${bottom}px`;
  if (el.style.padding !== padding) {
    el.style.padding = padding;
  }
  el.classList.toggle("image-caption--dark-bg", !!bg && !isLightBgColor(bg));
}

/**
 * The keyboard guard shared by the content-bearing elements (figure, box):
 *  - a printable key over a surface-selected element ENTERS its content instead
 *    of replacing the whole element (the "typing deletes it" bug);
 *  - Backspace/Delete at the seams, or at the first/last position inside,
 *    removes the element ATOMICALLY (frame + content, one transaction).
 */
export function createAtomicElementGuardPlugin(nodeName: string): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          const sel = view.state.selection;

          if ((event.key === "Backspace" || event.key === "Delete") && sel.empty) {
            const goingBack = event.key === "Backspace";
            const $pos = view.state.doc.resolve(sel.from);
            let atomic: { pos: number; node: PMNode } | null = null;

            // Direct seam neighbour.
            const seamNeighbour = goingBack ? $pos.nodeBefore : $pos.nodeAfter;
            if (seamNeighbour && seamNeighbour.type.name === nodeName) {
              const pos = goingBack ? sel.from - seamNeighbour.nodeSize : sel.from;
              atomic = { pos, node: seamNeighbour };
            }

            // Caret at the boundary of an adjacent textblock: the element sits
            // on the OTHER side of that block (sibling), not inline before or
            // after the caret.
            if (!atomic) {
              const atBlockEdge = goingBack
                ? $pos.parentOffset === 0
                : $pos.parentOffset === $pos.parent.content.size;
              if (atBlockEdge && $pos.depth >= 1) {
                const blockStart = $pos.before($pos.depth);
                const blockEnd = $pos.after($pos.depth);
                const sibling = goingBack
                  ? view.state.doc.resolve(blockStart).nodeBefore
                  : view.state.doc.resolve(blockEnd).nodeAfter;
                if (sibling && sibling.type.name === nodeName) {
                  const pos = goingBack ? blockStart - sibling.nodeSize : blockEnd;
                  atomic = { pos, node: sibling };
                }
              }
            }

            // Caret inside the element at its first/last text position.
            if (!atomic) {
              for (let d = $pos.depth; d >= 1; d--) {
                const n = $pos.node(d);
                if (n.type.name !== nodeName) continue;
                const elemPos = $pos.before(d);
                const elemStart = elemPos + 1;
                const elemEnd = elemPos + n.nodeSize - 1;
                const atEdge = goingBack ? sel.from === elemStart : sel.from === elemEnd;
                if (atEdge) atomic = { pos: elemPos, node: n };
                break;
              }
            }

            if (atomic) {
              const size = atomic.node.nodeSize;
              let tr = view.state.tr.delete(atomic.pos, atomic.pos + size);
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

          // Printable keys over a surface-selected element: enter, don't replace.
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== nodeName) {
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

/** Select the top-level element at `pos`; the optional name guards the type. */
export function selectNodeAt(view: EditorView, pos: number, nodeName?: string): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || (nodeName && node.type.name !== nodeName)) return;
  try {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  } catch {
    /* node types that refuse node-selection keep the caret where it is */
  }
}
