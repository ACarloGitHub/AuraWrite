// EPUB metadata parser for the Reader (TOC, spine, cover, package).
//
// Reads the EPUB "package" (container.xml -> OPF: manifest, spine, metadata),
// the real Table of Contents (EPUB 3 nav document or EPUB 2 NCX) and the cover
// image. Also builds the sequential reading list (spine) excluding non-content
// files (cover, navigation document, linear="no", non-XHTML).

import { readFileText } from "./reader-io";

export interface EpubManifestItem {
  href: string;
  mediaType: string;
  properties: string[];
}

export interface EpubSpineItem {
  idref: string;
  linear: boolean;
}

export interface EpubPackage {
  /** OPF path relative to the reading folder. */
  opfPath: string;
  title: string;
  /** Unique identifier (used to deobfuscate fonts). */
  identifier: string;
  manifest: Record<string, EpubManifestItem>;
  spine: EpubSpineItem[];
  /** href (relative to the OPF) of the EPUB 2 NCX, if any. */
  ncxHref: string | null;
  /** href (relative to the OPF) of the EPUB 3 nav document, if any. */
  navHref: string | null;
  /** href (relative to the OPF) of the cover image, if any. */
  coverHref: string | null;
  /** True when the book is pre-paginated (fixed layout). */
  fixedLayout: boolean;
}

export interface EpubTocEntry {
  title: string;
  /** href with optional fragment (e.g. "chap.xhtml#s2"). */
  href: string;
  depth: number;
  children: EpubTocEntry[];
}

export interface EpubChapter {
  /** href relative to the reading folder (without fragment). */
  href: string;
  title: string;
}

const DC_NS = "http://purl.org/dc/elements/1.1/";

/** Resolve a manifest/nav href (relative to the OPF) into a folder-relative path. */
export function resolveEpubPath(opfPath: string, href: string): string {
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  if (href.startsWith("/")) return href.replace(/^\/+/, "");
  if (!opfDir) return href;
  return `${opfDir}/${href}`;
}

/** Split an href into its file path and optional fragment. */
export function splitFragment(href: string): { path: string; fragment: string | null } {
  const idx = href.indexOf("#");
  if (idx === -1) return { path: href, fragment: null };
  return { path: href.slice(0, idx), fragment: href.slice(idx + 1) || null };
}

/** Read the EPUB package document (manifest, spine, metadata, cover, layout). */
export async function parseEpubPackage(dir: string): Promise<EpubPackage> {
  let containerXml = "";
  try {
    containerXml = await readFileText(`${dir}/META-INF/container.xml`);
  } catch {
    throw new Error("Not a valid EPUB: missing META-INF/container.xml");
  }
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = container.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not a valid EPUB: container.xml has no rootfile");

  let opfXml = "";
  try {
    opfXml = await readFileText(`${dir}/${opfPath}`);
  } catch {
    throw new Error("Not a valid EPUB: OPF not found");
  }
  const opf = new DOMParser().parseFromString(opfXml, "application/xml");

  const manifest: Record<string, EpubManifestItem> = {};
  opf.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) return;
    manifest[id] = {
      href,
      mediaType: item.getAttribute("media-type") ?? "",
      properties: (item.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean),
    };
  });

  const spine: EpubSpineItem[] = [];
  opf.querySelectorAll("spine > itemref").forEach((ref) => {
    const idref = ref.getAttribute("idref");
    if (!idref) return;
    spine.push({ idref, linear: (ref.getAttribute("linear") ?? "yes") !== "no" });
  });

  const spineEl = opf.querySelector("spine");
  const ncxId = spineEl?.getAttribute("toc") ?? null;
  const ncxHref = ncxId && manifest[ncxId] ? manifest[ncxId].href : null;

  const titleEl = opf.getElementsByTagNameNS(DC_NS, "title")[0];
  const title = titleEl?.textContent?.trim() ?? "";
  const identifierEl = opf.getElementsByTagNameNS(DC_NS, "identifier")[0];
  const identifier = identifierEl?.textContent?.trim() ?? "";

  let coverHref: string | null = null;
  for (const item of Object.values(manifest)) {
    if (item.properties.includes("cover-image")) {
      coverHref = item.href;
      break;
    }
  }
  if (!coverHref) {
    const metaCover = Array.from(opf.querySelectorAll("meta[name='cover']")).find(
      (m) => m.getAttribute("name") === "cover"
    );
    const coverId = metaCover?.getAttribute("content");
    if (coverId && manifest[coverId]) coverHref = manifest[coverId].href;
  }

  let navHref: string | null = null;
  for (const item of Object.values(manifest)) {
    if (item.properties.includes("nav")) {
      navHref = item.href;
      break;
    }
  }

  let fixedLayout = false;
  for (const meta of Array.from(opf.querySelectorAll("meta"))) {
    if (meta.getAttribute("property") === "rendition:layout" && meta.textContent?.trim() === "pre-paginated") {
      fixedLayout = true;
    }
  }

  return {
    opfPath,
    title,
    identifier,
    manifest,
    spine,
    ncxHref,
    navHref,
    coverHref,
    fixedLayout,
  };
}

