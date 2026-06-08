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
  {
    title: "Case metadata",
    body: [
      "This document captures the essential information about the case: parties, court, judge, case number (RG), subject matter, value, current phase, and status. Keep it updated as the case progresses.",
      "",
      "## Example",
      "Client: Mario Rossi (individual)\nCounterparty: Bianchi S.r.l.\nMatter: Civil — contractual dispute\nCourt: Tribunale di Milano, Sezione III Civile\nRG: 1234/2025\nJudge: Dott. Bianchi\nCase value: €85,000\nPhase: First instance\nStatus: Active\nNext hearing: 15 March 2026",
      "",
      "## Case metadata\n[Fill in the details of your case]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Draft the case metadata sheet for a {matter} dispute between {client} and {counterparty}"',
      '- Ask the AI: "What information do I need to file a {type} claim in Italy?"',
      '- Ask the AI: "Summarise the current status of this case in 3 sentences"',
    ].join("\n"),
  },
  {
    title: "Facts and evidence",
    body: [
      "This document is the narrative of what happened: the factual background, the timeline of events, the evidence you have and the evidence you still need. Write it in chronological order. The AI uses this to draft pleadings and identify weaknesses.",
      "",
      "## Example",
      "Facts:\n- January 2025: Rossi签订 a supply contract with Bianchi S.r.l. for €85,000.\n- March 2025: First delivery is 3 weeks late and 40% of goods are defective.\n- April 2025: Rossi sends formal notice (diffida) requesting replacement within 15 days.\n- May 2025: Bianchi replaces only 60% of defective goods. Rossi withholds payment.\n- June 2025: Bianchi terminates the contract and files for payment.\n\nEvidence:\n- Contract signed 15 January 2025 (original available)\n- Delivery note 3 March 2025 (photos of defective goods)\n- Diffida sent 10 April 2025 (PEC receipt)\n- Email correspondence (exhibits D1-D8)\n\nEvidence still needed:\n- Expert assessment of defective goods\n- Bianchi's internal quality control records",
      "",
      "## Facts and evidence\n[Describe the factual background of your case]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Draft a chronological summary of the facts for {NOME_PRATICA}"',
      '- Ask the AI: "What evidence am I missing to support my claim?"',
      '- Ask the AI: "Identify the strongest and weakest points in my factual narrative"',
    ].join("\n"),
  },
  {
    title: "Law",
    body: [
      "This document lists the applicable legal provisions: code articles, regulations, case law, and legal principles that support your position. Organise by legal issue. The AI uses this to cite accurately in pleadings.",
      "",
      "## Example",
      "Applicable law:\n- Art. 1453 c.c. — Risoluzione del contratto per inadempimento\n- Art. 1454 c.c. — Diffida ad adempiere\n- Art. 1218 c.c. — Responsabilità del debitore per ritardo\n- Art. 1176 c.c. — Diligenza nell'adempimento\n\nKey case law:\n- Cass. civ. n. 12345/2024: Onere della prova dell'inadempimento grava sul creditore.\n- Cass. civ. n. 67890/2023: La diffida ex art. 1454 c.c. non richiede forma specifica.\n\nLegal argument:\nBianchi's late and partial delivery constitutes inadempimento ex art. 1453 c.c. The diffida was validly sent via PEC. Rossi's withholding of payment is justified under art. 1460 c.c. (eccezione di inadempimento).",
      "",
      "## Law\n[List the applicable code articles and case law]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Find case law on {MATERIA_PRATICA} from the last 3 years"',
      '- Ask the AI: "Cite the relevant Italian Civil Code articles for a breach of contract claim"',
      '- Ask the AI: "What is the legal standard for {legal issue} in Italian law?"',
    ].join("\n"),
  },
  {
    title: "Correspondence and filings",
    body: [
      "This document tracks all formal communications: letters, PECs, court filings, and their dates. Keep a chronological log. The AI uses this to draft new communications and track response deadlines.",
      "",
      "## Example",
      "10 January 2025 — Contract signed by both parties.\n15 March 2025 — Rossi notifies Bianchi of defective goods (PEC).\n10 April 2025 — Rossi sends diffida ad adempiere (PEC, receipt confirmed).\n25 April 2025 — Bianchi responds, acknowledges partial defect.\n15 May 2025 — Bianchi delivers replacement (partial).\n20 June 2025 — Bianchi files for payment (Tribunale di Milano, RG 1234/2025).\n1 July 2025 — Rossi files defence (memoria di costituzione).",
      "",
      "## Correspondence and filings\n[Log your formal communications and court filings]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Draft a PEC to {counterparty} regarding {NOME_PRATICA}"',
      '- Ask the AI: "What is the next filing deadline in {NOME_PRATICA}?"',
      '- Ask the AI: "Summarise all correspondence in this case chronologically"',
    ].join("\n"),
  },
  {
    title: "Strategic notes",
    body: [
      "This document is your private strategic workspace: risks, opportunities, settlement options, leverage points, and next steps. Write freely — this is not a court document.",
      "",
      "## Example",
      "Strengths:\n- Clear documentary evidence of late/defective delivery.\n- Diffida was validly served.\n- Bianchi's partial replacement weakens their position.\n\nWeaknesses:\n- Rossi's withholding of payment could be challenged as unreasonable if the defect was minor.\n- No independent expert report on the goods yet.\n\nSettlement options:\n- Accept 50% reduction in price + keep the goods as-is.\n- Bianchi delivers remaining replacement + €5,000 compensation for delay.\n\nLeverage:\n- Bianchi wants to keep Rossi as a long-term client.\n- Rossi prefers to avoid the reputational cost of litigation.\n\nNext steps:\n1. Commission expert report on defective goods.\n2. Evaluate settlement vs. proceeding to hearing.\n3. Prepare witnesses for cross-examination.",
      "",
      "## Strategic notes\n[Map your strategy, risks, and settlement options]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Analyse the strengths and weaknesses of my position in {NOME_PRATICA}"',
      '- Ask the AI: "Suggest 3 settlement options for {NOME_PRATICA}"',
      '- Ask the AI: "What leverage does my client have in this dispute?"',
    ].join("\n"),
  },
  {
    title: "Hearings calendar",
    body: [
      "This document tracks all upcoming and past hearings for this specific case. For a cross-case view, use the 'Cross-case deadlines' section.",
      "",
      "## Example",
      "Upcoming:\n- 15 March 2026, h 9:30 — First hearing (Trib. Milano, Sez. III Civ., courtroom 4)\n  Judge: Dott. Bianchi\n  Purpose: Admissions and evidence requests\n  Bring: Original contract, PEC receipts, photos of defective goods\n\nPast:\n- 10 November 2025 — Filing of defence (memoria di costituzione)\n- 1 July 2025 — Bianchi filed for payment",
      "",
      "## Hearings calendar\n[Track upcoming and past hearings for this case]",
      "",
      "## Suggested prompts",
      '- Ask the AI: "Prepare a hearing preparation checklist for {NOME_PRATICA}"',
      '- Ask the AI: "What should I expect at the first hearing in a civil case?"',
      '- Ask the AI: "Draft a summary of this case for the judge at the upcoming hearing"',
    ].join("\n"),
  },
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
      documents: clientBlockDocs,
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
