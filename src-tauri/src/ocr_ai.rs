// ocr_ai.rs - OCR AI (LightOnOCR) management for AuraWrite
//
// Handles download/list/remove of LightOnOCR GGUF models, and spawns
// a dedicated llama-server instance for OCR inference on a separate port.
//
// Each quantization has its own mmproj file:
//   Q8_0 → LightOnOCR-2-1B-Q8_0.gguf + mmproj-LightOnOCR-2-1B-Q8_0.gguf
//   F16  → LightOnOCR-2-1B-f16.gguf   + mmproj-LightOnOCR-2-1B-f16.gguf
//
// Note: the F16 filenames use lowercase "f16" on HuggingFace.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::resources::{download_to_file_async, resources_dir};

const OCR_AI_MODEL_ID: &str = "lighton-ocr-2-1b";

struct QuantSpec {
    id: &'static str,
    model_filename: &'static str,
    model_url: &'static str,
    mmproj_filename: &'static str,
    mmproj_url: &'static str,
}

const QUANTS: &[QuantSpec] = &[
    QuantSpec {
        id: "q8_0",
        model_filename: "LightOnOCR-2-1B-Q8_0.gguf",
        model_url: "https://huggingface.co/ggml-org/LightOnOCR-2-1B-GGUF/resolve/main/LightOnOCR-2-1B-Q8_0.gguf",
        mmproj_filename: "mmproj-LightOnOCR-2-1B-Q8_0.gguf",
        mmproj_url: "https://huggingface.co/ggml-org/LightOnOCR-2-1B-GGUF/resolve/main/mmproj-LightOnOCR-2-1B-Q8_0.gguf",
    },
];

const OCR_AI_DEFAULT_PORT: u16 = 18089;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OcrAiModelInfo {
    pub id: String,
    pub quantization: String,
    pub model_filename: String,
    pub model_path: String,
    pub model_present: bool,
    pub model_size_bytes: u64,
    pub mmproj_filename: String,
    pub mmproj_path: String,
    pub mmproj_present: bool,
    pub mmproj_size_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OcrAiStatus {
    pub server_running: bool,
    pub port: Option<u16>,
    pub model_loaded: Option<String>,
    pub vram_available_bytes: Option<u64>,
    pub vram_sufficient: bool,
}

fn ocr_ai_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = resources_dir(app)?;
    let dir = base.join("models").join(OCR_AI_MODEL_ID);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create OCR AI model dir: {}", e))?;
    }
    Ok(dir)
}

fn find_quant(id: &str) -> Option<&'static QuantSpec> {
    QUANTS.iter().find(|q| q.id == id)
}

#[tauri::command]
pub fn ocr_ai_list_models(app: AppHandle) -> Result<Vec<OcrAiModelInfo>, String> {
    let dir = ocr_ai_dir(&app)?;
    let mut models = Vec::new();

    for spec in QUANTS.iter() {
        let model_path = dir.join(spec.model_filename);
        let mmproj_path = dir.join(spec.mmproj_filename);

        let model_present = model_path.exists();
        let mmproj_present = mmproj_path.exists();
        let model_size = if model_present { fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0) } else { 0 };
        let mmproj_size = if mmproj_present { fs::metadata(&mmproj_path).map(|m| m.len()).unwrap_or(0) } else { 0 };

        models.push(OcrAiModelInfo {
            id: format!("{}-{}", OCR_AI_MODEL_ID, spec.id),
            quantization: spec.id.to_string(),
            model_filename: spec.model_filename.to_string(),
            model_path: model_path.to_string_lossy().to_string(),
            model_present,
            model_size_bytes: model_size,
            mmproj_filename: spec.mmproj_filename.to_string(),
            mmproj_path: mmproj_path.to_string_lossy().to_string(),
            mmproj_present,
            mmproj_size_bytes: mmproj_size,
        });
    }

    Ok(models)
}

