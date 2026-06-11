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
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
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
    let platform = platform_string();
    let arch = arch_string();
    let ver = LLAMACPP_PINNED_VERSION;
    let asset = match (platform, arch) {
        ("windows", "x64") => format!("llama-{}-bin-win-cpu-x64.zip", ver),
        ("windows", "arm64") => format!("llama-{}-bin-win-cpu-arm64.zip", ver),
        ("macos", "arm64") => format!("llama-{}-bin-macos-arm64.tar.gz", ver),
        ("macos", "x64") => format!("llama-{}-bin-macos-x64.tar.gz", ver),
        ("linux", "x64") => format!("llama-{}-bin-ubuntu-x64.tar.gz", ver),
        ("linux", "arm64") => format!("llama-{}-bin-ubuntu-arm64.tar.gz", ver),
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

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return Err(format!("download failed: {}", e));
        }
    };
    let downloaded = bytes.len() as u64;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({
            "id": id,
            "name": name,
            "phase": "downloading",
            "bytes": downloaded,
            "total": total,
            "speed_bps": 0,
            "eta_seconds": 0.0,
        }),
    );
    let _ = last_emit;
    let _ = start;

    if downloaded == 0 {
        return Err("Download produced an empty file (server returned 0 bytes).".to_string());
    }
    if total > 0 && downloaded < total {
        return Err(format!(
            "Incomplete download: got {} bytes, expected {} bytes. The server may have closed the connection early.",
            downloaded, total
        ));
    }

    if let Err(e) = fs::write(dest, &bytes) {
        return Err(format!("write: {}", e));
    }
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
