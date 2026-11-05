// ============================================================================
// The language of the document: the middle level between the preference and the
// single cell.
//
// The choice lives with the document, not with the content tree: the editor
// keeps it in memory and the JSON of the document carries it as an attribute of
// the document node (written when saving, read when opening). The value in force
// when a number is formatted is the document's own language when it has one, the
// preference otherwise; a cell can still say a language of its own.
//
// Changing it is a real change of the document: every formatted cell is written
// again in the new language, and the project saves the new field.
// ============================================================================

import { languageName, languageOptions } from "../i18n/languages";
import { valuesLanguage } from "../i18n/regional";

const SELECT_ID = "doc-language";

/** The language this document declares, or null when it follows the preferences. */
let override: string | null = null;

export function documentLanguageOverride(): string | null {
  return override;
}

/** The language values are written in for this document. */
export function effectiveDocumentLanguage(): string {
  return override ?? valuesLanguage();
}

/** The language stored in a document's JSON, if it says one. */
export function languageFromDocumentJson(text: string): string | null {
  try {
    const raw = JSON.parse(text) as { attrs?: { language?: unknown } };
    const tag = raw?.attrs?.language;
    return typeof tag === "string" && tag.trim() ? tag.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The document's JSON with the language this editor holds. Writing it here, at
 * save time, keeps the choosing free of the content tree: the document node's
 * attributes cannot be changed by a transaction in this version of ProseMirror.
 */
export function withDocumentLanguage(json: Record<string, unknown>): Record<string, unknown> {
  const attrs = { ...(json.attrs as Record<string, unknown> | undefined) };
  if (override) attrs.language = override;
  else delete attrs.language;
  if (Object.keys(attrs).length > 0) return { ...json, attrs };
  // No language to declare: the document says nothing, and the stored JSON must
  // not grow an empty `attrs` just because the schema has the field.
  const { attrs: _dropped, ...rest } = json;
  return rest;
}

/**
 * Adopt the language a document declares (or none: it follows the preferences).
 * Opening a document is not a change: nothing is dispatched and no cell is
 * rewritten — the document shows the numbers it was written with.
 */
export function installDocumentLanguage(tag: string | null): void {
  override = tag || null;
  syncSelect();
}

/**
 * Build the footer control once and keep it in step. It shows the document's
 * language, and "Follow preferences" when the document does not declare one.
 */
export function setupDocumentLanguage(): void {
  const select = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.filled !== "true") {
    const follow = document.createElement("option");
    follow.value = "";
    follow.textContent = "Follow preferences";
    select.appendChild(follow);
    const fragment = document.createDocumentFragment();
    for (const { tag, name } of languageOptions()) {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = name;
      fragment.appendChild(option);
    }
    select.appendChild(fragment);
    select.dataset.filled = "true";
    select.addEventListener("change", () => {
      override = select.value || null;
      syncSelect();
      window.dispatchEvent(new CustomEvent("aurawrite:document-language-changed"));
    });
    // The label of "Follow preferences" names the language it resolves to, so
    // the footer always says which language the values are written in.
    window.addEventListener("aurawrite:values-language-changed", syncSelect);
  }
  syncSelect();
}

/** The control shows the intention, and its tooltip the language really in force. */
function syncSelect(): void {
  const select = document.getElementById(SELECT_ID) as HTMLSelectElement | null;
  if (!select) return;
  const follow = select.querySelector<HTMLOptionElement>('option[value=""]');
  if (follow) {
    follow.textContent = override ? "Follow preferences" : `Follow preferences (${valuesLanguage()})`;
  }
  select.value = override ?? "";
  const effective = languageName(effectiveDocumentLanguage());
  select.title = override
    ? `Language of this document: ${effective}`
    : `Language of this document: follows the preferences (${effective})`;
}
