// updates.ts - Check for new AuraWrite releases and notify the user
//
// This is a privacy-respecting, opt-in-able check that runs once at
// app startup. It calls the Tauri command `check_for_updates`, which
// does a single GET to api.github.com (the user's IP is visible to
// GitHub, nothing else). The user can disable this in Preferences.

import { invoke } from "@tauri-apps/api/core";
import { open as openBrowser } from "@tauri-apps/plugin-shell";
import { showInfoToast } from "./error-boundary";

const LAST_CHECK_KEY = "aurawrite-last-update-check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface ReleaseInfo {
  version: string;
  tag: string;
  url: string;
  body: string;
  published_at: string;
  prerelease: boolean;
}

interface Preferences {
  updatesCheckEnabled?: boolean;
  [key: string]: unknown;
}

function getPreferences(): Preferences {
  try {
    const raw = localStorage.getItem("aurawrite-preferences");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Returns true if the user has opted into update checks.
 * Default: true (opt-out rather than opt-in, since the check is
 * silent on failure and uses no personal data).
 */
export function isUpdateCheckEnabled(): boolean {
  return getPreferences().updatesCheckEnabled !== false;
}

/**
 * Manually trigger an update check (e.g. from a menu item).
 * Bypasses the 24h cache and always shows the result.
 */
export async function checkForUpdatesNow(): Promise<void> {
  try {
    const release = await invoke<ReleaseInfo | null>("check_for_updates");
    if (release) {
      showUpdateAvailableToast(release);
    } else {
      showInfoToast("AuraWrite è aggiornato all'ultima versione.", 3000);
    }
  } catch (error) {
    console.warn("[updates] check failed:", error);
    showInfoToast("Impossibile controllare gli aggiornamenti (offline?).", 3000);
  }
}

/**
 * Called once at app startup. Honors the user's preference and
 * rate-limits to once per 24h via localStorage.
 */
export async function checkForUpdatesOnStartup(): Promise<void> {
  if (!isUpdateCheckEnabled()) {
    console.log("[updates] check disabled in preferences, skipping");
    return;
  }

  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? "0");
  if (last && Date.now() - last < CHECK_INTERVAL_MS) {
    console.log("[updates] already checked in the last 24h, skipping");
    return;
  }

  // Wait 5s after startup so we don't slow down app launch
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    const release = await invoke<ReleaseInfo | null>("check_for_updates");
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (release) {
      console.log(
        `[updates] new release available: ${release.version} (${release.url})`
      );
      showUpdateAvailableToast(release);
    } else {
      console.log("[updates] up to date");
    }
  } catch (error) {
    // Silent failure: no toast, no error boundary
    console.warn("[updates] check failed (network offline?):", error);
  }
}

function showUpdateAvailableToast(release: ReleaseInfo): void {
  const isPrerelease = release.prerelease ? " (pre-release)" : "";
  showInfoToast(
    `🆕 AuraWrite v${release.version}${isPrerelease} disponibile. Click per aprire la pagina release.`,
    12000
  );

  // Make the toast itself clickable. We need to find the most recent
  // toast element and add a click handler. The toast is rendered
  // with a close button; we attach to the toast root instead.
  setTimeout(() => {
    const container = document.getElementById("error-toast-container");
    if (!container) return;
    const lastToast = container.lastElementChild as HTMLElement | null;
    if (lastToast) {
      lastToast.style.cursor = "pointer";
      lastToast.title = release.url;
      lastToast.addEventListener("click", () => {
        openBrowser(release.url).catch((e: unknown) => {
          console.error("[updates] failed to open browser:", e);
          window.open(release.url, "_blank", "noopener,noreferrer");
        });
      });
    }
  }, 50);
}
