import { invoke } from "@tauri-apps/api/core";
import { ocrAiListModels, ocrAiDownloadModel, ocrAiRemoveModel, ocrAiCheckVram, ocrAiDownloadResources, ocrAiRemoveResources, ocrAiLlamacppVariant } from "./ocr-ai-engine";

interface OcrLanguageInfo {
  code: string;
  name: string;
  installed: boolean;
  size_bytes: number;
  has_best: boolean;
  has_medium: boolean;
  has_fast: boolean;
}

interface OcrAiModelInfo {
  id: string;
  quantization: string;
  model_filename: string;
  model_path: string;
  model_present: boolean;
  model_size_bytes: number;
  mmproj_filename: string;
  mmproj_path: string;
  mmproj_present: boolean;
  mmproj_size_bytes: number;
}

let downloadingLang: string | null = null;
let downloadingAiModel: string | null = null;

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

function createAiModelRow(
  model: OcrAiModelInfo,
  isDownloading: boolean,
  downloadError: string | null,
): string {
  const totalSize = model.model_size_bytes + model.mmproj_size_bytes;
  const statusText = model.model_present && model.mmproj_present
    ? `Installed (${formatBytes(totalSize)})`
    : model.model_present
      ? `Model ready, mmproj missing`
      : "Not downloaded";
  const statusClass = model.model_present && model.mmproj_present
    ? "ocr-lang-status--installed"
    : model.model_present
      ? "ocr-lang-status--partial"
      : "ocr-lang-status--available";

  const canDownload = (!model.model_present || !model.mmproj_present) && !isDownloading;
  const canRemove = (model.model_present || model.mmproj_present) && !isDownloading;

  const errorHtml = downloadError
    ? `<span class="ocr-lang-error">${downloadError.replace(/</g, "&lt;")}</span>`
    : "";

  return `
    <div class="ocr-ai-model-row" data-model="${model.id}">
      <div class="ocr-lang-info">
        <span class="ocr-lang-name">LightOnOCR 2 1B (${model.quantization})</span>
        <span class="ocr-lang-status ${statusClass}">${statusText}</span>
        ${errorHtml}
      </div>
      <div class="ocr-lang-actions">
        ${canDownload ? `<button class="pref-btn pref-btn-primary ocr-ai-download" data-quant="${model.quantization}">Download</button>` : ""}
        ${isDownloading ? `<button class="pref-btn" disabled>Downloading...</button>` : ""}
        ${canRemove ? `<button class="pref-btn pref-btn-danger ocr-ai-remove" data-quant="${model.quantization}">Remove</button>` : ""}
      </div>
    </div>
  `;
}

