import type { Template, TemplateSectionSpec, TemplateEntityTypeSpec } from "./_types";

const recipeExampleBody = [
  "## Example recipe",
  "Name: Roast chicken with lemons",
  "Region: international",
  "Season: autumn",
  "Servings: 4",
  "Prep time: 20 min",
  "Cooking time: 1 h 15 min",
  "Difficulty: easy",
  "Cost: medium",
  "Allergens: ",
  "Diet: omnivore",
  "",
  "### Ingredients",
  "- 1.5 kg whole chicken",
  "- 2 lemons",
  "- 4 garlic cloves",
  "- Fresh rosemary, thyme",
  "- Olive oil, salt, pepper",
  "",
  "### Procedure",
  "1. Preheat oven to 200°C.",
  "2. Stuff the cavity with lemon halves, garlic and herbs.",
  "3. Rub the skin with olive oil, salt and pepper.",
  "4. Roast for 1 h 15 min, basting every 20 min.",
  "5. Rest 10 min before carving.",
  "",
  "### Service and storage notes",
  "Resting is critical for a juicy breast. Pairs well with roasted potatoes and a green salad. Store leftovers refrigerated up to 3 days.",
  "",
  "## How to create a new recipe",
  "Use the structure above as a template. The AI will pick up the structured fields to filter recipes by region, season, allergens and diet.",
  "",
  "## Suggested prompts",
  '- Ask the AI: "Generate a complete recipe card for {dish name}"',
  '- Ask the AI: "Scale this recipe from 4 to 8 servings"',
  '- Ask the AI: "Suggest 3 substitutions for {ingredient}"',
].join("\n");

const chefTutorial = (title: string, intro: string, prompts: string[]) => ({
  title,
  body: [
    intro,
    "",
    recipeExampleBody,
    "",
    "## Suggested prompts",
    ...prompts.map((p) => `- Ask the AI: "${p}"`),
  ].join("\n"),
});

const sectionWithRecipeTutorial = (
  name: string,
  intro: string,
  prompts: string[]
): TemplateSectionSpec => ({
  name,
  tutorial: chefTutorial(name, intro, prompts),
});

