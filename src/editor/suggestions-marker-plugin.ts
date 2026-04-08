import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const suggestionsMarkerPluginKey = new PluginKey("suggestionsMarkers");

export interface SuggestionDecoration {
  id: string;
  from: number;
  to: number;
}

export const suggestionsMarkerPlugin = new Plugin({
  key: suggestionsMarkerPluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => {
      set = set.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(suggestionsMarkerPluginKey);
      if (meta?.add) {
        set = set.add(tr.doc, meta.add);
      }
      if (meta?.remove) {
        set = set.remove(meta.remove);
      }
      return set;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

export function getPositionForSlot(
  state: any,
  slotId: string,
): { from: number; to: number } | null {
  const decorations = suggestionsMarkerPluginKey.getState(state);
  if (!decorations) return null;

  const found = decorations.find(null, null, (spec: any) => spec.id === slotId);
  if (found.length > 0) {
    return { from: found[0].from, to: found[0].to };
  }
  return null;
}

export function createSuggestionDecoration(
  slotId: string,
  from: number,
  to: number,
): Decoration {
  return Decoration.inline(
    from,
    to,
    {
      class: "suggestion-marker",
      "data-slot-id": slotId,
    },
    {
      id: slotId,
    },
  );
}

export function removeSuggestionDecorations(
  tr: any,
  slotIds: string[],
): { tr: any; removed: Decoration[] } {
  const decorations = suggestionsMarkerPluginKey.getState(tr.state);
  if (!decorations) return { tr, removed: [] };

  const toRemove: Decoration[] = [];
  for (const slotId of slotIds) {
    const found = decorations.find(
      null,
      null,
      (spec: any) => spec.id === slotId,
    );
    toRemove.push(...found);
  }

  if (toRemove.length > 0) {
    tr = tr.setMeta(suggestionsMarkerPluginKey, { remove: toRemove });
  }

  return { tr, removed: toRemove };
}
