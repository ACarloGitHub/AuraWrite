// planner.rs - Agent planner tool
//
// Markdown-based task planner with state machine.
// Plans are stored in <workspace>/plans/ as .md files with checkboxes.
//
// Actions:
//   create  — Create a new plan file
//   read    — Read a plan file
//   list    — List all plan files
//   update  — Overwrite a plan file with new content
//   delete  — Delete a plan file
//   next    — Mark the first unchecked task as done, return the next task
//   status  — Count completed/remaining tasks, show progress percentage

use std::fs;
use tauri::AppHandle;

use crate::workspace::workspace_path;

fn plans_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let ws = workspace_path(app)?;
    let dir = ws.join("plans");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("create plans dir: {}", e))?;
    }
    Ok(dir)
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
}

fn plan_path(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = plans_dir(app)?;
    let safe = sanitize_name(name);
    let path = dir.join(format!("{}.md", safe));
    if !path.starts_with(&dir) {
        return Err("Invalid plan name: path traversal attempt".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn plan_create(app: AppHandle, name: String, content: String) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if path.exists() {
        return Err(format!("Plan already exists: {}", name));
    }
    let total = content.lines().filter(|l| l.starts_with("- [") || l.starts_with("- [x]")).count();
    fs::write(&path, &content).map_err(|e| format!("write plan: {}", e))?;
    Ok(format!("[INSTRUCTION: Do NOT repeat the plan content in your response. The plan is visible to the user in the MCP panel. Reply with ONE brief sentence confirming creation.] Plan created: '{}' with {} tasks. You can see and interact with it in the MCP panel (🧩).", sanitize_name(&name), total))
}

#[tauri::command]
pub fn plan_read(app: AppHandle, name: String) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Plan not found: {}", name));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read plan: {}", e))?;
    let total = content.lines().filter(|l| l.starts_with("- [") || l.starts_with("- [x]")).count();
    let completed = content.lines().filter(|l| l.starts_with("- [x]")).count();
    Ok(format!("[INSTRUCTION: Do NOT repeat the plan content in your response. Summarize in 1-2 sentences what the plan contains and its progress. The user can see the full plan in the MCP panel.] Plan '{}' has {}/{} tasks completed. You can see and interact with it in the MCP panel (🧩). Content summary: {}", name, completed, total, content))
}

#[tauri::command]
pub fn plan_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = plans_dir(&app)?;
    let mut names: Vec<String> = Vec::new();
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("read plans dir: {}", e))? {
            let entry = entry.map_err(|e| format!("read entry: {}", e))?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.ends_with(".md") {
                names.push(fname.trim_end_matches(".md").to_string());
            }
        }
        names.sort();
    }
    Ok(names)
}

#[tauri::command]
pub fn plan_update(app: AppHandle, name: String, content: String) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Plan not found: {}", name));
    }
    fs::write(&path, &content).map_err(|e| format!("write plan: {}", e))?;
    Ok(format!("[INSTRUCTION: Do NOT repeat the plan content. Reply with ONE brief sentence.] Plan updated: '{}'. See the MCP panel (🧩) for changes.", sanitize_name(&name)))
}

#[tauri::command]
pub fn plan_delete(app: AppHandle, name: String) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Plan not found: {}", name));
    }
    fs::remove_file(&path).map_err(|e| format!("delete plan: {}", e))?;
    Ok(format!("[INSTRUCTION: Do NOT repeat plan content. Reply briefly.] Plan deleted: '{}'.", sanitize_name(&name)))
}

