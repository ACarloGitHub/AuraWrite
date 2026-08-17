// Reader library I/O — "Ebooks" Reader tab.
//
// The Reader does not copy the user's ebook: it only registers its path in
// `<app_data>/reader-books.json`. For reading, the EPUB is unpacked on the fly
// into `<app_data>/ebook-reader/<book-id>/` so chapters and images can be
// shown without touching the original file.

import JSZip from "jszip";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { sanitizeEpubRelativePath } from "./epub-io";

/** One entry of the Reader books list (a path registered, not a copy). */
export interface ReaderBook {
  /** Stable identifier, also used as the reading-folder name. */
  id: string;
  /** Absolute path of the original ebook file on disk. */
  path: string;
  /** Display name shown in the Reader list. */
  name: string;
  /** Optional accent background color. */
  color?: string;
  /** Optional text color used with the accent background. */
  textColor?: string;
}

/** One chapter of the reading order (spine), for the Reader index. */
export interface ReaderChapter {
  title: string;
  /** Path relative to the reading folder (using `/` as separator). */
  href: string;
}

/** One bookmark of a Reader book (a saved reading position). */
export interface ReaderBookmark {
  id: string;
  /** Optional label shown in the bookmarks list. */
  name: string;
  chapterIndex: number;
  /** Vertical scroll ratio inside the chapter (0..1). */
  scrollRatio: number;
  /** Id assigned to the target element inside the chapter (when captured). */
  anchorId?: string;
  /** Child-index path from the chapter content root to the target element. */
  path?: number[];
}

/** Per-book reading state (position + bookmarks). */
export interface ReaderBookState {
  chapterIndex: number;
  /** Vertical scroll ratio inside the current chapter (0..1). */
  scrollRatio: number;
  bookmarks: ReaderBookmark[];
}

/** Reading settings applied to the whole book by the reader toolbar. */
export interface ReaderSettings {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
}

export const READER_SETTINGS_KEY = "aurawrite-reader-settings";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: "",
  fontSize: "16px",
  lineHeight: "1.5",
};

export async function readerBooksLoad(): Promise<ReaderBook[]> {
  const raw = await invoke<string>("reader_books_load");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReaderBook[]) : [];
  } catch {
    return [];
  }
}

export async function readerBooksSave(books: ReaderBook[]): Promise<void> {
  await invoke("reader_books_save", { books: JSON.stringify(books) });
}

/** Load the reading state map (bookId -> position + bookmarks). */
export async function readerStateLoad(): Promise<Record<string, ReaderBookState>> {
  const raw = await invoke<string>("reader_state_load");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ReaderBookState>) : {};
  } catch {
    return {};
  }
}

/** Persist the reading state map. */
export async function readerStateSave(state: Record<string, ReaderBookState>): Promise<void> {
  await invoke("reader_state_save", { state: JSON.stringify(state) });
}

