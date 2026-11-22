// ============================================================================
// Text metrics — the fonts and vertical rhythms the editor is ACTUALLY using.
//
// Pagination must measure the CSS the editor really renders with, never a
// constant copied by hand:
//  - the container's computed style (family, size, line-height);
//  - the document itself: every paragraph carries its own `lineHeight` attr
//    (toolbar "Line Height") and inline `fontSize` marks;
//  - the cascade per node type (h1..h6, pre/code, caption strips), PROBED once
//    per sync from a hidden sample, so no CSS value is duplicated here.
//
// Before the first probe (non-browser use, benches) a static fallback matching
// the current styles.css applies.
//
// Extracted from the calculator (T1 reordering, 2026-09-10): the calculator
// answers "where do the pages break"; this module answers "how tall is a line
// and how wide is a word". Keeping them apart is what lets the three text
// conditions (Wrapped / Unwrapped / Overlap) be written once instead of three
// times inside the page walk.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";

export interface TextMetrics {
  font: string;
  sizePx: number;
  linePx: number;
}

export interface BlockSpacing {
  beforePx: number;
  afterPx: number;
}

export interface EditorMetrics {
  familyStack: string;
  /**
   * The font's NATURAL line height (line-height: normal, from the font's own
   * metrics), as a factor of the font size. Word's line spacing multiplies
   * THIS, not the bare font size like CSS unitless line-height does: "double"
   * in Word is ~2.3x the size for a face whose natural line is 1.15. The
   * editor's CSS reads it as --aw-natural (body) / --aw-natural-h (headings);
   * the measurement here must use the same number or the paper drifts.
   */
  naturalBody: number;
  naturalHeading: number;
  body: TextMetrics;
  caption: TextMetrics; // .image-caption / .aw-figure__caption base (12px)
  headings: TextMetrics[]; // index 0..5 = level 1..6
  code: TextMetrics;
  // vertical margins the renderer applies per top-level block type
  // (adjacent margins collapse, like the browser does)
  spacing: {
    paragraph: BlockSpacing;
    heading: BlockSpacing; // level 1 (probe fallback for heading spacing)
    headings: BlockSpacing[]; // index 0..5 = level 1..6 (F1.5: per-level)
    image: BlockSpacing;
    figure: BlockSpacing;
    code: BlockSpacing;
    other: BlockSpacing;
  };
}

function fallbackMetrics(): EditorMetrics {
  const size = 11 * 96 / 72; // 11pt at 96 DPI
  const natural = 1.15; // no DOM to probe: the common natural line (EdenText's default)
  const body: TextMetrics = { font: `${size.toFixed(2)}px Lora, Georgia, serif`, sizePx: size, linePx: size * 1.5 * natural };
  const headingSize = [2, 1.5, 1.17, 1, 0.83, 0.67].map((em) => size * em);
  const headingFactor = [1.2, 1.3, 1.4, 1.4, 1.4, 1.4];
  return {
    familyStack: "Lora, Georgia, serif",
    naturalBody: natural,
    naturalHeading: natural,
    body,
    caption: { font: `${12}px Lora, Georgia, serif`, sizePx: 12, linePx: 12 * 1.5 },
    headings: headingSize.map((s, i) => ({
      font: `${s.toFixed(2)}px Inter, system-ui, sans-serif`,
      sizePx: s,
      linePx: s * headingFactor[i],
    })),
    code: { font: `${12}px JetBrains Mono, monospace`, sizePx: 12, linePx: 12 * 1.5 },
    spacing: {
      paragraph: { beforePx: 0, afterPx: size }, // ~1em del corpo
      heading: { beforePx: 0, afterPx: size / 2 },
      headings: [1, 1.5, 1.17, 1, 0.83, 0.67].map(() => ({ beforePx: 0, afterPx: size / 2 })),
      image: { beforePx: 8, afterPx: 8 },
      figure: { beforePx: 8, afterPx: 8 },
      code: { beforePx: 0, afterPx: 0 },
      other: { beforePx: 0, afterPx: 0 },
    },
  };
}

let metrics: EditorMetrics = fallbackMetrics();

// F1.4: bumped ONLY when a DOM sync actually changes the probed styles, so the
// per-block layout cache survives ordinary typing.
let metricsGen = 1;

/** The metrics generation: changes only when a probe finds different styles. */
export function getMetricsGeneration(): number {
  return metricsGen;
}