#[tauri::command]
pub fn plan_next(app: AppHandle, name: String, answer: Option<String>) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Plan not found: {}", name));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read plan: {}", e))?;
    let lines: Vec<&str> = content.lines().collect();

    let first_unchecked = lines.iter().position(|l| regex_unchecked_task(l));

    if let Some(idx) = first_unchecked {
        let line = lines[idx];
        let task_text = line.replace("- [ ] ", "");
        let mut new_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
        new_lines[idx] = format!("- [x] {}", task_text);
        let updated = new_lines.join("\n");
        fs::write(&path, &updated).map_err(|e| format!("write plan: {}", e))?;

        let next = find_next_task(&updated);
        Ok(format!("[INSTRUCTION: Do NOT list all tasks. Reply with ONE sentence: what was completed and what is next.] Completed: '{}'. Next: {}. (Progress updated in MCP panel 🧩)", task_text, next))
    } else {
        let question = lines.iter().find(|l| regex_question(l));
        if let Some(q_line) = question {
            let question_text = q_line
                .replace("- [ ] Question (for user): ", "")
                .replace("- [ ] Question:", "")
                .replace("- [ ] Question: ", "");
            if let Some(ans) = answer {
                let mut new_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
                let idx = lines.iter().position(|l| l == q_line).unwrap();
                new_lines[idx] = format!("- [x] Answered question: {}\n  - Answer: {}", question_text.trim(), ans);
                let updated = new_lines.join("\n");
                fs::write(&path, &updated).map_err(|e| format!("write plan: {}", e))?;
                let next = find_next_task(&updated);
                Ok(format!("[INSTRUCTION: Do NOT list all tasks. Reply with ONE sentence.] Answer recorded for \"{}\". Next: {}. (MCP panel 🧩 updated)", question_text.trim(), next))
            } else {
                Ok(format!("[INSTRUCTION: Do NOT repeat the question. Ask the user to answer it.] Blocking question: \"{}\". Use plan_next with the answer parameter to continue.", question_text.trim()))
            }
        } else {
            let final_content = content.replace("status: active", "status: completed");
            fs::write(&path, &final_content).map_err(|e| format!("write plan: {}", e))?;
            Ok("[INSTRUCTION: Do NOT repeat any task content. Reply with ONE sentence.] Plan completed! All tasks are done. See the MCP panel (🧩) for the final status.".into())
        }
    }
}

#[tauri::command]
pub fn plan_status(app: AppHandle, name: String) -> Result<String, String> {
    let path = plan_path(&app, &name)?;
    if !path.exists() {
        return Err(format!("Plan not found: {}", name));
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read plan: {}", e))?;
    let mut total = 0u32;
    let mut completed = 0u32;
    let mut blocking_question: Option<String> = None;

    for line in content.lines() {
        if regex_task_line(line) {
            total += 1;
            if line.starts_with("- [x]") {
                completed += 1;
            }
        }
        if blocking_question.is_none() && regex_question(line) {
            blocking_question = Some(
                line.replace("- [ ] Question (for user): ", "")
                    .replace("- [ ] Question:", "")
                    .replace("- [ ] Question: ", "")
                    .trim()
                    .to_string(),
            );
        }
    }

    let remaining = total - completed;
    let percentage = if total > 0 { (completed * 100) / total } else { 0 };

    let mut status = format!(
        "[INSTRUCTION: Do NOT repeat the plan content or list all tasks. Reply with ONE sentence about the progress.] Plan '{}': {}/{} tasks completed ({}% remaining: {}). See the MCP panel (🧩) for interactive checkboxes.",
        name, completed, total, percentage, remaining
    );
    if let Some(q) = &blocking_question {
        status.push_str(&format!(" Blocking question: \"{}\"", q));
    }
    Ok(status)
}

fn regex_unchecked_task(line: &str) -> bool {
    line.starts_with("- [ ] ") && !regex_question(line)
}

fn regex_task_line(line: &str) -> bool {
    line.starts_with("- [ ] ") || line.starts_with("- [x] ")
}

fn regex_question(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with("- [ ] question") || lower.starts_with("- [ ] question (for user)")
}

fn find_next_task(content: &str) -> String {
    for line in content.lines() {
        if regex_unchecked_task(line) {
            return line.replace("- [ ] ", "");
        }
    }
    for line in content.lines() {
        if regex_question(line) {
            let text = line
                .replace("- [ ] Question (for user): ", "")
                .replace("- [ ] Question:", "")
                .replace("- [ ] Question: ", "");
            return format!("[QUESTION] {}", text.trim());
        }
    }
    "No more tasks. Plan completed!".into()
}