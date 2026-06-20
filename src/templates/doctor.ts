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
          "How to use Patient Cases",
          "Patient Cases is your private record of clinical encounters. Use one document per patient, with the patient anonymized ID (initials or code) as the title. Each case should capture: presenting complaint, history, examination, investigations, diagnosis, treatment plan, and follow-up. Link to relevant Conditions, Medications, and Tests as entities. Always respect patient confidentiality: this is a personal knowledge base, not a shared record.",
          "Patient Cases use the SOAP structure (Subjective, Objective, Assessment, Plan) as their backbone. The mnemonic OPQRST helps for symptom characterization; SAMPLE helps for history. Update the case on every follow-up visit. Archive it when treatment is complete or the patient is transferred.",
          "## My patient case workflow\n[How I name patients, how I update cases, when I archive them]\n\n> **Note**: visits/sessions can be dragged one below another to organize them chronologically — the most recent visit at the top, older visits below.",

          [
            "List all my active patients with {condition}",
            "Which of my patients are due for a follow-up this month?",
            "What medications is patient {ID} currently on?"
          ]
        ),
        docTutorial(
          "New patient case",
          "Use this template for a first consultation. Capture the SOAP structure: Subjective (patient's story, history), Objective (vitals, exam, investigations), Assessment (differential, working diagnosis), Plan (investigations, treatment, follow-up). Link the patient's conditions to the Conditions library. Use the OPQRST mnemonic for symptoms and SAMPLE for history.",
          "Patient: anonymized ID\nDate: 2026-06-20\nVisit type: New consultation\n\nS — Subjective:\nChief complaint (CC): \"I've been feeling tired for the last 3 months.\"\nHPI: 58-year-old male, gradual onset of fatigue, unintentional weight loss (5 kg in 3 months), mild polyuria. No chest pain, no dyspnea, sleep OK. No recent travel.\nPMH: hypertension (on amlodipine 5 mg), mild hyperlipidemia\nFH: father with T2DM, mother with hypothyroidism\nSH: former smoker (quit 8 years ago), social alcohol, office worker\nROS: positive for polyuria and weight loss; negative for chest pain, dyspnea, fever, night sweats, GI symptoms\n\nO — Objective:\nVitals: BP 138/86, HR 78, BMI 27.4, T 36.8°C\nExam: CVS/Resp/Abd normal, no lymphadenopathy, no goiter\n\nA — Assessment:\nFatigue + weight loss + polyuria in a 58yo male with family history of diabetes — high suspicion for new-onset T2DM.\nDifferential: hyperthyroidism, malignancy, anemia, depression.\n\nP — Plan:\n- Investigations: fasting glucose, HbA1c, TSH, CBC, CMP, urine dipstick\n- Re-evaluate in 1 week with results\n- Patient advised to keep a food/symptom diary\n- Linked entities: Condition (T2DM, suspected), Medication (amlodipine 5 mg)",
          "## Patient\n[Anonymized ID or initials only]\n\n> **Note**: visits/sessions can be dragged one below another to organize them chronologically — the most recent visit at the top, older visits below.\n\n## Date and visit type\n\n## S — Subjective\n### Chief complaint (CC)\n### HPI (with OPQRST or SOCRATES)\n### History (PMH, FH, SH, SAMPLE)\n### Review of Systems (ROS)\n\n## O — Objective\n### Vitals\n### Examination\n### Investigations done\n\n## A — Assessment\n### Working diagnosis\n### Differential diagnosis\n\n## P — Plan\n### Investigations ordered\n### Treatment initiated\n### Follow-up timing\n\n## Linked entities",
          [
            "Generate a structured SOAP note from these raw observations",
            "What is the differential diagnosis for {symptom} in a {age}-year-old {sex}?",
            "Suggest an evidence-based workup for {presenting complaint}"
          ]
        ),
        docTutorial(
          "Follow-up visit",
          "Use this template for any visit after the first one. Focus on: what changed since last visit, results of pending investigations, response to treatment, side effects, new issues. Keep it short — bullet points are fine. Update linked entities (medications, conditions) if anything changed.",
          "Patient: anonymized ID\nDate: 2026-06-27 (1-week follow-up)\n\nS — Subjective:\n- Fatigue improving, no further weight loss\n- Polyuria resolved\n- Tolerating food diary well\n- No side effects from medication changes\n\nO — Objective:\n- Vitals: BP 134/82, HR 76, weight stable\n\nA — Assessment:\nConfirmed new-onset Type 2 diabetes mellitus. Mild, no acute complications.\n\nP — Plan:\n- Start metformin 500 mg BID, titrate to 1000 mg BID over 2 weeks if tolerated\n- Lifestyle counseling: Mediterranean diet, 150 min/week moderate exercise\n- Refer to diabetes educator\n- Repeat HbA1c in 3 months\n- Annual: eye exam, foot exam, lipid panel, urinary albumin\n- Linked entities updated: Condition (T2DM, confirmed, active), Medication (metformin 500 mg BID, new)",
          "## Patient\n\n> **Note**: visits/sessions can be dragged one below another to organize them chronologically — the most recent visit at the top, older visits below.\n\n## Date and visit type\n\n## S — Subjective\n[Changes since last visit]\n\n## O — Objective\n[Vitals, focused exam, new investigations]\n\n## A — Assessment\n[Current status, any new diagnosis]\n\n## P — Plan\n[Medication changes, lifestyle, referrals, follow-up]\n\n## Linked entities updated",
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
          "How to use Conditions Library",
          "The Conditions Library is your personal reference of diseases, syndromes and clinical entities. Use one document per condition: definition, etiology, pathophysiology, typical presentation, diagnosis criteria, differential, treatment guidelines, key references. Update it as guidelines change. Link each Patient case to the relevant condition entity so you can find all your patients with condition X at a glance.",
          "One document per condition. Keep it scannable (bullets, not prose). Update when major guidelines change. Cite the guidelines (name, year, publisher) so you can find the source again.",
          "## My conditions library workflow\n[How I find conditions, how I update them, when I retire them]",
          [
            "List all my patients with {condition}",
            "What's the current first-line treatment for {condition} per the latest guidelines?",
            "Which of my conditions library entries are out of date?"
          ]
        ),
        docTutorial(
          "Condition entry",
          "A condition entry is a structured clinical reference. Include: definition, epidemiology, etiology, typical presentation, diagnosis criteria, differential, treatment (first-line, second-line), monitoring, red flags, key references. Use bullets, keep it scannable. Update when major guidelines change.",
          "Condition: Type 2 Diabetes Mellitus (T2DM)\n\nDefinition:\nChronic metabolic disorder characterized by insulin resistance and relative insulin deficiency, leading to hyperglycemia.\n\nEpidemiology:\nAffects ~10% of adults globally; rising with obesity and aging.\n\nEtiology and pathophysiology:\nMultifactorial: genetic predisposition + lifestyle (obesity, sedentary) + age.\n\nTypical presentation:\n- Often asymptomatic\n- Classic triad: polyuria, polydipsia, weight loss\n- Fatigue, blurred vision, recurrent infections\n\nDiagnosis:\n- Fasting glucose ≥ 126 mg/dL, OR\n- HbA1c ≥ 6.5%, OR\n- 2h OGTT ≥ 200 mg/dL, OR\n- Random glucose ≥ 200 mg/dL with symptoms\n\nDifferential diagnosis:\n- Type 1 diabetes\n- Secondary diabetes (drug-induced, pancreatic disease)\n- Stress hyperglycemia\n\nTreatment:\n- First-line: lifestyle + metformin 500-1000 mg BID (if eGFR > 30)\n- Second-line: add GLP-1 RA or SGLT2i if cardiovascular/renal comorbidities\n- Special populations: elderly, pregnancy, CKD\n\nMonitoring:\n- HbA1c every 3-6 months (target < 7% for most)\n- Annual: eye exam, foot exam, lipid panel, urinary albumin\n\nRed flags:\n- DKA or HHS (acute decompensation)\n- Persistent hyperglycemia despite therapy\n- New foot ulcer or vision changes\n\nKey references:\n- ADA Standards of Care 2026\n- ESC Guidelines on Diabetes 2025",
          "## Definition\n[One-sentence clinical definition]\n\n## Epidemiology\n[Prevalence, risk groups]\n\n## Etiology and pathophysiology\n\n## Typical presentation\n\n## Diagnosis\n[Diagnostic criteria, investigations]\n\n## Differential diagnosis\n\n## Treatment\n- First-line\n- Second-line\n- Special populations\n\n## Monitoring\n\n## Red flags\n[When to escalate, urgent referral]\n\n## Key references\n[Guidelines, seminal papers]",
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
          "How to use Treatment Plans",
          "Treatment Plans is where you design and document structured therapeutic protocols, both for individual complex patients and for reusable plans (e.g. a standard protocol for newly diagnosed hypertensive patients). One document per plan: patient (if individual), goal, intervention, timeline, monitoring criteria, escalation criteria. Plans that work well can be turned into reusable templates for future patients.",
          "Make the goal specific and measurable. Include explicit escalation criteria (when to add a second drug, when to refer, when to hospitalize). Plans without escalation criteria are wish lists, not plans.",
          "## My treatment plan workflow\n[How I draft plans, when I escalate, when I retire them]",
          [
            "Generate a treatment plan for {condition} in a {age}-year-old with {comorbidities}",
            "What are the escalation criteria for {treatment}?",
            "Which of my treatment plans are out of date per the current guidelines?"
          ]
        ),
        docTutorial(
          "Treatment plan",
          "A treatment plan is a structured roadmap: what you are trying to achieve, what you are going to do, how you will know if it's working, and when to change course. The goal should be specific and measurable. The plan should include explicit escalation criteria (when to add a second drug, when to refer, when to hospitalize).",
          "Patient: anonymized ID (or 'Standard protocol')\nGoal: HbA1c < 7% within 6 months, no hypoglycemia, no weight gain\n\nIntervention:\n- Lifestyle: Mediterranean diet, 150 min/week moderate aerobic exercise, target 5-7% weight loss\n- Pharmacotherapy:\n  - Start metformin 500 mg BID, titrate to 1000 mg BID over 2 weeks if tolerated\n  - Re-evaluate HbA1c in 3 months\n- Referrals: diabetes educator within 4 weeks, dietitian within 6 weeks\n\nMonitoring:\n- Self-monitored blood glucose (SMBG) fasting + 2h post-meal, 3 days/week\n- HbA1c at 3 months, then every 6 months if at goal\n- BP at every visit (target < 130/80)\n- Annual: eye exam, foot exam, urinary albumin/creatinine ratio, lipid panel\n\nEscalation criteria:\n- HbA1c > 7% at 3 months despite adherence → add second agent (GLP-1 RA preferred given weight benefit)\n- HbA1c > 9% at any point → consider insulin\n- Any hypoglycemia episode (BG < 70) → reassess dose\n- eGFR drop > 30% → discontinue metformin\n- New foot ulcer, vision change, or persistent symptoms → urgent referral\n\nFollow-up schedule: 1 week, 1 month, 3 months, then every 6 months",
          "## Patient (or 'Standard protocol')\n\n## Goal\n[Specific, measurable, time-bounded]\n\n## Intervention\n- Lifestyle\n- Pharmacotherapy (drug, dose, titration)\n- Referrals\n- Procedures\n\n## Monitoring\n[What to check, how often, target values]\n\n## Escalation criteria\n[When to add, change, refer, hospitalize]\n\n## Follow-up schedule",
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
          "How to use Research",
          "Research is for clinical questions you're investigating in depth: a controversial guideline, a new drug, an unusual case, a quality improvement project. Each document is a research log: the question, what you've read, what you've found, what you still don't know. Use it to track your learning over months, and to build toward publications, presentations or simply better patient care.",
          "One document per research question. Date each entry. Capture: source, key claim, evidence, method, limitations, how you might use it. Build toward a synthesis.",
          "## My clinical research workflow\n[How I find papers, how I read, how I synthesize]\n\n> **Note**: research log entries can be dragged one below another to keep them in chronological order — newest at the top, older entries below.",

          [
            "Summarize what I've learned so far about {research question}",
            "What are the main controversies in the current evidence on {topic}?",
            "What is the highest-quality recent trial on {topic}?"
          ]
        ),
        docTutorial(
          "Research log",
          "A research log is a working document. Date each entry. The structure: the question, what you read or did, what you found, what you still don't know. The log evolves over weeks or months. At the end, synthesize it into a final answer (for yourself, a presentation, or a publication).",
          "Question: Are SGLT2 inhibitors beneficial in heart failure with preserved ejection fraction (HFpEF)?\nStarted: 2026-04-15\n\n## 2026-04-15\nRead: EMPEROR-Preserved (Anker et al., NEJM 2021)\nFound: Empagliflozin reduced CV death or HHF vs placebo in HFpEF (HR 0.79). NNT ~30 over 26 months. Benefit consistent across diabetes status.\nOpen: Long-term safety, real-world effectiveness in elderly, cost-effectiveness in my practice setting.\n\n## 2026-04-30\nRead: DELIVER trial (Solomon et al., NEJM 2022)\nFound: Dapagliflozin reduced CV death or HHF vs placebo in HFpEF (HR 0.82). Similar magnitude to EMPEROR-Preserved.\nOpen: Are effects class-effect or molecule-specific?\n\n## 2026-05-20\nRead: Meta-analysis — SGLT2i in HFpEF (Nassif et al., Lancet 2023)\nFound: Pooled analysis of 5 trials, n=10,000. SGLT2i reduced HHF by ~25%, CV death by ~10%. Effect consistent across EF subgroups.\n\n## 2026-06-10\nClinical implementation:\nStarted SGLT2i in 2 HFpEF patients without diabetes. Both tolerated well, one reported improved exercise tolerance at 4 weeks.\n\nSynthesis (draft):\nSGLT2i (empagliflozin, dapagliflozin) are effective and safe in HFpEF regardless of diabetes status. Class effect plausible. Reasonable to offer to all HFpEF patients without contraindication. Local cost remains a barrier in some settings.",
          "## Question\n[What you're trying to find out]\n\n## Started\n[Date]\n\n## Entries\n### [date]\n**Read:** [source]\n**Found:** [what you learned]\n**Open:** [what you still don't know]\n\n## Synthesis (draft)\n[Your current best answer to the question, with caveats]",
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
          "How to use CME / Education",
          "CME / Education is for tracking your continuing medical education: conferences, courses, journal clubs, podcasts, papers read. Use one document per event or per topic. Capture: what you learned, what you'll change in your practice, the citation. This is also where you document your annual CME credits, board certifications, and learning goals.",
          "One document per event or topic. The value of CME is in the implementation, not the attendance certificate. Always capture 'what I will change in my practice' — this is the most useful section.",
          "## My CME tracking workflow\n[How I log events, how I review, how I track credits]",
          [
            "List all CME activities completed this year",
            "What were the 3 most practice-changing insights from my CME this year?",
            "What learning goals have I set for next year and which have I met?"
          ]
        ),
        docTutorial(
          "CME entry",
          "A CME entry documents a learning event: conference, course, podcast, paper, journal club. Capture: the source, date, key learnings, and most importantly what you will change in your practice.",
          "Event: ESC Congress 2026 — Heart Failure Track\nDate: 2026-05-15\nFormat: Conference, 3-day, Amsterdam\nCredits: 18 CME\n\nKey learnings:\n1. SGLT2i are now first-line for HFpEF regardless of diabetes status\n2. New biomarker-based risk stratification (NT-proBNP guided therapy) reduces HHF\n3. Updated ESC guidelines on cardiac amyloidosis — diagnosis algorithm simplified\n\nWhat I will change in my practice:\n- Start SGLT2i in HFpEF patients without diabetes (currently only doing it in diabetics)\n- Use NT-proBNP-guided therapy titration in my HFrEF patients\n- Review my last 5 amyloidosis referrals for missed diagnoses\n\nResources to follow up on:\n- ESC 2026 guidelines PDF (link)\n- 'Amyloidosis for the internist' — review in NEJM 2026\n\nLinked entities:\n- Condition: HFpEF\n- Condition: cardiac amyloidosis → new entry in Conditions Library",
          "## Event\n[Name, format, date, location, credits]\n\n## Key learnings\n1. \n2. \n3. \n\n## What I will change in my practice\n[Specific, actionable]\n\n## Resources to follow up on\n[Links, papers, contacts]\n\n## Linked entities",
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
          "## My archive policy\n[When you archive, how often you review the archive, when you delete permanently]",
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
        { name: "anonymized_id", type: "text", required: true, note: "Anonymized ID or initials only — never full identifying data" },
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
        { name: "icd_code", type: "text", note: "ICD-10 or ICD-11 code" },
        { name: "status", type: "enum", enum_values: ["active", "chronic", "resolved", "suspected"] },
        { name: "onset_date", type: "date" },
        { name: "notes", type: "text" },
      ],
    },
    {
      name: "Medication",
      icon: "💊",
      color: "#9B59B6",
      fields: [
        { name: "generic_name", type: "text", required: true, note: "Generic name preferred" },
        { name: "dosage", type: "text", note: "e.g. 500 mg BID" },
        { name: "indication", type: "text", note: "What condition this is for" },
        { name: "start_date", type: "date" },
        { name: "end_date", type: "date" },
      ],
    },
    {
      name: "Allergy",
      icon: "⚠️",
      color: "#C0392B",
      fields: [
        { name: "allergen", type: "text", required: true, note: "Allergen, drug, or substance" },
        { name: "reaction", type: "text", note: "What happens on exposure" },
        { name: "severity", type: "enum", enum_values: ["mild", "moderate", "severe", "anaphylaxis"] },
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
        { name: "name", type: "text", required: true, note: "e.g. ADA Standards of Care 2026" },
        { name: "publisher", type: "text", note: "Society or organization" },
        { name: "year", type: "number" },
        { name: "url", type: "text" },
        { name: "key_recommendations", type: "text" },
      ],
    },
    {
      name: "Reference",
      icon: "📖",
      color: "#F5A623",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "author", type: "text" },
        { name: "year", type: "number" },
        { name: "type", type: "enum", enum_values: ["article", "paper", "book", "web", "other"] },
        { name: "url", type: "text" },
      ],
    },
    {
      name: "Person",
      icon: "👤",
      color: "#8E44AD",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "enum", enum_values: ["colleague", "consultant", "expert", "researcher", "other"] },
        { name: "affiliation", type: "text" },
        { name: "contact", type: "text" },
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
    chat: "You are an assistant for a physician building a personal clinical knowledge base. Help the user summarize patient cases, organize conditions and treatment plans, find connections between clinical entities, extract medications and test results from documents, and answer clinical questions using the content of their notes. Always cite the specific document and section you are drawing from. Always remind the user that this is a personal knowledge management tool, not a medical record system, and not a substitute for clinical judgment, current guidelines, or formal medical references. Do not invent facts or sources — if you don't know, say so.",
  },
};
