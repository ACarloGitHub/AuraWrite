// Audiobook Generator integration (R2) — AuraWrite side.
//
// Orchestrates the "Export to Audiobook Generator" flow. It is shared by three
// entry points with the same logic:
//   - Editor: the headphones button is shown only when an ebook is selected in
//     the Ebooks > Editor tree and exports exactly that book (repacked).
//   - Reader: the headphones button lives in the viewer bar and exports the
//     book being read (its original file, no repacking).
//   - File menu: uses a selected Editor ebook if any, otherwise lets the user
//     pick a file.
// The backend writes the proposal + visit card + catalog and opens the external
// app; `found: false` means Audiobook Generator is not installed, so the
// download info dialog is shown.

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exportEpub } from "../ebook/epub-io";

export interface AudiobookExportResult {
  found: boolean;
  opened: boolean;
}

export type AudiobookExportInput =
  | { ebookPath: string }
  | { folder: string };

const INFO_KEY = "aurawrite-audiobook-gen-info-seen";
const DOWNLOAD_URL = "https://github.com/ACarloGitHub/Audiobook-Generator/releases";

/** Main entry point, shared by the panel (Editor/Reader) and the File menu. */
export async function exportToAudiobookGenerator(input?: AudiobookExportInput): Promise<void> {
  const firstTime = !localStorage.getItem(INFO_KEY);

  const ebookPath = await resolveEbookPath(input);
  if (!ebookPath) return;

  let result: AudiobookExportResult;
  try {
    result = await invoke<AudiobookExportResult>("audiobook_generator_export", { ebookPath });
  } catch (e) {
    console.error("[audiobook-gen] export failed:", e);
    return;
  }

  if (!result.found) {
    // Not installed: a single dialog with the download link (and the explanation).
    showInfoDialog(true, input);
    return;
  }
  if (firstTime) {
    // Installed, first use: one informative dialog only.
    showInfoDialog(false, input);
  }
}

/** Determine the ebook to hand over, depending on the entry point. */
async function resolveEbookPath(input?: AudiobookExportInput): Promise<string | null> {
  if (input && "ebookPath" in input) {
    // Reader: original registered file, no repacking.
    return input.ebookPath;
  }
  if (input && "folder" in input) {
    // Editor: repack the selected ebook.
    return repackFolder(input.folder);
  }
  // File menu: use a selected Editor ebook if any, otherwise pick a file.
  const { getSelectedEbookFolder } = await import("../ebook/panel");
  const folder = getSelectedEbookFolder();
  if (folder) return repackFolder(folder);
  return pickEbookFile();
}

/** Ask where to save the repacked ebook and return the chosen path. */
async function repackFolder(folder: string): Promise<string | null> {
  const dest = await save({
    defaultPath: `${folder}.epub`,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  if (!dest) return null;
  try {
    await exportEpub(folder, dest);
    return dest;
  } catch (e) {
    console.error("[audiobook-gen] failed to repack ebook:", e);
    return null;
  }
}

/** Let the user pick an ebook file. */
async function pickEbookFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "EPUB", extensions: ["epub"] }],
  });
  return typeof picked === "string" ? picked : null;
}

/**
 * Info dialog (English, Ebook Editor style) explaining the integration.
 * `withDownloadLink` adds the "not installed" download paragraph and the
 * "choose the app manually" button. `input` lets the user retry the export
 * right after choosing a manual app path.
 */
function showInfoDialog(withDownloadLink: boolean, input?: AudiobookExportInput): void {
  const overlay = document.createElement("div");
  overlay.className = "ebook-info-overlay";
  overlay.innerHTML = `
    <div class="ebook-info-dialog">
      <h3>Export to Audiobook Generator</h3>
      <p>AuraWrite integrates with <strong>Audiobook Generator</strong>, a program that turns ebooks into audiobooks.</p>
      <p>When you export, AuraWrite opens Audiobook Generator with your book ready: you choose the text-to-speech engine, decide which chapters to process, pick where to save the audiobook, and enjoy the result. It also has a "demo" and "test" section to check the voice quality before the final export.</p>
      <p>Remember: Audiobook Generator works with <strong>local models</strong> that run on your GPU. If you have other AI models loaded in your GPU memory, make sure you have enough memory available before starting an export.</p>
      ${
        withDownloadLink
          ? `<p><strong>Audiobook Generator does not seem to be installed on this computer.</strong> Download and install it from <a href="${DOWNLOAD_URL}" target="_blank" rel="noopener">${DOWNLOAD_URL}</a>, then click "Export to Audiobook Generator" again.</p>
             <p>If you already installed it in a custom location, you can choose the app executable manually:</p>`
          : ""
      }
      <p id="audiobook-gen-error" style="display:none;color:#e06c6c;"></p>
      <label class="ebook-info-option">
        <input type="checkbox" id="audiobook-gen-dont-show" />
        Don't show again
      </label>
      <div class="ebook-info-buttons">
        ${
          withDownloadLink
            ? `<button class="ebook-info-ok" id="audiobook-gen-choose">Choose the app manually…</button>`
            : ""
        }
        <button class="ebook-info-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector(".ebook-info-ok")?.addEventListener("click", () => {
    const dontShow = (overlay.querySelector("#audiobook-gen-dont-show") as HTMLInputElement | null)?.checked;
    if (dontShow) localStorage.setItem(INFO_KEY, "1");
    overlay.remove();
  });
  overlay.querySelector("#audiobook-gen-choose")?.addEventListener("click", async () => {
    const picked = await open({ multiple: false });
    if (!picked || typeof picked !== "string") return;
    try {
      await invoke("audiobook_generator_set_path", { path: picked });
      overlay.remove();
      void exportToAudiobookGenerator(input);
    } catch (e) {
      const errorEl = overlay.querySelector("#audiobook-gen-error") as HTMLElement | null;
      if (errorEl) {
        errorEl.textContent = typeof e === "string" ? e : "Could not use the chosen file.";
        errorEl.style.display = "block";
      }
    }
  });
  overlay.querySelector("a")?.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(DOWNLOAD_URL, "_blank", "noopener");
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
