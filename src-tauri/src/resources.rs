// resources.rs - Local AI resource management (llama.cpp + nomic-embed GGUF)
//
// Handles download, status, removal, spawn, and Ollama fallback for the
// self-contained embeddings stack. The downloads are performed at runtime
// to a per-OS data directory; nothing is bundled into the installer.
//
// All assets are pinned by default to llama.cpp b9587 (2026-06-10) and
// nomic-embed-text-v2-moe Q8_0. The URLs can be overridden by the
// frontend in case a future release needs to be re-pinned without a
// Rust change.

use std::fs::{self, File};
use std::io::{self};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, Manager};

const LLAMACPP_PINNED_VERSION: &str = "b9596";
const NOMIC_MODEL_FILENAME: &str = "nomic-embed-text-v2-moe.Q8_0.gguf";
const NOMIC_DEFAULT_URL: &str = "https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF/resolve/main/nomic-embed-text-v2-moe.Q8_0.gguf";
const NOMIC_LICENSE: &str = "Apache-2.0";
const LLAMACPP_LICENSE: &str = "MIT";
const NOMIC_SHA256_EXPECTED: &str = "6E7A7E594A26985523C18383ABA4AAD39FE6E14F08FFC6AB5B554E1CCDC3CFF";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub present: bool,
    pub path: String,
    pub size_bytes: u64,
    pub version: String,
    pub license: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourcesStatus {
    pub llamacpp: ResourceInfo,
    pub nomic: ResourceInfo,
    pub ollama_installed: bool,
    pub ollama_path: String,
    pub data_dir: String,
    pub platform: String,
    pub arch: String,
}

fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let dir = base.join("resources");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create resources dir: {}", e))?;
    }
    Ok(dir)
}

fn platform_string() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn arch_string() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "unknown"
    }
}

fn default_llamacpp_url() -> String {
    llamacpp_url_for_variant("cpu")
}

fn llamacpp_url_for_variant(variant: &str) -> String {
    let platform = platform_string();
    let arch = arch_string();
    let ver = LLAMACPP_PINNED_VERSION;
    let asset = match (platform, arch, variant) {
        // Windows: CPU, CUDA (cu12), Vulkan
        ("windows", "x64", "cpu") => format!("llama-{}-bin-win-cpu-x64.zip", ver),
        ("windows", "x64", "cuda") => format!("llama-{}-bin-win-cuda-cu12.4.1-x64.zip", ver),
        ("windows", "x64", "vulkan") => format!("llama-{}-bin-win-vulkan-x64.zip", ver),
        ("windows", "arm64", "cpu") => format!("llama-{}-bin-win-cpu-arm64.zip", ver),
        // macOS: Metal is included in the standard build
        ("macos", "arm64", _) => format!("llama-{}-bin-macos-arm64.tar.gz", ver),
        ("macos", "x64", _) => format!("llama-{}-bin-macos-x64.tar.gz", ver),
        // Linux: CPU, CUDA, Vulkan
        ("linux", "x64", "cpu") => format!("llama-{}-bin-ubuntu-x64.tar.gz", ver),
        ("linux", "x64", "cuda") => format!("llama-{}-bin-ubuntu-cuda-cu12.4.1-x64.tar.gz", ver),
        ("linux", "x64", "vulkan") => format!("llama-{}-bin-ubuntu-vulkan-x64.tar.gz", ver),
        ("linux", "arm64", _) => format!("llama-{}-bin-ubuntu-arm64.tar.gz", ver),
        // Fallback
        _ => format!("llama-{}-bin-ubuntu-x64.tar.gz", ver),
    };
    format!(
        "https://github.com/ggml-org/llama.cpp/releases/download/{}/{}",
        ver, asset
    )
}

fn is_zip_url(url: &str) -> bool {
    url.to_lowercase().ends_with(".zip")
}

fn llamacpp_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn file_size(p: &Path) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

fn verify_sha256(path: &Path, expected: &str) -> bool {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = format!("{:X}", hasher.finalize());
    result.eq_ignore_ascii_case(expected)
}

fn sha256_string(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Some(format!("{:X}", hasher.finalize()))
}

