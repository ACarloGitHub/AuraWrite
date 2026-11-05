// ============================================================================
// The languages a value can be written in.
//
// The list is ISO 639-1 - the complete set of two-letter codes, not a selection
// made for this program - so Chinese, Russian, Arabic and the rest are here, and
// the list grows by changing this array, not by arguing about it. The names are
// asked to the platform (`Intl.DisplayNames`), in the language of the interface:
// a language is not translated by us.
//
// The `system` entry is not a language: it is the intention to follow the
// machine, resolved at every start and never stored as a resolved tag.
// ============================================================================

export const SYSTEM_LANGUAGE = "system";

/** ISO 639-1, alphabetical. */
export const LANGUAGE_TAGS: readonly string[] = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce",
  "ch", "co", "cr", "cs", "cu", "cv", "cy", "da", "de", "dv", "dz", "ee",
  "el", "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr",
  "fy", "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr",
  "ht", "hu", "hy", "hz", "ia", "id", "ie", "ig", "ii", "ik", "io", "is",
  "it", "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn",
  "ko", "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln",
  "lo", "lt", "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms",
  "mt", "my", "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv",
  "ny", "oc", "oj", "om", "or", "os", "pa", "pi", "pl", "ps", "pt", "qu",
  "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "si", "sk",
  "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta",
  "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw",
  "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "wo", "xh", "yi",
  "yo", "za", "zh", "zu",
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

/**
 * The AI's own choices are a shorter list - the languages its prompt names - and
 * they remain AI facts. This maps a value language onto that list, falling back
 * to English for the languages the AI prompt does not name yet.
 */
const AI_LANGUAGE_BY_TAG: Record<string, string> = {
  en: "English", it: "Italian", fr: "French", de: "German", es: "Spanish", pt: "Portuguese",
};

export function aiLanguageFor(tag: string): string {
  return AI_LANGUAGE_BY_TAG[tag.split("-")[0].toLowerCase()] ?? "English";
}
