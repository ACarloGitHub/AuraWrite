/**
 * Cassie-style pagination plugin for ProseMirror.
 *
 * Replaces the old DOM-measurement-based pagination plugin. The old
 * approach was broken because `scrollHeight` is asynchronous and
 * returned stale values right after a ProseMirror transaction, so
 * the rebalance made bad decisions and text "slid" to page 2 with
 * no way to come back.
 *
 * The new approach is borrowed from CassieEditor
 * (https://github.com/Cassielxd/CassieEditor): use deterministic
 * text-based measurement (see pagination-cassie.ts) to compute
 * where page breaks should go, and draw them as widget decorations.
 * No DOM nodes are created, no document mutations happen, the
 * schema stays flat (block+), and the cursor is never trapped.
 *
 * The plugin is opt-in: it only adds decorations when the user has
 * enabled "Auto Page Breaks" mode (the "modalità 2" of the design
 * agreed on 2026-06-13). When the user has not enabled it, the
 * plugin returns an empty decoration set, so there is no visible
 * effect on the document.
 *
 * Limitations (acknowledged, see wiki):
 *
 * - The measurement is an approximation. Inline images, tables,
 *   and complex marks are not accounted for.
 * - The split is between blocks, not mid-paragraph. A single
 *   paragraph taller than one page will be moved entirely to the
 *   next page; the previous page has empty space at the bottom.
 *   Mid-paragraph split is a future, separate step.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { calculatePageBreaks } from "./pagination-cassie";
import { getPagedMode } from "./pagination-state";

export const cassiePaginationPluginKey = new PluginKey("cassiePagination");

function buildDecorations(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  if (getPagedMode()) return DecorationSet.empty;
  const { breaks } = calculatePageBreaks(doc);
  if (breaks.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = breaks.map((bp) =>
    Decoration.widget(
      bp.pos,
      () => {
        const wrap = document.createElement("div");
        wrap.className = "aw-page-break";
        wrap.setAttribute("data-page", String(bp.pageNumber));
        wrap.contentEditable = "false";

        const line = document.createElement("div");
        line.className = "aw-page-break-line";

        const label = document.createElement("span");
        label.className = "aw-page-break-label";
        label.textContent = `Pagina ${bp.pageNumber}`;

        wrap.appendChild(line);
        wrap.appendChild(label);
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
  return new Plugin({
    key: cassiePaginationPluginKey,

    state: {
      init: (_, state) => buildDecorations(state.doc, options.enabled()),
      apply: (tr, old, _oldState, newState) => {
        if (tr.getMeta("force-cassie-recompute")) {
          return buildDecorations(newState.doc, options.enabled());
        }
        if (!tr.docChanged) return old;
        return buildDecorations(newState.doc, options.enabled());
      },
    },

    props: {
      decorations(state) {
        return cassiePaginationPluginKey.getState(state) || DecorationSet.empty;
      },
    },
  });
}
