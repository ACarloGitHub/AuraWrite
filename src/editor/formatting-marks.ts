/**
 * E4 — formatting marks (Word's «Show/Hide ¶», Ctrl+Shift+8).
 *
 * The contract (catalogo, §2): spaces and tabs visible ON REQUEST, as
 * DECORATIONS and never as nodes. Nothing here writes the document: no node is
 * inserted, no attribute changes, nothing travels to DOCX, HTML or the page
 * calculator. The screen shows what is already there, and the paper is untouched.
 *
 * What is drawn, and how:
 *  - a space (U+0020) and a non-breaking space (U+00A0): one inline decoration
 *    each, class `aw-fmt-space` / `aw-fmt-nbsp`; the glyph is a pseudo-element,
 *    so the character keeps its own width and the line cannot move;
 *  - a tabulation: no new decoration — E3 already wraps `\t` in `.aw-tab` with
 *    the advance the page calculator computed; the arrow is a pseudo-element
 *    on that span (05-document.css), the width untouched;
 *  - the paragraph mark ¶: a pseudo-element on every block (p, h1…h6), out of
 *    flow, zero box, invisible to line breaking;
 *  - a manual line break ↵: a ZERO-WIDTH widget right before the `hard_break`
 *    (a `<br>` has no box and Chromium paints no pseudo-element on it).
 *
 * WHY A WINDOW. The whole book cannot be decorated: the 300-page test book has
 * ~160 000 spaces, and one span each would multiply the DOM and the cost of every
 * keystroke. The decorations cover what the screen shows plus a screen of slack;
 * scrolling moves the window, an edit rebuilds it where it is. The page
 * calculator never sees any of this, so pageFrame and measures are unchanged.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";

const STORAGE_KEY = "aurawrite-formatting-marks";
const ROOT_CLASS = "aw-formatting-marks";
const BUTTON_ID = "btn-formatting-marks";
const marksPluginKey = new PluginKey("aw-formatting-marks");

let marksOn = readStored();

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function getFormattingMarks(): boolean {
  return marksOn;
}

/** The window of document positions the decorations cover (module state: the
 *  plugin reads it on every rebuild, the view hook moves it on scroll). */
let windowFrom = 0;
let windowTo = 0;
let refreshScheduled = 0;

/** One decoration per space / non-breaking space between `from` and `to`. */
function build(state: EditorState, from: number, to: number): DecorationSet {
  if (!marksOn) return DecorationSet.empty;
  const lo = Math.max(0, from);
  const hi = Math.min(state.doc.content.size, to);
  if (hi <= lo) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  state.doc.nodesBetween(lo, hi, (node, pos) => {
    if (node.isText) {
      const text = node.text ?? "";
      const spaces = /[\u0020\u00a0]/g;
      let match: RegExpExecArray | null;
      while ((match = spaces.exec(text)) !== null) {
        const at = pos + match.index;
        if (at < lo || at >= hi) continue;
        decorations.push(
          Decoration.inline(at, at + 1, {
            class: match[0] === "\u00a0" ? "aw-fmt-space aw-fmt-nbsp" : "aw-fmt-space",
          }),
        );
      }
      return true;
    }
    if (node.type.name === "hard_break" && pos >= lo && pos < hi) {
      // A `<br>` has no box to hang a class on (and Chromium does not paint a
      // pseudo-element on it): a zero-width widget before it carries the arrow.
      // The glyph is CSS content, so the DOM text stays the document's own.
      decorations.push(
        Decoration.widget(
          pos,
          () => {
            const arrow = document.createElement("span");
            arrow.className = "aw-fmt-break";
            arrow.setAttribute("aria-hidden", "true");
            return arrow;
          },
          { side: -1 },
        ),
      );
    }
    return true;
  });
  return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
}

/*
 * The decorations are a FUNCTION of (document, window, switch), not a copy kept
 * in plugin state: opening a document replaces the whole EditorState (the loader
 * calls `updateState`), and a state copy would be born empty and stay empty
 * until the next edit. Here every redraw asks for the current answer.
 */
let cacheDoc: EditorState["doc"] | null = null;
let cacheFrom = -1;
let cacheTo = -1;
let cacheOn = false;
let cacheSet: DecorationSet = DecorationSet.empty;

function decorationsFor(state: EditorState): DecorationSet {
  if (!marksOn) return DecorationSet.empty;
  if (cacheOn && cacheDoc === state.doc && cacheFrom === windowFrom && cacheTo === windowTo) {
    return cacheSet;
  }
  cacheDoc = state.doc;
  cacheFrom = windowFrom;
  cacheTo = windowTo;
  cacheOn = true;
  cacheSet = build(state, windowFrom, windowTo);
  return cacheSet;
}