#[tauri::command]
pub fn resources_get_status(app: AppHandle) -> Result<ResourcesStatus, String> {
    let dir = resources_dir(&app)?;
    let llama_dir = dir.join("llama.cpp");
    let bin_path = find_binary_in_dir(&llama_dir, llamacpp_binary_name())
        .ok()
        .filter(|p| p.exists());
    let model_path = dir.join("nomic").join(NOMIC_MODEL_FILENAME);

    let llamacpp_present = bin_path.is_some();
    let nomic_present = model_path.exists();

    let ollama_path = find_ollama_binary().unwrap_or_default();
    let ollama_installed = !ollama_path.is_empty();

    let (llama_display_path, llama_size) = match &bin_path {
        Some(p) => (p.to_string_lossy().to_string(), file_size(p)),
        None => (llama_dir.join(llamacpp_binary_name()).to_string_lossy().to_string(), 0),
    };

    Ok(ResourcesStatus {
        llamacpp: ResourceInfo {
            present: llamacpp_present,
            path: llama_display_path,
            size_bytes: llama_size,
            version: LLAMACPP_PINNED_VERSION.to_string(),
            license: LLAMACPP_LICENSE.to_string(),
            download_url: default_llamacpp_url(),
        },
        nomic: ResourceInfo {
            present: nomic_present,
            path: model_path.to_string_lossy().to_string(),
            size_bytes: if nomic_present { file_size(&model_path) } else { 0 },
            version: "v2-moe".to_string(),
            license: NOMIC_LICENSE.to_string(),
            download_url: NOMIC_DEFAULT_URL.to_string(),
        },
        ollama_installed,
        ollama_path,
        data_dir: dir.to_string_lossy().to_string(),
        platform: platform_string().to_string(),
        arch: arch_string().to_string(),
    })
}

#[tauri::command]
pub fn resources_verify_nomic(app: AppHandle) -> Result<bool, String> {
    let dir = resources_dir(&app)?;
    let model_path = dir.join("nomic").join(NOMIC_MODEL_FILENAME);
    if !model_path.exists() {
        return Ok(false);
    }
    Ok(verify_sha256(&model_path, NOMIC_SHA256_EXPECTED))
}

#[tauri::command]
pub fn resources_nomic_sha256(app: AppHandle) -> Result<String, String> {
    let dir = resources_dir(&app)?;
    let model_path = dir.join("nomic").join(NOMIC_MODEL_FILENAME);
    if !model_path.exists() {
        return Err("nomic model not downloaded".to_string());
    }
    sha256_string(&model_path).ok_or_else(|| "failed to hash model".to_string())
}

async fn download_to_file_async(
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
    url: &str,
    dest: &Path,
) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": id,
            "name": name,
            "phase": "downloading",
            "bytes": 0,
            "total": 0,
            "speed_bps": 0,
            "eta_seconds": null,
        }),
    );
    let resp = client
        .get(url)
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e))?;
    if !resp.status().is_success() {
        let err_payload = serde_json::json!({
            "id": id,
            "name": name,
            "phase": "error",
            "error": format!("HTTP {} for {}", resp.status(), url),
            "bytes": 0,
            "total": 0,
            "speed_bps": 0,
            "eta_seconds": null,
        });
        let _ = app.emit("download-progress", err_payload);
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }
    let total = resp.content_length().unwrap_or(0);
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    let start = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": id,
            "name": name,
            "phase": "downloading",
            "bytes": 0,
            "total": total,
            "speed_bps": 0,
            "eta_seconds": null,
        }),
    );

    let mut downloaded: u64 = 0;
    let mut chunks: Vec<u8> = Vec::with_capacity(total as usize);
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut download_error: Option<String> = None;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                download_error = Some(format!("stream error: {}", e));
                break;
            }
        };
        downloaded += chunk.len() as u64;
        chunks.extend_from_slice(&chunk);
        if last_emit.elapsed() >= Duration::from_millis(200) {
            let elapsed = start.elapsed().as_secs_f64();
            let speed_bps = if elapsed > 0.0 {
                (downloaded as f64 / elapsed) as u64
            } else {
                0
            };
            let eta = if total > 0 && speed_bps > 0 {
                ((total - downloaded) as f64 / speed_bps as f64).max(0.0)
            } else {
                -1.0
            };
            let eta_value = if eta < 0.0 { serde_json::Value::Null } else { serde_json::json!(eta) };
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "id": id,
                    "name": name,
                    "phase": "downloading",
                    "bytes": downloaded,
                    "total": total,
                    "speed_bps": speed_bps,
                    "eta_seconds": eta_value,
                }),
            );
            last_emit = std::time::Instant::now();
        }
    }
    if let Some(err) = download_error {
        return Err(format!("download failed: {}", err));
    }
    let downloaded = chunks.len() as u64;
    if downloaded == 0 {
        return Err("Download produced an empty file (server returned 0 bytes).".to_string());
    }
    if total > 0 && downloaded < total {
        return Err(format!(
            "Incomplete download: got {} bytes, expected {} bytes. The server may have closed the connection early.",
            downloaded, total
        ));
    }
    if let Err(e) = fs::write(dest, &chunks) {
        return Err(format!("write: {}", e));
    }
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": id,
            "name": name,
            "phase": "done",
            "bytes": downloaded,
            "total": total,
            "speed_bps": 0,
            "eta_seconds": null,
        }),
    );
    Ok(downloaded)
}

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let f = File::open(zip_path).map_err(|e| format!("open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("read zip: {}", e))?;
    fs::create_dir_all(dest_dir).map_err(|e| format!("create dest: {}", e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("zip entry: {}", e))?;
        let name = entry.name().to_string();
        if name.contains("..") {
            continue;
        }
        let outpath = dest_dir.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out = File::create(&outpath).map_err(|e| format!("create {}: {}", outpath.display(), e))?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("write: {}", e))?;
        }
    }
    Ok(())
}

