import { DOMSerializer } from "prosemirror-model";
import { wrapDropCaps } from "../editor/drop-cap";
import { invoke } from "@tauri-apps/api/core";
import { getEditorMetrics } from "../editor/text-metrics";
import { applyTabAdvances } from "../editor/paragraph-tabs";
import { getContentWidth, tabAdvancesFor } from "../editor/pagination-cassie";
import { getMargins } from "../editor/pagination-state";

interface ToHtmlOptions {
  /** Inline images as base64 data URIs (self-contained file). Default true.
   *  Set false for channels that pack images themselves (EPUB), which then
   *  rewrite the relative srcs. */
  embedImages?: boolean;
  /** The document's language, written on `<html lang>` so the file says it. */
  language?: string;
}

/**
 * Export a ProseMirror doc to a self-contained HTML string.
 *
 * Uses DOMSerializer so every node is rendered by its OWN toDOM (the D10
 * dialect): figures become `<figure data-aw-figure><img><figcaption>`, boxes
 * become `<div data-aw-box>`, and all text marks are emitted. This fixes the
 * old hand-written serializer that silently dropped images and figures.
 *
 * Images are inlined as base64 data URIs by default (portable file); pass
 * `embedImages: false` if the caller packs images itself (EPUB).
 */
export async function toHTML(doc: any, opts: ToHtmlOptions = {}): Promise<string> {
  const embedImages = opts.embedImages !== false;

  const sources = new Set<string>();
  collectImageSrcs(doc, sources);

  const dataUriBySrc = new Map<string, string>();
  if (embedImages) {
    for (const src of sources) {
      const dataUri = await imageToDataUri(src);
      if (dataUri) dataUriBySrc.set(src, dataUri);
    }
  }

  const schema = doc?.type?.schema;
  if (!schema) return wrapInHTMLDocument("", opts.language);
  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(doc.content);

  const container = document.createElement("div");
  container.appendChild(fragment);

  // E3: a tabulation's advance does not exist in markup — the same numbers the
  // editor draws are written on a span that KEEPS the character inside, so the
  // file renders like the page and a reimport still reads a tabulation (D10).
  {
    const width = getContentWidth(getMargins());
    let index = 0;
    doc.forEach((node: any) => {
      const el = container.children[index++] as HTMLElement | undefined;
      if (el && (node.textContent ?? "").includes("\t")) {
        applyTabAdvances(el, tabAdvancesFor(node, width));
      }
    });
  }

  // E7: a drop cap is a property of the paragraph in the document (a
  // decoration, not a node), and markup has no decorations: the letter is
  // written as a span here, so the file shows the same big letter. The size is
  // N line boxes of the default rhythm (the exact one lives in the app).
  wrapDropCaps(container);

  if (embedImages) {
    for (const img of container.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src && dataUriBySrc.has(src)) {
        img.setAttribute("src", dataUriBySrc.get(src)!);
      }
    }
  }

  return wrapInHTMLDocument(container.innerHTML, opts.language);
}

/** Recursively collect the src of every image (node OR figure attr) in the doc. */
function collectImageSrcs(node: any, out: Set<string>): void {
  if (!node) return;
  const t = node.type?.name;
  if ((t === "image" || t === "figure") && node.attrs?.src) {
    out.add(node.attrs.src);
  }
  const content = node.content;
  if (content && typeof content.forEach === "function") {
    content.forEach((child: any) => collectImageSrcs(child, out));
  } else if (Array.isArray(content)) {
    content.forEach((child: any) => collectImageSrcs(child, out));
  }
}

/** Read an image and return a base64 data URI. Keeps `data:` as-is. */
export async function imageToDataUri(src: string): Promise<string | null> {
  try {
    if (src.startsWith("data:")) return src;
    let base64: string | null = null;
    let mime = "image/png";
    if (src.startsWith("images/")) {
      base64 = await invoke<string>("read_image_asset_base64", { relativePath: src });
      mime = mimeFromName(src);
    } else if (src.startsWith("http://asset.localhost/")) {
      const path = decodeURIComponent(src.substring("http://asset.localhost/".length));
      base64 = await invoke<string>("load_binary_file", { path });
      mime = mimeFromName(src);
    } else if (src.startsWith("asset://localhost/")) {
      const path = decodeURIComponent(src.substring("asset://localhost/".length));
      base64 = await invoke<string>("load_binary_file", { path });
      mime = mimeFromName(src);
    } else if (/^(https?:|blob:)/.test(src)) {
      const res = await fetch(src);
      const blob = await res.blob();
      base64 = await blobToBase64(blob);
      mime = blob.type || "image/png";
    }
    if (!base64) return null;
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    console.warn("[html export] failed to embed image:", src, e);
    return null;
  }
}

