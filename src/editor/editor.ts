import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as ProseMirrorDOMParser,
  NodeSpec,
  MarkSpec,
  type NodeType,
  type MarkType,
  type Node as PMNode,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { splitListItem, sinkListItem, liftListItem } from "prosemirror-schema-list";
import { tableNodes, tableEditing, columnResizing } from "prosemirror-tables";
import "prosemirror-tables/style/tables.css";
import { createTableMonitorPlugin } from "./table-toolbar";
import { selectionHighlightPlugin } from "./selection-highlight";
import { chunkDecorationsPlugin } from "./chunk-decorations";
import { pageBreakPlugin } from "./page-break-widget";
import { suggestionsMarkerPlugin } from "./suggestions-marker-plugin";
import { findReplacePlugin } from "./find-replace";
import { createCassiePaginationPlugin } from "./pagination-cassie-plugin";
import { linkPopoverPlugin, openLinkPopover } from "./link-plugin";
import { createImageDropPlugin, createImagePastePlugin } from "./image-drop-plugin";
import { ImageNodeView } from "./image-node-view";
import { IMAGE_STYLE_ATTRS, STYLED_BOX_NODE_SPEC, imageStyleGetDOM, imageStyleToDOM } from "./enriched-schema";
import { StyledBoxNodeView, createBoxTypeGuardPlugin } from "./box-node-view";
import { updateImageToolbar } from "./toolbar";
import { initPagedMode, getCassieMode, getCassiePagedMode, setCassiePagedMode } from "./pagination-state";

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

const imageSpec: NodeSpec = {
  inline: false,
  group: "block",
  selectable: true,
  attrs: {
    src: { default: "" },
    alt: { default: "" },
    title: { default: "" },
    width: { default: null },
    height: { default: null },
    align: { default: "center" },
    wrap: { default: false },
    rotation: { default: 0 },
    flipH: { default: false },
    flipV: { default: false },
    aspectLocked: { default: true },
    caption: { default: "" },
    // Phase 1 (enrichment) style attrs — dialect + logic in enriched-schema.ts
    ...IMAGE_STYLE_ATTRS,
  },
  parseDOM: [
    {
      tag: "img[src]",
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === "string") return false;
        const w = dom.getAttribute("width");
        const h = dom.getAttribute("height");
        return {
          src: dom.getAttribute("src") || "",
          alt: dom.getAttribute("alt") || "",
          title: dom.getAttribute("title") || "",
          width: w ? parseInt(w, 10) || null : null,
          height: h ? parseInt(h, 10) || null : null,
          align: dom.getAttribute("data-align") || "center",
          wrap: dom.hasAttribute("data-wrap"),
          rotation: parseFloat(dom.getAttribute("data-rotation") || "0") || 0,
          flipH: dom.hasAttribute("data-flip-h"),
          flipV: dom.hasAttribute("data-flip-v"),
          aspectLocked: !dom.hasAttribute("data-aspect-unlocked"),
          caption: dom.getAttribute("data-caption") || "",
          ...imageStyleGetDOM(dom),
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      src: node.attrs.src as string,
      alt: node.attrs.alt as string,
    };
    if (node.attrs.title) attrs.title = node.attrs.title as string;
    if (node.attrs.width) attrs.width = String(node.attrs.width);
    if (node.attrs.height) attrs.height = String(node.attrs.height);
    attrs["data-align"] = node.attrs.align as string;
    if (node.attrs.wrap) attrs["data-wrap"] = "";
    if (node.attrs.rotation) attrs["data-rotation"] = String(node.attrs.rotation);
    if (node.attrs.flipH) attrs["data-flip-h"] = "";
    if (node.attrs.flipV) attrs["data-flip-v"] = "";
    if (!node.attrs.aspectLocked) attrs["data-aspect-unlocked"] = "";
    if (node.attrs.caption) attrs["data-caption"] = node.attrs.caption as string;
    Object.assign(attrs, imageStyleToDOM(node));
    return ["img", attrs];
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
        return highlightColorFromCss(bg);
      },
    },
    {
      style: "background-color",
      getAttrs: (value) => {
        return highlightColorFromCss(value as string) || false;
      },
    },
  ],
  toDOM(node) {
    return ["span", { style: `background-color: ${node.attrs.color}` }, 0];
  },
};

/**
 * Accept a CSS background-color as an explicit highlight ONLY when it is a
 * real, visible fill. Google Docs attaches white/transparent backgrounds to
 * plain copied text; treating those as highlights painted spurious yellow
 * marks on paste (Carlo, 2026-08-26).
 */
function highlightColorFromCss(bg: string): { color: string } | false {
  if (!bg) return false;
  const v = bg.trim().toLowerCase();
  if (!v || v === "transparent" || v === "none" || v === "inherit" || v === "initial") {
    return false;
  }
  const hex = rgbToHex(v);
  if (hex) {
    // Near-white fills are not highlights.
    if (/^#f[f]{6}$/i.test(hex)) return false;
    return { color: hex };
  }
  // rgb()/rgba(): reject transparent or near-white, accept the rest as hex.
  const rgba = v.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(",").map((s) => parseFloat(s.trim()));
    const [r, g, b] = parts;
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (!isFinite(alpha) || alpha < 0.05) return false;
    if (r > 245 && g > 245 && b > 245) return false;
    return { color: `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}` };
  }
  // Named colors (e.g. "yellow"): keep them as-is.
  return { color: v };
}

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

