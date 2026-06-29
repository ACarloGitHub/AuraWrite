import { invoke } from "@tauri-apps/api/core";
import { ocrAiDownloadModel, ocrAiCheckVram } from "./ocr-ai-engine";

const WIZARD_KEY = "aurawrite-ocr-ai-wizard-dismissed";

type VramInfo = {
  vram_available_bytes: number | null;
  vram_sufficient: boolean;
};

export function shouldShowOcrAiWizard(): boolean {
  return !localStorage.getItem(WIZARD_KEY);
}

export function showOcrAiWizard(): void {
  const modal = document.getElementById("ocr-ai-wizard-modal");
  if (!modal) return;
  modal.classList.remove("hidden");

  document.getElementById("ocr-ai-wizard-close")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    modal.classList.add("hidden");
  });
  document.getElementById("ocr-ai-wizard-skip")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    modal.classList.add("hidden");
  });
  modal.querySelector(".modal-overlay")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    modal.classList.add("hidden");
  });

  renderOcrWizardStep();
}

function hideOcrAiWizard(): void {
  const modal = document.getElementById("ocr-ai-wizard-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

let currentStep: "welcome" | "hardware" | "download" | "done" = "welcome";
let vramInfo: VramInfo | null = null;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function renderOcrWizardStep(): void {
  const title = document.getElementById("ocr-ai-wizard-title");
  const body = document.getElementById("ocr-ai-wizard-body");
  const backBtn = document.getElementById("ocr-ai-wizard-back") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("ocr-ai-wizard-next") as HTMLButtonElement | null;
  const skipBtn = document.getElementById("ocr-ai-wizard-skip") as HTMLButtonElement | null;
  if (!title || !body || !backBtn || !nextBtn) return;

  backBtn.style.display = "none";
  if (skipBtn) skipBtn.style.display = "none";
  nextBtn.style.display = "";
  nextBtn.disabled = false;

  switch (currentStep) {
    case "welcome":
      title.textContent = "Set Up OCR AI";
      body.innerHTML = `
        <p>AuraWrite can use <strong>LightOnOCR 2 1B</strong> — a local AI vision model for reading text from images and PDFs with high accuracy.</p>
        <p>Supported languages: English, Italian, French, German, Spanish, Portuguese, Dutch, Swedish, Danish, Chinese, Japanese.</p>
        <p class="preference-hint">
          The model runs locally via llama.cpp — no cloud service needed, all data stays on your machine.<br>
          For Russian, Arabic, and Hindi, Tesseract OCR is used as fallback.
        </p>
      `;
      if (skipBtn) skipBtn.style.display = "";
      nextBtn.textContent = "Get Started";
      nextBtn.onclick = () => { currentStep = "hardware"; renderOcrWizardStep(); };
      break;

    case "hardware":
      title.textContent = "Hardware Check";
      body.innerHTML = `<p>Detecting GPU...</p>`;
      backBtn.style.display = "";
      if (skipBtn) skipBtn.style.display = "";
      nextBtn.textContent = "Next";
      nextBtn.disabled = true;
      backBtn.onclick = () => { currentStep = "welcome"; renderOcrWizardStep(); };

      (async () => {
        try {
          vramInfo = await ocrAiCheckVram();
        } catch {
          vramInfo = null;
        }

        if (vramInfo && vramInfo.vram_available_bytes !== null) {
          const vramGb = (vramInfo.vram_available_bytes / 1024 / 1024 / 1024).toFixed(1);
          body.innerHTML = `
            <div style="margin-bottom:12px;">
              <strong>GPU VRAM:</strong> ${vramGb} GB<br>
              <strong>Status:</strong> ${vramInfo.vram_sufficient
                ? '<span style="color:#4caf50;">Sufficient for OCR AI</span>'
                : '<span style="color:#ff9800;">May be insufficient — OCR AI will use CPU (slower)</span>'}
            </div>
            <p class="preference-hint">
              LightOnOCR requires ~1.1 GB VRAM + 2 GB safety margin. Without sufficient VRAM, it will fall back to CPU mode which is slower.
            </p>
          `;
        } else {
          body.innerHTML = `
            <div style="margin-bottom:12px;">
              <strong>GPU:</strong> No NVIDIA GPU detected<br>
              <strong>Status:</strong> <span style="color:#ff9800;">OCR AI will use CPU mode (slower)</span>
            </div>
            <p class="preference-hint">
              OCR AI can still run on CPU, but performance will be significantly slower.
              A dedicated NVIDIA GPU with at least 3 GB VRAM is recommended.
            </p>
          `;
        }
        nextBtn.disabled = false;
        nextBtn.onclick = () => { currentStep = "download"; renderOcrWizardStep(); };
      })();
      break;

    case "download":
      title.textContent = "Download Model";
      body.innerHTML = `
        <p>Download the OCR AI model (Q8_0 quantization, ~1.1 GB total):</p>
        <div style="margin:12px 0;padding:8px;border:1px solid var(--border-color);border-radius:4px;">
          <strong>Q8_0</strong> — Recommended: faster, smaller, good quality
        </div>
        <div id="wizard-download-status"></div>
      `;
      backBtn.style.display = "";
      backBtn.onclick = () => { currentStep = "hardware"; renderOcrWizardStep(); };
      if (skipBtn) skipBtn.style.display = "";
      nextBtn.textContent = "Download";
      nextBtn.disabled = false;

      nextBtn.onclick = async () => {
        backBtn.style.display = "none";
        nextBtn.style.display = "none";
        if (skipBtn) {
          skipBtn.textContent = "Cancel";
          skipBtn.style.display = "";
          skipBtn.onclick = () => {
            localStorage.setItem(WIZARD_KEY, "1");
            hideOcrAiWizard();
          };
        }

        const statusEl = document.getElementById("wizard-download-status");

        try {
          const status = await invoke<{ present: boolean }>("resources_get_status");
          if (!status.present) {
            if (statusEl) statusEl.innerHTML = `<p>Step 1/2: Downloading llama.cpp runtime...</p>`;
            const hwInfo = await invoke<{ recommended_llamacpp_variant: string }>("resources_detect_hardware");
            await invoke("resources_download_llamacpp_variant", { variant: hwInfo.recommended_llamacpp_variant });
          }

          const stepBase = status.present ? 1 : 2;
          if (statusEl) statusEl.innerHTML = `<p>Step ${stepBase}/2: Downloading Q8_0 model + mmproj (~1.1 GB)...</p><p class="preference-hint">Progress appears at the bottom of the screen.</p>`;
          await ocrAiDownloadModel("q8_0");

          if (statusEl) statusEl.innerHTML = `<p style="color:#4caf50;">Download complete!</p>`;
          currentStep = "done";
          renderOcrWizardStep();
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          if (statusEl) {
            statusEl.innerHTML = `<p style="color:var(--error);">Download failed: ${errorMsg}</p>
              <p class="preference-hint">You can try again from Preferences → OCR.</p>`;
          }
          nextBtn.style.display = "";
          nextBtn.textContent = "Close";
          nextBtn.disabled = false;
          if (skipBtn) skipBtn.style.display = "none";
          nextBtn.onclick = () => {
            localStorage.setItem(WIZARD_KEY, "1");
            hideOcrAiWizard();
          };
        }
      };
      break;

    case "done":
      title.textContent = "OCR AI Ready!";
      body.innerHTML = `
        <p style="color:#4caf50;">LightOnOCR is ready to use!</p>
        <p>When you open the OCR toolbar, select <strong>"AI (LightOnOCR)"</strong> as the engine to use it.</p>
        <p class="preference-hint">You can always manage the model from Preferences → OCR.</p>
      `;
      nextBtn.textContent = "Done";
      nextBtn.disabled = false;
      if (skipBtn) skipBtn.style.display = "none";
      backBtn.style.display = "none";
      nextBtn.onclick = () => {
        localStorage.setItem(WIZARD_KEY, "1");
        hideOcrAiWizard();
      };
      break;
  }
}