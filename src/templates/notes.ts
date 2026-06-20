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

// Helper: empty document (user will fill in)
const emptyDoc = (title: string) => ({
  title,
  body: "",
});

export const notesTemplate: Template = {
  type: "notes",
  displayName: "Notes",
  icon: "📝",
  description: "Personal knowledge base: capture ideas, organize topics, take notes from books and meetings, track tasks and references. Ideal for students, researchers and professionals building a structured second brain.",
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
        emptyDoc("Quick capture"),
        docTutorial(
          "How to use the inbox",
          "The Inbox is a temporary holding area. Capture freely during the day, organize once a week. Move notes to their proper section (Topics, Daily Notes, Reading Notes, Meeting Notes, Research) or delete them. An empty Inbox is a sign of a healthy knowledge workflow.",
          "Capture freely:\n- A link to an article\n- A quote heard in a podcast\n- A half-formed idea\n- A phone number to call back\n- A book recommendation from a friend\n\nThen, on Friday afternoon, sort:\n- The article link goes to Reading Notes\n- The podcast quote goes to Topics > the relevant topic\n- The half-formed idea stays in Topics as a draft\n- The phone number becomes a Task\n- The book recommendation goes to Topics > Reading list",
          "## How I use my Inbox\n[Write your own weekly review process here]",
          [
            "Summarize all notes currently in my Inbox in one paragraph",
            "Which of these Inbox notes are duplicates or no longer relevant?",
            "Move the most important Inbox note into the right section and delete the rest"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // TOPICS
    // ------------------------------------------------------------------------
    {
      name: "Topics",
      documents: [
        docTutorial(
          "How to use Topics",
          "Topics is the heart of your knowledge base. Each document is a deep-dive on a single subject: a school subject, a work project, a hobby, a domain you're learning. Create one document per topic, give it a clear title, and link related entities (Concepts, References, Quotes) as you find them.",
          "Topics/Italian History/, Topics/Machine Learning/, Topics/My Garden/, Topics/Project Phoenix (work)/ — one document per topic.",
          "## My topic\n[Title, scope, and a one-paragraph description of what this topic covers]",
          [
            "Generate a study outline for {topic} with 5 sub-questions",
            "What concepts from my other Topics are related to {topic}?",
            "Summarize what I know about {topic} based on this document"
          ]
        ),
        docTutorial(
          "Cornell-style topic page",
          "The Cornell method splits a page into three areas: cues (questions or keywords), notes (the main content), and a summary at the bottom. It's great for live sessions where you're processing new information — lectures, meetings, videos. Use cues to test yourself later: cover the notes column, read the cue, and try to recall the answer.",
          "Cues:\n- When did the Western Roman Empire fall?\n- Main cause?\n\nNotes:\nThe Western Roman Empire fell in 476 CE when the Germanic chieftain Odoacer deposed the last Roman emperor, Romulus Augustulus. The Eastern Roman Empire (Byzantine) continued until 1453. Main causes: economic crisis, military pressure from external tribes, overexpansion, political instability.\n\nSummary:\nThe fall of the Western Roman Empire in 476 CE marked the end of antiquity in Europe. Multiple causes converged: economic, military, political. The Eastern Empire survived almost a thousand more years.",
          "## Cues\n[Questions, keywords, or prompts]\n\n## Notes\n[Main content, in your own words]\n\n## Summary\n[2-3 sentences capturing the essence]",
          [
            "Generate 5 Cornell-style cues from these notes",
            "What is the one-sentence summary of this topic?",
            "Suggest 3 questions I should be able to answer about this topic"
          ]
        ),
        docTutorial(
          "SQ3R study page",
          "SQ3R is a five-step method for reading and studying a text: Survey, Question, Read, Recite, Review. It's best for self-directed reading of books, articles and papers where you want deep understanding, not just information. Use this template when you start a new book or long article.",
          "Text: 'Thinking, Fast and Slow' by Daniel Kahneman, 2011\n\nSurvey: The book has 5 parts, 38 chapters, an introduction and a glossary. The two main characters are System 1 (fast, intuitive) and System 2 (slow, deliberate).\n\nQuestion:\n- What is the difference between System 1 and System 2?\n- Why do we fall for cognitive biases?\n- How does Kahneman define 'heuristics'?\n\nRead:\nChapters 1-3 introduce the two systems. System 1 is fast, automatic, emotional. System 2 is slow, effortful, logical. Most of the time System 1 runs the show, even when we think System 2 is in charge.\n\nRecite:\nIn my own words: System 1 is gut feeling, System 2 is careful thought. We're overconfident about how much System 2 we use.\n\nReview:\nReread chapter 2. The anchoring experiment is striking: even random numbers influence estimates.",
          "## Text\n[Title, author, year, chapter or pages]\n\n## Survey\n[Overall structure, what to expect]\n\n## Question\n[5-10 questions you want answered]\n\n## Read\n[Notes, in your own words]\n\n## Recite\n[Answer the questions without looking]\n\n## Review\n[What to revisit, what you still don't understand]",
          [
            "Help me generate 10 survey questions for this text",
            "Recite the main ideas of this chapter in 5 bullet points",
            "What's the single most important insight from this SQ3R session?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // DAILY NOTES
    // ------------------------------------------------------------------------
    {
      name: "Daily Notes",
      documents: [
        docTutorial(
          "How to use Daily Notes",
          "Daily Notes are short, time-stamped entries: one document per day (or one document with multiple days, your choice). The point is to capture what happened, what you learned, what you want to remember. Date the document, jot a few lines, link to Topics if you go deeper. Daily Notes become a private journal of your work and thinking — invaluable when you look back.",
          "Create a new document with today's date as the title. Add a quick log of meetings, learnings, decisions, blockers, and small wins. At the end of the week, review the past 7 days and promote anything important to its proper Topic.",
          "## My daily note routine\n[When you write, what you include, when you review]",
          [
            "Summarize this week's Daily Notes in a paragraph",
            "What patterns do you see in my Daily Notes this month?",
            "Extract all Tasks mentioned in this week's Daily Notes"
          ]
        ),
        docTutorial(
          "Daily note template",
          "A daily note is a quick log: what you did, what you learned, what blocked you, what's next. Keep it short — 5 to 15 minutes per day is enough. The value is in the consistency, not the length. At the end of the day, write 3-5 lines. At the end of the week, review the past 7 days.",
          "Date: 2026-06-20\n\nDone today:\n- Reviewed chapter 3 of the new book\n- Fixed the bug in the export feature\n- 30-min walk, listened to a podcast on habit formation\n\nLearned:\n- The bug was caused by a missing await on a Promise\n- The podcast reinforced: small consistent actions beat occasional big efforts\n\nBlockers:\n- Waiting for design review on the new dashboard\n\nTomorrow:\n- Start chapter 4\n- Reply to design feedback\n- 30-min walk",
          "## Done\n[What you accomplished]\n\n## Learned\n[New insights, mistakes, surprises]\n\n## Blockers\n[What's slowing you down]\n\n## Tomorrow\n[Top 3 priorities for tomorrow]",
          [
            "Summarize this week of daily notes in 3 bullet points",
            "What is the most common blocker this month?",
            "Generate tomorrow's priorities based on this week's open tasks"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // READING NOTES
    // ------------------------------------------------------------------------
    {
      name: "Reading Notes",
      documents: [
        docTutorial(
          "How to use Reading Notes",
          "Reading Notes are your permanent record of books, articles, blog posts and papers. The goal is not to copy what you read but to engage with it: extract the key ideas, write your reactions, link to your existing Topics. Use one document per book (or per chapter, for technical books). Always include the citation (title, author, year) so you can find the source again.",
          "Reading Notes/The Pragmatic Programmer/ (Hunt & Thomas, 1999), Reading Notes/Atomic Habits review/ (Clear, 2018), Reading Notes/Calmo blog post on focus/. One doc per book or article.",
          "## My reading workflow\n[How you read, when you take notes, how you file them]",
          [
            "Summarize this book in 5 bullet points in my own words",
            "What ideas from this book connect to my existing Topics?",
            "What is the single most actionable advice from this book?"
          ]
        ),
        docTutorial(
          "Book notes template",
          "Use this template for non-fiction books. The 3-2-1 method: write 3 key ideas, 2 actionable takeaways, 1 question to reflect on. Then go deeper: what surprised you, what did you disagree with, what will you do differently. Link to relevant Topics and References.",
          "Title: Atomic Habits\nAuthor: James Clear\nYear: 2018\nPages read: full\n\n3 key ideas:\n1. Small habits compound — 1% better every day = 37x better in a year\n2. Make it obvious, attractive, easy, satisfying (the 4 laws of behavior change)\n3. Identity precedes habits — become the kind of person who does X\n\n2 actionable takeaways:\n1. Stack new habits: 'After I [current habit], I will [new habit]'\n2. Use environment design: put the book on the pillow, not in the drawer\n\n1 question to reflect on:\nWhich of my current habits do I want to keep, and which do I want to change? What identity do I want to build?\n\nMy reactions:\nThe compounding math is striking. I've always underestimated how much 1% per day adds up. The identity shift idea is harder to apply — I think I'm more outcome-driven than identity-driven.\n\nConnections:\n- See Topics/Productivity/Habit stacking\n- See Topics/Personal growth/Long-term thinking",
          "## Citation\n**Title:** [book title]\n**Author:** [author]\n**Year:** [year]\n**Pages:** [which pages or 'full']\n\n## 3 key ideas\n1. \n2. \n3. \n\n## 2 actionable takeaways\n1. \n2. \n\n## 1 question to reflect on\n\n## My reactions\n[What surprised you, what did you disagree with, what will you do differently]\n\n## Connections\n[Link to relevant Topics, References, Quotes]",
          [
            "Generate the 3-2-1 summary of this book based on my notes",
            "Which of my existing Topics are connected to this book?",
            "What is the single most important idea I should remember from this book?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // MEETING NOTES
    // ------------------------------------------------------------------------
    {
      name: "Meeting Notes",
      documents: [
        docTutorial(
          "How to use Meeting Notes",
          "Meeting Notes capture decisions, action items and open questions from meetings. The goal is to make meetings searchable and accountable: if someone asks 'what did we decide about X?' you can find it in 30 seconds. Use one document per meeting, dated, with the participants, agenda, decisions and action items clearly separated. Action items become Tasks in the project.",
          "Meeting Notes/2026-06-20 Sprint planning/, Meeting Notes/2026-06-15 Client kickoff/, Meeting Notes/2026-06-10 1:1 with manager/. One doc per meeting, dated, searchable.",
          "## My meeting note routine\n[When you take notes, when you review, when you file action items]",
          [
            "List all action items assigned to me across all meeting notes",
            "What decisions did we make about {topic} in the last month?",
            "Which open questions are still unresolved from the last 5 meetings?"
          ]
        ),
        docTutorial(
          "Meeting template",
          "Capture the meeting while it's fresh, ideally in the meeting itself, or within 30 minutes of ending. The structure: who was there, what we covered, what we decided, who's doing what, and what's still open. Action items must have an owner and a deadline — otherwise they won't happen.",
          "Date: 2026-06-20\nType: Sprint planning\nParticipants: Anna, Marco, Lucia, Carlo (me)\n\nAgenda:\n1. Review last sprint\n2. Plan next sprint\n3. Discuss blocker in checkout flow\n\nDecisions:\n- We will not include the new dashboard in this sprint (deferred to next)\n- We will pair on the checkout bug for the first 2 days\n\nAction items:\n- [ ] Anna: write spec for new dashboard (due 2026-06-25)\n- [ ] Marco: investigate the checkout bug (due 2026-06-22)\n- [ ] Carlo: review the new PR on the home page (due 2026-06-21)\n- [ ] Lucia: schedule the user testing session (due 2026-06-23)\n\nOpen questions:\n- Do we have budget for the new analytics tool? (Anna to ask finance)\n- When is the design review for the new dashboard?\n\nNext meeting: 2026-06-27, same time",
          "## Date and type\n[When, what kind of meeting]\n\n## Participants\n[Who was there]\n\n## Agenda\n[Topics covered]\n\n## Decisions\n[What was decided]\n\n## Action items\n- [ ] [owner]: [task] (due [date])\n- [ ] \n\n## Open questions\n- [ ] \n\n## Next meeting\n[When, where, with whom]",
          [
            "Extract all action items assigned to {person} across these meeting notes",
            "List all decisions made in the last 30 days about {topic}",
            "Which open questions have been pending for more than 2 weeks?"
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
          "Research is for long-running investigations: a question you're trying to answer, a topic you're exploring in depth over weeks or months. Each document is a research log: the question, what you've read, what you've found, what you still don't know. Use it to avoid re-reading the same paper twice, and to build toward a final synthesis (article, thesis, report).",
          "Research/Effect of sleep on memory consolidation/, Research/Comparison of vector databases for AuraWrite/, Research/History of typography in Italian publishing/. One doc per research question, evolving over time.",
          "## My research workflow\n[How you capture sources, when you review, when you synthesize]",
          [
            "Summarize what I've learned so far about {research question}",
            "What are the main disagreements in the literature on {topic}?",
            "What experiment or reading would close the biggest gap in my research?"
          ]
        ),
        docTutorial(
          "Research log",
          "A research log is a working document, not a finished report. Date each entry. The structure: the question, what you read or did, what you found, what you still don't know. The log evolves over weeks. At the end, you (or the AI) can synthesize it into a final document.",
          "Question: What is the effect of sleep on memory consolidation?\nStarted: 2026-05-10\n\n## 2026-05-10\nRead: 'Sleep and memory: an overview' (Walker, 2009)\nFound: Sleep, especially REM and slow-wave, plays a critical role in consolidating declarative and procedural memories. The hippocampus replays the day's experiences during sleep, transferring them to the neocortex.\nOpen: How long does the effect last? Are naps equally effective?\n\n## 2026-05-18\nRead: 'The role of REM sleep in emotional memory' (Cartwright, 2010)\nFound: REM sleep specifically supports emotional memory consolidation, while non-REM supports factual memory.\nOpen: How does this apply to learning new languages?\n\n## 2026-06-01\nRead: 'Naps and learning' (Mednick et al., 2003)\nFound: 60-90 min naps improve procedural learning. Short naps (<30 min) help alertness but not memory.\nOpen: What's the optimal nap length for declarative memory?\n\nSynthesis (draft):\nSleep — especially REM and slow-wave — consolidates memories through hippocampal-cortical replay. Naps can partially substitute for full-night sleep for procedural learning. Open: optimal nap length for declarative memory.",
          "## Question\n[What you're trying to find out]\n\n## Started\n[Date]\n\n## Entries\n### [date]\n**Read:** [source]\n**Found:** [what you learned]\n**Open:** [what you still don't know]\n\n### [date]\n...\n\n## Synthesis (draft)\n[Your current best answer to the question, with caveats]",
          [
            "Summarize what I've learned so far and what gaps remain",
            "Suggest 3 more sources to read based on the gaps in my log",
            "Write a 200-word synthesis of this research log"
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
          "Archive is for finished, completed, or no-longer-active notes. The goal is to keep your active workspace clean without losing information. Move a note to the Archive when: the project is done, the topic is no longer relevant, or the daily note is more than 6 months old. Archived notes are searchable but out of the way.",
          "Move notes here when:\n- A project is closed\n- A topic is no longer relevant\n- A daily note is older than 6 months\n- A research question is fully answered (and the answer is in the synthesis)",
          "## My archive policy\n[When you archive, how often you review the archive, when you delete permanently]",
          [
            "What did I work on in {month/year}?",
            "Find any archived note that mentions {keyword}",
            "Which archived research projects could be reopened?"
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
      name: "Topic",
      icon: "📚",
      color: "#4A90E2",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "description", type: "text", note: "What this topic is about, in one or two sentences" },
      ],
    },
    {
      name: "Concept",
      icon: "💡",
      color: "#F5A623",
      fields: [
        { name: "name", type: "text", required: true, note: "Term, formula, acronym" },
        { name: "definition", type: "text", note: "The definition or explanation in your own words" },
      ],
    },
    {
      name: "Question",
      icon: "❓",
      color: "#E74C3C",
      fields: [
        { name: "text", type: "text", required: true },
        { name: "answered", type: "boolean", note: "Whether this question has been answered" },
      ],
    },
    {
      name: "Quote",
      icon: "💬",
      color: "#9B59B6",
      fields: [
        { name: "text", type: "text", required: true, note: "The quoted text" },
        { name: "source", type: "text", note: "Author or speaker" },
        { name: "reference", type: "text", note: "Book, article, page, timestamp" },
      ],
    },
    {
      name: "Reference",
      icon: "📖",
      color: "#1ABC9C",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "author", type: "text" },
        { name: "year", type: "number" },
        { name: "url", type: "text" },
      ],
    },
    {
      name: "Summary",
      icon: "📋",
      color: "#34495E",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "content", type: "text", note: "Short synthesis of a topic" },
      ],
    },
    {
      name: "Task",
      icon: "✅",
      color: "#27AE60",
      fields: [
        { name: "description", type: "text", required: true },
        { name: "due_date", type: "date" },
        { name: "done", type: "boolean" },
      ],
    },
    {
      name: "Event",
      icon: "📅",
      color: "#E67E22",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "date", type: "date" },
        { name: "description", type: "text" },
      ],
    },
    {
      name: "Person",
      icon: "👤",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "text", note: "Who they are, their role in your work or life" },
        { name: "note", type: "text" },
      ],
    },
    {
      name: "Place",
      icon: "📍",
      color: "#16A085",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "context", type: "text", note: "Why this place is relevant" },
      ],
    },
    {
      name: "Project",
      icon: "🎯",
      color: "#8E44AD",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "description", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (none — notes don't have a writing style)
  // ========================================================================
  styles: [],
  defaultStyleName: null,

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are a personal knowledge assistant. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that help the user capture ideas clearly, organize information, or connect this note to related topics.",
    chat: "You are an assistant for note-taking and personal knowledge management. Help the user search their notes, summarize topics, find connections between ideas, extract tasks and references from documents, and answer questions using the content of their notes. Always cite the specific document and section you are drawing from.",
  },
};
