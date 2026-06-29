// ocr.rs - OCR language data management for AuraWrite
//
// Three Tesseract model variants per language:
//   - best   : float32 LSTM (tessdata_best on GitHub, uncompressed)
//   - medium : int8 quantized LSTM (@tesseract.js-data on jsDelivr, gzipped)
//   - fast   : distilled LSTM (tessdata_fast on GitHub, uncompressed)
//
// Stored in <app_data>/tessdata/ as:
//   <lang>.traineddata          -> best
//   <lang>_medium.traineddata.gz-> medium
//   <lang>_fast.traineddata     -> fast
//
// Before each OCR run, ocr_prepare_model() copies the requested variant to
// the standard name <lang>.traineddata (gzip-encoding it if needed) so that
// Tesseract.js can load it via langPath pointing at the tessdata directory
// served through Tauri's asset protocol.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum OcrQuality {
    Best,
    Medium,
    Fast,
}

impl OcrQuality {
    fn suffix(self) -> &'static str {
        match self {
            OcrQuality::Best => "",
            OcrQuality::Medium => "_medium",
            OcrQuality::Fast => "_fast",
        }
    }

    /// On-disk filename for the stored variant.
    fn stored_filename(self, lang: &str) -> String {
        match self {
            OcrQuality::Medium => format!("{}{}.traineddata.gz", lang, self.suffix()),
            OcrQuality::Best | OcrQuality::Fast => {
                format!("{}{}.traineddata", lang, self.suffix())
            }
        }
    }
}

fn best_url(lang: &str) -> String {
    format!(
        "https://github.com/tesseract-ocr/tessdata_best/raw/main/{}.traineddata",
        lang
    )
}

fn medium_url(lang: &str) -> String {
    format!(
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/{}@1.0.0/4.0.0_best_int/{}.traineddata.gz",
        lang, lang
    )
}

fn fast_url(lang: &str) -> String {
    format!(
        "https://github.com/tesseract-ocr/tessdata_fast/raw/main/{}.traineddata",
        lang
    )
}

fn tessdata_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir error: {}", e))?;
    let dir = base.join("tessdata");
    fs::create_dir_all(&dir).map_err(|e| format!("create tessdata dir: {}", e))?;
    Ok(dir)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OcrLanguageInfo {
    pub code: String,
    pub name: String,
    pub installed: bool,
    pub size_bytes: u64,
    pub has_best: bool,
    pub has_medium: bool,
    pub has_fast: bool,
}

const LANGUAGES: &[(&str, &str)] = &[
    ("eng", "English"),
    ("ita", "Italiano"),
    ("fra", "Français"),
    ("deu", "Deutsch"),
    ("spa", "Español"),
    ("por", "Português"),
    ("rus", "Русский"),
    ("zho", "中文"),
    ("jpn", "日本語"),
    ("ara", "العربية"),
    ("hin", "हिन्दी"),
];

#[tauri::command]
pub fn ocr_list_languages(app: AppHandle) -> Result<Vec<OcrLanguageInfo>, String> {
    let dir = tessdata_dir(&app)?;

    // Migration: rename legacy <lang>.traineddata.gz -> <lang>_medium.traineddata.gz
    for (code, _) in LANGUAGES {
        let legacy = dir.join(format!("{}.traineddata.gz", code));
        let medium = dir.join(OcrQuality::Medium.stored_filename(code));
        if legacy.exists() && !medium.exists() {
            let _ = fs::rename(&legacy, &medium);
        }
    }

    let mut langs = Vec::new();
    for (code, name) in LANGUAGES {
        let best_path = dir.join(OcrQuality::Best.stored_filename(code));
        let medium_path = dir.join(OcrQuality::Medium.stored_filename(code));
        let fast_path = dir.join(OcrQuality::Fast.stored_filename(code));
        let has_best = best_path.exists();
        let has_medium = medium_path.exists();
        let has_fast = fast_path.exists();
        let installed = has_best && has_medium && has_fast;
        let size_bytes: u64 = [&best_path, &medium_path, &fast_path]
            .iter()
            .filter(|p| p.exists())
            .map(|p| fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            .sum();
        langs.push(OcrLanguageInfo {
            code: code.to_string(),
            name: name.to_string(),
            installed,
            size_bytes,
            has_best,
            has_medium,
            has_fast,
        });
    }
    Ok(langs)
}

#[tauri::command]
pub fn ocr_is_installed(
    app: AppHandle,
    lang: String,
    quality: OcrQuality,
) -> Result<bool, String> {
    let dir = tessdata_dir(&app)?;
    Ok(dir.join(quality.stored_filename(&lang)).exists())
}

/// Copies the requested variant into the standard filename
/// `<lang>.traineddata.gz` so Tesseract.js can find it via langPath.
/// Uncompressed variants (best, fast) are gzip-compressed on the fly.
#[tauri::command]
pub fn ocr_prepare_model(
    app: AppHandle,
    lang: String,
    quality: OcrQuality,
) -> Result<(), String> {
    let dir = tessdata_dir(&app)?;
    let src = dir.join(quality.stored_filename(&lang));
    if !src.exists() {
        return Err(format!(
            "Model file not found: {}. Run download first.",
            src.display()
        ));
    }

    let dest = dir.join(format!("{}.traineddata.gz", lang));

    // If the source is already gzipped (medium variant), just copy.
    let src_is_gz = src.extension().map_or(false, |e| e == "gz")
        || src.to_string_lossy().ends_with(".gz");

    if src_is_gz {
        fs::copy(&src, &dest).map_err(|e| format!("copy: {}", e))?;
    } else {
        // Gzip the uncompressed traineddata on the fly.
        let raw = fs::read(&src).map_err(|e| format!("read source: {}", e))?;
        let dest_file = fs::File::create(&dest).map_err(|e| format!("create dest: {}", e))?;
        let mut encoder = flate2::write::GzEncoder::new(
            dest_file,
            flate2::Compression::default(),
        );
        encoder.write_all(&raw).map_err(|e| format!("gzip encode: {}", e))?;
        encoder.finish().map_err(|e| format!("gzip finish: {}", e))?;
    }

    Ok(())
}

/// Returns the directory path of <app_data>/tessdata/ as a string.
/// The frontend uses convertFileSrc() to turn this into an asset:// URL
/// that Tesseract.js can fetch from.
#[tauri::command]
pub fn ocr_get_tessdata_dir(app: AppHandle) -> Result<String, String> {
    let dir = tessdata_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Saves base64-encoded data as the "medium" variant for a bundled language.
/// Called by the frontend to install eng/ita from the app's public folder
/// into app_data on first use.
#[tauri::command]
pub fn ocr_save_bundled_medium(
    app: AppHandle,
    lang: String,
    base64_data: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("base64 decode: {}", e))?;
    let dir = tessdata_dir(&app)?;
    let dest = dir.join(OcrQuality::Medium.stored_filename(&lang));
    fs::write(&dest, &bytes).map_err(|e| format!("write file: {}", e))?;
    Ok(())
}

async fn download_one(
    client: &reqwest::Client,
    url: &str,
    dest: &std::path::Path,
) -> Result<u64, String> {
    let resp = client
        .get(url)
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("download request failed for {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "download failed: HTTP {} for {}",
            resp.status(),
            url
        ));
    }
    let total = resp.content_length().unwrap_or(0);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {}", e))?;
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create file {}: {}", dest.display(), e))?;
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write error: {}", e))?;
        downloaded += chunk.len() as u64;
    }
    file.flush()
        .await
        .map_err(|e| format!("flush error: {}", e))?;
    Ok(downloaded.max(total))
}

