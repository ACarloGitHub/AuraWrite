/**
 * Resources preferences tabs: Embeddings, Local Models and llama.cpp Params.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.5).
 *
 * Fixes applied during the extraction (planned):
 * - Embeddings tab: button handlers installed only ONCE (guard flag moved
 *   into this module, same behavior but now explicit and co-located).
 * - llama.cpp server status polling: the 5s setInterval now has a single
 *   instance guard (previously it relied on setup being called once; the
 *   timer is still never cleared, matching app lifetime semantics).
 */
import { invoke } from "@tauri-apps/api/core";
import { setDownloadRetryHandler } from "../download-toast";
import { formatBytes } from "../utils/format";
import { shouldShowWizard, showAIWizard } from "../setup/ai-wizard";
import { updateLlamacppServerStatusAI } from "./ai-provider-tab";
import { MODEL_CATALOG, recommendModelsForHardware, getRecommendedQuantization } from "../ai-panel/model-catalog";

export const EMBED_ONBOARDING_KEY = "aurawrite-embeddings-onboarding-dismissed";

interface ResourceInfo {
  present: boolean;
  path: string;
  size_bytes: number;
  version: string;
  license: string;
  download_url: string;
}
interface ResourcesStatus {
  llamacpp: ResourceInfo;
  llamacpp_embeddings: ResourceInfo;
  nomic: ResourceInfo;
  ollama_installed: boolean;
  ollama_path: string;
  data_dir: string;
  platform: string;
  arch: string;
}

async function refreshEmbeddingsStatus(): Promise<ResourcesStatus | null> {
  try {
    return (await invoke("resources_get_status")) as ResourcesStatus;
  } catch (e) {
    console.warn("[embeddings] status failed:", e);
    return null;
  }
}

export async function setupEmbeddingsTab(): Promise<void> {
  const status = await refreshEmbeddingsStatus();
  if (!status) return;

  const llamaStatus = document.getElementById("embed-llamacpp-status");
  const llamaMeta = document.getElementById("embed-llamacpp-meta");
  const llamaDownload = document.getElementById("embed-llamacpp-download") as HTMLButtonElement | null;
  const llamaRemove = document.getElementById("embed-llamacpp-remove") as HTMLButtonElement | null;
  const nomicStatus = document.getElementById("embed-nomic-status");
  const nomicMeta = document.getElementById("embed-nomic-meta");
  const nomicDownload = document.getElementById("embed-nomic-download") as HTMLButtonElement | null;
  const nomicRemove = document.getElementById("embed-nomic-remove") as HTMLButtonElement | null;
  const ollamaStatus = document.getElementById("embed-ollama-status");
  const ollamaInstall = document.getElementById("embed-ollama-install") as HTMLButtonElement | null;
  const ollamaPullNomic = document.getElementById("embed-ollama-pull-nomic") as HTMLButtonElement | null;
  const removeAll = document.getElementById("embed-remove-all") as HTMLButtonElement | null;
  const reshowOnboarding = document.getElementById("embed-reshow-onboarding") as HTMLButtonElement | null;

  if (llamaStatus) llamaStatus.textContent = `Status: ${status.llamacpp_embeddings.present ? "installed" : "not installed"} (${status.platform}/${status.arch})`;
  if (llamaMeta) llamaMeta.textContent = status.llamacpp_embeddings.present ? `Version: ${status.llamacpp_embeddings.version} · Size: ${formatBytes(status.llamacpp_embeddings.size_bytes)}` : `Will download: ${status.llamacpp_embeddings.download_url}`;
  if (llamaDownload) llamaDownload.style.display = status.llamacpp_embeddings.present ? "none" : "";
  if (llamaRemove) llamaRemove.style.display = status.llamacpp_embeddings.present ? "" : "none";

  if (nomicStatus) nomicStatus.textContent = `Status: ${status.nomic.present ? "installed" : "not installed"}`;
  if (nomicMeta) nomicMeta.textContent = status.nomic.present ? `Version: ${status.nomic.version} · Size: ${formatBytes(status.nomic.size_bytes)}` : `Will download: ${status.nomic.download_url}`;
  if (nomicDownload) nomicDownload.style.display = status.nomic.present ? "none" : "";
  if (nomicRemove) nomicRemove.style.display = status.nomic.present ? "" : "none";

  if (ollamaStatus) ollamaStatus.textContent = `Ollama status: ${status.ollama_installed ? "installed" : "not installed"} (${status.ollama_path || "not on PATH"})`;
  if (ollamaInstall) ollamaInstall.style.display = status.ollama_installed ? "none" : "";
  if (ollamaPullNomic) ollamaPullNomic.style.display = status.ollama_installed ? "" : "none";

  installEmbeddingsButtonHandlers();
  ollamaPullNomic?.addEventListener("click", async () => {
    ollamaPullNomic.disabled = true;
    ollamaPullNomic.textContent = "Pulling nomic via Ollama...";
    try {
      await invoke("ollama_pull_nomic");
      ollamaPullNomic.textContent = "nomic pulled via Ollama ✓";
    } catch (e) {
      ollamaPullNomic.disabled = false;
      ollamaPullNomic.textContent = "Download nomic via Ollama";
      alert("Failed to pull nomic via Ollama: " + (e instanceof Error ? e.message : String(e)));
    }
  });
  removeAll?.addEventListener("click", async () => {
    if (!window.confirm("Remove all local AI resources (llama.cpp, embeddings, nomic)? You can re-download at any time.")) return;
    await invoke("resources_remove_all");
    await setupEmbeddingsTab();
  });
  reshowOnboarding?.addEventListener("click", () => {
    localStorage.removeItem(EMBED_ONBOARDING_KEY);
    maybeShowEmbeddingsOnboarding();
  });
}

