// ============================================================================
// Layers panel (F3) — the floating window that manages depth.
//
// Contract §2.12 and §7 (revised 2026-09-07 after the rejected delivery):
//  - it lists GROUPS, not paragraphs: a group is the set of elements that are
//    outside the text flow on ONE page;
//  - a dropdown holds every group and follows the caret by itself; the user can
//    pick another group and give it any name they want;
//  - inside a group each element is one row and the TEXT row is fixed in the
//    middle: drag a row above it to cover the words, below it to be covered;
//  - no numbers are shown or typed, no position fields here (the position comes
//    from the mouse on the canvas - the numeric fields of the first version
//    duplicated the element's own toolbar and were removed);
//  - the window is resizable, draggable by its header, non-modal (the writer
//    keeps typing while it is open) and closes ONLY with its × button.
//
// Depth data lives in the elements (see free-layout.ts); this file only reads
// and rewrites it through free-commands, so undo behaves like any other edit.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import Sortable from "sortablejs";
import { textRowOf } from "./free-layout";
import {
  caretPage,
  documentLayout,
  renameGroup,
  collectGroups,
  setGroupOrder,
  type FreeGroup,
} from "./free-commands";

let viewRef: EditorView | null = null;
let open = false;
/** Groups/levels signature: repaint only when something actually changed. */
let signature = "";
/** The group shown in the window (a page number), kept across repaints. */
let shownPage: number | null = null;
let sortables: Sortable[] = [];
/** True while the user types a name: rebuilding the DOM would eat the input. */
let editingName = false;
/** Timestamp of the last drag: clicks right after one are the drag's echo. */
let afterDragAt = 0;
/** What the window shows now: used to skip work when nothing moved. */
let lastDoc: PMNode | null = null;
let lastSelFrom = -1;
let lastSelTo = -1;

const el = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const ui = {
  panel: null as HTMLElement | null,
  groups: null as HTMLSelectElement | null,
  name: null as HTMLInputElement | null,
  front: null as HTMLElement | null,
  behind: null as HTMLElement | null,
  empty: null as HTMLElement | null,
};

function cache(): boolean {
  if (ui.panel) return true;
  ui.panel = el<HTMLElement>("layers-panel");
  ui.groups = el<HTMLSelectElement>("layers-group-select");
  ui.name = el<HTMLInputElement>("layers-group-name");
  ui.front = el<HTMLElement>("layers-front");
  ui.behind = el<HTMLElement>("layers-behind");
  ui.empty = el<HTMLElement>("layers-empty");
  return !!ui.panel;
}

/** Wire the window: footer button, ×, drag, resize, dropdown, name field. */
export function setupLayersPanel(view: EditorView): void {
  viewRef = view;
  if (!cache()) return;

  el("btn-layers")?.addEventListener("click", () => setVisible(!open));
  // Contract §2.12: the ONLY way out is the × button. No overlay click and no
  // Escape, which would steal the writer's Escape habit.
  el("layers-close")?.addEventListener("click", () => setVisible(false));

  makeDraggable(ui.panel!, el<HTMLElement>("layers-drag-handle"));
  makeResizable(ui.panel!, el<HTMLElement>("layers-resize"));

  ui.groups?.addEventListener("change", () => {
    const page = Number(ui.groups!.value);
    if (isFinite(page)) {
      shownPage = page;
      repaint(true);
    }
  });

  ui.name?.addEventListener("focus", () => {
    editingName = true;
  });
  ui.name?.addEventListener("blur", () => {
    editingName = false;
    commitName();
  });
  ui.name?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  });
}

function setVisible(next: boolean): void {
  if (!cache()) return;
  open = next;
  ui.panel!.classList.toggle("hidden", !open);
  if (open) repaint(true);
}

/**
 * Called by the editor on selection and document changes while visible.
 *
 * Building the rows means asking the pagination engine which page everything
 * is on, and that is the same work a keystroke already pays once. Repeating it
 * when neither the document nor the selection moved would double the cost of
 * every character typed for a window that looks identical, so it is skipped.
 */
