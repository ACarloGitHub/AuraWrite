// download-toast.ts - Persistent download progress UI for llama.cpp / nomic
//
// Shows a fixed bottom-center card with name, progress bar,
// percent, speed, ETA, and Cancel/Retry buttons. Used by the
// embeddings tab during llama.cpp and nomic downloads.
//
// Reuses the same visual language as the other toasts in
// error-boundary.ts (info/error/success) but is intentionally
// persistent (it does not auto-dismiss) and shows a progress
// bar, not just text. The bar color is orange so it stands out
// against the gray-blue palette and does not collide with the
// green "success" toast or the red "error" toast.

interface DownloadProgress {
  name: string;
  phase: "downloading" | "verifying" | "extracting" | "done" | "error" | "cancelled";
  bytes: number;
  total: number;
  speed_bps: number;
  eta_seconds: number;
  error?: string;
}

interface DownloadState extends DownloadProgress {
  id: string;
  toastEl: HTMLElement;
  barEl: HTMLElement;
  pctEl: HTMLElement;
  metaEl: HTMLElement;
  cancelBtn: HTMLButtonElement;
  retryBtn: HTMLButtonElement;
  cancelled: boolean;
  onRetry?: () => void;
}

const STATES: Map<string, DownloadState> = new Map();
const ORDER: string[] = [];

