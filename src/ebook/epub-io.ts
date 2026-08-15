// EPUB I/O for the Ebooks feature (F2).
//
// Responsibilities:
//   - wrap the Tauri commands used by the Ebooks panel (working folders,
//     metadata, file writing/reading);
//   - import an EPUB: decompress the archive and copy it byte-for-byte into the
//     ebook working folder (`<app_data>/ebook-work/<folder>/`);
//   - export an EPUB: repack the working folder into a valid EPUB file
//     (the `mimetype` entry is written first and uncompressed);
//   - rewrite relative image srcs inside chapter XHTML into absolute paths so
//     the existing image rendering pipeline can display them.

import JSZip from "jszip";
import { invoke } from "@tauri-apps/api/core";
import { EBOOK_META_FILENAME, type EbookEntry, type EbookMeta } from "./types";

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

export async function ebookWorkDir(folder: string): Promise<string> {
  return await invoke<string>("ebook_work_dir", { folder });
}

export async function ebookListAll(): Promise<string[]> {
  return await invoke<string[]>("ebook_list_all");
}

export async function ebookWorkList(folder: string): Promise<EbookEntry[]> {
  return await invoke<EbookEntry[]>("ebook_work_list", { folder });
}

export async function ebookWorkDelete(folder: string): Promise<void> {
  await invoke("ebook_work_delete", { folder });
}

async function vaultCreateDir(path: string): Promise<void> {
  await invoke("vault_create_dir", { path });
}

async function vaultWriteFileBytes(path: string, base64: string): Promise<void> {
  await invoke("vault_write_file_bytes", { path, base64 });
}

async function loadDocument(path: string): Promise<string> {
  return await invoke<string>("load_document", { path });
}

async function loadBinaryFile(path: string): Promise<Uint8Array> {
  const base64 = await invoke<string>("load_binary_file", { path });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function saveDocument(path: string, content: string): Promise<void> {
  await invoke("save_document", { path, content });
}

/** Read a text file from disk (used to open files in CodeMirror). */
export async function readFileText(path: string): Promise<string> {
  return await loadDocument(path);
}

/** Write a text file to disk (used to save CodeMirror files). */
export async function writeFileText(path: string, content: string): Promise<void> {
  await saveDocument(path, content);
}

async function saveBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("save_binary_file", { path, base64Content: bytesToBase64(bytes) });
}

// ---------------------------------------------------------------------------
// Path and bytes helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a relative path coming from an EPUB archive against traversal and
 * Windows-illegal characters. Names are preserved as-is (including accents and
 * Unicode) so the book structure is copied byte-for-byte; only `..` segments,
 * empty segments and the characters `<>:"|?*` plus control chars are removed
 * or replaced, so the path stays safe on every OS.
 */
export function sanitizeEpubRelativePath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const safe: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") continue;
    safe.push(part.replace(/[<>:"|?*\x00-\x1f]/g, "_")); // eslint-disable-line no-control-regex
  }
  return safe.join("/");
}

/**
 * Sanitize an ebook working-folder name exactly like the backend does
 * (alphanumeric + `-` + `_` only). Used for collision checks so the frontend
 * and backend agree on the actual folder name.
 */
export function sanitizeFolderName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/**
 * Resolve a relative path against a base directory, normalizing `..` segments.
 * Uses the base directory separator style.
 */
export function resolveRelativePath(baseDir: string, rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  const sep = baseDir.includes("\\") ? "\\" : "/";
  const joined = out.join(sep);
  if (baseDir.endsWith("\\") || baseDir.endsWith("/")) return baseDir + joined;
  return baseDir + sep + joined;
}

// ---------------------------------------------------------------------------
// Ebook metadata
// ---------------------------------------------------------------------------

export async function readEbookMeta(folder: string): Promise<EbookMeta | null> {
  try {
    const dir = await ebookWorkDir(folder);
    const raw = await loadDocument(`${dir}/${EBOOK_META_FILENAME}`);
    return JSON.parse(raw) as EbookMeta;
  } catch {
    return null;
  }
}

export async function writeEbookMeta(folder: string, meta: EbookMeta): Promise<void> {
  const dir = await ebookWorkDir(folder);
  await saveDocument(`${dir}/${EBOOK_META_FILENAME}`, JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
// Import: extract an EPUB into its working folder
// ---------------------------------------------------------------------------

export interface ImportResult {
  folder: string;
  filesWritten: number;
}

export async function importEpub(arrayBuffer: ArrayBuffer, folder: string): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files: string[] = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  const workDir = await ebookWorkDir(folder);

  // Create all needed directories first (the write command requires parents).
  const dirs = new Set<string>();
  for (const name of files) {
    const safe = sanitizeEpubRelativePath(name);
    if (!safe) continue;
    const parts = safe.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const d of dirs) await vaultCreateDir(`${workDir}/${d}`);

  let filesWritten = 0;
  for (const name of files) {
    const safe = sanitizeEpubRelativePath(name);
    if (!safe) continue;
    const data = await zip.files[name].async("uint8array");
    await vaultWriteFileBytes(`${workDir}/${safe}`, bytesToBase64(data));
    filesWritten++;
  }

  await writeEbookMeta(folder, { name: folder, color: undefined });
  return { folder, filesWritten };
}

// ---------------------------------------------------------------------------
// Export: repack the working folder into an EPUB
// ---------------------------------------------------------------------------

export async function exportEpub(folder: string, destPath: string): Promise<void> {
  const workDir = await ebookWorkDir(folder);
  const tree = await ebookWorkList(folder);

  const zip = new JSZip();

  const addEntry = async (entry: EbookEntry, parent: JSZip): Promise<void> => {
    if (entry.is_dir) {
      const dir = parent.folder(entry.name);
      if (dir) {
        for (const child of entry.children) await addEntry(child, dir);
      }
    } else {
      const data = await loadBinaryFile(`${workDir}/${entry.relative_path}`);
      parent.file(entry.name, data);
    }
  };

  // The EPUB `mimetype` entry must be first and stored uncompressed. JSZip
  // writes files in insertion order, so handle `mimetype` explicitly first.
  const rootFiles = tree.filter((e) => !e.is_dir);
  const mimetypeIdx = rootFiles.findIndex((e) => e.name === "mimetype");
  if (mimetypeIdx !== -1) {
    const m = rootFiles[mimetypeIdx];
    const data = await loadBinaryFile(`${workDir}/${m.relative_path}`);
    zip.file(m.name, data, { compression: "STORE" });
  }

  const dirs = tree.filter((e) => e.is_dir);
  for (const entry of dirs) await addEntry(entry, zip);
  for (const entry of rootFiles) {
    if (entry.name === "mimetype") continue;
    const data = await loadBinaryFile(`${workDir}/${entry.relative_path}`);
    zip.file(entry.name, data);
  }

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  await saveBinaryFile(destPath, out);
}

// ---------------------------------------------------------------------------
// Image src rewriting for chapter XHTML
// ---------------------------------------------------------------------------

/**
 * Rewrite relative image srcs inside a chapter's XHTML to absolute paths
 * resolved against the working folder, so the existing image pipeline
 * (`resolveImageSrc` → `convertFileSrc`) can display them. Scheme-bearing and
 * already-absolute srcs are left untouched.
 */
export function rewriteRelativeImageSrcs(html: string, baseDir: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = doc.querySelectorAll("img");
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute("src");
    if (!src) continue;
    if (/^(https?:|data:|blob:|file:|tauri:|asset:)/i.test(src)) continue;
    if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith("/")) continue;
    img.setAttribute("src", resolveRelativePath(baseDir, src));
  }
  return doc.documentElement.outerHTML;
}
