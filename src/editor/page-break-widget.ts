import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const pageBreakPluginKey = new PluginKey("pageBreakPlugin");

export const pageBreakPlugin = new Plugin({
  key: pageBreakPluginKey,
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];

      state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.attrs.pageBreakBefore) {
          // Create a widget decoration before the paragraph
          decorations.push(
            Decoration.widget(
              pos,
              (view) => {
                const wrapper = document.createElement("div");
                wrapper.className = "page-break-widget";

                const label = document.createElement("span");
                label.className = "page-break-label";
                label.textContent = "⏎ Nuova Pagina";
                wrapper.appendChild(label);

                const removeBtn = document.createElement("button");
                removeBtn.className = "page-break-remove";
                removeBtn.textContent = "×";
                removeBtn.title = "Rimuovi page break";
                removeBtn.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removePageBreak(view, pos);
                });
                wrapper.appendChild(removeBtn);

                return wrapper;
              },
              {
                side: -1,
                key: `pageBreak-${pos}`,
              },
            ),
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});

function removePageBreak(view: EditorView, pos: number): void {
  const { state } = view;
  const node = state.doc.nodeAt(pos);

  if (!node || node.type.name !== "paragraph") return;

  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    pageBreakBefore: false,
  });

  view.dispatch(tr);
}