/** Read the Table of Contents tree: EPUB 3 nav first, EPUB 2 NCX as fallback. */
export async function parseEpubToc(dir: string, pkg: EpubPackage): Promise<EpubTocEntry[] | null> {
  if (pkg.navHref) {
    const nav = await tryNavToc(dir, pkg);
    if (nav && nav.length) return nav;
  }
  if (pkg.ncxHref) {
    const ncx = await tryNcxToc(dir, pkg);
    if (ncx && ncx.length) return ncx;
  }
  return null;
}

async function tryNavToc(dir: string, pkg: EpubPackage): Promise<EpubTocEntry[] | null> {
  if (!pkg.navHref) return null;
  const path = resolveEpubPath(pkg.opfPath, pkg.navHref);
  let html = "";
  try {
    html = await readFileText(`${dir}/${path}`);
  } catch {
    return null;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const navs = Array.from(doc.querySelectorAll("nav"));
  const tocNav =
    navs.find((n) => n.getAttribute("epub:type")?.split(/\s+/).includes("toc")) ??
    navs.find((n) => n.getAttribute("type") === "toc") ??
    navs[0];
  if (!tocNav) return null;
  const ol = tocNav.querySelector(":scope > ol");
  if (!ol) return null;
  return parseNavOl(ol, 0);
}

function parseNavOl(ol: Element, depth: number): EpubTocEntry[] {
  const out: EpubTocEntry[] = [];
  for (const li of Array.from(ol.children).filter((e) => e.tagName.toLowerCase() === "li")) {
    const entries = parseNavLi(li as Element, depth);
    out.push(...entries);
  }
  return out;
}

function parseNavLi(li: Element, depth: number): EpubTocEntry[] {
  const link = li.querySelector(":scope > a");
  const span = li.querySelector(":scope > span");
  let title = "";
  let href = "";
  if (link) {
    title = link.textContent?.trim() ?? "";
    href = link.getAttribute("href") ?? "";
  } else if (span) {
    title = span.textContent?.trim() ?? "";
  }
  const childOl = li.querySelector(":scope > ol");
  const children = childOl ? parseNavOl(childOl, depth + 1) : [];
  if (title) {
    return [{ title, href, depth, children }];
  }
  return children;
}

async function tryNcxToc(dir: string, pkg: EpubPackage): Promise<EpubTocEntry[] | null> {
  if (!pkg.ncxHref) return null;
  const path = resolveEpubPath(pkg.opfPath, pkg.ncxHref);
  let xml = "";
  try {
    xml = await readFileText(`${dir}/${path}`);
  } catch {
    return null;
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const navMap = doc.querySelector("navMap");
  if (!navMap) return null;
  const out: EpubTocEntry[] = [];
  for (const np of Array.from(navMap.children).filter((e) => e.tagName.toLowerCase() === "navpoint")) {
    out.push(...parseNcxNavPoint(np as Element, 0));
  }
  return out.length ? out : null;
}

function parseNcxNavPoint(np: Element, depth: number): EpubTocEntry[] {
  const label = np.querySelector(":scope > navLabel > text")?.textContent?.trim() ?? "";
  const src = np.querySelector(":scope > content")?.getAttribute("src") ?? "";
  const childNps = np.querySelector(":scope > navPoint");
  const children: EpubTocEntry[] = [];
  if (childNps) {
    for (const child of Array.from(childNps.parentElement?.children ?? []).filter(
      (e) => e.tagName.toLowerCase() === "navpoint"
    )) {
      children.push(...parseNcxNavPoint(child as Element, depth + 1));
    }
  }
  if (label) return [{ title: label, href: src, depth, children }];
  return children;
}

/**
 * Build the sequential reading list from the spine, excluding non-content
 * files (cover, navigation document, linear="no", non-XHTML) and de-duplicating.
 * Titles come from the TOC when available, otherwise from the file name.
 */
export async function buildReadingList(
  dir: string,
  pkg: EpubPackage,
  toc: EpubTocEntry[] | null
): Promise<EpubChapter[]> {
  const excluded = new Set<string>();
  if (pkg.coverHref) excluded.add(resolveEpubPath(pkg.opfPath, pkg.coverHref));
  if (pkg.navHref) excluded.add(resolveEpubPath(pkg.opfPath, pkg.navHref));

  const titleByFile = new Map<string, string>();
  if (toc) {
    const walk = (entries: EpubTocEntry[]): void => {
      for (const e of entries) {
        const { path } = splitFragment(e.href);
        if (path && !titleByFile.has(path)) titleByFile.set(path, e.title);
        walk(e.children);
      }
    };
    walk(toc);
  }

  const seen = new Set<string>();
  const chapters: EpubChapter[] = [];
  for (const item of pkg.spine) {
    if (!item.linear) continue;
    const m = pkg.manifest[item.idref];
    if (!m) continue;
    if (!/xhtml|html|svg|xml/i.test(m.mediaType)) continue;
    const rel = resolveEpubPath(pkg.opfPath, m.href);
    if (excluded.has(rel) || seen.has(rel)) continue;
    seen.add(rel);
    const base = rel.split("/").pop() ?? rel;
    const title = titleByFile.get(m.href) ?? titleByFile.get(rel) ?? base.replace(/\.[^.]+$/, "");
    chapters.push({ href: rel, title });
  }
  return chapters;
}
