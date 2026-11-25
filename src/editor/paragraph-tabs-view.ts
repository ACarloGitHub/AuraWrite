/**
 * E3 — the tabulations ON SCREEN: one inline decoration per `\t`, carrying the
 * advance the page calculator computed.
 *
 * D13: the number written here comes from the same walk that decides the lines
 * (`tabAdvancesFor` in `pagination-cassie.ts`), never from the browser's own
 * layout — so the screen, the preview and the paper cannot disagree.
 *
 * The span is sized explicitly (`width: Npx`), with `tab-size: 0` in the
 * stylesheet: the tab character inside holds no width of its own, it is only
 * there so the text keeps a tabulation to cut, paste and reimport.
 */
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { getContentWidth, tabAdvancesFor } from "./pagination-cassie";
import { getMargins } from "./pagination-state";

const tabKey = new PluginKey<DecorationSet>("aw-tab-stops");

interface Cache {
  doc: EditorState["doc"] | null;
  width: number;
  set: DecorationSet;
}

const cache: Cache = { doc: null, width: -1, set: DecorationSet.empty };

function build(state: EditorState): DecorationSet {
  const width = getContentWidth(getMargins());
  if (cache.doc === state.doc && cache.width === width) return cache.set;
  const decorations: Decoration[] = [];
  state.doc.forEach((node, offset) => {
    if (!node.textContent.includes("\t")) return;
    for (const a of tabAdvancesFor(node, width, offset)) {
      const px = Math.round(a.widthPx * 100) / 100;
      const attrs: Record<string, string> = {
        class: a.leader ? "aw-tab aw-tab--leader" : "aw-tab",
        style: a.leader ? `width: ${px}px; --aw-leader-w: ${px}px` : `width: ${px}px`,
      };
      if (a.leader) attrs["data-leader"] = a.leader;
      decorations.push(Decoration.inline(a.pos, a.pos + 1, attrs));
    }
  });
  cache.doc = state.doc;
  cache.width = width;
  cache.set = decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
  return cache.set;
}

export function createTabStopsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: tabKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, old, _oldState, newState) => (tr.docChanged ? build(newState) : old),
    },
    props: {
      decorations(state) {
        return tabKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}