import type { Template } from "./_types";

const bookTutorialPattern = (title: string, explanation: string, example: string, prompts: string[]) => ({
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

export const bookTemplate: Template = {
  type: "book",
  displayName: "Book",
  icon: "📖",
  description: "Long-form narrative: novel, saga, long story. Includes plot, characters, worldbuilding, chapters, research and tracking.",
  requiresStyleChoice: true,
  sections: [
    {
      name: "Plot",
      tutorial: bookTutorialPattern(
        "How to set up your plot",
        "The plot section is the backbone of your novel. Use it to capture the logline, the high-level structure (3 acts, Hero's Journey, Save the Cat), the main theme and the protagonist's arc. Keep it short: a few pages at most.",
        "Logline: A retired detective is forced to take one last case when his estranged daughter becomes the prime suspect.\n\nThree-act structure: Setup (chapters 1-3), Confrontation (chapters 4-7), Resolution (chapters 8-9 + Epilogue).",
        [
          "Generate a logline for a story about {premise}",
          "Suggest a 3-act structure for a {genre} novel",
          "What are the main beats of the Hero's Journey applied to my story?",
        ]
      ),
    },
    {
      name: "Characters",
      tutorial: bookTutorialPattern(
        "Anatomy of a character",
        "Use this section to keep track of every named character in your story. For each, capture their role (protagonist, antagonist, mentor, ally, secondary), their arc (growth, fall, transformation, static), and a short physical/psychological description. Use the AI to generate deeper profiles on demand.",
        "Name: Elena Voss\nRole: Protagonist\nArc: Growth\nAge: 42\nSkills: forensics, interrogation\nDescription: A burnt-out forensic pathologist who rediscovers her purpose through the investigation.",
        [
          "Create a protagonist profile for a {genre} novel about {premise}",
          "What psychological flaw should my antagonist have to mirror the protagonist?",
          "Suggest 3 supporting characters that complement my protagonist's arc",
        ]
      ),
    },
    {
      name: "World",
      tutorial: bookTutorialPattern(
        "Building your narrative world",
        "The world section is where you describe the setting: geography, history, culture, timeline. It is read by the AI to keep descriptions consistent. Even for contemporary settings, capture the city, the decade, the social context.",
        "Setting: Coastal Maine, present day.\nAtmosphere: Cold, isolating, fog-laden.\nKey locations: Voss Marine Forensics Lab, the diner on Route 1, the lighthouse keeper's cottage.",
        [
          "Suggest 5 sensory details for a scene set in {location}",
          "Create a timeline of historical events that shaped my fictional world",
          "What cultural quirks would make my setting feel authentic?",
        ]
      ),
    },
    {
      name: "Props & Themes",
      tutorial: bookTutorialPattern(
        "Symbols and themes",
        "Props and themes are the recurring elements that give your story depth: a locket passed between generations, the motif of water, the theme of redemption. Track them here so they resonate consistently across chapters.",
        "Prop: The lighthouse key.\nOwner: Elena's father.\nArc: Lost in chapter 1, recovered in chapter 9 as the evidence that clears her daughter.\n\nTheme: Truth vs. loyalty.\nSymbols: lighthouse beam, fog, forensic photographs.",
        [
          "Suggest 3 recurring symbols for a novel about {theme}",
          "How can I weave the locket into all three acts without being heavy-handed?",
          "What secondary theme would complement my main theme of {theme}?",
        ]
      ),
    },
    {
      name: "Chapters",
      documents: [
        { title: "Act 1 - Chapter 1" },
        { title: "Act 2 - Chapter 2" },
        { title: "Act 3 - Chapter 3" },
      ],
      tutorial: bookTutorialPattern(
        "Chapter structure",
        "The Chapters section holds your scenes. Each chapter is a document. Use the synopsis at the top of each chapter to remember where the story is going. Target a word count per chapter (typical: 2000-5000 words).",
        "Chapter 1: The body. Word count target: 3000.\nSynopsis: Elena is called to a crime scene on a foggy pier. The victim is a fisherman; the cause of death is not drowning.\nStatus: draft.",
        [
          "Write the opening paragraph of chapter {n}",
          "What's a strong hook I can place at the end of this chapter?",
          "Suggest a midpoint twist for chapter {n}",
        ]
      ),
    },
    {
      name: "Research",
      tutorial: bookTutorialPattern(
        "Where to find references",
        "Use this section to dump everything that informs your writing: real-world facts, locations you visited, articles, books, films, pictures. The AI will read it to ground your prose in reality.",
        "Topic: Lighthouse keepers of coastal Maine.\nSources: 'The Light Between Oceans' (film), Maine Lighthouse Museum archives, NOAA weather logs.",
        [
          "Find historical facts about {topic}",
          "Describe a {location} in sensory detail",
          "What are the technical steps of {procedure}?",
        ]
      ),
    },
    {
      name: "Tracking",
      tutorial: bookTutorialPattern(
        "Tracking your progress",
        "Use this section to keep writing momentum. Track daily word counts, your weekly targets, and the revision passes you have done. Open it every time you sit down to write.",
        "Weekly target: 5000 words.\nCurrent streak: 4 days.\nRevisions done: 2 (developmental, line edit).",
        [
          "What is a realistic daily word count goal for me given {constraints}?",
          "Suggest a revision plan for my {genre} novel",
          "How do I avoid burnout during NaNoWriMo?",
        ]
      ),
    },
  ],
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
  prompts: {
    suggestions: "You are a literary editor specialised in long-form narrative. Read the current document and the project structure. Suggest up to 7 brief continuations, each 1-2 sentences, that respect the established tone, characters and style.",
    chat: "You are an assistant for novelists. Help the user create character profiles, analyse consistency, suggest the next scene, expand existing scenes, revise dialogue, and brainstorm worldbuilding details. Always respect the chosen writing style.",
  },
};
