/**
 * Preferences store: read/save of the persisted preferences.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.3).
 *
 * CRITICAL: the localStorage key "aurawrite-preferences" is a de-facto
 * contract shared with ai-manager.ts (API key handling) and the resizable
 * panels (width sub-fields). Never change it.
 */
import { invoke } from "@tauri-apps/api/core";
import { setCachedApiKey, getEffectiveProviderName } from "../ai-panel/ai-manager";
import { defaultPreferences, type Preferences } from "./types";

export {
  type Preferences,
  type ThemeMode,
  defaultPreferences,
  defaultSuggestionsPrompt,
  defaultAIAssistantPrompt,
  defaultEntityExtractionPrompt,
  defaultToolCallingPrompt,
} from "./types";

const PREFERENCES_KEY = "aurawrite-preferences";

export function getPreferences(): Preferences {
  const saved = localStorage.getItem(PREFERENCES_KEY);
  if (saved) {
    return { ...defaultPreferences, ...JSON.parse(saved) };
  }
  return defaultPreferences;
}

/**
 * Persist preferences to localStorage and store the API key securely.
 * Note: does NOT apply preferences to the DOM — the caller (main.ts)
 * keeps applying them via applyPreferences() after persisting, in the
 * same order as the original monolithic savePreferences().
 */
export async function persistPreferences(prefs: Preferences): Promise<void> {
  const prefsToStore = { ...prefs, aiApiKey: "" };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefsToStore));
  const effectiveProvider = getEffectiveProviderName(prefs.aiProvider, prefs.aiOllamaMode);
  if (prefs.aiApiKey !== undefined && prefs.aiApiKey.trim()) {
    setCachedApiKey(effectiveProvider, prefs.aiApiKey);
    try {
      await invoke("secrets_set", { key: `ai-api-key:${effectiveProvider}`, value: prefs.aiApiKey });
    } catch (e) {
      console.error("[secrets] failed to save API key:", e);
    }
  }
}
