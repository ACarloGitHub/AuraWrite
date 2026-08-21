/**
 * Preferences types, default prompts and default values.
 * Extracted from main.ts (2026-08-21, refactoring plan step 1.2).
 */

export type ThemeMode = "light" | "dark" | "custom";

export interface Preferences {
  theme: ThemeMode;
  customBg: string;
  customToolbar: string;
  customPaper: string;
  customTextEditor: string;
  customTextButtons: string;
  incrementalEnabled: boolean;
  incrementalMax: number;
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek" | "openrouter" | "lmstudio" | "minimax" | "zai" | "local-llamacpp";
  aiOllamaMode: "local" | "cloud";
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiSuggestionsInterval: number;
  aiContextInterval: number;
  aiInterfaceLanguage: string;
  aiWritingLanguage: string;
  aiAssistantName: string;
  aiUserName: string;
  suggestionsDebug: boolean;
  suggestionsPrompt: string;
  aiAssistantPrompt: string;
  entityExtractionRole: string;
  entityExtractionPrompt: string;
  toolCallingPrompt: string;
  deselectOnDocumentClick: boolean;
  semanticSearchEnabled: boolean;
  selectionHighlightColor: string;
  updatesCheckEnabled: boolean;
  fontsUseBundled: boolean;
  fontEditor: string;
  fontUi: string;
  plannerEnabled: boolean;
  webSearchEnabled: boolean;
  fileSystemEnabled: boolean;
  shellExecEnabled: boolean;
  ragEnabled: boolean;
}

export const defaultSuggestionsPrompt = `You are an AI writing assistant analyzing a document for improvements.

First, read the initial sentences to understand the tone, style, and context.
Then analyze each sentence individually.

For each sentence that could be improved, provide:
1. A title (first 5 words + "...")
2. The suggested improvement (if needed)

Focus on:
- Clarity and readability
- Sentence structure
- Word choice
- Grammar (if issues found)

Respond in JSON format:
{
  "context_understood": "brief summary of tone/style",
  "suggestions": [
    {
      "sentence_title": "First 5 words...",
      "original": "full sentence",
      "suggested": "improved version or null if no change needed",
      "reason": "why this improves the text (if suggested)"
    }
  ]
}`;

export const defaultAIAssistantPrompt = `You are an AI writing assistant helping with a document.

The user can ask you questions about the document or request modifications.
You have access to the full document context.

When the user asks for text modifications:
- Propose the change clearly
- Explain why it improves the text

When you suggest accepting a modification:
- Say "Accept?" and wait for confirmation
- After acceptance, the change will be applied

You can read and analyze the document at any time.`;

export const defaultEntityExtractionPrompt = `You are an entity extraction assistant for a writing application.
Read the text and extract all named entities (characters, locations, objects, events, etc.).
For each entity, provide:
- name: the entity name
- type: the category (character, location, object, event, etc.)
- description: a brief description based on the text context

Respond in JSON format:
{
  "entities": [
    {"name": "Entity Name", "type": "character", "description": "Brief description"}
  ]
}

Rules:
- Extract only entities explicitly mentioned or clearly implied
- Use consistent type names
- Keep descriptions concise (max 200 characters)
- If an entity was already known, update its description with new information`;

export const defaultToolCallingPrompt = `You are AuraWrite AI, an intelligent writing assistant with access to a project database.
When the user asks about characters, locations, events, or anything related to their project, you MUST use the available tools to query the database before answering.

To use a tool, include this tag in your response:
<tool name="TOOL_NAME">{"param1": "value1", "param2": "value2"}</tool>

You can use multiple tools in one response.
After receiving tool results, summarize them naturally for the user.`;

export const defaultEntityExtractionRole = "";

export const defaultPreferences: Preferences = {
  theme: "light",
  customBg: "#f0f0f0",
  customToolbar: "#ffffff",
  customPaper: "#ffffff",
  customTextEditor: "#222222",
  customTextButtons: "#222222",
  incrementalEnabled: false,
  incrementalMax: 10,
  aiProvider: "ollama",
  aiOllamaMode: "local",
  aiModel: "kimi-k2.5:cloud",
  aiApiKey: "",
  aiBaseUrl: "",
  aiSuggestionsInterval: 30,
  aiContextInterval: 30,
  aiInterfaceLanguage: "English",
  aiWritingLanguage: "English",
  aiAssistantName: "Aura",
  aiUserName: "",
  suggestionsDebug: false,
  suggestionsPrompt: defaultSuggestionsPrompt,
  aiAssistantPrompt: defaultAIAssistantPrompt,
  entityExtractionRole: defaultEntityExtractionRole,
  entityExtractionPrompt: defaultEntityExtractionPrompt,
  toolCallingPrompt: defaultToolCallingPrompt,
  deselectOnDocumentClick: true,
  semanticSearchEnabled: true,
  selectionHighlightColor: "#ffff00",
  updatesCheckEnabled: true,
  fontsUseBundled: true,
  fontEditor: "Lora",
  fontUi: "Inter",
  plannerEnabled: true,
  webSearchEnabled: true,
  fileSystemEnabled: true,
  shellExecEnabled: false,
  ragEnabled: false,
};
