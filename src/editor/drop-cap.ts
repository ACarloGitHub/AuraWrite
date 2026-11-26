/**
 * E7 — the drop cap: the first letter of a paragraph, N lines tall, with the
 * text flowing around it ([[concepts/editor-enrichment-drop-cap]]).
 *
 * The contract (catalogo, §2): «Prima lettera grande su N righe, aggirata dal
 * testo». Word's own dialog asks three things — where (in text or in margin),
 * how many lines, how far from the text — and computes the size itself: the
 * letter is exactly N lines of THAT paragraph, so its size is never a stored
 * number.
 *
 * Two rules here, and they are the whole design:
 *  - the letter is NOT a node and NOT a style: it is a property of the paragraph
 *    (`dropCapLines` + `dropCapGap`), and on screen it is a decoration on the
 *    first visible character. Nothing is inserted into the text, so the writer
 *    keeps typing the same paragraph;
 *  - the letter takes the paragraph's own formatting (font, bold, colour): if
 *    the first letter was bold, the big letter is bold. The size alone is
 *    computed, and it comes from the line height, not from the font size.
 *
 * The page calculator must know the letter BEFORE it measures (law D13): a
 * float that changes the first lines' width and is applied afterwards would
 * give the screen and the paper two different paginations. The band it
 * reserves lives in `pagination-cassie.ts` (`dropCapBandOf`).
 */
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { TextMetrics } from "./text-metrics";

export const CM_TO_PX_DC = 96 / 2.54;

/** Word offers 1 (off) and 2…10; the campaign's first giro stops at 6. */
export const DROP_CAP_MIN_LINES = 2;
export const DROP_CAP_MAX_LINES = 6;
/** The gap Word puts between the letter and the text when none is chosen. */
export const DEFAULT_DROP_CAP_GAP_CM = 0.2;

export interface DropCapSpec {
  /** How many lines the letter is tall. */
  lines: number;
  /** The distance from the letter to the text, in px. */
  gapPx: number;
}

/** The paragraph's drop cap, or null. Values are clamped to what Word accepts. */
export function dropCapOf(node: PMNode): DropCapSpec | null {
  const raw = Number(node.attrs?.dropCapLines);
  if (!Number.isFinite(raw) || raw < DROP_CAP_MIN_LINES) return null;
  const lines = Math.min(DROP_CAP_MAX_LINES, Math.round(raw));
  const gapCm = Number(node.attrs?.dropCapGap);
  const gap = Number.isFinite(gapCm) && gapCm >= 0 ? gapCm : DEFAULT_DROP_CAP_GAP_CM;
  return { lines, gapPx: gap * CM_TO_PX_DC };
}

/**
 * The index of the first character a reader sees: Word takes the first visible
 * one, so a paragraph opening with a space or a quote drops that character.
 */
export function firstVisibleIndex(text: string): number {
  const m = /\S/.exec(text);
  return m ? m.index : -1;
}

/**
 * The band the letter reserves, in the same numbers the walk uses: the width is
 * the glyph measured at the size the letter is drawn with (N lines of the
 * paragraph) plus the gap; the height is exactly N lines.
 */
export function dropCapBandOf(
  node: PMNode,
  base: TextMetrics,
  lineFactor: number,
  measure: (text: string, font: string) => number,
): { widthPx: number; heightPx: number; gapPx: number; index: number; sizePx: number } | null {
  const cap = dropCapOf(node);
  if (!cap) return null;
  const text = node.textContent;
  const index = firstVisibleIndex(text);
  if (index < 0) return null;
  const char = text[index];
  const linePx = base.sizePx * lineFactor;
  const sizePx = cap.lines * linePx;
  // The letter wears the paragraph's own face; only its size is computed.
  const font = sizeFont(base.font, sizePx);
  return {
    widthPx: measure(char, font) + cap.gapPx,
    heightPx: cap.lines * linePx,
    gapPx: cap.gapPx,
    index,
    sizePx,
  };
}

/** `"bold 14.67px Lora"` → the same face at another size. */
export function sizeFont(font: string, sizePx: number): string {
  return font.replace(/-?\d+(?:\.\d+)?px/, sizePx.toFixed(2) + "px");
}

// ---------------------------------------------------------------------------
// The screen: a decoration on the first character, wearing the same numbers the
// walk reserved. The plugin lives in `pagination-cassie.ts`, because only the
// page's own arithmetic knows the font and the line of a block.
// ---------------------------------------------------------------------------

export interface DropCapBand {
  widthPx: number;
  heightPx: number;
  gapPx: number;
  sizePx: number;
}

export interface CapRange {
  from: number;
  to: number;
  band: DropCapBand;
}