/** Load the global reader settings (font, size, line height) from localStorage. */
export function readerSettingsLoad(): ReaderSettings {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return { ...DEFAULT_READER_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

/** Persist the global reader settings in localStorage. */
export function readerSettingsSave(settings: ReaderSettings): void {
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
}

/** Convert an absolute path into an asset:// URL the webview can load. */
export function assetUrl(absPath: string): string {
  return convertFileSrc(absPath);
}

// ---------------------------------------------------------------------------
// Deobfuscation of embedded EPUB fonts
// ---------------------------------------------------------------------------

const OBFUSCATION_ALGORITHM = "http://www.idpf.org/2008/embedding";

/**
 * Deobfuscate the embedded fonts of an EPUB reading folder, if the book
 * declares obfuscated fonts in `META-INF/encryption.xml`. The key is the
 * SHA-1 digest of the book's unique identifier (XML whitespace removed); the
 * first 1040 bytes of each font are XOR-ed with the 20-byte key, cyclically.
 * Files are overwritten in the (private) reading folder.
 */
export async function deobfuscateReaderFonts(dir: string, identifier: string): Promise<void> {
  if (!identifier) return;
  let xml = "";
  try {
    xml = await readFileText(`${dir}/META-INF/encryption.xml`);
  } catch {
    return;
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const targets: string[] = [];
  for (const ed of Array.from(doc.querySelectorAll("EncryptedData"))) {
    const method = ed.querySelector("EncryptionMethod");
    if (method?.getAttribute("Algorithm") !== OBFUSCATION_ALGORITHM) continue;
    const uri = ed.querySelector("CipherReference")?.getAttribute("URI");
    if (uri) targets.push(uri.replace(/^\/+/, ""));
  }
  if (!targets.length) return;

  // Key: SHA-1 of the unique identifier with all XML whitespace removed.
  let clean = "";
  for (const ch of identifier) {
    const code = ch.codePointAt(0) ?? 0;
    if (code !== 0x20 && code !== 0x09 && code !== 0x0d && code !== 0x0a) clean += ch;
  }
  const key = await sha1Bytes(clean);
  for (const rel of targets) {
    let bytes: Uint8Array;
    try {
      bytes = await loadBinaryFile(`${dir}/${rel}`);
    } catch {
      continue;
    }
    const limit = Math.min(1040, bytes.length);
    for (let i = 0; i < limit; i++) bytes[i] ^= key[i % 20];
    try {
      await saveBinaryFile(`${dir}/${rel}`, bytes);
    } catch {
      // best effort: a deobfuscation failure leaves the original file
    }
  }
}

async function sha1Bytes(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return new Uint8Array(digest);
}

async function saveBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("save_binary_file", { path, base64Content: bytesToBase64(bytes) });
}

/** Create (if needed) and return the reading folder for a book id. */
export async function readerWorkDir(id: string): Promise<string> {
  return await invoke<string>("ebook_reader_dir", { id });
}

/** Delete the reading folder for a book id (never touches the original). */
export async function readerWorkDelete(id: string): Promise<void> {
  await invoke("ebook_reader_delete", { id });
}

/** Check whether a path exists on disk: "file" | "dir" | "missing". */
export async function pathStatus(path: string): Promise<"file" | "dir" | "missing"> {
  return (await invoke<string>("vault_check_path", { path })) as "file" | "dir" | "missing";
}

/** Read a text file from disk. */
export async function readFileText(path: string): Promise<string> {
  return await invoke<string>("load_document", { path });
}

/** Read a binary file from disk. */
export async function loadBinaryFile(path: string): Promise<Uint8Array> {
  const base64 = await invoke<string>("load_binary_file", { path });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function vaultCreateDir(path: string): Promise<void> {
  await invoke("vault_create_dir", { path });
}

async function vaultWriteFileBytes(path: string, base64: string): Promise<void> {
  await invoke("vault_write_file_bytes", { path, base64 });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** Unpack an EPUB into the reading folder for the given book id. */
export async function extractReaderEpub(arrayBuffer: ArrayBuffer, id: string): Promise<void> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files: string[] = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const dir = await readerWorkDir(id);

  const dirs = new Set<string>();
  for (const name of files) {
    const safe = sanitizeEpubRelativePath(name);
    if (!safe) continue;
    const parts = safe.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const d of dirs) await vaultCreateDir(`${dir}/${d}`);

  for (const name of files) {
    const safe = sanitizeEpubRelativePath(name);
    if (!safe) continue;
    const data = await zip.files[name].async("uint8array");
    await vaultWriteFileBytes(`${dir}/${safe}`, bytesToBase64(data));
  }
}

/** Read the EPUB reading order (spine) from an unpacked reading folder. */
export async function readReaderSpine(dir: string): Promise<ReaderChapter[]> {
  let containerXml: string;
  try {
    containerXml = await readFileText(`${dir}/META-INF/container.xml`);
  } catch {
    return [];
  }
  const container = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = container.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) return [];

  let opfXml: string;
  try {
    opfXml = await readFileText(`${dir}/${opfPath}`);
  } catch {
    return [];
  }
  const opf = new DOMParser().parseFromString(opfXml, "application/xml");

  const manifest = new Map<string, string>();
  opf.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  });

  const chapters: ReaderChapter[] = [];
  opf.querySelectorAll("spine > itemref").forEach((ref) => {
    const idref = ref.getAttribute("idref");
    if (!idref) return;
    const href = manifest.get(idref);
    if (!href) return;
    const title = href.split("/").pop()?.replace(/\.[^.]+$/, "") || href;
    chapters.push({ title, href });
  });
  return chapters;
}
