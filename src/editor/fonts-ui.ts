import { invoke, convertFileSrc } from "@tauri-apps/api/core";

interface UserFont {
  path: string;
  filename: string;
  family_guess: string;
  size_bytes: number;
}

const USER_FONT_DROPDOWN_IDS = [
  "sel-font-family",
  "pref-fonts-editor",
  "pref-fonts-ui",
];

/**
 * Injects `@font-face` rules for user fonts into <head> and adds
 * corresponding <option> entries to the toolbar font-family dropdown
 * and the Preferences editor/UI font selects.
 *
 * Idempotent: re-running clears previous user entries first.
 */
export async function populateUserFontsInToolbar(): Promise<void> {
  let fonts: UserFont[] = [];
  try {
    fonts = await invoke<UserFont[]>("list_user_fonts");
  } catch (e) {
    console.warn("[fonts-ui] list_user_fonts failed:", e);
    return;
  }
  if (!fonts || fonts.length === 0) return;

  document.querySelectorAll("style[data-user-fonts]").forEach((el) => el.remove());
  document.querySelectorAll("option[data-user-font]").forEach((el) => el.remove());

  const style = document.createElement("style");
  style.dataset.userFonts = "true";
  const faceRules = fonts
    .map((f) => {
      const url = convertFileSrc(f.path);
      return `@font-face { font-family: "${f.family_guess}"; src: url("${url}"); font-display: swap; }`;
    })
    .join("\n");
  style.textContent = faceRules;
  document.head.appendChild(style);

  for (const id of USER_FONT_DROPDOWN_IDS) {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) continue;
    for (const f of fonts) {
      const opt = document.createElement("option");
      opt.value = f.family_guess;
      opt.textContent = `\u{1F4C1} ${f.family_guess}`;
      opt.style.fontFamily = `"${f.family_guess}", sans-serif`;
      opt.dataset.userFont = "true";
      sel.appendChild(opt);
    }
  }
}

/**
 * Listen for the "aurawrite:fonts-reloaded" event from the Preferences
 * tab and re-populate the toolbar dropdown.
 */
export function setupFontsReloadListener(): void {
  window.addEventListener("aurawrite:fonts-reloaded", () => {
    void populateUserFontsInToolbar();
  });
}
