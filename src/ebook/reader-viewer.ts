// Ebook Reader viewer (lettore fedele).
//
// A dedicated reading area for the Ebooks > Reader tab. Opens a book using the
// real EPUB metadata: package (manifest/spine/cover/layout), the real Table of
// Contents (EPUB 3 nav or EPUB 2 NCX) and the sequential reading order (spine).
// The viewer bar provides: index navigation, prev/next, bookmarks, fullscreen,
// close, and global reading controls (font, size, line height) applied to the
// whole book. On first open the cover is shown as the first screen. Reading
// position and bookmarks are persisted per book in `reader-state.json`.

import {
  assetUrl,
  deobfuscateReaderFonts,
  readFileText,
  readerStateLoad,
  readerStateSave,
  readerSettingsLoad,
  readerSettingsSave,
  readerWorkDir,
} from "./reader-io";
import type { ReaderBook, ReaderBookState, ReaderBookmark, ReaderSettings } from "./reader-io";
import {
  buildReadingList,
  parseEpubPackage,
  parseEpubToc,
  resolveEpubPath,
  splitFragment,
} from "./epub-parser";
import type { EpubPackage, EpubTocEntry, EpubChapter } from "./epub-parser";

let currentBook: ReaderBook | null = null;
let currentDir: string | null = null;
let currentPkg: EpubPackage | null = null;
let currentToc: EpubTocEntry[] | null = null;
let currentReadingList: EpubChapter[] = [];
let currentChapterIndex = 0;
let stateMap: Record<string, ReaderBookState> = {};
let settings: ReaderSettings = readerSettingsLoad();
let fixedLayout = false;
let showingCover = false;

function el(): HTMLElement {
  const node = document.getElementById("reader-viewer");
  if (!node) throw new Error("reader-viewer container missing");
  return node;
}

/** Whether the reader viewer is currently open. */
export function isReaderViewerOpen(): boolean {
  const node = document.getElementById("reader-viewer");
  return !!node && !node.classList.contains("hidden");
}

/** Open the reader viewer for a book (the EPUB is already unpacked). */
export async function openReaderViewer(book: ReaderBook): Promise<void> {
  const dir = await readerWorkDir(book.id);
  const pkg = await parseEpubPackage(dir);
  await deobfuscateReaderFonts(dir, pkg.identifier);
  const toc = await parseEpubToc(dir, pkg);
  const readingList = await buildReadingList(dir, pkg, toc);
  stateMap = await readerStateLoad();
  settings = readerSettingsLoad();

  currentBook = book;
  currentDir = dir;
  currentPkg = pkg;
  currentToc = toc;
  currentReadingList = readingList;
  fixedLayout = pkg.fixedLayout;

  const saved = stateMap[book.id];
  const hasPosition = !!saved && (saved.chapterIndex > 0 || saved.scrollRatio > 0);
  showingCover = !hasPosition;
  currentChapterIndex = saved?.chapterIndex ?? 0;
  if (currentChapterIndex >= readingList.length) currentChapterIndex = 0;

  buildViewer();
  document.body.classList.add("reader-mode");
  if (showingCover) {
    renderCover();
  } else {
    await renderChapter();
  }
}

/** Close the reader viewer, persisting the reading position. */
export function closeReaderViewer(): void {
  persistStateNow();
  currentBook = null;
  currentDir = null;
  currentPkg = null;
  currentToc = null;
  currentReadingList = [];
  const node = el();
  node.classList.add("hidden");
  node.innerHTML = "";
  document.body.classList.remove("reader-mode");
  document.dispatchEvent(new Event("aurawrite:reader-state-changed"));
}

