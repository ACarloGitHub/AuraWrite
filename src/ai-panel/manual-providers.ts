/**
 * Manual AI provider profiles.
 *
 * A "manual" provider is a user-defined AI service entry: the user types a
 * name for it, its base URL, an optional API key and the model to use. More
 * than one profile can be registered and the user switches between them by
 * name (the name field works as an editable dropdown).
 *
 * Storage contract:
 *   - the profile list and the active profile name live in the preferences
 *     object under `aiManualProfiles` / `aiManualActive` (see
 *     preferences/types.ts);
 *   - API keys NEVER live in the profile: they go to the encrypted store
 *     under `ai-api-key:manual:<name>`, the same namespace used by the
 *     built-in providers;
 *   - `manualSecretName(name)` is the effective provider name for that
 *     profile, and is what `getEffectiveProviderName()` returns while the
 *     "manual" provider is active.
 *
 * This module must not import ai-manager.ts (ai-manager imports this one).
 */
import { invoke } from "@tauri-apps/api/core";

export type ManualApiType = "openai" | "anthropic";

export interface ManualProfile {
  /** Identity and label of the profile (case-insensitively unique). */
  name: string;
  /** Wire dialect used to talk to the service. */
  apiType: ManualApiType;
  /** Full base URL, including the version path (e.g. .../v1). */
  baseUrl: string;
  /** Model id, picked from the service's list or typed by hand. */
  model: string;
  /** Context window in tokens; 0 = unknown (fall back to detection). */
  contextSize: number;
}

export const MANUAL_PROVIDER = "manual";

const PREFERENCES_KEY = "aurawrite-preferences";
const PROFILE_PREFIX = "manual:";

/** Effective provider name (key-store namespace) of a manual profile. */
export function manualSecretName(name: string): string {
  return `${MANUAL_PROVIDER}:${(name || "").trim()}`;
}

/** True when `provider` is the manual provider or one of its profiles. */
export function isManualProvider(provider: string | undefined | null): boolean {
  return !!provider && (provider === MANUAL_PROVIDER || provider.startsWith(PROFILE_PREFIX));
}

function readStoredPreferences(): Record<string, unknown> {
  const raw = localStorage.getItem(PREFERENCES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function sanitizeManualProfile(raw: unknown): ManualProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!name) return null;
  const apiType: ManualApiType = entry.apiType === "anthropic" ? "anthropic" : "openai";
  const contextRaw = typeof entry.contextSize === "number" ? entry.contextSize : parseInt(String(entry.contextSize ?? ""), 10);
  return {
    name,
    apiType,
    baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "",
    model: typeof entry.model === "string" ? entry.model.trim() : "",
    contextSize: Number.isFinite(contextRaw) && contextRaw > 0 ? Math.floor(contextRaw) : 0,
  };
}

/** All registered manual profiles, sanitized (never null). */
export function getManualProfiles(): ManualProfile[] {
  const stored = readStoredPreferences().aiManualProfiles;
  if (!Array.isArray(stored)) return [];
  const profiles: ManualProfile[] = [];
  for (const raw of stored) {
    const profile = sanitizeManualProfile(raw);
    // Drop duplicates (case-insensitive), keeping the first occurrence.
    if (profile && !profiles.some((p) => p.name.toLowerCase() === profile.name.toLowerCase())) {
      profiles.push(profile);
    }
  }
  return profiles;
}

/** Name of the profile in use; falls back to the first registered one. */
export function getActiveManualName(): string {
  const stored = readStoredPreferences();
  const active = typeof stored.aiManualActive === "string" ? stored.aiManualActive.trim() : "";
  const profiles = getManualProfiles();
  if (active) {
    const found = findManualProfile(profiles, active);
    if (found) return found.name;
  }
  return profiles[0]?.name || "";
}

export function findManualProfile(
  profiles: ManualProfile[],
  name: string,
): ManualProfile | null {
  const needle = (name || "").trim().toLowerCase();
  if (!needle) return null;
  return profiles.find((p) => p.name.toLowerCase() === needle) || null;
}

export function getManualProfile(name: string): ManualProfile | null {
  return findManualProfile(getManualProfiles(), name);
}

export function getActiveManualProfile(): ManualProfile | null {
  return getManualProfile(getActiveManualName());
}

/**
 * Write the profile list and the active name straight into the stored
 * preferences JSON (read-modify-write: every other preference is untouched).
 * Used by the name-field and delete listeners, which must persist the list
 * BEFORE the generic preferences save reads it back.
 */
