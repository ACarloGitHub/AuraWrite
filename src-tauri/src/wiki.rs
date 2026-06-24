// wiki.rs - Memory wiki tools (native MCP)
//
// Provides wiki_search, wiki_read, wiki_write, wiki_list, wiki_ingest.
// Wiki pages live in <workspace>/memory/ as markdown files with optional YAML frontmatter.
//
// All results follow the Tool Result Injection pattern:
// [INSTRUCTION: ...] prefix tells the AI how to handle the result.
// Content is truncated/summarized to avoid context bloat.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

use crate::workspace::workspace_path;

const MEMORY_DIR: &str = "memory";

const MAX_WIKI_SNIPPET: usize = 300;

fn memory_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let ws = workspace_path(app)?;
    let dir = ws.join(MEMORY_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create memory dir: {}", e))?;
    }
    Ok(dir)
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
}

fn page_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = memory_dir(app)?;
    let safe = sanitize_name(name);
    let path = dir.join(format!("{}.md", safe));
    if !path.starts_with(&dir) {
        return Err("Invalid page name: path traversal attempt".into());
    }
    Ok(path)
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WikiPage {
    pub name: String,
    pub path: String,
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WikiSearchResult {
    pub name: String,
    pub path: String,
    pub snippet: String,
    pub line: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WikiIngestPage {
    pub name: String,
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
}

#[tauri::command]
pub fn wiki_search(app: AppHandle, query: String, limit: Option<i32>) -> Result<String, String> {
    let max = limit.unwrap_or(20).min(50) as usize;
    let dir = memory_dir(&app)?;
    let query_lower = query.to_lowercase();

    let mut results = Vec::new();
    if !dir.exists() {
        return Ok("[INSTRUCTION: Tell the user that the memory wiki is empty. Suggest creating pages with wiki_write.] No wiki pages found. The memory wiki is empty.".to_string());
    }

    search_dir_recursive(&dir, &query_lower, &mut results, max, &dir)?;

    if results.is_empty() {
        return Ok(format!("[INSTRUCTION: Tell the user that no wiki pages match the query. Suggest alternative terms or creating a new page.] No wiki pages found matching \"{}\".", query));
    }

    let mut lines = vec![
        format!("[INSTRUCTION: Present the most relevant matches briefly. Do NOT repeat the full snippet for every result — summarize the key findings in your own words.]"),
        format!("Found {} wiki page(s) matching \"{}\":", results.len(), query),
    ];

    for r in &results {
        let snippet = truncate_str(&r.snippet, MAX_WIKI_SNIPPET);
        lines.push(format!("- {} (line {}): {}", r.name, r.line, snippet));
    }

    Ok(lines.join("\n"))
}

fn search_dir_recursive(
    dir: &std::path::Path,
    query: &str,
    results: &mut Vec<WikiSearchResult>,
    max: usize,
    base: &std::path::Path,
) -> Result<(), String> {
    if results.len() >= max {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| format!("read dir: {}", e))? {
        if results.len() >= max {
            break;
        }
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            search_dir_recursive(&path, query, results, max, base)?;
        } else if path.extension().map_or(false, |ext| ext == "md") {
            let content = fs::read_to_string(&path).map_err(|e| format!("read file: {}", e))?;
            let content_lower = content.to_lowercase();
            let name = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            for (i, line) in content_lower.lines().enumerate() {
                if results.len() >= max {
                    break;
                }
                if line.contains(query) {
                    let original_line = content.lines().nth(i).unwrap_or("");
                    let snippet = truncate_str(original_line, 200);
                    let rel_path = path.strip_prefix(base)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| path.to_string_lossy().to_string());
                    results.push(WikiSearchResult {
                        name: name.clone(),
                        path: rel_path,
                        snippet,
                        line: i + 1,
                    });
                }
            }

            if name.to_lowercase().contains(query) {
                let rel_path = path.strip_prefix(base)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| path.to_string_lossy().to_string());
                let first_line = content.lines().next().unwrap_or("");
                let snippet = truncate_str(first_line, 200);
                if !results.iter().any(|r| r.name == name && r.line == 1) {
                    results.push(WikiSearchResult {
                        name: name.clone(),
                        path: rel_path,
                        snippet,
                        line: 1,
                    });
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn wiki_read(app: AppHandle, name: String) -> Result<String, String> {
    let path = page_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Wiki page not found: {}", name));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read wiki page: {}", e))?;

    let (frontmatter, body) = parse_frontmatter(&content);
    let total_chars = body.len();
    let total_lines = body.lines().count();
    let fm_note = if frontmatter.is_some() { " (has frontmatter)" } else { "" };

    Ok(format!(
        "[INSTRUCTION: You have the full content of this wiki page. Use it as needed.] Wiki page '{}' ({} chars, {} lines{}):\n\n{}",
        sanitize_name(&name), total_chars, total_lines, fm_note, body
    ))
}

#[tauri::command]
pub fn wiki_write(
    app: AppHandle,
    name: String,
    content: String,
    frontmatter: Option<serde_json::Value>,
) -> Result<String, String> {
    let path = page_path(&app, &name)?;

    let line_count = content.lines().count();
    let full_content = match frontmatter {
        Some(ref fm) => {
            let yaml = serde_yaml::to_string(fm)
                .map_err(|e| format!("serialize frontmatter: {}", e))?;
            format!("---\n{}---\n{}", yaml.trim_end(), content)
        }
        None => content,
    };

    fs::write(&path, &full_content).map_err(|e| format!("write wiki page: {}", e))?;

    Ok(format!(
        "[INSTRUCTION: Confirm briefly that the wiki page was saved. Do NOT repeat the page content.] Wiki page '{}' saved ({} lines). You can read it with wiki_read.",
        sanitize_name(&name), line_count
    ))
}

#[tauri::command]
pub fn wiki_list(app: AppHandle) -> Result<String, String> {
    let dir = memory_dir(&app)?;
    let mut pages = Vec::new();

    if !dir.exists() {
        return Ok("[INSTRUCTION: Tell the user that the memory wiki is empty. Suggest creating pages with wiki_write.] No wiki pages found. The memory wiki is empty.".to_string());
    }

    list_pages_recursive(&dir, &mut pages, &dir)?;

    if pages.is_empty() {
        return Ok("[INSTRUCTION: Tell the user that the memory wiki is empty. Suggest creating pages with wiki_write.] No wiki pages found. The memory wiki is empty.".to_string());
    }

    pages.sort_by(|a, b| a.name.cmp(&b.name));

    let mut lines = vec![
        "[INSTRUCTION: List the page names briefly. Do NOT repeat the content of each page.]".to_string(),
        format!("Found {} wiki page(s):", pages.len()),
    ];

    for p in &pages {
        let line_count = p.content.lines().count();
        lines.push(format!("- {} ({} lines)", p.name, line_count));
    }

    Ok(lines.join("\n"))
}

fn list_pages_recursive(
    dir: &std::path::Path,
    pages: &mut Vec<WikiPage>,
    base: &std::path::Path,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            list_pages_recursive(&path, pages, base)?;
        } else if path.extension().map_or(false, |ext| ext == "md") {
            let content = fs::read_to_string(&path).map_err(|e| format!("read file: {}", e))?;
            let name = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (frontmatter, _body) = parse_frontmatter(&content);
            let rel_path = path.strip_prefix(base)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());

            pages.push(WikiPage {
                name,
                path: rel_path,
                content: content.clone(),
                frontmatter,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn wiki_ingest(app: AppHandle, pages: Vec<WikiIngestPage>) -> Result<String, String> {
    let mut created = Vec::new();

    for page in pages {
        let result = wiki_write(
            app.clone(),
            page.name,
            page.content,
            page.frontmatter,
        )?;
        created.push(result);
    }

    Ok(format!(
        "[INSTRUCTION: Confirm briefly which pages were created. Do NOT repeat the content of each page.] Created {} wiki page(s): {}",
        created.len(),
        created.iter().map(|s| {
            // Extract just the page name from the [INSTRUCTION: ...] message
            let after = s.split_once("'").map(|(_, rest)| rest.split_once("'").map(|(name, _)| name).unwrap_or("?")).unwrap_or("?");
            after.to_string()
        }).collect::<Vec<_>>().join(", ")
    ))
}

fn parse_frontmatter(content: &str) -> (Option<serde_json::Value>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }

    let rest = &content[3..];
    if let Some(end_idx) = rest.find("---") {
        let yaml_str = &rest[..end_idx];
        let body = &rest[end_idx + 3..].trim_start_matches('\n');

        match serde_yaml::from_str::<serde_json::Value>(yaml_str) {
            Ok(val) => (Some(val), body),
            Err(_) => (None, content),
        }
    } else {
        (None, content)
    }
}