/**
 * Global application keyboard shortcuts.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.6).
 *
 * Shortcuts: Ctrl+N (new), Ctrl+S (save current file), Ctrl+F / Ctrl+H
 * (find & replace), Ctrl+= / Ctrl+- (zoom).
 */
export interface AppShortcutsDeps {
  openFindBar: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export function setupAppShortcuts(deps: AppShortcutsDeps): void {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      const newBtn = document.querySelector(
        '.dropdown-item[data-action="new"]'
      ) as HTMLButtonElement | null;
      newBtn?.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      // Ctrl+S always triggers File > Save (the current file), never the
      // project save (which has its own "Save Project" button).
      const saveBtn = document.querySelector(
        '.dropdown-item[data-action="save"]'
      ) as HTMLButtonElement | null;
      saveBtn?.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      deps.openFindBar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "h") {
      e.preventDefault();
      deps.openFindBar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "=") {
      e.preventDefault();
      deps.zoomIn();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      deps.zoomOut();
    }
  };
  document.addEventListener("keydown", handleKeyDown);
}
