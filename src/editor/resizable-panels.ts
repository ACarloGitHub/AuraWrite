/**
 * Resizable side panels (AI chat, projects, suggestions, MCP, ebooks).
 * Extracted verbatim from main.ts (2026-08-21, refactoring plan step 1.6).
 *
 * CRITICAL: widths are persisted as sub-fields of the "aurawrite-preferences"
 * localStorage key (same key as the preferences store) — never change the
 * key or the sub-field names, or saved panel widths are orphaned.
 */
export function setupResizablePanels(): void {
  const STORAGE_KEY = "aurawrite-preferences";
  const DEFAULTS = { ai: 360, projects: 320, suggestions: 320, mcp: 320, ebooks: 320 } as const;
  const MIN = { ai: 200, projects: 180, suggestions: 200, mcp: 200, ebooks: 200 } as const;
  const MAX_RATIO = { ai: 0.8, projects: 0.6, suggestions: 0.6, mcp: 0.6, ebooks: 0.6 } as const;
  const STORAGE_KEYS = {
    ai: "aiChatPanelWidth",
    projects: "projectPanelWidth",
    suggestions: "suggestionsPanelWidth",
    mcp: "mcpPanelWidth",
    ebooks: "ebooksPanelWidth",
  } as const;
  const CSS_VARS = {
    ai: "--ai-panel-width",
    projects: "--project-panel-width",
    suggestions: "--suggestions-panel-width",
    mcp: "--mcp-panel-width",
    ebooks: "--ebooks-panel-width",
  } as const;

  type PanelKey = "ai" | "projects" | "suggestions" | "mcp" | "ebooks";
  type Widths = Record<PanelKey, number>;
  const LEFT_EDGED: ReadonlyArray<PanelKey> = ["ai", "mcp"];

  function loadWidths(): Widths {
    const out: Widths = { ...DEFAULTS };
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
          const v = parsed[STORAGE_KEYS[k]];
          if (typeof v === "number") out[k] = v;
        }
      }
    } catch { /* fall through */ }
    return out;
  }

  function saveWidths(w: Widths): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
        parsed[STORAGE_KEYS[k]] = w[k];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch (e) {
      console.warn("[resize] failed to save panel widths:", e);
    }
  }

  function applyWidths(): void {
    const w = loadWidths();
    const root = document.documentElement;
    for (const k of Object.keys(STORAGE_KEYS) as PanelKey[]) {
      const maxW = window.innerWidth * MAX_RATIO[k];
      root.style.setProperty(CSS_VARS[k], Math.max(MIN[k], Math.min(w[k], maxW)) + "px");
    }
  }

  applyWidths();
  window.addEventListener("resize", applyWidths);

  let widths = loadWidths();

  document.querySelectorAll<HTMLElement>(".panel-resize-handle").forEach((handle) => {
    const target = handle.dataset.resize as PanelKey | undefined;
    if (!target || !(target in STORAGE_KEYS)) return;

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      widths = { ...widths, [target]: DEFAULTS[target] };
      applyWidths();
      saveWidths(widths);
    });

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widths[target];
      const maxWidth = window.innerWidth * MAX_RATIO[target];
      const minWidth = MIN[target];
      handle.classList.add("panel-resize-handle--active");

      const onMove = (ev: MouseEvent) => {
        const growRight = !LEFT_EDGED.includes(target);
        const dx = growRight ? ev.clientX - startX : startX - ev.clientX;
        const next = Math.max(minWidth, Math.min(startWidth + dx, maxWidth));
        widths = { ...widths, [target]: next };
        document.documentElement.style.setProperty(CSS_VARS[target], next + "px");
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        handle.classList.remove("panel-resize-handle--active");
        saveWidths(widths);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}
