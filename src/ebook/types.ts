// Shared types for the Ebooks feature (F2).

/** One node of the ebook working-folder tree (mirrors the Rust EbookEntry). */
export interface EbookEntry {
  name: string;
  relative_path: string;
  is_dir: boolean;
  children: EbookEntry[];
}

/** Metadata stored inside each ebook working folder. */
export interface EbookMeta {
  /** Display name shown in the Ebooks panel. */
  name: string;
  /** Optional accent background color. */
  color?: string;
  /** Optional text color used with the accent background. */
  textColor?: string;
}

/** Filename used for the metadata file inside an ebook working folder. */
export const EBOOK_META_FILENAME = "ebook.json";