#[tauri::command]
pub async fn ocr_ai_download_model(
    app: AppHandle,
    quantization: String,
) -> Result<OcrAiModelInfo, String> {
    let spec = find_quant(&quantization.to_lowercase())
        .ok_or_else(|| format!("Unknown quantization: {}. Use q8_0 or f16.", quantization))?;

    let dir = ocr_ai_dir(&app)?;
    let model_dest = dir.join(spec.model_filename);
    let mmproj_dest = dir.join(spec.mmproj_filename);

    let model_id = format!("{}-{}", OCR_AI_MODEL_ID, spec.id);

    if !model_dest.exists() {
        download_to_file_async(
            &app,
            &model_id,
            spec.model_filename,
            spec.model_url,
            &model_dest,
        )
        .await
        .map_err(|e| format!("download OCR AI model: {}", e))?;
    }

    if !mmproj_dest.exists() {
        download_to_file_async(
            &app,
            &format!("{}-mmproj", model_id),
            spec.mmproj_filename,
            spec.mmproj_url,
            &mmproj_dest,
        )
        .await
        .map_err(|e| format!("download OCR AI mmproj: {}", e))?;
    }

    let model_present = model_dest.exists();
    let mmproj_present = mmproj_dest.exists();
    let model_size = if model_present { fs::metadata(&model_dest).map(|m| m.len()).unwrap_or(0) } else { 0 };
    let mmproj_size = if mmproj_present { fs::metadata(&mmproj_dest).map(|m| m.len()).unwrap_or(0) } else { 0 };

    Ok(OcrAiModelInfo {
        id: model_id,
        quantization: spec.id.to_string(),
        model_filename: spec.model_filename.to_string(),
        model_path: model_dest.to_string_lossy().to_string(),
        model_present,
        model_size_bytes: model_size,
        mmproj_filename: spec.mmproj_filename.to_string(),
        mmproj_path: mmproj_dest.to_string_lossy().to_string(),
        mmproj_present,
        mmproj_size_bytes: mmproj_size,
    })
}

