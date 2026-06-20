import { invoke } from "@tauri-apps/api/core";
import { applyTemplate, createProject } from "../database/db";
import type { Project, Section, Document } from "../types/database";
import { customTemplate } from "./custom";
import { bookTemplate } from "./book";
import { chefTemplate, chefTemplateBMultibranch } from "./chef";
import { legalTemplate } from "./legal";
import { notesTemplate } from "./notes";
import type {
  Template,
  TemplateSectionSpec,
  TemplateEntityTypeSpec,
  TemplateStyleSpec,
} from "./_types";

// Fixed palette of 12 harmonious bg+text color combinations
const PROJECT_COLORS: Array<{ bg: string; text: string }> = [
  { bg: "#E8F4FD", text: "#1A3A5C" },  // blu chiaro
  { bg: "#FFF3E0", text: "#5D4037" },  // arancione caldo
  { bg: "#E8F5E9", text: "#1B5E20" },  // verde
  { bg: "#F3E5F5", text: "#4A148C" },  // viola
  { bg: "#FFF8E1", text: "#F57F17" },  // giallo
  { bg: "#FFEBEE", text: "#B71C1C" },  // rosso
  { bg: "#E0F2F1", text: "#004D40" },  // teal
  { bg: "#EDE7F6", text: "#311B92" },  // indaco
  { bg: "#FBE9E7", text: "#BF360C" },  // arancione bruno
  { bg: "#F1F8E9", text: "#33691E" },  // verde chiaro
  { bg: "#E1F5FE", text: "#01579B" },  // azzurro
  { bg: "#FCE4EC", text: "#880E4F" },  // rosa
];

/** Return a random harmonious bg+text color pair for a new project. */
export function randomProjectColors(): { bg_color: string; text_color: string } {
  const pair = PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
  return { bg_color: pair.bg, text_color: pair.text };
}

/**
 * Registry of all available templates (top-level, for the dropdown).
 * Chef B is NOT listed here — it's accessed via the variant picker.
 */
export const ALL_TEMPLATES: Template[] = [
  customTemplate,
  bookTemplate,
  chefTemplate,
  legalTemplate,
  notesTemplate,
];

export function getTemplate(type: string): Template | null {
  if (type === "chef-b") return chefTemplateBMultibranch;
  return ALL_TEMPLATES.find((t) => t.type === type) || null;
}

export function listTemplates(): Template[] {
  return ALL_TEMPLATES;
}

/**
 * Resolve the effective writing style fragment for a section/document.
 * Fallback chain: document.selected_style → section.selected_style →
 * project.selected_style → template defaultStyleName.
 * Returns the fragment text from the template's styles array, or undefined.
 */
export function resolveWritingStyleFragment(
  section: Section,
  project: Project,
  document?: Pick<Document, "selected_style"> | null
): string | undefined {
  const tpl = getTemplate(project.template_type || "");
  if (!tpl) return undefined;

  const styleName =
    document?.selected_style ||
    section.selected_style ||
    project.selected_style ||
    tpl.defaultStyleName ||
    undefined;
  if (!styleName) return undefined;

  const styleSpec = tpl.styles.find((s) => s.name === styleName);
  return styleSpec?.fragment;
}

/**
 * Convert the in-memory template tree to the JSON spec expected by the
 * Rust `apply_template` command. The Rust side is a thin pass-through;
 * conversion happens here so the templates files stay clean.
 */
function templateToSpec(
  template: Template,
  sections: TemplateSectionSpec[]
) {
  return {
    template_type: template.type,
    display_name: template.displayName,
    icon: template.icon,
    description: template.description,
    sections: sections.map(sectionToSpec),
    entity_types: template.entityTypes.map(entityTypeToSpec),
    suggestions_prompt: template.prompts.suggestions,
    chat_prompt: template.prompts.chat,
  };
}

function sectionToSpec(s: TemplateSectionSpec): unknown {
  return {
    name: s.name,
    children: s.children ? s.children.map(sectionToSpec) : [],
    tutorial: s.tutorial || null,
    documents: s.documents || [],
  };
}

function entityTypeToSpec(e: TemplateEntityTypeSpec): unknown {
  return {
    name: e.name,
    icon: e.icon || null,
    color: e.color || null,
    fields: e.fields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required || false,
      enum_values: f.enum_values || null,
      note: f.note || null,
    })),
  };
}

function stripDocumentsFromSections(sections: TemplateSectionSpec[]): TemplateSectionSpec[] {
  return sections.map((s) => ({
    ...s,
    documents: [],
    tutorial: undefined,
    children: s.children ? stripDocumentsFromSections(s.children) : undefined,
  }));
}

/**
 * High-level: create a project and apply the given template in one shot.
 * Returns the project + its sections.
 */
export async function createProjectFromTemplate(opts: {
  name: string;
  templateType: string;
  chefVariant?: "a" | "b";
  selectedStyle?: string;
  createSections?: boolean;
  createDocuments?: boolean;
}): Promise<{ project: Project; sections: Section[] }> {
  const template = getTemplate(opts.templateType);
  if (!template) throw new Error(`Unknown template: ${opts.templateType}`);

  // Resolve which variant of chef to apply.
  let effectiveTemplate = template;
  if (opts.templateType === "chef" && opts.chefVariant === "b") {
    effectiveTemplate = chefTemplateBMultibranch;
  }

  // 1) Create the project (no sections, no entity types yet).
  const projectId = "proj-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const colors = randomProjectColors();
  const project: Project = {
    id: projectId,
    name: opts.name,
    type: "generic", // legacy field
    template_type: effectiveTemplate.type,
    description: undefined,
    bg_color: colors.bg_color,
    text_color: colors.text_color,
    suggestions_prompt_override: undefined,
    chat_prompt_override: undefined,
    selected_style: opts.selectedStyle || effectiveTemplate.defaultStyleName || undefined,
    created_at: now,
    updated_at: now,
  };
  await createProject(project);

  // 2) Apply the template (entity types + sections + documents + template_type).
  // Note: the Rust side sets template_type again. We pass it through to make
  // the operation atomic (all-or-nothing).
  let sectionsSpec = effectiveTemplate.sections;
  if (opts.createSections === false) {
    sectionsSpec = [];
  } else if (opts.createDocuments === false) {
    sectionsSpec = stripDocumentsFromSections(sectionsSpec);
  }
  const spec = templateToSpec(effectiveTemplate, sectionsSpec);
  await applyTemplate(projectId, spec);

  // 3) If a writing style was chosen and not already set, update project.
  if (opts.selectedStyle && opts.selectedStyle !== effectiveTemplate.defaultStyleName) {
    const updated = { ...project, selected_style: opts.selectedStyle, updated_at: Date.now() };
    await invoke("db_update_project", { project: updated });
  }

  // 4) Load sections so the caller can render immediately.
  const sections = await invoke<Section[]>("db_get_sections", { projectId });

  return { project, sections };
}

export type { Template, TemplateStyleSpec };
