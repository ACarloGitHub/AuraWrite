import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { calculatePageBreaks, syncEditorMetricsFromDom } from "./pagination-cassie";
import { getPagedMode, getCassiePagedMode, getMargins } from "./pagination-state";

export const cassiePaginationPluginKey = new PluginKey("cassiePagination");

function buildDecorations(
  doc: PMNode,
  cassieEnabled: boolean,
  cassiePaged: boolean,
  editorDom: HTMLElement | null,
): DecorationSet {
  if (getPagedMode()) return DecorationSet.empty;
  if (!cassieEnabled && !cassiePaged) return DecorationSet.empty;
  // R-b: measure with the SAME style the editor renders with (container
  // family/size/line-height and the cascade per node type, probed).
  syncEditorMetricsFromDom(editorDom);

  const margins = getMargins();
  const { breaks } = calculatePageBreaks(doc, margins);
  if (breaks.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = breaks.map((bp) =>
    Decoration.widget(
      bp.pos,
      () => {
        const wrap = document.createElement("div");
        wrap.className = cassiePaged ? "aw-page-break aw-page-break--paged" : "aw-page-break";
        wrap.setAttribute("data-page", String(bp.pageNumber));
        if (bp.midParagraph) wrap.setAttribute("data-mid-paragraph", "1");
        wrap.contentEditable = "false";

        if (cassiePaged) {
          const topMargin = document.createElement("div");
          topMargin.className = "aw-page-break-margin-top";
          topMargin.style.height = `${margins.bottom}px`;

          const separator = document.createElement("div");
          separator.className = "aw-page-break-separator";

          const footerArea = document.createElement("div");
          footerArea.className = "aw-page-break-footer";
          footerArea.textContent = String(bp.pageNumber);

          const headerArea = document.createElement("div");
          headerArea.className = "aw-page-break-header";
          headerArea.textContent = String(bp.pageNumber + 1);

          const bottomMargin = document.createElement("div");
          bottomMargin.className = "aw-page-break-margin-bottom";
          bottomMargin.style.height = `${margins.top}px`;

          wrap.appendChild(topMargin);
          wrap.appendChild(footerArea);
          wrap.appendChild(separator);
          wrap.appendChild(headerArea);
          wrap.appendChild(bottomMargin);
        } else {
          const topSpacer = document.createElement("div");
          topSpacer.className = "aw-page-break-spacer-top";
          topSpacer.style.height = `${margins.bottom}px`;

          const line = document.createElement("div");
          line.className = "aw-page-break-line";

          const label = document.createElement("span");
          label.className = "aw-page-break-label";
          label.textContent = `Pagina ${bp.pageNumber}`;

          const bottomSpacer = document.createElement("div");
          bottomSpacer.className = "aw-page-break-spacer-bottom";
          bottomSpacer.style.height = `${margins.top}px`;

          wrap.appendChild(topSpacer);
          wrap.appendChild(line);
          wrap.appendChild(label);
          wrap.appendChild(bottomSpacer);
        }

        return wrap;
      },
      {
        side: -1,
        ignoreSelection: true,
        key: `cassie-pb-${bp.pos}-${bp.pageNumber}`,
      },
    ),
  );

  return DecorationSet.create(doc, decorations);
}

export interface CassiePaginationOptions {
  enabled: () => boolean;
}

export function createCassiePaginationPlugin(
  options: CassiePaginationOptions,
): Plugin {
  let editorDom: HTMLElement | null = null;

  return new Plugin({
    key: cassiePaginationPluginKey,

    state: {
      init: (_, state) => buildDecorations(state.doc, options.enabled(), getCassiePagedMode(), editorDom),
      apply: (tr, old, _oldState, newState) => {
        if (tr.getMeta("force-cassie-recompute")) {
          return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
        }
        if (!tr.docChanged) return old;
        return buildDecorations(newState.doc, options.enabled(), getCassiePagedMode(), editorDom);
      },
    },

    view() {
      let dom: HTMLElement | null = null;
      const onMetricsChanged = () => {
        syncEditorMetricsFromDom(dom);
        const v = liveView;
        if (v && !v.isDestroyed) {
          v.dispatch(
            v.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
          );
        }
      };
      let liveView: import("prosemirror-view").EditorView | null = null;
      window.addEventListener("aurawrite:editor-metrics-changed", onMetricsChanged);
      return {
        update(view) {
          liveView = view;
          if (!dom) {
            dom = view.dom as HTMLElement;
            editorDom = dom;
            syncEditorMetricsFromDom(dom);
            // One refresh so a doc opened directly in a paged mode uses the
            // live metrics even before the first keystroke.
            setTimeout(() => {
              if (!view.isDestroyed) {
                view.dispatch(
                  view.state.tr.setMeta("force-cassie-recompute", true).setMeta("addToHistory", false),
                );
              }
            }, 0);
          }
        },
        destroy() {
          window.removeEventListener("aurawrite:editor-metrics-changed", onMetricsChanged);
        },
      };
    },

    props: {
      decorations(state) {
        return cassiePaginationPluginKey.getState(state) || DecorationSet.empty;
      },
    },
  });
}