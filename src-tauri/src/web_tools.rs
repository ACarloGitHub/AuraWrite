// web_tools.rs - Native MCP web tools
//
// Provides web_search (DuckDuckGo HTML scraping with Brave fallback),
// web_fetch (GET URL → stripped content), and web_search_images.
//
// All results include [INSTRUCTION: ...] prefixes following the
// Tool Result Injection pattern (see planner.rs for reference).

use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use crate::secrets;

const MAX_FETCH_BYTES: usize = 200 * 1024;
const MAX_FETCH_DISPLAY: usize = 50 * 1024;
const FETCH_TIMEOUT_SECS: u64 = 30;
const MAX_SNIPPET_LEN: usize = 300;

// Pre-compiled regexes (computed once, reused on every call)
static LINK_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<a\s+[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class='result-link'[^>]*>(.*?)</a>"#).unwrap()
});
static LINK_RE_ALT: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<a\s+[^>]*class='result-link'[^>]*href="([^"]+)"[^>]*rel="nofollow"[^>]*>(.*?)</a>"#).unwrap()
});
static LINK_RE_DQ: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap()
});
static SNIPPET_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<td\s+class='result-snippet'[^>]*>(.*?)</td>"#).unwrap()
});
static SNIPPET_RE_DQ: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<td[^>]*class="result-snippet"[^>]*>(.*?)</td>"#).unwrap()
});
static VQD_JSON_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"vqd['"]\s*:\s*['"]([^'"]+)"#).unwrap()
});
static VQD_INPUT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<input[^>]*name="vqd"[^>]*value="([^"]*)""#).unwrap()
});
static SCRIPT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap()
});
static STYLE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap()
});
static LINK_MD_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap()
});
static BLOCK_TAG_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"</(p|div|br|h[1-6]|li|tr)>").unwrap()
});
static BR_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"<br\s*/?\s*>").unwrap()
});
static LI_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"<li[^>]*>").unwrap()
});
static BOLD_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"<(strong|b)[^>]*>(.*?)</(strong|b)>").unwrap()
});
static ITALIC_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"<(em|i)[^>]*>(.*?)</(em|i)>").unwrap()
});
static HTML_TAG_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"<[^>]+>").unwrap()
});
static MULTI_NEWLINE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\n{3,}").unwrap()
});
static HEADING_RE: [LazyLock<regex::Regex>; 6] = [
    LazyLock::new(|| regex::Regex::new(r#"<h1[^>]*>(.*?)</h1>"#).unwrap()),
    LazyLock::new(|| regex::Regex::new(r#"<h2[^>]*>(.*?)</h2>"#).unwrap()),
    LazyLock::new(|| regex::Regex::new(r#"<h3[^>]*>(.*?)</h3>"#).unwrap()),
    LazyLock::new(|| regex::Regex::new(r#"<h4[^>]*>(.*?)</h4>"#).unwrap()),
    LazyLock::new(|| regex::Regex::new(r#"<h5[^>]*>(.*?)</h5>"#).unwrap()),
    LazyLock::new(|| regex::Regex::new(r#"<h6[^>]*>(.*?)</h6>"#).unwrap()),
];

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageSearchResult {
    pub url: String,
    pub title: String,
    pub thumbnail_url: String,
    pub width: u32,
    pub height: u32,
    pub source: String,
}

#[tauri::command]
pub async fn web_search(query: String, limit: Option<i32>) -> Result<String, String> {
    tracing::info!(query = %query, "web_search called");
    let max = limit.unwrap_or(10).min(20) as usize;
    let client = client();

    let ddg_result = search_ddg(&client, &query, max).await;

    let results = match ddg_result {
        Ok(r) if !r.is_empty() => r,
        _ => {
            let brave_key = get_brave_api_key().await;
            match brave_key {
                Some(key) => search_brave(&client, &query, max, &key).await?,
                None => {
                    if let Err(e) = ddg_result {
                        return Err(format!("DuckDuckGo search failed: {}. No Brave API key configured.", e));
                    } else {
                        vec![]
                    }
                }
            }
        }
    };

    if results.is_empty() {
        return Ok("[INSTRUCTION: Tell the user that no results were found and suggest alternative search terms.] No search results found for the query.".to_string());
    }

    let mut lines = vec![
        format!("[INSTRUCTION: Summarize the most relevant 2-3 results for the user. Do NOT list all results verbatim. Pick the most relevant ones and describe them briefly in your own words.]"),
        format!("Found {} results for \"{}\":", results.len(), query),
    ];

    for (i, r) in results.iter().enumerate() {
        let snippet = truncate_str(&r.snippet, MAX_SNIPPET_LEN);
        lines.push(format!("{}. {} — {} {}", i + 1, r.title, r.url, if snippet.is_empty() { String::new() } else { format!("({})", snippet) }));
    }

    Ok(lines.join("\n"))
}

async fn get_brave_api_key() -> Option<String> {
    secrets::get_secret_direct("brave_api_key")
}

async fn search_ddg(
    client: &reqwest::Client,
    query: &str,
    max: usize,
) -> Result<Vec<WebSearchResult>, String> {
    let body = format!("q={}&kl=us-en", urlencoding::encode(query));

    let resp = client
        .post("https://lite.duckduckgo.com/lite/")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
        .header("Accept", "text/html")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://lite.duckduckgo.com/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("DDG request failed: {}", e))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("DDG read body failed: {}", e))?;

    if html.contains("anomaly-modal") || html.contains("bots use DuckDuckGo") {
        tracing::warn!("DDG anti-bot CAPTCHA detected for query");
        return Err("DuckDuckGo requested anti-bot verification (CAPTCHA). Try again in a few minutes.".to_string());
    }

    parse_ddg_html(&html, max)
}

fn parse_ddg_html(html: &str, max: usize) -> Result<Vec<WebSearchResult>, String> {
    let mut results = Vec::new();

    let rows = html.split("<tr").collect::<Vec<_>>();

    for row in &rows {
        if results.len() >= max {
            break;
        }

        let mut url = String::new();
        let mut title = String::new();

        for re in [&*LINK_RE, &*LINK_RE_ALT, &*LINK_RE_DQ] {
            if let Some(cap) = re.captures(row) {
                let u = html_unescape(&cap[1]);
                if u.starts_with("http") || u.starts_with("//") {
                    url = if u.starts_with("//") { format!("https:{}", u) } else { u };
                    title = strip_html(&cap[2]);
                    break;
                }
            }
        }

        if url.is_empty() {
            continue;
        }

        let snippet = if let Some(cap) = SNIPPET_RE.captures(row) {
            strip_html(&cap[1])
        } else if let Some(cap) = SNIPPET_RE_DQ.captures(row) {
            strip_html(&cap[1])
        } else {
            String::new()
        };

        results.push(WebSearchResult {
            title,
            url,
            snippet: truncate_str(&snippet, MAX_SNIPPET_LEN),
        });
    }

    Ok(results)
}

async fn search_brave(
    client: &reqwest::Client,
    query: &str,
    max: usize,
    api_key: &str,
) -> Result<Vec<WebSearchResult>, String> {
    let url = format!(
        "https://api.search.brave.com/res/v1/web/search?q={}&count={}",
        urlencoding::encode(query),
        max
    );

    let resp = client
        .get(&url)
        .header("X-Subscription-Token", api_key)
        .send()
        .await
        .map_err(|e| format!("Brave request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Brave API returned status: {}", resp.status()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Brave JSON parse failed: {}", e))?;

    let mut results = Vec::new();
    if let Some(web_results) = json.get("web").and_then(|w| w.get("results")) {
        if let Some(arr) = web_results.as_array() {
            for item in arr.iter().take(max) {
                let snippet = item.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                results.push(WebSearchResult {
                    title: item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    url: item.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    snippet: truncate_str(&snippet, MAX_SNIPPET_LEN),
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn web_fetch(url: String, format: Option<String>) -> Result<String, String> {
    tracing::info!(url = %url, "web_fetch called");
    let client = client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("Read body failed: {}", e))?;

    let was_truncated = body.len() > MAX_FETCH_BYTES;
    let body_slice = if was_truncated {
        &body[..MAX_FETCH_BYTES]
    } else {
        &body[..]
    };

    let content = String::from_utf8_lossy(body_slice).to_string();
    let fmt = format.as_deref().unwrap_or("markdown");

    let processed = match fmt {
        "text" => strip_html(&content),
        _ => html_to_markdown(&content),
    };

    let display_content = if processed.len() > MAX_FETCH_DISPLAY {
        format!(
            "{}\n\n[... Content truncated. Total: {} characters. Use specific queries to get relevant sections.]",
            &processed[..MAX_FETCH_DISPLAY],
            processed.len()
        )
    } else {
        processed
    };

    let instruction = "[INSTRUCTION: Summarize the key information from this page for the user. Do NOT repeat the full content verbatim. Pick the most relevant points and present them concisely.]";

    Ok(format!("{}\n\nFetched from: {}\n\n{}", instruction, url, display_content))
}

#[tauri::command]
pub async fn web_search_images(query: String, limit: Option<i32>) -> Result<String, String> {
    tracing::info!(query = %query, "web_search_images called");
    let max = limit.unwrap_or(10).min(20) as usize;
    let client = client();

    // First request: load DDG image search page to get VQD token
    let url = format!(
        "https://duckduckgo.com/?q={}&iax=images&ia=images",
        urlencoding::encode(&query)
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("DDG image init failed: {}", e))?;

    let html = resp
        .text()
        .await
        .map_err(|e| format!("DDG image read failed: {}", e))?;

    // Check for CAPTCHA/anti-bot page
    if html.contains("anomaly-modal") || html.contains("bots use DuckDuckGo") {
        tracing::warn!("DDG anti-bot CAPTCHA detected for image search");
        return Err("DuckDuckGo requested anti-bot verification (CAPTCHA) for image search. Try again in a few minutes.".to_string());
    }

    let vqd = extract_vqd(&html).ok_or_else(|| {
        tracing::warn!("VQD token not found in DDG image search page");
        "Could not extract DDG search token. DuckDuckGo may have changed its page format or is blocking automated requests. Try a different search or use web_search instead.".to_string()
    })?;

    // Second request: get image results using VQD token
    let api_url = format!(
        "https://duckduckgo.com/i.js?l=wt-wt&o=json&q={}&vqd={}&f=,,,",
        urlencoding::encode(&query),
        urlencoding::encode(&vqd),
    );

    let resp2 = client
        .get(&api_url)
        .header("Referer", "https://duckduckgo.com/")
        .send()
        .await
        .map_err(|e| format!("DDG image API failed: {}", e))?;

    if !resp2.status().is_success() {
        return Err(format!("DDG image API returned status: {}", resp2.status()));
    }

    let json: serde_json::Value = resp2
        .json()
        .await
        .map_err(|e| format!("DDG image JSON parse failed: {}", e))?;

    let mut results = Vec::new();
    if let Some(results_arr) = json.get("results").and_then(|r| r.as_array()) {
        for item in results_arr.iter().take(max) {
            results.push(ImageSearchResult {
                url: item.get("image").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                title: item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                thumbnail_url: item.get("thumbnail").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                width: item.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                height: item.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                source: item.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            });
        }
    }

    if results.is_empty() {
        return Ok("[INSTRUCTION: Tell the user that no images were found and suggest alternative search terms.] No image results found.".to_string());
    }

    let mut lines = vec![
        "[INSTRUCTION: Describe the most relevant images briefly. Do NOT list all URLs verbatim. Pick 2-3 most relevant and describe them.]".to_string(),
        format!("Found {} image results for \"{}\":", results.len(), query),
    ];

    for (i, r) in results.iter().enumerate() {
        let dims = if r.width > 0 && r.height > 0 {
            format!(" ({}x{})", r.width, r.height)
        } else {
            String::new()
        };
        lines.push(format!("{}. {}{} — {} {}", i + 1, r.title, dims, r.url, if r.source.is_empty() { String::new() } else { format!("[from {}]", r.source) }));
    }

    Ok(lines.join("\n"))
}

fn extract_vqd(html: &str) -> Option<String> {
    if let Some(cap) = VQD_JSON_RE.captures(html) {
        return Some(cap[1].to_string());
    }
    VQD_INPUT_RE.captures(html).map(|cap| cap[1].to_string())
}

fn strip_html(html: &str) -> String {
    let text = HTML_TAG_RE.replace_all(html, " ");
    decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn html_to_markdown(html: &str) -> String {
    let s1 = SCRIPT_RE.replace_all(html, "");
    let s2 = STYLE_RE.replace_all(&s1, "");

    let mut s = s2.to_string();
    for (level, re) in HEADING_RE.iter().enumerate() {
        let prefix = "#".repeat(level + 1);
        s = re.replace_all(&s, format!("{} $1\n\n", prefix)).to_string();
    }

    s = LINK_MD_RE.replace_all(&s, "[$2]($1)").to_string();
    s = BLOCK_TAG_RE.replace_all(&s, "\n").to_string();
    s = BR_RE.replace_all(&s, "\n").to_string();
    s = LI_RE.replace_all(&s, "- ").to_string();
    s = BOLD_RE.replace_all(&s, "**$2**").to_string();
    s = ITALIC_RE.replace_all(&s, "*$2*").to_string();

    let text = strip_html(&s);
    let text = MULTI_NEWLINE_RE.replace_all(&text, "\n\n");

    text.trim().to_string()
}

fn html_unescape(s: &str) -> String {
    decode_html_entities(s)
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}