import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema, DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { selectionHighlightPlugin } from "./selection-highlight";
import { chunkDecorationsPlugin } from "./chunk-decorations";

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

const editorSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks: basicSchema.spec.marks,
});

export { editorSchema as schema };

export function createEditor(element: HTMLElement): EditorViewType {
  const state = EditorState.create({
    schema: editorSchema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      keymap(baseKeymap),
      wordCountPlugin,
      selectionHighlightPlugin,
      chunkDecorationsPlugin,
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
