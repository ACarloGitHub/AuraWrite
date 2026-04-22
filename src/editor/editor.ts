import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as ProseMirrorDOMParser,
  NodeSpec,
  MarkSpec,
  type NodeType,
  type MarkType,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { selectionHighlightPlugin } from "./selection-highlight";
import { chunkDecorationsPlugin } from "./chunk-decorations";
import { pageBreakPlugin } from "./page-break-widget";
import { createPageBreakPlugin } from "./page-break-plugin";
import { suggestionsMarkerPlugin } from "./suggestions-marker-plugin";

// ============================================================================
// Custom Schema — Extended for full rich text editing
// ============================================================================

const paragraphWithPageBreak: NodeSpec = {
  content: "inline*",
  group: "block",
  attrs: {
    align: { default: "left" },
    lineHeight: { default: "1.5" },
    pageBreakBefore: { default: false },
  },
  parseDOM: [
    {
      tag: "p",
      getAttrs: (dom: HTMLElement) => ({
        align: dom.getAttribute("data-align") || dom.style.textAlign || "left",
        lineHeight:
          dom.getAttribute("data-line-height") ||
          dom.style.lineHeight ||
          "1.5",
        pageBreakBefore: dom.classList.contains("page-break-before"),
      }),
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      "data-align": node.attrs.align as string,
      "data-line-height": node.attrs.lineHeight as string,
    };
    if (node.attrs.pageBreakBefore) {
      attrs.class = "page-break-before";
    }
    return ["p", attrs, 0];
  },
};

const headingSpec: NodeSpec = {
  content: "inline*",
  group: "block",
  defining: true,
  attrs: {
    level: { default: 1 },
    align: { default: "left" },
    lineHeight: { default: "1.5" },
  },
  parseDOM: [
    {
      tag: "h1",
      getAttrs: () => ({ level: 1, align: "left" }),
    },
    {
      tag: "h2",
      getAttrs: () => ({ level: 2, align: "left" }),
    },
    {
      tag: "h3",
      getAttrs: () => ({ level: 3, align: "left" }),
    },
    {
      tag: "h4",
      getAttrs: () => ({ level: 4, align: "left" }),
    },
    {
      tag: "h5",
      getAttrs: () => ({ level: 5, align: "left" }),
    },
    {
      tag: "h6",
      getAttrs: () => ({ level: 6, align: "left" }),
    },
  ],
  toDOM(node) {
    const headingTag = `h${node.attrs.level}`;
    return [
      headingTag,
      {
        "data-align": node.attrs.align as string,
      },
      0,
    ];
  },
};

const listItemSpec: NodeSpec = {
  content: "paragraph block*",
  defining: true,
  parseDOM: [{ tag: "li" }],
  toDOM() {
    return ["li", 0];
  },
};

const bulletListSpec: NodeSpec = {
  content: "list_item+",
  group: "block",
  parseDOM: [{ tag: "ul" }],
  toDOM() {
    return ["ul", 0];
  },
};

const orderedListSpec: NodeSpec = {
  content: "list_item+",
  group: "block",
  attrs: {
    order: { default: 1 },
  },
  parseDOM: [
    {
      tag: "ol",
      getAttrs: (dom: HTMLElement) => {
        const start = dom.getAttribute("start");
        return {
          order: start ? parseInt(start, 10) : 1,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.order !== 1) {
      attrs.start = String(node.attrs.order);
    }
    return ["ol", attrs, 0];
  },
};

const blockquoteSpec: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "blockquote" }],
  toDOM() {
    return ["blockquote", 0];
  },
};

const codeBlockSpec: NodeSpec = {
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  attrs: {
    language: { default: "" },
  },
  parseDOM: [
    {
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (dom: HTMLElement) => ({
        language: dom.getAttribute("data-language") || "",
      }),
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      "data-language": node.attrs.language as string,
    };
    return ["pre", attrs, ["code", 0]];
  },
};

const underlineMark: MarkSpec = {
  parseDOM: [
    { tag: "u" },
    { style: "text-decoration=underline" },
  ],
  toDOM() {
    return ["u", 0];
  },
};

const strikethroughMark: MarkSpec = {
  parseDOM: [
    { tag: "s" },
    { tag: "del" },
    { tag: "strike" },
    { style: "text-decoration=line-through" },
  ],
  toDOM() {
    return ["s", 0];
  },
};

