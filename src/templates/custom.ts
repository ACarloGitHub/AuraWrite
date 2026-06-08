import type { Template } from "./_types";

export const customTemplate: Template = {
  type: "custom",
  displayName: "Custom",
  icon: "✏️",
  description: "Empty project. You create every section, document and entity from scratch.",
  requiresStyleChoice: false,
  sections: [],
  entityTypes: [],
  styles: [],
  defaultStyleName: null,
  prompts: {
    suggestions: "You are a helpful writing assistant.",
    chat: "You are a helpful writing assistant. Help the user with their project.",
  },
};
