// Ebook tree helpers (F2).
//
// Utilities for working with the ebook working-folder tree returned by the
// backend (`ebook_work_list`).

import type { EbookEntry } from "./types";

/** Collect every file (non-directory) entry in the tree, depth-first. */
export function collectFiles(entries: EbookEntry[]): EbookEntry[] {
  const out: EbookEntry[] = [];
  const walk = (entry: EbookEntry): void => {
    if (entry.is_dir) {
      for (const child of entry.children) walk(child);
    } else {
      out.push(entry);
    }
  };
  for (const entry of entries) walk(entry);
  return out;
}

/** Find an entry by its relative path. */
export function findEntry(entries: EbookEntry[], relativePath: string): EbookEntry | null {
  for (const entry of entries) {
    if (entry.relative_path === relativePath) return entry;
    if (entry.is_dir) {
      const found = findEntry(entry.children, relativePath);
      if (found) return found;
    }
  }
  return null;
}

/** Extension of a relative path, lowercased, without the dot. */
export function fileExtension(relativePath: string): string {
  const name = relativePath.split("/").pop() ?? "";
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

/** Whether the file is openable in the AuraWrite editor. */
export function isOpenableFile(entry: EbookEntry): boolean {
  if (entry.is_dir) return false;
  const ext = fileExtension(entry.relative_path);
  return (
    ext === "html" ||
    ext === "htm" ||
    ext === "xhtml" ||
    ext === "md" ||
    ext === "markdown" ||
    ext === "txt" ||
    ext === "json" ||
    ext === "docx"
  );
}