const chefAFlatSections: TemplateSectionSpec[] = [
  sectionWithRecipeTutorial("Bases, stocks and core", "Start your recipe book with the foundations: stocks, sauces, doughs, mother preparations. These are the building blocks you will reuse across the menu.", [
    "Generate a base recipe for a classic chicken stock",
    "What is the correct ratio water-to-bones for a brown stock?",
    "Explain the difference between a fond and a jus",
  ]),
  sectionWithRecipeTutorial("Appetizers", "Appetizers open the meal. This section gathers starters, amuse-bouche, small bites and cold plates.", [
    "Suggest 5 seasonal appetizers for autumn",
    "Generate a recipe card for a vegetarian amuse-bouche",
    "What plating works best for a one-bite amuse-bouche?",
  ]),
  sectionWithRecipeTutorial("First courses", "First courses include pasta, rice, soups, gnocchi. Use this section to keep your pasta logic organised by type and cooking method.", [
    "Which pasta shape works best with a thick meat ragù?",
    "Generate a recipe card for a classic Roman carbonara",
    "Suggest a vegetarian first course with seasonal vegetables",
  ]),
  sectionWithRecipeTutorial("Main courses", "Main courses cover meat, fish, vegetarian proteins and eggs. Keep the cooking temperatures and timings documented here.", [
    "Generate a recipe card for a slow-cooked beef brisket",
    "What is the safe internal temperature for a medium-rare beef tenderloin?",
    "Suggest a vegetarian main course for a winter menu",
  ]),
  sectionWithRecipeTutorial("Side dishes", "Side dishes complete the plate: vegetables, grains, salads. Use this section to keep your pairings documented.", [
    "Suggest 3 side dishes that pair with grilled salmon",
    "Generate a recipe for a classic Italian contorno",
    "Which side dishes work for a vegan tasting menu?",
  ]),
  sectionWithRecipeTutorial("Desserts", "Desserts: cakes, pastry, ice cream, fruit-based sweets. Document the bases (creams, doughs) and the plated desserts here.", [
    "Generate a recipe card for a classic tiramisù",
    "What is the safe temperature for sugar syrup stages?",
    "Suggest a gluten-free dessert for a summer menu",
  ]),
  sectionWithRecipeTutorial("Plant-based cooking", "Plant-based cooking: proteins from legumes, grains, vegetables. Document substitutions, techniques and flavour pairings.", [
    "Generate a recipe for a plant-based protein using chickpeas",
    "Which legumes are richest in protein?",
    "Suggest a plant-based substitute for traditional beef stock",
  ]),
  sectionWithRecipeTutorial("Slow Food Presidia", "Slow Food Presidia protect traditional products at risk of extinction. Use this section to keep recipes and notes about ingredients tied to a Presidio.", [
    "Which Slow Food Presidia exist in Piedmont?",
    "Generate a recipe card featuring a Slow Food Presidio ingredient",
    "How do I substitute a Presidio ingredient if I cannot source it?",
  ]),
  sectionWithRecipeTutorial("Menu and service", "Use this section to design complete menus (seasonal, tasting, à la carte) and to keep service notes: pacing, plating, allergens per dish.", [
    "Draft a 5-course autumn tasting menu",
    "Which allergens must I declare for this menu?",
    "What is a balanced pacing between courses?",
  ]),
  sectionWithRecipeTutorial("Costs and food cost", "Track ingredient costs, plate cost, margins. Use this section to keep your food cost spreadsheets and per-dish calculations.", [
    "Calculate the food cost of {recipe}",
    "What is a healthy food cost target for a mid-range restaurant?",
    "Which ingredient in this recipe is the most expensive?",
  ]),
  sectionWithRecipeTutorial("Research and development", "Document books, chefs, techniques and food science you study. The AI uses this to suggest new ideas and answer technical questions.", [
    "Recommend a book on modern Italian pastry",
    "What is the Maillard reaction and how does it affect roasting?",
    "Which chef is known for {technique}?",
  ]),
  sectionWithRecipeTutorial("Media", "Photo styling, video reels, social media content. Use this section to keep your visual identity guidelines and caption templates.", [
    "Suggest a caption for a {dish} photo",
    "What is the best lighting for food photography at home?",
    "Draft a 30-second reel script for a recipe",
  ]),
];

const chefBLeafSection = (
  name: string,
  intro: string,
  prompts: string[]
): TemplateSectionSpec => ({
  name,
  tutorial: chefTutorial(name, intro, prompts),
});

