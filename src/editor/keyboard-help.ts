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

  // Escape closes the modal. The "?" key no longer opens it: the dedicated
  // toolbar button (btn-keyboard-help) is the only way to show the shortcut
  // list, so typing a question mark while writing no longer triggers it.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      modal.classList.add("hidden");
    }
  });
}