/**
 * The document positions the screen is showing, with one screen of slack so a
 * short scroll does not rebuild. Coordinates are client pixels: #editor is the
 * scroll container, and the page may be magnified by the zoom transform.
 */
function visibleRange(view: EditorView): { from: number; to: number } | null {
  const host = view.dom.closest("#editor") as HTMLElement | null;
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  const page = view.dom.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const left = Math.min(
    Math.max(Math.min(rect.left + rect.width / 2, page.left + page.width / 2), 0),
    window.innerWidth - 1,
  );
  const topY = Math.max(rect.top + 8, page.top + 4);
  const bottomY = Math.min(rect.bottom - 8, page.bottom - 4);
  if (bottomY <= topY) return null;
  // The strip above the sheet belongs to the scroll area, not to the page: a
  // point that lands there has no position (posAtCoords answers null). Walk
  // inward a little before giving up.
  let top = view.posAtCoords({ left, top: topY });
  let bottom = view.posAtCoords({ left, top: bottomY });
  for (let dy = 12; dy <= 180 && !top; dy += 12) {
    top = view.posAtCoords({ left, top: Math.min(topY + dy, bottomY) });
  }
  for (let dy = 12; dy <= 180 && !bottom; dy += 12) {
    bottom = view.posAtCoords({ left, top: Math.max(bottomY - dy, topY) });
  }
  if (!top || !bottom) return null;
  const first = Math.min(top.pos, bottom.pos);
  const last = Math.max(top.pos, bottom.pos);
  const slack = Math.max(1500, Math.round((last - first) * 0.75));
  return { from: first - slack, to: last + slack };
}

function scheduleRefresh(view: EditorView): void {
  if (!marksOn || refreshScheduled) return;
  refreshScheduled = requestAnimationFrame(() => {
    refreshScheduled = 0;
    refresh(view);
  });
}

/** Move the window if the screen shows text the current one does not cover, or
 *  if the window has grown far past what the screen needs. */
function refresh(view: EditorView): void {
  if (!marksOn || !view.dom.isConnected) return;
  const range = visibleRange(view);
  if (!range) return;
  const contained = range.from >= windowFrom && range.to <= windowTo;
  const oversized = windowTo - windowFrom > (range.to - range.from) * 2.5;
  if (contained && !oversized) return;
  windowFrom = range.from;
  windowTo = range.to;
  view.dispatch(view.state.tr.setMeta(marksPluginKey, "window"));
}

function syncButton(): void {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;
  button.classList.toggle("toolbar__btn--active", marksOn);
  button.setAttribute("aria-pressed", marksOn ? "true" : "false");
}

export function applyFormattingMarks(view: EditorView): void {
  view.dom.classList.toggle(ROOT_CLASS, marksOn);
  syncButton();
  if (marksOn) scheduleRefresh(view);
}

export function setFormattingMarks(view: EditorView, on: boolean): void {
  marksOn = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // A webview without storage still shows the marks: the setting just does not survive.
  }
  view.dom.classList.toggle(ROOT_CLASS, on);
  syncButton();
  view.dispatch(view.state.tr.setMeta(marksPluginKey, "toggle"));
  if (on) scheduleRefresh(view);
}

export function toggleFormattingMarks(view: EditorView): void {
  setFormattingMarks(view, !marksOn);
}

/** The commands: the Marks button of the first bar and Word's Ctrl+Shift+8. */
export function setupFormattingMarks(view: EditorView): void {
  applyFormattingMarks(view);
  document.getElementById(BUTTON_ID)?.addEventListener("click", () => {
    toggleFormattingMarks(view);
  });
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.key !== "8" && e.code !== "Digit8") return;
    e.preventDefault();
    toggleFormattingMarks(view);
  });
}

export function createFormattingMarksPlugin(): Plugin {
  return new Plugin({
    key: marksPluginKey,
    props: {
      decorations(state) {
        return decorationsFor(state);
      },
    },
    view(editorView) {
      const host = editorView.dom.closest("#editor") as HTMLElement | null;
      const onScroll = (): void => scheduleRefresh(editorView);
      const onResize = (): void => scheduleRefresh(editorView);
      host?.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      scheduleRefresh(editorView);
      return {
        update() {
          scheduleRefresh(editorView);
        },
        destroy() {
          host?.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onResize);
          if (refreshScheduled) {
            cancelAnimationFrame(refreshScheduled);
            refreshScheduled = 0;
          }
        },
      };
    },
  });
}