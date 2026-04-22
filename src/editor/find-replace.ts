import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

const findPluginKey = new PluginKey("findReplace");

interface FindResult {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  caseSensitive: boolean;
  results: FindResult[];
  activeIndex: number;
}

let findState: FindState = {
  query: "",
  caseSensitive: false,
  results: [],
  activeIndex: -1,
};

function searchInDoc(doc: PMNode, query: string, caseSensitive: boolean): FindResult[] {
  if (!query) return [];
  const results: FindResult[] = [];
  const searchStr = caseSensitive ? query : query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text!;
    const searchIn = caseSensitive ? text : text.toLowerCase();
    let offset = 0;
    while (offset < searchIn.length) {
      const idx = searchIn.indexOf(searchStr, offset);
      if (idx === -1) break;
      results.push({ from: pos + idx, to: pos + idx + query.length });
      offset = idx + 1;
    }
    return true;
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

      findState.results = searchInDoc(newState.doc, findState.query, findState.caseSensitive);
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

export function findNext(view: EditorView): void {
  if (findState.results.length === 0) return;
  findState.activeIndex = (findState.activeIndex + 1) % findState.results.length;
  selectActiveResult(view);
  triggerUpdate(view);
  updateFindCount();
}

export function findPrev(view: EditorView): void {
  if (findState.results.length === 0) return;
  findState.activeIndex =
    (findState.activeIndex - 1 + findState.results.length) %
    findState.results.length;
  selectActiveResult(view);
  triggerUpdate(view);
  updateFindCount();
}

function selectActiveResult(view: EditorView): void {
  const r = findState.results[findState.activeIndex];
  if (!r) return;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, r.from, r.to)),
  );
  view.focus();
}

export function replaceOne(view: EditorView, replacement: string): void {
  if (findState.results.length === 0 || findState.activeIndex < 0) return;
  const r = findState.results[findState.activeIndex];
  const replacedFrom = r.from;
  const replacedLen = r.to - r.from;
  const newLen = replacement.length;
  const diff = newLen - replacedLen;

  const tr = view.state.tr.replaceWith(r.from, r.to, view.state.schema.text(replacement));
  view.dispatch(tr);

  findState.results = searchInDoc(view.state.doc, findState.query, findState.caseSensitive);
  
  if (findState.results.length === 0) {
    findState.activeIndex = -1;
  } else {
    let nextIndex = -1;
    for (let i = 0; i < findState.results.length; i++) {
      const res = findState.results[i];
      if (res.from >= replacedFrom + newLen) {
        nextIndex = i;
        break;
      }
    }
    if (nextIndex === -1) nextIndex = 0;
    findState.activeIndex = nextIndex;
    selectActiveResult(view);
  }
  triggerUpdate(view);
  updateFindCount();
}

export function replaceAll(view: EditorView, replacement: string): void {
  if (findState.results.length === 0) return;
  let tr = view.state.tr;
  const results = [...findState.results].sort((a, b) => b.from - a.from);
  for (const r of results) {
    tr = tr.replaceWith(r.from, r.to, view.state.schema.text(replacement));
  }
  view.dispatch(tr);
  findState.query = "";
  findState.results = [];
  findState.activeIndex = -1;
  triggerUpdate(view);
  updateFindCount();
}

export function clearFind(view: EditorView): void {
  findState.query = "";
  findState.results = [];
  findState.activeIndex = -1;
  triggerUpdate(view);
  updateFindCount();
}

function triggerUpdate(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(findPluginKey, { findUpdate: true }));
}

function updateFindCount(): void {
  const el = document.getElementById("find-count");
  if (!el) return;
  if (findState.results.length === 0) {
    el.textContent = findState.query ? "No results" : "";
  } else {
    el.textContent = `${findState.activeIndex + 1}/${findState.results.length}`;
  }
}