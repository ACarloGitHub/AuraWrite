import { DOMSerializer } from "prosemirror-model";
import { invoke } from "@tauri-apps/api/core";

interface ToHtmlOptions {
  /** Inline images as base64 data URIs (self-contained file). Default true.
   *  Set false for channels that pack images themselves (EPUB), which then
   *  rewrite the relative srcs. */
  embedImages?: boolean;
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
  if (!schema) return wrapInHTMLDocument("");
  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(doc.content);

  const container = document.createElement("div");
  container.appendChild(fragment);

  if (embedImages) {
    for (const img of container.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src && dataUriBySrc.has(src)) {
        img.setAttribute("src", dataUriBySrc.get(src)!);
      }
    }
  }

  return wrapInHTMLDocument(container.innerHTML);
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

function wrapInHTMLDocument(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
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
    }
    p { margin-bottom: 1em; }
    h1, h2, h3 { margin-top: 1.5em; }
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
