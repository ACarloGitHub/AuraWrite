// File extensions and Save As filters for the CodeMirror code editor.
//
// Data-only module (no CodeMirror import) so it can be required from anywhere
// without pulling the editor into the initial bundle.

/** Save As filters (system dialog) for the formats CodeMirror supports. */
export const CODEMIRROR_FILTERS: { name: string; extensions: string[] }[] = [
  { name: "HTML", extensions: ["html", "htm"] },
  { name: "XML / XHTML / SVG", extensions: ["xml", "xhtml", "svg"] },
  { name: "CSS", extensions: ["css"] },
  { name: "Less", extensions: ["less"] },
  { name: "Sass / SCSS", extensions: ["scss", "sass"] },
  { name: "JavaScript / TypeScript", extensions: ["js", "mjs", "cjs", "jsx", "ts", "tsx"] },
  { name: "JSON", extensions: ["json"] },
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "YAML", extensions: ["yaml", "yml"] },
  { name: "Python", extensions: ["py"] },
  { name: "SQL", extensions: ["sql"] },
  { name: "Java", extensions: ["java"] },
  { name: "C / C++", extensions: ["c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"] },
  { name: "Rust", extensions: ["rs"] },
  { name: "Go", extensions: ["go"] },
  { name: "PHP", extensions: ["php"] },
  { name: "WebAssembly", extensions: ["wast", "wat"] },
  { name: "Vue", extensions: ["vue"] },
  { name: "Liquid", extensions: ["liquid"] },
  { name: "Jinja", extensions: ["jinja", "j2"] },
  { name: "Plain Text", extensions: ["txt"] },
];

/**
 * File extensions supported by the installed CodeMirror language modules: what
 * the ebook tree asks before it lets a file be clicked open
 * (`isOpenableFile`, ebook/tree.ts). Built from the filters above, so a new
 * language is one edit and not two lists that must be kept in step.
 *
 * Note the other list: `languageForExtension` in codemirror-editor.ts maps an
 * extension to its highlighting module and deliberately holds one entry more -
 * `angular`, from `@codemirror/lang-angular`, one of the 21 official modules
 * (wiki/concepts/ebook-publishing.md, "Moduli linguaggio"). No file extension
 * maps to Angular templates (they are *.component.html), so today it is only
 * reachable through the language field planned for the Coder mode, which will
 * let the user type an extension by hand (wiki/concepts/coder-writer-mode.md,
 * UI section). It is kept on purpose, not left over.
 */
export const CODEMIRROR_EXTENSIONS: string[] = CODEMIRROR_FILTERS.flatMap((f) => f.extensions);
