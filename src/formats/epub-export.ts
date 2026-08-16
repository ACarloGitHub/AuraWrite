// Ebook export from a project (F4).
//
// Any project can be exported to EPUB regardless of its template. The export is
// driven by a per-project configuration (which elements are included, their
// role/label, their order, and book metadata) that is persisted separately in
// the database — it never modifies the project itself.
//
// This file defines the configuration types and the Tauri command wrappers.
// The compilation engine is added separately.

import { invoke } from "@tauri-apps/api/core";
import JSZip from "jszip";
import { Node } from "prosemirror-model";
import { schema } from "../editor/editor";
import { toHTML } from "./html";
import { getProject, getSections, getDocuments } from "../database/db";
import type { Document } from "../types/database";

/** Role of an element in the exported book (Scrivener-inspired labels). */
export type EbookRole =
  | "front-matter"
  | "part"
  | "chapter"
  | "scene"
  | "back-matter"
  | "transparent"
  | "excluded";

/** Per-project ebook export configuration (persisted, does NOT touch the project). */
export interface EbookExportConfig {
  /** True once the config has been saved by the user (distinguishes "never
   * configured" from "everything deselected"). */
  saved: boolean;
  /** Ids (sections + documents) included in the book. */
  included: string[];
  /** Manual role overrides by element id (only for non-default labels). */
  labels: Record<string, EbookRole>;
  /** Ids in export order (from the dialog drag & drop). */
  order: string[];
  /** Book metadata. */
  metadata: {
    title: string;
    author: string;
    language: string;
    /** Absolute path of the cover image, if any. */
    coverPath?: string;
  };
  /** Config format version (for future migrations). */
  version: number;
}

export function defaultExportConfig(): EbookExportConfig {
  return {
    saved: false,
    included: [],
    labels: {},
    order: [],
    metadata: { title: "", author: "", language: "en" },
    version: 1,
  };
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

export async function getExportConfig(projectId: string): Promise<EbookExportConfig | null> {
  const raw = await invoke<string | null>("export_config_get", { projectId });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EbookExportConfig;
  } catch {
    return null;
  }
}

export async function setExportConfig(projectId: string, config: EbookExportConfig): Promise<void> {
  await invoke("export_config_set", { projectId, config: JSON.stringify(config) });
}

export async function deleteExportConfig(projectId: string): Promise<void> {
  await invoke("export_config_delete", { projectId });
}

// ---------------------------------------------------------------------------
// Compilation engine (F4 step 3): project -> EPUB
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string
  );
}

function docBodyHtml(contentJson: string): string {
  try {
    const json = JSON.parse(contentJson || "{}");
    const doc = Node.fromJSON(schema, json);
    const full = toHTML(doc);
    const match = full.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return match ? match[1] : full;
  } catch (e) {
    console.warn("[epub-export] failed to convert document:", e);
    return "";
  }
}

async function resolveImageBytes(
  src: string
): Promise<{ bytes: Uint8Array; ext: string } | null> {
  try {
    let path: string | null = null;
    let base64: string | null = null;
    if (src.startsWith("images/")) {
      base64 = await invoke<string>("read_image_asset_base64", { relativePath: src });
    } else if (src.startsWith("asset://localhost/")) {
      path = decodeURIComponent(src.substring("asset://localhost/".length));
    } else if (src.startsWith("http://asset.localhost/")) {
      path = decodeURIComponent(src.substring("http://asset.localhost/".length));
    } else {
      return null;
    }
    if (!base64 && path) {
      base64 = await invoke<string>("load_binary_file", { path });
    }
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const lower = src.toLowerCase();
    const ext = /\.(\w{2,5})(\?|$)/.exec(lower)?.[1] || "png";
    return { bytes, ext };
  } catch (e) {
    console.warn("[epub-export] failed to resolve image:", src, e);
    return null;
  }
}

async function rewriteImages(html: string, zip: JSZip, imagesDir: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(parsed.querySelectorAll("img"));
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const src = img.getAttribute("src");
    if (!src) continue;
    const resolved = await resolveImageBytes(src);
    if (!resolved) continue;
    const name = `img-${i}-${Date.now()}.${resolved.ext}`;
    zip.file(`${imagesDir}/${name}`, resolved.bytes);
    img.setAttribute("src", `images/${name}`);
  }
  return parsed.body ? parsed.body.innerHTML : html;
}

interface ExportElement {
  id: string;
  type: "section" | "document";
  title: string;
  role: EbookRole;
  contentJson?: string;
}

