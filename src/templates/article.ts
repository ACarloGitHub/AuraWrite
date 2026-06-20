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

export const articleTemplate: Template = {
  type: "article",
  displayName: "Article",
  icon: "📄",
  description: "Long-form prose for articles, blog posts, op-eds, features, reviews and essays. Includes pitch, research, outline, drafts, revisions and publication tracking.",
  requiresStyleChoice: true,

  // ========================================================================
  // SECTIONS — sections are containers only, no text/tutorial on them
  // ========================================================================
  sections: [
    // ------------------------------------------------------------------------
    // PITCH
    // ------------------------------------------------------------------------
    {
      name: "Pitch",
      documents: [
        docTutorial(
          "How to use Pitch",
          "Every good article starts with a clear pitch: what is it about, who is it for, why does it matter now, what is the angle. A pitch is one page, not ten. If you cannot explain the article in three sentences, the angle is not clear yet. Use this section to capture the pitch before you start researching. Reject pitches that try to do too much — one article, one argument.",
          "Headline: 'Why small teams ship faster than large ones (and why that might change)'\n\nAngle: counter-intuitive claim + early evidence. Not 'small teams are fast' (obvious) but 'small teams have a hidden cost we don't talk about'.\n\nTarget: senior engineers, CTOs, tech leads. They already know the surface story.\n\nLength: 1500-2000 words, magazine style.\n\nDeadline: 2026-07-15 (next issue).\n\nWhy now: a high-profile CTO just switched from FAANG to a 5-person startup and wrote about it. Conversation is active.",
          "## Headline\n[Working title, not final]\n\n## Angle\n[What's the non-obvious claim?]\n\n## Target audience\n[Who is this for, what do they already know]\n\n## Length and format\n[Word count, format: essay / listicle / feature / review / op-ed]\n\n## Deadline\n[When is it due?]\n\n## Why now\n[What's the hook, the news peg, the timeliness]",
          [
            "Stress-test my pitch: is the angle too obvious? Too ambitious?",
            "Suggest 3 alternative headlines for this pitch",
            "Identify the single weakest claim in this pitch and how to fix it"
          ]
        ),
        docTutorial(
          "Article pitch template",
          "Use this template to write a quick pitch in under 15 minutes. The structure is deliberately short: headline, angle, target, length, deadline, why-now. If you cannot fill these in one page, the article is not ready to research yet. The best pitches are short enough to read in 60 seconds.",
          "Headline: 'The hidden cost of always-on notifications'\n\nAngle: notifications don't just distract — they change what you choose to work on. Counter-intuitive because the conventional wisdom is 'just turn them off'. We're saying the damage is already done by the time you turn them off.\n\nTarget: knowledge workers, 25-45, who feel busy but unproductive.\n\nLength: 1800 words, magazine feature.\n\nDeadline: rolling — first available slot in Q3.\n\nWhy now: new research from Stanford (May 2026) on attention residue; Microsoft released a focus mode that nobody is using.",
          "## Headline\n\n## Angle\n\n## Target audience\n\n## Length and format\n\n## Deadline\n\n## Why now",
          [
            "Generate 5 headlines for this pitch",
            "Is this angle too ambitious for {word count} words?",
            "What's the single riskiest assumption in this pitch?"
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
          "Research is the raw material: every source, every quote, every statistic, every interview. Capture liberally during the research phase — you cannot predict what you will need when you write. Link each item to the relevant entity (Source, Quote, Statistic, Person). When you start writing, you should be able to find any fact in under 30 seconds. If you cannot, the research is not organized enough.",
          "Sources for a piece on attention:\n- Stanford study (Mark et al., 2026) — Source\n- Direct quote from Mark about 'attention residue' — Quote\n- 3.2 hours/day average interruption stat — Statistic\n- Interview with Sarah, product lead at Slack — Person\n\nFor each: what it is, where it came from, how I might use it, confidence level (1-5).",
          "## My research workflow\n[Where I find sources, how I evaluate them, when I stop researching and start writing]",
          [
            "Which of my Sources are most relevant to the current draft?",
            "Find all Quotes attributed to {person} across my research",
            "List all Statistics published after 2025 that I could cite"
          ]
        ),
        docTutorial(
          "Source card",
          "One document per source. Capture: full citation, type, key claims, useful quotes, page references, why you trust it, how you might use it. The point of a source card is not to transcribe the source — it is to make the source findable when you write. Be honest about limitations: a blog post is weaker than a peer-reviewed paper, a single interview is weaker than a survey of 100 people.",
          "Citation: Mark, G., Gonzalez, A., & Harris, J. (2026). 'Attention Residue in Knowledge Work'. Stanford HCI Group Working Paper.\n\nType: Academic preprint, not yet peer-reviewed.\n\nKey claim: After being interrupted, knowledge workers take an average of 23 minutes to return to the original task's depth, not 5-10 as previously assumed.\n\nUseful quotes:\n- 'The cost of an interruption is not the interruption itself, but the residue it leaves in your attention.' (p. 4)\n- 'Knowledge work has a recovery time that linear task-switching models fail to predict.' (p. 12)\n\nHow I might use it:\n- Lead: reframe 'just turn off notifications' advice as outdated\n- Counter-evidence: most productivity research is from 2000s, on simpler tasks\n- Limitation: small sample (n=42), all from one company\n\nConfidence: 4/5 (strong method, weak sample).",
          "## Citation\n[Full citation in your preferred format]\n\n## Type\n[Book / article / interview / website / report / etc.]\n\n## Key claim\n[The one sentence you would quote from this]\n\n## Useful quotes\n- \"...\" (p. X)\n- \"...\" (p. Y)\n\n## How I might use it\n[Where in the article this could go]\n\n## Limitations\n[What is this source weak on?]\n\n## Confidence\n[1-5, why]",
          [
            "Summarize this source in one sentence",
            "Compare this source to my other Sources on {topic}",
            "What's the strongest counter-argument to this source's main claim?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // OUTLINE
    // ------------------------------------------------------------------------
    {
      name: "Outline",
      documents: [
        docTutorial(
          "How to use Outline",
          "An outline is a contract with yourself: what you will say, in what order, before you write a single sentence of prose. A good outline has a clear spine — the argument, beat by beat. Each beat should earn its place: if removing it doesn't weaken the article, cut it. Use a topic outline (short phrases) for early planning. Switch to a sentence outline (full sentences) when the structure is settled and you want to stress-test the logic.",
          "Topic outline (early):\n- Hook: the always-on problem\n- Reframe: residue, not interruption\n- Stanford study: 23 min recovery\n- Interview: Slack product lead\n- Counter: turning off notifications is too late\n- Practical: what to do instead\n\nSentence outline (later):\n- Notifications don't just distract you in the moment — they leave a residue that lasts 23 minutes. This is new.\n- The Stanford study from May 2026 is the first to measure residue, not interruption, in real knowledge work.\n- Sarah at Slack saw the same pattern in her own team: people turned off notifications and still felt scattered.\n- The conventional advice — turn off notifications — is necessary but insufficient.\n- Three things that actually help: ... (one paragraph each).",
          "## Outline version\n[topic / sentence / reverse — pick one]\n\n## My argument\n[One sentence: what is the article claiming?]\n\n## Beat 1\n[What the article says first, and why]\n\n## Beat 2\n[What comes next, and why this order]\n\n## Beat 3\n...\n\n## Counter-argument\n[What would a smart skeptic say after each beat?]",
          [
            "Identify the weakest beat in this outline",
            "Reorder these beats for maximum impact",
            "Generate a reverse outline of an existing draft to find structural gaps"
          ]
        ),
        docTutorial(
          "Topic outline template",
          "A topic outline uses short phrases (3-7 words) for each beat. It is fast to write and easy to rearrange. Use it in the early stages when you are still figuring out what the article is about. Each line should be a claim or a scene, not a topic. 'The Stanford study' is a topic, not a beat. 'Stanford measured residue, not interruption — and the number is bigger than expected' is a beat.",
          "Article: 'The hidden cost of always-on notifications'\n\n1. The promise of focus mode: 4 hours of uninterrupted time\n2. The reality: people check Slack 'just to be safe' every 11 minutes on average\n3. The hidden cost: not the check, but the recovery — 23 minutes per the Stanford data\n4. Why this changes the advice: turning off notifications is necessary but insufficient\n5. What actually helps: a 'transition ritual' between tasks (90 seconds, deliberate pause)\n6. The case for fewer, larger blocks — not just fewer interruptions",
          "## My topic outline\n1. \n2. \n3. \n4. \n5. \n6. \n7. ",
          [
            "Which of these beats is the strongest? The weakest?",
            "Should I cut beat {N} or merge it with another?",
            "Suggest a better opening beat than my current #1"
          ]
        ),
        docTutorial(
          "Sentence outline template",
          "A sentence outline uses full sentences for each beat. It is slower to write but reveals logical gaps: if a sentence is hard to write, the beat is not yet clear. Use this when the topic outline is settled and you want to stress-test the argument. Each sentence should make a claim that the article will then defend. Skip no beats — a sentence outline is not a draft, it is a check.",
          "Article: 'The hidden cost of always-on notifications'\n\n1. Most advice on focus treats the interruption as the problem, but new research shows the cost is in the recovery, not the interruption itself.\n2. The Stanford HCI group measured what they call 'attention residue' — the cognitive footprint of a previous task that lingers after you switch.\n3. Their central finding: knowledge workers take 23 minutes on average to return to a task's full depth after an interruption, not the 5-10 minutes previously assumed.\n4. The implication is that 'just turn off notifications' is necessary but insufficient, because the residue from prior interruptions is already in your head.\n5. The practical fix is a deliberate transition ritual: a 90-second pause between tasks, where you write down where you stopped and what comes next.\n6. This is harder than it sounds, and easier than the current advice suggests. The data, and the experiences of the people I interviewed, point in the same direction.",
          "## Beat 1\n\n## Beat 2\n\n## Beat 3\n\n## Beat 4\n\n## Beat 5\n\n## Beat 6",
          [
            "Which sentence in this outline is the weakest claim?",
            "Does the order of these sentences make the argument flow?",
            "Where is the logical gap: which claim needs more support before the next one?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // DRAFTS
    // ------------------------------------------------------------------------
    {
      name: "Drafts",
      documents: [
        docTutorial(
          "How to use Drafts",
          "Drafts are where the article actually gets written. Keep one document per draft version (Draft v1, Draft v2, ...). Do not edit old drafts — they are the archaeology of the piece. When you finish a draft, copy it forward to the next version and edit there. This is the only section where prose lives; everywhere else, you are planning, organizing, or reviewing.",
          "Draft v1 (excerpt):\n\nThe first time I noticed it, I was halfway through a paragraph and realized I had no idea what I was trying to say. Slack had buzzed 40 minutes earlier. I had answered it in 30 seconds. And now, 40 minutes later, I was still in the Slack-shaped space in my head.\n\nThe conventional advice — turn off notifications — is correct, but incomplete. It addresses the interruption. It does not address the residue.",
          "## My drafting process\n[When I write, where I write, how I know a draft is done]",
          [
            "What's the weakest paragraph in this draft?",
            "Compare draft {N} to draft {N-1}: what changed and why?",
            "Suggest a stronger opening for this draft"
          ]
        ),
        docTutorial(
          "First draft checklist",
          "Before you call a draft 'done', check these things. The goal of the first draft is to exist, not to be good. Resist the urge to edit while writing — finish the draft, then check it against this list. The first draft is the most important draft because it is the one that exists.",
          "□ Every beat from the sentence outline is present, in order\n□ The opening makes a claim, not a throat-clearing\n□ Each section earns its place (no paragraphs that could be cut without loss)\n□ Sources are cited (placeholders OK, but present)\n□ Counter-arguments are acknowledged, not ignored\n□ The closing leaves the reader with a specific thing to think or do\n□ I have not edited while writing (separate writing pass from editing pass)",
          "## Checklist for draft {N}\n- [ ] \n- [ ] \n- [ ] \n- [ ] \n\n## Open questions\n- \n\n## Next step\n",
          [
            "What's missing from this draft compared to the outline?",
            "Which paragraph in this draft is the most likely place to lose the reader?",
            "What is the single biggest improvement I could make to this draft today?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // REVISIONS
    // ------------------------------------------------------------------------
    {
      name: "Revisions",
      documents: [
        docTutorial(
          "How to use Revisions",
          "Revisions are where good writing happens. The first draft is for finding out what you want to say; the revisions are for saying it well. Capture every meaningful piece of feedback here: from an editor, a reader, the AI, your own self-edit. Track what you changed and why. After 3-4 revision rounds, the article usually finds its shape. After 7+, you are over-editing and should consider killing your darlings.",
          "Editor feedback (round 1, June 22):\n- 'The opening is too soft — start with the 23-minute number, not the Slack story'\n- 'The Slack product lead interview is buried — promote it to beat 2'\n- 'You bury the practical advice at the end. Move it forward.'\n- 'Cut the paragraph about email — it doesn't earn its place'\n\nWhat I changed:\n- Moved Stanford number to lead\n- Promoted interview to beat 2\n- Moved practical advice to beat 4\n- Cut email paragraph (she was right)\n\nWhat I kept despite feedback:\n- The Slack personal story — editor wanted it cut, but it is the human anchor",
          "## Feedback round {N}\n[Date, from whom]\n\n## What they said\n- \n- \n- \n\n## What I changed\n- \n- \n\n## What I kept despite feedback\n- \n\n## Why",
          [
            "What patterns do I see in the feedback I've received across rounds?",
            "Is this feedback about the writing, the argument, or the structure?",
            "Which round of revisions am I in, and is it time to stop?"
          ]
        ),
        docTutorial(
          "Self-edit checklist",
          "Before you send the draft to anyone else, edit it yourself. Read it out loud. Read it on a phone. Read it the next morning. Use this checklist to make sure you have not skipped the obvious. The goal of self-editing is not perfection — it is to remove the 20% of problems that take 80% of the editor's time, so they can spend their attention on the harder 20%.",
          "□ Read aloud — fix anything you stumble over\n□ Read on phone — any paragraph too long?\n□ Cut the first sentence of every paragraph. Did the paragraph still work? If yes, cut for good.\n□ Search for 'very', 'really', 'just', 'actually' — delete most of them\n□ Search for nominalizations (the act of, the process of, in order to) — replace with verbs\n□ Every claim is followed by its source, or marked as opinion\n□ No paragraph is longer than 8 lines on screen\n□ The opening 50 words work without context\n□ The closing 50 words work without context",
          "## Self-edit pass on draft {N}\n- [ ] Read aloud\n- [ ] Read on phone\n- [ ] Cut first sentence of each paragraph\n- [ ] Search for fillers\n- [ ] Search for nominalizations\n- [ ] Verify sources\n- [ ] Check paragraph length\n- [ ] Test opening and closing in isolation\n\n## Issues found\n- \n\n## Fixes applied\n- ",
          [
            "Find any paragraphs in this draft that are too long for mobile",
            "Identify any sentence where the verbs are nominalized",
            "Which of these checklist items would have the highest impact on this draft?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // PUBLISHED
    // ------------------------------------------------------------------------
    {
      name: "Published",
      documents: [
        docTutorial(
          "How to use Published",
          "Published is the record of the final version and where it went. Use one document per published version (Published 2026-08-01). Include: the final headline (which is often different from the pitch headline), the publication, the URL, the date, any editorial changes between your last draft and what was actually published. Over time, this section becomes your portfolio.",
          "Published 2026-08-01\n\nFinal headline: 'The 23-Minute Problem: Why 'Just Turn Off Notifications' Isn't Enough'\n\nPublication: The Atlantic (online)\n\nURL: https://example.com/article-2026-08-01\n\nDate published: 2026-08-01\n\nEditorial changes from my last draft:\n- Cut 200 words for length\n- Changed opening per the editor's suggestion (now starts with the number)\n- Added a pull quote they chose from beat 3\n\nResponse (first 2 weeks):\n- 12k reads, 340 shares, 28 comments\n- 4 reader emails, 2 thoughtful, 2 angry\n- Cited in 3 follow-up pieces",
          "## Final headline\n[Often different from your pitch headline]\n\n## Publication\n[Where it was published]\n\n## URL\n[Link to the live version]\n\n## Date published\n\n## Editorial changes from my last draft\n- \n- \n\n## Response (first few weeks)\n[Reads, shares, comments, notable replies, citations]",
          [
            "What's the response to my published articles in the last year?",
            "Which of my published articles drove the most discussion?",
            "Compare the response to this article to my typical response — is it above or below average?"
          ]
        ),
        docTutorial(
          "Publication record",
          "A running list of everything you have published from AuraWrite. Use it as a portfolio, a CV, a tax record, or just a logbook. Update it every time something gets published. The point is to make the count of your work visible to yourself — most people underestimate how much they have shipped.",
          "1. 'The 23-Minute Problem' — The Atlantic, 2026-08-01\n2. 'Why I stopped using TODO lists' — personal blog, 2026-05-12\n3. 'The case for boring infrastructure' — Increment magazine, 2026-02-03\n4. 'A short history of the focus mode' — A List Apart, 2025-11-20\n5. ...\n\nTotal: {N} published pieces, {N} this year",
          "## Publication record\n1. \n2. \n3. \n4. \n5. \n\n## Total\n{N} published pieces, {N} this year",
          [
            "How many pieces have I published this year?",
            "Which of my published articles has been cited by others?",
            "What's the gap in my publication record — what topic have I written about that I haven't published?"
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
        { name: "url", type: "text" },
        { name: "type", type: "enum", enum_values: ["book", "article", "interview", "report", "website", "preprint", "other"] },
        { name: "confidence", type: "number", note: "1-5, how much you trust this source" },
      ],
    },
    {
      name: "Quote",
      icon: "💬",
      color: "#9B59B6",
      fields: [
        { name: "text", type: "text", required: true, note: "The quoted text, exactly" },
        { name: "source", type: "text", note: "Author or speaker" },
        { name: "page", type: "text", note: "Page number, timestamp, or URL section" },
        { name: "context", type: "text", note: "Brief context for why this quote matters" },
      ],
    },
    {
      name: "Statistic",
      icon: "📊",
      color: "#16A085",
      fields: [
        { name: "value", type: "text", required: true, note: "The number, e.g. '23 minutes' or '42%'" },
        { name: "source", type: "text" },
        { name: "year", type: "number" },
        { name: "context", type: "text", note: "What was being measured, on whom" },
      ],
    },
    {
      name: "Person",
      icon: "👤",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "text", note: "Their job, affiliation, or relevance" },
        { name: "contact", type: "text", note: "How to reach them" },
        { name: "quoted", type: "boolean", note: "Whether you interviewed them" },
      ],
    },
    {
      name: "Argument",
      icon: "💡",
      color: "#F5A623",
      fields: [
        { name: "claim", type: "text", required: true, note: "What you are claiming, in one sentence" },
        { name: "evidence", type: "text", note: "The strongest evidence for this claim" },
        { name: "strength", type: "enum", enum_values: ["strong", "medium", "weak"] },
        { name: "status", type: "enum", enum_values: ["draft", "supported", "contested", "dropped"] },
      ],
    },
    {
      name: "Counter-argument",
      icon: "⚖️",
      color: "#E67E22",
      fields: [
        { name: "claim", type: "text", required: true, note: "What a skeptic would say" },
        { name: "response", type: "text", note: "How you answer it" },
        { name: "strength", type: "enum", enum_values: ["strong", "medium", "weak"] },
      ],
    },
    {
      name: "Example",
      icon: "🎯",
      color: "#27AE60",
      fields: [
        { name: "description", type: "text", required: true, note: "What the example shows" },
        { name: "source", type: "text" },
        { name: "anonymized", type: "boolean", note: "Whether names/details are changed" },
      ],
    },
    {
      name: "Pitch",
      icon: "📌",
      color: "#8E44AD",
      fields: [
        { name: "headline", type: "text", required: true },
        { name: "angle", type: "text", note: "The non-obvious claim" },
        { name: "target_audience", type: "text" },
        { name: "length", type: "text", note: "Word count target" },
        { name: "deadline", type: "date" },
        { name: "status", type: "enum", enum_values: ["idea", "pitched", "accepted", "rejected", "published"] },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (agnostic — no language-specific references)
  // ========================================================================
  styles: [
    { name: "Minimal", fragment: "Concise and rhythmic. Short sentences, simple lexicon, active verbs. Implied rather than stated emotions. Cut anything that doesn't earn its place." },
    { name: "Journalistic", fragment: "Inverted pyramid structure. Lead with the most important information. Factual, attributed claims, neutral tone. Use the 5 Ws (who, what, when, where, why, how) early. Short paragraphs, frequent source citations." },
    { name: "Academic", fragment: "Formal, structured (IMRaD: introduction, methods, results, discussion when applicable). Citation-heavy, hedged claims, precise vocabulary. Define technical terms on first use. Avoid first person unless conventional in the field." },
    { name: "Conversational", fragment: "First-person, informal, reflective. As if talking to a thoughtful friend. Short sentences mixed with longer ones. Personal experience, opinions, mild humor allowed. No condescension, no slang for its own sake." },
    { name: "Marketing", fragment: "Persuasive, benefit-driven, call-to-action oriented. Lead with the reader's problem or desire. Concrete outcomes, specific numbers, social proof. Active voice, strong verbs, short sentences. End with a clear next step." },
    { name: "Plain", fragment: "Simple, accessible, universal. Short words, short sentences, one idea per sentence. No jargon, no acronyms without expansion, no insider references. Aim for reading ease, not display of knowledge." },
    { name: "Custom", fragment: "" },
    { name: "User", fragment: "Adapt to the user's existing writing style. Observe the existing text and match its tone, rhythm, vocabulary and sentence structure." },
    { name: "None", fragment: "" },
  ],
  defaultStyleName: "Minimal",

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are an editor for long-form articles. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that respect the chosen writing style, the article's angle, and the beat in the outline. Avoid clichés and filler.",
    chat: "You are an assistant for article writers. Help the user find sources, check citations, stress-test arguments, suggest counter-arguments, summarize research, identify weak paragraphs, and improve prose. Always respect the chosen writing style. Always cite the specific document and section you are drawing from. Do not invent facts or sources — if you don't know, say so.",
  },
};
