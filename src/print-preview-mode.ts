/**
 * F1.5 print-preview window mode.
 *
 * The sibling window loads the SAME app page flagged with ?view=print-preview
 * (and recognizes itself by its window label, so it stays a preview even if
 * the print panel reloads it). main.ts branches here BEFORE booting the
 * editor: the editor process is never duplicated.
 */
import { readTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PREVIEW_FILE, PREVIEW_LABEL } from "./editor/print-preview";
import { PRINT_CSS_ALL } from "./editor/print-pages";

const SHELL_CSS = `
html.aw-pv, html.aw-pv body { height: 100%; margin: 0; }
html.aw-pv body { background: #e9e9ec; font: 13px/1.4 Inter, system-ui, "Segoe UI", sans-serif; color: #23232a; }
html.aw-pv #aw-pv-root { position: fixed; inset: 0; display: flex; flex-direction: column; }
html.aw-pv .pv-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #fff; border-bottom: 1px solid #d9d9de; flex: 0 0 auto; }
html.aw-pv .pv-title { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
html.aw-pv .pv-btn { appearance: none; border: 1px solid #d9d9de; background: #fff; color: #23232a; border-radius: 6px; padding: 6px 14px; font: 600 13px Inter, system-ui, sans-serif; cursor: pointer; }
html.aw-pv .pv-btn:hover { background: #f2f2f5; }
html.aw-pv .pv-btn--primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
html.aw-pv .pv-btn--primary:hover { background: #265cd0; }
html.aw-pv .pv-select { border: 1px solid #d9d9de; border-radius: 6px; padding: 5px 8px; background: #fff; font: 13px Inter, system-ui, sans-serif; }
html.aw-pv .pv-meta { color: #6b6b73; font-variant-numeric: tabular-nums; }
html.aw-pv .pv-stage { flex: 1 1 auto; overflow: auto; }
html.aw-pv .pv-empty { padding: 40px; text-align: center; color: #77777f; }
@media print {
  html.aw-pv .pv-bar { display: none !important; }
  html.aw-pv, html.aw-pv body { background: #fff !important; }
  html.aw-pv #aw-pv-root { position: static !important; display: block !important; }
  html.aw-pv .pv-stage { overflow: visible !important; padding: 0 !important; }
}
`;

function previewLabel(): string {
  try {
    return (getCurrentWindow() as unknown as { label?: string }).label || PREVIEW_LABEL;
  } catch {
    return PREVIEW_LABEL;
  }
}

/** True when this window is the print-preview surface (query OR label). */
export function isPrintPreviewSurface(): boolean {
  if (new URLSearchParams(window.location.search).get("view") === "print-preview") return true;
  const meta = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { windows?: string[]; currentWindow?: { label?: string } } };
  }).__TAURI_INTERNALS__;
  const label = meta?.metadata?.currentWindow?.label;
  return label === PREVIEW_LABEL;
}

export async function startPrintPreviewWindow(): Promise<void> {
  document.documentElement.classList.add("aw-pv");
  document.body.innerHTML = "";
  document.title = "Print preview";

  const style = document.createElement("style");
  style.id = "aw-print-css";
  style.textContent = `${SHELL_CSS}${PRINT_CSS_ALL}`;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "aw-pv-root";  root.innerHTML = `
    <header class="pv-bar">
      <span class="pv-title" id="pv-title">Print preview</span>
      <span class="pv-meta" id="pv-meta"></span>
      <label for="pv-zoom">Zoom</label>
      <select class="pv-select" id="pv-zoom">
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1" selected>100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
      </select>
      <button class="pv-btn pv-btn--primary" id="pv-print">Print</button>
      <button class="pv-btn" id="pv-close">Close</button>
    </header>
    <div class="pv-stage" id="pv-stage"><div class="pv-empty">Preparing preview…</div></div>
  `;
  document.body.appendChild(root);

  const stage = root.querySelector("#pv-stage") as HTMLElement;
  const titleEl = root.querySelector("#pv-title") as HTMLElement;
  const metaEl = root.querySelector("#pv-meta") as HTMLElement;
  const zoomSel = root.querySelector("#pv-zoom") as HTMLSelectElement;
  const printBtn = root.querySelector("#pv-print") as HTMLButtonElement;
  const closeBtn = root.querySelector("#pv-close") as HTMLButtonElement;
  const doc = document.createElement("div");
  doc.id = "aw-print-doc";

  function applyZoom(): void {
    doc.style.zoom = String(Number(zoomSel.value || "1"));
  }

  async function load(autoIfAsked: boolean): Promise<void> {
    let payload: { title?: string; body?: string; autoPrint?: boolean } | null = null;
    try {
      if (await exists(PREVIEW_FILE, { baseDir: BaseDirectory.AppData })) {
        payload = JSON.parse(await readTextFile(PREVIEW_FILE, { baseDir: BaseDirectory.AppData }));
      }
    } catch (e) {
      console.error("[print-preview] read failed:", e);
    }
    if (!payload?.body) {
      stage.innerHTML = '<div class="pv-empty">Nothing to preview yet.</div>';
      document.documentElement.removeAttribute("data-aw-preview");
      return;
    }
    titleEl.textContent = `Print preview - ${payload.title || "Document"}`;
    // If the user's print panel still has headers/footers on, the top-right
    // slot shows THIS title: keep it meaningful, never "undefined".
    document.title = `Print preview - ${payload.title || "Document"}`;
    metaEl.textContent = payload.body.split('class="aw-print-sheet"').length - 1 === 1
      ? "1 page"
      : `${payload.body.split('class="aw-print-sheet"').length - 1} pages`;
    stage.innerHTML = "";
    doc.className = "aw-print-visible";
    doc.innerHTML = payload.body;
    doc.style.zoom = "";
    stage.appendChild(doc);
    zoomSel.value = "1";
    applyZoom();
    document.documentElement.removeAttribute("data-aw-preview");
    if (autoIfAsked && payload.autoPrint) {
      window.setTimeout(() => triggerPrint(), 250);
    }
  }

  function triggerPrint(): void {
    try {
      window.focus();
      window.print();
    } catch (e) {
      console.error("[print-preview] print failed:", e);
    }
  }

  printBtn.addEventListener("click", triggerPrint);
  closeBtn.addEventListener("click", () => {
    void getCurrentWindow().close().catch(() => undefined);
  });
  zoomSel.addEventListener("change", applyZoom);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") void getCurrentWindow().close().catch(() => undefined);
    if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      triggerPrint();
    }
  });
  // The print panel can reload this webview; tell the editor we are alive so
  // it can rebuild the document (it holds the state, we do not).
  window.addEventListener("afterprint", () => {
    void emit("aw:print-closed", {}).catch(() => undefined);
  });
  void listen("aw:print-refresh", (ev) => {
    const p = ev.payload as { autoPrint?: boolean } | undefined;
    void load(p?.autoPrint !== false);
  }).catch(() => undefined);

  await load(true);
}

export const PRINT_PREVIEW_LABEL = PREVIEW_LABEL;
export { previewLabel };
