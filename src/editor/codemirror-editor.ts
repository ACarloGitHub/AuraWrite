// CodeMirror-based editor for "code mode" file editing (F3).
//
// Used by the Ebooks panel to edit ebook files on the real source (fedeltà
// totale) and by the future Developer template. When active:
//   - the ProseMirror editor area is hidden and the code area is shown;
//   - the text-formatting toolbar groups (`.toolbar-group--code-disabled`) are
//     disabled via the `codemirror-mode` body class;
//   - the Suggestions button is disabled.
//
// Saving happens through the global Ctrl+S handler (which triggers the File >
// Save command) and automatically when the editor is closed with pending
// changes.

import { EditorView, basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { less } from "@codemirror/lang-less";
import { sass } from "@codemirror/lang-sass";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { java } from "@codemirror/lang-java";
import { wast } from "@codemirror/lang-wast";
import { vue } from "@codemirror/lang-vue";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { liquid } from "@codemirror/lang-liquid";
import { jinja } from "@codemirror/lang-jinja";
import { angular } from "@codemirror/lang-angular";

function languageForExtension(ext: string): Extension {
  switch (ext) {
    case "html":
    case "htm":
      return html();
    case "xml":
    case "xhtml":
    case "svg":
      return xml();
    case "css":
      return css();
    case "less":
      return less();
    case "scss":
    case "sass":
      return sass();
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx":
      return javascript();
    case "json":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "yaml":
    case "yml":
      return yaml();
    case "py":
      return python();
    case "sql":
      return sql();
    case "java":
      return java();
    case "c":
    case "cc":
    case "cpp":
    case "cxx":
    case "h":
    case "hh":
    case "hpp":
    case "hxx":
      return cpp();
    case "rs":
      return rust();
    case "go":
      return go();
    case "php":
      return php();
    case "wast":
    case "wat":
      return wast();
    case "vue":
      return vue();
    case "liquid":
      return liquid();
    case "jinja":
    case "j2":
      return jinja();
    case "angular":
      return angular();
    default:
      return [];
  }
}

let codeView: EditorView | null = null;
let codePath: string | null = null;
let codeOriginal: string | null = null;
let codeSave: ((path: string, content: string) => Promise<void>) | null = null;

/** Whether a CodeMirror file is currently open. */
export function isCodeMirrorActive(): boolean {
  return codeView !== null;
}

/** Path of the currently open CodeMirror file, if any. */
export function getCodeFilePath(): string | null {
  return codePath;
}

/** Current content of the open CodeMirror file, if any. */
export function getCodeContent(): string | null {
  return codeView ? codeView.state.doc.toString() : null;
}

/** Save the open CodeMirror file (no-op if none). Returns whether it saved. */
export async function saveCodeFile(): Promise<boolean> {
  if (!codeView || !codePath || !codeSave) return false;
  await codeSave(codePath, codeView.state.doc.toString());
  codeOriginal = codeView.state.doc.toString();
  return true;
}

/** Open a file in CodeMirror, replacing any previously open code file. */
export function openFileInCodeMirror(
  path: string,
  content: string,
  ext: string,
  onSave: (path: string, content: string) => Promise<void>
): void {
  // Closes the previous editor and saves pending changes first.
  closeCodeMirror();

  // CodeMirror replaces the ProseMirror editor in the same box (#editor).
  const editorArea = document.getElementById("editor");
  if (!editorArea) return;

  const state = EditorState.create({
    doc: content,
    extensions: [basicSetup, languageForExtension(ext)],
  });

  codeView = new EditorView({ state, parent: editorArea });
  codePath = path;
  codeOriginal = content;
  codeSave = onSave;

  // UI: hide the ProseMirror content inside the same box, drop the document
  // padding, disable the formatting toolbar and the Suggestions button.
  const pm = editorArea.querySelector(".ProseMirror") as HTMLElement | null;
  if (pm) pm.style.display = "none";
  editorArea.style.padding = "0";
  document.body.classList.add("codemirror-mode");

  const suggestionsBtn = document.getElementById("btn-suggestions") as HTMLButtonElement | null;
  if (suggestionsBtn) suggestionsBtn.disabled = true;

  document.dispatchEvent(new Event("aurawrite:codemirror-changed"));
}

/** Close the CodeMirror editor, saving pending changes, and restore the UI. */
export function closeCodeMirror(): void {
  if (codeView && codePath && codeSave) {
    const current = codeView.state.doc.toString();
    if (codeOriginal === null || current !== codeOriginal) {
      void codeSave(codePath, current).catch((e) =>
        console.error("[codemirror] failed to save on close:", e)
      );
    }
  }

  if (codeView) {
    codeView.destroy();
    codeView = null;
  }
  codePath = null;
  codeOriginal = null;
  codeSave = null;

  const editorArea = document.getElementById("editor");
  if (editorArea) {
    editorArea.style.padding = "";
    const pm = editorArea.querySelector(".ProseMirror") as HTMLElement | null;
    if (pm) pm.style.display = "";
  }
  document.body.classList.remove("codemirror-mode");

  const suggestionsBtn = document.getElementById("btn-suggestions") as HTMLButtonElement | null;
  if (suggestionsBtn) suggestionsBtn.disabled = false;

  document.dispatchEvent(new Event("aurawrite:codemirror-changed"));
}
