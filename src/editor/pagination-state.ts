const PAGINATION_KEY = "aurawrite-paged-mode";

let isPagedMode: boolean = false;

export function getPagedMode(): boolean {
  return isPagedMode;
}

export function setPagedMode(enabled: boolean): void {
  isPagedMode = enabled;
  localStorage.setItem(PAGINATION_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("aurawrite:pagination-mode-changed", { detail: { enabled } }));
}

export function initPagedMode(): void {
  const saved = localStorage.getItem(PAGINATION_KEY);
  isPagedMode = saved === "true";
}