fn extract_tar_gz(tar_gz_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let f = File::open(tar_gz_path).map_err(|e| format!("open tar.gz: {}", e))?;
    let gz = flate2::read::GzDecoder::new(f);
    let mut archive = tar::Archive::new(gz);
    archive.unpack(dest_dir).map_err(|e| format!("unpack tar.gz: {}", e))?;
    Ok(())
}

fn find_binary_in_dir(root: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    if !root.exists() {
        return Err(format!("Root directory does not exist: {}", root.display()));
    }
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if file_name == name {
                        return Ok(path);
                    }
                }
            }
        }
    }
    Err(format!(
        "Extracted archive but {} not found under {}",
        name,
        root.display()
    ))
}

#[tauri::command]
pub async fn resources_download_llamacpp(app: AppHandle) -> Result<ResourceInfo, String> {
    let dir = resources_dir(&app)?;
    let target_dir = dir.join("llama.cpp");
    let url = default_llamacpp_url();
    let is_zip = is_zip_url(&url);
    let archive_path = if is_zip {
        dir.join("llama.cpp.zip")
    } else {
        dir.join("llama.cpp.tar.gz")
    };
    let _ = fs::create_dir_all(&target_dir);
    download_to_file_async(&app, "llamacpp", "llama.cpp", &url, &archive_path)
        .await
        .map_err(|e| format!("download llama.cpp: {}", e))?;
    if is_zip {
        extract_zip(&archive_path, &target_dir).map_err(|e| format!("extract llama.cpp zip: {}", e))?;
    } else {
        extract_tar_gz(&archive_path, &target_dir).map_err(|e| format!("extract llama.cpp tar.gz: {}", e))?;
    }
    let _ = fs::remove_file(&archive_path);
    let bin = find_binary_in_dir(&target_dir, llamacpp_binary_name())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).ok();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).ok();
    }
    Ok(ResourceInfo {
        present: true,
        path: bin.to_string_lossy().to_string(),
        size_bytes: file_size(&bin),
        version: LLAMACPP_PINNED_VERSION.to_string(),
        license: LLAMACPP_LICENSE.to_string(),
        download_url: url.to_string(),
    })
}

#[tauri::command]
pub async fn resources_download_llamacpp_variant(
    app: AppHandle,
    variant: String,
) -> Result<ResourceInfo, String> {
    let valid_variants = ["cpu", "cuda", "vulkan"];
    if !valid_variants.contains(&variant.as_str()) {
        return Err(format!(
            "invalid variant '{}', must be one of: cpu, cuda, vulkan",
            variant
        ));
    }
    // On macOS, Metal is always included so variant doesn't matter
    let effective_variant = if cfg!(target_os = "macos") {
        "metal"
    } else {
        &variant
    };

    let dir = resources_dir(&app)?;
    let target_dir = dir.join("llama.cpp");
    let url = llamacpp_url_for_variant(&variant);
    let is_zip = is_zip_url(&url);
    let archive_path = if is_zip {
        dir.join(format!("llama.cpp-{}.zip", variant))
    } else {
        dir.join(format!("llama.cpp-{}.tar.gz", variant))
    };

    // Remove old variant directory contents first (keep llama.cpp dir but clean it)
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    let _ = fs::create_dir_all(&target_dir);

    let download_name = format!("llamacpp-{}", variant);
    download_to_file_async(&app, &download_name, &download_name, &url, &archive_path)
        .await
        .map_err(|e| format!("download llama.cpp {}: {}", variant, e))?;

    if is_zip {
        extract_zip(&archive_path, &target_dir)
            .map_err(|e| format!("extract llama.cpp {} zip: {}", variant, e))?;
    } else {
        extract_tar_gz(&archive_path, &target_dir)
            .map_err(|e| format!("extract llama.cpp {} tar.gz: {}", variant, e))?;
    }
    let _ = fs::remove_file(&archive_path);

    let bin = find_binary_in_dir(&target_dir, llamacpp_binary_name())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).ok();
    }

    // Write a metadata file with the variant
    let meta_path = target_dir.join("variant.txt");
    fs::write(&meta_path, effective_variant).map_err(|e| format!("write variant: {}", e))?;

    Ok(ResourceInfo {
        present: true,
        path: bin.to_string_lossy().to_string(),
        size_bytes: file_size(&bin),
        version: LLAMACPP_PINNED_VERSION.to_string(),
        license: LLAMACPP_LICENSE.to_string(),
        download_url: url.to_string(),
    })
}

