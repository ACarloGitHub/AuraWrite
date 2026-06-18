import { invoke } from "@tauri-apps/api/core";
import { MODEL_CATALOG, recommendModelsForHardware, getRecommendedQuantization } from "../ai-panel/model-catalog";
import { setDownloadRetryHandler } from "../download-toast";

const WIZARD_KEY = "aurawrite-ai-wizard-dismissed";

type WizardStep = "welcome" | "hardware" | "choose" | "download" | "done";

interface HardwareData {
  os: string;
  arch: string;
  ram_total_bytes: number;
  ram_available_bytes: number;
  gpus: Array<{ vendor: string; model: string; vram_bytes: number; backend: string }>;
  recommended_llamacpp_variant: string;
  disk_free_bytes: number;
  disk_total_bytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

let currentStep: WizardStep = "welcome";
let hwData: HardwareData | null = null;
let selectedModelId: string | null = null;
let selectedQuantId: string | null = null;

export function shouldShowWizard(): boolean {
  return !localStorage.getItem(WIZARD_KEY);
}

export function showAIWizard(): void {
  const modal = document.getElementById("ai-wizard-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  currentStep = "welcome";
  renderStep();

  document.getElementById("ai-wizard-close")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    hideAIWizard();
  });
  document.getElementById("ai-wizard-skip")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    hideAIWizard();
  });
  modal.querySelector(".modal-overlay")?.addEventListener("click", () => {
    localStorage.setItem(WIZARD_KEY, "1");
    hideAIWizard();
  });
}

