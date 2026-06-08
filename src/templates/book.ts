import type { Template } from "./_types";

// Helper: section-level tutorial (Approccio C: explanation + example + prompts)
const sectionTutorial = (title: string, explanation: string, example: string, prompts: string[]) => ({
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

// Helper: document-level tutorial (Approccio C with writable header)
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

// Helper: empty document (for chapters the user will fill)
const emptyDoc = (title: string) => ({
  title,
  body: "",
});

export const bookTemplate: Template = {
  type: "book",
  displayName: "Book",
  icon: "📖",
  description: "Long-form narrative: novel, saga, long story. Includes plot, characters, worldbuilding, chapters, research and tracking.",
  requiresStyleChoice: true,
  sections: [
    // ========================================================================
    // PLOT
    // ========================================================================
    {
      name: "Plot",
      tutorial: sectionTutorial(
        "How to set up your plot",
        "The plot section is the backbone of your novel. Use it to capture the logline, the high-level structure (3 acts, Hero's Journey, Save the Cat), the main theme and the protagonist's arc. Keep it short: a few pages at most.",
        "Logline: A retired detective is forced to take one last case when his estranged daughter becomes the prime suspect.\n\nThree-act structure: Setup (chapters 1-3), Confrontation (chapters 4-7), Resolution (chapters 8-9 + Epilogue).",
        [
          "Generate a logline for a story about {premise}",
          "Suggest a 3-act structure for a {genre} novel",
          "What are the main beats of the Hero's Journey applied to my story?",
        ]
      ),
      documents: [
        docTutorial(
          "Logline",
          "A logline is a one-sentence summary of your entire novel. It should capture the protagonist, the inciting incident, the central conflict and the stakes. A good logline is a compass: every scene should serve it.",
          "A disgraced cop must protect the sole witness to a mob hit — his own daughter — while fighting an internal affairs investigation that threatens to expose both of them.",
          "## Your logline\n[Write your one-sentence summary here]",
          [
            "Write 3 alternative loglines for a story about {premise}",
            "Does my logline clearly convey the stakes?",
            "Shorten my logline to under 30 words without losing the conflict",
          ]
        ),
        docTutorial(
          "Synopsis",
          "The synopsis is a 1-2 page summary of the entire story, from inciting incident to resolution. Write it after you know the ending. Agents and publishers require it; you need it to spot structural holes.",
          "Elena Voss, a forensic pathologist haunted by a botched autopsy, is called to a crime scene on a foggy pier. The victim appears to be a random fisherman, but the forensic evidence tells a different story: the wound pattern matches a weapon that only Elena knows about. As she digs deeper, she realises the murder is connected to the case that destroyed her career — and that the killer is someone she trusts. In the climax, Elena must choose between revealing the truth (which will free her daughter but implicate her mentor) or staying silent. She chooses truth.",
          "## Your synopsis\n[Write your 1-2 page story summary here]",
          [
            "Write a synopsis draft based on this logline: {logline}",
            "Does my synopsis have a clear midpoint turning point?",
            "Identify any plot holes in my synopsis",
          ]
        ),
        docTutorial(
          "Structure",
          "Choose a narrative structure and map your key beats. Common frameworks: 3-act (Setup / Confrontation / Resolution), Hero's Journey (12 stages), Save the Cat (15 beats). The structure is a scaffold, not a cage.",
          "Three-act structure:\n- Act 1 (chapters 1-3): Elena is called to the pier crime scene. Establishes her broken career, her strained relationship with daughter Mia.\n- Act 2 (chapters 4-7): Investigation deepens. Elena discovers the weapon signature. Mentor Jack becomes suspicious. Midpoint: Elena finds evidence Jack was at the scene.\n- Act 3 (chapters 8-9 + Epilogue): Confrontation with Jack. Elena chooses truth. Mia is safe. Epilogue: Elena rebuilds her practice.",
          "## Your structure\n[Map your key beats to your chosen framework]",
          [
            "Map my story to the Save the Cat beat sheet",
            "What should happen at the midpoint of Act 2?",
            "Suggest 3 plot twists for the end of Act 2",
          ]
        ),
        docTutorial(
          "Main Theme",
          "The theme is the central question your novel explores: redemption, identity, justice, love, freedom. Every subplot should echo the theme. Write it in one sentence, then list how each act addresses it.",
          "Theme: Truth vs. loyalty.\n\nAct 1: Elena values loyalty (covers for Jack, protects Mia).\nAct 2: Truth begins to surface (forensic evidence contradicts Jack's story).\nAct 3: Elena chooses truth over loyalty, accepting the cost.",
          "## Your theme\n[Write your central thematic question]",
          [
            "What are 3 possible themes for a story about {premise}?",
            "How can I weave my theme into every chapter without being heavy-handed?",
            "Suggest a subplot that echoes my main theme",
          ]
        ),
        docTutorial(
          "Protagonist Arc",
          "Track how your protagonist changes from beginning to end. A complete arc: flaw → catalysis → crisis → transformation. Write the 'before' and 'after' first, then fill in the journey.",
          "Before: Elena is cynical, hides behind procedure, avoids emotional connections. She covers for Jack out of loyalty.\n\nCrisis (Act 2 midpoint): Elena discovers Jack's betrayal. Her worldview (loyalty above all) collapses.\n\nAfter: Elena chooses truth even though it costs her the mentor relationship. She becomes someone who faces consequences rather than hiding from them.",
          "## Your protagonist arc\n[Describe your character's transformation]",
          [
            "Design a character arc for a {archetype} who starts with the flaw of {flaw}",
            "What is the 'crisis moment' that forces my protagonist to change?",
            "How does my protagonist's flaw create the central conflict?",
          ]
        ),
      ],
    },

    // ========================================================================
    // CHARACTERS
    // ========================================================================
    {
      name: "Characters",
      tutorial: sectionTutorial(
        "Anatomy of a character",
        "Use this section to keep track of every named character in your story. For each, capture their role (protagonist, antagonist, mentor, ally, secondary), their arc (growth, fall, transformation, static), and a short physical/psychological description. Use the AI to generate deeper profiles on demand.",
        "Name: Elena Voss\nRole: Protagonist\nArc: Growth\nAge: 42\nSkills: forensics, interrogation\nDescription: A burnt-out forensic pathologist who rediscovers her purpose through the investigation.",
        [
          "Create a protagonist profile for a {genre} novel about {premise}",
          "What psychological flaw should my antagonist have to mirror the protagonist?",
          "Suggest 3 supporting characters that complement my protagonist's arc",
        ]
      ),
      documents: [
        docTutorial(
          "Protagonist",
          "The protagonist is the character whose choices drive the story. Define: name, age, appearance, personality, flaw, desire, fear, and arc. The flaw is what makes them interesting; the desire is what moves the plot.",
          "Name: Elena Voss, 42\nAppearance: Tall, angular, dark circles under eyes. Wears her late mother's silver ring.\nPersonality: Sharp, methodical, emotionally guarded. Uses humour as deflection.\nFlaw: Avoids emotional truth; hides behind procedure.\nDesire: To solve the case and prove she is still competent.\nFear: That she is fundamentally broken, like the bodies she examines.",
          "## Your protagonist\n[Create your main character's profile]",
          [
            "Create a detailed protagonist profile for a {genre} story about {premise}",
            "What is my protagonist's greatest strength and how does it become a weakness?",
            "Write a backstory scene that reveals my protagonist's flaw",
          ]
        ),
        docTutorial(
          "Antagonist",
          "The antagonist opposes the protagonist — not necessarily a villain. The best antagonists believe they are right. Define: motivation, method, relationship to protagonist, and why they are sympathetic.",
          "Name: Jack Moretti, 55\nRole: Elena's former mentor\nMotivation: Protect his reputation and the secret he killed to hide.\nMethod: Manipulation, evidence tampering, emotional leverage.\nRelationship: Taught Elena everything she knows. She trusted him completely.\nSympathetic because: He genuinely cared for Elena once. His crime was desperate, not malicious.",
          "## Your antagonist\n[Create your antagonist's profile]",
          [
            "Create an antagonist who believes they are the hero of their own story",
            "How does my antagonist's goal directly conflict with the protagonist's?",
            "Give my antagonist one sympathetic trait that makes the reader hesitate",
          ]
        ),
        docTutorial(
          "Mentor",
          "The mentor figure guides (or misguides) the protagonist. They may be wise, flawed, deceptive, or absent. The mentor's betrayal or death is a classic turning point.",
          "Name: Jack Moretti\nRole: Mentor / Hidden Antagonist\nArc: Fall — from respected teacher to desperate cover-up artist.\nKey trait: Generous with knowledge, stingy with truth.\nFunction in story: Represents the old order Elena must outgrow.",
          "## Your mentor\n[Create your mentor figure's profile]",
          [
            "Create a mentor character who is not what they seem",
            "How does the mentor's flaw mirror or contrast the protagonist's?",
            "Write the moment the mentor's true nature is revealed",
          ]
        ),
        docTutorial(
          "Allies",
          "Allies support the protagonist. They provide skills the protagonist lacks, emotional grounding, or comic relief. Each ally should have their own agenda — not just 'help the hero'.",
          "Name: DS Ray Park, 35\nRole: Ally / Investigator\nSkills: Street-level police work, community connections.\nArc: Static — the reliable constant amid chaos.\nOwn agenda: Wants a promotion; helping Elena is also self-serving.\n\nName: Dr. Amina Osei, 38\nRole: Ally / Tech expert\nSkills: Digital forensics, data analysis.\nArc: Growth — learns to trust her own judgment over Elena's.\nOwn agenda: Proves herself after being sidelined by the department.",
          "## Your allies\n[Create profiles for your supporting cast]",
          [
            "Suggest 3 allies with complementary skills for my protagonist",
            "How can each ally have their own subplot that intersects with the main story?",
            "Write a scene where an ally disagrees with the protagonist's plan",
          ]
        ),
        docTutorial(
          "Secondary Characters",
          "Secondary characters populate your world. They appear in 1-3 scenes, deliver information, create texture, or raise stakes. Keep them distinct: each should be identifiable by a single trait or speech pattern.",
          "Character: Mrs. Leung, 70, harbour café owner.\nTrait: Speaks in proverbs. Knows everyone's business.\nFunction: Provides Elena with the victim's last meal order — the first real clue.\n\nCharacter: Tommy Voss, 16, Elena's daughter.\nTrait: Quiet, observant, draws constantly.\nFunction: Represents what Elena is fighting for. His sketchbook contains a drawing of Jack at the pier.",
          "## Your secondary characters\n[Add supporting characters here]",
          [
            "Suggest 3 secondary characters for a scene set in {location}",
            "How can a minor character deliver a crucial clue without seeming convenient?",
            "Give each secondary character a distinctive speech pattern or habit",
          ]
        ),
        docTutorial(
          "Worldbuilding Notes (Characters)",
          "Use this document to track character-related worldbuilding: social hierarchies, family trees, organizations, and power structures that affect your characters' choices.",
          "Power structure:\n- Police Department: Commissioner → Chief Inspector → DI → DS → Constable\n- Forensic Lab: Director → Senior Pathologist → Pathologist → Technician\n- Mob hierarchy: Don → Capo → Soldier → Associate\n\nFamily trees:\n- Elena Voss: Father (deceased), Mother (deceased), Ex-husband Tom, Son Tommy.\n- Jack Moretti: Wife Maria, Daughter Lisa (Elena's age — Elena is like a surrogate daughter).",
          "## Your worldbuilding notes\n[Map out social structures, families, organizations]",
          [
            "Create a family tree for my protagonist's inner circle",
            "What power dynamics exist between my main characters?",
            "Map the organizational hierarchy relevant to my story",
          ]
        ),
      ],
    },

    // ========================================================================
    // WORLD
    // ========================================================================
    {
      name: "World",
      tutorial: sectionTutorial(
        "Building your narrative world",
        "The world section is where you describe the setting: geography, history, culture, timeline. It is read by the AI to keep descriptions consistent. Even for contemporary settings, capture the city, the decade, the social context.",
        "Setting: Coastal Maine, present day.\nAtmosphere: Cold, isolating, fog-laden.\nKey locations: Voss Marine Forensics Lab, the diner on Route 1, the lighthouse keeper's cottage.",
        [
          "Suggest 5 sensory details for a scene set in {location}",
          "Create a timeline of historical events that shaped my fictional world",
          "What cultural quirks would make my setting feel authentic?",
        ]
      ),
      documents: [
        docTutorial(
          "Setting",
          "Define the primary setting: place, time period, atmosphere, and how it affects the characters. The setting should feel like a character itself — it constrains, enables, or reflects the protagonist's inner state.",
          "Place: Greyharbour, Maine. Population 12,000.\nTime: October, present day.\nAtmosphere: Perpetual fog, salt air, creaking docks. The town is dying — the cannery closed five years ago.\nHow it reflects Elena: Greyharbour is stuck in the past, just like Elena. Both need to let go.",
          "## Your setting\n[Describe your primary setting]",
          [
            "Describe {location} using all five senses",
            "How does the setting mirror my protagonist's emotional state?",
            "Suggest 3 ways the setting creates obstacles for the characters",
          ]
        ),
        docTutorial(
          "Geography",
          "Map the physical layout of your world. Where are key locations relative to each other? How do characters move through the space? Geography constrains plot — a character 3 hours away cannot casually show up.",
          "Greyharbour geography:\n- Pier (crime scene): 2km north of town centre.\n- Forensic Lab: In the old cannery building, east side of harbour.\n- Elena's house: Clifftop road, 15 min drive from lab.\n- Jack's house: Estate on the hill, overlooking the harbour.\n- The diner: Route 1, between the lab and town.",
          "## Your geography\n[Map your key locations and their relationships]",
          [
            "Create a map of my story's key locations",
            "What geographical feature could create a dramatic isolation scene?",
            "How does distance between locations affect the pacing of my plot?",
          ]
        ),
        docTutorial(
          "History & Lore",
          "Every world has a history that predates the story. Write the 3-5 key historical events that shaped the present. This gives depth: characters inherit a world with scars.",
          "Greyharbour history:\n1. 1847: Founded as a fishing port by Irish immigrants.\n2. 1923: The lighthouse was built after 12 shipwrecks.\n3. 1987: The cannery opened, tripled the population.\n4. 2019: Cannery closed. Youth exodus began.\n5. 2023: The pier partially collapsed — cover-up of structural neglect by the town council (connected to Jack).",
          "## Your history & lore\n[Write the key historical events of your world]",
          [
            "Create 5 historical events that shaped my fictional town",
            "What secret from the past connects to the present-day plot?",
            "How does the history of this place affect the mood of the story?",
          ]
        ),
        docTutorial(
          "Cultures & Society",
          "Define the social fabric: class divisions, cultural norms, local traditions, taboos. This informs how characters speak, what they value, and what they avoid.",
          "Greyharbour society:\n- Class divide: Old fishing families (tight-knit, suspicious of outsiders) vs. seasonal tourists.\n- Tradition: Annual Blessing of the Fleet (Elena's father used to participate).\n- Taboo: You don't talk about the cannery closure. It's like a death in the family.\n- Local dialect: 'Wicked' means very. 'The harbour' means the whole town, not just the water.",
          "## Your cultures & society\n[Describe the social dynamics of your world]",
          [
            "What social taboo could create tension between characters?",
            "How does class or cultural division affect my protagonist?",
            "Suggest a local tradition that could become a scene setting",
          ]
        ),
        docTutorial(
          "Timeline",
          "Build a chronological timeline of events — both the story's backstory and the plot itself. This prevents continuity errors and helps you pace reveals.",
          "Timeline:\n- 2015: Elena's botched autopsy. Suspended 6 months.\n- 2016: Returns to work. Jack covers for her.\n- 2020: Elena's divorce from Tom.\n- 2024, Oct 3: Victim found on pier. Elena called.\n- Oct 3-7: Investigation. Elena discovers weapon signature.\n- Oct 8: Midpoint — Elena finds Jack's alibi is false.\n- Oct 9-12: Act 3 — Confrontation, arrest, aftermath.",
          "## Your timeline\n[Map out the chronological events of your story]",
          [
            "Create a day-by-day timeline for my story's main events",
            "What event in the backstory is the 'original sin' that the plot unravels?",
            "Check my timeline for continuity errors",
          ]
        ),
      ],
    },

    // ========================================================================
    // PROPS & THEMES
    // ========================================================================
    {
      name: "Props & Themes",
      tutorial: sectionTutorial(
        "Symbols and themes",
        "Props and themes are the recurring elements that give your story depth: a locket passed between generations, the motif of water, the theme of redemption. Track them here so they resonate consistently across chapters.",
        "Prop: The lighthouse key.\nOwner: Elena's father.\nArc: Lost in chapter 1, recovered in chapter 9 as the evidence that clears her daughter.\n\nTheme: Truth vs. loyalty.\nSymbols: lighthouse beam, fog, forensic photographs.",
        [
          "Suggest 3 recurring symbols for a novel about {theme}",
          "How can I weave the locket into all three acts without being heavy-handed?",
          "What secondary theme would complement my main theme of {theme}?",
        ]
      ),
      documents: [
        docTutorial(
          "Significant Objects",
          "Track props that carry meaning: a key, a letter, a weapon, a photograph. Each object should have an arc — where it appears, what it means, how its meaning changes.",
          "Object: The lighthouse key\nFirst appearance: Chapter 1 (Elena finds it in her father's things).\nMeaning: Connection to her past, to the harbour.\nChange: In chapter 9, it opens the lighthouse where Jack hid evidence. The key becomes proof, not nostalgia.\n\nObject: Forensic photographs\nFirst appearance: Chapter 2 (crime scene).\nMeaning: Truth — they don't lie.\nChange: Jack forges one to frame someone else. Elena must distinguish real from fake.",
          "## Your significant objects\n[Track your story's important props]",
          [
            "Suggest 3 objects that could serve as MacGuffins in my story",
            "How can an object's meaning change between Act 1 and Act 3?",
            "Create a prop that connects two characters who never meet",
          ]
        ),
        docTutorial(
          "Narrative Themes",
          "Themes are the abstract questions your novel explores. Write each theme as a question, then list how each act addresses it. A novel can hold 1-3 themes without becoming didactic.",
          "Theme 1: Truth vs. loyalty\n- Act 1: Elena chooses loyalty (covers for Jack).\n- Act 2: Truth emerges (evidence contradicts Jack).\n- Act 3: Elena chooses truth, accepts the cost.\n\nTheme 2: Redemption\n- Elena's arc: from broken to whole.\n- Jack's arc: from respected to fallen.\n- Tommy's arc: from invisible to seen.",
          "## Your narrative themes\n[Define your story's central questions]",
          [
            "What are the 2-3 central questions my novel explores?",
            "How does each act advance or complicate my themes?",
            "Suggest a scene that embodies my theme without stating it",
          ]
        ),
        docTutorial(
          "Recurring Symbols",
          "Symbols are concrete images that represent abstract ideas. The fog = obscurity. The lighthouse = truth. Track where each symbol appears and how its meaning deepens.",
          "Symbol: Fog\nChapter 1: Thick fog at the pier — Elena can't see clearly (literal + metaphorical).\nChapter 5: Fog clears during a key revelation — Elena sees the truth.\nChapter 9: Fog returns — the truth is complicated, not simple.\n\nSymbol: Lighthouse beam\nChapter 1: Seen from a distance — Elena's goal (truth) feels far away.\nChapter 9: Elena stands inside the lighthouse — she has become the truth.\n\nSymbol: Forensic photographs\nRecurring: Appear in every act. Shift from evidence (Act 1) to weapon (Act 2) to proof (Act 3).",
          "## Your recurring symbols\n[Track symbols and their appearances across chapters]",
          [
            "Suggest 3 visual symbols for a story about {theme}",
            "How can I introduce a symbol in Act 1 and pay it off in Act 3?",
            "What symbol could represent my protagonist's inner transformation?",
          ]
        ),
        docTutorial(
          "Visual Motifs",
          "Motifs are repeated visual or sensory patterns: the colour red, the sound of waves, the smell of antiseptic. They create atmosphere and subconscious connections between scenes.",
          "Motif: Blue light\n- The forensic lab's UV灯 casts everything in blue.\n- The lighthouse beam is blue at night.\n- Elena's kitchen light is blue (she lives in a cold, sterile world).\n- Change: In the final scene, she turns on a warm yellow lamp. Her world warms.\n\nMotif: Salt\n- Salt air, salt water, salt on wound margins.\- Elena's hands are always salty from the harbour.\n- Jack offers her a salt-rimmed margarita in chapter 7 (false warmth).",
          "## Your visual motifs\n[Define recurring sensory patterns]",
          [
            "What sensory motif could unify my chapters?",
            "How can a colour motif shift meaning across the story?",
            "Suggest 3 sound motifs for a scene in {location}",
          ]
        ),
      ],
    },

    // ========================================================================
    // CHAPTERS
    // ========================================================================
    {
      name: "Chapters",
      tutorial: sectionTutorial(
        "Chapter structure",
        "The Chapters section holds your scenes. Each chapter is a document. Use the synopsis at the top of each chapter to remember where the story is going. Target a word count per chapter (typical: 2000-5000 words).",
        "Chapter 1: The Body. Word count target: 3000.\nSynopsis: Elena is called to a crime scene on a foggy pier. The victim appears to be a random fisherman, but the wound pattern tells a different story.\nStatus: draft.",
        [
          "Write the opening paragraph of chapter {n}",
          "What's a strong hook I can place at the end of this chapter?",
          "Suggest a midpoint twist for chapter {n}",
        ]
      ),
      documents: [
        docTutorial(
          "Scene Template",
          "Use this template for every new scene. Fill in: POV character, location, time, scene goal (what the POV character wants), conflict (what blocks them), and outcome (what changes).",
          "POV: Elena\nLocation: Pier, Greyharbour\nTime: October 3, 6:15 AM\nScene goal: Identify the victim.\nConflict: The body has been moved; the scene is contaminated.\nOutcome: Elena recognises the wound pattern from a case she thought was closed.\nWord count: 2800\nStatus: complete.",
          "## New scene\n[Use this template for your next scene]",
          [
            "Write a scene outline using the template format",
            "What conflict should I introduce in this scene?",
            "Suggest a cliffhanger ending for this scene",
          ]
        ),
        // --- ACT 1 ---
        emptyDoc("Act 1, Chapter 1"),
        emptyDoc("Act 1, Chapter 2"),
        emptyDoc("Act 1, Chapter 3"),
        // --- ACT 2 ---
        emptyDoc("Act 2, Chapter 4"),
        emptyDoc("Act 2, Chapter 5"),
        emptyDoc("Act 2, Chapter 6"),
        emptyDoc("Act 2, Chapter 7"),
        // --- ACT 3 ---
        emptyDoc("Act 3, Chapter 8"),
        emptyDoc("Act 3, Chapter 9"),
        emptyDoc("Epilogue"),
      ],
    },

    // ========================================================================
    // RESEARCH
    // ========================================================================
    {
      name: "Research",
      tutorial: sectionTutorial(
        "Where to find references",
        "Use this section to dump everything that informs your writing: real-world facts, locations you visited, articles, books, films, pictures. The AI will read it to ground your prose in reality.",
        "Topic: Lighthouse keepers of coastal Maine.\nSources: 'The Light Between Oceans' (film), Maine Lighthouse Museum archives, NOAA weather logs.",
        [
          "Find historical facts about {topic}",
          "Describe a {location} in sensory detail",
          "What are the technical steps of {procedure}?",
        ]
      ),
      documents: [
        docTutorial(
          "Research Notes",
          "Dump all your research here: facts, quotes, statistics, observations. Don't organise yet — just capture. The AI can help you structure it later.",
          "Research: Forensic pathology\n- Cause of death determination: autopsy examines external + internal.\n- Lividity: settles within 2-6 hours, fixed after 8. Can determine if body was moved.\n- Tool mark analysis: wound pattern can identify the weapon.\n\nResearch: Maine fishing industry\n- Lobster season: June-December.\n- Average income: $40,000/year (declining).\n- Demographics: aging population, young people leave.",
          "## Your research notes\n[Dump your research here — facts, observations, sources]",
          [
            "Summarise the key facts I need for a scene about {topic}",
            "What details would make a {location} scene feel authentic?",
            "Fact-check this passage: {paste text}",
          ]
        ),
        docTutorial(
          "References",
          "List books, films, articles, and other creative works that inspire or inform your novel. Include what you took from each (not just the title).",
          "References:\n1. 'The Light Between Oceans' (film, 2016) — isolated lighthouse setting, moral dilemma structure.\n2. 'Mystic River' (film, 2003) — crime in a tight-knit community, unreliable institutions.\n3. 'The Secret History' (novel, Tartt) — how a group keeps a terrible secret.\n4. Maine Lighthouse Museum archives — authentic details about lighthouse operations.\n5. NOAA coastal weather data — fog patterns, storm timing for October.",
          "## Your references\n[List the works that inspire and inform your novel]",
          [
            "Suggest 5 books similar to my novel for research",
            "What can I learn from {reference} about {aspect}?",
            "How did {author} handle a similar theme to mine?",
          ]
        ),
        docTutorial(
          "Visual Inspirations",
          "Collect images, colour palettes, photographs, and visual references. A single image can inspire an entire scene. Describe what drew you to each image.",
          "Image 1: Fog rolling over a wooden pier at dawn. Grey palette. A single figure in a raincoat.\n→ Inspired: Opening scene of Chapter 1.\n\nImage 2: Forensic lab under UV light. Blue-white, sterile, almost beautiful.\n→ Inspired: Elena's workspace. The blue motif.\n\nImage 3: Abandoned cannery building, rust and broken windows.\n→ Inspired: The forensic lab's location. Decay + science.",
          "## Your visual inspirations\n[Collect images and describe what they inspire]",
          [
            "Describe a {mood} image that could inspire my next scene",
            "What colour palette matches the atmosphere of my novel?",
            "Suggest 3 visual references for a scene set in {location}",
          ]
        ),
        docTutorial(
          "Reference Author",
          "Choose one author whose style, structure, or approach you want to learn from. Study how they handle the specific challenges you face: pacing, dialogue, description, reveals.",
          "Reference author: Dennis Lehane\nStudy:\n- 'Mystic River': How he handles a crime investigation in a small community.\n- 'Shutter Island': How he structures unreliable narration.\n- Dialogue technique: Short, punchy, character-specific speech patterns.\n- Pacing: Slow-burn investigation with escalating personal stakes.\n- Theme handling: Justice vs. truth, loyalty vs. self-preservation.",
          "## Your reference author\n[Study how a master handles your specific challenges]",
          [
            "What techniques does {author} use for {aspect}?",
            "How would {author} write a scene about {situation}?",
            "Analyse {author}'s dialogue style and suggest how I can adapt it",
          ]
        ),
        docTutorial(
          "Genre Best Practices",
          "Document the conventions of your genre: what readers expect, what tropes to use or subvert, what pitfalls to avoid. This is especially useful for genre fiction (thriller, romance, sci-fi, fantasy).",
          "Genre: Crime thriller / mystery\nExpectations:\n- Clear crime in chapter 1.\n- Clues planted fairly (reader should be able to solve it).\n- Escalating stakes.\n- Satisfying resolution (justice served or deliberately subverted).\n\nPitfalls to avoid:\n- 'Butler did it' — solutions that require information the reader couldn't have.\n- Info-dumps disguised as dialogue.\n- Red herrings that are genuinely misleading (vs. fairly redirecting).",
          "## Your genre best practices\n[Document what your genre demands]",
          [
            "What are the 5 must-have elements of a {genre} novel?",
            "What tropes should I use and which should I subvert?",
            "What are the most common pitfalls in {genre} writing?",
          ]
        ),
      ],
    },

    // ========================================================================
    // TRACKING
    // ========================================================================
    {
      name: "Tracking",
      tutorial: sectionTutorial(
        "Tracking your progress",
        "Use this section to keep writing momentum. Track daily word counts, your weekly targets, and the revision passes you have done. Open it every time you sit down to write.",
        "Weekly target: 5000 words.\nCurrent streak: 4 days.\nRevisions done: 2 (developmental, line edit).",
        [
          "What is a realistic daily word count goal for me given {constraints}?",
          "Suggest a revision plan for my {genre} novel",
          "How do I avoid burnout during NaNoWriMo?",
        ]
      ),
      documents: [
        docTutorial(
          "Daily Word Count",
          "Log your daily word count here. Seeing the numbers grow is motivating. Track: date, chapter worked on, words written, cumulative total.",
          "Date | Chapter | Words | Cumulative\nOct 3 | Ch 1 | 1,200 | 1,200\nOct 4 | Ch 1 | 1,800 | 3,000\nOct 5 | Ch 2 | 2,100 | 5,100\nOct 6 | — (rest) | 0 | 5,100\nOct 7 | Ch 2 | 900 | 6,000",
          "## Daily word count log\n[Track your daily writing output]",
          [
            "Set a realistic daily word count goal for a {schedule} schedule",
            "How many words per day to finish a {length} novel in {timeframe}?",
            "Suggest strategies to hit my daily word count when I'm stuck",
          ]
        ),
        docTutorial(
          "Writing Goals",
          "Define your writing goals: daily target, weekly target, completion deadline, and personal milestones (first draft, revision, submission).",
          "Goals:\n- Daily: 1,500 words minimum.\n- Weekly: 7,500 words (5 writing days).\n- First draft deadline: March 1, 2027.\n- Revision deadline: June 1, 2027.\n- Personal milestone: Finish Act 1 by December 2026.\n\nStreak: 4 days (best: 12 days in September).",
          "## Your writing goals\n[Set your targets and milestones]",
          [
            "Create a writing schedule that fits my {constraints}",
            "Break my novel into a week-by-week word count plan",
            "What's a realistic deadline for a {length} {genre} novel?",
          ]
        ),
        docTutorial(
          "Revisions Done",
          "Track every revision pass: date, type (developmental, line, copy, proofread), what you changed, and what still needs work.",
          "Revision 1 — Developmental (Oct 2026):\n- Restructured Act 2: moved midpoint revelation from Ch 6 to Ch 5.\n- Cut 2,000 words of backstory from Ch 3.\n- Added 3 scenes with Tommy.\nStatus: Complete.\n\nRevision 2 — Line edit (Nov 2026):\n- Tightened dialogue in Ch 1-4.\n- Fixed timeline inconsistency in Ch 5.\n- Improved sensory descriptions in pier scenes.\nStatus: Complete.\n\nNext: Copy edit (December 2026).",
          "## Your revisions\n[Track each revision pass and what changed]",
          [
            "Suggest a revision plan for my first draft",
            "What are the most common issues to fix in a developmental edit?",
            "Create a checklist for my copy edit pass",
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
      name: "Character",
      icon: "👤",
      color: "#4a90d9",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "role", type: "enum", enum_values: ["protagonist", "antagonist", "mentor", "ally", "secondary"] },
        { name: "arc", type: "enum", enum_values: ["growth", "fall", "transformation", "static"] },
        { name: "age", type: "number" },
        { name: "skills", type: "text", note: "Comma-separated" },
        { name: "description", type: "text" },
        { name: "imageUrl", type: "text" },
      ],
    },
    {
      name: "Location",
      icon: "🌍",
      color: "#38c172",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "importance", type: "enum", enum_values: ["primary", "secondary", "background"] },
        { name: "atmosphere", type: "text" },
        { name: "timePeriod", type: "text" },
        { name: "description", type: "text" },
      ],
    },
    {
      name: "Object",
      icon: "📦",
      color: "#e4a700",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "significance", type: "enum", enum_values: ["primary", "secondary", "background"] },
        { name: "owner", type: "text" },
        { name: "arc", type: "text", note: "Where the object appears and what happens to it" },
        { name: "description", type: "text" },
      ],
    },
    {
      name: "Event",
      icon: "⚡",
      color: "#e74c3c",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "act", type: "enum", enum_values: ["1", "2", "3"] },
        { name: "importance", type: "enum", enum_values: ["primary", "secondary", "background"] },
        { name: "pov", type: "text" },
        { name: "description", type: "text" },
      ],
    },
    {
      name: "Theme",
      icon: "💡",
      color: "#9b59b6",
      fields: [
        { name: "name", type: "text", required: true, note: 'e.g. "Truth as Treasure"' },
        { name: "importance", type: "enum", enum_values: ["core", "supporting"] },
        { name: "symbols", type: "text", note: "Comma-separated" },
        { name: "description", type: "text" },
      ],
    },
  ],

  // ========================================================================
  // WRITING STYLES
  // ========================================================================
  styles: [
    { name: "Hemingway", fragment: "Essential style: short, rhythmic sentences, implied rather than stated emotions. Journalistic 'iceberg theory' (show 10%, hide 90%). Simple lexicon, active verbs, no superfluous adjectives." },
    { name: "Calvino", fragment: "Imaginative prose, short rhythmic sentences, unexpected metaphors, lightness combined with depth. Irony, the fantastic mixed with the everyday, attention to sensory detail. Avoid technical jargon, prefer images." },
    { name: "Le Guin", fragment: "Clear, meditative, deep worldbuilding integrated into narration. Contemplative tone, clean prose, exploration of philosophical themes through story. Few physical descriptions, much character introspection." },
    { name: "Stephen King", fragment: "Descriptive, friendly narrator with implied second person, growing tension. Realistic dialogue with cinematic cuts, detailed horror/detective scenes. Colloquial but precise tone." },
    { name: "Asimov", fragment: "Scientific, logical, functional dialogue. Exposition of technical concepts made accessible. Rationalist style, essential prose, didactic where needed. Detailed worldbuilding (robotics, physics, sociology)." },
    { name: "Tolkien", fragment: "Epic, layered worldbuilding (languages, myths, geography), elevated and solemn tone. Detailed descriptions of landscapes and architecture. Choral narration (many points of view). Rich lexicon, musical prose." },
    { name: "Murakami", fragment: "Surreal, introspective, the everyday plus the strange. Reflective first person, detailed descriptions of food, music, habits. Surreal events presented in flat tone. Suspended atmospheres, subtle melancholy." },
    { name: "Pushkin", fragment: "Russian classic, elegant, fluid and ironic narration. Versatile (poetry, prose, theatre), terse and light prose, lively characters in few strokes. Balance between lyricism and wit." },
    { name: "Dostoevsky", fragment: "Psychological, intense, philosophical dialogues. Exploration of inner torment, deep moral conflicts. Dramatic tone, long interior monologues, vocation for analysing motivations." },
    { name: "Custom", fragment: "" },
    { name: "User", fragment: "Adapt to the user's personal writing style. Observe the existing text and match its tone, rhythm and vocabulary." },
    { name: "None", fragment: "" },
  ],
  defaultStyleName: "Hemingway",

  // ========================================================================
  // PROMPTS
  // ========================================================================
  prompts: {
    suggestions: "You are a literary editor specialised in long-form narrative. Read the current document and the project structure. Suggest up to 7 brief continuations, each 1-2 sentences, that respect the established tone, characters and style.",
    chat: "You are an assistant for novelists. Help the user create character profiles, analyse consistency, suggest the next scene, expand existing scenes, revise dialogue, and brainstorm worldbuilding details. Always respect the chosen writing style.",
  },
};
