import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as ProseMirrorDOMParser,
  NodeSpec,
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

export { setPageBreakOptions } from "./page-break-plugin";
export type { PageBreakOptions } from "./page-break-plugin";

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

type EditorViewType = EditorView;

// Extend paragraph node with pageBreakBefore attribute
const paragraphWithPageBreak: NodeSpec = {
  content: "inline*",
  group: "block",
  attrs: {
    pageBreakBefore: { default: false },
  },
  parseDOM: [
    {
      tag: "p",
      getAttrs: (dom: HTMLElement) => ({
        pageBreakBefore: dom.classList.contains("page-break-before"),
      }),
    },
  ],
  toDOM(node) {
    const attrs: { class?: string } = {};
    if (node.attrs.pageBreakBefore) {
      attrs.class = "page-break-before";
    }
    return ["p", attrs, 0];
  },
};

// Build nodes map from basicSchema, overriding paragraph
const nodes = basicSchema.spec.nodes.update(
  "paragraph",
  paragraphWithPageBreak,
);

const editorSchema = new Schema({
  nodes,
  marks: basicSchema.spec.marks,
});

export { editorSchema as schema };

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
