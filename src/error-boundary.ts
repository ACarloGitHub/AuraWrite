let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function initErrorBoundaries(): void {
  window.addEventListener("error", (event: ErrorEvent) => {
    showErrorToast(event.message || "An unexpected error occurred");
    console.error("[AuraWrite] Uncaught error:", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const msg = event.reason?.message || String(event.reason) || "Unhandled async error";
    showErrorToast(msg);
    console.error("[AuraWrite] Unhandled rejection:", event.reason);
  });
}

type ToastKind = "error" | "info" | "success";

export function showToast(
  message: string,
  kind: ToastKind = "info",
  duration = 5000
): void {
  let container = document.getElementById("error-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "error-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `error-toast error-toast--${kind}`;
  toast.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "error-toast-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => {
    toast.classList.add("error-toast--fade");
    setTimeout(() => toast.remove(), 300);
    if (toastTimeout) clearTimeout(toastTimeout);
  });

  toast.appendChild(closeBtn);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("error-toast--visible");
  });

  toastTimeout = setTimeout(() => {
    toast.classList.add("error-toast--fade");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function showErrorToast(message: string, duration = 5000): void {
  showToast(message, "error", duration);
}

export function showInfoToast(message: string, duration = 5000): void {
  showToast(message, "info", duration);
}

export function showSuccessToast(message: string, duration = 5000): void {
  showToast(message, "success", duration);
}