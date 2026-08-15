// File extensions and Save As filters for the CodeMirror code editor.
//
// Data-only module (no CodeMirror import) so it can be required from anywhere
// without pulling the editor into the initial bundle.

/** File extensions supported by the installed CodeMirror language modules. */
export const CODEMIRROR_EXTENSIONS: string[] = [
  "html", "htm",
  "xml", "xhtml", "svg",
  "css", "less", "scss", "sass",
  "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "json",
  "md", "markdown",
  "yaml", "yml",
  "py",
  "sql",
  "java",
  "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx",
  "rs",
  "go",
  "php",
  "wast", "wat",
  "vue",
  "liquid",
  "jinja", "j2",
  "txt",
];

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