/** Inline every <img> inside a rendered container as a base64 data URI. */
export async function embedImagesInDom(container: HTMLElement): Promise<void> {
  const srcs = new Set<string>();
  container.querySelectorAll("img").forEach((i) => {
    const s = i.getAttribute("src");
    if (s) srcs.add(s);
  });
  const map = new Map<string, string>();
  for (const s of srcs) {
    const u = await imageToDataUri(s);
    if (u) map.set(s, u);
  }
  container.querySelectorAll("img").forEach((i) => {
    const s = i.getAttribute("src");
    if (s && map.has(s)) i.setAttribute("src", map.get(s)!);
  });
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpeg") || lower.includes(".jpg")) return "image/jpeg";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".bmp")) return "image/bmp";
  if (lower.includes(".svg")) return "image/svg+xml";
  return "image/png";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.substring(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function wrapInHTMLDocument(bodyContent: string, language?: string): string {
  const lang = (language || "en").replace(/"/g, "");
  // The same natural lines the editor renders with: the exported spacing
  // (--aw-lh on each paragraph) multiplies these, so the file opens with the
  // rhythm it was written with, not the browser's bare guess.
  const met = getEditorMetrics();
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuraWrite Document</title>
  <style>
    body {
      font-family: Lora, Georgia, 'Times New Roman', serif;
      max-width: 720px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.7;
      --aw-natural: ${met.naturalBody};
      --aw-natural-h: ${met.naturalHeading};
    }
    p {
      margin-bottom: 1em;
      /* Same formula as the editor: a chosen spacing is a Word multiple of the
         natural line; no choice keeps the document's own 1.5 rhythm. */
      line-height: calc(var(--aw-lh, calc(1.5 / var(--aw-natural, 1.15))) * var(--aw-natural, 1.15));
    }
    h1[data-line-height], h2[data-line-height], h3[data-line-height],
    h4[data-line-height], h5[data-line-height], h6[data-line-height] {
      line-height: calc(var(--aw-lh) * var(--aw-natural-h, 1.15));
    }
    h1, h2, h3 { margin-top: 1.5em; }
    /* E1: a chosen before/after travels inline (--aw-sb/--aw-sa); the marked
       block beats the export's own rhythm, an unmarked one keeps it. */
    [data-space-before] { margin-top: var(--aw-sb); }
    [data-space-after] { margin-bottom: var(--aw-sa); }
    /* E2: the chosen indents travel inline; marked blocks beat the rhythm. */
    [data-indent-left] { margin-left: var(--aw-il); }
    [data-indent-right] { margin-right: var(--aw-ir); }
    [data-indent-first] { text-indent: var(--aw-if); }
    p[data-align="center"], [data-align="center"] { text-align: center; }
    p[data-align="right"], [data-align="right"] { text-align: right; }
    blockquote {
      border-left: 3px solid #ccc;
      margin-left: 0;
      padding-left: 1em;
      color: #666;
    }
    pre {
      background: #f5f5f5;
      padding: 1em;
      overflow-x: auto;
    }
    code {
      font-family: monospace;
      background: #f5f5f5;
    }
    img { max-width: 100%; height: auto; }
    /* E3: a tabulation is laid out by the spans the export writes (the advance
       the page calculator computed); the character inside holds no width. */
    .aw-tab {
      display: inline-block;
      overflow: hidden;
      white-space: pre;
      tab-size: 0;
      vertical-align: baseline;
      background-repeat: repeat-x;
      background-position: 0 0.78em;
    }
    .aw-tab--leader[data-leader='.'] {
      background-image: radial-gradient(circle, currentColor 1px, transparent 1.1px);
      background-size: 0.42em 100%;
    }
    .aw-tab--leader[data-leader='\u00b7'] {
      background-image: radial-gradient(circle, currentColor 1.4px, transparent 1.5px);
      background-size: 0.6em 100%;
    }
    .aw-tab--leader[data-leader='-'] {
      background-image: repeating-linear-gradient(90deg, currentColor 0 0.2em, transparent 0.2em 0.38em);
      background-size: 100% 1px;
      background-repeat: repeat-x;
    }
    .aw-tab--leader[data-leader='_'] {
      background-image: linear-gradient(currentColor, currentColor);
      background-size: 100% 1px;
      background-repeat: no-repeat;
      background-position: 0 calc(100% - 0.12em);
    }
    figure[data-aw-figure] {
      width: fit-content;
      max-width: 100%;
      margin: 1em auto;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    figure[data-aw-figure][data-align="left"] { margin-left: 0; margin-right: auto; }
    figure[data-aw-figure][data-align="right"] { margin-left: auto; margin-right: 0; }
    figure[data-aw-figure] img { display: block; }
    figcaption { font-size: 12px; font-style: italic; color: #666; }
    /* E5: a field shows its cached text and nothing else; the page there is a
       string, so the markup keeps the spacing it was measured with. */
    span[data-aw-field] { white-space: pre; }
    /* E7: the drop cap of the file: the letter leaves the flow and the first
       lines wrap around it. The size is written inline on the letter. */
    .aw-dropcap { float: left; line-height: 1; }
    [data-drop-cap-lines] { display: block; }
    /* E6: the table's own look travels as its name (data-table-style), and these
       two rules are what the name means on the screen (05-document.css). */
    table { border-collapse: collapse; }
    table td, table th { border: 1px solid #999; padding: 0.2em 0.4em; }
    table[data-table-style='plain'] td, table[data-table-style='plain'] th {
      border-color: transparent;
    }
    table[data-table-style='banded'] tbody > tr:nth-child(even) > td {
      background: rgba(74, 144, 217, 0.06);
    }
    /* Drawn shapes: the size, the alignment and the air travel inline in the
       markup (the file stands on its own); these two rules only make the box
       behave like the block it is in the editor. */
    .aw-shape { display: block; box-sizing: border-box; max-width: 100%; }
    .aw-shape svg { display: block; }
    .page-break-before {
      page-break-before: always;
      break-before: page;
    }
    @media print {
      .page-break-before {
        page-break-before: always;
        break-before: page;
      }
    }
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
