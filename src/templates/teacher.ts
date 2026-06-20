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

export const teacherTemplate: Template = {
  type: "teacher",
  displayName: "Teacher",
  icon: "🍎",
  description: "Personal knowledge base for teachers: classes, planning, lessons, assessment, students, and communications. Works for any level (school, university). Each class can have its own sub-section for deeper organization.",
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
          "The Inbox is a capture-first space for anything that comes to mind during teaching: ideas for a lesson, a student's question, a useful resource, a parent concern. Don't worry about structure here: just write. Review the Inbox weekly and move notes to Classes, Planning, Lessons, Materials, Assessment, Students, or Comms. The goal is to empty the Inbox regularly.",
          "An idea for a hands-on activity, a link to a useful video, a question from a student that you want to address, a behavior observation you want to track, a parent's email you need to follow up on.",
          "## How I use my Inbox\n[Your weekly review process, with what to capture here vs. process immediately]",
          [
            "Group these Inbox notes by category and suggest a structure for each",
            "Which of these Inbox notes should become Lessons vs Materials vs Student observations?",
            "Extract any patterns in what I keep capturing — what does that tell me about my teaching?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // CLASSES (with example sub-sections to test multibranch)
    // ------------------------------------------------------------------------
    {
      name: "Classes",
      documents: [
        docTutorial(
          "How to use Classes",
          "Classes is where you track each class or course you teach. You can also create a sub-section for each class (see example sub-sections below) to keep each class's planning, lessons, materials, assessments, and student notes grouped together. Use Bloom's taxonomy to structure learning objectives: Remember (recall facts), Understand (explain), Apply (use in new situations), Analyze (break down), Evaluate (judge), Create (produce something new). The Triple A model (Activating, Acquiring, Applying) helps structure individual lessons.",
          "Bloom's taxonomy applied to a math class:\n- Remember: recall formulas\n- Understand: explain why the formula works\n- Apply: solve new problems with the formula\n- Analyze: break down a complex problem into sub-problems\n- Evaluate: judge which method is most efficient\n- Create: design a new problem that uses multiple formulas\n\nTriple A lesson structure:\n- Activating: review yesterday's homework, ask a warm-up question\n- Acquiring: present new material with examples\n- Applying: students practice on similar problems",
          "## My classes overview\n[For each class: name, level, subject, year, students count, room, period]\n\n## Bloom distribution\n[For each class: how many objectives per Bloom level?]",
          [
            "Which of my classes need the most attention this week?",
            "Generate a Triple A lesson plan for {topic} in {class}",
            "What is the Bloom distribution of my {class} objectives this semester?"
          ]
        ),
        docTutorial(
          "Class page template",
          "Use this template to set up a new class. Capture: name, level, subject, year, students, room, schedule, key contacts, and your teaching philosophy for this class. Update the class page at the start of each year or semester.",
          "Class: Mathematics 3A (Grade 9)\nLevel: school (secondary)\nSubject: Mathematics\nYear: 2026-2027\nStudents: 24 (12 boys, 12 girls)\nRoom: 204\nSchedule: Mon/Wed/Fri 9:00-10:00\n\nKey contacts:\n- Department head: Prof. Bianchi\n- Co-teacher: Prof. Verdi\n- Counselor for this class: Dr. Russo\n\nTeaching philosophy for this class:\nFocus on problem-solving over rote memorization. Students should be able to explain their reasoning, not just give the right answer. Use real-world problems whenever possible (budgets, measurements, statistics from current events).",
          "## Class\n\n## Level and subject\n\n## Year, students, room, schedule\n\n## Key contacts\n[Department head, co-teachers, counselor, special needs support]\n\n## Teaching philosophy for this class\n[Your approach, your goals for these specific students]",
          [
            "Generate a teaching philosophy statement for {class}",
            "What should I focus on in the first week of {class}?",
            "Suggest 3 class-building activities for the start of {class}"
          ]
        ),
      ],
      // --------------------------------------------------------------------
      // Example sub-sections for testing multibranch
      // --------------------------------------------------------------------
      children: [
        {
          name: "Mathematics 3A (example sub-section)",
          documents: [
            docTutorial(
              "Mathematics 3A class",
              "Use this sub-section to organize everything for your specific class: weekly plans, lesson prep, materials, student notes. Start with a class overview, then add sub-documents for each unit or major topic.",
              "Current unit: Algebra fundamentals (equations and inequalities)\nWeek 1: linear equations\nWeek 2: word problems\nWeek 3: systems of equations\nWeek 4: inequalities\nWeek 5: review and test\n\nKey students this year:\n- A.M.: strong, needs challenge\n- B.C.: struggles with word problems\n- C.D.: excellent but shy, encourage participation\n\nThis week's priority: prepare the test for week 5",
              "## Class overview\n[Year, students, room, schedule, current unit]\n\n## Current unit\n[Title, weekly breakdown]\n\n## Key students\n[Names, observations, accommodations]\n\n## This week's priority\n[Top 3 things to do this week]",
              [
                "Generate a week-by-week plan for {unit} in {class}",
                "Suggest accommodations for {student_needs} in {class}",
                "What are common mistakes in {topic} and how to address them?"
              ]
            ),
            emptyDoc("Unit plans"),
            emptyDoc("Lesson prep"),
            emptyDoc("Student notes"),
            emptyDoc("Materials"),
          ],
        },
        {
          name: "Computer Science 101 (example sub-section)",
          documents: [
            docTutorial(
              "Computer Science 101 class",
              "Use this sub-section for your university class. Same structure as school classes, but the audience is older and the content is more abstract. Focus on active learning: problem sets, coding projects, peer review. University students benefit from explicit connections between theory and practice.",
              "Current unit: Introduction to algorithms\nWeek 1: what is an algorithm, complexity basics\nWeek 2: arrays and lists\nWeek 3: sorting algorithms\nWeek 4: searching algorithms\nWeek 5: midterm project (implement a simple search engine)\n\nKey students this term:\n- 80 students enrolled\n- Mix of CS majors and students from other departments\n- Wide range of prior programming experience\n\nThis week's priority: grade problem set 2 (due Friday)",
              "## Class overview\n[Term, enrollment, prerequisites, room, schedule]\n\n## Current unit\n[Title, weekly breakdown, assessment schedule]\n\n## Key students\n[Notable cases, accommodations, common gaps]\n\n## This week's priority",
              [
                "Suggest active learning activities for {topic} in a class of {n} university students",
                "Generate a rubric for {assignment} in {class}",
                "How do I handle students with very different prior knowledge in {class}?"
              ]
            ),
            emptyDoc("Syllabus"),
            emptyDoc("Lecture notes"),
            emptyDoc("Problem sets"),
            emptyDoc("Project specifications"),
          ],
        },
        {
          name: "Italian Literature (example sub-section)",
          documents: [
            docTutorial(
              "Italian Literature class",
              "Use this sub-section for your liceo class. Focus on close reading, textual analysis, and historical context. Italian literature benefits from oral discussion: have students read aloud, debate interpretations, write short essays. Bloom's taxonomy applies: Remember (plot, characters), Understand (themes), Apply (compare with other texts), Analyze (close reading), Evaluate (critical essays), Create (original interpretations).",
              "Current unit: Dante, Inferno, cantos I-X\nWeek 1: intro to Dante and the Commedia\nWeek 2: canto I analysis\nWeek 3: cantos II-III (the journey begins)\nWeek 4: cantos IV-V (limbo)\nWeek 5: cantos VI-IX (the circles of the incontinent)\nWeek 6: canto X (the heretics)\nWeek 7: midterm essay\nWeek 8: review\n\nThis week's priority: prepare close-reading exercise for canto III",
              "## Class overview\n[Year, students, hours/week, current unit]\n\n## Current unit\n[Text, weekly breakdown, assessment plan]\n\n## Key students\n[Reading levels, writing skills, engagement]\n\n## This week's priority",
              [
                "Generate close-reading questions for canto {n} of the Inferno",
                "Suggest essay topics for {unit} in {class}",
                "How do I help students who struggle with literary analysis?"
              ]
            ),
            emptyDoc("Texts and editions"),
            emptyDoc("Lesson plans"),
            emptyDoc("Essay assignments"),
            emptyDoc("Student writing samples"),
          ],
        },
      ],
    },

    // ------------------------------------------------------------------------
    // PLANNING
    // ------------------------------------------------------------------------
    {
      name: "Planning",
      documents: [
        docTutorial(
          "How to use Planning",
          "Planning is where you set the long-term direction: yearly goals, unit plans, scope and sequence. One document per year or semester, plus unit plans for each major unit. Use Bloom's taxonomy to ensure your objectives span all cognitive levels (not just Remember/Understand). The Triple A model (Activating, Acquiring, Applying) is useful for individual lesson planning, while unit plans are broader.",
          "Yearly planning example:\n- Q1 (Sep-Oct): foundations, baseline assessment\n- Q2 (Nov-Dec): core unit 1, mid-year review\n- Q3 (Jan-Feb): core unit 2\n- Q4 (Mar-May): application, project, end-year review\n\nUnit plan template:\n- Title, duration, subject, class\n- Objectives (Bloom-tagged)\n- Key activities and materials\n- Assessment plan\n- Differentiation for different student levels",
          "## My planning workflow\n[When I plan (summer, monthly, weekly), how I balance breadth vs depth]\n\n## Yearly goals\n[3-5 measurable goals for the year]",
          [
            "Generate a yearly plan for {class} aligned with standards {standards}",
            "What's the Bloom distribution of my objectives for {class}? Should I add more higher-order objectives?",
            "Which standards am I not covering in {class}?"
          ]
        ),
        docTutorial(
          "Yearly planning template",
          "Use this template at the start of each year or semester. Capture the big picture: what you want to achieve, how you'll measure success, what constraints you're working with. Review at the end of each quarter.",
          "Year: 2026-2027\nClasses: Mathematics 3A (24 students), Mathematics 3B (22 students)\n\nQuarterly plan:\nQ1 (Sep-Oct): foundations\n- Baseline assessment, identify gaps\n- Unit 1: algebra fundamentals\n- Q1 assessment: progress check\n\nQ2 (Nov-Dec): core skills\n- Unit 2: geometry basics\n- Mid-year project\n- Q2 assessment: mid-year exam\n\nQ3 (Jan-Feb): application\n- Unit 3: statistics and probability\n- Q3 assessment: project\n\nQ4 (Mar-May): synthesis and review\n- Unit 4: review and consolidation\n- Q4 assessment: end-of-year exam\n\nYearly goals:\n1. 80% of students reach 'proficient' or above on end-of-year exam\n2. Reduce math anxiety (measured by pre/post survey)\n3. Increase student engagement (measured by participation rate)\n\nConstraints:\n- 3 hours/week per class\n- 1 Chromebook per student (shared)",
          "## Year\n\n## Classes\n\n## Quarterly plan\n### Q1\n### Q2\n### Q3\n### Q4\n\n## Yearly goals\n[3-5 measurable goals]\n\n## Constraints\n[Time, resources, student needs]",
          [
            "Generate 5 yearly goals for {class} given the constraints {constraints}",
            "What's missing in my Q3 plan for {class}?",
            "Suggest a low-stakes assessment for the end of Q1"
          ]
        ),
        docTutorial(
          "Unit plan template",
          "Use this template for each major unit (typically 3-6 weeks). Capture: objectives (Bloom-tagged), activities, materials, assessment, and differentiation for different student levels. The unit plan is the bridge between the yearly plan and individual lesson plans.",
          "Unit: Algebra fundamentals\nClass: Mathematics 3A\nDuration: 4 weeks (Sep 14 - Oct 9)\n\nObjectives (Bloom-tagged):\n- Remember: recall the rules for solving linear equations (1-variable)\n- Understand: explain why the same operation on both sides preserves equality\n- Apply: solve word problems modeled by linear equations\n- Analyze: identify which information in a word problem is relevant to the equation\n- Evaluate: judge the reasonableness of a solution\n- Create: design a word problem that requires a specific equation to solve\n\nActivities:\n- Week 1: direct instruction + guided practice (equations)\n- Week 2: word problems, group work\n- Week 3: multi-step equations, peer tutoring\n- Week 4: review + test\n\nMaterials:\n- Textbook chapter 3\n- Worksheet on equations\n- Real-world problem set (budgets, distances)\n\nAssessment:\n- Formative: exit tickets each Friday\n- Summative: end-of-unit test (50 points, 60 min)\n\nDifferentiation:\n- Support: step-by-step examples, smaller numbers, visual representations\n- Challenge: multi-step problems, real-world contexts, create your own problem",
          "## Unit\n\n## Class\n\n## Duration\n\n## Objectives (Bloom-tagged)\n## Activities (week by week)\n## Materials\n## Assessment\n## Differentiation\n## Standards covered",
          [
            "Generate 3-5 objectives (Bloom-tagged) for {unit} in {class}",
            "Suggest a real-world application of {topic} for {class}",
            "What formative assessments would work for {unit}?"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // LESSONS
    // ------------------------------------------------------------------------
    {
      name: "Lessons",
      documents: [
        docTutorial(
          "How to use Lessons",
          "Lessons is where individual lesson plans live. Use one document per lesson. The Triple A model (Activating, Acquiring, Applying) is a good default structure: start by activating prior knowledge, acquire new content, apply with practice. For more complex lessons, use Herbart's 8 phases (Introduction, Foundation, Brain Activation, Body of New Information, Clarification, Practice and Review, Independent Practice, Closure). Always include: title, date, duration, objectives (Bloom-tagged), materials, plan, assessment, homework.",
          "Triple A lesson plan:\n- Activating (10 min): warm-up question that recalls yesterday's lesson\n- Acquiring (25 min): new content with examples and discussion\n- Applying (15 min): students practice on similar problems, group or individual\n\nHerbart 8 phases:\n1. Introduction (5 min): hook, attention\n2. Foundation (5 min): connect to prior knowledge\n3. Brain Activation (5 min): recall, warm-up\n4. Body of New Information (20 min): present new content\n5. Clarification (10 min): questions, examples\n6. Practice and Review (10 min): guided practice\n7. Independent Practice (homework)\n8. Closure (5 min): summary, preview of next lesson",
          "## My lesson planning workflow\n[When I prep (day before, week before), how long per lesson, who reviews]",
          [
            "Generate a Triple A lesson plan for {topic} in {class}",
            "What activating question would work for {topic}?",
            "Suggest 3 applying activities for {topic} that go beyond rote practice"
          ]
        ),
        docTutorial(
          "Lesson plan template",
          "Use this template for each lesson. Adapt the structure to your style: Triple A for shorter lessons, Herbart 8 phases for more complex ones. Always include: title, date, duration, class, objectives (Bloom-tagged), materials, plan, assessment, homework. After the lesson, use the reflection section to note what worked and what to change.",
          "Title: Solving linear equations (1 variable)\nDate: 2026-09-15\nDuration: 50 min\nClass: Mathematics 3A\n\nObjectives (Bloom-tagged):\n- Remember: recall the rules for solving linear equations\n- Apply: solve 1-variable linear equations\n- Create: write a word problem that requires a linear equation\n\nMaterials:\n- Worksheet 'Linear equations' (20 problems)\n- Whiteboard + markers\n- Graphing calculators (shared)\n\nPlan (Triple A):\n\nActivating (10 min):\n- Warm-up: solve 3x + 2 = 11 on the board (review from last year)\n- Question: 'What's the first thing you do when you see an equation?'\n\nAcquiring (25 min):\n- Demo: solve 2x + 5 = 13 step by step, explain each step\n- Whiteboard: 'same operation on both sides' rule\n- Guided practice: 3 problems together on the board\n\nApplying (15 min):\n- Independent practice: students do worksheet problems 1-15\n- Circulate, help struggling students\n- Fast finishers: problems 16-20 (harder)\n\nAssessment:\n- Exit ticket (last 5 min): solve 4x - 7 = 9\n\nHomework:\n- Worksheet problems 16-25 + 1 word problem from real life\n\nReflection (after the lesson):\n- What worked: activating question got students engaged\n- What to change: need more time for applying, only 3 students finished #20",
          "## Title\n\n## Date, duration, class\n\n## Objectives (Bloom-tagged)\n## Materials\n## Plan\n### Activating\n### Acquiring\n### Applying\n### Closure\n## Assessment\n## Homework\n## Reflection (after the lesson)",
          [
            "Generate a lesson plan for {topic} in {class} using Triple A",
            "What activating question would work for {topic} in {class}?",
            "Suggest differentiation strategies for {class} during the applying phase"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // ASSESSMENT
    // ------------------------------------------------------------------------
    {
      name: "Assessment",
      documents: [
        docTutorial(
          "How to use Assessment",
          "Assessment is where you track grades, rubrics, and feedback. Use one document per assessment (test, project, essay). Include the rubric, the scores, and notes on what worked. For ongoing assessment, use the Grades entity to track individual student progress. Formative assessment (exit tickets, quick checks) is as important as summative (tests, projects).",
          "Assessment types:\n- Formative: exit tickets, quizzes, peer review (low stakes, frequent)\n- Summative: tests, projects, essays (high stakes, infrequent)\n- Diagnostic: baseline assessment at start of unit (find gaps)\n\nFor each assessment:\n- What Bloom levels does it test?\n- Is it aligned to my objectives?\n- How will I use the data? (reteach, advance, individual feedback)",
          "## My assessment workflow\n[How I design assessments, how I grade, how I use the data]",
          [
            "Generate a rubric for {assignment} in {class} based on Bloom levels {levels}",
            "Which of my assessments cover the highest Bloom levels?",
            "What formative assessments would work for {unit} in {class}?"
          ]
        ),
        docTutorial(
          "Rubric template",
          "Use this template to design a rubric before the assessment. A good rubric has 3-5 performance levels (e.g. Excellent/Good/Developing/Beginning) and clear criteria for each. The criteria should align with your learning objectives and Bloom levels. Share the rubric with students BEFORE the assessment so they know what's expected.",
          "Assessment: Algebra test (50 points, 60 min)\nClass: Mathematics 3A\nDate: 2026-10-09\n\nCriteria (Bloom levels in parentheses):\n1. Correctness of solutions (Apply): does the student solve the equation correctly?\n2. Reasoning (Analyze): does the student show their work, identify relevant information?\n3. Communication (Evaluate): does the student explain their reasoning, check reasonableness?\n4. Real-world application (Create): does the student solve a word problem that requires designing an equation?\n\nPerformance levels:\n- Excellent (90-100%): all correct, clear reasoning, creative word problem\n- Good (75-89%): mostly correct, some reasoning gaps, basic word problem\n- Developing (60-74%): some errors, incomplete reasoning, partial word problem\n- Beginning (<60%): significant errors, no reasoning, no word problem\n\nPoints per section:\n- Correctness: 20\n- Reasoning: 15\n- Communication: 10\n- Real-world application: 5",
          "## Assessment\n\n## Class and date\n\n## Criteria (Bloom-tagged)\n[3-5 criteria, each aligned with one or more Bloom levels]\n\n## Performance levels\n[3-5 levels, clear descriptors]\n\n## Points per section\n[How the total points are distributed]",
          [
            "Generate a rubric for {assignment} in {class} with 4 performance levels",
            "Which Bloom levels does my rubric for {assignment} test?",
            "Suggest 3-4 criteria for assessing {skill} in {class}"
          ]
        ),
        docTutorial(
          "Test template",
          "Use this template to design a summative test. Mix Bloom levels: don't only test Remember/Understand. Include at least one Apply, one Analyze, and one Create/Evaluate if you want to assess higher-order thinking. Time the test realistically.",
          "Test: Algebra fundamentals\nClass: Mathematics 3A\nDate: 2026-10-09\nDuration: 60 min\nTotal points: 50\n\nSection 1: Remember (10 points)\n- Define: a linear equation (2 pts)\n- List: the 4 steps to solve a linear equation (4 pts)\n- Identify: which of these are linear equations? (4 pts)\n\nSection 2: Apply (15 points)\n- Solve these 5 equations (3 pts each)\n\nSection 3: Analyze (10 points)\n- Word problem: identify the variable, the constant, and the equation (5 pts)\n- Compare: which method is more efficient for this problem? (5 pts)\n\nSection 4: Create/Evaluate (10 points)\n- Real-world problem: write a word problem that requires the equation 3x + 50 = 200 to solve (5 pts)\n- Evaluate: is this solution reasonable? (5 pts)\n\nSection 5: Mixed (5 points)\n- Multi-step equation (5 pts)\n\nAnswer key: [attached separately]\n\nTime check: 60 min should be enough for most students. If students finish early, they can do extension problems.",
          "## Test\n\n## Class and date\n\n## Duration and total points\n\n## Section 1: Remember / Understand\n[10-15 points]\n\n## Section 2: Apply\n[15-20 points]\n\n## Section 3: Analyze\n[10-15 points]\n\n## Section 4: Create / Evaluate\n[10-15 points]\n\n## Mixed or extension\n[Optional, 5 points]\n\n## Answer key\n[Attached separately]\n\n## Time check",
          [
            "Generate a 50-point test for {unit} in {class} with mixed Bloom levels",
            "How long should a {n}-point test take for {class}?",
            "Suggest 3 higher-order questions for {topic} in {class}"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // STUDENTS
    // ------------------------------------------------------------------------
    {
      name: "Students",
      documents: [
        docTutorial(
          "How to use Students",
          "Students is where you keep notes on individual students: academic progress, behavior observations, accommodations, parent communications. Use one document per student. Update regularly (after each major interaction). This is the most sensitive section: respect student privacy, use anonymized IDs in shared contexts, and follow your school's data protection policies.",
          "What to track per student:\n- Academic: current grades, recent assessments, areas of strength/weakness\n- Behavior: engagement, participation, social dynamics, concerns\n- Accommodations: IEP needs, 504 plans, language support, etc.\n- Family: parent/guardian contacts, family situation, communication preferences\n- Goals: short-term and long-term goals for this student",
          "## My students tracking workflow\n[How I take notes, when I review, who has access]\n\n## Privacy practices\n[How I anonymize, how I store, who can see these notes]",
          [
            "Which students need the most attention this week?",
            "What is the academic trend for student {id} over the last month?",
            "Generate talking points for a parent-teacher conference about student {id}"
          ]
        ),
        docTutorial(
          "Student observation template",
          "Use this template to capture structured observations of a student. Distinguish facts from interpretations: 'did not submit homework 3 times in 2 weeks' is a fact; 'is disengaged' is an interpretation. Use the interpretation carefully, and only after multiple data points. Update the student document at least monthly.",
          "Student: anonymized ID\nClass: Mathematics 3A\nDate range: Sep 1 - Oct 1\n\nAcademic:\n- Current grade: 7/10 (B+)\n- Recent assessments: 8/10 (test 1), 6/10 (problem set 1), 7/10 (problem set 2)\n- Trend: stable, slight improvement in problem-solving\n- Strengths: pattern recognition, algebraic manipulation\n- Areas to develop: word problems, explaining reasoning in writing\n\nBehavior:\n- Engagement: high, participates often\n- Social: works well in groups, peers seek her help\n- Concerns: none this month\n\nAccommodations: none\n\nFamily:\n- Guardian: parent (mother), works part-time\n- Communication preference: email\n- Last contact: Sep 15 (intro email)\n\nGoals for this student:\n- Short-term: improve word problem scores by 10%\n- Long-term: prepare for math track in upper secondary",
          "## Student\n\n## Class\n\n## Date range\n\n## Academic\n- Current grade\n- Recent assessments\n- Trend\n- Strengths\n- Areas to develop\n\n## Behavior\n- Engagement\n- Social\n- Concerns\n\n## Accommodations\n\n## Family\n- Guardian\n- Communication preference\n- Last contact\n\n## Goals",
          [
            "Generate a monthly update for student {id} based on my notes",
            "What questions should I ask student {id} at the parent-teacher conference?",
            "Suggest interventions for student {id} who is struggling with {topic}"
          ]
        ),
      ],
    },

    // ------------------------------------------------------------------------
    // COMMS
    // ------------------------------------------------------------------------
    {
      name: "Comms",
      documents: [
        docTutorial(
          "How to use Comms",
          "Comms is where you keep records of communications: parent emails, colleague messages, administration directives, student meetings. Use one document per major communication thread. Keep it factual: what was said, what was decided, what are the next steps. Don't put sensitive information here that you wouldn't want to be discoverable.",
          "What to capture:\n- Date, person(s), channel (email, in-person, phone)\n- Topic and key points\n- Decisions or agreements\n- Next steps and who owns them\n- Follow-up date (and reminder)\n\nWhen to use:\n- Parent-teacher conference\n- Student behavior incident\n- Colleague collaboration (curriculum, accommodation)\n- Administration directive",
          "## My communication workflow\n[When I record, how I anonymize, how I follow up]",
          [
            "What parent communications do I need to follow up on this week?",
            "Generate a draft email to a parent about {topic} for student {id}",
            "Which communications are still open (no resolution yet)?"
          ]
        ),
        docTutorial(
          "Parent communication template",
          "Use this template for any parent communication. Be factual, kind, and solution-focused. Start with what the student is doing well, then address concerns, then propose next steps. End with an invitation to continue the conversation. Save the email or note here for your records.",
          "Date: 2026-10-15\nChannel: email\nParent: mother of student {id}\nClass: Mathematics 3A\nRe: Mid-term progress update\n\nDear [Parent name],\n\nI wanted to share an update on [student name]'s progress in Mathematics 3A.\n\nStrengths:\n- [student name] has shown strong skills in algebraic manipulation, scoring 8/10 on the recent test.\n- She actively participates in class and works well in group activities.\n\nAreas to work on:\n- Word problems have been more challenging (6/10 on problem set 1, 7/10 on problem set 2). She's making progress, but could benefit from extra practice.\n\nNext steps:\n- I'll be assigning targeted word problem exercises in the next 2 weeks.\n- If you'd like to support at home, focusing on real-world math (budgets, measurements, distances) tends to be more engaging than textbook problems.\n\nI'd be happy to discuss this further at the parent-teacher conference on [date], or by email if you have questions.\n\nBest regards,\n[Teacher name]",
          "## Date and channel\n\n## Person\n\n## Class and subject\n\n## Re (subject)\n\n## Strengths\n[Start positive: what is the student doing well?]\n\n## Areas to work on\n[Factual, specific, with examples]\n\n## Next steps\n[What I will do, what they can do at home, when we'll check in]\n\n## Follow-up\n[Date and method]",
          [
            "Generate a draft email to a parent about {topic} for student {id}",
            "Suggest 3 things to say at the start of a parent-teacher conference about {issue}",
            "How do I phrase a concern about {behavior} without making the parent defensive?"
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
          "Archive is for past years, retired classes, completed units. Move notes here when: a class is done, a year ends, a unit is fully taught, a major project is complete. Archived notes are searchable but out of the way. Review the archive at the end of each year: it's your teaching portfolio.",
          "Move notes here when:\n- A class is finished (year or semester ended)\n- A unit is fully taught (and you won't teach it again this year)\n- A project is complete\n- A school year ends\n\nWhat to keep:\n- Successful lesson plans (you'll reuse them)\n- Rubrics that worked well\n- Student work that exemplifies your teaching\n- Reflections on what worked and what didn't",
          "## My archive policy\n[When I archive, how I review, what I keep for reuse]",
          [
            "Find all my lesson plans for {topic} across years",
            "What units did I teach in {year}?",
            "Which of my archived rubrics would work for {new_assignment}?"
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
      name: "Class",
      icon: "🏫",
      color: "#3498DB",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "level", type: "enum", enum_values: ["school", "university"] },
        { name: "subject", type: "text" },
        { name: "year", type: "text", note: "e.g. 2026-2027, Fall 2026" },
        { name: "students_count", type: "number" },
        { name: "room", type: "text" },
      ],
    },
    {
      name: "Student",
      icon: "🧑‍🎓",
      color: "#9B59B6",
      fields: [
        { name: "name", type: "text", required: true, note: "Real name or anonymized ID — depends on your privacy policy" },
        { name: "class", type: "text" },
        { name: "level", type: "enum", enum_values: ["school", "university"] },
        { name: "current_grade", type: "text", note: "Letter, percentage, or descriptive" },
        { name: "notes", type: "text" },
      ],
    },
    {
      name: "Unit",
      icon: "📦",
      color: "#4A90E2",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "class", type: "text" },
        { name: "subject", type: "text" },
        { name: "duration_weeks", type: "number" },
        { name: "objectives", type: "text", note: "Bloom-tagged objectives" },
      ],
    },
    {
      name: "Lesson",
      icon: "📅",
      color: "#F5A623",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "class", type: "text" },
        { name: "unit", type: "text" },
        { name: "date", type: "date" },
        { name: "duration_min", type: "number" },
        { name: "objectives", type: "text", note: "Bloom-tagged" },
        { name: "status", type: "enum", enum_values: ["draft", "ready", "delivered", "reviewed"] },
      ],
    },
    {
      name: "Assignment",
      icon: "📝",
      color: "#E67E22",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "class", type: "text" },
        { name: "due_date", type: "date" },
        { name: "type", type: "enum", enum_values: ["homework", "essay", "lab", "project", "test", "quiz", "presentation"] },
        { name: "total_points", type: "number" },
        { name: "bloom_levels", type: "text", note: "Which Bloom levels this assignment tests" },
      ],
    },
    {
      name: "Grade",
      icon: "🎯",
      color: "#27AE60",
      fields: [
        { name: "value", type: "text", required: true, note: "e.g. 28/30, A-, 85%" },
        { name: "student", type: "text" },
        { name: "assignment", type: "text" },
        { name: "type", type: "enum", enum_values: ["formative", "summative", "diagnostic"] },
        { name: "date", type: "date" },
        { name: "weight", type: "number", note: "Percentage weight in final grade" },
      ],
    },
    {
      name: "Material",
      icon: "📚",
      color: "#1ABC9C",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "type", type: "enum", enum_values: ["slide", "worksheet", "handout", "video", "quiz", "link", "book", "other"] },
        { name: "class", type: "text" },
        { name: "subject", type: "text" },
        { name: "url", type: "text" },
      ],
    },
    {
      name: "Bloom Level",
      icon: "🧠",
      color: "#8E44AD",
      fields: [
        { name: "name", type: "enum", enum_values: ["remember", "understand", "apply", "analyze", "evaluate", "create"], required: true },
        { name: "description", type: "text", note: "What this level means in your context" },
        { name: "example_verbs", type: "text", note: "Action verbs for objectives at this level (e.g. recall, list, identify)" },
      ],
    },
    {
      name: "Standard",
      icon: "📜",
      color: "#34495E",
      fields: [
        { name: "code", type: "text", required: true, note: "Standard code (e.g. CCSS.MATH.HSA.SSE.A.1)" },
        { name: "description", type: "text" },
        { name: "subject", type: "text" },
        { name: "grade_level", type: "text" },
      ],
    },
    {
      name: "Guardian",
      icon: "👪",
      color: "#16A085",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "student", type: "text" },
        { name: "contact", type: "text", note: "Phone, email, or preferred channel" },
        { name: "relationship", type: "enum", enum_values: ["parent", "guardian", "grandparent", "other"] },
        { name: "notes", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES (none — lesson plans don't have a writing style)
  // ========================================================================
  styles: [],
  defaultStyleName: null,

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are a personal teaching assistant. Read the current document and the project structure. Suggest up to 7 brief continuations (1-2 sentences each) that help the teacher plan lessons, design assessments, support students, or apply evidence-based teaching methods (Bloom's taxonomy, Triple A, Herbart 8 phases, retrieval practice, spaced repetition, Universal Design for Learning).",
    chat: "You are an assistant for teachers. Help the user plan lessons, design assessments aligned to learning objectives, support individual students, communicate with parents, manage the classroom, and apply evidence-based teaching methods (Bloom's taxonomy, Triple A, Herbart 8 phases, retrieval practice, Universal Design for Learning). Always cite the specific document and section you are drawing from. Encourage higher-order thinking in lesson objectives. Do not invent facts or sources — if you don't know, say so. Respect student privacy.",
  },
};
