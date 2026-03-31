import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const selectionHighlightPluginKey = new PluginKey("selectionHighlight");

export const selectionHighlightPlugin = new Plugin({
  key: selectionHighlightPluginKey,
  state: {
    init(): DecorationSet {
      return DecorationSet.empty;
    },
    apply(tr, set, oldState, newState): DecorationSet {
      const meta = tr.getMeta(selectionHighlightPluginKey);
      if (meta === "clear") {
        return DecorationSet.empty;
      }
      if (meta && typeof meta.from === "number") {
        const deco = Decoration.inline(meta.from, meta.to, {
          class: meta.flash ? "selection-ai flash" : "selection-ai",
        });
        return DecorationSet.create(tr.doc, [deco]);
      }
      return set.map(tr.mapping, tr.doc);
    },
  },
});
