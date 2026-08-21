/**
 * Global editor loading state.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.6).
 *
 * Semantics: while true, document-change transactions triggered by program
 * loads (document open, new document) must NOT mark the document dirty nor
 * trigger autosave. Consumers: main.ts (document load), toolbar.ts (new
 * document + dirty check), project-panel.ts (document selection).
 *
 * The value still lives on window.__aurawrite_loading for DevTools
 * inspection, but all code access goes through these typed functions.
 */

export function setLoading(val: boolean): void {
  (window as Window & { __aurawrite_loading?: boolean }).__aurawrite_loading = val;
}

export function isLoading(): boolean {
  return (window as Window & { __aurawrite_loading?: boolean }).__aurawrite_loading === true;
}
