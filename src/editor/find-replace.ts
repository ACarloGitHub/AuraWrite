/**
 * Find & Replace — the Word contract (catalogo-strumenti, ELEMENTI):
 *  - case sensitive, WHOLE WORD, REGULAR EXPRESSION: three toggles, one engine;
 *  - a match crosses formatting runs: "parola" written half bold half plain is
 *    still one word, so the search reads the BLOCK's text, not each run's;
 *  - a manual line break (hard_break) separates: no match jumps over it;
 *  - regex replacement understands $1, $& (JS semantics, stated in the title);
 *  - an invalid regex says so in the count, it does not throw and it does not
 *    silently search for nothing.
 * The pure matcher (compileFindMatcher) is exported: the module-level proof
 * (Tests/.../prova_ricerca.mjs) exercises it without opening the program.
 */
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

const findPluginKey = new PluginKey("findReplace");

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

interface FindResult {
  from: number;
  to: number;
  /** The matched text, kept for the regex replacement ($1, $&). */
  text: string;
}

interface FindState extends FindOptions {
  query: string;
  results: FindResult[];
  activeIndex: number;
  regexError: string | null;
}

let findState: FindState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  results: [],
  activeIndex: -1,
  regexError: null,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The one matcher. Whole word uses Unicode lookarounds (a letter or a digit
 * or an underscore beside the match disqualifies it — Word's rule, extended
 * to every alphabet). Returns the error instead of throwing: the bar shows it.
 */
export function compileFindMatcher(
  query: string,
  opts: FindOptions,
): { re: RegExp | null; error: string | null } {
  if (!query) return { re: null, error: null };
  let source = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }
  const flags = "gu" + (opts.caseSensitive ? "" : "i");
  try {
    return { re: new RegExp(source, flags), error: null };
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One text run of a block: where its text sits in the block, where in the doc. */
interface RunMap {
  at: number;
  pos: number;
  len: number;
}

/** Block-text offset -> document position; null when it lands on a separator. */
function offsetToPos(map: RunMap[], off: number): number | null {
  for (const r of map) {
    if (off >= r.at && off <= r.at + r.len) return r.pos + (off - r.at);
  }
  return null;
}

export function searchInDoc(doc: PMNode, query: string, opts: FindOptions): FindResult[] {
  const { re, error } = compileFindMatcher(query, opts);
  findState.regexError = error;
  if (!re) return [];
  const results: FindResult[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The block's own text, runs glued back together: a word split by a bold
    // mark is one word again. Anything that is not text (a hard break) is a
    // separator character no plain query contains.
    let text = "";
    const map: RunMap[] = [];
    let cursor = pos + 1;
    node.forEach((child) => {
      if (child.isText) {
        map.push({ at: text.length, pos: cursor, len: child.nodeSize });
        text += child.text || "";
      } else {
        text += "\n";
      }
      cursor += child.nodeSize;
    });
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++; // a regex that matches the empty string: step, never loop
        continue;
      }
      const from = offsetToPos(map, m.index);
      const to = offsetToPos(map, m.index + m[0].length);
      if (from !== null && to !== null && to > from) {
        results.push({ from, to, text: m[0] });
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    return false; // the block is done; its runs were read above
  });

  return results;
}

function buildDecorations(
  doc: PMNode,
  results: FindResult[],
  activeIndex: number,
): DecorationSet {
  const decorations: Decoration[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.from >= doc.content.size || r.to > doc.content.size) continue;
    const className = i === activeIndex ? "find-highlight-active" : "find-highlight";
    decorations.push(Decoration.inline(r.from, r.to, { class: className }));
  }
  return DecorationSet.create(doc, decorations);
}

export const findReplacePlugin = new Plugin({
  key: findPluginKey,
  state: {
    init() {
      return DecorationSet.empty;
    },
    apply(tr, prev, _oldState, newState) {
      if (!findState.query) {
        findState.results = [];
        findState.activeIndex = -1;
        return DecorationSet.empty;
      }

      findState.results = searchInDoc(newState.doc, findState.query, findState);
      if (findState.activeIndex >= findState.results.length) {
        findState.activeIndex = findState.results.length > 0 ? 0 : -1;
      }

      return buildDecorations(newState.doc, findState.results, findState.activeIndex);
    },
  },
  props: {
    decorations(state) {
      return findPluginKey.getState(state) || DecorationSet.empty;
    },
  },
});

export function setFindQuery(query: string, view: EditorView): void {
  findState.query = query;
  findState.activeIndex = query ? 0 : -1;
  triggerUpdate(view);
  updateFindCount();
}

