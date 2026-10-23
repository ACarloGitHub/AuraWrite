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
import { freeWrapState, refreshFreeWrapBands } from "./pagination-cassie-plugin";
import { freeLayoutMap, parseFreeSpec } from "./free-layout";
import { buildPrintPages, renderPrintBody, type PrintDoc } from "./print-pages";
import { embedImagesInDom } from "../formats/html";

export const PREVIEW_DIR = "aurawrite-print";
export const PREVIEW_FILE = "aurawrite-print/preview.json";
export const PREVIEW_LABEL = "print-preview";
export const PREVIEW_URL = "index.html?view=print-preview";

/** Wait n animation frames (the free-element painter works on one). */
function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const tick = (): void => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function buildPrintDoc(view: EditorView): Promise<PrintDoc> {
  // Il foglio ricostruisce la pagina dell'editor, quindi ha bisogno dei numeri
  // che l'editor ha misurato. Aprire l'anteprima (o stampare) e' un'azione voluta,
  // non una battuta di tasto: qui si chiede la misura ADESSO e si concede il
  // ridisegno anche se l'allowance era finita, cosi' il foglio viene costruito
  // sui numeri che la pagina di AuraWrite sta mostrando in questo momento - mai
  // su numeri che lo schermo non ha.
  refreshFreeWrapBands(view, { force: true });
  // The publish moves the text; the text moves the pictures, and the painter
  // puts them back on the NEXT FRAME (free-layout-plugin schedules a rAF). The
  // sheets must be built after that, or they leave with positions the editor no
  // longer shows - the reason opening the preview used to move the photo in the
  // editor while the two windows disagreed. Measured 2026-10-23 on L01.
  await waitFrames(2);
  // The geometry is now the one on screen: one more measurement photographs it.
  refreshFreeWrapBands(view, { force: true });
  await waitFrames(1);
  // Lo spazio riservato al testo sul foglio viene dalle fasce MISURATE sulla
  // pagina dell'editor: e' la richiesta di Carlo (17-09) - il foglio
  // ricostruisce la pagina di AuraWrite, non la rifa' per conto suo.
  const doc = buildPrintPages(view.state.doc, getMargins(), freeWrapState().bands);
  for (const sheet of doc.sheets) {
    const host = document.createElement("div");
    host.innerHTML = sheet.html;
    await embedImagesInDom(host);
    sheet.html = host.innerHTML;
    // The free overlay carries the same images: without this pass, a free
    // element would print with broken sources while the same picture on the
    // page shows fine (F3.2).
    if (sheet.freeHtml) {
      const freeHost = document.createElement("div");
      freeHost.innerHTML = sheet.freeHtml;
      await embedImagesInDom(freeHost);
      sheet.freeHtml = freeHost.innerHTML;
    }
  }
  return doc;
}

/**
 * Dove l'editor ha appeso ogni elemento libero (`anchorPos`) e di quanto l'ha
 * spostato (`yOff`): all'anteprima servono per mettere l'elemento alla stessa
 * altezza, rispetto alla riga disegnata, invece di usare la posizione calcolata
 * (misurato il 17-09: con quella finiva 17-26 pixel piu' in basso).
 */
export function freePlacement(view: EditorView): { pos: number; anchorPos: number; yOff: number }[] {
  const out: { pos: number; anchorPos: number; yOff: number }[] = [];
  for (const { pos, anchorPos } of freeLayoutMap(view.state.doc)) {
    if (anchorPos === null) continue;
    const node = view.state.doc.nodeAt(pos);
    const spec = node ? parseFreeSpec(node.attrs?.free) : null;
    out.push({ pos, anchorPos, yOff: spec ? spec.yOff : 0 });
  }
  return out;
}

export function documentTitle(): string {
  try {
    const t = document.getElementById("document-title")?.textContent?.trim();
    if (t) return t;
  } catch { /* title bar not found: fall through */ }
  return "Document";
}

async function writeAndOpen(
  autoPrint: boolean,
  placement: { pos: number; anchorPos: number; yOff: number }[],
  printDoc: PrintDoc,
): Promise<void> {
  const payload = JSON.stringify({
    title: documentTitle(),
    autoPrint,
    generated: Date.now(),
    freePlacement: placement,
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

/** Build the print document, open the preview window, print on arrival. */
export async function printDocumentNow(view: EditorView): Promise<void> {
  // The anchors are read AFTER the build: the build waits for the repaint that
  // settles the free elements, so this is the geometry the editor is showing.
  const doc = await buildPrintDoc(view);
  await writeAndOpen(true, freePlacement(view), doc);
}

/** Build the print document and open the preview window for viewing. */
export async function openPrintPreview(view: EditorView): Promise<void> {
  const doc = await buildPrintDoc(view);
  await writeAndOpen(false, freePlacement(view), doc);
}
