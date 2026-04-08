import type { EditorView } from "prosemirror-view";

export function findTextInDoc(
  view: EditorView,
  text: string,
): { from: number; to: number } | null {
  if (!text || text.length === 0) return null;

  const doc = view.state.doc;

  let result: { from: number; to: number } | null = null;

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (result) return false;
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        result = { from: pos + idx, to: pos + idx + text.length };
        return false;
      }
    }
  });

  if (result) return result;

  const fullText = doc.textContent;
  const charIdx = fullText.indexOf(text);

  if (charIdx === -1) return null;

  let currentChar = 0;
  let from: number | null = null;
  let to: number | null = null;

  doc.descendants((node, pos) => {
    if (from !== null && to !== null) return false;

    if (node.isText && node.text) {
      const startChar = currentChar;
      const endChar = currentChar + node.text.length;

      if (from === null && charIdx >= startChar && charIdx < endChar) {
        const offsetInNode = charIdx - startChar;
        from = pos + offsetInNode;
      }

      if (from !== null && to === null) {
        const targetEndChar = charIdx + text.length;
        if (targetEndChar <= endChar) {
          const offsetInNode = targetEndChar - startChar;
          to = pos + offsetInNode;
        }
      }

      currentChar = endChar;
    }
  });

  if (from !== null && to !== null) {
    return { from, to };
  }

  return null;
}

export function charPosToProseMirror(
  view: EditorView,
  charIndex: number,
): number | null {
  const doc = view.state.doc;
  let currentChar = 0;

  let result: number | null = null;

  doc.descendants((node, pos) => {
    if (result !== null) return false;

    if (node.isText && node.text) {
      const startChar = currentChar;
      const endChar = currentChar + node.text.length;

      if (charIndex >= startChar && charIndex < endChar) {
        const offsetInNode = charIndex - startChar;
        result = pos + offsetInNode;
      }

      currentChar = endChar;
    }
  });

  return result;
}