/** The three toggles. Re-runs the current query with the new rule. */
export function setFindOptions(view: EditorView, opts: Partial<FindOptions>): void {
  Object.assign(findState, opts);
  findState.activeIndex = findState.query ? 0 : -1;
  triggerUpdate(view);
  updateFindCount();
}

export function getFindState(): Readonly<FindState> {
  return findState;
}

export function goToFirstMatch(view: EditorView, focusEditor = true): void {
  if (findState.results.length === 0) return;
  findState.activeIndex = 0;
  selectActiveResult(view, focusEditor);
  triggerUpdate(view);
  updateFindCount();
}

export function findNext(view: EditorView, focusEditor = false): void {
  if (findState.results.length === 0) return;
  findState.activeIndex = (findState.activeIndex + 1) % findState.results.length;
  selectActiveResult(view, focusEditor);
  triggerUpdate(view);
  updateFindCount();
}

export function findPrev(view: EditorView, focusEditor = false): void {
  if (findState.results.length === 0) return;
  findState.activeIndex =
    (findState.activeIndex - 1 + findState.results.length) %
    findState.results.length;
  selectActiveResult(view, focusEditor);
  triggerUpdate(view);
  updateFindCount();
}

function selectActiveResult(view: EditorView, focusEditor = false): void {
  const r = findState.results[findState.activeIndex];
  if (!r) return;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, r.from, r.to))
      .scrollIntoView(),
  );
  if (focusEditor) {
    view.focus();
  }
}

/**
 * What a match becomes. Plain search: the replacement is literal. Regex: the
 * match is run through String.replace, so $1..$9 and $& mean what they mean
 * in JavaScript (the toggle's title says it).
 */
function expandedReplacement(r: FindResult, replacement: string, reNoG: RegExp | null): string {
  if (!findState.regex || !reNoG) return replacement;
  return r.text.replace(reNoG, replacement);
}

function replacementMatcher(): RegExp | null {
  if (!findState.regex) return null;
  const { re } = compileFindMatcher(findState.query, findState);
  if (!re) return null;
  return new RegExp(re.source, re.flags.replace("g", ""));
}

export function replaceOne(view: EditorView, replacement: string): void {
  if (findState.results.length === 0 || findState.activeIndex < 0) return;
  const r = findState.results[findState.activeIndex];
  const reNoG = replacementMatcher();
  const testo = expandedReplacement(r, replacement, reNoG);
  const tr = view.state.tr.replaceWith(r.from, r.to, view.state.schema.text(testo));
  view.dispatch(tr);

  findState.results = searchInDoc(view.state.doc, findState.query, findState);

  if (findState.results.length === 0) {
    findState.activeIndex = -1;
  } else {
    let nextIndex = -1;
    const replacedEnd = r.from + testo.length;
    for (let i = 0; i < findState.results.length; i++) {
      const res = findState.results[i];
      if (res.from >= replacedEnd) {
        nextIndex = i;
        break;
      }
    }
    if (nextIndex === -1) nextIndex = 0;
    findState.activeIndex = nextIndex;
    selectActiveResult(view, true);
  }
  triggerUpdate(view);
  updateFindCount();
}

export function replaceAll(view: EditorView, replacement: string): void {
  if (findState.results.length === 0) return;
  const reNoG = replacementMatcher();
  let tr = view.state.tr;
  const results = [...findState.results].sort((a, b) => b.from - a.from);
  for (const r of results) {
    tr = tr.replaceWith(r.from, r.to, view.state.schema.text(expandedReplacement(r, replacement, reNoG)));
  }
  view.dispatch(tr);
  findState.query = "";
  findState.results = [];
  findState.activeIndex = -1;
  triggerUpdate(view);
  updateFindCount();
  view.focus();
}

export function clearFind(view: EditorView): void {
  findState.query = "";
  findState.results = [];
  findState.activeIndex = -1;
  findState.regexError = null;
  triggerUpdate(view);
  updateFindCount();
}

function triggerUpdate(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, { findUpdate: true }));
}

function updateFindCount(): void {
  const el = document.getElementById("find-count");
  const input = document.getElementById("find-input");
  if (input) input.classList.toggle("find-bar__input--invalid", !!findState.regexError);
  if (!el) return;
  if (findState.regexError) {
    el.textContent = "Regex?";
    el.title = findState.regexError;
    return;
  }
  el.title = "";
  if (findState.results.length === 0) {
    el.textContent = findState.query ? "No results" : "";
  } else {
    el.textContent = `${findState.activeIndex + 1}/${findState.results.length}`;
  }
}