function textMetricsEq(a: TextMetrics, b: TextMetrics): boolean {
  return a.font === b.font && a.sizePx === b.sizePx && a.linePx === b.linePx;
}

function blockSpacingEq(a: BlockSpacing, b: BlockSpacing): boolean {
  return a.beforePx === b.beforePx && a.afterPx === b.afterPx;
}

function editorMetricsEq(a: EditorMetrics, b: EditorMetrics): boolean {
  return a.familyStack === b.familyStack
    && a.naturalBody === b.naturalBody
    && a.naturalHeading === b.naturalHeading
    && textMetricsEq(a.body, b.body)
    && textMetricsEq(a.caption, b.caption)
    && textMetricsEq(a.code, b.code)
    && a.headings.length === b.headings.length
    && a.headings.every((h, i) => textMetricsEq(h, b.headings[i]))
    && blockSpacingEq(a.spacing.paragraph, b.spacing.paragraph)
    && blockSpacingEq(a.spacing.heading, b.spacing.heading)
    && a.spacing.headings.length === b.spacing.headings.length
    && a.spacing.headings.every((h, i) => blockSpacingEq(h, b.spacing.headings[i]))
    && blockSpacingEq(a.spacing.image, b.spacing.image)
    && blockSpacingEq(a.spacing.figure, b.spacing.figure)
    && blockSpacingEq(a.spacing.code, b.spacing.code)
    && blockSpacingEq(a.spacing.other, b.spacing.other);
}

export function lineHeightPxOf(spec: string, sizePx: number): number {
  const v = parseFloat(spec);
  if (!isFinite(v) || v <= 0) return sizePx * 1.2;
  return v < 6 ? v * sizePx : v; // a bare number is a factor, otherwise px
}

export function lineHeightFactor(raw: unknown, sizePx: number, fallbackFactor: number): number {
  const s = String(raw ?? "").trim();
  if (!s) return fallbackFactor;
  if (s.endsWith("px")) {
    const px = parseFloat(s);
    return isFinite(px) && px > 0 && sizePx > 0 ? px / sizePx : fallbackFactor;
  }
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : fallbackFactor;
}

/** Family portion of a base font string (e.g. 'Lora, Georgia, serif'). */
function baseFamilyOf(base: TextMetrics): string {
  const i = base.font.lastIndexOf("px ");
  return i >= 0 ? base.font.slice(i + 3) : metrics.familyStack;
}

// The natural line per family, probed once and cached until the next DOM sync
// (a font that loads later changes it: the sync clears the cache and re-probes,
// exactly as the cascade probe already does for sizes and margins).
const NATURAL_CACHE = new Map<string, number>();

/**
 * The family's natural line height as a factor of its size (CSS
 * `line-height: normal`, i.e. the font's own hhea/win metrics). This is what
 * Word calls "single": a spacing of 1.5 means 1.5 x THIS, not 1.5 x the size.
 */
export function naturalLineFactor(family: string): number {
  const fam = (family || "").trim();
  if (!fam) return 1.15;
  const hit = NATURAL_CACHE.get(fam);
  if (hit !== undefined) return hit;
  let n = 1.15;
  if (typeof document !== "undefined" && document.body) {
    try {
      const probe = document.createElement("div");
      probe.style.cssText =
        `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;font:1000px ${fam};line-height:normal;`;
      probe.textContent = "x";
      document.body.appendChild(probe);
      const h = probe.offsetHeight / 1000;
      document.body.removeChild(probe);
      if (isFinite(h) && h >= 0.8 && h <= 3) n = Math.round(h * 1000) / 1000;
    } catch { /* keep the fallback */ }
  }
  NATURAL_CACHE.set(fam, n);
  return n;
}

/**
 * The EFFECTIVE unitless line-height factor of a block: the CSS the browser
 * computes for it. No attr -> the probed base (which already carries the
 * natural line for paragraphs). Attr set -> the Word spacing: the chosen
 * multiple times the base family's natural line. A px value is a fixed line
 * (Word's "exactly"), expressed relative to the base size. ONE formula, used
 * by the uniform measure, the mixed line model and the page walk alike.
 */
