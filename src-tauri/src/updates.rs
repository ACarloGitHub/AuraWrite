// updates.rs - Check for new AuraWrite releases on GitHub
//
// Called from the frontend at app startup (and on demand via a menu item).
// The check is read-only and silent on failure - if the user is offline
// or the API rate-limits us, nothing happens. The user can disable
// this in Preferences.

use serde::Serialize;

const GITHUB_REPO: &str = "ACarloGitHub/AuraWrite";
const GITHUB_API_LATEST: &str = "https://api.github.com/repos/ACarloGitHub/AuraWrite/releases/latest";

#[derive(Debug, Clone, Serialize)]
pub struct ReleaseInfo {
    pub version: String,
    pub tag: String,
    pub url: String,
    pub body: String,
    pub published_at: String,
    pub prerelease: bool,
}

/// Compare two semver-ish strings (e.g. "0.3.0" vs "0.4.0").
/// Returns true if `latest` is strictly newer than `current`.
/// Pre-release tags like "0.4.0-beta.1" are treated as the same major.minor.patch.
fn is_newer_version(latest: &str, current: &str) -> bool {
    fn parse(v: &str) -> Option<(u32, u32, u32)> {
        let v = v.trim_start_matches('v').trim();
        // Take the first three numeric components (drop -beta, +build, etc.)
        let mut parts = v.split(|c: char| !c.is_ascii_digit() && c != '.');
        let p1 = parts.next()?.parse::<u32>().ok()?;
        let p2 = parts.next()?.parse::<u32>().ok()?;
        let p3 = parts.next()?.parse::<u32>().ok()?;
        Some((p1, p2, p3))
    }
    match (parse(latest), parse(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Fetches the latest release info from GitHub.
/// Returns Ok(None) if the current version is up to date or the response is unparseable.
/// Returns Ok(Some(ReleaseInfo)) if a newer release exists.
#[tauri::command]
pub async fn check_for_updates() -> Result<Option<ReleaseInfo>, String> {
    let current = env!("CARGO_PKG_VERSION");
    eprintln!("[updates] checking for new releases (current: {})", current);

    let client = reqwest::Client::builder()
        .user_agent(concat!("AuraWrite/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = match client.get(GITHUB_API_LATEST).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[updates] network error: {}", e);
            return Ok(None);
        }
    };

    if !resp.status().is_success() {
        eprintln!("[updates] GitHub API returned status {}", resp.status());
        return Ok(None);
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[updates] failed to parse JSON: {}", e);
            return Ok(None);
        }
    };

    let tag = json["tag_name"].as_str().unwrap_or("").to_string();
    let version = tag.trim_start_matches('v').to_string();
    let url = json["html_url"].as_str().unwrap_or("").to_string();
    let body = json["body"].as_str().unwrap_or("").to_string();
    let published_at = json["published_at"].as_str().unwrap_or("").to_string();
    let prerelease = json["prerelease"].as_bool().unwrap_or(false);

    if tag.is_empty() {
        eprintln!("[updates] empty tag_name in GitHub response");
        return Ok(None);
    }

    if is_newer_version(&version, current) {
        eprintln!(
            "[updates] new release available: {} (current: {})",
            version,
            current
        );
        Ok(Some(ReleaseInfo {
            version,
            tag,
            url,
            body,
            published_at,
            prerelease,
        }))
    } else {
        eprintln!("[updates] up to date");
        Ok(None)
    }
}

#[allow(dead_code)]
const fn _unused() {
    let _ = GITHUB_REPO;
    let _ = GITHUB_API_LATEST;
}