let embeddingsButtonHandlersInstalled = false;
function installEmbeddingsButtonHandlers(): void {
  if (embeddingsButtonHandlersInstalled) return;
  embeddingsButtonHandlersInstalled = true;
  const llamaDownload = document.getElementById("embed-llamacpp-download") as HTMLButtonElement | null;
  const llamaRemove = document.getElementById("embed-llamacpp-remove") as HTMLButtonElement | null;
  const nomicDownload = document.getElementById("embed-nomic-download") as HTMLButtonElement | null;
  const nomicRemove = document.getElementById("embed-nomic-remove") as HTMLButtonElement | null;

  llamaDownload?.addEventListener("click", async () => {
    llamaDownload.disabled = true;
    setDownloadRetryHandler("llamacpp", () => {
      llamaDownload.click();
    });
    try {
      await invoke("resources_download_llamacpp");
      await setupEmbeddingsTab();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[llamacpp] download failed:", msg);
    } finally {
      llamaDownload.disabled = false;
      llamaDownload.textContent = "Download llama.cpp (embeddings)";
    }
  });
  llamaRemove?.addEventListener("click", async () => {
    if (!window.confirm("Remove llama.cpp (embeddings)? You can re-download it at any time.")) return;
    await invoke("resources_remove_llamacpp_embeddings");
    await setupEmbeddingsTab();
  });
  nomicDownload?.addEventListener("click", async () => {
    nomicDownload.disabled = true;
    setDownloadRetryHandler("nomic", () => {
      nomicDownload.click();
    });
    try {
      await invoke("resources_download_nomic");
      await setupEmbeddingsTab();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[nomic] download failed:", msg);
    } finally {
      nomicDownload.disabled = false;
      nomicDownload.textContent = "Download nomic";
    }
  });
  nomicRemove?.addEventListener("click", async () => {
    if (!window.confirm("Remove nomic? You can re-download it at any time.")) return;
    await invoke("resources_remove_all");
    await setupEmbeddingsTab();
  });
}