#[tauri::command]
pub fn resources_llamacpp_variant(app: AppHandle) -> Result<String, String> {
    let dir = resources_dir(&app)?;
    let llama_dir = dir.join("llama.cpp");
    let meta_path = llama_dir.join("variant.txt");
    if meta_path.exists() {
        let variant = fs::read_to_string(&meta_path).unwrap_or_else(|_| "cpu".to_string());
        Ok(variant.trim().to_string())
    } else {
        // Legacy install: assume CPU
        Ok("cpu".to_string())
    }
}

#[tauri::command]
pub async fn resources_download_nomic(app: AppHandle) -> Result<ResourceInfo, String> {
    let dir = resources_dir(&app)?;
    let target_dir = dir.join("nomic");
    let target = target_dir.join(NOMIC_MODEL_FILENAME);
    let url = NOMIC_DEFAULT_URL;
    download_to_file_async(&app, "nomic", "nomic-embed-text-v2-moe", &url, &target)
        .await
        .map_err(|e| format!("download nomic: {}", e))?;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": "nomic",
            "name": "nomic-embed-text-v2-moe",
            "phase": "verifying",
            "bytes": 0,
            "total": 0,
            "speed_bps": 0,
            "eta_seconds": null,
        }),
    );
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": "nomic",
            "name": "nomic-embed-text-v2-moe",
            "phase": "done",
            "bytes": 0,
            "total": 0,
            "speed_bps": 0,
            "eta_seconds": null,
        }),
    );
    Ok(ResourceInfo {
        present: true,
        path: target.to_string_lossy().to_string(),
        size_bytes: file_size(&target),
        version: "v2-moe".to_string(),
        license: NOMIC_LICENSE.to_string(),
        download_url: url.to_string(),
    })
}

#[tauri::command]
pub fn resources_remove_all(app: AppHandle) -> Result<(), String> {
    let dir = resources_dir(&app)?;
    let llama = dir.join("llama.cpp");
    let nomic = dir.join("nomic");
    if llama.exists() {
        fs::remove_dir_all(&llama).map_err(|e| format!("remove llama.cpp: {}", e))?;
    }
    if nomic.exists() {
        fs::remove_dir_all(&nomic).map_err(|e| format!("remove nomic: {}", e))?;
    }
    Ok(())
}

