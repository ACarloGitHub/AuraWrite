// ============================================================================
// The languages a value can be written in.
//
// This is a short list of the main languages, not every code ISO 639-1 knows:
// Avestan or Bihari would be empty voices in a picker, and offering them would
// promise something we do not mean. The names are asked to the platform
// (`Intl.DisplayNames`), in the language of the interface. "Follow the system"
// still formats whatever locale the machine has, even one not listed here.
//
// The `system` entry is not a language: it is the intention to follow the
// machine, resolved at every start and never stored as a resolved tag.
// ============================================================================

export const SYSTEM_LANGUAGE = "system";

/** The main languages, alphabetical by code. */
export const LANGUAGE_TAGS: readonly string[] = [
  "ar", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "hu",
  "id", "it", "ja", "ko", "nl", "no", "pl", "pt", "ro", "ru", "sv", "th",
  "tr", "uk", "vi", "zh",
];

export interface LanguageOption {
  tag: string;
  name: string;
}

let displayNames: Intl.DisplayNames | null = null;

function displayName(): Intl.DisplayNames | null {
  if (displayNames) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

/** The language's name as the platform knows it; the tag itself if it does not. */
export function languageName(tag: string): string {
  const base = tag.split("-")[0].toLowerCase();
  try {
    return displayName()?.of(base) ?? tag;
  } catch {
    return tag;
  }
}

/** Every language, named and sorted the way a picker shows them. */
export function languageOptions(): LanguageOption[] {
  return LANGUAGE_TAGS.map((tag) => ({ tag, name: languageName(tag) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
