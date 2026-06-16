const PAGINATION_KEY = "aurawrite-paged-mode";
const CASSIE_PAGINATION_KEY = "aurawrite-cassie-pagination-mode";
const CASSIE_PAGED_KEY = "aurawrite-cassie-paged-mode";

let isPagedMode: boolean = false;
let isCassieMode: boolean = false;
let isCassiePagedMode: boolean = false;

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

export function initPagedMode(): void {
  const saved = localStorage.getItem(PAGINATION_KEY);
  isPagedMode = saved === "true";
  const savedCassie = localStorage.getItem(CASSIE_PAGINATION_KEY);
  isCassieMode = savedCassie === "true";
  const savedCassiePaged = localStorage.getItem(CASSIE_PAGED_KEY);
  isCassiePagedMode = savedCassiePaged === "true";
}