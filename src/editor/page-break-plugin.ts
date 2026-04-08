/**
 * Page Break Plugin — Automatic pagination based on DOM height measurement
 *
 * Based on tiptap-pagination-breaks logic:
 * https://github.com/adityayaduvanshi/tiptap-pagination-breaks
 *
 * Uses doc.descendants() which provides absolute positions directly.
 * Measures DOM height with nodeDOM(pos).offsetHeight.
 * Inserts page-break widget decorations when content exceeds page height.
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node } from "prosemirror-model";

export interface PageBreakOptions {
  pageHeight: number;
  pageWidth: number;
  pageMargin: number;
  label: string;
  showPageNumber: boolean;
}

const defaultOptions: PageBreakOptions = {
  pageHeight: 1056,
  pageWidth: 816,
  pageMargin: 96,
  label: "Page",
  showPageNumber: true,
};

const pageBreakPluginKey = new PluginKey("pageBreakAuto");

let _enabled = false;
let _currentView: EditorView | null = null;
let _recalcScheduled = false;

export function setPluginEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (_currentView) {
    scheduleRecalc();
  }
}

export function getPluginEnabled(): boolean {
  return _enabled;
}

function scheduleRecalc(): void {
  if (_recalcScheduled) return;
  _recalcScheduled = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _recalcScheduled = false;
      if (_currentView && _enabled) {
        const tr = _currentView.state.tr;
        _currentView.dispatch(tr);
      }
    });
  });
}

function calculateListItemHeight(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  return (
    element.offsetHeight + marginTop + marginBottom + paddingTop + paddingBottom
  );
}

export function createPageBreakPlugin(
  initialOptions: Partial<PageBreakOptions> = {},
) {
  const opts: PageBreakOptions = { ...defaultOptions, ...initialOptions };

  return new Plugin({
    key: pageBreakPluginKey,

    view: (view: EditorView) => {
      _currentView = view;
      return {
        update: () => {
          if (_enabled) {
            scheduleRecalc();
          }
        },
        destroy: () => {
          _currentView = null;
        },
      };
    },

    state: {
      init: () => ({ ...opts }),
      apply: (tr, prev) => {
        const newOptions = tr.getMeta("pageBreakOptions");
        return newOptions ? { ...prev, ...newOptions } : prev;
      },
    },

    props: {
      decorations: (state) => {
        if (!_currentView || !_enabled) return DecorationSet.empty;

        const options = pageBreakPluginKey.getState(state) || opts;
        const { pageHeight, pageMargin, showPageNumber, label } = options;
        const effectivePageHeight = pageHeight - 2 * pageMargin;

        const { doc } = state;
        const decorations: Decoration[] = [];
        let currentPageHeight = 0;
        let pageNumber = 1;
        let lastNodeWasList = false;
        let currentListHeight = 0;
        let listStartPos = 0;

        const createPageBreak = (pos: number): Decoration => {
          const pageNum = pageNumber++;
          return Decoration.widget(
            pos,
            () => {
              const pageBreak = document.createElement("div");
              pageBreak.className = "auto-page-break";
              pageBreak.setAttribute("data-page-number", String(pageNum));

              if (showPageNumber) {
                const indicator = document.createElement("span");
                indicator.className = "auto-page-number";
                indicator.textContent = `${label || "Page"} ${pageNum}`;
                pageBreak.appendChild(indicator);
              }

              return pageBreak;
            },
            { side: -1 },
          );
        };

        // doc.descendants passes absolute positions directly
        doc.descendants((node: Node, pos: number) => {
          if (!node.isBlock) return;

          const nodeDOM = _currentView!.nodeDOM(pos);
          if (!(nodeDOM instanceof HTMLElement)) return;

          const isList =
            node.type.name === "bulletList" || node.type.name === "orderedList";
          const isListItem = node.type.name === "listItem";

          const nodeHeight = isListItem
            ? calculateListItemHeight(nodeDOM)
            : nodeDOM.offsetHeight;

          if (nodeHeight === 0) return;

          // Handle list items as a group
          if (isList || isListItem) {
            if (!lastNodeWasList) {
              listStartPos = pos;
              currentListHeight = 0;
            }
            currentListHeight += nodeHeight;
            lastNodeWasList = true;

            const nextNode = doc.nodeAt(pos + node.nodeSize);
            const isLastListItem =
              !nextNode ||
              (nextNode.type.name !== "listItem" &&
                nextNode.type.name !== "bulletList" &&
                nextNode.type.name !== "orderedList");

            if (isLastListItem) {
              if (currentPageHeight + currentListHeight > effectivePageHeight) {
                decorations.push(createPageBreak(listStartPos));
                currentPageHeight = currentListHeight;
              } else {
                currentPageHeight += currentListHeight;
              }
              lastNodeWasList = false;
            }
            return;
          }

          // Handle non-list blocks
          lastNodeWasList = false;
          if (currentPageHeight + nodeHeight > effectivePageHeight) {
            decorations.push(createPageBreak(pos));
            currentPageHeight = nodeHeight;
          } else {
            currentPageHeight += nodeHeight;
          }
        });

        if (decorations.length === 0) return DecorationSet.empty;
        return DecorationSet.create(doc, decorations);
      },
    },
  });
}

export function setPageBreakOptions(
  view: EditorView,
  options: Partial<PageBreakOptions>,
): void {
  const tr = view.state.tr.setMeta("pageBreakOptions", options);
  view.dispatch(tr);
}

export function getPageBreakPluginKey(): PluginKey {
  return pageBreakPluginKey;
}