export async function setupOcrPreferencesTab(): Promise<void> {
  const container = document.getElementById("ocr-lang-list");
  if (!container) return;

  const aiContainer = document.getElementById("ocr-ai-model-list");
  const vramInfo = document.getElementById("ocr-ai-vram-info");

  refreshOcrRuntimeStatus();

  const runtimeDownloadBtn = document.getElementById("ocr-ai-runtime-download") as HTMLButtonElement | null;
  const runtimeRemoveBtn = document.getElementById("ocr-ai-runtime-remove") as HTMLButtonElement | null;

  if (runtimeDownloadBtn && !runtimeDownloadBtn.dataset.listenerAdded) {
    runtimeDownloadBtn.dataset.listenerAdded = "1";
    runtimeDownloadBtn.addEventListener("click", async () => {
      runtimeDownloadBtn.disabled = true;
      runtimeDownloadBtn.textContent = "Downloading...";
      try {
        await ocrAiDownloadResources();
      } catch (e) {
        alert("Failed to download OCR AI runtime: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        runtimeDownloadBtn.disabled = false;
        runtimeDownloadBtn.textContent = "Download Runtime";
      }
      await refreshOcrRuntimeStatus();
    });
  }

  if (runtimeRemoveBtn && !runtimeRemoveBtn.dataset.listenerAdded) {
    runtimeRemoveBtn.dataset.listenerAdded = "1";
    runtimeRemoveBtn.addEventListener("click", async () => {
      if (!window.confirm("Remove OCR AI runtime? This removes llama.cpp for OCR AI. You can re-download it later.")) return;
      try {
        await ocrAiRemoveResources();
      } catch (e) {
        alert("Failed to remove OCR AI runtime: " + (e instanceof Error ? e.message : String(e)));
      }
      await refreshOcrRuntimeStatus();
    });
  }

  let langs: OcrLanguageInfo[] = [];
  try {
    langs = await invoke<OcrLanguageInfo[]>("ocr_list_languages");
  } catch (e) {
    container.innerHTML = `<p class="preference-hint" style="color:var(--color-error);">Error loading languages: ${e}</p>`;
    return;
  }

  renderOcrLanguages(container, langs);
  installOcrLangButtonHandlers();

  if (aiContainer) {
    try {
      const models = await ocrAiListModels();
      renderOcrAiModels(aiContainer, models);
      installOcrAiButtonHandlers();

      if (vramInfo) {
        try {
          const vram = await ocrAiCheckVram();
          if (vram.vram_available_bytes !== null) {
            const vramGb = (vram.vram_available_bytes / 1024 / 1024 / 1024).toFixed(1);
            vramInfo.textContent = vram.vram_sufficient
              ? `GPU VRAM: ${vramGb} GB (sufficient)`
              : `GPU VRAM: ${vramGb} GB (may be insufficient — need at least 3.1 GB free)`;
            vramInfo.style.color = vram.vram_sufficient ? "" : "var(--color-error)";
          } else {
            vramInfo.textContent = "No NVIDIA GPU detected — OCR AI will use CPU (slow)";
            vramInfo.style.color = "var(--color-error)";
          }
        } catch {
          vramInfo.textContent = "Could not detect GPU VRAM";
        }
      }
    } catch (e) {
      aiContainer.innerHTML = `<p class="preference-hint" style="color:var(--color-error);">Error loading AI models: ${e}</p>`;
    }
  }
}

function renderOcrLanguages(container: HTMLElement, langs: OcrLanguageInfo[]): void {
  let html = "";
  html += langs.map((l) => createLanguageRow(l, downloadingLang === l.code, null)).join("");
  container.innerHTML = html;
}

function renderOcrAiModels(container: HTMLElement, models: OcrAiModelInfo[]): void {
  let html = "";
  html += models.map((m) => createAiModelRow(m, downloadingAiModel === m.id, null)).join("");
  container.innerHTML = html;
}

let clickHandlerInstalled = false;
let aiClickHandlerInstalled = false;

function installOcrLangButtonHandlers(): void {
  const container = document.getElementById("ocr-lang-list");
  if (!container) return;
  if (clickHandlerInstalled) return;
  clickHandlerInstalled = true;
  container.addEventListener("click", handleOcrLangClick);
}

function installOcrAiButtonHandlers(): void {
  const container = document.getElementById("ocr-ai-model-list");
  if (!container) return;
  if (aiClickHandlerInstalled) return;
  aiClickHandlerInstalled = true;
  container.addEventListener("click", handleOcrAiClick);
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

async function handleOcrAiClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement;

  if (target.classList.contains("ocr-ai-download")) {
    const quant = target.getAttribute("data-quant");
    if (!quant || downloadingAiModel) return;

    downloadingAiModel = `lighton-ocr-2-1b-${quant.toLowerCase()}`;
    await refreshOcrAiModels();

    try {
      await ocrAiDownloadModel(quant);
      downloadingAiModel = null;
      await refreshOcrAiModels();
    } catch (err) {
      downloadingAiModel = null;
      const container = document.getElementById("ocr-ai-model-list");
      if (container) {
        const row = container.querySelector(`[data-model]`);
        if (row) {
          const errEl = document.createElement("span");
          errEl.className = "ocr-lang-error";
          errEl.textContent = String(err);
          row.querySelector(".ocr-lang-info")?.appendChild(errEl);
        }
      }
      await refreshOcrAiModels();
    }
  }

  if (target.classList.contains("ocr-ai-remove")) {
    const quant = target.getAttribute("data-quant");
    if (!quant) return;
    if (!window.confirm(`Remove LightOnOCR ${quant} model? You can re-download it later.`)) return;
    try {
      await ocrAiRemoveModel(quant);
      await refreshOcrAiModels();
    } catch (err) {
      alert(`Failed to remove model: ${err}`);
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

async function refreshOcrAiModels(): Promise<void> {
  const container = document.getElementById("ocr-ai-model-list");
  if (!container) return;
  try {
    const models = await ocrAiListModels();
    renderOcrAiModels(container, models);
  } catch {
    // ignore
  }
}

async function refreshOcrRuntimeStatus(): Promise<void> {
  const statusEl = document.getElementById("ocr-ai-runtime-status");
  const downloadBtn = document.getElementById("ocr-ai-runtime-download") as HTMLButtonElement | null;
  const removeBtn = document.getElementById("ocr-ai-runtime-remove") as HTMLButtonElement | null;
  if (!statusEl) return;

  try {
    const variant = await ocrAiLlamacppVariant();
    if (variant) {
      const label = variant === "cuda" ? "CUDA (NVIDIA)" : variant === "vulkan" ? "Vulkan" : variant === "metal" ? "Metal (Apple)" : variant;
      statusEl.textContent = `OCR AI runtime installed: ${label}`;
      statusEl.style.color = "#4caf50";
      if (downloadBtn) downloadBtn.style.display = "none";
      if (removeBtn) removeBtn.style.display = "";
    } else {
      statusEl.textContent = "OCR AI runtime not installed. Download it to enable AI-powered OCR.";
      statusEl.style.color = "";
      if (downloadBtn) downloadBtn.style.display = "";
      if (removeBtn) removeBtn.style.display = "none";
    }
  } catch {
    statusEl.textContent = "OCR AI runtime not installed.";
    statusEl.style.color = "";
    if (downloadBtn) downloadBtn.style.display = "";
    if (removeBtn) removeBtn.style.display = "none";
  }
}