const textColorMark: MarkSpec = {
  attrs: {
    color: { default: "#000000" },
  },
  parseDOM: [
    {
      style: "color",
      getAttrs: (value) => {
        return { color: value as string };
      },
    },
  ],
  toDOM(node) {
    return ["span", { style: `color: ${node.attrs.color}` }, 0];
  },
};

const highlightMark: MarkSpec = {
  attrs: {
    color: { default: "#ffff00" },
  },
  parseDOM: [
    {
      tag: "span",
      getAttrs: (dom: HTMLElement) => {
        const bg = dom.style.backgroundColor;
        if (!bg) return false;
        return { color: rgbToHex(bg) || "#ffff00" };
      },
    },
    {
      style: "background-color",
      getAttrs: (value) => {
        return { color: rgbToHex(value as string) || value };
      },
    },
  ],
  toDOM(node) {
    return ["span", { style: `background-color: ${node.attrs.color}` }, 0];
  },
};

const fontSizeMark: MarkSpec = {
  attrs: {
    size: { default: "16px" },
  },
  parseDOM: [
    {
      style: "font-size",
      getAttrs: (value) => {
        return { size: value as string };
      },
    },
  ],
  toDOM(node) {
    return ["span", { style: `font-size: ${node.attrs.size}` }, 0];
  },
};

const fontFamilyMark: MarkSpec = {
  attrs: {
    font: { default: "" },
  },
  parseDOM: [
    {
      style: "font-family",
      getAttrs: (value) => {
        return { font: value as string };
      },
    },
  ],
  toDOM(node) {
    if (!node.attrs.font) return ["span", {}, 0];
    return ["span", { style: `font-family: ${node.attrs.font}` }, 0];
  },
};

function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return null;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ============================================================================
// Build the Extended Schema
// ============================================================================

let nodes = basicSchema.spec.nodes.update("paragraph", paragraphWithPageBreak);
nodes = nodes.append({
  heading: headingSpec,
  list_item: listItemSpec,
  bullet_list: bulletListSpec,
  ordered_list: orderedListSpec,
  blockquote: blockquoteSpec,
  code_block: codeBlockSpec,
});

const marks = basicSchema.spec.marks.append({
  underline: underlineMark,
  strikethrough: strikethroughMark,
  textColor: textColorMark,
  highlight: highlightMark,
  fontSize: fontSizeMark,
  fontFamily: fontFamilyMark,
});

const editorSchema = new Schema({
  nodes,
  marks,
});

export { editorSchema as schema };

export type SchemaNodeType = NodeType;
export type SchemaMarkType = MarkType;

// ============================================================================
// Word Count Plugin
// ============================================================================

const wordCountPluginKey = new PluginKey("wordCount");

const wordCountPlugin = new Plugin({
  key: wordCountPluginKey,
  view: () => ({
    update(view, prevState) {
      if (view.state.doc !== prevState.doc) {
        const updateFn = (window as any).updateWordCount;
        if (updateFn) {
          updateFn(view);
        }
      }
    },
  }),
});

export { wordCountPlugin };

// ============================================================================
// Editor View
// ============================================================================

export type EditorViewType = EditorView;

export function createEditor(element: HTMLElement): EditorViewType {
  const autoPageBreakPlugin = createPageBreakPlugin();

  const state = EditorState.create({
    schema: editorSchema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap(baseKeymap),
      wordCountPlugin,
      selectionHighlightPlugin,
      chunkDecorationsPlugin,
      pageBreakPlugin,
      autoPageBreakPlugin,
      suggestionsMarkerPlugin,
    ],
  });

  const view = new EditorView(element, {
    state,
    attributes: {
      class: "prosemirror-editor",
    },
  });

  return view as unknown as EditorViewType;
}

export function destroyEditor(view: EditorViewType): void {
  view.destroy();
}

export function getEditorContent(view: EditorViewType): string {
  return view.state.doc.textContent;
}

export function getSelectedText(view: EditorViewType): string {
  const { from, to } = view.state.selection;
  if (from === to) return "";
  return view.state.doc.textBetween(from, to);
}

export function parseHTML(html: string): any {
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const div = document.createElement("div");
  div.innerHTML = body.innerHTML;

  const pmParser = ProseMirrorDOMParser.fromSchema(editorSchema);
  return pmParser.parse(div);
}