const chefBMultibranchSections: TemplateSectionSpec[] = [
  {
    name: "01 Bases, stocks and core",
    children: [
      chefBLeafSection("Stocks and broths", "Document your classic stocks (white, brown, fish, vegetable) with ratios, timings and uses.", [
        "Generate a brown beef stock recipe",
        "What is the correct ratio bones-to-water for a white stock?",
        "When should I use a fish stock vs a vegetable stock?",
      ]),
      chefBLeafSection("Mother sauces", "The five French mother sauces (béchamel, velouté, espagnole, hollandaise, tomate) and their derivatives.", [
        "Generate a béchamel recipe and list 3 derivatives",
        "What is the difference between velouté and espagnole?",
        "How do I fix a broken hollandaise?",
      ]),
      chefBLeafSection("Base doughs", "Pasta dough, pizza dough, bread dough, shortcrust, puff, choux. Document ratios and hydration.", [
        "Generate a fresh egg pasta dough recipe",
        "What is the correct hydration for a pizza dough?",
        "How do I keep puff pastry cold while laminating?",
      ]),
      chefBLeafSection("HACCP standards", "Storage temperatures, FIFO, cross-contamination, personal hygiene, cleaning schedules. Reference the Italian and EU HACCP rules.", [
        "What is the safe storage temperature for fresh fish?",
        "Draft a HACCP plan for a small restaurant",
        "What is FIFO and how do I implement it?",
      ]),
    ],
  },
  {
    name: "02 Geography and territory",
    children: [
      {
        name: "Italian regional cuisine",
        children: [
          chefBLeafSection("Northern Italy", "Regional dishes from Valle d'Aosta, Piedmont, Lombardy, Veneto, Friuli-Venezia Giulia, Trentino-Alto Adige, Emilia-Romagna, Liguria.", [
            "Generate a recipe for a Piedmontese agnolotti",
            "What are the signature ingredients of Emilia-Romagna?",
            "Suggest a winter menu from Northern Italy",
          ]),
          chefBLeafSection("Central Italy", "Tuscany, Lazio, Umbria, Marche, Abruzzo. Olive oil, fresh pasta, offal, lamb.", [
            "Generate a recipe for a Tuscan pappa al pomodoro",
            "What is the difference between Roman and Neapolitan pizza?",
            "Suggest a spring menu from Central Italy",
          ]),
          chefBLeafSection("Southern Italy", "Campania, Puglia, Basilicata, Calabria. Tomatoes, mozzarella, seafood, dried pasta.", [
            "Generate a recipe for a Neapolitan ragù",
            "What are the signature dishes of Puglia?",
            "Suggest a summer menu from Southern Italy",
          ]),
          chefBLeafSection("Islands", "Sicily and Sardinia. Citrus, swordfish, cous cous, bottarga, pecorino.", [
            "Generate a recipe for a Sicilian pasta alla Norma",
            "What is bottarga and how do I use it?",
            "Suggest a winter menu from Sardinia",
          ]),
        ],
      },
      {
        name: "International cuisine",
        children: [
          chefBLeafSection("Europe", "French, Spanish, Portuguese, Greek, German, Eastern European. Techniques and signature ingredients.", [
            "Generate a recipe for a classic French pot-au-feu",
            "What is sofrito?",
            "Suggest a Mediterranean tasting menu",
          ]),
          chefBLeafSection("Asia", "Japanese, Chinese, Thai, Vietnamese, Indian, Korean, Indonesian, Malaysian. Wok, fermentation, rice, noodles.", [
            "Generate a recipe for a Thai green curry",
            "What is the difference between Japanese dashi and Chinese broth?",
            "Suggest a vegetarian Asian menu",
          ]),
          chefBLeafSection("Americas", "USA, Mexico, Brazil, Peru, Argentina. Barbecue, corn, beans, ceviche.", [
            "Generate a recipe for a Mexican mole poblano",
            "What is the difference between Tex-Mex and authentic Mexican cuisine?",
            "Suggest a South American tasting menu",
          ]),
          chefBLeafSection("Africa", "North, West, East, Southern Africa. Cous cous, tagine, injera, bobotie, peri-peri.", [
            "Generate a recipe for a Moroccan lamb tagine",
            "What is the difference between cous cous and millet?",
            "Suggest a North African menu",
          ]),
          chefBLeafSection("Middle East", "Lebanese, Turkish, Persian, Israeli, Iraqi. Mezze, kebab, flatbread, rice, yogurt.", [
            "Generate a recipe for a Lebanese tabbouleh",
            "What are the signature dishes of Persian cuisine?",
            "Suggest a vegetarian Middle Eastern menu",
          ]),
        ],
      },
    ],
  },
  {
    name: "03 Traditional courses",
    children: [
      chefBLeafSection("Appetizers", "International appetizers, small plates, amuse-bouche.", [
        "Generate a recipe for a Spanish gazpacho",
        "What is the difference between amuse-bouche and starter?",
        "Suggest 5 modern appetizers",
      ]),
      {
        name: "First courses",
        children: [
          chefBLeafSection("Dry pasta", "Spaghetti, penne, rigatoni, fusilli, farfalle. Sauces and cooking times.", [
            "Generate a recipe for a classic carbonara",
            "Which dry pasta shape works best with pesto?",
            "How do I cook pasta al dente?",
          ]),
          chefBLeafSection("Fresh pasta", "Tagliatelle, pappardelle, tortellini, ravioli, lasagne. Egg dough, fillings, sauces.", [
            "Generate a recipe for a fresh egg pasta dough",
            "What is the difference between tortellini and tortelloni?",
            "Suggest 3 ravioli fillings for autumn",
          ]),
          chefBLeafSection("Stuffed pasta", "Ravioli, tortelli, agnolotti, pansoti, culurgiones, casoncelli.", [
            "Generate a recipe for a pumpkin tortelli",
            "What is the correct ratio filling-to-pasta?",
            "Suggest a stuffed pasta for a winter menu",
          ]),
          chefBLeafSection("Rice and risotto", "Risotto, pilaf, paella, arancini, supplì, sushi rice.", [
            "Generate a recipe for a classic Milanese risotto",
            "What is the correct rice-to-stock ratio for a risotto?",
            "What is the difference between Arborio and Carnaroli?",
          ]),
          chefBLeafSection("Soups", "Minestrone, zuppa, potage, consommé, ramen, pho.", [
            "Generate a recipe for a Tuscan ribollita",
            "What is the difference between a broth and a consommé?",
            "Suggest 3 vegetarian soups for winter",
          ]),
          chefBLeafSection("Gnocchi", "Potato gnocchi, semolina gnocchi, ricotta gnocchi, gnudi, Parisian gnocchi.", [
            "Generate a recipe for a classic potato gnocchi",
            "What is the correct ratio potato-to-flour?",
            "How do I keep gnocchi light?",
          ]),
          chefBLeafSection("Baked pasta", "Lasagne, cannelloni, pasta al forno, timballo, anelletti al forno.", [
            "Generate a recipe for a classic lasagne alla bolognese",
            "What is the difference between lasagne verdi and lasagne normali?",
            "Suggest a baked pasta for a family dinner",
          ]),
        ],
      },
      {
        name: "Main courses",
        children: [
          chefBLeafSection("Meat", "Beef, pork, lamb, veal, game. Cuts, cooking methods, sauces.", [
            "Generate a recipe for a slow-cooked osso buco",
            "What is the difference between dry-aging and wet-aging?",
            "Suggest 3 cuts of beef for braising",
          ]),
          chefBLeafSection("Fish", "White fish, blue fish, shellfish, molluscs, cephalopods. Whole, filleted, cured.", [
            "Generate a recipe for a salt-crusted sea bass",
            "What is the difference between wild and farmed salmon?",
            "How do I cook octopus tender?",
          ]),
          chefBLeafSection("Vegetarian proteins", "Legumes, tofu, tempeh, seitan, eggs, cheese. Plant-forward mains.", [
            "Generate a recipe for a chickpea and spinach stew",
            "What is seitan and how do I prepare it?",
            "Suggest a high-protein vegetarian main",
          ]),
          chefBLeafSection("Eggs", "Frittata, omelette, quiche, shakshuka, huevos rancheros, tamagoyaki.", [
            "Generate a recipe for a classic frittata",
            "What is the difference between French and Italian omelettes?",
            "Suggest 3 egg-based mains for brunch",
          ]),
        ],
      },
      chefBLeafSection("Side dishes", "Vegetables, grains, salads, fries, purées. Pairings for mains.", [
        "Suggest 3 side dishes that pair with roast chicken",
        "Generate a recipe for a classic ratatouille",
        "Which side dishes work for a vegan tasting menu?",
      ]),
      chefBLeafSection("Desserts", "Cakes, pastry, ice cream, fruit-based sweets, plated desserts.", [
        "Generate a recipe for a classic tiramisù",
        "What is the difference between gelato and ice cream?",
        "Suggest a gluten-free dessert",
      ]),
    ],
  },
  {
    name: "04 Philosophies and special diets",
    children: [
      chefBLeafSection("Plant-based", "Fully vegan dishes. Substitutions, proteins, flavour pairings.", [
        "Generate a recipe for a plant-based Wellington",
        "Which plant proteins are highest in protein?",
        "Suggest a 5-course vegan tasting menu",
      ]),
      chefBLeafSection("Gluten free", "Naturally gluten-free dishes, cross-contamination, flour substitutes.", [
        "Generate a recipe for a gluten-free pasta",
        "Which flours are good substitutes for wheat?",
        "How do I prevent cross-contamination in a shared kitchen?",
      ]),
      chefBLeafSection("No added sugar", "Desserts and mains without refined sugar. Natural sweeteners, fruit purées.", [
        "Generate a recipe for a no-added-sugar dessert",
        "What are the best natural sweeteners?",
        "How do I balance sweetness without sugar?",
      ]),
      chefBLeafSection("Low sodium", "Low-salt cooking. Herbs, spices, acids, umami boosters.", [
        "Generate a recipe for a low-sodium broth",
        "What are the best umami boosters?",
        "How do I season food without salt?",
      ]),
      chefBLeafSection("Slow Food Presidia", "Recipes featuring Presidio ingredients. Document the producer and the story.", [
        "Which Slow Food Presidia are at risk of extinction?",
        "Generate a recipe featuring a Presidio ingredient",
        "How do I source a Presidio ingredient?",
      ]),
    ],
  },
  {
    name: "05 Menu and service",
    children: [
      chefBLeafSection("Seasonal menus", "Menus built around seasonal produce. 4 menus per year: spring, summer, autumn, winter.", [
        "Draft a 5-course autumn menu",
        "What is the rule of thumb for seasonality?",
        "How do I rotate a menu without losing regulars?",
      ]),
      chefBLeafSection("Wine list", "Pairings, by-the-glass program, regional focus, price tiers.", [
        "Suggest 5 pairings for a tasting menu",
        "How do I build a balanced by-the-glass program?",
        "What is the typical markup on wine in a mid-range restaurant?",
      ]),
      chefBLeafSection("Allergens", "Allergen tracking per dish, EU Reg. 1169/2011, declarations on the menu.", [
        "Which allergens must I declare on the menu?",
        "Draft an allergen sheet for {recipe}",
        "How do I train staff on allergen questions?",
      ]),
      chefBLeafSection("Service rules", "Sequence of service, pacing, role of each station, mise en place.", [
        "What is the classic sequence of service?",
        "Draft a service briefing for the evening shift",
        "How do I time the courses?",
      ]),
    ],
  },
  {
    name: "06 Costs and food cost",
    children: [
      chefBLeafSection("Calculators", "Spreadsheets, plate cost, beverage cost, labour cost. Reference the industry targets.", [
        "Calculate the food cost of {recipe}",
        "What is a healthy food cost target?",
        "How do I track food cost daily?",
      ]),
      chefBLeafSection("Margins", "Gross margin, contribution margin, break-even. Pricing strategies.", [
        "Calculate the gross margin of {recipe}",
        "What is a healthy gross margin in a restaurant?",
        "How do I price a menu to hit a target margin?",
      ]),
      chefBLeafSection("Shopping list", "Aggregated shopping list from upcoming services, par levels, suppliers.", [
        "Generate the shopping list for the next 7 days of service",
        "What is a par level?",
        "How do I consolidate orders across suppliers?",
      ]),
      chefBLeafSection("Reports", "Daily, weekly, monthly reports. Sales, costs, waste, staff productivity.", [
        "Draft a daily sales report template",
        "What is a healthy waste target?",
        "How do I read a P&L for a restaurant?",
      ]),
    ],
  },
  {
    name: "07 Research and development",
    children: [
      chefBLeafSection("Books", "Reference library: classic and modern. Index by topic (technique, ingredient, culture).", [
        "Recommend a foundational book on French technique",
        "Which book is essential for a pastry chef?",
        "Suggest 3 books on modern Italian cuisine",
      ]),
      chefBLeafSection("Restaurants", "List of restaurants you visit for inspiration. Notes per visit.", [
        "Which restaurant in Bologna is essential to visit?",
        "Draft a visit note template",
        "What should I look for when visiting a new restaurant?",
      ]),
      chefBLeafSection("Seasonality", "Calendar of seasonal produce per region. Pairings and substitutions.", [
        "Which vegetables are in season in October in Tuscany?",
        "Build a seasonality calendar for my region",
        "What grows in February in the South?",
      ]),
      chefBLeafSection("Pairings", "Classical and modern pairings. Food + wine, food + beverage, food + food.", [
        "Suggest 5 pairings for a beef cheek",
        "What is the rule of thumb for wine pairing?",
        "Suggest a non-alcoholic pairing for a tasting menu",
      ]),
    ],
  },
  {
    name: "08 Media",
    children: [
      chefBLeafSection("Dish photography", "Light, framing, props, lenses, post-production.", [
        "What is the best natural light for food photography?",
        "Suggest a flat-lay styling for {dish}",
        "Which lens focal length is best for close-up food?",
      ]),
      chefBLeafSection("Raw ingredient photography", "Market stalls, farms, producers. Storytelling through images.", [
        "What is the best way to photograph a market stall?",
        "Suggest a caption for a raw ingredient shot",
        "How do I photograph a producer at work?",
      ]),
      chefBLeafSection("Plating", "Plated dish photography. Angles, backgrounds, props, garnishes.", [
        "Suggest 3 plating styles for a tasting menu",
        "Which plate colour works for a dark broth?",
        "What is the best angle for a plated dessert?",
      ]),
      chefBLeafSection("Events", "Catering, private dinners, festivals. Briefs, planning, post-event reports.", [
        "Draft a brief for a private dinner for 20 guests",
        "What is a typical staffing ratio for a catering event?",
        "Build a post-event report template",
      ]),
    ],
  },
];

