// ============================================================================
// Row height — drag the line under a row, the way a column border is dragged.
//
// The height is a MINIMUM (Word's `w:trHeight` with "at least"): the row grows when
// its cells need more room, and asking for less never squeezes the text. The value
// lives on the row (`rowHeight`, px) so it survives saving, and it is drawn as the
// row's CSS height. EdenText's `tableRowResize` has the same semantics.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";

/** How close to the row's bottom edge the pointer has to be to grab it. */
const EDGE_PX = 5;
/** A row cannot be dragged shorter than this; below it the cells are not usable. */
const MIN_ROW_PX = 18;

interface Drag {
  view: EditorView;
  rowPos: number;
  startY: number;
  startHeight: number;
}

/** The row node under a `<tr>`, and its position in the document. */
function rowInfo(view: EditorView, row: HTMLTableRowElement): { pos: number; node: PMNode } | null {
  let start: number;
  try {
    start = view.posAtDOM(row, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(start);
  const node = $pos.parent;
  if (!node || node.type.name !== "table_row") return null;
  return { pos: $pos.before(), node };
}

export function createRowHeightPlugin(): Plugin {
  let drag: Drag | null = null;

  const onMove = (event: MouseEvent): void => {
    if (!drag) return;
    event.preventDefault();
    const wanted = Math.round(drag.startHeight + (event.clientY - drag.startY));
    const height = Math.max(MIN_ROW_PX, wanted);
    const { view } = drag;
    const { state } = view;
    const node = state.doc.nodeAt(drag.rowPos);
    if (!node || node.type.name !== "table_row") return;
    if (node.attrs.rowHeight === height) return;
    view.dispatch(state.tr.setNodeMarkup(drag.rowPos, undefined, { ...node.attrs, rowHeight: height }));
  };

  const onUp = (): void => {
    drag = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  return new Plugin({
    key: new PluginKey("tableRowHeight"),
    props: {
      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement | null;
          const row = target?.closest("tr") as HTMLTableRowElement | null;
          if (!row) return false;
          const rect = row.getBoundingClientRect();
          if (Math.abs(event.clientY - rect.bottom) > EDGE_PX) return false;

          const info = rowInfo(view, row);
          if (!info) return false;

          drag = { view, rowPos: info.pos, startY: event.clientY, startHeight: Math.round(rect.height) };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          event.preventDefault();
          return true;
        },

        // The pointer says what the line does, before anything is clicked.
        mousemove(view: EditorView, event: MouseEvent) {
          if (drag) return false;
          const target = event.target as HTMLElement | null;
          const row = target?.closest("tr") as HTMLTableRowElement | null;
          const near = !!row && Math.abs(event.clientY - row.getBoundingClientRect().bottom) <= EDGE_PX;
          const wanted = near ? "row-resize" : "";
          if (view.dom.style.cursor !== wanted) view.dom.style.cursor = wanted;
          return false;
        },
      },
    },
  });
}
