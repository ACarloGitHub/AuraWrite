/**
 * Turning a text into something safe to write inside the interface's HTML.
 *
 * This used to be nine copies in seven files with three different behaviours:
 * two built a <div> in the browser and read it back, two left the apostrophe
 * alone, the rest escaped five characters. The same text could therefore come
 * out differently depending on which panel showed it. Escaping all five is the
 * safest of the three and is what is kept here.
 *
 * `escapeAttr` is the same function on purpose: the five characters are safe
 * both in a text node and inside an attribute value.
 *
 * Not for file output: `formats/epub-export.ts` writes XML for the EPUB and
 * `formats/docx-tables.ts` builds HTML for Word - different context, different
 * rules.
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] as string);
}

export function escapeAttr(text: string): string {
  return escapeHtml(text);
}