function ensureContainer(): HTMLElement {
  let c = document.getElementById("download-progress-container");
  if (c) return c as HTMLElement;
  c = document.createElement("div");
  c.id = "download-progress-container";
  document.body.appendChild(c);
  return c;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return "— MB/s";
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function renderOne(s: DownloadState): void {
  const pct = s.total > 0 ? Math.min(100, Math.round((s.bytes / s.total) * 100)) : 0;
  s.barEl.style.width = `${pct}%`;
  s.pctEl.textContent = `${pct}%`;

  if (s.phase === "error") {
    s.barEl.classList.add("download-progress-bar--error");
    s.barEl.classList.remove("download-progress-bar--done");
    s.metaEl.textContent = s.error ? `Error: ${s.error}` : "Error";
    s.cancelBtn.style.display = "none";
    s.retryBtn.style.display = "";
    s.toastEl.classList.add("download-progress-toast--error");
    s.toastEl.classList.remove("download-progress-toast--done");
    return;
  }
  if (s.phase === "done") {
    s.barEl.style.width = "100%";
    s.barEl.classList.add("download-progress-bar--done");
    s.barEl.classList.remove("download-progress-bar--error");
    s.metaEl.textContent = `Done · ${formatBytes(s.total)}`;
    s.cancelBtn.style.display = "none";
    s.retryBtn.style.display = "none";
    s.toastEl.classList.add("download-progress-toast--done");
    s.toastEl.classList.remove("download-progress-toast--error");
    return;
  }
  if (s.phase === "cancelled") {
    s.metaEl.textContent = "Cancelled";
    s.cancelBtn.style.display = "none";
    s.retryBtn.style.display = "";
    s.toastEl.classList.add("download-progress-toast--cancelled");
    return;
  }
  s.barEl.classList.remove("download-progress-bar--done");
  s.barEl.classList.remove("download-progress-bar--error");
  s.cancelBtn.style.display = "";
  s.retryBtn.style.display = "none";
  s.toastEl.classList.remove("download-progress-toast--error");
  s.toastEl.classList.remove("download-progress-toast--done");
  s.toastEl.classList.remove("download-progress-toast--cancelled");

  if (s.phase === "verifying") {
    s.metaEl.textContent = "Verifying integrity (SHA-256)...";
    return;
  }
  if (s.phase === "extracting") {
    s.metaEl.textContent = "Extracting archive...";
    return;
  }
  s.metaEl.textContent = `${formatBytes(s.bytes)} / ${formatBytes(s.total)} · ${formatSpeed(s.speed_bps)} · ETA ${formatEta(s.eta_seconds)}`;
}

function attach(id: string, name: string): DownloadState {
  const container = ensureContainer();
  const toastEl = document.createElement("div");
  toastEl.className = "download-progress-toast";
  toastEl.innerHTML = `
    <div class="download-progress-header">
      <span class="download-progress-name"></span>
      <button class="download-progress-close" aria-label="Dismiss">&times;</button>
    </div>
    <div class="download-progress-track">
      <div class="download-progress-bar"></div>
    </div>
    <div class="download-progress-footer">
      <span class="download-progress-pct">0%</span>
      <span class="download-progress-meta">Preparing...</span>
      <button class="download-progress-cancel" style="display:none;">Cancel</button>
      <button class="download-progress-retry" style="display:none;">Retry</button>
    </div>
  `;
  (toastEl.querySelector(".download-progress-name") as HTMLElement).textContent = name;
  const barEl = toastEl.querySelector(".download-progress-bar") as HTMLElement;
  const pctEl = toastEl.querySelector(".download-progress-pct") as HTMLElement;
  const metaEl = toastEl.querySelector(".download-progress-meta") as HTMLElement;
  const cancelBtn = toastEl.querySelector(".download-progress-cancel") as HTMLButtonElement;
  const retryBtn = toastEl.querySelector(".download-progress-retry") as HTMLButtonElement;
  const closeBtn = toastEl.querySelector(".download-progress-close") as HTMLButtonElement;

  const state: DownloadState = {
    id,
    name,
    phase: "downloading",
    bytes: 0,
    total: 0,
    speed_bps: 0,
    eta_seconds: Infinity,
    toastEl,
    barEl,
    pctEl,
    metaEl,
    cancelBtn,
    retryBtn,
    cancelled: false,
  };

  cancelBtn.addEventListener("click", () => {
    state.cancelled = true;
    state.phase = "cancelled";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (window as any).__TAURI__;
    t?.event?.emit?.("download-cancel", { id });
    renderOne(state);
  });
  closeBtn.addEventListener("click", () => {
    detach(id);
  });
  retryBtn.addEventListener("click", () => {
    state.cancelled = false;
    state.phase = "downloading";
    state.bytes = 0;
    state.total = 0;
    state.speed_bps = 0;
    state.eta_seconds = Infinity;
    state.error = undefined;
    renderOne(state);
    if (state.onRetry) state.onRetry();
  });

  container.appendChild(toastEl);
  requestAnimationFrame(() => toastEl.classList.add("download-progress-toast--visible"));
  renderOne(state);
  return state;
}

function detach(id: string): void {
  const s = STATES.get(id);
  if (!s) return;
  s.toastEl.classList.add("download-progress-toast--fade");
  setTimeout(() => s.toastEl.remove(), 300);
  STATES.delete(id);
  const idx = ORDER.indexOf(id);
  if (idx >= 0) ORDER.splice(idx, 1);
}

export function updateDownloadProgress(p: DownloadProgress & { id: string }): void {
  let s = STATES.get(p.id);
  if (!s) {
    s = attach(p.id, p.name);
    STATES.set(p.id, s);
    if (!ORDER.includes(p.id)) ORDER.push(p.id);
  }
  s.phase = p.phase;
  s.bytes = p.bytes;
  s.total = p.total;
  s.speed_bps = p.speed_bps;
  s.eta_seconds = p.eta_seconds;
  if (p.error) s.error = p.error;
  if (s.cancelled && p.phase === "downloading") {
    return;
  }
  renderOne(s);

  if (p.phase === "done") {
    setTimeout(() => detach(p.id), 3000);
  } else if (p.phase === "error") {
    if (s.onRetry === undefined) {
      setTimeout(() => detach(p.id), 12000);
    }
  }
}

export function setDownloadRetryHandler(id: string, handler: () => void): void {
  const s = STATES.get(id);
  if (s) s.onRetry = handler;
}

export function clearDownload(id: string): void {
  detach(id);
}