export function storeManualProfiles(profiles: ManualProfile[], activeName: string): void {
  const raw = localStorage.getItem(PREFERENCES_KEY);
  let parsed: Record<string, unknown> = {};
  try {
    const maybe = raw ? JSON.parse(raw) : null;
    if (maybe && typeof maybe === "object") parsed = maybe as Record<string, unknown>;
  } catch {
    // Unreadable preferences blob: rebuild it from scratch is NOT attempted
    // here — the caller (preferences save) owns the full object.
  }
  parsed.aiManualProfiles = profiles;
  parsed.aiManualActive = activeName;
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(parsed));
}

/** The manual fields as they stand in the preferences form. */
export interface ManualDraft {
  name: string;
  apiType: ManualApiType;
  baseUrl: string;
  model: string;
  contextSize: number;
}

/**
 * Fold the form's manual fields into the stored profile list. This is the one
 * place where the form writes profiles: editing a field can therefore never
 * touch another profile. An empty name stores nothing (the list is returned
 * untouched), so a half-typed profile name cannot create junk entries.
 */
export function foldDraftIntoProfiles(draft: ManualDraft): {
  profiles: ManualProfile[];
  activeName: string;
} {
  const profiles = getManualProfiles();
  const name = (draft.name || "").trim();
  if (!name) return { profiles, activeName: getActiveManualName() };
  const existing = findManualProfile(profiles, name);
  const contextRaw = Number(draft.contextSize);
  const profile: ManualProfile = {
    // Keep the previously stored casing when the name differs only by case.
    name: existing ? existing.name : name,
    apiType: draft.apiType === "anthropic" ? "anthropic" : "openai",
    baseUrl: (draft.baseUrl || "").trim(),
    model: (draft.model || "").trim(),
    // An empty field means "let AuraWrite find out" (same contract as the
    // LM Studio override): the form is always loaded with the stored value
    // first, so clearing it here is a deliberate user action.
    contextSize: Number.isFinite(contextRaw) && contextRaw > 0 ? Math.floor(contextRaw) : 0,
  };
  const next = existing
    ? profiles.map((p) => (p.name.toLowerCase() === name.toLowerCase() ? profile : p))
    : [...profiles, profile];
  return { profiles: next, activeName: profile.name };
}

export function removeManualProfile(name: string): ManualProfile[] {
  const needle = (name || "").trim().toLowerCase();
  const profiles = getManualProfiles().filter((p) => p.name.toLowerCase() !== needle);
  const nextActive = name.toLowerCase() === getActiveManualName().toLowerCase()
    ? (profiles[0]?.name || "")
    : getActiveManualName();
  storeManualProfiles(profiles, nextActive);
  return profiles;
}

/**
 * Rename a profile in the list (identity is the name, so this is a move).
 * Returns false when the target name is already taken or the source is gone.
 */
export function renameManualProfile(oldName: string, newName: string): boolean {
  const target = (newName || "").trim();
  if (!target || !findManualProfile(getManualProfiles(), oldName)) return false;
  if (findManualProfile(getManualProfiles(), target)) return false;
  const profiles = getManualProfiles().map((p) =>
    p.name.toLowerCase() === oldName.trim().toLowerCase() ? { ...p, name: target } : p,
  );
  const wasActive = getActiveManualName().toLowerCase() === oldName.trim().toLowerCase();
  storeManualProfiles(profiles, wasActive ? target : getActiveManualName());
  return true;
}

/**
 * Move the encrypted API key of a profile to its new name. Returns true when
 * a key was moved (an absent key is not an error: local servers need none).
 */
export async function migrateManualSecret(oldName: string, newName: string): Promise<boolean> {
  const from = manualSecretName(oldName);
  const to = manualSecretName(newName);
  try {
    const key = await invoke<string | null>("secrets_get", { key: from });
    if (!key) {
      await invoke("secrets_delete", { key: from }).catch(() => {});
      return false;
    }
    await invoke("secrets_set", { key: to, value: key });
    await invoke("secrets_delete", { key: from }).catch(() => {});
    return true;
  } catch (e) {
    console.error("[manual provider] failed to move the API key on rename:", e);
    return false;
  }
}

/** Delete the encrypted API key of a profile. */
export async function deleteManualSecret(name: string): Promise<void> {
  try {
    await invoke("secrets_delete", { key: manualSecretName(name) });
  } catch (e) {
    console.error(`[manual provider] failed to delete the API key of "${name}":`, e);
  }
}