const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "block+",
  cellAttributes: {
    backgroundColor: {
      default: null,
      getFromDOM(dom) {
        return (dom as HTMLElement).style.backgroundColor || null;
      },
      setDOMAttr(value, attrs) {
        if (value) attrs.style = `background-color: ${value}`;
      },
    },
  },
});

let nodes = basicSchema.spec.nodes.update("paragraph", paragraphWithPageBreak);
nodes = nodes
  .update("doc", { content: "block+" })
  .append({
    heading: headingSpec,
    list_item: listItemSpec,
    bullet_list: bulletListSpec,
    ordered_list: orderedListSpec,
    blockquote: blockquoteSpec,
    code_block: codeBlockSpec,
    image: imageSpec,
    styled_box: STYLED_BOX_NODE_SPEC,
    ...tableNodeSpecs,
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

function scrollSelectionIntoView(view: EditorView): void {
  const { head } = view.state.selection;
  if (head < 0) return;

  const rect = view.coordsAtPos(head, 1);

  let scrollTarget: HTMLElement | null = view.dom;
  while (scrollTarget && scrollTarget !== document.documentElement) {
    const style = getComputedStyle(scrollTarget);
    const overflowY = style.overflowY;
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      style.overflow === "auto" ||
      style.overflow === "scroll"
    ) {
      break;
    }
    scrollTarget = scrollTarget.parentElement;
  }
  if (!scrollTarget) scrollTarget = view.dom;

  const elRect = scrollTarget.getBoundingClientRect();

  const margin = 80;
  if (
    rect.top >= elRect.top + margin &&
    rect.bottom <= elRect.bottom - margin
  ) {
    return;
  }

  const targetCenter = elRect.top + elRect.height / 2;
  const currentCenter = (rect.top + rect.bottom) / 2;
  const delta = currentCenter - targetCenter;

  scrollTarget.scrollBy({
    top: delta,
    behavior: "smooth",
  });
}

export function createEditor(element: HTMLElement): EditorViewType {
  initPagedMode();

  const state = EditorState.create({
    schema: editorSchema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap({
        Enter: splitListItem(editorSchema.nodes.list_item),
        "Mod-]": sinkListItem(editorSchema.nodes.list_item),
        "Mod-[": liftListItem(editorSchema.nodes.list_item),
        "Mod-k": (_state, _dispatch, view) => {
          if (view) openLinkPopover(view);
          return true;
        },
      }),
      keymap(baseKeymap),
      wordCountPlugin,
      selectionHighlightPlugin,
      chunkDecorationsPlugin,
      pageBreakPlugin,
      suggestionsMarkerPlugin,
      findReplacePlugin,
      createCassiePaginationPlugin({ enabled: getCassieMode }),
      linkPopoverPlugin,
      createImageDropPlugin(),
      createImagePastePlugin(),
      columnResizing({ cellMinWidth: 25, defaultCellMinWidth: 100 }),
      tableEditing(),
      createTableMonitorPlugin(),
      createBoxTypeGuardPlugin(),
      new Plugin({
        key: new PluginKey("imageToolbarSync"),
        view() {
          return {
            update(view) {
              updateImageToolbar(view as EditorView);
            },
          };
        },
      }),
    ],
  });

  const view = new EditorView(element, {
    state,
    attributes: {
      class: "prosemirror-editor",
    },
    nodeViews: {
      image: (node, view, getPos) => new ImageNodeView(node, view, getPos),
      styled_box: (node, view, getPos) => new StyledBoxNodeView(node, view, getPos),
    },
    handleScrollToSelection(view) {
      scrollSelectionIntoView(view);
      return true;
    },
  });

  // Set initial pagination classes based on getCassiePagedMode()
  if (getCassiePagedMode()) {
    view.dom.classList.add("is-cassie-paged");
  }

  window.addEventListener("aurawrite:cassie-paged-changed", ((e: CustomEvent) => {
    if (e.detail.enabled) {
      view.dom.classList.add("is-cassie-paged");
    } else {
      view.dom.classList.remove("is-cassie-paged");
    }
    const tr = view.state.tr.setMeta("force-cassie-recompute", true);
    view.dispatch(tr);
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

export function toggleCassiePagedMode(view: EditorView): void {
  const currentlyPaged = getCassiePagedMode();
  if (currentlyPaged) {
    setCassiePagedMode(false);
    view.dom.classList.remove("is-cassie-paged");
  } else {
    if (getCassieMode()) {
      // Cassie continuous and Cassie paged are mutually exclusive
      // We just switch to paged
    }
    setCassiePagedMode(true);
    view.dom.classList.add("is-cassie-paged");
  }
  const tr = view.state.tr.setMeta("force-cassie-recompute", true);
  view.dispatch(tr);
}

export function syncDocumentPaginationState(_view: EditorView): void {
  // Legacy "page" node system removed. This function is kept as a no-op
  // for backward compatibility with callers in main.ts and toolbar.ts.
}
