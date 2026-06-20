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

export const studentTemplate: Template = {
  type: "student",
  displayName: "Student",
  icon: "🎒",
  description: "Personal knowledge base for students: courses, lecture notes, assignments, exams, resources, and academic goals. Works for any level (school, university). Each course can have its own sub-section for deeper organization.",
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
          "The Inbox is a capture-first space for anything related to your studies: ideas, questions, links, reminders. Don't worry about structure here: just write. Once a week, move notes to the right section (Courses, Notes, Assignments, Resources) or delete them. The goal is to empty the Inbox regularly.",
          "A link to an article, a question from class, a half-formed idea, a phone number to call back, a book recommendation from a friend.",
          "## How I use my Inbox\n[Your weekly review process]",
          [
            "Group these Inbox notes by course and suggest a structure for each group",
            "Which of these Inbox notes should become Assignments vs Resources?",
            "Extract any questions worth researching further"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // COURSES (with example sub-sections to test multibranch)
    // ------------------------------------------------------------------------
    {
      name: "Courses",
      documents: [
        docTutorial(
          "How to use Courses",
          "Courses is where you track each subject or class. Use the Cornell-style course page for live sessions, the SQ3R template for self-study, the PQRST method for reading, the Pomodoro method for focused practice. You can also create a sub-section for each course (see example sub-sections below) to keep each course's notes, assignments and exams grouped together. Use the traffic-lights system to prioritize which courses need more attention: green (important + easy), amber (important + time-consuming), red (low priority).",
          "Traffic lights example for a semester:\n- Mathematics: 🟢 (foundations are strong, just need to maintain)\n- History: 🟡 (important, but reading-heavy, needs more time)\n- Physics: 🔴 (not a priority this semester, focus on the others)\n\nPomodoro example: 4 Pomodoros of 25 min (with 5 min breaks) on Math, 1 Pomodoro on review, 15-30 min break, then 4 Pomodoros on History.",
          "## My courses overview\n[For each course: name, teacher, hours/week, priority (green/amber/red), current grade]\n\n## Traffic lights\n[Which courses need more attention this week?]\n\n## Pomodoro plan\n[Today's Pomodoro plan: which course, how many Pomodoros, what method]",
          [
            "Which of my courses need the most attention this week?",
            "Generate a Pomodoro plan for studying {course}",
            "What's the traffic-light status of all my courses?"
          ]
        ),
        docTutorial(
          "Cornell lecture notes",
          "The Cornell method splits a page into three areas: cues (questions or keywords), notes (the main content), and a summary at the bottom. It's great for live lectures: cover the notes column, read the cue, and try to recall the answer. Adapt it to your course: replace 'cues' with formulas, dates, names, or whatever the course is about.",
          "Cues:\n- When did the Western Roman Empire fall?\n- Main cause?\n\nNotes:\nThe Western Roman Empire fell in 476 CE when Odoacer deposed the last Roman emperor. Main causes: economic crisis, military pressure from external tribes, overexpansion, political instability.\n\nSummary:\nThe Western Roman Empire fell in 476 CE. Multiple causes converged: economic, military, political.",
          "## Cues\n[Questions, keywords, formulas, dates]\n\n## Notes\n[Main content, in your own words]\n\n## Summary\n[2-3 sentences capturing the essence]",
          [
            "Generate 5 Cornell-style cues from these notes",
            "What's the one-sentence summary of this lecture?",
            "Suggest 3 questions I should be able to answer after studying this"
          ]
        ),
        docTutorial(
          "SQ3R study page",
          "SQ3R is a five-step method for reading and studying a text: Survey, Question, Read, Recite, Review. Best for self-directed reading of textbooks, articles and papers. Use this template when you start a new chapter or long article.",
          "Text: 'Thinking, Fast and Slow' by Daniel Kahneman, Ch. 3\n\nSurvey: 5 sections, 3 figures, 2 summary tables. Two main characters: System 1 (fast) and System 2 (slow).\n\nQuestion:\n- What is the difference between System 1 and System 2?\n- Why do we fall for cognitive biases?\n\nRead:\nSystem 1 is fast, automatic, emotional. System 2 is slow, effortful, logical. Most of the time System 1 runs the show.\n\nRecite:\nSystem 1 = gut feeling. System 2 = careful thought. We're overconfident about how much System 2 we use.\n\nReview:\nReread the anchoring experiment. Even random numbers influence estimates.",
          "## Text\n[Title, author, year, chapter or pages]\n\n## Survey\n\n## Question\n\n## Read\n\n## Recite\n\n## Review",
          [
            "Help me generate 10 survey questions for this text",
            "Recite the main ideas of this chapter in 5 bullet points",
            "What's the single most important insight from this SQ3R session?"
          ]
        ),
        docTutorial(
          "PQRST reading template",
          "PQRST (Preview, Question, Read, Summary, Test) is a five-step method for reading a text uncritically. It's faster than SQ3R and works well for getting the gist of a chapter before a lecture. Use it for: pre-class reading, quick overview of a paper, exam review.",
          "Text: 'Cognitive Psychology' Ch. 5 (pp. 120-145)\n\nPreview: 5 sections, chapter summary, key terms. Chapter is about attention and memory.\n\nQuestion:\n- What are the two types of attention?\n- How does attention affect memory encoding?\n\nRead:\n[Notes from the chapter]\n\nSummary:\nAttention is selective (focus on one thing) and divided (split between multiple). Selective attention improves memory encoding.\n\nTest:\nAnswers to my questions, in my own words.",
          "## Text\n\n## Preview\n\n## Question\n\n## Read\n\n## Summary\n\n## Test",
          [
            "Generate 5 preview questions for this chapter",
            "What's the difference between selective and divided attention?",
            "Suggest a quick PQRST pass for this text"
          ]
        ),
      ],
      // --------------------------------------------------------------------
      // Example sub-sections for testing multibranch
      // --------------------------------------------------------------------
      children: [
        {
          name: "Mathematics (example sub-section)",
          documents: [
            docTutorial(
              "Math lecture notes",
              "Use this sub-section to keep your math course organized: lectures, problem sets, formulas. Adapt the Cornell method to math: the 'cues' column holds formulas and theorems, the 'notes' column holds derivations and examples, the 'summary' column holds the key takeaway.",
              "Cues:\n- What is the chain rule?\n- When does it apply?\n\nNotes:\nThe chain rule: if y = f(g(x)), then dy/dx = f'(g(x)) · g'(x). It applies when one function is composed with another. Example: y = (3x + 1)^5, dy/dx = 5(3x + 1)^4 · 3 = 15(3x + 1)^4.\n\nSummary:\nChain rule = derivative of outer function at inner function, times derivative of inner function.",
              "## Lecture\n\n## Cues\n[Formulas, theorems, key results]\n\n## Notes\n[Derivations, examples, problem solutions]\n\n## Summary",
              [
                "Explain the chain rule in plain language",
                "What are the most common mistakes with the chain rule?",
                "Generate 3 practice problems for the chain rule"
              ]
            ),
            emptyDoc("Problem set 1"),
            emptyDoc("Problem set 2"),
            emptyDoc("Formula reference"),
          ],
        },
        {
          name: "History (example sub-section)",
          documents: [
            docTutorial(
              "History lecture notes",
              "Use this sub-section for your history course: lectures, primary sources, dates and events. The Cornell method works well: the 'cues' column holds dates, people, places; the 'notes' column holds the narrative; the 'summary' column holds the big picture.",
              "Cues:\n- 476 CE\n- Odoacer\n- Eastern Roman Empire\n\nNotes:\nIn 476 CE, the Germanic chieftain Odoacer deposed the last Roman emperor of the Western Roman Empire, Romulus Augustulus. The Eastern Roman Empire (Byzantine) continued until 1453.\n\nSummary:\nThe fall of the Western Roman Empire in 476 CE marked the end of antiquity in Europe. The Eastern Empire survived almost a thousand more years.",
              "## Lecture\n\n## Cues\n[Dates, people, places, events]\n\n## Notes\n[Narrative, primary sources, context]\n\n## Summary",
              [
                "Why did the Western Roman Empire fall in 476 CE?",
                "What happened to the Eastern Roman Empire?",
                "Generate 5 key dates I should remember from this period"
              ]
            ),
            emptyDoc("Timeline"),
            emptyDoc("Primary source readings"),
          ],
        },
      ],
    },

    // ------------------------------------------------------------------------
    // NOTES
    // ------------------------------------------------------------------------
    {
      name: "Notes",
      documents: [
        docTutorial(
          "How to use Notes",
          "Notes is where the actual content of your studying lives: lecture notes, study notes, reading notes. Use one of the documented methods (Cornell, SQ3R, PQRST, REAP) for each note. Link notes to the relevant Course entity. Practice retrieval: re-read the cues column of your Cornell notes 24h, 3d, 7d, 30d after the lecture (spaced repetition).",
          "REAP method (for dense readings):\n- Read: get the main idea\n- Encode: paraphrase in your own words\n- Annotate: critical thinking, questions\n- Ponder: connect to other things you know, discuss with classmates\n\nRetrieval practice: don't re-read your notes. Test yourself: cover the notes column, look at the cues, try to recall.",
          "## My note-taking workflow\n[Which method for which course, when I review]",
          [
            "Which of my notes are due for a retrieval-practice review?",
            "Summarize the most important ideas from my notes on {course}",
            "Generate 5 retrieval questions for my last lecture"
          ]
        ),
        docTutorial(
          "Spaced repetition plan",
          "Use this template to plan your spaced repetition schedule for a specific topic. The intervals below are evidence-based (Ebbinghaus 1885, Karpicke & Roediger 2008): 1 day, 3 days, 7 days, 14 days, 30 days, 60 days, 120 days. For each review, write what you recalled and what you forgot. Adjust the next interval based on your recall quality.",
          "Topic: 'Cell biology — mitosis phases'\n\nReview 1 (Day 1): recalled 4/5 phases. Good.\nReview 2 (Day 3): recalled 5/5. Easy.\nReview 3 (Day 7): recalled 4/5. Forgot telophase details.\nReview 4 (Day 14): recalled 5/5. Will skip Review 5.\nReview 5 (Day 30): [not done yet]\n\nResult: by day 14 the topic was solidly in long-term memory.",
          "## Topic\n\n## Review 1 (Day 1): [score / what you forgot]\n## Review 2 (Day 3)\n## Review 3 (Day 7)\n## Review 4 (Day 14)\n## Review 5 (Day 30)\n## Review 6 (Day 60)\n## Review 7 (Day 120)\n\n## Result\n[What stuck, what didn't, next steps]",
          [
            "What topics are due for a spaced-repetition review this week?",
            "What is the optimal review schedule for {topic}?",
            "Generate 5 flashcards from my notes on {course}"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // ASSIGNMENTS
    // ------------------------------------------------------------------------
    {
      name: "Assignments",
      documents: [
        docTutorial(
          "How to use Assignments",
          "Assignments is where you track all your homework, essays, lab reports, projects. Use one document per assignment, with a clear due date, status, and a checklist of steps. Link to the relevant Course entity. When the assignment is done, move it to Archive (or keep it here as a record).",
          "Assignment: 'History essay on the fall of the Western Roman Empire'\n\nDue: 2026-10-15\nStatus: in_progress\nCourse: History\n\nSteps:\n- [x] Read the assigned chapter\n- [x] Outline main arguments (3 paragraphs)\n- [ ] Write first draft\n- [ ] Revise and proofread\n- [ ] Format in required style\n- [ ] Submit",
          "## Title\n\n## Course\n\n## Due date\n\n## Status\n[todo / in_progress / done / submitted]\n\n## Type\n[homework / essay / lab / project / reading]\n\n## Steps\n- [ ] \n- [ ] \n\n## Linked entities",
          [
            "Which of my assignments are due this week?",
            "Generate a checklist for {assignment_type} on {topic}",
            "What is my workload by course for this month?"
          ]
        ),
        docTutorial(
          "Assignment planner",
          "Use this template to plan a major assignment from start to finish. Break it into phases, set deadlines for each phase, and identify blockers. Working backwards from the due date, plan 2-3 weeks of work for a major essay or project.",
          "Assignment: 'Final project — research essay'\n\nDue: 2026-12-15 (12 weeks from now)\n\nPhase 1 (Week 1-2): Topic selection\n- [ ] Pick topic\n- [ ] Get approval from teacher\n- [ ] Initial research\n\nPhase 2 (Week 3-5): Research\n- [ ] Read 5-10 sources\n- [ ] Take notes on each\n- [ ] Outline main arguments\n\nPhase 3 (Week 6-9): Writing\n- [ ] First draft\n- [ ] Self-edit\n- [ ] Peer review\n- [ ] Revise\n\nPhase 4 (Week 10-12): Final\n- [ ] Final draft\n- [ ] Format\n- [ ] Submit\n\nBlockers:\n- Library access for certain journals",
          "## Assignment\n\n## Due date\n\n## Phases\n### Phase 1: [date range]\n- [ ] \n- [ ] \n\n### Phase 2: [date range]\n- [ ] \n- [ ] \n\n### Phase 3: [date range]\n- [ ] \n- [ ] \n\n## Blockers",
          [
            "How long should I plan for a {type} assignment of {length}?",
            "Break {assignment} into phases with deadlines",
            "What are common blockers for {assignment_type}?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // EXAMS
    // ------------------------------------------------------------------------
    {
      name: "Exams",
      documents: [
        docTutorial(
          "How to use Exams",
          "Exams is where you prepare for, take, and review exams. Use one document per exam. Before the exam: an Exam prep template (what to study, when, how). After the exam: an Exam debrief template (what you knew, what you didn't, what to do differently next time). Link to the relevant Course entity.",
          "Exam prep:\n- 2 weeks before: review notes, make flashcards\n- 1 week before: practice problems, past exams\n- 2 days before: light review, sleep well\n- Day of: eat breakfast, arrive early\n\nExam debrief:\n- What topics did I know well?\n- What topics did I struggle with?\n- What was the format (multiple choice, written, oral)?\n- What will I do differently next time?",
          "## My exam workflow\n[How I prepare, how I take, how I debrief]",
          [
            "Which of my exams are coming up in the next 2 weeks?",
            "Generate a 2-week study plan for {exam}",
            "What topics should I focus on for {exam} based on my past grades?"
          ]
        ),
        docTutorial(
          "Exam prep template",
          "Use this template to plan your preparation for a specific exam. The schedule works backwards from the exam date. Adjust based on the difficulty of the course and your current grade in it.",
          "Exam: 'Calculus midterm'\nDate: 2026-11-20\nFormat: written, 2 hours, mix of problems and short theory\nTopics: limits, derivatives, chain rule, applications\nCurrent grade: B+\n\n2 weeks before (Nov 6): start systematic review\n1 week before (Nov 13): practice problems, past exams\n2 days before (Nov 18): light review, sleep well\nDay before (Nov 19): no studying, just review formulas briefly\nDay of (Nov 20): eat breakfast, arrive 10 min early",
          "## Exam\n\n## Date\n\n## Format\n[Written / oral / multiple choice / mix]\n\n## Topics\n[List of topics covered]\n\n## Current grade\n\n## Schedule\n- [date]: [what to do]\n- [date]: [what to do]\n- [date]: [what to do]\n\n## Linked entities",
          [
            "Generate a study schedule for this exam working backwards from the date",
            "What are the most common mistakes on {topic} exams?",
            "Generate 5 practice questions for this exam"
          ]
        ),
        docTutorial(
          "Exam debrief template",
          "The exam is over: the most useful thing you can do is debrief it now, while you still remember. What did you know? What didn't you know? What was the format? What will you do differently next time? This is the single most important study activity you can do.",
          "Exam: 'Calculus midterm'\nDate taken: 2026-11-20\nGrade: A-\n\nWhat I knew well:\n- Chain rule (got all 5 questions right)\n- Basic derivatives\n\nWhat I struggled with:\n- Application problems (word problems → setup of equation)\n- Forgot one formula on the theory section\n\nFormat observations:\n- Mix of problems (70%) and theory (30%)\n- Time was tight, finished in last 5 min\n\nWhat I'll do differently next time:\n- Practice word problems earlier (start 3 weeks before, not 2)\n- Make a formula sheet for theory section\n- Do a timed mock exam\n\nFinal grade in course: A-",
          "## Exam\n\n## Date taken\n\n## Grade\n\n## What I knew well\n\n## What I struggled with\n\n## Format observations\n\n## What I'll do differently next time\n\n## Final grade in course",
          [
            "What patterns do I see in my exam performance over the semester?",
            "What topics should I focus on for the next exam based on this debrief?",
            "Generate a study plan to address the gaps from this exam"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // RESOURCES
    // ------------------------------------------------------------------------
    {
      name: "Resources",
      documents: [
        docTutorial(
          "How to use Resources",
          "Resources is your library: every book, article, video, podcast, website, or course material that you might want to come back to. Use one document per resource, or one combined document if it's a short list. Always include: title, author, year, type, how to access it, and why you trust it. Link to the relevant Course entity.",
          "Sources for a course on cognitive psychology:\n- 'Thinking, Fast and Slow' by Kahneman (2011) — foundational\n- 'Predictably Irrational' by Ariely (2008) — accessible intro\n- 'Cognitive Psychology' textbook, 8th ed. (2020) — required reading\n- Coursera 'Learning How to Learn' (free) — practical techniques",
          "## My resources by course\n[Books, articles, videos, podcasts, websites organized by course]\n\n## How to access\n[Library links, URLs, ISBNs, notes on availability]",
          [
            "Find all resources I have for {course}",
            "Which of my resources are most relevant to {topic}?",
            "Generate a reading list for {topic}"
          ]
        ),
        docTutorial(
          "Source card",
          "One document per source. Capture: full citation, type, key claims, useful quotes, page references, why you trust it, how you might use it. The point is not to transcribe the source — it is to make the source findable when you write or study.",
          "Citation: Kahneman, D. (2011). 'Thinking, Fast and Slow'. Farrar, Straus and Giroux.\n\nType: book\n\nKey claim: We have two systems of thinking — System 1 (fast, intuitive) and System 2 (slow, deliberate). Most decisions are made by System 1 even when we think System 2 is in charge.\n\nUseful quotes:\n- 'Nothing in life is as important as you think it is, while you are thinking about it.' (p. 187)\n- 'System 1 is fast, System 2 is slow, and System 2 is lazy.' (Ch. 3)\n\nHow I might use it:\n- Psychology class: anchor effect, availability heuristic\n- Decision-making course: framing effects, loss aversion\n\nConfidence: 5/5 (foundational text, multiple re-reads)",
          "## Citation\n\n## Type\n[book / article / video / website / podcast]\n\n## Key claim\n\n## Useful quotes\n\n## How I might use it\n\n## Confidence\n[1-5, why]",
          [
            "Compare this source to my other Resources on {topic}",
            "Where does this source fit in my study plan?",
            "Generate 5 retrieval questions from this source"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // GOALS
    // ------------------------------------------------------------------------
    {
      name: "Goals",
      documents: [
        docTutorial(
          "How to use Goals",
          "Goals is where you set and track your academic goals: semester, year, degree, skill. One document per goal, with a clear target and a way to measure progress. Distinguish outcome goals ('get an A in calculus') from process goals ('study 4 Pomodoros per day'). Process goals are more controllable and lead to outcome goals. Review weekly.",
          "Outcome goal: 'A in calculus midterm'\nProcess goals:\n- 4 Pomodoros of calculus study per day\n- 1 office hour visit per week\n- Complete all problem sets on time\n- Sleep 7+ hours the night before\n\nReview: every Sunday, 5 min, count process goals completed this week.",
          "## My goals by timeframe\n[This week / this semester / this year / this degree]\n\n## My review process\n[When I review, what I check]",
          [
            "What's my progress on my semester goals?",
            "Which of my process goals am I meeting consistently?",
            "Generate process goals that would lead to {outcome_goal}"
          ]
        ),
        docTutorial(
          "Semester goal template",
          "Use this template to set goals for a single semester. Mix outcome goals (grades) with process goals (habits). Aim for 2-3 outcome goals and 3-5 process goals. Less is more: you can't focus on everything.",
          "Semester: Fall 2026\nCourses: Calculus, History, Physics, English\n\nOutcome goals (1-3):\n- A in Calculus\n- A- or better in History\n- Pass Physics (currently C, this is a stretch)\n\nProcess goals (3-5):\n- 4 Pomodoros of study per day, 5 days a week\n- 1 office hour per week\n- Sleep 7+ hours average\n- 1 review session per week per course (spaced repetition)\n\nWhat I'll stop doing:\n- Re-reading notes without testing myself (low retention)\n- Studying only the day before the deadline\n\nResources I'll need:\n- Anki (free) for flashcards\n- Library access for History primary sources",
          "## Semester\n\n## Courses\n\n## Outcome goals (1-3)\n\n## Process goals (3-5)\n\n## What I'll stop doing\n\n## Resources I'll need",
          [
            "Are my outcome goals realistic given my current grades?",
            "Generate 3 process goals that would help me achieve {outcome_goal}",
            "What should I cut from my list to focus on what matters most?"
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
          "Archive is for finished semesters, retired courses, completed goals. Move notes here when a course is done, a semester is over, or a goal is achieved. Archived notes are searchable but out of the way. Review the archive at the end of each academic year: it's your track record.",
          "Move notes here when:\n- A course is finished (passed or failed)\n- A semester is over\n- A goal is achieved or abandoned\n- An assignment is submitted and graded",
          "## My archive policy\n[When I archive, how I review the archive, retention policy]",
          [
            "What courses did I take in {semester}?",
            "What was my final grade in {course}?",
            "Generate a year-end summary of my academic progress"
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
      name: "Course",
      icon: "📚",
      color: "#4A90E2",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "level", type: "enum", enum_values: ["school", "university"] },
        { name: "teacher", type: "text" },
        { name: "credits", type: "number" },
        { name: "semester", type: "text", note: "e.g. Fall 2026, Year 2" },
      ],
    },
    {
      name: "Assignment",
      icon: "📝",
      color: "#F5A623",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "course", type: "text", note: "Which course this belongs to" },
        { name: "due_date", type: "date" },
        { name: "status", type: "enum", enum_values: ["todo", "in_progress", "done", "submitted"] },
        { name: "type", type: "enum", enum_values: ["homework", "essay", "lab", "project", "reading", "other"] },
      ],
    },
    {
      name: "Grade",
      icon: "🎯",
      color: "#27AE60",
      fields: [
        { name: "value", type: "text", required: true, note: "e.g. A, 28/30, 85%" },
        { name: "course", type: "text" },
        { name: "type", type: "enum", enum_values: ["exam", "quiz", "essay", "lab", "homework", "project", "participation"] },
        { name: "date", type: "date" },
        { name: "weight", type: "number", note: "Percentage weight in the final grade" },
      ],
    },
    {
      name: "Exam",
      icon: "📋",
      color: "#E74C3C",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "course", type: "text" },
        { name: "date", type: "date" },
        { name: "format", type: "enum", enum_values: ["written", "oral", "practical", "multiple_choice", "mix"] },
        { name: "topics", type: "text", note: "List of topics covered" },
      ],
    },
    {
      name: "Resource",
      icon: "📖",
      color: "#1ABC9C",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "type", type: "enum", enum_values: ["book", "article", "video", "link", "podcast", "course_material", "other"] },
        { name: "course", type: "text" },
        { name: "url", type: "text" },
      ],
    },
    {
      name: "Flashcard",
      icon: "🃏",
      color: "#9B59B6",
      fields: [
        { name: "front", type: "text", required: true, note: "Question or prompt" },
        { name: "back", type: "text", required: true, note: "Answer or explanation" },
        { name: "course", type: "text" },
        { name: "difficulty", type: "enum", enum_values: ["easy", "medium", "hard"] },
        { name: "last_reviewed", type: "date" },
      ],
    },
    {
      name: "Concept",
      icon: "💡",
      color: "#F5A623",
      fields: [
        { name: "name", type: "text", required: true, note: "The concept or term" },
        { name: "definition", type: "text", note: "Definition in your own words" },
        { name: "course", type: "text" },
      ],
    },
    {
      name: "Study Session",
      icon: "⏱️",
      color: "#16A085",
      fields: [
        { name: "date", type: "date", required: true },
        { name: "course", type: "text" },
        { name: "duration_min", type: "number" },
        { name: "method", type: "enum", enum_values: ["Cornell", "SQ3R", "PQRST", "Pomodoro", "spaced_repetition", "practice", "review", "other"] },
        { name: "notes", type: "text" },
      ],
    },
    {
      name: "Goal",
      icon: "🏆",
      color: "#8E44AD",
      fields: [
        { name: "description", type: "text", required: true },
        { name: "deadline", type: "date" },
        { name: "status", type: "enum", enum_values: ["active", "done", "abandoned"] },
        { name: "course", type: "text" },
      ],
    },
    {
      name: "Person",
      icon: "👤",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "enum", enum_values: ["classmate", "teacher", "tutor", "study_buddy", "other"] },
        { name: "contact", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (none — student notes don't have a writing style)
  // ========================================================================
  styles: [],
  defaultStyleName: null,

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are a personal study assistant. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that help the student capture ideas, organize notes, prepare for exams, or apply evidence-based study techniques (Cornell, SQ3R, PQRST, Pomodoro, spaced repetition, retrieval practice, interleaving).",
    chat: "You are an assistant for students. Help the user capture ideas, take notes using evidence-based methods (Cornell, SQ3R, PQRST, Pomodoro, spaced repetition), prepare for exams, find connections between courses and concepts, retrieve information through self-testing, and manage assignments and goals. Always cite the specific document and section you are drawing from. Encourage retrieval practice over re-reading. Do not invent facts or sources — if you don't know, say so.",
  },
};
