export * from "./markdown";
export * from "./txt";
export * from "./html";
export * from "./docx";
export * from "./odt";
export * from "./pdf";

export interface FormatOption {
  name: string;
  extension: string;
  mimeType: string;
  canImport: boolean;
  canExport: boolean;
}

export const supportedFormats: FormatOption[] = [
  {
    name: "ProseMirror JSON",
    extension: "json",
    mimeType: "application/json",
    canImport: true,
    canExport: true,
  },
  {
    name: "Markdown",
    extension: "md",
    mimeType: "text/markdown",
    canImport: true,
    canExport: true,
  },
  {
    name: "Plain Text",
    extension: "txt",
    mimeType: "text/plain",
    canImport: true,
    canExport: true,
  },
  {
    name: "HTML",
    extension: "html",
    mimeType: "text/html",
    canImport: false,
    canExport: true,
  },
  {
    name: "Word Document",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    canImport: true,
    canExport: true,
  },
  {
    name: "OpenDocument",
    extension: "odt",
    mimeType: "application/vnd.oasis.opendocument.text",
    canImport: false,
    canExport: true,
  },
  {
    name: "PDF",
    extension: "pdf",
    mimeType: "application/pdf",
    canImport: true,
    canExport: true,
  },
];

export function getImportFilters(): { name: string; extensions: string[] }[] {
  return supportedFormats
    .filter((f) => f.canImport)
    .map((f) => ({
      name: f.name,
      extensions: [f.extension],
    }));
}

export function getExportFilters(): { name: string; extensions: string[] }[] {
  return supportedFormats
    .filter((f) => f.canExport)
    .map((f) => ({
      name: f.name,
      extensions: [f.extension],
    }));
}
