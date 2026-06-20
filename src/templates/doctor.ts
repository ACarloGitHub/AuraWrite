import type { Template } from "./_types";

// Helper: document-level tutorial (explanation + example + writable header + prompts)
const docTutorial = (title: string, explanation: string, example: string, writableHeader: string, prompts: string[]) => ({
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

export const doctorTemplate: Template = {
  type: "doctor",
  displayName: "Doctor",
  icon: "🩺",
  description: "Clinical knowledge base for physicians: patient cases, conditions library, treatment plans, clinical research, continuing medical education. Always respect patient confidentiality: this is a personal knowledge base, not a medical record system.",
  requiresStyleChoice: false,

  // ========================================================================
  // SECTIONS — sections are containers only, no text/tutorial on them
  // ========================================================================
  sections: [
    // ------------------------------------------------------------------------
    // INBOX
    // ------------------------------------------------------------------------
    {
      name: "Inbox",
      documents: [
        docTutorial(
          "How to use the Inbox",
          "The Inbox is a capture-first space for clinical observations, questions from patients, ideas for research, snippets from papers, and any clinical thought that arrives faster than you can file it. Do not include identifiable patient data here — for that, use Patient Cases. Review the Inbox weekly and move notes to Patient Cases, Conditions Library, Research or CME. The goal is to empty the Inbox regularly.",
          "A clinical question from a colleague, a snippet from a paper, an idea for a new treatment protocol, a drug interaction to verify, a teaching case worth documenting.",
          "## How I use my Inbox\n[Your weekly review process, with anonymization rules]",
          [
            "Group these Inbox notes by category (clinical, research, education) and suggest a structure for each",
            "Which of these Inbox notes should become Patient cases vs Conditions library entries?",
            "Extract any clinical questions worth researching further"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // PATIENT CASES
    // ------------------------------------------------------------------------
    {
      name: "Patient Cases",
      documents: [
        docTutorial(
          "New patient case",
          "Use this template for a first consultation. Capture the presenting complaint, relevant history, examination findings, initial assessment and plan. Investigations and treatment go in subsequent visits. Link the patient's conditions to the Conditions library. Always respect patient confidentiality: this is a personal knowledge base, not a shared record.",
          "Patient: anonymized ID or initials\nDate: 2026-06-20\nVisit type: New consultation\n\nPresenting complaint:\n[Why the patient came, in their own words]\n\nHistory:\n- PMH (past medical history)\n- FH (family history)\n- SH (social history: smoking, alcohol, occupation)\n- ROS (review of systems)\n\nExamination:\n- Vitals (BP, HR, BMI, temperature)\n- System-by-system findings\n\nInitial assessment:\n[Differential diagnosis, working hypothesis]\n\nPlan:\n- Investigations ordered\n- Treatment initiated\n- Follow-up timing\n\nLinked entities:\n- Conditions:\n- Medications:",
          "## Patient\n[Anonymized ID or initials — never full identifying data]\n\n## Date and visit type\n\n## Presenting complaint\n[In patient's own words]\n\n## History\n- PMH\n- FH\n- SH\n- ROS\n\n## Examination\n- Vitals\n- System-by-system\n\n## Initial assessment\n[Differential, working hypothesis]\n\n## Plan\n- Investigations\n- Treatment\n- Follow-up",
          [
            "Generate a structured SOAP note from these raw observations",
            "What is the differential diagnosis for {symptom} in a {age}-year-old {sex}?",
            "Suggest an evidence-based workup for {presenting complaint}"
          ]
        ),
        docTutorial(
          "Follow-up visit",
          "Use this template for any visit after the first one. Focus on: what changed since last visit, results of pending investigations, response to treatment, side effects, new issues. Keep it short — bullet points are fine. Update linked entities (medications, conditions) if anything changed.",
          "Patient: anonymized ID\nDate: 2026-06-27 (1-week follow-up)\n\nSince last visit:\n[What changed: symptoms, adherence, side effects]\n\nInvestigations and results:\n[Pending results now available]\n\nAssessment:\n[Current status, any new diagnosis]\n\nPlan:\n- Medication changes\n- Lifestyle advice\n- Referrals\n- Follow-up timing\n\nLinked entities updated:",
          "## Patient\n\n## Date and visit type\n\n## Since last visit\n\n## Investigations and results\n\n## Assessment\n\n## Plan\n\n## Linked entities updated",
          [
            "Summarize the trajectory of patient {ID} over the last 3 visits",
            "Based on these results, what is the most appropriate next step?",
            "Generate a patient-friendly summary of today's visit"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // CONDITIONS LIBRARY
    // ------------------------------------------------------------------------
    {
      name: "Conditions Library",
      documents: [
        docTutorial(
          "Condition entry",
          "A condition entry is a structured clinical reference. Include: definition, epidemiology, etiology, typical presentation, diagnosis criteria, differential, treatment (first-line, second-line), monitoring, red flags, key references. Use bullets, keep it scannable. Update when major guidelines change. Link each Patient case to the relevant condition entity so you can find all your patients with condition X at a glance.",
          "Condition: [name]\n\nDefinition:\n[One-sentence clinical definition]\n\nEpidemiology:\n[Prevalence, risk groups]\n\nEtiology and pathophysiology:\n[Cause and mechanism]\n\nTypical presentation:\n[Symptoms, signs, common patterns]\n\nDiagnosis:\n[Diagnostic criteria, investigations]\n\nDifferential diagnosis:\n[What else to consider]\n\nTreatment:\n- First-line\n- Second-line\n- Special populations\n\nMonitoring:\n[What to check, how often]\n\nRed flags:\n[When to escalate, urgent referral]\n\nKey references:\n[Guidelines, seminal papers]",
          "## Definition\n\n## Epidemiology\n\n## Etiology and pathophysiology\n\n## Typical presentation\n\n## Diagnosis\n\n## Differential diagnosis\n\n## Treatment\n- First-line\n- Second-line\n- Special populations\n\n## Monitoring\n\n## Red flags\n\n## Key references",
          [
            "Summarize the current first-line treatment for {condition}",
            "What is the most up-to-date diagnostic criteria for {condition}?",
            "What are the most important red flags not to miss in {condition}?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // TREATMENT PLANS
    // ------------------------------------------------------------------------
    {
      name: "Treatment Plans",
      documents: [
        docTutorial(
          "Treatment plan",
          "A treatment plan is a structured roadmap: what you are trying to achieve, what you are going to do, how you will know if it is working, and when to change course. The goal should be specific and measurable. The plan should include explicit escalation criteria (when to add a second drug, when to refer, when to hospitalize). Plans that work well can be turned into reusable templates for future patients.",
          "Patient: anonymized ID (or 'Standard protocol')\nGoal: [Specific, measurable, time-bounded]\n\nIntervention:\n- Lifestyle\n- Pharmacotherapy (drug, dose, titration)\n- Referrals\n- Procedures\n\nMonitoring:\n[What to check, how often, target values]\n\nEscalation criteria:\n[When to add, change, refer, hospitalize]\n\nFollow-up schedule:",
          "## Patient (or 'Standard protocol')\n\n## Goal\n\n## Intervention\n- Lifestyle\n- Pharmacotherapy\n- Referrals\n- Procedures\n\n## Monitoring\n\n## Escalation criteria\n\n## Follow-up schedule",
          [
            "Review this plan and suggest evidence-based improvements",
            "What is the typical time to see results from {treatment}?",
            "Generate a patient-friendly version of this plan"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // RESEARCH
    // ------------------------------------------------------------------------
    {
      name: "Research",
      documents: [
        docTutorial(
          "Research log",
          "A research log is a working document, not a finished report. Date each entry. The structure: the question, what you read or did, what you found, what you still don't know. The log evolves over weeks or months. At the end, synthesize it into a final answer (for yourself, a presentation, or a publication).",
          "Question: [What you're trying to find out]\nStarted: [date]\n\n## [date]\nRead: [source]\nFound: [what you learned]\nOpen: [what you still don't know]\n\n## [date]\nRead: [source]\nFound: [what you learned]\nOpen: [what you still don't know]\n\n## Synthesis (draft):\n[Your current best answer to the question, with caveats]",
          "## Question\n\n## Started\n\n## Entries\n### [date]\n**Read:** [source]\n**Found:** [what you learned]\n**Open:** [what you still don't know]\n\n### [date]\n...\n\n## Synthesis (draft)",
          [
            "Summarize the current state of evidence on {question}",
            "What are the methodological strengths and weaknesses of the key trials?",
            "Generate a 200-word synthesis suitable for a journal club presentation"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // CME / EDUCATION
    // ------------------------------------------------------------------------
    {
      name: "CME / Education",
      documents: [
        docTutorial(
          "CME entry",
          "A CME entry documents a learning event: conference, course, podcast, paper, journal club. Capture: the source, date, key learnings, and most importantly what you will change in your practice. The value of CME is in the implementation, not the attendance certificate.",
          "Event: [name, format, date, location, credits]\n\nKey learnings:\n1. \n2. \n3. \n\nWhat I will change in my practice:\n[Specific, actionable]\n\nResources to follow up on:\n[Links, papers, contacts]\n\nLinked entities:",
          "## Event\n\n## Key learnings\n1. \n2. \n3. \n\n## What I will change in my practice\n\n## Resources to follow up on\n\n## Linked entities",
          [
            "Summarize the most practice-changing insights from my CME this year",
            "What learning goals have I met and which are still open?",
            "Suggest CME opportunities aligned with my weak areas: {topic}"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // ARCHIVE
    // ------------------------------------------------------------------------
    {
      name: "Archive",
      documents: [
        docTutorial(
          "How to use the Archive",
          "Archive is for closed patient cases, completed research projects, and outdated treatment plans. Move a case to the Archive when treatment is complete and the patient is discharged from active follow-up. Move a research project to the Archive when the question is answered. Archived cases are searchable but out of the way. Always respect confidentiality: archived patient data must be stored with the same security as active cases.",
          "Move notes here when:\n- A patient case is closed (treatment complete, patient transferred, or deceased)\n- A research project is completed\n- A treatment plan is no longer current\n- A CME event is more than 2 years old",
          "## My archive policy\n[When you archive, how often you review, retention policy]",
          [
            "Find any archived patient case with {condition}",
            "What research projects did I complete in {year}?",
            "Which archived treatment plans might need updating to current guidelines?"
          ]
        ),
      ],
    },
  ],

  // ========================================================================
  // ENTITY TYPES
  // ========================================================================
  entityTypes: [
    {
      name: "Patient",
      icon: "🧑‍⚕️",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true, note: "Anonymized ID or initials only — never full identifying data" },
        { name: "age", type: "number" },
        { name: "gender", type: "enum", enum_values: ["male", "female", "other"] },
        { name: "main_condition", type: "text", note: "Primary diagnosis or reason for follow-up" },
        { name: "last_visit", type: "date" },
      ],
    },
    {
      name: "Condition",
      icon: "🦠",
      color: "#E74C3C",
      fields: [
        { name: "name", type: "text", required: true, note: "Disease, syndrome, or clinical entity" },
        { name: "status", type: "enum", enum_values: ["active", "chronic", "resolved", "suspected"] },
        { name: "icd_code", type: "text", note: "ICD-10 or ICD-11 code" },
        { name: "onset_date", type: "date" },
        { name: "notes", type: "text" },
      ],
    },
    {
      name: "Medication",
      icon: "💊",
      color: "#9B59B6",
      fields: [
        { name: "name", type: "text", required: true, note: "Generic name preferred" },
        { name: "dosage", type: "text", note: "e.g. 500 mg BID" },
        { name: "indication", type: "text", note: "What condition this is for" },
        { name: "start_date", type: "date" },
        { name: "end_date", type: "date" },
      ],
    },
    {
      name: "Symptom",
      icon: "🤒",
      color: "#E67E22",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "body_system", type: "enum", enum_values: ["cardiovascular", "respiratory", "gastrointestinal", "neurological", "musculoskeletal", "dermatological", "endocrine", "genitourinary", "psychiatric", "general", "other"] },
        { name: "severity", type: "enum", enum_values: ["mild", "moderate", "severe"] },
        { name: "duration", type: "text" },
      ],
    },
    {
      name: "Allergy",
      icon: "⚠️",
      color: "#C0392B",
      fields: [
        { name: "name", type: "text", required: true, note: "Allergen, drug, or substance" },
        { name: "reaction", type: "text", note: "What happens on exposure" },
        { name: "severity", type: "enum", enum_values: ["mild", "moderate", "severe", "anaphylaxis"] },
      ],
    },
    {
      name: "Test",
      icon: "🔬",
      color: "#1ABC9C",
      fields: [
        { name: "name", type: "text", required: true, note: "Lab test, imaging study, or procedure" },
        { name: "date", type: "date" },
        { name: "result", type: "text", note: "Numeric value or qualitative result" },
        { name: "interpretation", type: "enum", enum_values: ["normal", "abnormal", "borderline", "pending"] },
      ],
    },
    {
      name: "Procedure",
      icon: "🩻",
      color: "#16A085",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "date", type: "date" },
        { name: "indication", type: "text" },
        { name: "outcome", type: "text" },
      ],
    },
    {
      name: "Guideline",
      icon: "📜",
      color: "#34495E",
      fields: [
        { name: "name", type: "text", required: true, note: "e.g. guidelines 2026" },
        { name: "publisher", type: "text", note: "Society or organization" },
        { name: "year", type: "number" },
        { name: "url", type: "text" },
        { name: "key_recommendations", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (none — clinical notes don't have a writing style)
  // ========================================================================
  styles: [],
  defaultStyleName: null,

  // ========================================================================
  // PROMPTS (with patient confidentiality disclaimer)
  // ========================================================================
  prompts: {
    suggestions: "You are a clinical knowledge assistant for a physician. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that help the user document clinical encounters clearly, organize medical knowledge, or connect this note to relevant conditions, medications and guidelines. Always remind the user that this is a personal knowledge base and does not replace clinical judgment or formal medical records.",
    chat: "You are an assistant for a physician building a personal clinical knowledge base. Help the user summarize patient cases, organize conditions and treatment plans, find connections between clinical entities, extract medications and test results from documents, and answer clinical questions using the content of their notes. Always cite the specific document and section you are drawing from. Always remind the user that this is a personal knowledge management tool, not a medical record system, and not a substitute for clinical judgment, current guidelines, or formal medical references.",
  },
};
