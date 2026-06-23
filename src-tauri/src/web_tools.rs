// web_tools.rs - Native MCP web tools
//
// Provides web_search (DuckDuckGo HTML scraping with Brave fallback),
// web_fetch (GET URL → stripped content), and web_search_images.
//
// All results include [INSTRUCTION: ...] prefixes following the
// Tool Result Injection pattern (see planner.rs for reference).

use serde::{Deserialize, Serialize};

use crate::secrets;

const MAX_FETCH_BYTES: usize = 200 * 1024;
const MAX_FETCH_DISPLAY: usize = 5 * 1024;
const FETCH_TIMEOUT_SECS: u64 = 30;
const MAX_SNIPPET_LEN: usize = 300;

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
    match secrets::secrets_get("brave_api_key".to_string()) {
        Ok(Some(key)) => Some(key),
        _ => None,
    }
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
        return Err("DuckDuckGo requested anti-bot verification (CAPTCHA). Try again in a few minutes.".to_string());
    }

    parse_ddg_html(&html, max)
}

fn parse_ddg_html(html: &str, max: usize) -> Result<Vec<WebSearchResult>, String> {
    let mut results = Vec::new();

    // DDG Lite uses <tr> rows for each result. Split on <tr> tags first,
    // then extract link + snippet from each row — same approach as the legacy MCP server.
    let rows = html.split("<tr").collect::<Vec<_>>();

    let link_re = regex::Regex::new(r#"<a\s+[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class='result-link'[^>]*>(.*?)</a>"#).unwrap();
    let link_re_alt = regex::Regex::new(r#"<a\s+[^>]*class='result-link'[^>]*href="([^"]+)"[^>]*rel="nofollow"[^>]*>(.*?)</a>"#).unwrap();
    let link_re_dq = regex::Regex::new(r#"<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap();
    let snippet_re = regex::Regex::new(r#"<td\s+class='result-snippet'[^>]*>(.*?)</td>"#).unwrap();
    let snippet_re_dq = regex::Regex::new(r#"<td[^>]*class="result-snippet"[^>]*>(.*?)</td>"#).unwrap();

    for row in &rows {
        if results.len() >= max {
            break;
        }

        let mut url = String::new();
        let mut title = String::new();

        // Try each regex pattern (single-quote classes first — DDG Lite uses single quotes)
        for re in [&link_re, &link_re_alt, &link_re_dq] {
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

        // Try single-quote snippet first, then double-quote
        let snippet = if let Some(cap) = snippet_re.captures(row) {
            strip_html(&cap[1])
        } else if let Some(cap) = snippet_re_dq.captures(row) {
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
    let max = limit.unwrap_or(10).min(20) as usize;
    let client = client();

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

    let vqd = extract_vqd(&html).ok_or_else(|| "Could not extract DDG search token".to_string())?;

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
    let re = regex::Regex::new(r#"vqd['"]\s*:\s*['"]([^'"]+)"#).ok()?;
    if let Some(cap) = re.captures(html) {
        return Some(cap[1].to_string());
    }
    let re2 = regex::Regex::new(r#"<input[^>]*name="vqd"[^>]*value="([^"]*)""#).ok()?;
    re2.captures(html).map(|cap| cap[1].to_string())
}

fn strip_html(html: &str) -> String {
    let re = regex::Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(html, " ");
    decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn html_to_markdown(html: &str) -> String {
    let re_script = regex::Regex::new(r"(?s)<script[^>]*>.*?</script>").unwrap();
    let s1 = re_script.replace_all(html, "");
    let re_style = regex::Regex::new(r"(?s)<style[^>]*>.*?</style>").unwrap();
    let s2 = re_style.replace_all(&s1, "");

    let mut s = s2.to_string();
    for level in 1..=6 {
        let re = regex::Regex::new(&format!(
            r#"<h{level}[^>]*>(.*?)</h{level}>"#,
            level = level
        ))
        .unwrap();
        let prefix = "#".repeat(level);
        s = re.replace_all(&s, format!("{} $1\n\n", prefix)).to_string();
    }

    let link_re = regex::Regex::new(r#"<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#).unwrap();
    s = link_re.replace_all(&s, "[$2]($1)").to_string();

    let block_re = regex::Regex::new(r"</(p|div|br|h[1-6]|li|tr)>").unwrap();
    s = block_re.replace_all(&s, "\n").to_string();

    let br_re = regex::Regex::new(r"<br\s*/?\s*>").unwrap();
    s = br_re.replace_all(&s, "\n").to_string();

    let li_re = regex::Regex::new(r"<li[^>]*>").unwrap();
    s = li_re.replace_all(&s, "- ").to_string();

    let bold_re = regex::Regex::new(r"<(strong|b)[^>]*>(.*?)</(strong|b)>").unwrap();
    s = bold_re.replace_all(&s, "**$2**").to_string();
    let italic_re = regex::Regex::new(r"<(em|i)[^>]*>(.*?)</(em|i)>").unwrap();
    s = italic_re.replace_all(&s, "*$2*").to_string();

    let text = strip_html(&s);

    let re = regex::Regex::new(r"\n{3,}").unwrap();
    let text = re.replace_all(&text, "\n\n");

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