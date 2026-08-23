// ============================================================================
// Project DnD - drag & drop persistence for multibranch sections
// ============================================================================
// Phase 3, step 5a of the refactoring plan: ONLY the database-writing side of
// drag & drop moves here (persistMove + drop visual helpers). The SortableJS
// engine (initSortable, handlers, drag label, instances) follows in step 5b.
// persistMove is the only Phase 3 code path that can corrupt real data
// (parent_id / order_index rewrites), hence its own isolated commit+test.
// Dependencies point one way only: dnd -> state/db (no cycle with the panel).

import { invoke } from "@tauri-apps/api/core";
import { getSections } from "../database/db";
import {
  currentProject,
  setSections,
  sectionById,
  childSectionsOf,
} from "./project-state";

export function clearDropIndicators(): void {
  document
    .querySelectorAll(".section-item.drop-as-child, .section-item.drop-blocked")
    .forEach((el) => el.classList.remove("drop-as-child", "drop-blocked"));
}

export function flashSection(id: string): void {
  const el = document.querySelector(`.section-item[data-id="${id}"]`) as HTMLElement | null;
  if (!el) return;
  el.classList.add("child-flash");
  setTimeout(() => el.classList.remove("child-flash"), 1000);
}

// Persisti lo spostamento di una sezione: aggiorna parent_id + order_index
// della sezione spostata, poi ricompatta gli ordini dei fratelli in origine e
// destinazione. Stesso pattern dei documenti cross-section, senza toccare il
// backend Rust. Tauri v2: snake_case in Rust → camelCase in invoke.
export async function persistMove(
  sectionId: string,
  newParentId: string | null,
  newIndex: number
): Promise<boolean> {
  if (!currentProject) return false;
  const section = sectionById(sectionId);
  if (!section) return false;
  const oldParentId = section.parent_id ?? null;

  // Aggiorna modello locale
  section.parent_id = newParentId ?? undefined;
  section.order_index = newIndex;
  section.updated_at = Date.now();

  // Ricompatta ordini destinazione
  const destSiblings = childSectionsOf(newParentId).filter((s) => s.id !== sectionId);
  destSiblings.splice(newIndex, 0, section);
  for (let i = 0; i < destSiblings.length; i++) destSiblings[i].order_index = i;

  // Ricompatta ordini origine se parent cambiato
  const oldSiblingsChanged = oldParentId !== newParentId;
  const oldSiblings = oldSiblingsChanged ? childSectionsOf(oldParentId) : [];
  for (let i = 0; i < oldSiblings.length; i++) oldSiblings[i].order_index = i;

  try {
    // 1) Aggiorna la sezione spostata (parent_id + order_index).
    // NB: Tauri v2 per strutture annidate (section: Section) usa snake_case
    // di default sul payload JS; solo i parametri primitivi dei command sono
    // auto-convertiti a camelCase.
    await invoke("db_update_section", {
      section: {
        id: section.id,
        project_id: section.project_id,
        parent_id: section.parent_id ?? null,
        name: section.name,
        order_index: section.order_index,
        bg_color: section.bg_color ?? null,
        text_color: section.text_color ?? null,
        section_type: section.section_type ?? null,
        created_at: section.created_at,
        updated_at: section.updated_at,
      },
    });

    // 2) Ricompatta ordini destinazione
    await invoke("db_update_sections_order", {
      orders: destSiblings.map((s) => [s.id, s.order_index]),
    });

    // 3) Se parent cambiato, ricompatta anche origine
    if (oldSiblingsChanged) {
      await invoke("db_update_sections_order", {
        orders: oldSiblings.map((s) => [s.id, s.order_index]),
      });
    }

    // 4) Ricarica sezioni dal DB
    setSections(await getSections(currentProject.id));
    return true;
  } catch (e) {
    console.error("[multibranch] persistMove failed:", e);
    return false;
  }
}
