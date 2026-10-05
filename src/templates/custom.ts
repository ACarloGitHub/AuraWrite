import type { Template } from "./_types";
import { userStyleEntry, noneStyleEntry } from "./_helpers";

export const customTemplate: Template = {
  type: "custom",
  displayName: "Custom",
  icon: "✏️",
  description: "Empty project. You create every section, document and entity from scratch.",
  requiresStyleChoice: false,
  sections: [],
  entityTypes: [],
  styles: [
    userStyleEntry,
    noneStyleEntry,
  ],
  defaultStyleName: null,
  prompts: {
    suggestions: "You are a helpful writing assistant.",
    chat: "You are a helpful writing assistant. Help the user with their project.",
  },
};
