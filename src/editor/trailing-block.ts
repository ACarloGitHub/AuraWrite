// ============================================================================
// Trailing block — a document may not end with a table.
//
// A table is isolating: with nothing after it there is no place to put the caret,
// so the user cannot click below it, cannot type past it and cannot add a
// paragraph after it. Both word processors keep an empty paragraph there (and
// EdenText's `trailingNode` does the same, for tables, boxes and columns).
//
// It is added after the fact rather than created with the table, so a document
// that arrives without it is repaired too, and so deleting it puts it back.
// ============================================================================

import { Plugin, PluginKey } from "prosemirror-state";

export function createTrailingBlockPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("trailingBlock"),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const last = newState.doc.lastChild;
      if (!last || last.type.name !== "table") return null;

      const paragraph = newState.schema.nodes.paragraph;
      if (!paragraph) return null;

      return newState.tr.insert(newState.doc.content.size, paragraph.create());
    },
  });
}