fn find_ollama_binary() -> Option<String> {
    let cmd = if cfg!(target_os = "windows") { "ollama.exe" } else { "ollama" };
    let paths = if cfg!(target_os = "windows") {
        vec![
            format!("C:\\Program Files\\Ollama\\{}", cmd),
            format!("C:\\Program Files (x86)\\Ollama\\{}", cmd),
            format!("{}\\AppData\\Local\\Programs\\Ollama\\{}", std::env::var("LOCALAPPDATA").unwrap_or_default(), cmd),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            format!("/usr/local/bin/{}", cmd),
            format!("/opt/homebrew/bin/{}", cmd),
            format!("{}/.local/bin/{}", std::env::var("HOME").unwrap_or_default(), cmd),
        ]
    } else {
        vec![
            format!("/usr/local/bin/{}", cmd),
            format!("/usr/bin/{}", cmd),
            format!("{}/.local/bin/{}", std::env::var("HOME").unwrap_or_default(), cmd),
        ]
    };
    for p in &paths {
        if Path::new(p).exists() {
            return Some(p.clone());
        }
    }
    if let Ok(out) = Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
        .arg(cmd)
        .output()
    {
        if out.status.success() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                let trimmed = s.lines().next().unwrap_or("").trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn ollama_check() -> bool {
    find_ollama_binary().is_some()
}

#[tauri::command]
pub fn ollama_pull_model(model: String) -> Result<String, String> {
    let bin = find_ollama_binary().ok_or_else(|| "Ollama binary not found on PATH or in standard install locations".to_string())?;
    let output = Command::new(&bin)
        .arg("pull")
        .arg(&model)
        .output()
        .map_err(|e| format!("spawn ollama failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ollama pull exited with {}: {}", output.status, stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn ollama_pull_nomic() -> Result<String, String> {
    ollama_pull_model("nomic-embed-text-v2-moe".to_string())
}

#[tauri::command]
pub fn embeddings_check_provider(app: AppHandle) -> Result<String, String> {
    // Returns one of: "llamacpp" | "ollama" | "none"
    if let Ok(dir) = resources_dir(&app) {
        let llama_dir = dir.join("llama.cpp");
        if find_binary_in_dir(&llama_dir, llamacpp_binary_name()).is_ok() {
            return Ok("llamacpp".to_string());
        }
    }
    if ollama_check() {
        return Ok("ollama".to_string());
    }
    Ok("none".to_string())
}

// ============================================================================
// Chat Model Download/Management (M8.3)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub mmproj_present: bool,
    pub mmproj_path: Option<String>,
    pub mmproj_size_bytes: Option<u64>,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = resources_dir(app)?;
    let dir = base.join("models");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create models dir: {}", e))?;
    }
    Ok(dir)
}

#[tauri::command]
pub async fn resources_download_chat_model(
    app: AppHandle,
    model_id: String,
    url: String,
    filename: String,
    mmproj_url: Option<String>,
    mmproj_filename: Option<String>,
) -> Result<ModelInfo, String> {
    let dir = models_dir(&app)?;
    let model_subdir = dir.join(&model_id);
    if !model_subdir.exists() {
        fs::create_dir_all(&model_subdir).map_err(|e| format!("create model dir: {}", e))?;
    }

    let dest = model_subdir.join(&filename);
    download_to_file_async(&app, &model_id, &filename, &url, &dest).await?;

    let model_path = dest.to_string_lossy().to_string();
    let model_size = file_size(&dest);

    let mut mmproj_present = false;
    let mut mmproj_path_val: Option<String> = None;
    let mut mmproj_size_val: Option<u64> = None;

    if let (Some(mp_url), Some(mp_filename)) = (&mmproj_url, &mmproj_filename) {
        let mp_dest = model_subdir.join(mp_filename);
        match download_to_file_async(&app, &format!("{}-mmproj", model_id), mp_filename, mp_url, &mp_dest).await {
            Ok(_) => {
                mmproj_present = true;
                mmproj_path_val = Some(mp_dest.to_string_lossy().to_string());
                mmproj_size_val = Some(file_size(&mp_dest));
            }
            Err(e) => {
                eprintln!("[model download] mmproj download failed for {}: {}", model_id, e);
            }
        }
    }

    Ok(ModelInfo {
        id: model_id,
        filename,
        path: model_path,
        size_bytes: model_size,
        mmproj_present,
        mmproj_path: mmproj_path_val,
        mmproj_size_bytes: mmproj_size_val,
    })
}

#[tauri::command]
pub fn resources_list_chat_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    let dir = models_dir(&app)?;
    let mut models = Vec::new();

    if !dir.exists() {
        return Ok(models);
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("read models dir: {}", e))?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let model_id = entry.file_name().to_string_lossy().to_string();
        let model_subdir = entry.path();

        let gguf_files: Vec<PathBuf> = fs::read_dir(&model_subdir)
            .ok()
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "gguf")
                            .unwrap_or(false)
                    })
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default();

        if gguf_files.is_empty() {
            continue;
        }

        for gguf in gguf_files {
            let filename = gguf
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let path = gguf.to_string_lossy().to_string();
            let size = file_size(&gguf);

            let mmproj_files: Vec<PathBuf> = fs::read_dir(&model_subdir)
                .ok()
                .map(|entries| {
                    entries
                        .flatten()
                        .filter(|e| {
                            let name = e.file_name().to_string_lossy().to_string();
                            name.starts_with("mmproj") && name.ends_with(".gguf")
                        })
                        .map(|e| e.path())
                        .collect()
                })
                .unwrap_or_default();

            let mmproj_present = !mmproj_files.is_empty();
            let mmproj_path_val = mmproj_files.first().map(|p| p.to_string_lossy().to_string());
            let mmproj_size_val = mmproj_files.first().map(|p| file_size(p));

            models.push(ModelInfo {
                id: model_id.clone(),
                filename,
                path,
                size_bytes: size,
                mmproj_present,
                mmproj_path: mmproj_path_val,
                mmproj_size_bytes: mmproj_size_val,
            });
        }
    }

    Ok(models)
}