/** Every drop cap in the document, with the range of its letter. */
export function dropCapRanges(
  doc: PMNode,
  bandFor: (node: PMNode) => DropCapBand | null,
): CapRange[] {
  const out: CapRange[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    const band = bandFor(node);
    if (!band) return true;
    const index = firstVisibleIndex(node.textContent);
    if (index < 0) return true;
    let offset = 0;
    node.forEach((child) => {
      if (child.isText) {
        const text = child.text ?? "";
        if (index >= offset && index < offset + text.length) {
          const from = pos + 1 + index;
          out.push({ from, to: from + 1, band });
        }
        offset += text.length;
      } else if (child.isLeaf) {
        offset += 1;
      }
    });
    return true;
  });
  return out;
}

/** The Paragraph panel's two fields, applied to every block in the selection. */
export function setDropCap(view: EditorView, lines: number | null, gapCm: number | null): void {
  const { state } = view;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    const nextLines =
      lines === null
        ? null
        : Math.min(DROP_CAP_MAX_LINES, Math.max(DROP_CAP_MIN_LINES, Math.round(lines)));
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, dropCapLines: nextLines, dropCapGap: gapCm });
    changed = true;
    return false;
  });
  if (changed) view.dispatch(tr.scrollIntoView());
}

/** The drop cap the caret is in, for the panel to show it. */
export function dropCapAtSelection(view: EditorView): { lines: number | null; gapCm: number | null } {
  const $from = view.state.selection.$from;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      const raw = Number(node.attrs?.dropCapLines);
      const gap = Number(node.attrs?.dropCapGap);
      return {
        lines: Number.isFinite(raw) && raw >= DROP_CAP_MIN_LINES ? Math.round(raw) : null,
        gapCm: Number.isFinite(gap) && gap >= 0 ? gap : null,
      };
    }
  }
  return { lines: null, gapCm: null };
}

// ---------------------------------------------------------------------------
// The Paragraph panel's two fields (the same place Word keeps them).
// ---------------------------------------------------------------------------

/** Wire the panel's controls once, at startup. */
export function setupDropCapPanel(view: EditorView): void {
  const select = document.getElementById("sel-drop-cap") as HTMLSelectElement | null;
  const gap = document.getElementById("inp-drop-cap-gap") as HTMLInputElement | null;
  if (!select) return;
  const apply = (): void => {
    const lines = select.value ? Number(select.value) : null;
    if (lines === null) {
      setDropCap(view, null, null);
    } else {
      const cm = gap && gap.value !== "" ? Number(gap.value) : null;
      setDropCap(view, lines, Number.isFinite(cm as number) ? (cm as number) : null);
    }
    view.focus();
  };
  select.addEventListener("change", apply);
  gap?.addEventListener("change", apply);
}

/** The panel follows the caret: the block's own numbers, or "None". */
export function syncDropCapInputs(view: EditorView): void {
  const select = document.getElementById("sel-drop-cap") as HTMLSelectElement | null;
  const gap = document.getElementById("inp-drop-cap-gap") as HTMLInputElement | null;
  if (!select) return;
  const current = dropCapAtSelection(view);
  const value = current.lines === null ? "" : String(current.lines);
  if (select.value !== value) select.value = value;
  if (gap) {
    const text = current.gapCm === null ? "" : String(current.gapCm);
    if (document.activeElement !== gap && gap.value !== text) gap.value = text;
  }
}

// ---------------------------------------------------------------------------
// E7 — the letter as markup. The screen draws it with a decoration, which no
// serialization carries: the HTML export and the print sheet are rebuilt from
// the DOM, so the letter is written there by hand, with the same numbers.
// ---------------------------------------------------------------------------

/** E7: `<span class="aw-dropcap">` around the first visible letter of a paragraph. */
export function wrapDropCaps(container: HTMLElement, opts: { skipFirst?: boolean } = {}): void {
  let skipped = !opts.skipFirst;
  for (const block of Array.from(container.querySelectorAll<HTMLElement>("[data-drop-cap-lines]"))) {
    // A sheet that CONTINUES a paragraph starts in the middle of it: its first
    // block is not the paragraph's beginning, so the letter is not there.
    if (!skipped) {
      skipped = true;
      continue;
    }
    const lines = Number(block.getAttribute("data-drop-cap-lines"));
    if (!Number.isFinite(lines) || lines < 2) continue;
    const gapCm = Number(block.getAttribute("data-drop-cap-gap"));
    const gap = Number.isFinite(gapCm) && gapCm >= 0 ? gapCm : 0.2;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const index = text.search(/\S/);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const span = document.createElement("span");
      span.className = "aw-dropcap";
      span.setAttribute(
        "style",
        // 1.5 = the default rhythm of the sheet: N line boxes become the size.
        `float: left; font-size: ${(lines * 1.5).toFixed(2)}em; line-height: 1; margin-right: ${gap.toFixed(2)}cm;`,
      );
      range.surroundContents(span);
      break;
    }
  }
}

