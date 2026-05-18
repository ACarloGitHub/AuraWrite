const PREFERENCES_KEY = "aurawrite-preferences";

let cachedPreferences: Record<string, unknown> | null = null;

function loadFromStorage(): Record<string, unknown> {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return {};
    }
  }
  return {};
}

export function getPreferences<T extends Record<string, unknown>>(defaults: T): T {
  if (!cachedPreferences) {
    cachedPreferences = loadFromStorage();
  }
  return { ...defaults, ...cachedPreferences } as T;
}

export function invalidatePreferencesCache(): void {
  cachedPreferences = null;
}

export function initPreferencesCache(): void {
  cachedPreferences = loadFromStorage();
  window.addEventListener("aurawrite:preferences-changed", invalidatePreferencesCache);
}