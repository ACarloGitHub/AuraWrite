import type { EditorView } from "prosemirror-view";
import type { AuraEdit, ContentNode, TextNode, MarkType } from "./operations";
import { parseAuraEdit, hasValidOperations } from "./edit-parser";
import { findTextInDoc } from "../editor/text-utils";
import { notifyDocumentChange } from "./modification-hub";

export interface ExecuteResult {
  success: boolean;
  error?: string;
  operationsApplied: number;
  operationsFailed: number;
}

function createMark(
  schema: EditorView["state"]["schema"],
  markType: MarkType,
  href?: string,
) {
  switch (markType) {
    case "strong":
      return schema.marks.strong.create();
    case "em":
      return schema.marks.em.create();
    case "underline":
      return schema.marks.underline?.create();
    case "code":
      return schema.marks.code?.create();
    case "link":
      return href ? schema.marks.link?.create({ href }) : null;
    default:
      return null;
  }
}

function contentNodesToProseMirror(
  content: ContentNode[],
  schema: EditorView["state"]["schema"],
): import("prosemirror-model").Node[] {
  const nodes: import("prosemirror-model").Node[] = [];

  for (const node of content) {
    if (node.type === "text") {
      const textNode = node as TextNode;
      const marks = (textNode.marks || [])
        .map((m) => createMark(schema, m, textNode.href))
        .filter(Boolean) as import("prosemirror-model").Mark[];
      nodes.push(schema.text(textNode.text, marks));
    } else if (node.type === "paragraph") {
      const innerNodes = contentNodesToProseMirror(node.content, schema);
      nodes.push(schema.nodes.paragraph.create(null, innerNodes));
    } else if (node.type === "heading") {
      const innerNodes = contentNodesToProseMirror(node.content, schema);
      nodes.push(
        schema.nodes.heading.create({ level: node.level }, innerNodes),
      );
    } else if (node.type === "bullet_list") {
      const listItems = node.items.map((item) => {
        const itemNodes = contentNodesToProseMirror(item.content, schema);
        return schema.nodes.list_item.create(null, [
          schema.nodes.paragraph.create(null, itemNodes),
        ]);
      });
      nodes.push(schema.nodes.bullet_list.create(null, listItems));
    } else if (node.type === "ordered_list") {
      const listItems = node.items.map((item) => {
        const itemNodes = contentNodesToProseMirror(item.content, schema);
        return schema.nodes.list_item.create(null, [
          schema.nodes.paragraph.create(null, itemNodes),
        ]);
      });
      nodes.push(schema.nodes.ordered_list.create(null, listItems));
    } else if (node.type === "blockquote") {
      const innerNodes = contentNodesToProseMirror(node.content, schema);
      nodes.push(schema.nodes.blockquote.create(null, innerNodes));
    }
  }

  return nodes;
}

function executeSingleOperation(
  op: import("./operations").Operation,
  view: EditorView,
  currentSelection: { from: number; to: number } | null,
): boolean {
  const schema = view.state.schema;

  if (op.op === "replace" || op.op === "format") {
    const find = "find" in op ? op.find : "";
    if (!find) return false;

    const pos = findTextInDoc(view, find);
    if (!pos) {
      console.error(`EDIT: Text not found: "${find}"`);
      return false;
    }

    if (currentSelection) {
      if (pos.from < currentSelection.from || pos.to > currentSelection.to) {
        console.error(`EDIT: Text "${find}" is outside selection`);
        return false;
      }
    }

    if (op.op === "replace") {
      const content = "content" in op ? op.content : [];
      const pmNodes = contentNodesToProseMirror(content, schema);
      const tr = view.state.tr.replaceWith(pos.from, pos.to, pmNodes);
      view.dispatch(tr);
    } else if (op.op === "format") {
      let tr = view.state.tr;
      if ("addMark" in op && op.addMark) {
        const mark = createMark(schema, op.addMark);
        if (mark) {
          tr = tr.addMark(pos.from, pos.to, mark);
        }
      }
      if ("removeMark" in op && op.removeMark) {
        const mark = createMark(schema, op.removeMark);
        if (mark) {
          tr = tr.removeMark(pos.from, pos.to, mark.type);
        }
      }
      view.dispatch(tr);
    }

    return true;
  }

  if (op.op === "delete") {
    const find = op.find;
    if (!find) return false;

    const pos = findTextInDoc(view, find);
    if (!pos) {
      console.error(`EDIT: Text not found for delete: "${find}"`);
      return false;
    }

    const tr = view.state.tr.delete(pos.from, pos.to);
    view.dispatch(tr);
    return true;
  }

  if (op.op === "insert") {
    const find = op.find;
    const position = "position" in op ? op.position : "after";
    const content = "content" in op ? op.content : [];

    let targetPos: number;
    if (find) {
      const pos = findTextInDoc(view, find);
      if (!pos) {
        console.error(`EDIT: Reference text not found: "${find}"`);
        return false;
      }
      targetPos = position === "after" ? pos.to : pos.from;
    } else {
      targetPos = view.state.selection.to;
    }

    const pmNodes = contentNodesToProseMirror(content, schema);
    const tr = view.state.tr.insert(targetPos, pmNodes);
    view.dispatch(tr);
    return true;
  }

  return false;
}

export function applyAuraEdit(
  response: string,
  view: EditorView,
  currentSelection: { from: number; to: number; text: string } | null,
): ExecuteResult {
  const parsed = parseAuraEdit(response);

  if (!parsed || !hasValidOperations(parsed)) {
    return {
      success: false,
      error: "No valid edit commands found in response",
      operationsApplied: 0,
      operationsFailed: 0,
    };
  }

  const { operations } = parsed.aura_edit!;
  let applied = 0;
  let failed = 0;

  for (const op of operations) {
    const success = executeSingleOperation(op, view, currentSelection);
    if (success) {
      applied++;
    } else {
      failed++;
    }
  }

  if (applied > 0) {
    notifyDocumentChange({ from: 0, oldLen: 0, newLen: 0 }, "ai_assistant");
  }

  return {
    success: failed === 0,
    operationsApplied: applied,
    operationsFailed: failed,
  };
}
