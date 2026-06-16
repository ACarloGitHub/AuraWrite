import { DEFAULT_MARGIN_TOP, DEFAULT_MARGIN_BOTTOM, DEFAULT_MARGIN_LEFT, DEFAULT_MARGIN_RIGHT, MARGIN_MIN, MARGIN_MAX, type PageMargins } from "./pagination-cassie";

const PAGINATION_KEY = "aurawrite-paged-mode";
const CASSIE_PAGINATION_KEY = "aurawrite-cassie-pagination-mode";
const CASSIE_PAGED_KEY = "aurawrite-cassie-paged-mode";
const MARGINS_KEY = "aurawrite-editor-margins";
const OLD_MARGIN_KEY = "aurawrite-editor-margin-pct";

let isPagedMode: boolean = false;
let isCassieMode: boolean = false;
let isCassiePagedMode: boolean = false;
let currentMargins: PageMargins = { top: DEFAULT_MARGIN_TOP, bottom: DEFAULT_MARGIN_BOTTOM, left: DEFAULT_MARGIN_LEFT, right: DEFAULT_MARGIN_RIGHT };

function clampMargin(value: number): number {
  return Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, value));
}

export function getPagedMode(): boolean {
  return isPagedMode;
}

export function setPagedMode(enabled: boolean): void {
  isPagedMode = enabled;
  localStorage.setItem(PAGINATION_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("aurawrite:pagination-mode-changed", { detail: { enabled } }));
}

export function getCassieMode(): boolean {
  return isCassieMode;
}

export function setCassieMode(enabled: boolean): void {
  isCassieMode = enabled;
  localStorage.setItem(CASSIE_PAGINATION_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("aurawrite:cassie-pagination-changed", { detail: { enabled } }));
}

export function getCassiePagedMode(): boolean {
  return isCassiePagedMode;
}

export function setCassiePagedMode(enabled: boolean): void {
  isCassiePagedMode = enabled;
  localStorage.setItem(CASSIE_PAGED_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("aurawrite:cassie-paged-changed", { detail: { enabled } }));
}

export function getMargins(): PageMargins {
  return { ...currentMargins };
}

export function setMargins(margins: Partial<PageMargins>): void {
  if (margins.top !== undefined) currentMargins.top = clampMargin(margins.top);
  if (margins.bottom !== undefined) currentMargins.bottom = clampMargin(margins.bottom);
  if (margins.left !== undefined) currentMargins.left = clampMargin(margins.left);
  if (margins.right !== undefined) currentMargins.right = clampMargin(margins.right);
  localStorage.setItem(MARGINS_KEY, JSON.stringify(currentMargins));
  window.dispatchEvent(new CustomEvent("aurawrite:margins-changed", { detail: { margins: getMargins() } }));
}

function migrateOldMarginKey(): void {
  const old = localStorage.getItem(OLD_MARGIN_KEY);
  if (old !== null) {
    const pct = parseInt(old, 10);
    if (!isNaN(pct)) {
      const lr = Math.round(pct * 2.88);
      setMargins({ left: lr, right: lr });
    }
    localStorage.removeItem(OLD_MARGIN_KEY);
  }
}

export function initPagedMode(): void {
  const saved = localStorage.getItem(PAGINATION_KEY);
  isPagedMode = saved === "true";
  const savedCassie = localStorage.getItem(CASSIE_PAGINATION_KEY);
  isCassieMode = savedCassie === "true";
  const savedCassiePaged = localStorage.getItem(CASSIE_PAGED_KEY);
  isCassiePagedMode = savedCassiePaged === "true";

  migrateOldMarginKey();

  const savedMargins = localStorage.getItem(MARGINS_KEY);
  if (savedMargins) {
    try {
      const parsed = JSON.parse(savedMargins);
      currentMargins = {
        top: clampMargin(parsed.top ?? DEFAULT_MARGIN_TOP),
        bottom: clampMargin(parsed.bottom ?? DEFAULT_MARGIN_BOTTOM),
        left: clampMargin(parsed.left ?? DEFAULT_MARGIN_LEFT),
        right: clampMargin(parsed.right ?? DEFAULT_MARGIN_RIGHT),
      };
    } catch {
      currentMargins = { top: DEFAULT_MARGIN_TOP, bottom: DEFAULT_MARGIN_BOTTOM, left: DEFAULT_MARGIN_LEFT, right: DEFAULT_MARGIN_RIGHT };
    }
  }
}