const chefEntityTypes: TemplateEntityTypeSpec[] = [
  {
    name: "Recipe",
    icon: "🍽️",
    color: "#e74c3c",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "category", type: "enum", enum_values: ["appetizer", "first_course", "main_course", "side_dish", "dessert", "base", "beverage"] },
      { name: "region", type: "enum", enum_values: ["north", "central", "south", "islands", "international"] },
      { name: "season", type: "enum", enum_values: ["spring", "summer", "autumn", "winter", "all"] },
      { name: "servings", type: "number" },
      { name: "prepTimeMin", type: "number" },
      { name: "cookTimeMin", type: "number" },
      { name: "restTimeMin", type: "number" },
      { name: "difficulty", type: "enum", enum_values: ["easy", "medium", "hard"] },
      { name: "cost", type: "enum", enum_values: ["low", "medium", "high"] },
      { name: "allergens", type: "text", note: "Comma-separated: gluten, dairy, eggs, nuts, fish, shellfish, molluscs, soy, mustard, celery" },
      { name: "diet", type: "enum", enum_values: ["omnivore", "vegetarian", "vegan", "gluten_free", "lactose_free", "gluten_and_lactose_free"] },
      { name: "ingredients", type: "text" },
      { name: "procedure", type: "text" },
      { name: "serviceNotes", type: "text" },
    ],
  },
  {
    name: "Ingredient",
    icon: "🧂",
    color: "#38c172",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "region", type: "enum", enum_values: ["north", "central", "south", "islands", "international"] },
      { name: "category", type: "enum", enum_values: ["fresh", "preserved", "dry", "spice", "dairy", "meat", "fish", "vegetable", "fruit", "grain", "other"] },
      { name: "season", type: "enum", enum_values: ["spring", "summer", "autumn", "winter", "all"] },
      { name: "allergens", type: "text" },
      { name: "compatibleDiets", type: "text" },
      { name: "unit", type: "text" },
      { name: "costPerUnit", type: "number" },
      { name: "supplier", type: "text" },
      { name: "notes", type: "text" },
    ],
  },
  {
    name: "Equipment",
    icon: "🔧",
    color: "#4a90d9",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "category", type: "enum", enum_values: ["cooking", "preparation", "conservation", "plating", "service"] },
      { name: "description", type: "text" },
      { name: "manual", type: "text" },
    ],
  },
  {
    name: "Supplier",
    icon: "🚚",
    color: "#9b59b6",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "category", type: "text" },
      { name: "region", type: "enum", enum_values: ["north", "central", "south", "islands", "local", "national", "international"] },
      { name: "contact", type: "text" },
      { name: "address", type: "text" },
      { name: "deliveryDays", type: "text" },
    ],
  },
  {
    name: "MenuItem",
    icon: "📋",
    color: "#e4a700",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "recipeRef", type: "text" },
      { name: "category", type: "enum", enum_values: ["appetizer", "first_course", "main_course", "side_dish", "dessert", "beverage"] },
      { name: "price", type: "number" },
      { name: "foodCost", type: "number" },
      { name: "margin", type: "number" },
      { name: "available", type: "boolean" },
    ],
  },
  {
    name: "RecipeVariation",
    icon: "🔀",
    color: "#16a085",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "baseRecipe", type: "text" },
      { name: "substitutions", type: "text" },
      { name: "excludedAllergens", type: "text" },
      { name: "alternativeDiet", type: "enum", enum_values: ["vegetarian", "vegan", "gluten_free", "lactose_free"] },
      { name: "notes", type: "text" },
    ],
  },
];

