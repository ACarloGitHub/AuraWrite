// ============================================================================
// Project State - single owner of the shared project-panel state
// ============================================================================
// Every write MUST go through the exported setters: ESM imported bindings are
// read-only views by design. The panel core and the extracted modules
// (dialogs / indexing / render / dnd) read these bindings directly and always
// see fresh values. Never export copies of this state.

import type { Project, Section, Document } from "../types/database";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

export let currentProject: Project | null = null;
export let currentSection: Section | null = null;
export let currentDocument: Document | null = null;

/** Never rebound: mutated in place via add/delete. */
export const expandedSections: Set<string> = new Set();

export let projects: Project[] = [];
export let sections: Section[] = [];
export let documents: Document[] = [];

// ---------------------------------------------------------------------------
// Setters - the ONLY way to rebind shared state from outside this module
// ---------------------------------------------------------------------------

export function setCurrentProject(p: Project | null): void {
  currentProject = p;
}

export function setCurrentSection(s: Section | null): void {
  currentSection = s;
}

export function setCurrentDocument(d: Document | null): void {
  currentDocument = d;
}

export function setProjects(list: Project[]): void {
  projects = list;
}

export function setSections(list: Section[]): void {
  sections = list;
}

export function setDocuments(list: Document[]): void {
  documents = list;
}

// ---------------------------------------------------------------------------
// Pure tree helpers (multibranch)
// ---------------------------------------------------------------------------

export function sectionById(id: string): Section | undefined {
  return sections.find((s) => s.id === id);
}

export function childSectionsOf(parentId: string | null): Section[] {
  return sections
    .filter((s) => (s.parent_id ?? null) === parentId)
    .sort((a, b) => a.order_index - b.order_index);
}

export function computeDepth(id: string): number {
  let d = 1;
  let n = sectionById(id);
  while (n && n.parent_id) {
    d++;
    n = sectionById(n.parent_id);
  }
  return d;
}

export function subtreeHeight(id: string): number {
  const kids = childSectionsOf(id);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(k.id)));
}

export function isDescendantOf(ancestorId: string, candidateId: string): boolean {
  let n = sectionById(candidateId);
  while (n && n.parent_id) {
    if (n.parent_id === ancestorId) return true;
    n = sectionById(n.parent_id);
  }
  return false;
}
