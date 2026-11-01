/**
 * User fonts: the catalogue is read when someone needs it, and a `@font-face`
 * is declared only for a family that is actually used.
 *
 * Why. The folder is the writer's own (Preferences > "My fonts folder") and can
 * hold thousands of files. Reading it and declaring every file as a font face
 * at startup cost about a second of blocked main thread on a folder of 3.471
 * files (measured 2026-11-01): 350-425 ms to open each file and peek at its
 * magic bytes, ~38 ms for 3.464 @font-face rules, and ~90 ms of option layout
 * per select, filled with one `<option>` per font. The window has no reason to
 * wait for a list nobody has asked to see.
 *
 * Three moments ask for fonts, and each gets only what it needs:
 *  - a font select is opened   -> its options are filled, once (3.5k options
 *                                 cost their 90-240 ms there, not at startup);
 *  - a family is applied       -> its `@font-face` is declared (toolbar,
 *                                 Preferences editor/UI font);
 *  - a document is installed   -> the faces of the families it formats with.
 *
 * The catalogue itself is a list of names: `list_user_font_files` reads the
 * folder entries and opens nothing (~2 ms on the same 3.471 files). The faces
 * point at the files and are declared before the text that uses them is laid
 * out, so nothing flashes in a fallback face because a list was late.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { Node as PMNode } from "prosemirror-model";

interface UserFontFile {
  path: string;
  family_guess: string;
}

/** The selects that offer user fonts: the toolbar's, and the two in Preferences. */
const SELECT_IDS = ["sel-font-family", "pref-fonts-editor", "pref-fonts-ui"];

/** family guess -> file path. `null` until the folder has been read. */
let filesByFamily: Map<string, string> | null = null;
let loading: Promise<Map<string, string>> | null = null;

/** Families whose `@font-face` is already in the document. */
const declaredFaces = new Set<string>();

function faceStyle(): HTMLStyleElement {
  let el = document.querySelector<HTMLStyleElement>("style[data-user-fonts]");
  if (!el) {
    el = document.createElement("style");
    el.dataset.userFonts = "true";
    document.head.appendChild(el);
  }
  return el;
}

function loadFiles(): Promise<Map<string, string>> {
  if (filesByFamily) return Promise.resolve(filesByFamily);
  if (!loading) {
    loading = invoke<UserFontFile[]>("list_user_font_files")
      .then((files) => {
        const map = new Map<string, string>();
        for (const file of files) map.set(file.family_guess, file.path);
        filesByFamily = map;
        return map;
      })
      .catch((e) => {
        // An unreadable folder is not an error the writer can do anything
        // about here: the bundled and system fonts still work.
        console.warn("[fonts-ui] list_user_font_files failed:", e);
        filesByFamily = new Map();
        return filesByFamily;
      });
  }
  return loading;
}

/** Declare the face of `family` if it is a user font and is not declared yet. */
function declareFace(family: string): void {
  if (!family || !filesByFamily || declaredFaces.has(family)) return;
  const path = filesByFamily.get(family);
  if (!path) return;
  declaredFaces.add(family);
  const style = faceStyle();
  style.textContent += `@font-face { font-family: "${family}"; src: url("${convertFileSrc(path)}"); font-display: swap; }\n`;
}

/** One `<option>` per user font, in the folder's order, added once. */
export function fillUserFontOptions(select: HTMLSelectElement): void {
  if (!filesByFamily || select.dataset.userFonts === "filled") return;
  select.dataset.userFonts = "filled";

  const present = new Set(Array.from(select.options, (option) => option.value));
  const fragment = document.createDocumentFragment();
  for (const family of filesByFamily.keys()) {
    if (present.has(family)) continue;
    const option = document.createElement("option");
    option.value = family;
    option.textContent = `\u{1F4C1} ${family}`;
    option.style.fontFamily = `"${family}", sans-serif`;
    option.dataset.userFont = "true";
    fragment.appendChild(option);
  }
  select.appendChild(fragment);
}

/**
 * Keep a stored family selectable before its option has been built. The
 * Preferences form saves whatever the select says, so a missing option would
 * silently turn the writer's editor font back into the first one in the list.
 */
export function ensureFontOption(select: HTMLSelectElement, family: string): void {
  if (!family || Array.from(select.options).some((option) => option.value === family)) return;
  const option = document.createElement("option");
  option.value = family;
  option.textContent = family;
  option.dataset.userFont = "true";
  select.appendChild(option);
}

/**
 * The families a document formats with: the `fontFamily` mark is the only place
 * a document carries a font (the body font is the preferences variable).
 */
export function registerDocumentFontFaces(doc: PMNode): void {
  if (!filesByFamily || filesByFamily.size === 0) return;
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === "fontFamily") declareFace(String(mark.attrs.font ?? ""));
    }
  });
}

/** Every select that offers user fonts, clones in the overflow menu included. */
function fontSelects(): HTMLSelectElement[] {
  const selector = SELECT_IDS.map((id) => `select[id="${id}"]`).join(",");
  return Array.from(document.querySelectorAll<HTMLSelectElement>(selector));
}

/**
 * Filling has to happen before the native popup is built, and it has to reach
 * the proxies the overflow menu clones out of the toolbar (a clone is filled
 * only when it is opened: `cloneNode` copies the flag along with the options).
 */
function attachLazyFill(): void {
  const fill = (target: EventTarget | null): void => {
    if (target instanceof HTMLSelectElement && SELECT_IDS.includes(target.id)) {
      fillUserFontOptions(target);
    }
  };

  document.addEventListener("pointerdown", (e) => fill(e.target), true);
  document.addEventListener("focusin", (e) => fill(e.target));
  document.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown") fill(e.target);
  });
  // Capture phase: the face is declared before the toolbar applies the mark.
  document.addEventListener(
    "change",
    (e) => {
      const target = e.target;
      if (target instanceof HTMLSelectElement && SELECT_IDS.includes(target.id)) {
        declareFace(target.value);
      }
    },
    true,
  );
}

/**
 * Bootstrap: wire the selects, read the folder's names, and declare the faces
 * of the fonts the preferences already use. Awaited by `main.ts` so the first
 * document is laid out with its faces already in place.
 */
export async function initUserFonts(fonts: {
  editor: string;
  ui: string;
  useBundled: boolean;
}): Promise<void> {
  attachLazyFill();
  await loadFiles();
  if (!fonts.useBundled) return;
  declareFace(fonts.editor);
  declareFace(fonts.ui);
}

/**
 * Preferences > Reload: forget the catalogue, so the next select shows what the
 * folder holds now. The declared faces stay: they are what the document on
 * screen is using, and a face whose file has gone simply falls back.
 */
export function reloadUserFonts(): void {
  filesByFamily = null;
  loading = null;

  for (const select of fontSelects()) {
    const current = select.value;
    select.querySelectorAll("option[data-user-font]").forEach((option) => option.remove());
    delete select.dataset.userFonts;
    if (current) ensureFontOption(select, current);
  }

  void loadFiles();
}
