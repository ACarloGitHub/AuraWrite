import type { TemplateStyleSpec } from "./_types";

/**
 * The pre-filled documents a template drops into its sections when a project
 * is created from it: a plain-language explanation, a worked example, a part
 * left empty for the user, and the prompts to ask the AI.
 *
 * Written once here: seven template files used to carry their own identical
 * copy of this assembly (book, thesis, article, notes, doctor, student,
 * teacher), plus four copies of `emptyDoc`. The texts inside the documents do
 * not change - only where the assembly lives.
 */
export const docTutorial = (
  title: string,
  explanation: string,
  example: string,
  writableHeader: string,
  prompts: string[]
) => ({
  title,
  body: [
    explanation,
    "",
    "## Example",
    example,
    "",
    writableHeader,
    "",
    "## Suggested prompts",
    ...prompts.map((p) => `- Ask the AI: "${p}"`),
  ].join("\n"),
});

/** An empty document the user will fill in (e.g. a chapter placeholder). */
export const emptyDoc = (title: string) => ({
  title,
  body: "",
});

/**
 * The style entries every template appends to its own list:
 *
 * - `Custom`: the reserved seat for a style the user writes himself - a dialog
 *   with name + prompt is planned (wiki: todo/_priorita-3, «Creazione di stili
 *   di scrittura personalizzati»). The fragment is empty today.
 * - `User`: imitate the way the user already writes - the AI observes the text
 *   on the page and matches its tone, rhythm, vocabulary, sentence structure
 *   and citation density. Where a document has no citations or no personal
 *   sentence pattern there is nothing to match and the instruction is empty:
 *   harmless (decided by Carlo, 29-09, when the two extras of thesis and
 *   article were merged into the shared wording).
 * - `None`: no style instruction at all.
 */
export const customStyleEntry: TemplateStyleSpec = { name: "Custom", fragment: "" };
export const userStyleEntry: TemplateStyleSpec = {
  name: "User",
  fragment:
    "Adapt to the user's personal writing style. Observe the existing text and match its tone, rhythm, vocabulary, sentence structure, and citation density.",
};
export const noneStyleEntry: TemplateStyleSpec = { name: "None", fragment: "" };