function buildViewer(): void {
  const node = el();
  node.classList.remove("hidden");
  node.innerHTML = `
    <div class="reader-viewer__bar">
      <span class="reader-viewer__title" title="${escapeAttr(currentBook?.name ?? "")}">${escapeHtml(currentBook?.name ?? "")}</span>
      <span class="reader-viewer__spacer"></span>
      <select id="reader-font" class="toolbar__select" title="Font" aria-label="Font">
        <option value="">Default</option>
        <optgroup label="Fonts">
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Courier New</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="'Times New Roman', serif">Times New Roman</option>
          <option value="Verdana, sans-serif">Verdana</option>
          <option value="'Palatino Linotype', 'Book Antiqua', serif">Palatino</option>
          <option value="'Segoe UI', sans-serif">Segoe UI</option>
          <option value="monospace">Monospace</option>
        </optgroup>
      </select>
      <select id="reader-font-size" class="toolbar__select" title="Font Size" aria-label="Font Size">
        <option value="12px">12</option>
        <option value="14px">14</option>
        <option value="16px">16</option>
        <option value="18px">18</option>
        <option value="20px">20</option>
        <option value="24px">24</option>
        <option value="30px">30</option>
      </select>
      <select id="reader-line-height" class="toolbar__select" title="Line Height" aria-label="Line Height">
        <option value="1.0">1.0</option>
        <option value="1.15">1.15</option>
        <option value="1.5">1.5</option>
        <option value="2.0">2.0</option>
      </select>
      <div class="reader-viewer__menu-wrap">
        <button id="reader-index-btn" class="ebook-panel__btn-sm" title="Chapter index">☰ Index</button>
        <div id="reader-index-menu" class="reader-menu hidden"></div>
      </div>
      <button id="reader-prev" class="ebook-panel__btn-sm" title="Previous chapter">←</button>
      <button id="reader-next" class="ebook-panel__btn-sm" title="Next chapter">→</button>
      <button id="reader-bookmark" class="ebook-panel__btn-sm" title="Add bookmark at this position">🔖 Bookmark</button>
      <div class="reader-viewer__menu-wrap reader-viewer__menu-wrap--right">
        <button id="reader-bookmarks-btn" class="ebook-panel__btn-sm" title="Show this book's bookmarks">📑 Bookmarks</button>
        <div id="reader-bookmarks-menu" class="reader-menu hidden"></div>
      </div>
      <button id="reader-fullscreen" class="ebook-panel__btn-sm" title="Fullscreen">⛶</button>
      <button id="reader-close" class="ebook-panel__btn-sm" title="Close reader">✕</button>
    </div>
    <div class="reader-viewer__content">
      <div class="reader-content"></div>
    </div>
  `;

  const fontEl = node.querySelector<HTMLSelectElement>("#reader-font");
  if (fontEl) {
    fontEl.value = settings.fontFamily;
    fontEl.addEventListener("change", () => {
      settings = { ...settings, fontFamily: fontEl.value };
      readerSettingsSave(settings);
      applySettings();
      restoreScroll();
    });
  }
  const sizeEl = node.querySelector<HTMLSelectElement>("#reader-font-size");
  if (sizeEl) {
    sizeEl.value = settings.fontSize;
    sizeEl.addEventListener("change", () => {
      settings = { ...settings, fontSize: sizeEl.value };
      readerSettingsSave(settings);
      applySettings();
      restoreScroll();
    });
  }
  const lhEl = node.querySelector<HTMLSelectElement>("#reader-line-height");
  if (lhEl) {
    lhEl.value = settings.lineHeight;
    lhEl.addEventListener("change", () => {
      settings = { ...settings, lineHeight: lhEl.value };
      readerSettingsSave(settings);
      applySettings();
      restoreScroll();
    });
  }

  if (fixedLayout) {
    // Fixed-layout books do not reflow: reading controls are disabled.
    [fontEl, sizeEl, lhEl].forEach((s) => {
      if (s) {
        s.disabled = true;
        s.title = "Fixed layout — reading controls disabled";
      }
    });
  }

  node.querySelector("#reader-index-btn")?.addEventListener("click", () => {
    toggleMenu("reader-index-menu", renderIndexMenu);
  });
  node.querySelector("#reader-prev")?.addEventListener("click", () => {
    if (showingCover) return;
    void goToChapter(currentChapterIndex - 1);
  });
  node.querySelector("#reader-next")?.addEventListener("click", () => {
    if (showingCover) {
      showingCover = false;
      void goToChapter(0);
      return;
    }
    void goToChapter(currentChapterIndex + 1);
  });
  node.querySelector("#reader-bookmark")?.addEventListener("click", () => void addBookmark());
  node.querySelector("#reader-bookmarks-btn")?.addEventListener("click", () => {
    toggleMenu("reader-bookmarks-menu", renderBookmarksMenu);
  });
  node.querySelector("#reader-fullscreen")?.addEventListener("click", toggleFullscreen);
  node.querySelector("#reader-close")?.addEventListener("click", closeReaderViewer);

  const content = node.querySelector<HTMLElement>(".reader-viewer__content");
  if (content) {
    content.addEventListener("scroll", () => schedulePersist());
  }
  const contentEl = node.querySelector<HTMLElement>(".reader-content");
  contentEl?.addEventListener("click", (e) => handleContentClick(e));

  bindDocumentListeners();
}

