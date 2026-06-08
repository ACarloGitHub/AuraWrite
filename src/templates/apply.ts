import { invoke } from "@tauri-apps/api/core";
import { applyTemplate, createProject } from "../database/db";
import type { Project, Section } from "../types/database";
import { customTemplate } from "./custom";
import { bookTemplate } from "./book";
import { chefTemplate, chefTemplateBMultibranch } from "./chef";
import { legalTemplate } from "./legal";
import type {
  Template,
  TemplateSectionSpec,
  TemplateEntityTypeSpec,
  TemplateStyleSpec,
} from "./_types";

/**
 * Registry of all available templates.
 */
export const ALL_TEMPLATES: Template[] = [
  customTemplate,
  bookTemplate,
  chefTemplate,
  chefTemplateBMultibranch,
  legalTemplate,
];

export function getTemplate(type: string): Template | null {
  if (type === "chef-b") return chefTemplateBMultibranch;
  return ALL_TEMPLATES.find((t) => t.type === type) || null;
}

export function listTemplates(): Template[] {
  return ALL_TEMPLATES;
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

/**
 * High-level: create a project and apply the given template in one shot.
 * Returns the project + its sections.
 */
export async function createProjectFromTemplate(opts: {
  name: string;
  templateType: string;
  chefVariant?: "a" | "b";
  selectedStyle?: string;
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
  const project: Project = {
    id: projectId,
    name: opts.name,
    type: "generic", // legacy field
    template_type: effectiveTemplate.type,
    description: undefined,
    bg_color: undefined,
    text_color: undefined,
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
  const spec = templateToSpec(effectiveTemplate, effectiveTemplate.sections);
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
