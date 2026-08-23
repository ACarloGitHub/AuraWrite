// ============================================================================
// Project DnD - drag & drop for multibranch sections and documents
// ============================================================================
// Phase 3, step 5b of the refactoring plan: the FULL dnd domain lives here.
// Step 5a moved the database-writing side (persistMove + drop visuals);
// step 5b adds the SortableJS engine (initSortable + onStart/onMove/onEnd),
// the floating drag label, the shared instances and the gesture state
// (pendingChild / MAX_DEPTH). Dependencies point one way only:
// dnd -> state/db/render (the render edge follows the same accepted
// static-cycle pattern as panel <-> render: hoisted functions only).

import Sortable from "sortablejs";
import { invoke } from "@tauri-apps/api/core";
import {
  getDocuments,
  getSections,
  updateDocument,
  updateDocumentsOrder,
} from "../database/db";
import {
  currentProject,
  currentSection,
  documents,
  expandedSections,
  setDocuments,
  setSections,
  sectionById,
  childSectionsOf,
  computeDepth,
  subtreeHeight,
  isDescendantOf,
} from "./project-state";
import { renderProjectsList } from "./project-render";

// Multibranch — drag & drop state
export const MAX_DEPTH = 4;
let pendingChild: string | null = null;

// SortableJS instances — recreated on each render
const sectionInstances: Sortable[] = [];
const docSortables: Map<string, Sortable> = new Map();

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

// Floating drag label (identico pattern del v4, riusa #drag-label)
let dragLabelEl: HTMLElement | null = null;
function showDragLabel(text: string): void {
  if (!dragLabelEl) {
    dragLabelEl = document.createElement("div");
    dragLabelEl.id = "drag-label";
    document.body.appendChild(dragLabelEl);
  }
  dragLabelEl.textContent = text;
  dragLabelEl.style.display = "block";
}
function hideDragLabel(): void {
  if (dragLabelEl) {
    dragLabelEl.style.display = "none";
  }
}
document.addEventListener("mousemove", (e) => {
  if (dragLabelEl && dragLabelEl.style.display === "block") {
    dragLabelEl.style.left = e.clientX + 14 + "px";
    dragLabelEl.style.top = e.clientY + 14 + "px";
  }
});