export function resolvedLineFactor(node: PMNode, base: TextMetrics): number {
  const baseFactor = base.sizePx > 0 ? base.linePx / base.sizePx : 1.5;
  const raw = (node.attrs as Record<string, unknown> | undefined)?.lineHeight;
  const s = String(raw ?? "").trim();
  if (!s) return baseFactor;
  if (s.endsWith("px")) {
    const px = parseFloat(s);
    return isFinite(px) && px > 0 && base.sizePx > 0 ? px / base.sizePx : baseFactor;
  }
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0) return baseFactor;
  return n * naturalLineFactor(baseFamilyOf(base));
}

/** Italic prefix of a base font string (caption bases are italic). */
function baseStylePrefixOf(base: TextMetrics): string {
  const m = /^(italic |oblique )/.exec(base.font);
  return m ? m[0] : "";
}

/**
 * v2b: the CSS font a text child actually renders with, from its marks
 * (fontSize, fontFamily, em, strong, code) layered on the block's base.
 */
export function fontOfChild(child: PMNode, base: TextMetrics): { font: string; sizePx: number } {
  if (child.marks.length === 0) return { font: base.font, sizePx: base.sizePx };
  let sizePx = base.sizePx;
  let family = baseFamilyOf(base);
  let stylePrefix = baseStylePrefixOf(base);
  let weightPrefix = "";
  for (const m of child.marks) {
    switch (m.type.name) {
      case "fontSize": {
        const px = parseFloat(String(m.attrs.size));
        if (isFinite(px) && px > 0) sizePx = px;
        break;
      }
      case "fontFamily": {
        const fam = String(m.attrs.font || "").trim();
        if (fam) family = fam + ", " + baseFamilyOf(base);
        break;
      }
      case "em": stylePrefix = "italic "; weightPrefix = ""; break;
      case "strong": weightPrefix = "700 "; break;
      case "code": family = '"Courier New", Courier, monospace'; break;
      default: break;
    }
  }
  return { font: stylePrefix + weightPrefix + sizePx.toFixed(2) + "px " + family, sizePx };
}

export interface ParagraphStyle {
  mixed: boolean;
  /** Uniform style when !mixed; first-child style otherwise (fallback metrics). */
  style: TextMetrics;
}

/** v2b: does every text child render with the same font? */
export function paragraphStyle(node: PMNode, base: TextMetrics): ParagraphStyle {
  let only: { font: string; sizePx: number } | null = null;
  let mixed = false;
  node.forEach((c) => {
    if (!c.isText || !(c.text || "").length) return;
    const f = fontOfChild(c, base);
    if (!only) only = f;
    else if (only.font !== f.font) mixed = true;
  });
  const first = only as { font: string; sizePx: number } | null;
  const sizePx = first ? first.sizePx : base.sizePx;
  // The unitless factor inherits: a run at another size scales it by its own
  // size, exactly as the browser does with the block's computed line-height.
  const factor = resolvedLineFactor(node, base);
  const style: TextMetrics = {
    font: first ? first.font : base.font,
    sizePx,
    linePx: sizePx * factor,
  };
  return { mixed, style };
}

/** v2a-compatible single-style resolution (kept for call sites that need one). */
export function textStyleFor(node: PMNode, base: TextMetrics): TextMetrics {
  return paragraphStyle(node, base).style;
}

/** The metrics the last probe settled on (fallback before the first probe). */
export function getEditorMetrics(): EditorMetrics {
  return metrics;
}

/**
 * Refresh metrics by probing the real cascade. Attach a hidden sample to the
 * editor's own parent so descendant selectors (`.ProseMirror h1`,
 * `.aw-figure__caption`...) match exactly as in the live editor.
 */
