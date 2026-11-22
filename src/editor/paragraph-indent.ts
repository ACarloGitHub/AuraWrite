/**
 * E2 — paragraph indents: left, right, first line (the Word `w:ind` trio).
 *
 * Values in cm (Word's dialog unit), null = no indent. The first line is
 * SIGNED: negative = hanging (sporgente), the first line starts left of the
 * block's other lines, as in Word and as CSS text-indent draws it.
 *
 * The screen renders margin-left/right + text-indent (inline variables
 * --aw-il/--aw-ir/--aw-if, 05-document.css). The calculator shortens the
 * lines by the same numbers: a float's intrusion is counted only for the
 * part that reaches past the indent (a left indent can clear a left float),
 * and the first line alone carries the first-line indent. A paragraph with
 * a first-line indent is measured line by line (the mixed lane), because
 * its first line is not as wide as the others.
 *
 * Scope, like E1: flow paragraphs/headings and table cells. Lists indent by
 * nesting, not by this attribute (their measurement is one text flow).
 */
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";

export const CM_TO_PX = 96 / 2.54;
/** Word counts twentieths of a point: 1440 twips per inch, 2.54 cm per inch. */
export const CM_TO_TWIP = 1440 / 2.54;

export interface LineIndent {
  left: number;
  right: number;
  first: number;
}

const NO_INDENT: LineIndent = { left: 0, right: 0, first: 0 };

/** The node's indent in px; zero when it carries none. */
export function lineIndentOf(node: PMNode): LineIndent {
  const a = node.attrs ?? {};
  const l = Number(a.indentLeft);
  const r = Number(a.indentRight);
  const f = Number(a.indentFirst);
  const left = Number.isFinite(l) && l > 0 ? l * CM_TO_PX : 0;
  const right = Number.isFinite(r) && r > 0 ? r * CM_TO_PX : 0;
  const first = Number.isFinite(f) ? f * CM_TO_PX : 0;
  if (!left && !right && !first) return NO_INDENT;
  return { left, right, first };
}

/** Read a cm attribute from markup (export, paste, DOCX import). */
export function parseIndentCm(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const isTextBlock = (name: string): boolean => name === "paragraph" || name === "heading";
const measuredParent = (name: string): boolean =>
  name === "doc" || name === "table_cell" || name === "table_header";

export type IndentField = "indentLeft" | "indentRight" | "indentFirst";

/** Apply one field to the selection's blocks (caret: its block), as E1 does. */
export function setParagraphIndent(
  view: EditorView,
  field: IndentField,
  cm: number | null,
): void {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  let changed = false;
  const set = (node: PMNode, pos: number): void => {
    if (node.attrs[field] !== cm) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [field]: cm });
      changed = true;
    }
  };
  if (empty) {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (isTextBlock(node.type.name)) {
        if (measuredParent($from.node(d - 1).type.name)) set(node, $from.before(d));
        break;
      }
    }
  } else {
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (isTextBlock(node.type.name)) {
        if (parent && measuredParent(parent.type.name)) set(node, pos);
        return false;
      }
      return true;
    });
  }
  if (changed) view.dispatch(tr);
}

function shownBlock(view: EditorView): PMNode | null {
  let { $from } = view.state.selection;
  if ($from.depth === 0) {
    const pos = Math.min(view.state.selection.from + 1, view.state.doc.content.size);
    $from = view.state.doc.resolve(pos);
  }
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isTextBlock(node.type.name)) return node;
  }
  return null;
}

const FIELD_IDS: Array<{ id: string; field: IndentField }> = [
  { id: "inp-indent-left", field: "indentLeft" },
  { id: "inp-indent-right", field: "indentRight" },
  { id: "inp-indent-first", field: "indentFirst" },
];

/** The fields say what the shown block carries; empty means no indent. */
export function syncParagraphIndentInputs(view: EditorView): void {
  const node = shownBlock(view);
  for (const { id, field } of FIELD_IDS) {
    const inp = document.getElementById(id) as HTMLInputElement | null;
    if (!inp) continue;
    const v = node?.attrs?.[field];
    const text = typeof v === "number" ? String(v) : "";
    if (document.activeElement !== inp && inp.value !== text) inp.value = text;
  }
}

/** Wire the three fields of the Paragraph panel (shared with the spacing). */
export function setupParagraphIndent(getView: () => EditorView | null): void {
  for (const { id, field } of FIELD_IDS) {
    const inp = document.getElementById(id) as HTMLInputElement | null;
    if (!inp) continue;
    inp.addEventListener("change", () => {
      const view = getView();
      if (!view) return;
      const raw = inp.value.trim();
      let cm: number | null = null;
      if (raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          // Word keeps indents inside the text column; the first line may hang.
          const lim = 12;
          cm = Math.round(Math.max(field === "indentFirst" ? -lim : 0, Math.min(lim, n)) * 100) / 100;
        }
      }
      setParagraphIndent(view, field, cm);
      view.focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      if (e.key === "Escape") {
        const view = getView();
        if (view) syncParagraphIndentInputs(view);
        view?.focus();
      }
    });
  }
}