#[tauri::command]
pub fn resources_remove_chat_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let model_subdir = dir.join(&model_id);
    if model_subdir.exists() {
        fs::remove_dir_all(&model_subdir)
            .map_err(|e| format!("remove model {}: {}", model_id, e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn resources_register_local_model(
    app: AppHandle,
    model_id: String,
    file_path: String,
) -> Result<ModelInfo, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("file not found: {}", file_path));
    }
    if path.extension().map(|e| e != "gguf").unwrap_or(true) {
        return Err("file must be a .gguf file".to_string());
    }

    let dir = models_dir(&app)?;
    let model_subdir = dir.join(&model_id);
    if !model_subdir.exists() {
        fs::create_dir_all(&model_subdir).map_err(|e| format!("create model dir: {}", e))?;
    }

    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let size = file_size(path);

    let mmproj_files: Vec<PathBuf> = fs::read_dir(&model_subdir)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.starts_with("mmproj") && name.ends_with(".gguf")
                })
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();

    let mmproj_present = !mmproj_files.is_empty();
    let mmproj_path_val = mmproj_files.first().map(|p| p.to_string_lossy().to_string());
    let mmproj_size_val = mmproj_files.first().map(|p| file_size(p));

    Ok(ModelInfo {
        id: model_id,
        filename,
        path: file_path,
        size_bytes: size,
        mmproj_present,
        mmproj_path: mmproj_path_val,
        mmproj_size_bytes: mmproj_size_val,
    })
}

#[tauri::command]
pub fn resources_verify_model(file_path: String) -> Result<bool, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("file not found: {}", file_path));
    }
    // Check basic GGUF magic number: "GGUF" at offset 0
    let data = fs::read(path).map_err(|e| format!("read file: {}", e))?;
    if data.len() < 4 {
        return Ok(false);
    }
    let magic = &data[0..4];
    // GGUF magic is 0x46475547 = "GGUF" in little-endian
    Ok(magic == &[0x47, 0x47, 0x55, 0x46])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub vendor: String,
    pub model: String,
    pub vram_bytes: u64,
    pub backend: String, // "cuda", "vulkan", "metal", "none"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub os: String,
    pub arch: String,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    pub gpus: Vec<GpuInfo>,
    pub recommended_llamacpp_variant: String, // "cpu", "cuda", "vulkan", "metal"
    pub disk_free_bytes: u64,
    pub disk_total_bytes: u64,
}

fn detect_nvidia_gpu() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();
    let output = match Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        Ok(o) => o,
        Err(_) => return gpus,
    };

    if !output.status.success() {
        return gpus;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 2 {
            let model = parts[0].trim().to_string();
            let vram_mb: u64 = parts[1].trim().parse().unwrap_or(0);
            gpus.push(GpuInfo {
                vendor: "NVIDIA".to_string(),
                model,
                vram_bytes: vram_mb * 1024 * 1024,
                backend: "cuda".to_string(),
            });
        }
    }
    gpus
}

fn detect_gpu_windows() -> Vec<GpuInfo> {
    let mut gpus = detect_nvidia_gpu();
    if !gpus.is_empty() {
        return gpus;
    }

    // Fallback: check for AMD/Intel GPU via WMIC
    if let Ok(output) = Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "name,AdapterRAM"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().skip(1) {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
                if parts.len() >= 1 {
                    let name = parts[0].trim().to_string();
                    let vram: u64 = parts
                        .get(1)
                        .and_then(|s| s.trim().parse().ok())
                        .unwrap_or(0);
                    let vendor = if name.to_uppercase().contains("NVIDIA") {
                        "NVIDIA".to_string()
                    } else if name.to_uppercase().contains("AMD")
                        || name.to_uppercase().contains("RADEON")
                    {
                        "AMD".to_string()
                    } else if name.to_uppercase().contains("INTEL") {
                        "Intel".to_string()
                    } else {
                        "Unknown".to_string()
                    };
                    let backend = match vendor.as_str() {
                        "NVIDIA" => "cuda",
                        "AMD" | "Intel" => "vulkan",
                        _ => "vulkan",
                    };
                    gpus.push(GpuInfo {
                        vendor,
                        model: name,
                        vram_bytes: vram,
                        backend: backend.to_string(),
                    });
                }
            }
        }
    }

    gpus
}