async fn emit_progress(
    app: &AppHandle,
    lang: &str,
    quality: OcrQuality,
    phase: &str,
    bytes: u64,
    total: u64,
) {
    let label = match quality {
        OcrQuality::Best => "best",
        OcrQuality::Medium => "medium",
        OcrQuality::Fast => "fast",
    };
    let _ = app.emit(
        "ocr-download-progress",
        serde_json::json!({
            "lang": lang,
            "quality": label,
            "phase": phase,
            "bytes": bytes,
            "total": total,
        }),
    );
}

#[tauri::command]
pub async fn ocr_download_language(app: AppHandle, lang: String) -> Result<(), String> {
    let valid: Vec<&str> = LANGUAGES.iter().map(|(c, _)| *c).collect();
    if !valid.contains(&lang.as_str()) {
        return Err(format!("Unsupported language code: {}", lang));
    }
    let dir = tessdata_dir(&app)?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {}", e))?;

    // Best (float32)
    let best_dest = dir.join(OcrQuality::Best.stored_filename(&lang));
    if !best_dest.exists() {
        emit_progress(&app, &lang, OcrQuality::Best, "downloading", 0, 0).await;
        let bytes = download_one(&client, &best_url(&lang), &best_dest).await?;
        emit_progress(&app, &lang, OcrQuality::Best, "complete", bytes, bytes).await;
    }

    // Medium (int8 gzipped)
    let medium_dest = dir.join(OcrQuality::Medium.stored_filename(&lang));
    if !medium_dest.exists() {
        emit_progress(&app, &lang, OcrQuality::Medium, "downloading", 0, 0).await;
        match download_one(&client, &medium_url(&lang), &medium_dest).await {
            Ok(bytes) => {
                emit_progress(&app, &lang, OcrQuality::Medium, "complete", bytes, bytes).await;
            }
            Err(e) => {
                let _ = fs::remove_file(&medium_dest);
                return Err(format!("Medium variant download failed: {}", e));
            }
        }
    }

    // Fast (distilled)
    let fast_dest = dir.join(OcrQuality::Fast.stored_filename(&lang));
    if !fast_dest.exists() {
        emit_progress(&app, &lang, OcrQuality::Fast, "downloading", 0, 0).await;
        let bytes = download_one(&client, &fast_url(&lang), &fast_dest).await?;
        emit_progress(&app, &lang, OcrQuality::Fast, "complete", bytes, bytes).await;
    }

    let _ = app.emit(
        "ocr-download-complete",
        serde_json::json!({"lang": lang}),
    );
    Ok(())
}

#[tauri::command]
pub fn ocr_remove_language(app: AppHandle, lang: String) -> Result<(), String> {
    let valid: Vec<&str> = LANGUAGES.iter().map(|(c, _)| *c).collect();
    if !valid.contains(&lang.as_str()) {
        return Err(format!("Unsupported language code: {}", lang));
    }
    let dir = tessdata_dir(&app)?;
    let files = [
        dir.join(OcrQuality::Best.stored_filename(&lang)),
        dir.join(OcrQuality::Medium.stored_filename(&lang)),
        dir.join(OcrQuality::Fast.stored_filename(&lang)),
        dir.join(format!("{}.traineddata.gz", lang)), // prepared copy
    ];
    let mut removed = false;
    for f in files {
        if f.exists() {
            fs::remove_file(&f).map_err(|e| format!("remove file: {}", e))?;
            removed = true;
        }
    }
    if !removed {
        return Err(format!("Language {} is not installed", lang));
    }
    Ok(())
}