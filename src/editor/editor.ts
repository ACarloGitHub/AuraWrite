import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as ProseMirrorDOMParser,
  NodeSpec,
  MarkSpec,
  Fragment,
  type NodeType,
  type MarkType,
  type Node as PMNode,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { splitListItem, sinkListItem, liftListItem } from "prosemirror-schema-list";
import { selectionHighlightPlugin } from "./selection-highlight";
import { chunkDecorationsPlugin } from "./chunk-decorations";
import { pageBreakPlugin } from "./page-break-widget";
import { createPageBreakPlugin } from "./page-break-plugin";
import { suggestionsMarkerPlugin } from "./suggestions-marker-plugin";
import { findReplacePlugin } from "./find-replace";
import { createPaginationPlugin, requestPaginationRecalc } from "./pagination-plugin";
import { PageNodeView } from "./page-node-view";
import { initPagedMode, getPagedMode, setPagedMode } from "./pagination-state";

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
      tag: "h1.title",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 1, align: styleAlign || "center" };
      },
    },
    {
      tag: "h1",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 1, align: styleAlign || "left" };
      },
    },
    {
      tag: "h2",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 2, align: styleAlign || "left" };
      },
    },
    {
      tag: "h3",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 3, align: styleAlign || "left" };
      },
    },
    {
      tag: "h4",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 4, align: styleAlign || "left" };
      },
    },
    {
      tag: "h5",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 5, align: styleAlign || "left" };
      },
    },
    {
      tag: "h6",
      getAttrs: (node) => {
        const el = node as HTMLElement;
        const styleAlign = (el.style?.textAlign || "").trim();
        return { level: 6, align: styleAlign || "left" };
      },
    },
  ],
  toDOM(node) {
    const headingTag = `h${node.attrs.level}`;
    const attrs: Record<string, string> = {
      "data-align": node.attrs.align as string,
    };
    if (node.attrs.align === "center") {
      attrs.style = "text-align: center";
    }
    if (node.attrs.level === 1 && node.attrs.align === "center") {
      attrs.class = "title";
    }
    return [headingTag, attrs, 0];
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

const pageSpec: NodeSpec = {
  content: "block+",
  group: "page",
  isolating: true,
  defining: true,
  attrs: {
    pageNumber: { default: 1 },
  },
  parseDOM: [{ tag: "div[data-page-node]" }],
  toDOM() {
    return ["div", { "data-page-node": "true", class: "pm-page-wrapper" }, 0];
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

const subscriptMark: MarkSpec = {
  parseDOM: [{ tag: "sub" }],
  toDOM() {
    return ["sub", 0];
  },
};

const superscriptMark: MarkSpec = {
  parseDOM: [{ tag: "sup" }],
  toDOM() {
    return ["sup", 0];
  },
};

const textColorMark: MarkSpec = {
  attrs: {
    color: { default: "" },
  },
  parseDOM: [
    {
      style: "color",
      getAttrs: (value) => {
        if (!value) return false;
        const normalized = normalizeColor(value);
        if (normalized === "#000000" || normalized === "rgb(0,0,0)" || normalized === "black") return false;
        return { color: value as string };
      },
    },
  ],
  toDOM(node) {
    if (!node.attrs.color) return ["span", {}, 0];
    return ["span", { style: `color: ${node.attrs.color}` }, 0];
  },
};

function normalizeColor(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === "black") return "#000000";
  const match = v.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }
  return v;
}

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
nodes = nodes
  .update("doc", { content: "(page | block)+" })
  .append({
    heading: headingSpec,
    list_item: listItemSpec,
    bullet_list: bulletListSpec,
    ordered_list: orderedListSpec,
    blockquote: blockquoteSpec,
    page: pageSpec,
    code_block: codeBlockSpec,
  });

const marks = basicSchema.spec.marks.append({
  underline: underlineMark,
  strikethrough: strikethroughMark,
  textColor: textColorMark,
  highlight: highlightMark,
  fontSize: fontSizeMark,
  fontFamily: fontFamilyMark,
  subscript: subscriptMark,
  superscript: superscriptMark,
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
        const updateFn = (window as Window & { updateWordCount?: (view: EditorView) => void }).updateWordCount;
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
  initPagedMode();
  const autoPageBreakPlugin = createPageBreakPlugin();
  const paginationPluginInstance = createPaginationPlugin();

  const state = EditorState.create({
    schema: editorSchema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap({
        Enter: splitListItem(editorSchema.nodes.list_item),
        "Mod-]": sinkListItem(editorSchema.nodes.list_item),
        "Mod-[": liftListItem(editorSchema.nodes.list_item),
      }),
      keymap(baseKeymap),
      wordCountPlugin,
      selectionHighlightPlugin,
      chunkDecorationsPlugin,
      pageBreakPlugin,
      autoPageBreakPlugin,
      suggestionsMarkerPlugin,
      findReplacePlugin,
      paginationPluginInstance,
    ],
  });

  const view = new EditorView(element, {
    state,
    attributes: {
      class: "prosemirror-editor",
    },
    nodeViews: {
      page: (node, view, getPos) => new PageNodeView(node, view, getPos),
    },
  });

  // Set initial pagination classes based on getPagedMode()
  if (getPagedMode()) {
    view.dom.classList.add("is-paged-mode");
    view.dom.classList.add("paged-mode");
  } else {
    view.dom.classList.remove("is-paged-mode");
    view.dom.classList.remove("paged-mode");
  }

  window.addEventListener("aurawrite:pagination-mode-changed", ((e: CustomEvent) => {
    const enabled = e.detail.enabled as boolean;
    if (enabled) {
      view.dom.classList.add("is-paged-mode");
      view.dom.classList.add("paged-mode");
    } else {
      view.dom.classList.remove("is-paged-mode");
      view.dom.classList.remove("paged-mode");
    }
  }) as EventListener);

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

export function parseHTML(html: string): PMNode {
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const div = document.createElement("div");
  div.innerHTML = body.innerHTML;

  const pmParser = ProseMirrorDOMParser.fromSchema(editorSchema);
  return pmParser.parse(div);
}

export function wrapInPages(view: EditorView): void {
  const { doc, schema, tr } = view.state;
  const pageType = schema.nodes.page;
  if (!pageType) return;

  if (doc.firstChild && doc.firstChild.type.name === "page") return;

  const blocks: PMNode[] = [];
  doc.forEach((node) => {
    blocks.push(node);
  });

  if (blocks.length === 0) {
    const paraType = schema.nodes.paragraph;
    if (paraType) {
      const page = pageType.create(null, paraType.create());
      tr.replaceWith(0, doc.content.size, page);
    }
  } else {
    const page = pageType.create(null, Fragment.from(blocks));
    tr.replaceWith(0, doc.content.size, page);
  }

  tr.setMeta("pagination", true);
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

export function unwrapPages(view: EditorView): void {
  const { doc, tr } = view.state;

  let hasPages = false;
  doc.forEach((node) => {
    if (node.type.name === "page") hasPages = true;
  });
  if (!hasPages) return;

  const allBlocks: PMNode[] = [];
  doc.forEach((pageNode) => {
    if (pageNode.type.name === "page") {
      pageNode.forEach((block) => {
        allBlocks.push(block);
      });
    } else {
      allBlocks.push(pageNode);
    }
  });

  tr.replaceWith(0, doc.content.size, Fragment.from(allBlocks));
  tr.setMeta("pagination", true);
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

export function togglePagedMode(view: EditorView): void {
  const currentlyPaged = getPagedMode();
  if (currentlyPaged) {
    unwrapPages(view);
    setPagedMode(false);
    view.dom.classList.remove("paged-mode");
    view.dom.classList.remove("is-paged-mode");
  } else {
    wrapInPages(view);
    setPagedMode(true);
    view.dom.classList.add("paged-mode");
    view.dom.classList.add("is-paged-mode");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestPaginationRecalc();
        });
      });
    });
  }
}

export function syncDocumentPaginationState(view: EditorView): void {
  const isPagedMode = getPagedMode();
  const doc = view.state.doc;

  let hasPages = false;
  doc.forEach((node) => {
    if (node.type.name === "page") hasPages = true;
  });

  if (isPagedMode) {
    if (!hasPages) {
      wrapInPages(view);
    }
  } else {
    if (hasPages) {
      unwrapPages(view);
    }
  }
}