export function hideAIWizard(): void {
  const modal = document.getElementById("ai-wizard-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function renderStep(): void {
  const title = document.getElementById("ai-wizard-title");
  const body = document.getElementById("ai-wizard-body");
  const backBtn = document.getElementById("ai-wizard-back") as HTMLButtonElement;
  const nextBtn = document.getElementById("ai-wizard-next") as HTMLButtonElement;
  const skipBtn = document.getElementById("ai-wizard-skip") as HTMLButtonElement;
  if (!title || !body || !backBtn || !nextBtn) return;

  // Reset visibility
  backBtn.style.display = "none";
  skipBtn.style.display = "none";
  nextBtn.style.display = "";
  nextBtn.disabled = false;

  switch (currentStep) {
    case "welcome":
      title.textContent = "Set Up Local AI";
      body.innerHTML = `
        <p>AuraWrite can run a local AI model for chat and suggestions — no cloud service needed, all data stays on your machine.</p>
        <p>This wizard will help you:</p>
        <ul>
          <li>Detect your hardware (GPU, RAM)</li>
          <li>Choose the best model for your system</li>
          <li>Download the model and the llama.cpp runtime</li>
        </ul>
        <p class="preference-hint">llama.cpp is released under the
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener">MIT license</a>.
          Model licenses vary and are shown during download.</p>
      `;
      skipBtn.style.display = "";
      nextBtn.textContent = "Get Started";
      nextBtn.onclick = () => { currentStep = "hardware"; renderStep(); };
      break;

    case "hardware":
      title.textContent = "Hardware Detection";
      body.innerHTML = `<p>Detecting your hardware...</p>`;
      backBtn.style.display = "";
      skipBtn.style.display = "";
      nextBtn.textContent = "Next";
      nextBtn.disabled = true;
      backBtn.onclick = () => { currentStep = "welcome"; renderStep(); };
      detectHardware().then(() => {
        if (!hwData) {
          body.innerHTML = `<p style="color:var(--error);">Failed to detect hardware. You can still continue, but model recommendations may not be accurate.</p>`;
          nextBtn.disabled = false;
        } else {
          const gpus = hwData.gpus.length > 0
            ? hwData.gpus.map((g) => `${g.vendor} ${g.model} (${formatBytes(g.vram_bytes)} VRAM, ${g.backend})`).join("<br>")
            : "No GPU detected — will use CPU mode";
          body.innerHTML = `
            <div style="margin-bottom:12px;">
              <strong>Operating System:</strong> ${hwData.os}/${hwData.arch}<br>
              <strong>Total RAM:</strong> ${formatBytes(hwData.ram_total_bytes)}<br>
              <strong>Available RAM:</strong> ${formatBytes(hwData.ram_available_bytes)}<br>
              <strong>GPU:</strong> ${gpus}<br>
              <strong>Free Disk:</strong> ${formatBytes(hwData.disk_free_bytes)}<br>
              <strong>Recommended runtime:</strong> ${hwData.recommended_llamacpp_variant}
            </div>
            <p class="preference-hint">These values are detected automatically. The recommended runtime will be downloaded on the next step.</p>
          `;
          nextBtn.disabled = false;
        }
        nextBtn.onclick = () => { currentStep = "choose"; renderStep(); };
      });
      break;

    case "choose":
      title.textContent = "Choose a Model";
      if (!hwData) {
        body.innerHTML = `<p style="color:var(--error);">Hardware info not available. Please go back and retry.</p>`;
        nextBtn.disabled = true;
        break;
      }
      {
        const hd = hwData;
        const vram = hd.gpus.length > 0 ? hd.gpus[0].vram_bytes : 0;
        const recommended = recommendModelsForHardware(vram, hd.ram_total_bytes);
        body.innerHTML = `
          <p>Based on your hardware, these models are recommended (★ = best fit):</p>
          <div id="wizard-model-list">
            ${MODEL_CATALOG.map((model) => {
              const isRec = recommended.some(// eslint-disable-next-line @typescript-eslint/no-explicit-any
                (r: any) => r.id === model.id);
              const bestQuant = getRecommendedQuantization(model, vram, hd.ram_total_bytes);
              const canFit = model.quantizations.some((q) =>
                q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= hd.ram_total_bytes)
              );
              if (!canFit && vram > 0) return "";
              return `
                <div style="margin-bottom:10px;padding:8px;border:1px solid var(--border-color);border-radius:4px;cursor:pointer;${isRec ? 'border-color:#4caf50;' : ''}" class="wizard-model-card" data-model-id="${model.id}">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong>${model.name}</strong> ${isRec ? '<span style="color:#4caf50;">★ Recommended</span>' : ''}
                      <br><span class="preference-hint">${model.description}</span>
                    </div>
                  </div>
                  <div style="margin-top:4px;" class="wizard-quant-list" data-model-id="${model.id}">
                    ${model.quantizations
                      .filter((q) => q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= hd.ram_total_bytes))
                      .map((q) => `
                        <button class="pref-btn wizard-quant-btn${bestQuant && bestQuant.id === q.id ? ' pref-btn-recommended' : ''}" data-model-id="${model.id}" data-quant-id="${q.id}" style="margin:2px;">${q.name}${bestQuant && bestQuant.id === q.id ? ' ★' : ''}</button>
                      `).join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
          <p class="preference-hint">Or skip this step and add models later from Preferences → Local Models.</p>
        `;
        backBtn.style.display = "";
        backBtn.onclick = () => { currentStep = "hardware"; renderStep(); };
        skipBtn.style.display = "";
        nextBtn.textContent = "Download";
        nextBtn.disabled = !selectedQuantId;

        body.querySelectorAll(".wizard-quant-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const el = btn as HTMLElement;
            body.querySelectorAll(".wizard-quant-btn").forEach((b) => {
              const hb = b as HTMLElement;
              hb.classList.remove("pref-btn-primary");
              hb.style.removeProperty("background-color");
              hb.style.removeProperty("color");
            });
            el.classList.add("pref-btn-primary");
            selectedModelId = el.dataset.modelId || null;
            selectedQuantId = el.dataset.quantId || null;
            nextBtn.disabled = false;
          });
        });
        nextBtn.onclick = () => {
          if (!selectedModelId || !selectedQuantId) return;
          currentStep = "download";
          renderStep();
        };
      }
      break;

    case "download":
      title.textContent = "Downloading";
      {
        const model = MODEL_CATALOG.find((m) => m.id === selectedModelId);
        const quant = model?.quantizations.find((q) => q.id === selectedQuantId);
        if (!model || !quant) {
          body.innerHTML = `<p style="color:var(--error);">No model selected. Please go back.</p>`;
          nextBtn.disabled = true;
          break;
        }
        body.innerHTML = `
          <p>Downloading <strong>${model.name}</strong> (${quant.name})...</p>
          <p class="preference-hint">File size: ${formatBytes(quant.size_bytes)}. The progress bar will appear at the bottom of the screen. You can close this dialog — downloads continue in the background.</p>
          <div id="wizard-download-status" style="margin-top:12px;">
            <p>Step 1/2: Downloading llama.cpp runtime...</p>
          </div>
        `;
        backBtn.style.display = "none";
        nextBtn.style.display = "none";
        skipBtn.style.display = "none";

        (async () => {
          const statusEl = document.getElementById("wizard-download-status");
          try {
            let variant = hwData?.recommended_llamacpp_variant || "cpu";
            try {
              await invoke("resources_download_llamacpp_variant", { variant });
              if (statusEl) statusEl.innerHTML = `<p>Step 1/2: llama.cpp ✓</p><p>Step 2/2: Downloading model...</p>`;
            } catch (e) {
              if (variant !== "cpu") {
                variant = "cpu";
                try {
                  await invoke("resources_download_llamacpp_variant", { variant: "cpu" });
                  if (statusEl) statusEl.innerHTML = `<p>Step 1/2: llama.cpp (CPU fallback) ✓</p><p>Step 2/2: Downloading model...</p>`;
                } catch (e2) {
                  if (statusEl) statusEl.innerHTML = `<p style="color:var(--error);">Failed to download llama.cpp: ${e2 instanceof Error ? e2.message : String(e2)}</p><p>You can try again from Preferences → Local Models.</p>`;
                  nextBtn.style.display = "";
                  nextBtn.textContent = "Close";
                  nextBtn.disabled = false;
                  nextBtn.onclick = () => hideAIWizard();
                  return;
                }
              } else {
                throw e;
              }
            }

            setDownloadRetryHandler(selectedModelId!, () => {
              currentStep = "download";
              renderStep();
            });
            await invoke("resources_download_chat_model", {
              modelId: selectedModelId,
              url: quant.url,
              filename: quant.filename,
              mmprojUrl: model.mmproj_url || null,
              mmprojFilename: model.mmproj_filename || null,
            });

            if (statusEl) statusEl.innerHTML = `<p style="color:#4caf50;">✓ All downloads complete!</p>`;
            currentStep = "done";
            renderStep();
          } catch (e) {
            if (statusEl) {
              statusEl.innerHTML = `<p style="color:var(--error);">Download failed: ${e instanceof Error ? e.message : String(e)}</p><p>You can try again from Preferences → Local Models.</p>`;
            }
            nextBtn.style.display = "";
            nextBtn.textContent = "Close";
            nextBtn.disabled = false;
            nextBtn.onclick = () => hideAIWizard();
          }
        })();
      }
      break;

    case "done":
      title.textContent = "Setup Complete!";
      body.innerHTML = `
        <p style="color:#4caf50;">Your local AI model is ready!</p>
        <p>You can now select <strong>"Local (llama.cpp)"</strong> as the AI Provider in Preferences → AI Provider.</p>
        <p class="preference-hint">You can always change models, adjust parameters, or add more models from Preferences → Local Models and llama.cpp Params.</p>
      `;
      nextBtn.textContent = "Done";
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        localStorage.setItem(WIZARD_KEY, "1");
        hideAIWizard();
      };
      break;
  }
}

async function detectHardware(): Promise<void> {
  try {
    hwData = await invoke("resources_detect_hardware") as HardwareData;
  } catch (e) {
    console.error("[AI wizard] hardware detection failed:", e);
    hwData = null;
  }
}