export function maybeShowEmbeddingsOnboarding(): void {
  if (localStorage.getItem(EMBED_ONBOARDING_KEY)) return;
  const modal = document.getElementById("embeddings-onboarding-modal");
  if (!modal) return;
  modal.classList.remove("hidden");

  const close = (download: boolean) => {
    localStorage.setItem(EMBED_ONBOARDING_KEY, "1");
    modal.classList.add("hidden");
    if (download) {
      Promise.allSettled([
        invoke("resources_download_llamacpp"),
        invoke("resources_download_nomic"),
      ])
        .then(() => setupEmbeddingsTab())
        .catch((e) => console.warn("[embeddings onboarding] download failed:", e));
    }
    // After embeddings wizard is dismissed, show AI wizard if needed
    if (shouldShowWizard()) {
      showAIWizard();
    }
  };

  document.getElementById("embeddings-onboarding-close")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-skip")?.addEventListener("click", () => close(false));
  document.getElementById("embeddings-onboarding-download")?.addEventListener("click", () => close(true));
}

export async function setupLocalModelsTab(): Promise<void> {
  // Models directory
  try {
    const currentDir = await invoke<string>("resources_get_models_dir");
    const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
    if (dirInput) dirInput.value = currentDir;
  } catch (e) {
    console.warn("[models-dir] failed to get models dir:", e);
  }

  document.getElementById("local-models-dir-browse")?.addEventListener("click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;
    try {
      const newDir = await invoke<string>("resources_set_models_dir", { path: selected });
      const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
      if (dirInput) dirInput.value = newDir;
      await refreshLocalModelList();
    } catch (e) {
      alert("Failed to set models directory: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-models-dir-reset")?.addEventListener("click", async () => {
    try {
      const defaultDir = await invoke<string>("resources_reset_models_dir");
      const dirInput = document.getElementById("local-models-dir") as HTMLInputElement;
      if (dirInput) dirInput.value = defaultDir;
      await refreshLocalModelList();
    } catch (e) {
      alert("Failed to reset models directory: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  await refreshHardwareInfo();
  await refreshLocalModelList();
  await refreshLocalModelCatalog();

  document.getElementById("local-hardware-refresh")?.addEventListener("click", async () => {
    await refreshHardwareInfo();
    await refreshLocalModelCatalog();
  });

  document.getElementById("local-model-url-download")?.addEventListener("click", async () => {
    const urlInput = document.getElementById("local-model-url") as HTMLInputElement;
    const idInput = document.getElementById("local-model-url-id") as HTMLInputElement;
    const url = urlInput.value.trim();
    const id = idInput.value.trim();
    if (!url || !id) {
      alert("Please provide both a URL and a Model ID.");
      return;
    }
    if (!url.toLowerCase().endsWith(".gguf")) {
      alert("The URL must point to a .gguf file.");
      return;
    }
    const filename = url.split("/").pop() || `${id}.gguf`;
    setDownloadRetryHandler(id, () => {
      (document.getElementById("local-model-url-download") as HTMLButtonElement)?.click();
    });
    try {
      await invoke("resources_download_chat_model", { modelId: id, url, filename, mmprojUrl: null, mmprojFilename: null });
      urlInput.value = "";
      idInput.value = "";
      await refreshLocalModelList();
    } catch (e) {
      alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-model-path-register")?.addEventListener("click", async () => {
    const pathInput = document.getElementById("local-model-path") as HTMLInputElement;
    const idInput = document.getElementById("local-model-path-id") as HTMLInputElement;
    const filePath = pathInput.value.trim();
    const id = idInput.value.trim();
    if (!filePath || !id) {
      alert("Please provide both a file path and a Model ID.");
      return;
    }
    try {
      const valid = await invoke("resources_verify_model", { filePath }) as boolean;
      if (!valid) {
        alert("The file does not appear to be a valid GGUF model.");
        return;
      }
      await invoke("resources_register_local_model", { modelId: id, filePath });
      pathInput.value = "";
      idInput.value = "";
      await refreshLocalModelList();
    } catch (e) {
      alert("Registration failed: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  document.getElementById("local-llamacpp-download-variant")?.addEventListener("click", async () => {
    const select = document.getElementById("local-llamacpp-variant-select") as HTMLSelectElement;
    let variant = select.value;
    if (variant === "auto") {
      const hw = await invoke("resources_detect_hardware") as any;
      variant = hw.recommended_llamacpp_variant || "cpu";
    }
    const btn = document.getElementById("local-llamacpp-download-variant") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Downloading...";
    setDownloadRetryHandler("llamacpp-" + variant, () => {
      btn?.click();
    });
    try {
      await invoke("resources_download_llamacpp_variant", { variant });
      await refreshLlamacppVariant();
    } catch (e) {
      alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      btn.disabled = false;
      btn.textContent = "Download llama.cpp variant";
    }
  });
}

async function refreshHardwareInfo(): Promise<void> {
  const el = document.getElementById("local-hardware-info");
  if (!el) return;
  try {
    const hw = await invoke("resources_detect_hardware") as any;
    const gpus = hw.gpus.map((g: any) => `${g.vendor} ${g.model} (${formatBytes(g.vram_bytes)} VRAM, ${g.backend})`).join(", ") || "None detected";
    el.innerHTML = `<strong>OS:</strong> ${hw.os}/${hw.arch} &nbsp;|&nbsp; <strong>RAM:</strong> ${formatBytes(hw.ram_total_bytes)} total, ${formatBytes(hw.ram_available_bytes)} available &nbsp;|&nbsp; <strong>GPU:</strong> ${gpus} &nbsp;|&nbsp; <strong>Disk:</strong> ${formatBytes(hw.disk_free_bytes)} free of ${formatBytes(hw.disk_total_bytes)} &nbsp;|&nbsp; <strong>Recommended:</strong> ${hw.recommended_llamacpp_variant}`;
  } catch (e) {
    el.textContent = "Failed to detect hardware: " + (e instanceof Error ? e.message : String(e));
  }
}

async function refreshLocalModelList(): Promise<void> {
  const container = document.getElementById("local-model-list");
  if (!container) return;
  try {
    const models = await invoke("resources_list_chat_models") as any[];
    if (models.length === 0) {
      container.innerHTML = '<p class="preference-hint">No models downloaded yet. Choose one from the catalog above or provide a URL.</p>';
      return;
    }
    container.innerHTML = models.map((m: any) => `
      <div class="preference-row" style="margin-bottom:8px;padding:8px;border:1px solid var(--border-color);border-radius:4px;">
        <div style="flex:1;">
          <strong>${m.id}</strong> &nbsp; ${m.filename} &nbsp; ${formatBytes(m.size_bytes)}
          ${m.mmproj_present ? ' &nbsp; <span style="color:#4caf50;">+ mmproj</span>' : ''}
        </div>
        <button class="pref-btn pref-btn-danger local-model-remove" data-model-id="${m.id}">Remove</button>
      </div>
    `).join("");
    container.querySelectorAll(".local-model-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const modelId = (btn as HTMLElement).dataset.modelId || "";
        try {
          await invoke("resources_remove_chat_model", { modelId });
          await refreshLocalModelList();
          await refreshLocalModelCatalog();
        } catch (e) {
          alert("Failed to remove model: " + (e instanceof Error ? e.message : String(e)));
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="preference-hint">Error loading models: ' + (e instanceof Error ? e.message : String(e)) + '</p>';
  }
}

async function refreshLocalModelCatalog(): Promise<void> {
  const container = document.getElementById("local-model-catalog");
  if (!container) return;
  try {
    const hw = await invoke("resources_detect_hardware") as any;
    const vram = hw.gpus.length > 0 ? hw.gpus[0].vram_bytes : 0;
    const ram = hw.ram_total_bytes as number;
    const recommended = recommendModelsForHardware(vram, ram);
    const downloaded = await invoke("resources_list_chat_models") as any[];
    const downloadedIds = new Set(downloaded.map((m: any) => m.id));

    container.innerHTML = MODEL_CATALOG.map((model) => {
      const isRecommended = recommended.some((r: any) => r.id === model.id);
      const isDownloaded = downloadedIds.has(model.id);
      const bestQuant = getRecommendedQuantization(model, vram, ram);
      const canFit = model.quantizations.some((q: any) =>
        q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= ram)
      );
      if (!canFit && vram > 0) return "";

      return `
        <div class="catalog-model-card" data-model-id="${model.id}" style="margin-bottom:12px;padding:10px;border:1px solid var(--border-color);border-radius:6px;${isRecommended ? 'border-color:#4caf50;' : ''}${isDownloaded ? 'background:rgba(76,175,80,0.08);' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>${model.name}</strong>
              ${isRecommended ? '<span style="color:#4caf50;">★ Recommended</span>' : ''}
              ${isDownloaded ? '<span style="color:#4caf50;">✓ Downloaded</span>' : ''}
              <br><span class="preference-hint">${model.description}</span>
              <br><span class="preference-hint">${model.total_params} params · ${model.architecture} · ${model.context_length.toLocaleString()} ctx · ${model.license}</span>
            </div>
          </div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;" class="catalog-quant-group" data-model-id="${model.id}">
            ${model.quantizations
              .filter((q: any) => q.recommended_vram_bytes <= vram || (vram === 0 && q.recommended_ram_bytes <= ram))
              .map((q: any) => `
                <button class="pref-btn catalog-quant-btn${bestQuant && bestQuant.id === q.id ? ' pref-btn-primary' : ''}" data-model-id="${model.id}" data-quant-id="${q.id}" data-url="${q.url}" data-filename="${q.filename}" data-quant-name="${q.name}" data-model-name="${model.name}" data-size="${q.size_bytes}">${q.name}</button>
              `).join("")}
          </div>
          ${model.is_multimodal ? '<span class="preference-hint" style="color:#ff9800;">⚡ Multimodal (vision + audio) — mmproj will be downloaded automatically</span>' : ''}
          <div class="catalog-confirm-area" id="catalog-confirm-${model.id}" style="display:none;margin-top:8px;padding:8px;background:var(--color-surface,rgba(0,0,0,0.05));border-radius:4px;"></div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".catalog-quant-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const el = btn as HTMLElement;
        const modelId = el.dataset.modelId || "";
        const url = el.dataset.url || "";
        const filename = el.dataset.filename || "";
        const quantName = el.dataset.quantName || "";
        const modelName = el.dataset.modelName || "";
        const sizeBytes = parseInt(el.dataset.size || "0");

        // Deselect all quant buttons in this model card
        const card = el.closest(".catalog-model-card");
        card?.querySelectorAll(".catalog-quant-btn").forEach((b) => b.classList.remove("pref-btn-primary"));
        el.classList.add("pref-btn-primary");

        // Show confirmation area
        const confirmArea = document.getElementById(`catalog-confirm-${modelId}`);
        if (confirmArea) {
          confirmArea.style.display = "block";
          confirmArea.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>Download ${modelName} (${quantName})?</strong><br>
                <span class="preference-hint">${formatBytes(sizeBytes)} — ${url.split('/').pop()}</span>
              </div>
              <button class="pref-btn pref-btn-primary catalog-confirm-download" data-model-id="${modelId}" data-url="${url}" data-filename="${filename}" data-quant-name="${quantName}">Download</button>
            </div>
          `;
          const confirmBtn = confirmArea.querySelector(".catalog-confirm-download");
          if (confirmBtn) {
            (confirmBtn as HTMLButtonElement).addEventListener("click", async () => {
              const model = MODEL_CATALOG.find((m) => m.id === modelId);
              const mmprojUrl = model?.mmproj_url || null;
              const mmprojFilename = model?.mmproj_filename || null;
              (confirmBtn as HTMLButtonElement).disabled = true;
              (confirmBtn as HTMLButtonElement).textContent = "Downloading...";
              setDownloadRetryHandler(modelId, () => {
                (confirmBtn as HTMLButtonElement).click();
              });
              try {
                await invoke("resources_download_chat_model", {
                  modelId,
                  url,
                  filename,
                  mmprojUrl,
                  mmprojFilename,
                });
                (confirmBtn as HTMLButtonElement).textContent = "✓ Done";
                await refreshLocalModelList();
                await refreshLocalModelCatalog();
              } catch (e) {
                (confirmBtn as HTMLButtonElement).textContent = "Failed";
                alert("Download failed: " + (e instanceof Error ? e.message : String(e)));
                setTimeout(() => {
                  (confirmBtn as HTMLButtonElement).disabled = false;
                  (confirmBtn as HTMLButtonElement).textContent = "Download";
                }, 2000);
              }

            });
          }
        }
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="preference-hint">Error loading catalog: ' + (e instanceof Error ? e.message : String(e)) + '</p>';
  }
}

async function refreshLlamacppVariant(): Promise<void> {
  const el = document.getElementById("local-llamacpp-variant");
  if (!el) return;
  try {
    const variant = await invoke("resources_llamacpp_variant") as string;
    el.textContent = `llama.cpp variant installed: ${variant}`;
  } catch {
    el.textContent = "llama.cpp not installed yet";
  }
}

function saveLlamacppParams(): void {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement)?.value || "";
  localStorage.setItem("aurawrite-llamacpp-ctx-size", val("llamacpp-ctx-size"));
  localStorage.setItem("aurawrite-llamacpp-ngl", val("llamacpp-ngl"));
  if (val("llamacpp-ngl-custom")) {
    localStorage.setItem("aurawrite-llamacpp-ngl-custom", val("llamacpp-ngl-custom"));
  }
  localStorage.setItem("aurawrite-llamacpp-fit-target", val("llamacpp-fit-target"));
  localStorage.setItem("aurawrite-llamacpp-cache-type-k", val("llamacpp-cache-type-k"));
  localStorage.setItem("aurawrite-llamacpp-cache-type-v", val("llamacpp-cache-type-v"));
  localStorage.setItem("aurawrite-llamacpp-flash-attn", val("llamacpp-flash-attn"));
  localStorage.setItem("aurawrite-llamacpp-threads", val("llamacpp-threads"));
  localStorage.setItem("aurawrite-llamacpp-port", val("llamacpp-port"));
  localStorage.setItem("aurawrite-llamacpp-batch-size", val("llamacpp-batch-size"));
}

export function setupLlamacppParamsTab(): void {
  const nglSelect = document.getElementById("llamacpp-ngl") as HTMLSelectElement;
  const nglCustom = document.getElementById("llamacpp-ngl-custom") as HTMLInputElement;
  if (nglSelect && nglCustom) {
    nglSelect.addEventListener("change", () => {
      nglCustom.style.display = nglSelect.value === "custom" ? "" : "none";
      saveLlamacppParams();
    });
  }

  // Save all llamacpp params to localStorage when they change
  document.querySelectorAll(
    "#llamacpp-ctx-size, #llamacpp-ngl-custom, #llamacpp-fit-target, #llamacpp-cache-type-k, #llamacpp-cache-type-v, #llamacpp-flash-attn, #llamacpp-threads, #llamacpp-port, #llamacpp-batch-size",
  ).forEach((el) => {
    el.addEventListener("change", saveLlamacppParams);
    el.addEventListener("input", saveLlamacppParams);
  });

  document.getElementById("llamacpp-start-server")?.addEventListener("click", async () => {
    const startBtn = document.getElementById("llamacpp-start-server") as HTMLButtonElement | null;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = "Starting...";
    }
    try {
      const modelPath = (document.getElementById("pref-ai-model") as HTMLInputElement | null)?.value?.trim();
      if (!modelPath) {
        alert("No model selected. Please select a model in the AI Provider tab first.");
        return;
      }
      const nglValue = nglSelect?.value === "custom" ? nglCustom?.value : nglSelect?.value;
      let mmprojPath: string | null = null;
      try {
        const models = await invoke("resources_list_chat_models") as Array<{ path: string; mmproj_path: string | null }>;
        const matched = models.find((m) => m.path === modelPath);
        mmprojPath = matched?.mmproj_path || null;
      } catch {
        // ignore
      }
      const result = await invoke("llamacpp_spawn_server", {
        modelPath,
        port: parseInt(localStorage.getItem("aurawrite-llamacpp-port") || "11435"),
        ctxSize: parseInt(localStorage.getItem("aurawrite-llamacpp-ctx-size") || "4096"),
        ngl: nglValue || "all",
        flashAttn: localStorage.getItem("aurawrite-llamacpp-flash-attn") || "auto",
        cacheTypeK: localStorage.getItem("aurawrite-llamacpp-cache-type-k") || "f16",
        cacheTypeV: localStorage.getItem("aurawrite-llamacpp-cache-type-v") || "f16",
        threads: parseInt(localStorage.getItem("aurawrite-llamacpp-threads") || "0") || null,
        mmprojPath,
        noMmprojOffload: false,
        fitTarget: parseInt(localStorage.getItem("aurawrite-llamacpp-fit-target") || "1024") || 1024,
      });
      const status = result as { running: boolean; pid: number | null; port: number | null; model_path: string | null };
      updateLlamacppServerStatus(status);
      if (!status.running) {
        alert("Server failed to start. Check the server status and try again.");
      }
    } catch (e) {
      alert("Failed to start server: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = "Start server";
      }
    }
  });

  document.getElementById("llamacpp-stop-server")?.addEventListener("click", async () => {
    try {
      await invoke("llamacpp_stop_server");
      updateLlamacppServerStatus({ running: false, pid: null, port: null, model_path: null });
    } catch (e) {
      console.error("[llamacpp] stop failed:", e);
    }
  });

  // Initial status check
  (async () => {
    try {
      const status = await invoke("llamacpp_server_status") as any;
      updateLlamacppServerStatus(status);
    } catch {
      // Server not started yet, that's fine
    }
  })();

  // Periodic status polling every 5 seconds.
  // FIX (refactoring plan step 1.5): guard against multiple intervals if this
  // setup function is ever called more than once.
  if (!llamacppStatusTimer) {
    llamacppStatusTimer = setInterval(async () => {
      try {
        const status = await invoke("llamacpp_server_status") as any;
        updateLlamacppServerStatus(status);
      } catch {
        // ignore
      }
    }, 5000);
  }
}

let llamacppStatusTimer: ReturnType<typeof setInterval> | null = null;

function updateLlamacppServerStatus(status: any): void {
  const el = document.getElementById("llamacpp-server-status");
  const startBtn = document.getElementById("llamacpp-start-server") as HTMLButtonElement | null;
  const stopBtn = document.getElementById("llamacpp-stop-server") as HTMLButtonElement | null;
  if (!el) return;
  if (status.running) {
    el.innerHTML = `<span style="color:#4caf50;">● Running</span> (PID ${status.pid}, port ${status.port})<br>Model: ${status.model_path || "unknown"}`;
    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "";
  } else {
    el.innerHTML = '<span style="color:#999;">○ Not running</span>';
    if (startBtn) startBtn.style.display = "";
    if (stopBtn) stopBtn.style.display = "none";
  }
  updateLlamacppServerStatusAI(status);
}