let documentListenersBound = false;
function bindDocumentListeners(): void {
  if (documentListenersBound) return;
  documentListenersBound = true;
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".reader-viewer__bar")) {
      closeMenus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
}

function renderIndexMenu(menu: HTMLElement): void {
  menu.innerHTML = "";
  if (!currentToc || !currentToc.length) {
    const empty = document.createElement("div");
    empty.className = "reader-menu__empty";
    empty.textContent = "No index";
    menu.appendChild(empty);
    return;
  }
  const renderEntries = (entries: EpubTocEntry[]): void => {
    for (const e of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reader-menu__item";
      btn.style.paddingLeft = `${8 + e.depth * 14}px`;
      const { path, fragment } = splitFragment(e.href);
      const current = currentReadingList[currentChapterIndex];
      if (current && path && !fragment && current.href === path) {
        btn.classList.add("reader-menu__item--active");
      }
      btn.textContent = e.title;
      btn.addEventListener("click", () => {
        closeMenus();
        void navigateToToc(e.href);
      });
      menu.appendChild(btn);
      renderEntries(e.children);
    }
  };
  renderEntries(currentToc);
}

function renderBookmarksMenu(menu: HTMLElement): void {
  menu.innerHTML = "";
  const bookmarks = stateMap[currentBook?.id ?? ""]?.bookmarks ?? [];
  if (bookmarks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "reader-menu__empty";
    empty.textContent = "No bookmarks";
    menu.appendChild(empty);
    return;
  }
  bookmarks.forEach((bm) => {
    const row = document.createElement("div");
    row.className = "reader-menu__row";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "reader-menu__item";
    label.textContent = `${bm.name || `Pos ${bm.chapterIndex + 1}`} · ${Math.round(bm.scrollRatio * 100)}%`;
    label.addEventListener("click", () => {
      closeMenus();
      void goToChapter(bm.chapterIndex, bm.anchorId ? undefined : bm.scrollRatio, bm.anchorId ?? null);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "reader-menu__del";
    del.textContent = "×";
    del.title = "Remove bookmark";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBookmark(bm.id);
      renderBookmarksMenu(menu);
    });
    row.appendChild(label);
    row.appendChild(del);
    menu.appendChild(row);
  });
}

function toggleMenu(menuId: string, render: (m: HTMLElement) => void): void {
  const menu = el().querySelector<HTMLElement>(`#${menuId}`);
  if (!menu) return;
  const willOpen = menu.classList.contains("hidden");
  closeMenus();
  if (willOpen) {
    render(menu);
    menu.classList.remove("hidden");
  }
}

