// The converter modules of this folder, re-exported from one address.
//
// The format registry that used to live here (`supportedFormats`, with the two
// filter builders `getImportFilters` / `getExportFilters`) was removed on
// 29-09 (Carlo). It had no caller anywhere in the program - the File menu
// builds its own lists in `editor/toolbar.ts` - and its table was wrong in
// three places: it claimed PDF import and export and ODT export (the
// placeholders in `pdf.ts` and `odt.ts` only throw "not yet implemented"), and
// it claimed HTML cannot be imported (importing HTML works since 2026-08-14,
// `openHTML`). The plan for PDF and ODT lives in the wiki:
// `wiki/todo/_priorita-5.md`, section "Canale PDF + multimedia".

export * from "./markdown";
export * from "./txt";
export * from "./html";
export * from "./docx";
export * from "./odt";
export * from "./pdf";
