// exec_tools.rs - Shell execution tools for AuraWrite AI agent
//
// Executes commands with timeout, workspace confinement, output truncation,
// and background job tracking. Always requires user permission.
//
// Reference: aura-mcp-server/src/tools/exec.ts (TypeScript implementation)

use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

use crate::workspace::workspace_path;

const MAX_OUTPUT_CHARS: usize = 200_000;
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MAX_TIMEOUT_SECS: u64 = 7200;

const DANGEROUS_PATTERNS: &[&str] = &[
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/*",
    "del /f /s /q C:\\",
    "del /f /s /q c:\\",
    "format ",
    "mkfs.",
    "dd if=",
    ":(){ :|:& };:",
    "> /dev/sda",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackgroundJob {
    pub id: String,
    pub pid: Option<u32>,
    pub command: String,
    pub started_at: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub running: bool,
    pub workdir: String,
}

fn get_bg_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let ws = workspace_path(app)?;
    let bg_dir = ws.join("bg-jobs");
    if !bg_dir.exists() {
        fs::create_dir_all(&bg_dir)
            .map_err(|e| format!("Failed to create bg-jobs dir: {}", e))?;
    }
    Ok(bg_dir)
}

fn truncate_output(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...[truncated: {} chars total]", &s[..max], s.len())
    }
}

fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= n {
        text.to_string()
    } else {
        lines[lines.len() - n..].join("\n")
    }
}

fn check_dangerous(command: &str) -> Result<(), String> {
    let cmd_lower = command.to_lowercase();
    for pattern in DANGEROUS_PATTERNS {
        if cmd_lower.contains(&pattern.to_lowercase()) {
            return Err(format!(
                "Command blocked for safety: contains dangerous pattern '{}'. If you need to run this, please do it directly in your terminal.",
                pattern
            ));
        }
    }
    Ok(())
}

fn resolve_workdir(workdir: Option<&str>, app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let ws = workspace_path(app)?;
    match workdir {
        Some(dir) if !dir.is_empty() => {
            let path = Path::new(dir);
            if path.is_absolute() {
                Ok(path.to_path_buf())
            } else {
                Ok(ws.join(dir))
            }
        }
        _ => Ok(ws),
    }
}

fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as WinCommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string(), "/T"])
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
}

fn save_job(app: &AppHandle, job: &BackgroundJob) -> Result<(), String> {
    let bg_dir = get_bg_dir(app)?;
    let path = bg_dir.join(format!("{}.json", job.id));
    let json = serde_json::to_string_pretty(job)
        .map_err(|e| format!("Failed to serialize job: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write job file: {}", e))
}

fn read_job(app: &AppHandle, job_id: &str) -> Result<BackgroundJob, String> {
    let bg_dir = get_bg_dir(app)?;
    let path = bg_dir.join(format!("{}.json", job_id));
    if !path.exists() {
        return Err(format!("Job not found: {}", job_id));
    }
    let json = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read job file: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse job file: {}", e))
}

fn build_command(command: &str, work_dir: &Path, env: Option<&std::collections::HashMap<String, String>>) -> std::process::Command {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };

    cmd.current_dir(work_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Some(env_vars) = env {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }

    cmd
}

fn iso_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}

fn millis_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_millis())
}

#[tauri::command]
pub async fn exec(
    app: AppHandle,
    command: String,
    workdir: Option<String>,
    timeout: Option<u64>,
    background: Option<bool>,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    check_dangerous(&command)?;

    let is_background = background.unwrap_or(false);
    let timeout_secs = timeout
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .min(MAX_TIMEOUT_SECS)
        .max(1);

    let work_dir = resolve_workdir(workdir.as_deref(), &app)?;

    if !work_dir.exists() {
        return Err(format!("Working directory does not exist: {}", work_dir.display()));
    }

    if is_background {
        exec_background(app, command, work_dir, env).await
    } else {
        exec_foreground(app, command, work_dir, timeout_secs, env).await
    }
}

async fn exec_foreground(
    _app: AppHandle,
    command: String,
    work_dir: std::path::PathBuf,
    timeout_secs: u64,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let result = {
        let command_for_thread = command.clone();
        let work_dir_for_thread = work_dir.clone();
        let env_for_thread = env.clone();

        tokio::task::spawn_blocking(move || {
            let mut child = build_command(&command_for_thread, &work_dir_for_thread, env_for_thread.as_ref())
                .spawn()
                .map_err(|e| format!("Failed to spawn command: {}", e))?;

            let pid = child.id();

            // Set up timeout
            let timeout_dur = Duration::from_secs(timeout_secs);
            let start = std::time::Instant::now();

            // Spawn threads to read stdout and stderr
            let mut stdout_pipe = child.stdout.take().ok_or("Failed to capture stdout")?;
            let mut stderr_pipe = child.stderr.take().ok_or("Failed to capture stderr")?;

            let (tx_out, rx_out) = std::sync::mpsc::channel::<Vec<u8>>();
            let (tx_err, rx_err) = std::sync::mpsc::channel::<Vec<u8>>();

            let tx_out_clone = tx_out.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match stdout_pipe.read(&mut buf) {
                        Ok(0) => { let _ = tx_out_clone.send(Vec::new()); break; }
                        Ok(n) => { if tx_out_clone.send(buf[..n].to_vec()).is_err() { break; } }
                        Err(_) => { break; }
                    }
                }
            });

            let tx_err_clone = tx_err.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match stderr_pipe.read(&mut buf) {
                        Ok(0) => { let _ = tx_err_clone.send(Vec::new()); break; }
                        Ok(n) => { if tx_err_clone.send(buf[..n].to_vec()).is_err() { break; } }
                        Err(_) => { break; }
                    }
                }
            });

            // Monitor thread: check timeout and collect output
            let mut stdout_bytes = Vec::new();
            let mut stderr_bytes = Vec::new();
            let mut timed_out = false;
            let mut output_too_large = false;
            let check_interval = Duration::from_millis(50);

            loop {
                if std::time::Instant::now() - start > timeout_dur {
                    timed_out = true;
                    kill_process_by_pid(pid);
                    // Give process time to exit
                    std::thread::sleep(Duration::from_millis(500));
                    break;
                }

                // Drain stdout channel
                loop {
                    match rx_out.try_recv() {
                        Ok(data) if data.is_empty() => { /* EOF */ break; }
                        Ok(data) => {
                            stdout_bytes.extend_from_slice(&data);
                            if stdout_bytes.len() + stderr_bytes.len() > MAX_OUTPUT_CHARS * 2 {
                                output_too_large = true;
                                break;
                            }
                        }
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(_) => break,
                    }
                }

                loop {
                    match rx_err.try_recv() {
                        Ok(data) if data.is_empty() => { /* EOF */ break; }
                        Ok(data) => {
                            stderr_bytes.extend_from_slice(&data);
                            if stdout_bytes.len() + stderr_bytes.len() > MAX_OUTPUT_CHARS * 2 {
                                output_too_large = true;
                                break;
                            }
                        }
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(_) => break,
                    }
                }

                if output_too_large {
                    kill_process_by_pid(pid);
                    std::thread::sleep(Duration::from_millis(500));
                    break;
                }

                // Check if process has exited
                match child.try_wait() {
                    Ok(Some(status)) => {
                        // Drain remaining output
                        std::thread::sleep(Duration::from_millis(100));
                        loop {
                            match rx_out.try_recv() {
                                Ok(data) if data.is_empty() => break,
                                Ok(data) => { stdout_bytes.extend_from_slice(&data); }
                                Err(_) => break,
                            }
                        }
                        loop {
                            match rx_err.try_recv() {
                                Ok(data) if data.is_empty() => break,
                                Ok(data) => { stderr_bytes.extend_from_slice(&data); }
                                Err(_) => break,
                            }
                        }

                        let stdout_str = String::from_utf8_lossy(&stdout_bytes).to_string();
                        let stderr_str = String::from_utf8_lossy(&stderr_bytes).to_string();
                        let exit_code = status.code();

                        return Ok(CommandResult {
                            stdout: stdout_str,
                            stderr: stderr_str,
                            exit_code,
                            timed_out: false,
                            killed: false,
                        });
                    }
                    Ok(None) => {
                        std::thread::sleep(check_interval);
                    }
                    Err(e) => {
                        return Err(format!("Failed to check process status: {}", e));
                    }
                }
            }

            // Timed out or output too large - drain remaining
            let _ = child.kill();
            std::thread::sleep(Duration::from_millis(200));
            loop {
                match rx_out.try_recv() {
                    Ok(data) if data.is_empty() => break,
                    Ok(data) => { stdout_bytes.extend_from_slice(&data); }
                    Err(_) => break,
                }
            }
            loop {
                match rx_err.try_recv() {
                    Ok(data) if data.is_empty() => break,
                    Ok(data) => { stderr_bytes.extend_from_slice(&data); }
                    Err(_) => break,
                }
            }

            let stdout_str = String::from_utf8_lossy(&stdout_bytes).to_string();
            let stderr_str = String::from_utf8_lossy(&stderr_bytes).to_string();

            Ok(CommandResult {
                stdout: stdout_str,
                stderr: stderr_str,
                exit_code: None,
                timed_out,
                killed: output_too_large,
            })
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))??
    };

    // Format result
    if result.timed_out {
        Ok(format!(
            "[INSTRUCTION: Report the timeout briefly.]\nTimeout after {}s\n\nStdout:\n{}\n\nStderr:\n{}",
            timeout_secs,
            truncate_output(&result.stdout, MAX_OUTPUT_CHARS),
            truncate_output(&result.stderr, MAX_OUTPUT_CHARS)
        ))
    } else if result.killed {
        Ok(format!(
            "[INSTRUCTION: Report that output was truncated.]\nExcessive output (max {} chars). Process killed.\n\nStdout:\n{}\n\nStderr:\n{}",
            MAX_OUTPUT_CHARS,
            truncate_output(&result.stdout, MAX_OUTPUT_CHARS),
            truncate_output(&result.stderr, MAX_OUTPUT_CHARS)
        ))
    } else {
        let instruction = if result.exit_code.unwrap_or(-1) != 0 {
            "[INSTRUCTION: Report the error briefly, do not repeat the full command or output verbatim.]"
        } else {
            "[INSTRUCTION: Report the result briefly, do not repeat the full output verbatim.]"
        };

        let content = if !result.stdout.is_empty() || !result.stderr.is_empty() {
            let mut parts = Vec::new();
            if !result.stdout.is_empty() {
                parts.push(format!("Stdout:\n{}", truncate_output(&result.stdout, MAX_OUTPUT_CHARS)));
            }
            if !result.stderr.is_empty() {
                parts.push(format!("Stderr:\n{}", truncate_output(&result.stderr, MAX_OUTPUT_CHARS)));
            }
            parts.join("\n\n")
        } else {
            format!("Completed (exit code: {})", result.exit_code.unwrap_or(-1))
        };

        Ok(format!("{}\n{}", instruction, content))
    }
}

struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    killed: bool,
}

async fn exec_background(
    app: AppHandle,
    command: String,
    work_dir: std::path::PathBuf,
    env: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let mut child = build_command(&command, &work_dir, env.as_ref())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let pid = child.id();
    let session_id = format!("bg-{}-{}", millis_timestamp(), pid);
    let work_dir_str = work_dir.to_string_lossy().to_string();

    let job = BackgroundJob {
        id: session_id.clone(),
        pid: Some(pid),
        command: command.clone(),
        started_at: iso_timestamp(),
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
        running: true,
        workdir: work_dir_str,
    };

    save_job(&app, &job)?;

    // Spawn a thread to monitor the background process
    let app_handle = app.clone();
    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();

        if let Some(mut stdout) = child.stdout.take() {
            let mut buf = [0u8; 8192];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let s = String::from_utf8_lossy(&buf[..n]);
                        stdout_buf.push_str(&s);
                        if stdout_buf.len() > MAX_OUTPUT_CHARS {
                            stdout_buf.truncate(MAX_OUTPUT_CHARS);
                        }
                    }
                    Err(_) => break,
                }
                if let Ok(mut j) = read_job(&app_handle, &session_id_clone) {
                    j.stdout = stdout_buf.clone();
                    let _ = save_job(&app_handle, &j);
                }
            }
        }

        if let Some(mut stderr) = child.stderr.take() {
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let s = String::from_utf8_lossy(&buf[..n]);
                        stderr_buf.push_str(&s);
                        if stderr_buf.len() > MAX_OUTPUT_CHARS {
                            stderr_buf.truncate(MAX_OUTPUT_CHARS);
                        }
                    }
                    Err(_) => break,
                }
                if let Ok(mut j) = read_job(&app_handle, &session_id_clone) {
                    j.stderr = stderr_buf.clone();
                    let _ = save_job(&app_handle, &j);
                }
            }
        }

        match child.wait() {
            Ok(status) => {
                if let Ok(mut j) = read_job(&app_handle, &session_id_clone) {
                    j.exit_code = status.code();
                    j.running = false;
                    j.stdout = stdout_buf;
                    j.stderr = stderr_buf;
                    let _ = save_job(&app_handle, &j);
                }
            }
            Err(e) => {
                if let Ok(mut j) = read_job(&app_handle, &session_id_clone) {
                    j.running = false;
                    j.exit_code = Some(-1);
                    j.stderr.push_str(&format!("\n[Error: {}]", e));
                    let _ = save_job(&app_handle, &j);
                }
            }
        }
    });

    Ok(format!(
        "[INSTRUCTION: Tell the user the command has started in background. Provide the job ID.]Command started in background (job: {}, pid: {}). Use exec_poll to check status.",
        session_id, pid
    ))
}