function closeMenus(): void {
  el().querySelectorAll(".reader-menu").forEach((m) => m.classList.add("hidden"));
}

/** Intercept clicks on links inside the rendered content (internal navigation). */
function handleContentClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  const a = t?.closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  if (/^https?:/i.test(href)) {
    window.open(href, "_blank", "noopener");
    return;
  }
  if (/^(data:|blob:|file:|tauri:|asset:|mailto:|javascript:)/i.test(href)) return;
  const chapter = currentReadingList[currentChapterIndex];
  if (!chapter) return;
  const base = chapter.href.includes("/") ? chapter.href.slice(0, chapter.href.lastIndexOf("/")) : "";
  void navigateToFile(resolveRel(base, href));
}

/** Navigate to a folder-relative file path (with optional fragment). */
async function navigateToFile(rel: string): Promise<void> {
  const { path, fragment } = splitFragment(rel);
  const idx = currentReadingList.findIndex((c) => c.href === path);
  if (idx !== -1) {
    showingCover = false;
    await goToChapter(idx, undefined, fragment);
  } else if (path === currentReadingList[currentChapterIndex]?.href) {
    scrollToAnchor(fragment);
  }
}

async function navigateToToc(href: string): Promise<void> {
  const { path, fragment } = splitFragment(href);
  if (!currentPkg) return;
  const rel = resolveEpubPath(currentPkg.opfPath, path);
  const idx = currentReadingList.findIndex((c) => c.href === rel);
  if (idx !== -1) {
    showingCover = false;
    await goToChapter(idx, undefined, fragment);
  } else if (rel === currentReadingList[currentChapterIndex]?.href) {
    scrollToAnchor(fragment);
  }
}

async function goToChapter(index: number, scrollRatio?: number, anchor?: string | null): Promise<void> {
  if (!currentBook || !currentReadingList.length) return;
  const clamped = Math.max(0, Math.min(currentReadingList.length - 1, index));
  if (clamped === currentChapterIndex && scrollRatio === undefined && anchor === undefined) return;
  persistStateNow();
  currentChapterIndex = clamped;
  showingCover = false;
  await renderChapter(scrollRatio, anchor);
}

/** Show the cover as the first screen (first open of a book). */
function renderCover(): void {
  const contentEl = el().querySelector<HTMLElement>(".reader-content");
  if (!contentEl || !currentDir || !currentPkg) return;
  if (currentPkg.coverHref) {
    const coverRel = resolveEpubPath(currentPkg.opfPath, currentPkg.coverHref);
    const coverAbs = joinDir(currentDir, coverRel);
    contentEl.innerHTML = `<div class="reader-cover"><img src="${escapeAttr(assetUrl(coverAbs))}" alt="Cover" /></div>`;
  } else {
    contentEl.innerHTML = `<div class="reader-cover"><h1>${escapeHtml(currentBook?.name ?? "")}</h1></div>`;
  }
  const barTitle = el().querySelector(".reader-viewer__title");
  if (barTitle) barTitle.textContent = currentBook?.name ?? "";
  const prev = el().querySelector<HTMLButtonElement>("#reader-prev");
  const next = el().querySelector<HTMLButtonElement>("#reader-next");
  if (prev) prev.disabled = true;
  if (next) next.disabled = false;
}

