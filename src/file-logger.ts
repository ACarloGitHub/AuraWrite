// file-logger.ts - DEBUG-ONLY
//
// Intercepts console.log/warn/error and forwards messages that match
// the diagnostic prefixes to a file on disk via the Tauri command
// `write_log_line`. The log file lives at:
//
//   Windows: %APPDATA%\com.aurawrite.desktop\aurawrite.log
//   macOS:   ~/Library/Application Support/com.aurawrite.desktop/aurawrite.log
//   Linux:   ~/.config/com.aurawrite.desktop/aurawrite.log
//
// This is meant for diagnosing build-vs-dev differences when Chrome
// DevTools are not visible in the installed build. It will be REMOVED
// before the next public release.

import { invoke } from "@tauri-apps/api/core";

const PREFIXES = [
  "[IndexDoc]",
  "[IndexProject]",
  "[IndexSection]",
  "[EntityExtraction]",
  "[DEBUG-EXTRACTION]",
  "[DEBUG-HANDLER]",
  "[SemanticSearch]",
  "[fonts]",
  "[updates]",
];

function shouldLog(msg: string): boolean {
  return PREFIXES.some((p) => msg.includes(p));
}

function stringify(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

let installed = false;

export function installFileLogger(): void {
  if (installed) return;
  installed = true;

  type ConsoleMethod = "log" | "warn" | "error" | "info" | "debug";
  const methods: ConsoleMethod[] = ["log", "warn", "error", "info", "debug"];

  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const line = stringify(args);
      if (shouldLog(line)) {
        // Best-effort: never throw from the logger
        invoke("write_log_line", { line }).catch(() => {});
      }
    };
  }
}