const chefStyles: { name: string; fragment: string }[] = [
  { name: "Technical-scientific", fragment: "Objective, precise, exact weights, precise timings, specific temperatures. For professional technical sheets, HACCP manuals, food cost reports." },
  { name: "Narrative-traditional", fragment: "Tells the story of the dish, the geographic origins, the family traditions. More discursive sentences, evocation of memories, cultural references. For cookbooks, personal blogs, storytelling." },
  { name: "Inspired by a great chef", fragment: "Inspired by a great chef (e.g. Marchesi, Cracco, Bottura, Bencini, Locatelli, Ramsay). Technical-accessible language, references to innovative techniques, personal vision." },
  { name: "Modern cookbook", fragment: "Contemporary high-end cookbook style. Short sentences, visual pacing, focus on technique and precision. For the reader who wants to understand and replicate." },
  { name: "Family tradition", fragment: "Warm, affectionate, personal anecdotes and memories. Oral transmission from mother to child. For family recipe books, regional traditions, culinary memoirs." },
  { name: "Custom", fragment: "" },
];

const chefPrompts = {
  suggestions: "You are a professional kitchen assistant. Read the current document and the project structure. Suggest up to 5 brief continuations (1-2 sentences each) for the next step of the recipe or procedure. Respect the chosen writing style.",
  chat: "You are a culinary assistant specialised in Italian and international cuisine. Help the user generate complete recipe cards (4 blocks: metadata, ingredients, procedure, service and storage), scale servings (preserving ratios), calculate food cost, suggest pairings, propose substitutions and recipe variations, and revise recipes technically. Always use the 4-block schema for new recipes. Respect the chosen writing style.",
};

export const chefTemplate: Template = {
  type: "chef",
  displayName: "Chef",
  icon: "🍳",
  description: "For chefs and cooking enthusiasts. Modular recipe book with portion scaling, food cost and classification by course, geography or cooking philosophy.",
  requiresStyleChoice: true,
  sections: chefAFlatSections,
  entityTypes: chefEntityTypes,
  styles: chefStyles,
  defaultStyleName: "Technical-scientific",
  prompts: chefPrompts,
  chefVariant: "a",
};

export const chefTemplateBMultibranch: Template = {
  ...chefTemplate,
  chefVariant: "b",
  sections: chefBMultibranchSections,
};