async function renderChapter(scrollRatio?: number, anchor?: string | null): Promise<void> {
  if (!currentDir) return;
  const dir = currentDir;
  const chapter = currentReadingList[currentChapterIndex];
  if (!chapter) return;

  let raw: string;
  try {
    raw = await readFileText(`${dir}/${chapter.href}`);
  } catch (e) {
    console.error("[reader] failed to read chapter:", e);
    return;
  }

  const doc = new DOMParser().parseFromString(raw, "text/html");
  const chapterBase = chapter.href.includes("/") ? chapter.href.slice(0, chapter.href.lastIndexOf("/")) : "";

  // Remove potentially unsafe / unwanted elements from injected content.
  doc.querySelectorAll("script, iframe, object, embed, form, base, noscript").forEach((n) => n.remove());
  doc.querySelectorAll("a[href^='javascript:'], img[src^='javascript:']").forEach((n) => n.remove());

  // Resolve images relative to the chapter folder into asset:// URLs.
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    if (/^(https?:|data:|blob:|file:|tauri:|asset:)/i.test(src)) return;
    if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("/")) return;
    img.setAttribute("src", resolveAsset(dir, chapterBase, src));
  });

  // Load the book's stylesheets inline (CSP: only inline <style> is allowed)
  // and resolve every url(...) inside them against the stylesheet folder.
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute("href");
    if (!href || /^https?:/i.test(href)) {
      link.remove();
      continue;
    }
    const cssAbs = resolveAsset(dir, chapterBase, href);
    let css: string;
    try {
      css = await readFileText(cssAbs);
    } catch {
      link.remove();
      continue;
    }
    const cssBase = href.includes("/") ? href.slice(0, href.lastIndexOf("/")) : "";
    const resolved = resolveCssUrls(css, dir, cssBase);
    const style = doc.createElement("style");
    style.textContent = resolved;
    link.replaceWith(style);
  }

  const contentEl = el().querySelector<HTMLElement>(".reader-content");
  if (!contentEl) return;
  contentEl.innerHTML = doc.body?.innerHTML ?? "";
  markChapterBookmarks(contentEl);
  appendChapterEnd(contentEl);

  applySettings();
  if (anchor) {
    scrollToAnchor(anchor);
  } else {
    restoreScroll(scrollRatio);
  }

  const barTitle = el().querySelector(".reader-viewer__title");
  if (barTitle) {
    const prefix = currentReadingList.length > 1 ? `${currentChapterIndex + 1}/${currentReadingList.length} · ` : "";
    barTitle.textContent = `${prefix}${chapter.title}`;
  }
  const prev = el().querySelector<HTMLButtonElement>("#reader-prev");
  const next = el().querySelector<HTMLButtonElement>("#reader-next");
  if (prev) prev.disabled = currentChapterIndex <= 0;
  if (next) next.disabled = currentChapterIndex >= currentReadingList.length - 1;
}

function scrollToAnchor(fragment: string | null): void {
  const content = el().querySelector<HTMLElement>(".reader-viewer__content");
  const target = fragment ? el().querySelector<HTMLElement>(`#${CSS.escape(fragment)}`) : null;
  if (!content) return;
  if (target) {
    requestAnimationFrame(() => {
      const top = target.getBoundingClientRect().top + content.scrollTop - content.getBoundingClientRect().top;
      content.scrollTop = top;
    });
  } else {
    restoreScroll(0);
  }
}

/** Resolve a relative path into an asset:// URL against the reading folder. */
function resolveAsset(dir: string, base: string, rel: string): string {
  const relPath = resolveRel(base, rel);
  return assetUrl(joinDir(dir, relPath));
}

/** Resolve every url(...) in a CSS string against the stylesheet folder. */
function resolveCssUrls(css: string, dir: string, cssBase: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, url: string) => {
    const trimmed = url.trim();
    if (/^(https?:|data:|blob:|file:|tauri:|asset:)/i.test(trimmed)) return `url(${_q}${trimmed}${_q})`;
    if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) return `url(${_q}${trimmed}${_q})`;
    const relPath = resolveRel(cssBase, trimmed);
    return `url(${_q}${assetUrl(joinDir(dir, relPath))}${_q})`;
  });
}

/**
 * Resolve a relative path against a base folder, normalizing `..` segments
 * that climb above the base. Returns a folder-relative path using `/`.
 */
