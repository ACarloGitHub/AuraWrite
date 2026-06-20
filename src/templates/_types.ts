// Template system types

export type TemplateType =
  | "custom"
  | "book"
  | "chef"
  | "legal"
  | "developer"
  | "notes"
  | "article"
  | "thesis"
  | "doctor"
  | "student"
  | "teacher"
  | "school"
  | "university";

export type ChefVariant = "a" | "b";

export interface TemplateSectionSpec {
  name: string;
  /** Sub-sections for multibranch templates. Each one becomes a section with parent_id set. */
  children?: TemplateSectionSpec[];
  /** Document-tutorial pre-populated inside the section. */
  tutorial?: {
    title: string;
    body: string;
  };
  /** Optional inline documents (e.g. chapters under "Chapters" section). */
  documents?: Array<{
    title: string;
    body?: string;
  }>;
}

export interface TemplateEntityTypeSpec {
  name: string;
  icon?: string;
  color?: string;
  fields: Array<{
    name: string;
    type: "text" | "number" | "enum" | "boolean" | "date";
    required?: boolean;
    enum_values?: string[];
    note?: string;
  }>;
}

export interface TemplateStyleSpec {
  name: string;
  fragment: string;
}

export interface TemplatePrompts {
  suggestions: string;
  chat: string;
}

export interface Template {
  type: TemplateType;
  displayName: string;
  icon: string;
  description: string;
  /** Whether this template shows a "Writing style" picker in the new-project dialog. */
  requiresStyleChoice: boolean;
  /** Top-level sections, optionally with children (multibranch). */
  sections: TemplateSectionSpec[];
  /** Entity types created with apply_template. */
  entityTypes: TemplateEntityTypeSpec[];
  /** Writing styles available in the dropdown. */
  styles: TemplateStyleSpec[];
  /** Default style id from the styles list, or null if user must pick. */
  defaultStyleName: string | null;
  /** Suggestions + Chat prompts (v1 of the template). */
  prompts: TemplatePrompts;
  /** Chef-specific: which variant to build (A flat, B multibranch). */
  chefVariant?: ChefVariant;
}
