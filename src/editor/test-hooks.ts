/**
 * Test hooks — the doors the verification tool walks through.
 *
 * Why these exist: the tool must open a prepared document, show the print
 * preview and read back what the engine calculated, on command, without a hand
 * on the mouse. Those actions already exist in the program, but only as buttons
 * (and one of them, File > Open, behind a system dialog). The hooks call the
 * SAME functions the buttons call; they add no behaviour and change no pixel, so
 * what the tool measures is what a person would see.
 *
 * Where they are reachable from: only from inside the window, i.e. from a script
 * running in this webview. That is the same reach the AI panel already has, and
 * it requires the engine's remote-debugging port, which a normal launch never
 * opens (the tool opens it with an environment variable).
 *
 * One hook per commit, one test per hook — the discipline lives in
 * `wiki/concepts/verification-tools.md`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "prosemirror-view";
import { applyDocumentJson } from "./document-loader";
import { freeAnchorState } from "./free-layout-plugin";
import { freeWrapDiagnosis, freeWrapState, pageGeometry } from "./pagination-cassie-plugin";
import { calculatePageBreaks, getPageFormat, setPageFormat, PAGE_FORMATS } from "./pagination-cassie";
import { getMargins } from "./pagination-state";

/** What a hook answers: the tool never has to guess whether it worked. */
export interface HookResult {
  ok: boolean;
  error?: string;
  [extra: string]: unknown;
}

export interface TestHooks {
  /** Read a stored document (ProseMirror JSON) from `path` and open it. */
  openDocument(path: string): Promise<HookResult>;
  /**
   * The numbers as they are right now: the reservation pieces the screen has
   * measured and painted, and the ones the engine books (page breaks and the
   * band of every free element). Read-only.
   */
  measures(ricalcola?: boolean): HookResult;
  /**
   * The page frame as the screen has it: where every divider's text stopped,
   * where the next page's content must start, and how much the divider had to
   * fill. Read-only. One check answers "is every page exactly one page tall?".
   */
  pageFrame(): HookResult;
  /** Change the page format (a4 / a3 / letter) and measure again. */
  pageFormat(id?: string): HookResult;
}

declare global {
  interface Window {
    __aurawrite_test_hooks?: TestHooks;
  }
}

export function installTestHooks(view: EditorView): void {
  window.__aurawrite_test_hooks = {
    async openDocument(path: string): Promise<HookResult> {
      try {
        const text = await invoke<string>("load_document", { path });
        applyDocumentJson(view, text);
        return {
          ok: true,
          blocks: view.state.doc.childCount,
          words: view.state.doc.textContent.trim().split(/\s+/).filter(Boolean).length,
        };
      } catch (e) {
        return { ok: false, error: `${e}` };
      }
    },

    measures(ricalcola = false): HookResult {
      try {
        const screen = freeWrapState();
        // Su richiesta, la misura si fa ADESSO: e' il modo di distinguere "la
        // misura non trova niente" da "nessuno l'ha piu' chiesta".
        if (ricalcola) {
          window.dispatchEvent(new Event("aurawrite:editor-metrics-changed"));
        }
        const engine = calculatePageBreaks(view.state.doc, getMargins());
        return {
          ok: true,
          diagnosis: freeWrapDiagnosis(view),
          screen: {
            painted: screen.painted,
            republishLeft: screen.republishLeft,
            conta: screen.conta,
            bands: screen.bands.map((b) => ({
              pos: b.pos, insertPos: b.insertPos, marginTop: b.marginTop,
              side: b.side, widthPx: b.widthPx, heightPx: b.heightPx, full: b.full,
              // Su quali pagine dipinte la riserva accorcia davvero: piu' di un
              // numero vuol dire che scavalca un confine di pagina, e che il foglio
              // dopo riceve il suo pezzo invece di ricavarlo da se'.
              pagine: b.pieces.map((p) => p.page),
            })),
          },
          engine: {
            pages: engine.totalPages,
            breaks: engine.breaks.length,
            // Quante volte la regola della pagina ha gia' spostato un'immagine,
            // e se ne ha rifiutata una perche' il movimento tornava a chiedere
            // lo stesso spostamento (oscillazione).
            anchorFix: freeAnchorState(),
            free: engine.freeGeometry.map((g) => ({
              pos: g.pos, page: g.page, top: Math.round(g.top), anchorTop: Math.round(g.anchorTop),
              heightPx: Math.round(g.heightPx), level: g.level,
              band: g.band ? { side: g.band.side, widthPx: g.band.widthPx, y0: Math.round(g.band.y0), y1: Math.round(g.band.y1), insertPos: g.band.insertPos } : null,
            })),
          },
        };
      } catch (e) {
        return { ok: false, error: `${e}` };
      }
    },

    pageFrame(): HookResult {
      try {
        const format = getPageFormat();
        const margins = getMargins();
        const rows = pageGeometry();
        // "exact" means: the divider, as it is now, puts the next page's
        // content exactly on the line it must start from. No arithmetic is
        // left to the reader.
        const exact = rows.every(
          (r) => Math.abs(r.top + margins.bottom + r.fill + r.rest - r.wanted) < 1.5,
        );
        return {
          ok: true,
          format: {
            id: format.id,
            width: format.widthPx,
            height: format.heightPx,
            header: format.headerPx,
            footer: format.footerPx,
          },
          contentHeight:
            format.heightPx - margins.top - margins.bottom - format.headerPx - format.footerPx,
          margins,
          pages: rows.length + 1,
          frame: rows,
          exact,
        };
      } catch (e) {
        return { ok: false, error: `${e}` };
      }
    },

    pageFormat(id?: string): HookResult {
      try {
        if (id) setPageFormat(id);
        return { ok: true, current: getPageFormat().id, formats: Object.keys(PAGE_FORMATS) };
      } catch (e) {
        return { ok: false, error: `${e}` };
      }
    },
  };
}
