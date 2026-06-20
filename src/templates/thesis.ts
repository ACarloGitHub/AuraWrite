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

export const thesisTemplate: Template = {
  type: "thesis",
  displayName: "Thesis",
  icon: "🎓",
  description: "Academic thesis (bachelor, master, PhD, compilation). Includes proposal, literature review, methodology, findings, drafts and revisions, and defense preparation.",
  requiresStyleChoice: true,

  // ========================================================================
  // SECTIONS — sections are containers only, no text/tutorial on them
  // ========================================================================
  sections: [
    // ------------------------------------------------------------------------
    // PROPOSAL
    // ------------------------------------------------------------------------
    {
      name: "Proposal",
      documents: [
        docTutorial(
          "How to use Proposal",
          "The proposal is your contract with your supervisor and committee. It commits you to a question, a scope, a method and a timeline. A good proposal is specific enough that you can write a thesis from it, and modest enough that you can finish. Write the proposal before you do the work, then update it as the work teaches you things. The proposal is also the document most supervisors and committees use to assess whether the project is feasible.",
          "Working title: 'The effect of sleep deprivation on declarative memory in knowledge workers'\n\nResearch questions:\n1. How does 24h sleep deprivation affect recall of recently learned material?\n2. Does the effect differ for declarative vs procedural memory?\n3. Are individual differences (age, baseline sleep) predictive of impact?\n\nMethodology overview: randomized controlled trial, n=60, pre/post test design.\n\nScope: knowledge workers aged 25-45, no sleep disorders.\n\nTimeline: 6 months data collection, 3 months analysis, 3 months writing.\n\nSignificance: most sleep research is on students, not knowledge workers; this could inform workplace policy.",
          "## Working title\n[Title, not yet final]\n\n## Research questions\n1. \n2. \n3. \n\n## Methodology overview\n[Design, participants, data, analysis — one paragraph each]\n\n## Scope and limitations\n[What's in, what's out, why]\n\n## Timeline\n[Milestones, dates]\n\n## Significance\n[Why this matters, who it matters to]",
          [
            "Stress-test my proposal: what would a skeptical committee member say?",
            "Is my research question too ambitious for the timeline?",
            "Identify the single weakest claim in this proposal"
          ]
        ),
        docTutorial(
          "Thesis proposal template",
          "Use this template to write a 5-10 page proposal in under a week. The structure: title, research questions, brief literature context, methodology, scope, timeline, significance. Resist the urge to write a literature review here — the proposal is the plan, not the work. Save the review for the next section.",
          "Title: 'The effect of sleep deprivation on declarative memory in knowledge workers'\n\nQuestions: 3 specific questions (see Proposal doc for full text).\n\nContext: 3-5 sentences on what is already known and what this study adds.\n\nMethod: RCT, n=60, 24h sleep deprivation protocol, pre/post test on word-list recall and skill task.\n\nScope: knowledge workers 25-45, no sleep disorders, single-site study.\n\nTimeline: month 1 ethics, 2-7 data, 8-10 analysis, 11-13 writing.\n\nSignificance: most sleep research is on students; this is the first RCT on knowledge workers specifically.",
          "## Title\n\n## Research questions\n\n## Context (3-5 sentences)\n\n## Method (1 paragraph)\n\n## Scope\n\n## Timeline\n\n## Significance",
          [
            "Generate 3 alternative titles for this proposal",
            "Are my research questions answerable with the proposed method?",
            "What's the single biggest risk to this project, and how can I mitigate it?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // LITERATURE REVIEW
    // ------------------------------------------------------------------------
    {
      name: "Literature Review",
      documents: [
        docTutorial(
          "How to use Literature Review",
          "The literature review is not an annotated bibliography. It is a critical synthesis: what is known, what is debated, what is missing. Organize by theme or argument, not by author or date. Each Source you read should connect to the argument you are building. The review ends with your research questions: here is what we know, here is what we don't, my study will address the gap.",
          "By theme (preferred):\n- Theme 1: Sleep and declarative memory — Walker (2009), Cartwright (2010), Mednick (2003) converge on REM's role; diverge on the mechanism.\n- Theme 2: Sleep deprivation in occupational settings — most studies on shift workers and medical residents; very few on knowledge workers.\n- Theme 3: Individual differences in sleep need — Van Dongen (2003) shows large stable differences; ignored in most lab studies.\n\nGap: no RCT on knowledge workers specifically. My study will address this.",
          "## My literature review workflow\n[How I find sources, how I organize, when I stop reading and start writing]",
          [
            "Which Sources are most relevant to my research questions?",
            "Find the strongest counter-argument in the literature to my hypothesis",
            "Identify the gap my research is filling"
          ]
        ),
        docTutorial(
          "Source synthesis template",
          "One document per source. The goal is not to summarize — it is to make the source usable in your argument. Capture: the claim, the evidence, the method, the limitations, and most importantly, how this source connects to your thesis. The best source cards are short and argumentative: they tell you what role the source plays in your story.",
          "Source: Walker, M. (2009). 'Sleep and memory: an overview'. Annual Review of Psychology.\n\nClaim: Sleep, especially REM and slow-wave, plays a critical role in memory consolidation.\n\nEvidence: review of 40+ studies on declarative and procedural memory, plus original neuroimaging data.\n\nMethod: narrative review, not original research.\n\nLimitations: covers only healthy adults; doesn't address individual differences; pre-2010 studies only.\n\nHow I use it: foundational claim for my hypothesis. Cited in Intro and Lit Review Theme 1.\n\nRelationship to other sources: converges with Cartwright (2010) on REM, diverges from Mednick (2003) on naps.",
          "## Citation\n\n## Claim\n[One sentence: what is this source arguing?]\n\n## Evidence\n[What does the source use to support the claim?]\n\n## Method\n[How was the claim tested?]\n\n## Limitations\n[What is this source weak on?]\n\n## How I use it\n[Where in my thesis, what role]\n\n## Relationship to other sources\n[Converges / diverges / extends / contradicts]",
          [
            "Compare this source to my other Sources on {topic}",
            "Where does this source fit in my Lit Review structure?",
            "Is this source still credible in light of more recent work?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // METHODOLOGY
    // ------------------------------------------------------------------------
    {
      name: "Methodology",
      documents: [
        docTutorial(
          "How to use Methodology",
          "The methodology chapter is the part of the thesis your committee will read most carefully. The question is not 'what did I do?' but 'is what I did a valid way to answer my research questions?'. Cover: research design, participants, materials, procedure, data collection, analysis plan, ethical considerations, limitations. Be specific enough that another researcher could replicate the study from your description.",
          "Design: randomized controlled trial, between-subjects.\nParticipants: n=60 knowledge workers, 25-45, recruited via Prolific, screened for sleep disorders.\nMaterials: pre/post test (word-list recall, skill task), 7-day sleep diary, actigraphy, demographic questionnaire.\nProcedure: baseline week, sleep manipulation (24h wakefulness in lab), immediate test, 48h recovery test.\nAnalysis: mixed-effects models, planned contrasts on condition × time.\nEthics: IRB approval, informed consent, right to withdraw, debriefing.\nLimitations: single-site, lab-based (not ecological), short-term effect only.",
          "## My methodology overview\n[Design, participants, materials, procedure, analysis, ethics, limitations — high level]",
          [
            "Is my research design appropriate for my research questions?",
            "What are the threats to internal validity I haven't addressed?",
            "Is my sample size justified?"
          ]
        ),
        docTutorial(
          "Method card template",
          "One document per method (RCT, interview, survey, ethnography, archival analysis, etc.). The method card is your defense against the 'but is this valid?' question. Cover: what the method is, why you chose it, how you applied it, what its limits are in your specific case. Most methodology disputes are about the choice of method, not the execution — anticipate the choice before your committee asks.",
          "Method: Randomized Controlled Trial (RCT)\n\nWhat it is: between-subjects experiment with random assignment to condition (sleep-deprived vs control).\n\nWhy this method: best internal validity for causal claims about sleep deprivation's effect on memory. Quasi-experiments and correlational studies cannot rule out confounds.\n\nHow I applied it: 30 participants per condition, lab-based, single 24h protocol, double-blind (researchers running tests blinded to condition).\n\nLimits in my case: lab setting reduces ecological validity, 24h is acute not chronic, sample is homogeneous (knowledge workers are WEIRD), single-site.\n\nAlternatives I considered: within-subjects crossover (rejected: carryover effects), field study (rejected: cannot control sleep), diary study (rejected: cannot test causal mechanism).",
          "## Method name\n\n## What it is\n\n## Why this method\n[Justify the choice]\n\n## How I applied it\n[Specifics]\n\n## Limits in my case\n[Be honest]\n\n## Alternatives I considered\n[And why I rejected them]",
          [
            "Compare this method to alternatives for my research question",
            "What are the most common objections to this method, and how do I address them?",
            "Is my use of this method defensible to a skeptical committee?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // FINDINGS & ANALYSIS
    // ------------------------------------------------------------------------
    {
      name: "Findings & Analysis",
      documents: [
        docTutorial(
          "How to use Findings & Analysis",
          "Findings are the raw results; analysis is what they mean. Keep them visually separated: Findings chapter (what you found) is mostly tables, figures, descriptive statistics. Discussion chapter (what it means) is argument, comparison with literature, implications. One Finding entity per result; the doc-tutorial organizes them by research question. Resist the urge to interpret in the Findings chapter — that's the Discussion's job.",
          "Findings by research question:\n\nRQ1: 24h sleep deprivation reduced word-list recall by 38% (d=1.2, p<.001). Effect robust across age and sex.\n\nRQ2: Declarative memory was impaired; procedural memory was not (no significant difference in skill task).\n\nRQ3: Individual differences in baseline sleep need (actigraphy) moderated the effect: short sleepers (n=18) showed 25% impairment, long sleepers (n=42) showed 45% impairment.\n\nUnanticipated finding: cortisol levels at the post-test were 2.3x higher in the sleep-deprived group, suggesting a stress mechanism not in our original model.",
          "## My findings overview\n[Summary of what I found, by research question]",
          [
            "Which of my findings is the strongest? The weakest?",
            "Are my findings consistent with or surprising relative to the literature?",
            "What unanticipated findings should I follow up on?"
          ]
        ),
        docTutorial(
          "Finding card template",
          "One document per finding. The structure: claim, evidence (stats), interpretation, related research questions, related entities. A good finding card is a paragraph you can drop into the Findings chapter almost as-is. It also seeds the Discussion chapter: every Finding card has a 'so what' that needs to be defended.",
          "Claim: 24h sleep deprivation reduced word-list recall by 38%.\n\nEvidence: mixed-effects model, condition F(1,58)=42.3, p<.001, d=1.2 (95% CI 0.8-1.6).\n\nInterpretation: large effect, consistent with prior lab studies on students (Walker 2009, Drummond 2000). Novel: the magnitude is similar in knowledge workers, despite older age and self-selected healthy sleep.\n\nRelated RQ: RQ1\n\nRelated entities: Source Walker (2009), Source Drummond (2000), Method RCT, Dataset pre-test scores.\n\nDiscussion seed: if the effect is similar across populations, the mechanism is likely biological (consolidation impairment) not occupational (stress). Worth flagging in Discussion.",
          "## Claim\n[One sentence: the finding]\n\n## Evidence\n[Stats, model, effect size, confidence interval]\n\n## Interpretation\n[What it means, in plain language]\n\n## Related RQ\n[Which research question]\n\n## Related entities\n[Sources, methods, datasets]\n\n## Discussion seed\n[What needs to be defended in Discussion]",
          [
            "Is this finding statistically robust? Effect size? Confidence interval?",
            "How does this finding compare to the literature I cited?",
            "What's the strongest counter-interpretation of this finding?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // DRAFTS & REVISIONS
    // ------------------------------------------------------------------------
    {
      name: "Drafts & Revisions",
      documents: [
        docTutorial(
          "How to use Drafts & Revisions",
          "This is where the thesis actually gets written. One document per chapter draft (Draft Ch1 v1, Draft Ch1 v2, ...). Do not edit old drafts — they are the archaeology. When you finish a draft, copy forward to the next version and edit there. Capture supervisor and committee feedback here: who said what, when, what you changed, what you kept and why. After 3-4 revision rounds, a chapter usually finds its shape. After 7+, you are over-editing.",
          "Draft Ch1 v1 (excerpt):\n\nThe relationship between sleep and memory has been studied for over a century, but the specific question of how sleep deprivation affects knowledge workers remains open. This chapter introduces the problem, reviews the most relevant prior work, and lays out the research questions addressed by the present study.\n\n[Rest of draft follows...]",
          "## My writing workflow\n[When I write, where, how I know a draft is done]",
          [
            "What's the weakest paragraph in this draft?",
            "Compare draft {N} to draft {N-1}: what changed and why?",
            "Suggest a stronger opening for this chapter"
          ]
        ),
        docTutorial(
          "Revision log template",
          "One document per revision round. Capture: who gave feedback, what they said, what you changed, what you kept despite the feedback, and why. This is the audit trail of your intellectual decisions. A good revision log answers the question 'why does the thesis look like this?' — useful for your committee, useful for you when you forget.",
          "Round 1, supervisor feedback (May 12):\n- 'The intro buries the research questions. Move them to the end of section 1.1, not section 1.3.'\n- 'The literature review reads like an annotated bibliography. Reorganize thematically.'\n- 'You have not addressed the alternative explanations for the cortisol finding.'\n\nWhat I changed:\n- Moved RQs to section 1.1\n- Reorganized Lit Review by theme (3 themes instead of 12 sources)\n- Added section 5.4 on alternative explanations for cortisol\n\nWhat I kept despite feedback:\n- The decision to exclude shift workers (supervisor suggested including them, but the literature on shift workers is so different that it would dilute the argument)",
          "## Round {N} — {date}\n[Who, what kind of feedback]\n\n## What they said\n- \n- \n- \n\n## What I changed\n- \n- \n\n## What I kept despite feedback\n- \n\n## Why",
          [
            "What patterns do I see in the feedback I've received across rounds?",
            "Is this feedback about the writing, the argument, or the structure?",
            "Which round of revisions am I in, and is it time to stop?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // DEFENSE
    // ------------------------------------------------------------------------
    {
      name: "Defense",
      documents: [
        docTutorial(
          "How to use Defense",
          "The defense is a 1-3 hour oral exam where the committee tests whether you understand your own thesis, its place in the literature, and its limitations. The purpose is not to trick you — it is to verify the thesis is your work and that you can defend it. The best defense prep is anticipating the hard questions and knowing your own weaknesses. Capture slides, anticipated questions, and post-defense revisions here.",
          "Defense structure:\n1. Opening (5 min): research question, why it matters, what I found\n2. Findings (15 min): key results, one slide per research question\n3. Implications (5 min): what changes in the field because of this work\n4. Limitations and future work (5 min): what this study does NOT show\n5. Q&A (60-90 min): committee questions, public questions\n\nAnticipated hard questions (with my answers):\n- 'Why this population and not shift workers?' → Lit review section 2.3, scope decision\n- 'Is the effect size inflated by lab conditions?' → limitation, addressed in Discussion 5.2\n- 'How do you know it's memory and not attention?' → control measures, addressed in Methodology 4.4",
          "## My defense prep workflow\n[When I prep, how I rehearse, who I practice with]",
          [
            "What are the 3 hardest questions a skeptical committee could ask?",
            "What are the 3 weakest claims in my thesis?",
            "Generate 5 questions I should ask myself before the defense"
          ]
        ),
        docTutorial(
          "Anticipated questions template",
          "List the 15-20 hardest questions a committee could ask. For each: my answer in 60-90 seconds, the slide or page I would point to, and the limit of my answer. The goal of this document is to reduce the surface area of surprise. A question you have thought about for 10 minutes is not a question that will derail you.",
          "1. 'Why knowledge workers and not students, where the literature is?'\n   Answer: 60 sec — sleep research on students is well-established; knowledge workers have different sleep patterns (shorter, more variable), different cognitive demands (long focus blocks, not short recall tasks), and different occupational consequences. Cited in Intro 1.2 and Lit Review 2.4.\n   Limit: ecological validity is a known concern; addressed in Discussion 5.2.\n\n2. 'Could the cortisol finding be a confound, not a mechanism?'\n   Answer: 60 sec — yes, cortisol was a post-hoc measure, not pre-registered. I cannot claim it is the mechanism; only that it is correlated with the effect. I would frame it as 'warrants further investigation' in Future Work 6.3.\n   Limit: cannot rule out reverse causation (stress caused the memory loss, cortisol is a marker of stress).",
          "## Question 1\n\n### Answer (60-90 sec)\n\n### Cite from thesis\n[Chapter, page, slide]\n\n### Limit of my answer\n[What I cannot claim]\n\n---\n\n## Question 2\n\n...",
          [
            "What question am I most afraid of being asked?",
            "Is my answer to question {N} defensible, or am I bluffing?",
            "What's the most likely 'trap' question from a skeptical committee?"
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
      name: "Source",
      icon: "📚",
      color: "#4A90E2",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "author", type: "text" },
        { name: "year", type: "number" },
        { name: "type", type: "enum", enum_values: ["book", "article", "conference", "dataset", "report", "web", "thesis", "other"] },
        { name: "url", type: "text" },
        { name: "confidence", type: "number", note: "1-5, how much you trust this source" },
      ],
    },
    {
      name: "Citation",
      icon: "💬",
      color: "#9B59B6",
      fields: [
        { name: "text", type: "text", required: true, note: "The quoted text, exactly" },
        { name: "source", type: "text", note: "Author or speaker" },
        { name: "page", type: "text", note: "Page number, timestamp, or URL section" },
        { name: "context", type: "text", note: "Why this quote matters for your argument" },
      ],
    },
    {
      name: "Concept",
      icon: "💡",
      color: "#F5A623",
      fields: [
        { name: "name", type: "text", required: true, note: "The theoretical concept" },
        { name: "definition", type: "text", note: "Definition in your own words" },
        { name: "theoretical_framework", type: "text", note: "Which Theory it belongs to" },
      ],
    },
    {
      name: "Theory",
      icon: "🧠",
      color: "#16A085",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "author", type: "text" },
        { name: "year", type: "number" },
        { name: "key_propositions", type: "text", note: "The main claims of this theory" },
      ],
    },
    {
      name: "Research Question",
      icon: "❓",
      color: "#E74C3C",
      fields: [
        { name: "question", type: "text", required: true },
        { name: "type", type: "enum", enum_values: ["descriptive", "exploratory", "explanatory", "evaluative"] },
        { name: "status", type: "enum", enum_values: ["open", "in_progress", "answered", "abandoned"] },
        { name: "linked_findings", type: "text", note: "Which Findings answer this question" },
      ],
    },
    {
      name: "Method",
      icon: "🔬",
      color: "#27AE60",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "type", type: "enum", enum_values: ["qualitative", "quantitative", "mixed"] },
        { name: "description", type: "text" },
        { name: "limitations", type: "text", note: "Honest limits in your specific case" },
      ],
    },
    {
      name: "Dataset",
      icon: "📊",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "source", type: "text", note: "Where the data came from" },
        { name: "year", type: "number" },
        { name: "sample_size", type: "number" },
        { name: "notes", type: "text" },
      ],
    },
    {
      name: "Finding",
      icon: "🎯",
      color: "#8E44AD",
      fields: [
        { name: "claim", type: "text", required: true, note: "The finding, in one sentence" },
        { name: "evidence", type: "text", note: "Stats, model, effect size" },
        { name: "strength", type: "enum", enum_values: ["strong", "medium", "weak"] },
        { name: "related_question", type: "text", note: "Which Research Question this Finding answers" },
      ],
    },
    {
      name: "Person",
      icon: "👤",
      color: "#E67E22",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "enum", enum_values: ["supervisor", "examiner", "expert", "interviewee", "coauthor", "other"] },
        { name: "affiliation", type: "text" },
        { name: "contact", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (agnostic — no language-specific references)
  // ========================================================================
  styles: [
    { name: "Academic", fragment: "Formal, structured (IMRaD: introduction, methods, results, discussion when applicable). Citation-heavy, hedged claims, precise vocabulary. Define technical terms on first use. Avoid first person unless conventional in the field." },
    { name: "Plain", fragment: "Clear, accessible, less jargon. Short words, short sentences, one idea per sentence. No acronyms without expansion. Aim for reading ease, not display of knowledge. Suitable for theses with a non-specialist committee." },
    { name: "Minimal", fragment: "Concise, no filler. Cut anything that doesn't earn its place. Short sentences, simple lexicon, active verbs. Citations still required but without ornamental phrasing." },
    { name: "Methodological", fragment: "Hypotheses stated explicitly, evidence-based, reproducible. Every claim followed by its method or source. Tables and figures preferred over prose for results. Methods described in enough detail that another researcher could replicate the study." },
    { name: "Critical", fragment: "Analytical, multiple perspectives, debate. Explicitly engage counter-arguments. Use phrases like 'however', 'on the other hand', 'this assumes'. Aim for intellectual honesty over rhetorical victory." },
    { name: "Custom", fragment: "" },
    { name: "User", fragment: "Adapt to the user's existing writing style. Observe the existing text and match its tone, rhythm, vocabulary, and citation density." },
    { name: "None", fragment: "" },
  ],
  defaultStyleName: "Academic",

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are an academic editor for theses. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that respect the chosen writing style, the academic register, and the chapter's role in the thesis. Use precise vocabulary, hedge claims appropriately, and avoid filler.",
    chat: "You are an assistant for thesis writers. Help the user find sources, synthesize literature, design methodology, interpret findings, structure chapters, anticipate committee questions, and improve academic prose. Always respect the chosen writing style. Always cite the specific document and section you are drawing from. Do not invent facts or sources — if you don't know, say so. Hedge claims appropriately: in a thesis, overclaiming is worse than underclaiming.",
  },
};
