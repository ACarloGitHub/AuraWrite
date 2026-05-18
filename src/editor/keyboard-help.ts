export function initKeyboardHelp(): void {
  const btnHelp = document.getElementById("btn-keyboard-help");
  const modal = document.getElementById("keyboard-help-modal");
  const btnClose = document.getElementById("keyboard-help-close");
  const overlay = modal?.querySelector(".modal-overlay");

  if (!btnHelp || !modal) return;

  btnHelp.addEventListener("click", () => {
    modal.classList.remove("hidden");
  });

  btnClose?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  overlay?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      if (modal.classList.contains("hidden")) {
        modal.classList.remove("hidden");
      } else {
        modal.classList.add("hidden");
      }
    }
  });
}