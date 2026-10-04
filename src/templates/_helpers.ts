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