#[tauri::command]
pub fn ocr_ai_remove_model(app: AppHandle, quantization: String) -> Result<(), String> {
    let spec = find_quant(&quantization.to_lowercase())
        .ok_or_else(|| format!("Unknown quantization: {}", quantization))?;

    let dir = ocr_ai_dir(&app)?;
    let model_path = dir.join(spec.model_filename);
    let mmproj_path = dir.join(spec.mmproj_filename);

    if model_path.exists() {
        fs::remove_file(&model_path).map_err(|e| format!("remove model: {}", e))?;
    }
    if mmproj_path.exists() {
        fs::remove_file(&mmproj_path).map_err(|e| format!("remove mmproj: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn ocr_ai_check_vram(app: AppHandle) -> Result<OcrAiStatus, String> {
    let hw_info = detect_hardware_sync(&app)?;

    // Use free VRAM (not total) to account for models already loaded
    let nvidia_vram_free: u64 = hw_info.gpus
        .iter()
        .filter(|g| g.vendor == "NVIDIA")
        .map(|g| g.vram_free_bytes)
        .max()
        .unwrap_or(0);

    // Total VRAM is still reported for display purposes
    let nvidia_vram_total: u64 = hw_info.gpus
        .iter()
        .filter(|g| g.vendor == "NVIDIA")
        .map(|g| g.vram_bytes)
        .max()
        .unwrap_or(0);

    // OCR AI needs ~1.1 GB for the model + 1.5 GB safety margin
    let vram_sufficient = nvidia_vram_free > 0 && (nvidia_vram_free > 1_500_000_000 + 1_100_000_000);

    Ok(OcrAiStatus {
        server_running: false,
        port: None,
        model_loaded: None,
        vram_available_bytes: if nvidia_vram_total > 0 { Some(nvidia_vram_free) } else { None },
        vram_sufficient,
    })
}

fn detect_hardware_sync(app: &AppHandle) -> Result<crate::resources::HardwareInfo, String> {
    use sysinfo::{System, Disks};

    let mut sys = System::new_all();
    sys.refresh_all();

    let os = if cfg!(target_os = "windows") { "windows".to_string() }
        else if cfg!(target_os = "macos") { "macos".to_string() }
        else { "linux".to_string() };
    let arch = if cfg!(target_arch = "aarch64") { "arm64".to_string() }
        else if cfg!(target_arch = "x86_64") { "x64".to_string() }
        else { "unknown".to_string() };

    let ram_total_bytes = sys.total_memory();
    let ram_available_bytes = sys.available_memory();

    let gpus = if cfg!(target_os = "windows") {
        crate::resources::detect_gpu_windows()
    } else if cfg!(target_os = "macos") {
        crate::resources::detect_gpu_macos()
    } else {
        crate::resources::detect_gpu_linux()
    };

    let recommended_variant = crate::resources::recommended_variant(&gpus);

    let res_dir = resources_dir(app)?;
    let (disk_free, disk_total) = {
        let disks = Disks::new_with_refreshed_list();
        let mut df = 0u64;
        let mut dt = 0u64;
        for disk in &disks {
            if res_dir.starts_with(disk.mount_point()) {
                df = disk.available_space();
                dt = disk.total_space();
                break;
            }
        }
        (df, dt)
    };

    Ok(crate::resources::HardwareInfo {
        os,
        arch,
        ram_total_bytes,
        ram_available_bytes,
        gpus,
        recommended_llamacpp_variant: recommended_variant,
        disk_free_bytes: disk_free,
        disk_total_bytes: disk_total,
    })
}

fn get_ocr_server_state() -> &'static std::sync::Mutex<Option<crate::resources::LlamaServerState>> {
    static OCR_SERVER: std::sync::OnceLock<std::sync::Mutex<Option<crate::resources::LlamaServerState>>> = std::sync::OnceLock::new();
    OCR_SERVER.get_or_init(|| std::sync::Mutex::new(None))
}

#[tauri::command]
pub async fn ocr_ai_spawn_server(
    app: AppHandle,
    quantization: String,
    port: Option<u16>,
) -> Result<crate::resources::LlamaServerStatus, String> {
    use std::process::Command;
    use crate::resources::{
        find_binary_in_dir, llamacpp_ai_dir, llamacpp_binary_name, is_process_alive,
    };

    tokio::task::spawn_blocking(move || {
        let dir = resources_dir(&app)?;
        let model_dir = dir.join("models").join(OCR_AI_MODEL_ID);

        let spec = find_quant(&quantization.to_lowercase())
            .ok_or_else(|| format!("Unknown quantization: {}", quantization))?;

        let model_path = model_dir.join(spec.model_filename);
        let mmproj_path = model_dir.join(spec.mmproj_filename);

        if !model_path.exists() {
            return Err(format!(
                "OCR AI model not found: {}. Download it first from Preferences → OCR.",
                model_path.display()
            ));
        }
        if !mmproj_path.exists() {
            return Err(format!(
                "OCR AI mmproj not found: {}. Download it first from Preferences → OCR.",
                mmproj_path.display()
            ));
        }

        let server_state = get_ocr_server_state();
        let mut state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

        if let Some(ref existing) = *state {
            if is_process_alive(existing.pid) {
                return Ok(crate::resources::LlamaServerStatus {
                    running: true,
                    pid: Some(existing.pid),
                    port: Some(existing.port),
                    model_path: Some(existing.model_path.clone()),
                });
            }
        }

        let llama_dir = llamacpp_ai_dir(&dir);
        let binary = find_binary_in_dir(&llama_dir, llamacpp_binary_name())
            .map_err(|e| format!("llama-server binary not found: {}", e))?;

        // Pre-start verification: if the installed variant is CUDA on Windows,
        // verify that the CUDA runtime DLLs are present.
        #[cfg(target_os = "windows")]
        {
            let meta_path = llama_dir.join("variant.txt");
            if meta_path.exists() {
                let installed_variant = std::fs::read_to_string(&meta_path)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if installed_variant == "cuda" {
                    let dll_path = llama_dir.join("cublas64_12.dll");
                    let cudart_path = llama_dir.join("cudart64_12.dll");
                    if !dll_path.exists() || !cudart_path.exists() {
                        return Err(format!(
                            "CUDA runtime DLLs missing (expected cublas64_12.dll and cudart64_12.dll in {}). \
                             Reinstall the CUDA variant from Preferences > Local Models, or switch to Vulkan/CPU.",
                            llama_dir.display()
                        ));
                    }
                }
            }
        }

        // Read installed variant for variant-aware flags
        let meta_path = llama_dir.join("variant.txt");
        let installed_variant = if meta_path.exists() {
            std::fs::read_to_string(&meta_path)
                .unwrap_or_default()
                .trim()
                .to_string()
        } else {
            String::new()
        };

        let actual_port = port.unwrap_or(OCR_AI_DEFAULT_PORT);

        let mut cmd = Command::new(&binary);
        cmd.arg("--model").arg(&model_path);
        cmd.arg("--mmproj").arg(&mmproj_path);
        cmd.arg("--port").arg(actual_port.to_string());
        cmd.arg("--host").arg("127.0.0.1");
        cmd.arg("--n-gpu-layers").arg("auto");
        cmd.arg("--flash-attn").arg("auto");
        cmd.arg("--parallel").arg("1");
        cmd.arg("--no-cache-prompt");
        cmd.arg("--batch-size").arg("512");
        cmd.arg("--ctx-size").arg("4096");

        // Variant-aware flags (mirroring llamacpp_spawn_server logic)
        if installed_variant == "vulkan" {
            cmd.arg("-fit").arg("off");
            if let Some(dev) = crate::resources::pick_best_vulkan_device(&llama_dir, &binary) {
                cmd.arg("--device").arg(&dev);
            }
        }

        // Redirect logs
        let log_path = dir.join("ocr-ai-server.log");
        let log_file = std::fs::File::create(&log_path)
            .map_err(|e| format!("create OCR AI log file: {}", e))?;
        cmd.stdout(log_file.try_clone().map_err(|e| format!("clone stdout: {}", e))?);
        cmd.stderr(log_file);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let child = cmd.spawn().map_err(|e| format!("spawn OCR AI llama-server: {}", e))?;
        let pid = child.id();

        *state = Some(crate::resources::LlamaServerState {
            pid,
            port: actual_port,
            model_path: model_path.to_string_lossy().to_string(),
        });

        Ok(crate::resources::LlamaServerStatus {
            running: true,
            pid: Some(pid),
            port: Some(actual_port),
            model_path: Some(model_path.to_string_lossy().to_string()),
        })
    }).await.map_err(|e| format!("join error: {}", e))?
}

#[tauri::command]
pub async fn ocr_ai_stop_server() -> Result<crate::resources::LlamaServerStatus, String> {
    use crate::resources::is_process_alive;

    tokio::task::spawn_blocking(move || {
        let server_state = get_ocr_server_state();
        let mut state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

        // Kill only the OCR AI server process by PID
        if let Some(ref existing) = *state {
            if is_process_alive(existing.pid) {
                #[cfg(target_os = "windows")]
                {
                    let _ = crate::resources::silent_command("taskkill")
                        .args(["/F", "/PID", &existing.pid.to_string()])
                        .output();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &existing.pid.to_string()])
                        .output();
                }
            }
        }

        *state = None;
        Ok(crate::resources::LlamaServerStatus {
            running: false,
            pid: None,
            port: None,
            model_path: None,
        })
    }).await.map_err(|e| format!("join error: {}", e))?
}

