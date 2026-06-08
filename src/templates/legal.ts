import type { Template } from "./_types";

const legalTutorial = (title: string, explanation: string, example: string, prompts: string[]) => ({
  title,
  body: [
    explanation,
    "",
    "## Example",
    example,
    "",
    "## Suggested prompts",
    ...prompts.map((p) => `- Ask the AI: "${p}"`),
  ].join("\n"),
});

const clientBlockDocs = [
  { title: "Case metadata" },
  { title: "Facts and evidence" },
  { title: "Law" },
  { title: "Correspondence and filings" },
  { title: "Strategic notes" },
  { title: "Hearings calendar" },
];

export const legalTemplate: Template = {
  type: "legal",
  displayName: "Legal",
  icon: "⚖️",
  description: "For a single lawyer or small law firm. Cases organised by client with 5 blocks (metadata, facts, law, correspondence, notes) plus hearings calendar.",
  requiresStyleChoice: true,
  sections: [
    {
      name: "Client 1",
      documents: clientBlockDocs.map((d) => ({ title: d.title, body: "" })),
    },
    {
      name: "Cross-case deadlines",
      tutorial: legalTutorial(
        "Cross-case view: all deadlines in chronological order",
        "Use this section to keep a horizontal view of every upcoming deadline, hearing and filing across all your active cases. Add one document per deadline with the date and the case it belongs to.",
        "15 March 2026 — Hearing: Rossi v. Bianchi (Tribunale di Milano, RG 1234/2025)\n10 April 2026 — Filing deadline: brief in appeal for Verdi case (RG 5678/2025)",
        [
          "Summarise the next 30 days of deadlines in my project",
          "Which of my active cases have a hearing in the next quarter?",
          "What is the standard deadline to file a brief in Italian civil appeals?",
        ]
      ),
    },
    {
      name: "Court",
      tutorial: legalTutorial(
        "How to organise hearings",
        "Use this section as your notebook for court appearances: which judge, which courtroom, which hearing type, outcomes. Pair it with the hearings calendar inside each client block to keep a per-case and a cross-case view.",
        "Court: Tribunale di Milano, Sezione III Civile.\nPresiding judge: Dott. Bianchi.\nUpcoming hearing: 15 March 2026, h 9:30, courtroom 4.\nNotes: Bring printed copy of the brief and the original contract.",
        [
          "Draft a short note for the upcoming hearing in {NOME_PRATICA}",
          "Prepare a checklist of documents to bring to court for {NOME_PRATICA}",
          "Which courtroom and judge are scheduled for {NOME_PRATICA}?",
        ]
      ),
      documents: [
        { title: "Magistrates and clerks directory" },
      ],
    },
    {
      name: "Templates and forms",
      tutorial: legalTutorial(
        "Power of attorney, formal notices, standard briefs",
        "Use this section to keep your standard forms and templates: power of attorney, formal notice (diffida), standard memorie. Reuse them across cases by copying the document.",
        "Template: Diffida ad adempiere\nRecipient: [Cliente controparte]\nObject: inadempimento contrattuale ex art. 1454 c.c.\nTerm: 15 giorni dalla ricezione.",
        [
          "Draft a power of attorney for {NOME_CLIENTE}",
          "Generate a formal notice (diffida) for {NOME_PRATICA}",
          "Adapt the standard memorie template to {NOME_PRATICA}",
        ]
      ),
    },
    {
      name: "Case law and references",
      tutorial: legalTutorial(
        "Case law databases and codes",
        "Use this section to collect the statutes, codes and case law you cite most often. The AI reads this context to suggest accurate references for the matter at hand.",
        "Civil: Codice Civile (Artt. 1-2969), Codice di Procedura Civile.\nKey cases: Cass. civ. n. 12345/2024 (oneri probatori), Cass. civ. n. 67890/2023 (responsabilità precontrattuale).",
        [
          "Find recent Supreme Court case law on {MATERIA_PRATICA}",
          "Cite the relevant articles of the Italian Civil Code for {NOME_PRATICA}",
          "Summarise the difference between {CONTROPARTE}'s position and our client's in {NOME_PRATICA}",
        ]
      ),
    },
    {
      name: "Reports and analytics",
      tutorial: legalTutorial(
        "Activity reports, billing, performance",
        "Use this section to keep a monthly activity log: hours worked per case, billable hours, fees collected, success rate. The AI can summarise your activity for billing or internal review.",
        "January 2026: 142 hours total, 98 billable. Active cases: 12. Closed: 2 (1 won, 1 settled).",
        [
          "Summarise my billable hours by case for the last month",
          "Which of my active cases has been open the longest?",
          "Draft a monthly activity report for the firm",
        ]
      ),
    },
  ],
  entityTypes: [
    {
      name: "Case",
      icon: "📁",
      color: "#4a90d9",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "client", type: "text" },
        { name: "counterparty", type: "text" },
        { name: "matter", type: "text", note: 'e.g. "Civil", "Criminal", "Labour"' },
        { name: "rg", type: "text" },
        { name: "court", type: "text" },
        { name: "judge", type: "text" },
        { name: "caseValue", type: "number" },
        { name: "phase", type: "enum", enum_values: ["pre-litigation", "first_instance", "appeal", "cassation", "closed"] },
        { name: "status", type: "enum", enum_values: ["active", "standby", "closed_won", "closed_lost", "closed_settled", "closed_lapsed"] },
        { name: "deadline", type: "date" },
        { name: "factsEvidence", type: "text" },
        { name: "law", type: "text" },
        { name: "correspondenceFilings", type: "text" },
        { name: "strategicNotes", type: "text" },
      ],
    },
    {
      name: "Client",
      icon: "👤",
      color: "#38c172",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "type", type: "enum", enum_values: ["individual", "corporate"] },
        { name: "contact", type: "text" },
        { name: "fiscalCode", type: "text" },
        { name: "vatNumber", type: "text" },
      ],
    },
    {
      name: "Counterparty",
      icon: "⚔️",
      color: "#e74c3c",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "type", type: "text" },
        { name: "contact", type: "text" },
      ],
    },
    {
      name: "Deadline",
      icon: "⏰",
      color: "#e4a700",
      fields: [
        { name: "caseRef", type: "text" },
        { name: "type", type: "enum", enum_values: ["term", "hearing", "filing", "other"] },
        { name: "date", type: "date" },
        { name: "description", type: "text" },
        { name: "status", type: "text" },
      ],
    },
    {
      name: "Filing",
      icon: "📜",
      color: "#9b59b6",
      fields: [
        { name: "caseRef", type: "text" },
        { name: "type", type: "text" },
        { name: "date", type: "date" },
        { name: "outcome", type: "text" },
      ],
    },
  ],
  styles: [
    { name: "Formal-legal", fragment: "Formal register, technical-legal language, citations of code articles and special laws, references to court decisions (Cassazione/Merito with full citation), canonical form of Italian judicial acts. Legal lexicon, structured sentences." },
    { name: "Plain language (client communication)", fragment: "Clear register, accessible to non-legal clients. Explain in a comprehensible way without giving up precision. Avoid unnecessary Latinisms, prefer explicit formulations. Professional but empathic tone." },
    { name: "Custom", fragment: "" },
    { name: "User", fragment: "Adapt to the user's personal writing style. Observe the existing text and match its tone, rhythm and vocabulary." },
    { name: "None", fragment: "" },
  ],
  defaultStyleName: "Formal-legal",
  prompts: {
    suggestions: "You are a senior Italian lawyer. The user is working on case \"{NOME_PRATICA}\" for client \"{NOME_CLIENTE}\". Read the current document and project context. Suggest up to 5 brief continuations (1-2 sentences each) that respect formal-legal register, cite the relevant code articles where appropriate, and advance the case strategy.",
    chat: "You are an Italian legal assistant specialised in civil, criminal and labour law. Help the user draft acts, structure the 5 blocks (metadata, facts, law, correspondence, notes), search case law, analyse deadlines, brainstorm strategies, and revise language. When the user mentions a case, use {NOME_PRATICA} as a placeholder. For the client use {NOME_CLIENTE}. Always respect the chosen writing style.",
  },
};