#[tauri::command]
pub async fn exec_poll(
    app: AppHandle,
    job_id: String,
    tail: Option<usize>,
) -> Result<String, String> {
    let job = read_job(&app, &job_id)?;
    let tail_count = tail.unwrap_or(100);

    let stdout_tail = tail_lines(&job.stdout, tail_count);
    let stderr_tail = tail_lines(&job.stderr, tail_count);

    let status = if job.running {
        "[STILL RUNNING]".to_string()
    } else {
        format!("[COMPLETED] exit code: {}", job.exit_code.unwrap_or(-1))
    };

    Ok(format!(
        "[INSTRUCTION: Summarize the job status briefly.]\n{}\npid: {}\ncommand: {}\nstarted: {}\n\n--- Stdout (last {} lines) ---\n{}\n\n--- Stderr (last {} lines) ---\n{}",
        status,
        job.pid.unwrap_or(0),
        job.command,
        job.started_at,
        tail_count,
        stdout_tail,
        tail_count,
        stderr_tail
    ))
}

#[tauri::command]
pub async fn exec_kill(app: AppHandle, job_id: String) -> Result<String, String> {
    let mut job = read_job(&app, &job_id)?;

    if !job.running {
        return Ok(format!(
            "[INSTRUCTION: Tell the user the job is already stopped.]Job {} already terminated (exit code: {})",
            job_id,
            job.exit_code.unwrap_or(-1)
        ));
    }

    if let Some(pid) = job.pid {
        kill_process_by_pid(pid);
        job.running = false;
        job.exit_code = Some(-9);
        save_job(&app, &job)?;

        Ok(format!(
            "[INSTRUCTION: Tell the user the process was killed.]Process killed (pid: {}, job: {})",
            pid, job_id
        ))
    } else {
        Err(format!("Job {} has no PID", job_id))
    }
}