#[tauri::command]
pub fn ocr_ai_read_log(app: AppHandle) -> Result<String, String> {
    let dir = resources_dir(&app)?;
    let log_path = dir.join("ocr-ai-server.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    let max_bytes = 8192;
    let metadata = fs::metadata(&log_path).map_err(|e| format!("read log metadata: {}", e))?;
    let file_size = metadata.len();
    let start = if file_size > max_bytes { file_size - max_bytes } else { 0 };
    let bytes = fs::read(&log_path).map_err(|e| format!("read log file: {}", e))?;
    let slice = if start > 0 { &bytes[start as usize..] } else { &bytes };
    String::from_utf8(slice.to_vec()).map_err(|e| format!("log is not valid UTF-8: {}", e))
}

#[tauri::command]
pub async fn ocr_ai_server_status() -> Result<crate::resources::LlamaServerStatus, String> {
    use crate::resources::is_process_alive;

    tokio::task::spawn_blocking(move || {
        let server_state = get_ocr_server_state();
        let state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

        match state.as_ref() {
            Some(existing) => {
                let alive = is_process_alive(existing.pid);
                Ok(crate::resources::LlamaServerStatus {
                    running: alive,
                    pid: if alive { Some(existing.pid) } else { None },
                    port: if alive { Some(existing.port) } else { None },
                    model_path: if alive { Some(existing.model_path.clone()) } else { None },
                })
            }
            None => Ok(crate::resources::LlamaServerStatus {
                running: false,
                pid: None,
                port: None,
                model_path: None,
            }),
        }
    }).await.map_err(|e| format!("join error: {}", e))?
}