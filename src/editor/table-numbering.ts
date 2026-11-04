// ============================================================================
// «Tabella 1, Tabella 2, …» — the number of a table's title.
//
// The title above a table is an ordinary paragraph marked `tableCaption: "title"`
// (table-menu.ts, `ensureCaption`). Its number is NOT kept in an attribute: it is
// the first words of the paragraph, and this plugin is the only hand that writes
// them. That is what keeps the whole program in agreement for free — the page
// count measures it, the print sheet draws it and Word receives it, because it is
// text like the rest of the title. A number that is drawn but not measured would
// be a line the paper does not have.
//
// The writer never types it: the plugin adds it to a new title and renumbers the
// titles whenever a table is added, removed or moved, touching only the leading
// words — the title's own text is left as written.
// ============================================================================

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";

/** «Tabella N» for every title paragraph, in document order. */
export interface TableTitleNumber {
  /** Position of the title paragraph. */
  pos: number;
  number: number;
}

/**
 * The numbers the titles should carry: one per table that has a title above it,
 * counted in document order. A table without a title is not numbered (as in Word:
 * the counter counts captions, not tables).
 */
export function tableTitleNumbers(doc: PMNode): TableTitleNumber[] {
  const numbers: TableTitleNumber[] = [];
  let counter = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    const before = doc.resolve(pos).nodeBefore;
    if (before && before.type.name === "paragraph" && before.attrs.tableCaption === "title") {
      numbers.push({ pos: pos - before.nodeSize, number: ++counter });
    }
    // Dentro una tabella non c'è un altro titolo da numerare: non si scende.
    return false;
  });
  return numbers;
}

/** The leading «Tabella N» of a title, if it is there. */
const LEADING_NUMBER = /^Tabella\s+\d+(?:\s*[—–-]\s*|\s+)?/;

/**
 * What the beginning of the title should say: the number, then the dash that
 * separates it from the words — but only when there are words after it.
 */
function desiredPrefix(number: number, words: string): string {
  return words.length > 0 ? `Tabella ${number} — ` : `Tabella ${number}`;
}

/** The title's words with the number taken off the front. */
function wordsOf(text: string): string {
  return text.replace(LEADING_NUMBER, "");
}

/** Write the numbers the titles are missing or carrying wrong. */
export function applyTableNumbers(doc: PMNode, tr: Transaction): boolean {
  const numbers = tableTitleNumbers(doc);
  const numbered = new Set(numbers.map((entry) => entry.pos));
  // Every change to a title is local — take the old number off its front, put the
  // right one on — so they are collected first and applied from the END of the
  // document backwards: a change never moves the position of a title before it.
  const edits: { pos: number; cut: number; insert: string }[] = [];

  for (const { pos, number } of numbers) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    const text = node.textContent;
    const prefix = desiredPrefix(number, wordsOf(text));
    if (text.startsWith(prefix)) continue;
    const match = LEADING_NUMBER.exec(text);
    edits.push({ pos, cut: match ? match[0].length : 0, insert: prefix });
  }

  // A title whose table has gone is no title any more: it keeps its words and
  // loses the number, so the rest of the document does not inherit a ghost.
  doc.descendants((node, pos) => {
    if (node.isText || node.type.name === "table") return false;
    if (node.type.name !== "paragraph" || node.attrs.tableCaption !== "title") return true;
    if (numbered.has(pos)) return true;
    const match = LEADING_NUMBER.exec(node.textContent);
    if (match) edits.push({ pos, cut: match[0].length, insert: "" });
    return false;
  });

  edits.sort((a, b) => b.pos - a.pos);
  for (const { pos, cut, insert } of edits) {
    if (cut > 0) tr.replaceWith(pos + 1, pos + 1 + cut, []);
    if (insert) tr.insertText(insert, pos + 1);
  }
  return edits.length > 0;
}

/**
 * Keeps the numbers in step: after any change to the document (a table added,
 * removed or moved, a title written or deleted) the titles get the number they
 * should carry. It writes only when the beginning differs, so a second pass does
 * nothing and there is no loop.
 */
export function createTableNumberingPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("tableNumbering"),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = state.tr;
      return applyTableNumbers(state.doc, tr) ? tr : null;
    },
  });
}