function resolveRel(base: string, rel: string): string {
  const stack = base ? base.split("/").filter(Boolean) : [];
  for (const part of rel.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** Join a base directory and a relative path using the OS separator. */
function joinDir(dir: string, rel: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  if (dir.endsWith("\\") || dir.endsWith("/")) return dir + rel;
  return dir + sep + rel;
}

/** Apply the global reading settings to the rendered chapter. */
function applySettings(): void {
  const contentEl = el().querySelector<HTMLElement>(".reader-content");
  if (!contentEl) return;
  contentEl.style.fontSize = settings.fontSize;
  contentEl.style.lineHeight = settings.lineHeight;
  const style = contentEl.querySelector<HTMLElement>(":scope > style[data-reader-font]") as HTMLStyleElement | null;
  if (settings.fontFamily) {
    const rule = `.reader-content, .reader-content * { font-family: ${settings.fontFamily} !important; }`;
    if (style) style.textContent = rule;
    else {
      const s = document.createElement("style");
      s.setAttribute("data-reader-font", "1");
      s.textContent = rule;
      contentEl.prepend(s);
    }
  } else if (style) {
    style.remove();
  }
}

/** Restore the reading position (scroll ratio) after a render. */
function restoreScroll(scrollRatio?: number): void {
  const content = el().querySelector<HTMLElement>(".reader-viewer__content");
  if (!content) return;
  const ratio = scrollRatio ?? stateMap[currentBook?.id ?? ""]?.scrollRatio ?? 0;
  requestAnimationFrame(() => {
    content.scrollTop = ratio * content.scrollHeight;
  });
}

function currentRatio(): number {
  const content = el().querySelector<HTMLElement>(".reader-viewer__content");
  if (!content || content.scrollHeight <= 0) return 0;
  return content.scrollTop / content.scrollHeight;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistStateNow(), 400);
}

function persistStateNow(): void {
  if (!currentBook) return;
  const id = currentBook.id;
  const prev = stateMap[id] ?? { chapterIndex: 0, scrollRatio: 0, bookmarks: [] };
  stateMap[id] = {
    ...prev,
    chapterIndex: showingCover ? 0 : currentChapterIndex,
    scrollRatio: showingCover ? 0 : currentRatio(),
  };
  void readerStateSave(stateMap).catch((e) => console.error("[reader] failed to save state:", e));
}

async function addBookmark(): Promise<void> {
  if (!currentBook || showingCover) return;
  const id = currentBook.id;
  const prev = stateMap[id] ?? { chapterIndex: 0, scrollRatio: 0, bookmarks: [] };
  const bmId = `bm${Date.now().toString(36)}`;
  const captured = captureBookmarkTarget(bmId);
  const bm: ReaderBookmark = {
    id: bmId,
    name: `C${currentChapterIndex + 1}`,
    chapterIndex: currentChapterIndex,
    scrollRatio: currentRatio(),
    anchorId: captured?.anchorId,
    path: captured?.path,
  };
  prev.bookmarks = [...prev.bookmarks, bm];
  stateMap[id] = { ...prev, chapterIndex: currentChapterIndex, scrollRatio: bm.scrollRatio };
  await readerStateSave(stateMap).catch((e) => console.error("[reader] failed to save bookmark:", e));
  if (captured?.target) captured.target.classList.add("reader-bookmark-marker");
  flashBookmarkButton();
  document.dispatchEvent(new Event("aurawrite:reader-state-changed"));
}

/** Capture the element at the centre of the view as the bookmark target. */
function captureBookmarkTarget(
  bmId: string
): { target: HTMLElement; anchorId: string; path: number[] } | null {
  const contentEl = el().querySelector<HTMLElement>(".reader-content");
  const view = el().querySelector<HTMLElement>(".reader-viewer__content");
  if (!contentEl || !view) return null;
  const rect = view.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + view.clientHeight / 2;
  const at = document.elementFromPoint(cx, cy) as HTMLElement | null;
  let target: HTMLElement | null = at;
  while (target && target !== contentEl && !(target.textContent ?? "").trim()) {
    target = target.parentElement;
  }
  if (!target || target === contentEl) {
    target =
      (Array.from(contentEl.querySelectorAll("p, h1, h2, h3, h4, li, blockquote, div")).find(
        (e) => (e.textContent ?? "").trim()
      ) as HTMLElement | undefined) ?? null;
  }
  if (!target) return null;
  const anchorId = `reader-bm-${bmId}`;
  if (!target.id) target.id = anchorId;
  return { target, anchorId: target.id, path: buildChildPath(contentEl, target) };
}

function buildChildPath(root: HTMLElement, target: HTMLElement): number[] {
  const path: number[] = [];
  let node: HTMLElement | null = target;
  while (node && node !== root) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    path.unshift(Array.from(parent.children).indexOf(node));
    node = parent;
  }
  return path;
}