fn detect_gpu_macos() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();
    if let Ok(output) = Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
    {
        if output.status.success() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                if let Some(arr) = json.as_array() {
                    for item in arr {
                        if let Some(displays) = item
                            .get("SPDisplaysDataType")
                            .and_then(|v| v.as_array())
                        {
                            for gpu in displays {
                                let model = gpu
                                    .get("_name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Apple GPU")
                                    .to_string();
                                let vram_str = gpu
                                    .get("spdisplays_vram")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("0");
                                let vram_bytes = parse_vram_string(vram_str);
                                gpus.push(GpuInfo {
                                    vendor: "Apple".to_string(),
                                    model,
                                    vram_bytes,
                                    backend: "metal".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    if gpus.is_empty() {
        gpus.push(GpuInfo {
            vendor: "Apple".to_string(),
            model: "Apple Silicon".to_string(),
            vram_bytes: 0,
            backend: "metal".to_string(),
        });
    }

    gpus
}

fn detect_gpu_linux() -> Vec<GpuInfo> {
    let mut gpus = detect_nvidia_gpu();
    if !gpus.is_empty() {
        return gpus;
    }

    // Check for AMD/Intel via lspci
    if let Ok(output) = Command::new("lspci").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let line_lower = line.to_lowercase();
                if line_lower.contains("vga") || line_lower.contains("3d") || line_lower.contains("display") {
                    let name = line
                        .split(':')
                        .last()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let vendor = if line_lower.contains("nvidia") {
                        "NVIDIA".to_string()
                    } else if line_lower.contains("amd") || line_lower.contains("radeon") || line_lower.contains("advanced micro devices") {
                        "AMD".to_string()
                    } else if line_lower.contains("intel") {
                        "Intel".to_string()
                    } else {
                        "Unknown".to_string()
                    };
                    let backend = match vendor.as_str() {
                        "NVIDIA" => "cuda",
                        _ => "vulkan",
                    };
                    gpus.push(GpuInfo {
                        vendor,
                        model: name,
                        vram_bytes: 0,
                        backend: backend.to_string(),
                    });
                }
            }
        }
    }

    gpus
}

fn parse_vram_string(s: &str) -> u64 {
    let s = s.to_lowercase().replace(',', "");
    let num: u64 = s
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0);
    if s.contains("gb") {
        num * 1024 * 1024 * 1024
    } else if s.contains("mb") {
        num * 1024 * 1024
    } else {
        num
    }
}

fn recommended_variant(gpus: &[GpuInfo]) -> String {
    if cfg!(target_os = "macos") {
        return "metal".to_string();
    }
    for gpu in gpus {
        match gpu.backend.as_str() {
            "cuda" => return "cuda".to_string(),
            "vulkan" => return "vulkan".to_string(),
            "metal" => return "metal".to_string(),
            _ => {}
        }
    }
    "cpu".to_string()
}

#[tauri::command]
pub fn resources_detect_hardware(app: AppHandle) -> Result<HardwareInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let os = platform_string().to_string();
    let arch = arch_string().to_string();

    let ram_total_bytes = sys.total_memory();
    let ram_available_bytes = sys.available_memory();

    let gpus = if cfg!(target_os = "windows") {
        detect_gpu_windows()
    } else if cfg!(target_os = "macos") {
        detect_gpu_macos()
    } else {
        detect_gpu_linux()
    };

    let recommended_llamacpp_variant = recommended_variant(&gpus);

    let resources_dir = resources_dir(&app)?;
    let (disk_free, disk_total) = get_disk_space(&resources_dir);

    Ok(HardwareInfo {
        os,
        arch,
        ram_total_bytes,
        ram_available_bytes,
        gpus,
        recommended_llamacpp_variant,
        disk_free_bytes: disk_free,
        disk_total_bytes: disk_total,
    })
}

fn get_disk_space(path: &Path) -> (u64, u64) {
    let disks = Disks::new_with_refreshed_list();
    for disk in &disks {
        if path.starts_with(disk.mount_point()) {
            return (disk.available_space(), disk.total_space());
        }
    }
    (0, 0)
}

// ============================================================================
// Llama Server Lifecycle (M8.6)
// ============================================================================

static LLAMA_SERVER: OnceLock<Mutex<Option<LlamaServerState>>> = OnceLock::new();

struct LlamaServerState {
    pid: u32,
    port: u16,
    model_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlamaServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub model_path: Option<String>,
}

#[tauri::command]
pub fn llamacpp_spawn_server(
    app: AppHandle,
    model_path: String,
    port: u16,
    ctx_size: Option<u32>,
    ngl: Option<String>,       // "auto", "all", or a number
    flash_attn: Option<String>, // "on", "off", "auto"
    cache_type_k: Option<String>, // "f16", "q8_0", "q4_0", etc.
    cache_type_v: Option<String>,
    threads: Option<u32>,
    mmproj_path: Option<String>,
) -> Result<LlamaServerStatus, String> {
    // Check if already running
    let server_state = LLAMA_SERVER.get_or_init(|| Mutex::new(None));
    let mut state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

    if let Some(ref existing) = *state {
        // Check if the process is still alive
        if is_process_alive(existing.pid) {
            return Ok(LlamaServerStatus {
                running: true,
                pid: Some(existing.pid),
                port: Some(existing.port),
                model_path: Some(existing.model_path.clone()),
            });
        }
    }

    let dir = resources_dir(&app)?;
    let llama_dir = dir.join("llama.cpp");
    let binary = find_binary_in_dir(&llama_dir, llamacpp_binary_name())
        .map_err(|e| format!("llama-server binary not found: {}", e))?;

    if !Path::new(&model_path).exists() {
        return Err(format!("model file not found: {}", model_path));
    }

    let mut cmd = Command::new(&binary);
    cmd.arg("--model").arg(&model_path);
    cmd.arg("--port").arg(port.to_string());
    cmd.arg("--host").arg("127.0.0.1");

    if let Some(ctx) = ctx_size {
        cmd.arg("--ctx-size").arg(ctx.to_string());
    }

    match ngl.as_deref() {
        Some("all") => { cmd.arg("--n-gpu-layers").arg("99"); }
        Some("auto") | None => { cmd.arg("--n-gpu-layers").arg("auto"); }
        Some(n) => { cmd.arg("--n-gpu-layers").arg(n); }
    }

    if let Some(fa) = flash_attn.as_deref() {
        cmd.arg("--flash-attn").arg(fa);
    } else {
        cmd.arg("--flash-attn").arg("auto");
    }

    if let Some(ctk) = cache_type_k.as_deref() {
        cmd.arg("--cache-type-k").arg(ctk);
    }
    if let Some(ctv) = cache_type_v.as_deref() {
        cmd.arg("--cache-type-v").arg(ctv);
    }

    if let Some(t) = threads {
        cmd.arg("--threads").arg(t.to_string());
    }

    if let Some(mmp) = mmproj_path.as_deref() {
        cmd.arg("--mmproj").arg(mmp);
    }

    // Production settings for a desktop app
    cmd.arg("--parallel").arg("1");
    cmd.arg("--cont-batching");
    cmd.arg("--cache-prompt");

    // Redirect stdout/stderr to log file
    let log_path = dir.join("llama-server.log");
    let log_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("create log file: {}", e))?;
    cmd.stdout(log_file.try_clone().map_err(|e| format!("clone stdout: {}", e))?);
    cmd.stderr(log_file);

    // On Windows, create process in new console to detach
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x00000010); // CREATE_NEW_CONSOLE
    }

    let child = cmd.spawn().map_err(|e| format!("spawn llama-server: {}", e))?;
    let pid = child.id();

    *state = Some(LlamaServerState {
        pid,
        port,
        model_path: model_path.clone(),
    });

    Ok(LlamaServerStatus {
        running: true,
        pid: Some(pid),
        port: Some(port),
        model_path: Some(model_path),
    })
}