#[tauri::command]
pub async fn exec_list(app: AppHandle) -> Result<String, String> {
    let bg_dir = get_bg_dir(&app)?;
    let entries = fs::read_dir(&bg_dir)
        .map_err(|e| format!("Failed to read bg-jobs directory: {}", e))?;

    let mut rows = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let json = match fs::read_to_string(&path) {
                Ok(j) => j,
                Err(_) => continue,
            };
            let job: BackgroundJob = match serde_json::from_str(&json) {
                Ok(j) => j,
                Err(_) => continue,
            };
            let status = if job.running { "[running]" } else { "[done]" };
            rows.push(format!(
                "{} {} pid:{} cmd:{}",
                job.id,
                status,
                job.pid.unwrap_or(0),
                &job.command.chars().take(60).collect::<String>()
            ));
        }
    }

    if rows.is_empty() {
        Ok("[INSTRUCTION: Tell the user there are no background jobs.]No background jobs found.".to_string())
    } else {
        Ok(format!(
            "[INSTRUCTION: List the jobs briefly.]\nBackground jobs:\n\n{}",
            rows.join("\n")
        ))
    }
}

#[tauri::command]
pub async fn exec_clean(
    app: AppHandle,
    max_age_hours: Option<u64>,
    all: Option<bool>,
) -> Result<String, String> {
    let bg_dir = get_bg_dir(&app)?;
    let max_age_ms = (max_age_hours.unwrap_or(24)) * 60 * 60 * 1000;
    let delete_all = all.unwrap_or(false);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let entries = match fs::read_dir(&bg_dir) {
        Ok(e) => e,
        Err(_) => return Ok("[INSTRUCTION: Tell the user there are no jobs to clean.]No jobs to clean.".to_string()),
    };

    let mut deleted_count = 0usize;
    let mut skipped_count = 0usize;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let json = match fs::read_to_string(&path) {
                Ok(j) => j,
                Err(_) => {
                    let _ = fs::remove_file(&path);
                    continue;
                }
            };
            let job: BackgroundJob = match serde_json::from_str(&json) {
                Ok(j) => j,
                Err(_) => {
                    let _ = fs::remove_file(&path);
                    continue;
                }
            };

            let started_ms = job.started_at.parse::<u64>().unwrap_or(0);
            let age = now.saturating_sub(started_ms);

            if delete_all || (!job.running && age > max_age_ms) {
                let _ = fs::remove_file(&path);
                deleted_count += 1;
            } else {
                skipped_count += 1;
            }
        }
    }

    Ok(format!(
        "[INSTRUCTION: Tell the user how many jobs were cleaned.]Cleaned {} job(s), skipped {} (running or recent).",
        deleted_count, skipped_count
    ))
}