export function initSortable(): void {
  const projectEl = document.querySelector(".project-item.active") as HTMLElement;
  if (!projectEl) return;

  // Distruggi TUTTE le istanze sezione prima di re-inizializzare (evita ghost
  // duplicati e listener leak).
  sectionInstances.forEach((s) => s.destroy());
  sectionInstances.length = 0;
  pendingChild = null;

  // Multibranch — un'istanza Sortable per ogni .section-children
  // (root + ogni sezione espansa con figli). Group condiviso, forceFallback
  // per WebView2, handle:".section-drag-handle" isola il drag.
  projectEl.querySelectorAll<HTMLElement>(".section-children").forEach((listEl) => {
    const inst = new Sortable(listEl, {
      group: { name: "sections", pull: true, put: true },
      // Section-specific handle: prevents the section engine from hijacking
      // drags started on a nested document's handle (same-selector conflict).
      handle: ".section-drag-handle",
      draggable: ".section-item",
      animation: 150,
      forceFallback: true,
      fallbackOnBody: true,
      emptyInsertThreshold: 10,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",

      onStart(evt) {
        const id = evt.item.dataset.id!;
        const s = sectionById(id);
        if (s) showDragLabel(`↕ TRASCINANDO: ${s.name}  (L${computeDepth(id)})`);
      },

      onMove(evt, originalEvent) {
        clearDropIndicators();
        pendingChild = null;
        const draggedId = evt.dragged.dataset.id!;

        // Walk-up al .section-item antenato. evt.related è spesso un
        // discendente (.item-header, .drag-handle, .item-name, button); senza
        // walk-up il check classList fallisce e si esce subito, perdendo
        // l'intento FIGLIO sulla meta' alta dell'header target.
        const relatedEl = evt.related as HTMLElement | null;
        let relatedSectionEl: HTMLElement | null = null;
        if (relatedEl) {
          let cur: HTMLElement | null = relatedEl;
          while (cur && cur !== document.body) {
            if (cur.classList && cur.classList.contains("section-item")) {
              relatedSectionEl = cur;
              break;
            }
            cur = cur.parentElement;
          }
        }
        if (!relatedEl || !relatedSectionEl) return true;
        const relatedId = relatedSectionEl.dataset.id!;

        // 50/50: meta' alta dell'header del target = intento FIGLIO.
        const headerEl = relatedSectionEl.querySelector(".item-header") as HTMLElement | null;
        if (!headerEl) return true;
        const rect = headerEl.getBoundingClientRect();
        const y = (originalEvent as MouseEvent).clientY;
        const topHalf = y - rect.top < rect.height / 2;

        if (topHalf) {
          // Validazioni LIVE (feedback col bordo, non a fine drop)
          const wouldDepth = computeDepth(relatedId) + subtreeHeight(draggedId);
          const cycle =
            draggedId === relatedId || isDescendantOf(draggedId, relatedId);
          if (wouldDepth > MAX_DEPTH || cycle) {
            relatedSectionEl.classList.add("drop-blocked");
            return false;
          }
          relatedSectionEl.classList.add("drop-as-child");
          pendingChild = relatedId;
          return false;
        }
        return true;
      },

      onEnd: async (evt) => {
        const draggedId = evt.item.dataset.id!;
        hideDragLabel();
        clearDropIndicators();

        if (pendingChild) {
          const parentId = pendingChild;
          pendingChild = null;
          const ok = await persistMove(draggedId, parentId, 0);
          if (ok) {
            expandedSections.add(parentId);
            renderProjectsList();
            flashSection(parentId);
          } else {
            renderProjectsList();
          }
          return;
        }

        const toEl = evt.to as HTMLElement;
        const parentRaw = toEl.dataset.parent ?? "";
        const newParent: string | null = parentRaw === "" ? null : parentRaw;
        const newIndex = evt.newIndex ?? 0;

        if (
          newParent &&
          (newParent === draggedId || isDescendantOf(draggedId, newParent))
        ) {
          renderProjectsList();
          return;
        }

        const ok = await persistMove(draggedId, newParent, newIndex);
        if (!ok) renderProjectsList();
      },
    });
    sectionInstances.push(inst);
  });

  // Document Sortables — una per ogni sezione
  docSortables.forEach((s) => s.destroy());
  docSortables.clear();

  projectEl.querySelectorAll(".section-item").forEach((el) => {
    const sectionEl = el as HTMLElement;
    const sectionId = sectionEl.dataset.id!;
    const docsList = sectionEl.querySelector(".docs-list") as HTMLElement;
    if (!docsList) return;

    const sortable = new Sortable(docsList, {
      group: {
        name: "documents",
        pull: true,
        put: ["documents"],
      },
      animation: 150,
      draggable: ".document-item",
      handle: ".doc-drag-handle",
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      forceFallback: true,
      onEnd: async (evt) => {
        const fromSection = evt.from.closest(".section-item") as HTMLElement;
        const toSection = evt.to.closest(".section-item") as HTMLElement;
        const docEl = evt.item as HTMLElement;
        const docId = docEl.dataset.id!;

        if (!fromSection || !toSection) return;

        const fromSectionId = fromSection.dataset.id!;
        const toSectionId = toSection.dataset.id!;

        if (fromSectionId === toSectionId && evt.oldIndex === evt.newIndex) return;

        // Ricompatta ordini nella sezione di destinazione
        const targetDocs = Array.from(toSection.querySelectorAll(".document-item") as NodeListOf<HTMLElement>).map(
          (el, i) => [el.dataset.id!, i] as [string, number]
        );
        await updateDocumentsOrder(targetDocs);

        // Se cambiato sezione, ricompatta anche la vecchia
        if (fromSectionId !== toSectionId) {
          const oldDocs = Array.from(fromSection.querySelectorAll(".document-item") as NodeListOf<HTMLElement>).map(
            (el, i) => [el.dataset.id!, i] as [string, number]
          );
          await updateDocumentsOrder(oldDocs);

          // Aggiorna sezione del doc spostato
          const movedDoc = documents.find((d) => d.id === docId);
          if (movedDoc) {
            movedDoc.section_id = toSectionId;
            movedDoc.updated_at = Date.now();
            await updateDocument(movedDoc);
          }

          // Espandi la sezione di destinazione
          expandedSections.add(toSectionId);

          // Ricarica documenti
          if (currentSection) {
            setDocuments(await getDocuments(currentSection.id));
          }
        } else {
          // Rileggi documenti dalla stessa sezione
          setDocuments(await getDocuments(toSectionId));
        }

        renderProjectsList();
      },
    });

    docSortables.set(sectionId, sortable);
  });
}