export async function exportProjectToEpub(
  projectId: string,
  config: EbookExportConfig,
  destPath: string
): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const sections = await getSections(projectId);
  const docs: Document[] = [];
  for (const s of sections) {
    const list = await getDocuments(s.id);
    for (const d of list) docs.push(d);
  }

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const docById = new Map(docs.map((d) => [d.id, d]));

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let cur = sectionById.get(id)?.parent_id ?? null;
    while (cur) {
      out.push(cur);
      cur = sectionById.get(cur)?.parent_id ?? null;
    }
    return out;
  };

  // A document is included only if it and all its ancestor sections are included
  // (unchecking a section excludes its descendants).
  const isIncluded = (id: string): boolean => {
    if (!config.included.includes(id)) return false;
    for (const anc of ancestorsOf(id)) {
      if (!config.included.includes(anc)) return false;
    }
    return true;
  };

  // Ordered list of elements to export (respecting config.order).
  const elements: ExportElement[] = [];
  const seen = new Set<string>();
  for (const id of config.order) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (docById.has(id)) {
      const doc = docById.get(id)!;
      if (!isIncluded(doc.id)) continue;
      const role = config.labels[doc.id] || "chapter";
      if (role === "excluded") continue;
      elements.push({
        id: doc.id,
        type: "document",
        title: doc.title || "Untitled",
        role,
        contentJson: doc.content_json,
      });
    } else if (sectionById.has(id)) {
      const section = sectionById.get(id)!;
      const role = config.labels[section.id] || "transparent";
      if (!isIncluded(section.id) || role === "excluded") continue;
      if (role === "transparent" || role === "part") {
        elements.push({ id: section.id, type: "section", title: section.name, role });
      }
    }
  }

  const zip = new JSZip();
  const OEBPS = "OEBPS";
  const imagesDir = `${OEBPS}/images`;

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const title = config.metadata.title || project.name || "Book";
  const author = config.metadata.author || "";
  const language = config.metadata.language || "en";

  let coverManifest = "";
  if (config.metadata.coverPath) {
    try {
      const coverBase64 = await invoke<string>("load_binary_file", { path: config.metadata.coverPath });
      const binary = atob(coverBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ext = /\.(\w{2,5})$/.exec(config.metadata.coverPath.toLowerCase())?.[1] || "png";
      zip.file(`${imagesDir}/cover.${ext}`, bytes);
      zip.file(
        `${OEBPS}/cover.xhtml`,
        `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Cover</title></head>
<body><img src="images/cover.${ext}" alt="Cover"/></body>
</html>`
      );
      coverManifest = `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="cover-image"/>`;
    } catch (e) {
      console.warn("[epub-export] cover failed:", e);
    }
  }

  let chapIndex = 0;
  let spine = coverManifest ? '<itemref idref="cover"/>' : "";
  const manifest: string[] = [];
  const tocItems: { label: string; href: string; level: number }[] = [];
  let partDepth = 0;

  for (const el of elements) {
    if (el.type === "section") {
      if (el.role === "part") {
        partDepth = 1;
        tocItems.push({ label: el.title, href: `#part-${chapIndex}`, level: 1 });
      }
      continue;
    }

    const contentHtml = docBodyHtml(el.contentJson || "");
    const finalHtml = await rewriteImages(contentHtml, zip, imagesDir);
    chapIndex++;
    const fileName = `chap${chapIndex}.xhtml`;
    zip.file(
      `${OEBPS}/${fileName}`,
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(el.title)}</title></head>
<body>
<h1 id="part-${chapIndex}">${escapeXml(el.title)}</h1>
${finalHtml}
</body>
</html>`
    );
    manifest.push(`<item id="c${chapIndex}" href="${fileName}" media-type="application/xhtml+xml"/>`);
    spine += `<itemref idref="c${chapIndex}"/>`;
    tocItems.push({
      label: el.title,
      href: `${fileName}#part-${chapIndex}`,
      level: partDepth,
    });
    partDepth = 0;
  }

  const tocXml = `<nav epub:type="toc" id="toc">
  <h1>Contents</h1>
  <ol>
    ${tocItems
      .map(
        (t) =>
          `<li${t.level > 1 ? ` class="sub"` : ""}><a href="${t.href}">${escapeXml(t.label)}</a></li>`
      )
      .join("\n    ")}
  </ol>
</nav>`;

  zip.file(
    `${OEBPS}/content.opf`,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ""}
    <dc:language>${escapeXml(language)}</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${coverManifest}
    ${manifest.join("\n    ")}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`
  );

  zip.file(
    `${OEBPS}/toc.xhtml`,
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
${tocXml}
</body>
</html>`
  );

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < out.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(out.subarray(i, i + chunk)));
  }
  await invoke("save_binary_file", { path: destPath, base64Content: btoa(binary) });
}