export function syncLayersPanel(view: EditorView): void {
  if (!open) return;
  const { doc, selection } = view.state;
  if (doc === lastDoc && selection.from === lastSelFrom && selection.to === lastSelTo) return;
  repaint(false);
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function groupsSignature(groups: FreeGroup[], shown: number | null): string {
  const rows = groups
    .map((g) => `${g.page}:${g.name}:${g.entries.map((e) => `${e.pos}=${e.level}`).join(",")}`)
    .join("|");
  return `${rows}#${shown}`;
}

function repaint(force: boolean): void {
  const view = viewRef;
  if (!view || !cache()) return;
  if (editingName) return;

  // ONE pass of the pagination engine for the whole window refresh.
  const layout = documentLayout(view);
  const groups = layout.groups;
  // The caret's page wins when it has a group; otherwise keep what was shown,
  // then fall back to the first group (contract §7: the dropdown follows the
  // cursor, the user moves it when they want to).
  const caret = caretPage(view, layout.ranges);
  if (groups.some((g) => g.page === caret)) shownPage = caret;
  else if (shownPage === null || !groups.some((g) => g.page === shownPage)) {
    shownPage = groups.length > 0 ? groups[0].page : null;
  }

  const sig = groupsSignature(groups, shownPage);
  if (!force && sig === signature) return;
  signature = sig;
  lastDoc = view.state.doc;
  lastSelFrom = view.state.selection.from;
  lastSelTo = view.state.selection.to;

  paintGroupDropdown(groups);
  paintList(groups);
}

function paintGroupDropdown(groups: FreeGroup[]): void {
  const select = ui.groups;
  if (!select) return;
  select.textContent = "";
  for (const g of groups) {
    const opt = document.createElement("option");
    // Unnamed groups still need something to read; the page number is a label,
    // never part of the stored name (contract §3.5 rev. 2026-09-07).
    opt.textContent = g.name || `Page ${g.page}`;
    opt.value = String(g.page);
    if (g.page === shownPage) opt.selected = true;
    select.appendChild(opt);
  }
  select.disabled = groups.length === 0;
  if (ui.name) {
    const current = groups.find((g) => g.page === shownPage);
    ui.name.value = current?.name ?? "";
    ui.name.disabled = !current;
    ui.name.placeholder = "Unnamed group";
  }
}

function commitName(): void {
  const view = viewRef;
  if (!view || !ui.name) return;
  const groups = collectGroups(view);
  const group = groups.find((g) => g.page === shownPage);
  if (!group) return;
  const wanted = ui.name.value.trim();
  if (wanted === group.name) return;
  // One transaction over every member: one undo, one result.
  renameGroup(view, group, wanted);
  repaint(true);
}

function paintList(groups: FreeGroup[]): void {
  const front = ui.front;
  const behind = ui.behind;
  if (!front || !behind) return;
  const group = groups.find((g) => g.page === shownPage) ?? null;
  if (ui.empty) ui.empty.hidden = !!group;
  front.textContent = "";
  behind.textContent = "";
  destroySortables();
  if (!group) return;

  // Rows top-down: highest level first, so the front-most element is on top.
  // The engine decides where the words sit in that order (contract §3.4), and
  // the two halves go into SEPARATE containers: with the fixed text row living
  // inside one list, dragging a row past it was impossible, because the row it
  // had to cross is not a place where anything may be dropped.
  const rows = [...group.entries].sort((a, b) => b.level - a.level);
  const textRow = textRowOf(rows.map((r) => r.level));
  rows.slice(0, textRow).forEach((entry) => front.appendChild(makeRow(entry)));
  rows.slice(textRow).forEach((entry) => behind.appendChild(makeRow(entry)));

  // Same group on both: crossing the line becomes a move between containers,
  // which is the pattern the projects panel already uses in this app.
  for (const zone of [front, behind]) {
    sortables.push(
      new Sortable(zone, {
        // WebView2 does not deliver the native drag events this list needs:
        // every draggable surface in AuraWrite sets forceFallback, and the
        // first version of this window forgot it, so the rows looked draggable
        // and were not.
        group: "aw-layers",
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 3,
        // An empty half must still accept a row dropped into it.
        emptyInsertThreshold: 24,
        animation: 120,
        draggable: ".aw-layers__row--item",
        handle: ".aw-layers__grip",
        ghostClass: "aw-layers__ghost",
        chosenClass: "aw-layers__chosen",
        dragClass: "aw-layers__dragging",
        onStart: () => {
          afterDragAt = Date.now();
        },
        onEnd: () => {
          afterDragAt = Date.now();
          commitOrder();
        },
      }),
    );
  }
}

function makeRow(entry: { pos: number; label: string; level: number }): HTMLElement {
  const row = document.createElement("div");
  row.className = "aw-layers__row aw-layers__row--item";
  row.dataset.pos = String(entry.pos);
  row.title = "Drag to change what covers what";
  const grip = document.createElement("span");
  grip.className = "aw-layers__grip";
  grip.textContent = "⋮⋮";
  grip.title = "Drag to change depth";
  const name = document.createElement("span");
  name.className = "aw-layers__row-name";
  name.textContent = entry.label;
  name.title = entry.label;
  row.append(grip, name);
  // Clicking a row selects its element, so the element's own toolbar appears
  // and the two surfaces always speak about the same thing.
  row.addEventListener("click", () => {
    if (Date.now() - afterDragAt < 250) return;
    selectElementAt(entry.pos);
  });
  return row;
}

function selectElementAt(pos: number): void {
  const view = viewRef;
  if (!view) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  try {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  } catch {
    /* elements that refuse node-selection simply stay unselected */
  }
}

/**
 * Read the two halves back and write the levels (ONE transaction). The order is
 * what the user arranged; the numbers are its consequence (contract §3.5).
 */
function commitOrder(): void {
  const view = viewRef;
  const front = ui.front;
  const behind = ui.behind;
  if (!view || !front || !behind) return;
  const group = collectGroups(view).find((g) => g.page === shownPage);
  if (!group) return;

  const readPositions = (zone: HTMLElement): number[] =>
    [...zone.querySelectorAll<HTMLElement>(".aw-layers__row--item")]
      .map((row) => Number(row.dataset.pos))
      .filter((n) => isFinite(n));

  const frontRows = readPositions(front);
  const behindRows = readPositions(behind);
  const ordered = [...frontRows, ...behindRows];
  if (ordered.length === 0) return;
  setGroupOrder(view, group, ordered, frontRows.length);
  repaint(true);
}

function destroySortables(): void {
  for (const inst of sortables) inst.destroy();
  sortables = [];
}

// ---------------------------------------------------------------------------
// Window behaviour (drag by header, resize by corner). Same idiom as the
// preferences window; kept local so the panel never depends on modal CSS.
// ---------------------------------------------------------------------------

function makeDraggable(panel: HTMLElement, handle: HTMLElement | null): void {
  if (!handle) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  handle.addEventListener("mousedown", (e) => {
    // The dropdown lives in the header: dragging it must open it, not the window.
    if ((e.target as HTMLElement).closest("select, button")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panel.style.left = `${startLeft + (e.clientX - startX)}px`;
    panel.style.top = `${startTop + (e.clientY - startY)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
  });
}

function makeResizable(panel: HTMLElement, grip: HTMLElement | null): void {
  if (!grip) return;
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  grip.addEventListener("mousedown", (e) => {
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    panel.style.width = `${Math.max(240, startW + (e.clientX - startX))}px`;
    panel.style.height = `${Math.max(160, startH + (e.clientY - startY))}px`;
  });
  document.addEventListener("mouseup", () => {
    resizing = false;
  });
}