export function syncEditorMetricsFromDom(el: Element | null | undefined): void {
  if (!el || typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const cs = window.getComputedStyle(el);
    const bodySizePx = parseFloat(cs.fontSize);
    if (!isFinite(bodySizePx) || bodySizePx <= 0) return;
    // A sync is the moment fonts may have changed: re-probe the natural lines.
    NATURAL_CACHE.clear();
    const naturalBody = naturalLineFactor(cs.fontFamily || metrics.familyStack);
    const host = document.createElement("div");
    host.className = "ProseMirror";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;width:auto;padding:0;margin:0;";
    // The probe host is a SIBLING of the editor: it does not inherit the
    // editor's inline --aw-natural. Give it the same value, or the probe reads
    // the CSS fallback while the live paragraphs use the probed one.
    host.style.setProperty("--aw-natural", String(naturalBody));
    host.innerHTML =
      "<p>x</p>" +
      "<h1>x</h1><h2>x</h2><h3>x</h3><h4>x</h4><h5>x</h5><h6>x</h6>" +
      "<pre><code>x</code></pre>" +
      "<div class=\"image-caption\">x</div>" +
      "<div class=\"image-node-wrapper\"><img src=\"x\"></div>" +
      "<figure class=\"aw-figure\"><img src=\"x\"><figcaption class=\"aw-figure__caption\"><p>x</p></figcaption></figure>";
    const parent = el.parentElement ?? document.body;
    parent.appendChild(host);
    const read = (q: string, sizePx: number): TextMetrics => {
      const found = host.querySelector(q) as Element | null;
      if (!found) return { font: `${sizePx.toFixed(2)}px ${metrics.familyStack}`, sizePx, linePx: sizePx * 1.5 };
      const s = window.getComputedStyle(found);
      const sz = parseFloat(s.fontSize) || sizePx;
      const lh = s.lineHeight && s.lineHeight !== "normal" ? lineHeightPxOf(s.lineHeight, sz) : sz * 1.5;
      const style = s.fontStyle === "italic" || s.fontStyle === "oblique" ? `${s.fontStyle} ` : "";
      return { font: `${style}${sz.toFixed(2)}px ${s.fontFamily}`, sizePx: sz, linePx: lh };
    };
    const readSpacing = (q: string): BlockSpacing => {
      const found = host.querySelector(q) as Element | null;
      if (!found) return { beforePx: 0, afterPx: 0 };
      const s = window.getComputedStyle(found);
      const before = parseFloat(s.marginTop);
      const after = parseFloat(s.marginBottom);
      return {
        beforePx: isFinite(before) && before > 0 ? before : 0,
        afterPx: isFinite(after) && after > 0 ? after : 0,
      };
    };
    // The BODY base is the paragraph's own cascade (p carries the spacing
    // formula), not the container's line-height: the container feeds stray
    // text, the paragraphs are what the pages are made of.
    const pBase = read("p", bodySizePx);
    const headings = (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((tag, i) =>
      read(tag, metrics.headings[i]?.sizePx ?? bodySizePx),
    );
    const h1El = host.querySelector("h1");
    const headingFamily = h1El ? window.getComputedStyle(h1El).fontFamily : cs.fontFamily;
    const naturalHeading = naturalLineFactor(headingFamily || metrics.familyStack);
    const next: EditorMetrics = {
      familyStack: cs.fontFamily || metrics.familyStack,
      naturalBody,
      naturalHeading,
      body: { font: `${bodySizePx.toFixed(2)}px ${cs.fontFamily}`, sizePx: bodySizePx, linePx: pBase.linePx },
      caption: read(".image-caption", 12),
      headings,
      code: read("pre code", 12),
      spacing: {
        paragraph: readSpacing("p"),
        // F1.5: heading margins are per-level (the renderer uses 0.5em of the
        // heading's own font-size), so one shared heading spacing drifts on
        // every level >= 2. Read the real cascade per level.
        heading: readSpacing("h1"),
        headings: (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((tag) => readSpacing(tag)),
        image: readSpacing(".image-node-wrapper"),
        figure: readSpacing(".aw-figure"),
        code: readSpacing("pre"),
        other: { beforePx: 0, afterPx: 0 },
      },
    };
    parent.removeChild(host);
    // The live CSS reads these: the paragraphs' calc() multiplies the chosen
    // spacing by the family's natural line. Written only when changed, so an
    // unchanged sync touches no style.
    const live = el as HTMLElement;
    if (live.style?.getPropertyValue("--aw-natural") !== String(naturalBody)) {
      live.style.setProperty("--aw-natural", String(naturalBody));
    }
    if (live.style?.getPropertyValue("--aw-natural-h") !== String(naturalHeading)) {
      live.style.setProperty("--aw-natural-h", String(naturalHeading));
    }
    if (!editorMetricsEq(metrics, next)) {
      metrics = next;
      metricsGen++;
    }
  } catch {
    // keep the last known metrics
  }
}

/** The cascade metrics a node type starts from (before its own attrs/marks). */
export function baseMetricsFor(node: PMNode): TextMetrics {
  if (node.type.name === "code_block") return metrics.code;
  if (node.type.name === "heading") {
    const level = Number(node.attrs.level);
    return metrics.headings[Number.isFinite(level) ? Math.min(6, Math.max(1, level)) - 1 : 0];
  }
  return metrics.body;
}
