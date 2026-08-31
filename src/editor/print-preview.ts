/**
 * F1.5 print surfaces (main-window side).
 *
 * ONE print surface: the sibling preview window. Both doors lead there:
 *  - openPrintPreview(view): the window shows the paginated document.
 *  - printDocumentNow(view): same, but the window opens the print panel by
 *    itself right after rendering (File > Print / Ctrl+P).
 *
 * The main window NEVER calls window.print() itself: in WebView2 the print
 * panel can re-navigate the calling webview, which would reload the editor
 * and lose the open document. The preview window is reload-proof (it
 * recognizes itself by its own label), so the panel bouncing there is
 * harmless. Closing the preview never touches the editor.
 *
 * Pagination source is calculatePageBreaks — the same engine driving the
 * live dividers (single-engine principle). See print-pages.ts for why print
 * paginates as a flow instead of fixed paper boxes.
 */
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { mkdir, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { EditorView } from "prosemirror-view";
import { getMargins } from "./pagination-state";
import { buildPrintPages, renderPrintBody, type PrintDoc } from "./print-pages";
import { embedImagesInDom } from "../formats/html";

export const PREVIEW_DIR = "aurawrite-print";
export const PREVIEW_FILE = "aurawrite-print/preview.json";
export const PREVIEW_LABEL = "print-preview";
export const PREVIEW_URL = "index.html?view=print-preview";

async function buildPrintDoc(view: EditorView): Promise<PrintDoc> {
  const doc = buildPrintPages(view.state.doc, getMargins());
  for (const sheet of doc.sheets) {
    const host = document.createElement("div");
    host.innerHTML = sheet.html;
    await embedImagesInDom(host);
    sheet.html = host.innerHTML;
  }
  return doc;
}

export function documentTitle(): string {
  try {
    const t = document.getElementById("document-title")?.textContent?.trim();
    if (t) return t;
  } catch { /* title bar not found: fall through */ }
  return "Document";
}

async function writeAndOpen(autoPrint: boolean): Promise<void> {
  const printDoc = await printDocCache;
  if (!printDoc) return;
  const payload = JSON.stringify({
    title: documentTitle(),
    autoPrint,
    generated: Date.now(),
    body: renderPrintBody(printDoc),
  });
  await mkdir(PREVIEW_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(PREVIEW_FILE, payload, { baseDir: BaseDirectory.AppData });
  const open = (await getAllWebviewWindows()).some((w) => w.label === PREVIEW_LABEL);
  if (open) {
    try {
      await emitTo(PREVIEW_LABEL, "aw:print-refresh", { autoPrint });
      return;
    } catch (e) {
      console.warn("[print] refresh emit failed:", e);
    }
  }
  new WebviewWindow(PREVIEW_LABEL, {
    url: PREVIEW_URL,
    title: `Print preview - ${documentTitle()}`,
    width: 1000,
    height: 900,
    center: true,
    resizable: true,
    focus: true,
  });
}

let printDocCache: Promise<PrintDoc> | null = null;

/** Build the print document, open the preview window, print on arrival. */
export async function printDocumentNow(view: EditorView): Promise<void> {
  printDocCache = buildPrintDoc(view);
  await writeAndOpen(true);
}

/** Build the print document and open the preview window for viewing. */
export async function openPrintPreview(view: EditorView): Promise<void> {
  printDocCache = buildPrintDoc(view);
  await writeAndOpen(false);
}
