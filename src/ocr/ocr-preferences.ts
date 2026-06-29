import { invoke } from "@tauri-apps/api/core";

interface OcrLanguageInfo {
  code: string;
  name: string;
  installed: boolean;
  size_bytes: number;
  has_best: boolean;
  has_medium: boolean;
  has_fast: boolean;
}

let downloadingLang: string | null = null;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function installStatusLabel(lang: OcrLanguageInfo): string {
  const installed: string[] = [];
  const missing: string[] = [];
  if (lang.has_best) installed.push("Best");
  else missing.push("Best");
  if (lang.has_medium) installed.push("Medium");
  else missing.push("Medium");
  if (lang.has_fast) installed.push("Fast");
  else missing.push("Fast");
  if (lang.installed) {
    return `Installed (${formatBytes(lang.size_bytes)})`;
  }
  return `Missing: ${missing.join(", ")}`;
}

function installStatusClass(lang: OcrLanguageInfo): string {
  if (lang.installed) return "ocr-lang-status--installed";
  if (lang.has_best || lang.has_medium || lang.has_fast) return "ocr-lang-status--partial";
  return "ocr-lang-status--available";
}

function createLanguageRow(
  lang: OcrLanguageInfo,
  isDownloading: boolean,
  downloadError: string | null,
): string {
  const statusText = installStatusLabel(lang);
  const statusClass = installStatusClass(lang);

  const canDownload = !lang.installed && !isDownloading;
  const canRemove = (lang.installed || lang.has_best || lang.has_medium || lang.has_fast) && !isDownloading;

  const errorHtml = downloadError
    ? `<span class="ocr-lang-error">${downloadError.replace(/</g, "&lt;")}</span>`
    : "";

  return `
    <div class="ocr-lang-row" data-lang="${lang.code}">
      <div class="ocr-lang-info">
        <span class="ocr-lang-name">${lang.name}</span>
        <span class="ocr-lang-code">(${lang.code})</span>
        <span class="ocr-lang-status ${statusClass}">${statusText}</span>
        ${errorHtml}
      </div>
      <div class="ocr-lang-actions">
        ${canDownload ? `<button class="pref-btn pref-btn-primary ocr-lang-download" data-lang="${lang.code}">Download (3)</button>` : ""}
        ${isDownloading ? `<button class="pref-btn" disabled>Downloading...</button>` : ""}
        ${canRemove ? `<button class="pref-btn pref-btn-danger ocr-lang-remove" data-lang="${lang.code}">Remove</button>` : ""}
      </div>
    </div>
  `;
}

export async function setupOcrPreferencesTab(): Promise<void> {
  const container = document.getElementById("ocr-lang-list");
  if (!container) return;

  let langs: OcrLanguageInfo[] = [];
  try {
    langs = await invoke<OcrLanguageInfo[]>("ocr_list_languages");
  } catch (e) {
    container.innerHTML = `<p class="preference-hint" style="color:var(--color-error);">Error loading languages: ${e}</p>`;
    return;
  }

  renderOcrLanguages(container, langs);
  installOcrLangButtonHandlers();
}

function renderOcrLanguages(container: HTMLElement, langs: OcrLanguageInfo[]): void {
  let html = "";
  html += langs.map((l) => createLanguageRow(l, downloadingLang === l.code, null)).join("");
  container.innerHTML = html;
}

let clickHandlerInstalled = false;

function installOcrLangButtonHandlers(): void {
  const container = document.getElementById("ocr-lang-list");
  if (!container) return;
  if (clickHandlerInstalled) return;
  clickHandlerInstalled = true;
  container.addEventListener("click", handleOcrLangClick);
}

async function handleOcrLangClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement;

  if (target.classList.contains("ocr-lang-download")) {
    const lang = target.getAttribute("data-lang");
    if (!lang || downloadingLang) return;

    downloadingLang = lang;
    await refreshOcrLanguages();

    try {
      await invoke("ocr_download_language", { lang });
      downloadingLang = null;
      await refreshOcrLanguages();
    } catch (err) {
      downloadingLang = null;
      const container = document.getElementById("ocr-lang-list");
      if (container) {
        const row = container.querySelector(`[data-lang="${lang}"]`);
        if (row) {
          const errEl = document.createElement("span");
          errEl.className = "ocr-lang-error";
          errEl.textContent = String(err);
          row.querySelector(".ocr-lang-info")?.appendChild(errEl);
        }
      }
      await refreshOcrLanguages();
    }
  }

  if (target.classList.contains("ocr-lang-remove")) {
    const lang = target.getAttribute("data-lang");
    if (!lang) return;
    if (!window.confirm(`Remove ${lang} language data? You can re-download it later.`)) return;
    try {
      await invoke("ocr_remove_language", { lang });
      await refreshOcrLanguages();
    } catch (err) {
      alert(`Failed to remove language: ${err}`);
    }
  }
}

async function refreshOcrLanguages(): Promise<void> {
  const container = document.getElementById("ocr-lang-list");
  if (!container) return;
  try {
    const langs = await invoke<OcrLanguageInfo[]>("ocr_list_languages");
    renderOcrLanguages(container, langs);
  } catch {
    // ignore
  }
}