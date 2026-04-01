import type { EditorView } from "prosemirror-view";

export function findTextInDoc(
  view: EditorView,
  text: string,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (result) return false;
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        result = { from: pos + idx, to: pos + idx + text.length };
        return false;
      }
    }
  });
  return result;
}