/** Mark the elements that hold bookmarks of the current chapter. */
function markChapterBookmarks(container: HTMLElement): void {
  const bookmarks = stateMap[currentBook?.id ?? ""]?.bookmarks ?? [];
  for (const bm of bookmarks) {
    if (bm.chapterIndex !== currentChapterIndex) continue;
    let target: HTMLElement | null = null;
    if (bm.path && bm.path.length) {
      target = resolveChildPath(container, bm.path);
    } else if (bm.anchorId) {
      target = container.querySelector(`#${CSS.escape(bm.anchorId)}`);
    }
    if (target) {
      if (bm.anchorId && !target.id) target.id = bm.anchorId;
      target.classList.add("reader-bookmark-marker");
    }
  }
}

function resolveChildPath(root: HTMLElement, path: number[]): HTMLElement | null {
  let node: HTMLElement = root;
  for (const idx of path) {
    const child = node.children[idx] as HTMLElement | undefined;
    if (!child) return null;
    node = child;
  }
  return node === root ? null : node;
}

/** End-of-chapter marker with explicit previous/next actions. */
function appendChapterEnd(container: HTMLElement): void {
  const end = document.createElement("div");
  end.className = "reader-end";
  const title = document.createElement("div");
  title.className = "reader-end__title";
  title.textContent = "End of chapter";
  end.appendChild(title);
  const row = document.createElement("div");
  row.className = "reader-end__row";
  if (currentChapterIndex > 0) {
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "ebook-panel__btn-sm";
    prev.textContent = "← Previous";
    prev.addEventListener("click", () => void goToChapter(currentChapterIndex - 1));
    row.appendChild(prev);
  }
  if (currentChapterIndex < currentReadingList.length - 1) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "ebook-panel__btn-sm";
    next.textContent = "Next chapter →";
    next.addEventListener("click", () => void goToChapter(currentChapterIndex + 1));
    row.appendChild(next);
  }
  end.appendChild(row);
  container.appendChild(end);
}

/** Visual feedback on the bookmark button after adding one. */
function flashBookmarkButton(): void {
  const btn = el().querySelector<HTMLButtonElement>("#reader-bookmark");
  if (!btn) return;
  btn.textContent = "✓";
  btn.title = "Bookmark added";
  setTimeout(() => {
    if (btn) {
      btn.textContent = "🔖";
      btn.title = "Add bookmark at this position";
    }
  }, 1500);
}

function removeBookmark(bookmarkId: string): void {
  if (!currentBook) return;
  const id = currentBook.id;
  const prev = stateMap[id];
  if (!prev) return;
  prev.bookmarks = prev.bookmarks.filter((b) => b.id !== bookmarkId);
  stateMap[id] = { ...prev };
  void readerStateSave(stateMap).catch((e) => console.error("[reader] failed to save bookmark:", e));
  document.dispatchEvent(new Event("aurawrite:reader-state-changed"));
}

function toggleFullscreen(): void {
  const node = el();
  node.classList.toggle("reader-viewer--fullscreen");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c] as string);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