#[tauri::command]
pub fn llamacpp_stop_server() -> Result<LlamaServerStatus, String> {
    let server_state = LLAMA_SERVER.get_or_init(|| Mutex::new(None));
    let mut state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

    if let Some(ref existing) = *state {
        if is_process_alive(existing.pid) {
            // Try graceful termination first
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &existing.pid.to_string()])
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                unsafe {
                    libc::kill(existing.pid as i32, libc::SIGTERM);
                }
            }
        }
    }

    *state = None;
    Ok(LlamaServerStatus {
        running: false,
        pid: None,
        port: None,
        model_path: None,
    })
}

#[tauri::command]
pub fn llamacpp_server_status() -> Result<LlamaServerStatus, String> {
    let server_state = LLAMA_SERVER.get_or_init(|| Mutex::new(None));
    let state = server_state.lock().map_err(|e| format!("lock error: {}", e))?;

    match state.as_ref() {
        Some(existing) => {
            let alive = is_process_alive(existing.pid);
            Ok(LlamaServerStatus {
                running: alive,
                pid: if alive { Some(existing.pid) } else { None },
                port: if alive { Some(existing.port) } else { None },
                model_path: if alive { Some(existing.model_path.clone()) } else { None },
            })
        }
        None => Ok(LlamaServerStatus {
            running: false,
            pid: None,
            port: None,
            model_path: None,
        }),
    }
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        let result = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        match result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output();
        match result {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Check if /proc/<pid> exists
        std::path::Path::new(&format!("/proc/{}", pid)).exists()
    }
}
