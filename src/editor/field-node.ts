/**
 * E5 — the `field` node: date, time and name as ONE inline atom.
 *
 * The contract (catalogo, §2): «Un atomo che mostra un valore e si aggiorna; nel
 * formato è un campo, non testo» ([[concepts/editor-enrichment-fields]]).
 *
 * The atom carries the string it shows (`text`), never a clock read at draw time.
 * That is the whole point on this side of the program: the page calculator
 * measures the document, and a value that changes between the measure and the
 * paint is a disagreement between the editor and the paper (law D13). `value`
 * keeps the moment, so a refresh — on opening, on «Update fields», on a change
 * of language — can re-render it once, and the page is measured again once.
 *
 * Channels: HTML writes `span[data-aw-field]` (D10, read back by parseDOM);
 * DOCX writes a real `DATE`/`TIME`/`AUTHOR` field with this text as its cached
 * value. Both are handled outside this file.
 */
import type { NodeSpec, Node as PMNode } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";
import { fieldText, renderFieldValue, toIsoLocal, type FieldKind } from "./field-value";

export interface FieldAttrs {
  kind: FieldKind;
  /** Catalog key (`dmy_dots`) or a Word picture (`dd.MM.yyyy`). */
  format: string;
  /** The moment the field shows (ISO local); empty for a name, or when imported. */
  value: string;
  /** What the field shows. The ONLY source of its width, on screen and on paper. */
  text: string;
  /** Refresh the value when the document opens. */
  auto: boolean;
}

const KINDS: FieldKind[] = ["date", "time", "name"];

function readKind(raw: string | null): FieldKind {
  return KINDS.includes(raw as FieldKind) ? (raw as FieldKind) : "date";
}

/** Attrs a fresh field starts with, rendered for the given moment and language. */
export function newFieldAttrs(
  kind: FieldKind,
  format: string,
  when: Date,
  locale: string,
  name = "",
): FieldAttrs {
  const text = renderFieldValue(kind, format, when, locale, name);
  return {
    kind,
    format,
    value: kind === "name" ? name : toIsoLocal(when),
    text,
    auto: kind !== "name",
  };
}

export const FIELD_NODE_SPEC: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  attrs: {
    kind: { default: "date" },
    format: { default: "" },
    value: { default: "" },
    text: { default: "" },
    auto: { default: true },
  },
  leafText: (node) => fieldText(node.attrs as Record<string, unknown>),
  parseDOM: [
    {
      tag: "span[data-aw-field]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        return {
          kind: readKind(dom.getAttribute("data-aw-field")),
          format: dom.getAttribute("data-format") ?? "",
          value: dom.getAttribute("data-value") ?? "",
          // The shown string is the element's own text: the file says what it
          // shows, and the atom does not re-render it on the way in.
          text: dom.textContent ?? "",
          auto: dom.getAttribute("data-auto") !== "false",
        };
      },
    },
  ],
  toDOM(node) {
    const attrs = node.attrs as FieldAttrs;
    return [
      "span",
      {
        "data-aw-field": attrs.kind,
        "data-format": attrs.format,
        "data-value": attrs.value,
        "data-auto": attrs.auto ? "true" : "false",
        class: "aw-field",
      },
      fieldText(node.attrs as Record<string, unknown>),
    ];
  },
};

/**
 * The document with every automatic field re-rendered for this moment and this
 * language. A pure mapping of the doc, used when a document opens: opening is
 * not an edit, so nothing here touches the undo history or the dirty mark.
 */
export function refreshAutoFields(doc: PMNode, when: Date, locale: string): PMNode {
  const replacements: Array<{ pos: number; node: PMNode }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "field") return true;
    const attrs = node.attrs as FieldAttrs;
    if (!attrs.auto || attrs.kind === "name") return false;
    replacements.push({
      pos,
      node: node.type.create({
        ...attrs,
        value: toIsoLocal(when),
        text: renderFieldValue(attrs.kind, attrs.format, when, locale),
      }),
    });
    return false;
  });
  if (!replacements.length) return doc;
  // Positions come from the ORIGINAL doc and every replacement keeps the node's
  // size (an atom is one unit), so applying them from the end is safe.
  const tr = new Transform(doc);
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { pos, node } = replacements[i];
    tr.replaceWith(pos, pos + node.nodeSize, node);
  }
  return tr.doc;
}

/** Insert a field at the selection, wearing the marks the text around it has. */
export function insertField(view: EditorView, attrs: FieldAttrs): void {
  const node = view.state.schema.nodes.field.create(attrs);
  const marks = (view.state.storedMarks ?? view.state.selection.$to.marks()).slice();
  const tr = view.state.tr.replaceSelectionWith(node, false).scrollIntoView();
  if (marks.length) tr.ensureMarks(marks);
  view.dispatch(tr);
  view.focus();
}

/** Replace the field at `pos` with the same node wearing new attributes. */
export function updateField(view: EditorView, pos: number, patch: Partial<FieldAttrs>): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "field") return;
  const next = node.type.create({ ...node.attrs, ...patch });
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, next).scrollIntoView());
}

/** The field under the cursor, if any: what the panel edits. */
export function fieldAtSelection(view: EditorView): { pos: number; attrs: FieldAttrs } | null {
  const { selection } = view.state;
  if (selection.empty) {
    const before = selection.$from.nodeBefore;
    if (before && before.type.name === "field") {
      return { pos: selection.from - before.nodeSize, attrs: before.attrs as FieldAttrs };
    }
    const after = selection.$from.nodeAfter;
    if (after && after.type.name === "field") {
      return { pos: selection.from, attrs: after.attrs as FieldAttrs };
    }
    return null;
  }
  let found: { pos: number; attrs: FieldAttrs } | null = null;
  view.state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (found) return false;
    if (node.type.name === "field") {
      found = { pos, attrs: node.attrs as FieldAttrs };
      return false;
    }
    return true;
  });
  return found;
}

/** Every automatic field re-rendered as one edit, out of the undo history. */
export function updateAllFields(view: EditorView, when: Date, locale: string): void {
  const { state } = view;
  const tr = state.tr;
  const replacements: Array<{ pos: number; node: PMNode }> = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "field") return true;
    const attrs = node.attrs as FieldAttrs;
    if (!attrs.auto || attrs.kind === "name") return false;
    replacements.push({
      pos,
      node: node.type.create({
        ...attrs,
        value: toIsoLocal(when),
        text: renderFieldValue(attrs.kind, attrs.format, when, locale),
      }),
    });
    return false;
  });
  for (const { pos, node } of replacements) {
    tr.replaceWith(pos, pos + node.nodeSize, node);
  }
  if (!replacements.length) return;
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}