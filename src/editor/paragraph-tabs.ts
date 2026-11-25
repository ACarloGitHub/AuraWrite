/**
 * E3 — tab stops (the Word `w:tabs` family).
 *
 * The contract:
 *  - the CHARACTER: a literal `\t` inside the text is a tabulation (Word's
 *    `<w:tab/>`). It cuts, pastes and counts as text.
 *  - the STOPS: one paragraph attribute, in canonical form
 *    `<cm><l|c|r|d><leader?>;…` (`6c;12r.;16d`), positions in cm from the LEFT
 *    TEXT MARGIN (Word's and ODF's origin). null = no stop of its own.
 *  - the GRID: past the last custom stop a tab advances to the next multiple of
 *    1.25 cm (Word's metric default).
 *  - the ALIGNMENTS: left, centre, right, decimal (on `.` or `,`): the segment
 *    after the tab lines up ON the stop; the leader (`.`, `-`, `_`, `·`) fills
 *    the gap.
 *  - the LIMITS: a stop past the text column is dropped, a hanging first line
 *    implies a left stop at its own position, a run of tabs wider than the line
 *    continues on the next one.
 *
 * This module holds the MODEL (parse/format, grid, advance math), the command
 * that writes the attribute, and the panel section. The line walk that USES the
 * advances lives in the page calculator (`pagination-cassie.ts`), because the
 * engine must see the same numbers the screen draws (D13), and the paper
 * (`print-pages.ts`) applies the same advances to its fragments.
 */
import type { EditorView } from "prosemirror-view";
import type { EditorState, Transaction } from "prosemirror-state";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
import { goToNextCell } from "prosemirror-tables";
import { Transform } from "prosemirror-transform";
import { CM_TO_PX } from "./paragraph-indent";

export { CM_TO_PX };

export type TabAlign = "left" | "center" | "right" | "decimal";

export interface TabStop {
  pos: number;
  align: TabAlign;
  leader: string | null;
}

/** Word's default tab pitch, in cm: past the last custom stop the pen lands here. */
export const DEFAULT_TAB_CM = 1.25;

/** The fill characters a stop may repeat across its gap (anything else is dropped). */
export const LEADER_CHARS = [".", "-", "_", "·"] as const;

const CODE: Record<TabAlign, string> = { left: "l", center: "c", right: "r", decimal: "d" };
const ALIGN: Record<string, TabAlign> = { l: "left", c: "center", r: "right", d: "decimal" };

export function normalizeLeader(ch: unknown): string | null {
  return typeof ch === "string" && (LEADER_CHARS as readonly string[]).includes(ch) ? ch : null;
}

/** Canonical attr form: one `<cm><align code><leader?>` per stop, ';'-separated. */
export function parseTabStops(value: unknown): TabStop[] {
  if (typeof value !== "string" || !value) return [];
  const out: TabStop[] = [];
  for (const part of value.split(";")) {
    const m = /^(-?\d*\.?\d+)([lcrd])(\S)?$/.exec(part.trim());
    if (m) out.push({ pos: parseFloat(m[1]), align: ALIGN[m[2]], leader: normalizeLeader(m[3]) });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** The stops as the attribute string; null when there is none. */
export function formatTabStops(stops: readonly TabStop[]): string | null {
  const byPos = new Map<number, TabStop>();
  for (const s of stops) {
    const pos = Math.round(s.pos * 100) / 100;
    if (Number.isFinite(pos) && pos >= 0) byPos.set(pos, { ...s, pos });
  }
  const out = [...byPos.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.pos}${CODE[s.align]}${normalizeLeader(s.leader) ?? ""}`);
  return out.length ? out.join(";") : null;
}

/**
 * The stops a block lays its tabs on, in cm: its own, plus the left stop a
 * hanging first line implies (Word puts one there, so the text after the tab
 * lines up with the body's left edge).
 */
export function tabStopsOf(node: PMNode | null | undefined): TabStop[] {
  if (!node) return [];
  const stops = parseTabStops(node.attrs?.tabStops);
  const first = Number(node.attrs?.indentFirst);
  if (Number.isFinite(first) && first < 0) {
    const left = Number(node.attrs?.indentLeft);
    const pos = Math.round((Number.isFinite(left) && left > 0 ? left : 0) * 100) / 100;
    if (!stops.some((s) => Math.abs(s.pos - pos) < 0.01)) {
      stops.push({ pos, align: "left", leader: null });
      stops.sort((a, b) => a.pos - b.pos);
    }
  }
  return stops;
}

/** Stops in px from the text margin, keeping only the ones inside the column. */
export function stopsPxOf(node: PMNode | null | undefined, lineWidthPx: number): number[] {
  return stopsInPx(node, lineWidthPx).map((s) => s.pos);
}

export interface TabStopPx {
  pos: number;
  align: TabAlign;
  leader: string | null;
}

/**
 * The stops of a block in px, measured from the START OF ITS LINES: with a left
 * indent the pen starts there, so the stop's distance from the text margin is
 * reduced by the indent (`shiftPx`). Stops past the column are dropped.
 */
export function stopsInPx(
  node: PMNode | null | undefined,
  lineWidthPx: number,
  shiftPx = 0,
): TabStopPx[] {
  const limit = lineWidthPx > 0 ? lineWidthPx - 0.5 : Infinity;
  const out: TabStopPx[] = [];
  for (const s of tabStopsOf(node)) {
    const pos = s.pos * CM_TO_PX - shiftPx;
    if (pos >= -0.01 && pos < limit) out.push({ pos: Math.max(0, pos), align: s.align, leader: s.leader });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** The stop a tab standing at `penPx` lands on: the first one right of it, else the grid. */
export function resolveTab(
  penPx: number,
  stops: readonly TabStopPx[],
  gridPx: number,
): TabStopPx {
  for (const s of stops) if (s.pos > penPx + 0.5) return s;
  const g = gridPx > 0 ? gridPx : DEFAULT_TAB_CM * CM_TO_PX;
  return { pos: Math.floor(penPx / g + 1e-6) * g + g, align: "left", leader: null };
}

/** Where a tab standing at `penPx` lands: the first stop right of it, else the grid. */
export function nextStopPx(penPx: number, stopsPx: readonly number[], gridPx: number): number {
  for (const s of stopsPx) if (s > penPx + 0.5) return s;
  const g = gridPx > 0 ? gridPx : DEFAULT_TAB_CM * CM_TO_PX;
  return Math.floor(penPx / g + 1e-6) * g + g;
}

/**
 * The advance the tab itself takes, from the pen to the stop, minus what the
 * aligned segment needs in front of (or around) the stop:
 *  - left: the segment starts at the stop;
 *  - centre: half the segment sits before the stop;
 *  - right: the whole segment sits before it;
 *  - decimal: the segment up to its separator.
 * Never negative: a segment wider than the gap simply starts where the pen was.
 */
export function tabAdvancePx(
  stopPx: number,
  penPx: number,
  align: TabAlign,
  segmentPx: number,
  decimalPx: number,
): number {
  const gap = stopPx - penPx;
  const back = align === "center" ? segmentPx / 2 : align === "right" ? segmentPx : align === "decimal" ? decimalPx : 0;
  return Math.max(0, gap - back);
}

/** The stop nearest to a position, for the marker the panel highlights. */
export function stopAt(stops: readonly TabStop[], cm: number, tolerance = 0.15): TabStop | null {
  let best: TabStop | null = null;
  let bestD = tolerance;
  for (const s of stops) {
    const d = Math.abs(s.pos - cm);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

// ============================================================================
// The key: Tab writes the character, as Word does — inside a list item it
// sinks the item (Shift+Tab lifts it), inside a table cell it moves to the next
// cell (Ctrl+Tab writes the character there, Word's own escape hatch).
// ============================================================================

function insideNode($pos: ResolvedPos, names: readonly string[]): boolean {
  for (let d = $pos.depth; d > 0; d--) if (names.includes($pos.node(d).type.name)) return true;
  return false;
}

export function tabCommand(shift: boolean, forceInsert = false) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { $from, empty } = state.selection;
    if (!forceInsert) {
      if (insideNode($from, ["table_cell", "table_header"])) return goToNextCell(shift ? -1 : 1)(state, dispatch);
      const item = state.schema.nodes.list_item;
      if (item && insideNode($from, ["list_item"])) {
        return (shift ? liftListItem(item) : sinkListItem(item))(state, dispatch);
      }
    }
    const node = $from.parent;
    if (!node.isTextblock || node.type.spec.code) return false;
    if (!empty && !dispatch) return true;
    if (dispatch) dispatch(state.tr.insertText("\t").scrollIntoView());
    return true;
  };
}

// ============================================================================
// The attribute: same walk as the spacing/indents (caret = its block, Ctrl+A =
// every block of the flow and of the cells that the engine measures).
// ============================================================================

const isTextBlock = (name: string): boolean => name === "paragraph" || name === "heading";
const measuredParent = (name: string): boolean =>
  name === "doc" || name === "table_cell" || name === "table_header";

function blocksOfSelection(view: EditorView): Array<{ node: PMNode; pos: number }> {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const out: Array<{ node: PMNode; pos: number }> = [];
  if (empty) {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (isTextBlock(node.type.name)) {
        if (measuredParent($from.node(d - 1).type.name)) out.push({ node, pos: $from.before(d) });
        break;
      }
    }
    return out;
  }
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (isTextBlock(node.type.name)) {
      if (parent && measuredParent(parent.type.name)) out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** The block under the caret (or the first one the selection touches). */
export function shownTabBlock(view: EditorView | null): PMNode | null {
  if (!view) return null;
  let { $from } = view.state.selection;
  if ($from.depth === 0) {
    const pos = Math.min(view.state.selection.from + 1, view.state.doc.content.size);
    $from = view.state.doc.resolve(pos);
  }
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isTextBlock(node.type.name)) return node;
  }
  return null;
}

/** Write the whole stop list on the selection's blocks (null clears it). */
export function setParagraphTabStops(view: EditorView, stops: TabStop[]): void {
  const value = formatTabStops(stops);
  const tr = view.state.tr;
  let changed = false;
  for (const { node, pos } of blocksOfSelection(view)) {
    if (node.attrs.tabStops !== value) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, tabStops: value });
      changed = true;
    }
  }
  if (changed) view.dispatch(tr);
}

/** Add (or move) a stop on the caret's block; the panel's click on the strip. */
export function addTabStop(view: EditorView, cm: number, align: TabAlign, leader: string | null): void {
  const block = shownTabBlock(view);
  if (!block) return;
  const pos = Math.round(Math.max(0, cm) * 100) / 100;
  const stops = tabStopsOf(block).filter((s) => Math.abs(s.pos - pos) > 0.01);
  stops.push({ pos, align, leader: normalizeLeader(leader) });
  setParagraphTabStops(view, stops);
}

/** Remove the stop nearest to `cm` from the caret's block. */
export function removeTabStop(view: EditorView, cm: number): void {
  const block = shownTabBlock(view);
  if (!block) return;
  const hit = stopAt(tabStopsOf(block), cm);
  if (!hit) return;
  setParagraphTabStops(
    view,
    tabStopsOf(block).filter((s) => Math.abs(s.pos - hit.pos) > 0.01),
  );
}

// ============================================================================
// The panel: the strip of stops inside "Paragraph" (E2's panel), plus the
// alignment / leader / position fields. No ruler on the page: the strip is a
// schematic of the text column, not a scale glued to the sheet.
// ============================================================================

/** The editor's text column, in px (the sheet's width minus its two margins). */
function columnWidthPx(view: EditorView): number {
  const dom = view.dom as HTMLElement;
  const cs = getComputedStyle(dom);
  const inner = dom.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
  return inner > 40 ? inner : 600;
}

/** Every strip on screen: the panel's, and the copy the overflow menu makes. */
function stripEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".tab-strip"));
}

function stripEl(): HTMLElement | null {
  return document.getElementById("tab-strip");
}

/**
 * True when a strip is actually on screen: the panel's (its own `.visible`) or
 * the overflow menu's copy (the menu is open when it is not `.hidden`). Class
 * checks only — asking the DOM for a size costs a reflow, and the tab section
 * must not force one on every keystroke.
 */
function stripsVisible(): boolean {
  for (const strip of stripEls()) {
    const panel = strip.closest<HTMLElement>(".margins-dropdown__panel");
    if (panel?.classList.contains("visible")) return true;
    const menu = strip.closest<HTMLElement>("#overflow-menu");
    if (menu && !menu.classList.contains("hidden")) return true;
  }
  return false;
}

/** Draw the caret block's stops on EVERY strip (percent of the text column). */
function renderTabStrip(view: EditorView): void {
  const block = shownTabBlock(view);
  const widthCm = columnWidthPx(view) / CM_TO_PX;
  const stops = tabStopsOf(block);
  for (const strip of stripEls()) {
    strip.replaceChildren();
    strip.hidden = !block;
    if (!block) continue;
    for (const s of stops) {
      if (s.pos > widthCm) continue;
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "tab-strip__stop";
      marker.dataset.pos = String(s.pos);
      marker.style.left = `${(s.pos / widthCm) * 100}%`;
      marker.title = `${s.pos} cm — ${s.align}${s.leader ? ` (${s.leader})` : ""}
`
        + "trascina per spostare · trascina fuori dalla striscia per togliere";
      marker.setAttribute("aria-label", `Tab stop ${s.pos} cm`);
      if (s.align !== "left") marker.dataset.align = s.align;
      // Il numero accanto al triangolo: la tacca si legge, non si indovina.
      const label = document.createElement("span");
      label.className = "tab-strip__label";
      label.textContent = String(s.pos).replace(".", ",");
      marker.appendChild(label);
      if (selectedStop != null && Math.abs(selectedStop - s.pos) < 0.01) marker.classList.add("is-selected");
      strip.appendChild(marker);
    }
  }
}

function alignSelect(): HTMLSelectElement | null {
  return document.getElementById("sel-tab-align") as HTMLSelectElement | null;
}

function leaderSelect(): HTMLSelectElement | null {
  return document.getElementById("sel-tab-leader") as HTMLSelectElement | null;
}

function posInput(): HTMLInputElement | null {
  return document.getElementById("inp-tab-pos") as HTMLInputElement | null;
}

/** Choose the stop the fields edit (null = the fields start a new one). */
function selectStop(cm: number | null): void {
  selectedStop = cm;
  const pos = posInput();
  const align = alignSelect();
  const leader = leaderSelect();
  if (cm == null) {
    if (pos) pos.value = "";
    return;
  }
  const view = getViewRef();
  const hit = stopAt(tabStopsOf(shownTabBlock(view)), cm);
  if (!hit) return;
  if (pos) pos.value = String(hit.pos);
  if (align) align.value = hit.align;
  if (leader) leader.value = hit.leader ?? "";
}

/** Change ONE field of the chosen stop (no stop chosen: nothing to change). */
function updateSelected(field: "pos" | "align" | "leader", raw: string): void {
  const view = getViewRef();
  const block = shownTabBlock(view);
  if (!view || !block || selectedStop == null) return;
  const hit = stopAt(tabStopsOf(block), selectedStop);
  if (!hit) return;
  const widthCm = columnWidthPx(view) / CM_TO_PX;
  const stops = tabStopsOf(block).filter((s) => Math.abs(s.pos - hit.pos) > 0.01);
  const next = { ...hit };
  if (field === "pos") {
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) return;
    next.pos = Math.round(Math.max(0, Math.min(widthCm, n)) * 100) / 100;
  } else if (field === "align") {
    next.align = raw as TabAlign;
  } else {
    next.leader = normalizeLeader(raw);
  }
  stops.push(next);
  selectedStop = next.pos;
  setParagraphTabStops(view, stops);
  syncParagraphTabsInputs(view);
}

/** The fields say what the block the caret is in carries. */
export function syncParagraphTabsInputs(view: EditorView): void {
  const block = shownTabBlock(view);
  const stops = tabStopsOf(block);
  // Nothing to draw when the section is closed: no geometry, no DOM writes.
  if (stripsVisible()) renderTabStrip(view);
  const strip = stripEl();
  if (strip) strip.classList.toggle("tab-strip--has-stops", stops.length > 0);
  // The canonical string is the attribute itself: shown for the exact values,
  // editable for a bulk edit (Word's own dialog does the same job with rows).
  const inp = document.getElementById("inp-tab-stops") as HTMLInputElement | null;
  const value = (block?.attrs?.tabStops as string | null) ?? "";
  if (inp && document.activeElement !== inp && inp.value !== value) inp.value = value;
  // Il punto scelto comanda i campi: se non c'è (o è sparito) tornano vuoti.
  if (selectedStop != null && !stopAt(stops, selectedStop)) selectedStop = null;
  const input = posInput();
  if (selectedStop == null) {
    if (input && document.activeElement !== input) input.value = "";
    if (alignSelect() && document.activeElement !== alignSelect()) alignSelect()!.value = "left";
    if (leaderSelect() && document.activeElement !== leaderSelect()) leaderSelect()!.value = "";
  } else {
    const hit = stopAt(stops, selectedStop)!;
    if (input && document.activeElement !== input) input.value = String(hit.pos);
    if (alignSelect() && document.activeElement !== alignSelect()) alignSelect()!.value = hit.align;
    if (leaderSelect() && document.activeElement !== leaderSelect()) leaderSelect()!.value = hit.leader ?? "";
  }
  const remove = document.getElementById("btn-tab-remove") as HTMLButtonElement | null;
  if (remove) remove.disabled = selectedStop == null;
}

/** Wire the Tabs section of the Paragraph panel. */
/** A marker being dragged: from the pointerdown to the pointerup. */
interface StripDrag {
  marker: HTMLElement;
  strip: HTMLElement;
  pos0: number;
  x0: number;
  moved: boolean;
  /** The pointer left the strip: releasing here removes the stop. */
  outside: boolean;
  pos: number;
  align: TabAlign;
  leader: string | null;
}

let drag: StripDrag | null = null;
/** The stop the fields below the strip are editing (null = none). */
let selectedStop: number | null = null;
/** A drag just ended: the click that follows must not remove the marker. */
let swallowClick = false;

/** Move a stop of the caret's block from one position to another. */
function moveTabStop(view: EditorView, from: number, to: number): void {
  const block = shownTabBlock(view);
  if (!block) return;
  const hit = stopAt(tabStopsOf(block), from);
  if (!hit) return;
  const pos = Math.round(Math.max(0, to) * 10) / 10;
  if (Math.abs(pos - hit.pos) < 0.01) return;
  const stops = tabStopsOf(block).filter((s) => Math.abs(s.pos - hit.pos) > 0.01);
  stops.push({ pos, align: hit.align, leader: hit.leader });
  setParagraphTabStops(view, stops);
}

let getViewRef: () => EditorView | null = () => null;

export function setupParagraphTabs(getView: () => EditorView | null): void {
  getViewRef = getView;
  // Opening the section (from the bar or from the overflow menu) redraws the
  // strip with the block under the caret, which is where it was left. The draw
  // is unconditional here: the overflow menu builds its own copy of the strip
  // from the panel's, and a copy of an empty strip is an empty strip.
  for (const id of ["btn-spacing", "btn-overflow-menu"]) {
    document.getElementById(id)?.addEventListener("click", () => {
      const view = getView();
      if (!view) return;
      renderTabStrip(view);
      setTimeout(() => {
        const v = getView();
        if (v) syncParagraphTabsInputs(v);
      }, 0);
    });
  }

  // The marker is dragged along the strip: press, move, release. A press that
  // never moves is the click that removes it (as before).
  document.addEventListener("pointerdown", (e) => {
    const marker = (e.target as HTMLElement).closest<HTMLElement>(".tab-strip__stop");
    const strip = marker?.closest<HTMLElement>(".tab-strip");
    const view = getView();
    if (!marker || !strip || !view || !marker.dataset.pos) return;
    const rect = strip.getBoundingClientRect();
    if (!rect.width) return;
    const block = shownTabBlock(view);
    const hit = stopAt(tabStopsOf(block), Number(marker.dataset.pos));
    if (!hit) return;
    e.preventDefault();
    drag = {
      marker,
      strip,
      pos0: hit.pos,
      x0: e.clientX,
      moved: false,
      outside: false,
      pos: hit.pos,
      align: hit.align,
      leader: hit.leader,
    };
    marker.classList.add("is-dragging");
    marker.setPointerCapture?.(e.pointerId);
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
    drag.moved = true;
    const box = drag.strip.getBoundingClientRect();
    // Trascinato via dalla striscia (sopra o sotto): si sta togliendo.
    drag.outside = e.clientY < box.top - 6 || e.clientY > box.bottom + 10;
    const rect = drag.strip.getBoundingClientRect();
    const widthCm = columnWidthPx(getView() as EditorView) / CM_TO_PX;
    const cm = ((e.clientX - rect.left) / rect.width) * widthCm;
    drag.pos = Math.round(Math.max(0, Math.min(widthCm, cm)) * 10) / 10;
    drag.marker.style.left = `${(drag.pos / widthCm) * 100}%`;
    drag.marker.dataset.pos = String(drag.pos);
    drag.marker.title = `${drag.pos} cm — ${drag.align}${drag.leader ? ` (${drag.leader})` : ""}`;
  });

  const fine = (): void => {
    if (!drag) return;
    const { moved, outside, marker, pos0, pos } = drag;
    drag.marker.classList.remove("is-dragging");
    drag = null;
    const view = getView();
    if (!view) return;
    if (moved) {
      swallowClick = true;
      if (outside) {
        removeTabStop(view, pos0);
        selectedStop = null;
      } else {
        moveTabStop(view, pos0, pos);
        selectedStop = pos;
      }
      syncParagraphTabsInputs(view);
    } else {
      marker.dataset.pos = String(pos0);
    }
  };
  document.addEventListener("pointerup", fine);
  document.addEventListener("pointercancel", fine);

  // Delegated on the document: the overflow menu builds its OWN copy of the
  // strip (toolbar.ts), and that copy has to work exactly like the original.
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const strip = target.closest<HTMLElement>(".tab-strip");
    if (!strip) return;
    const view = getView();
    if (!view) return;
    const marker = target.closest<HTMLElement>(".tab-strip__stop");
    if (marker?.dataset.pos) {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      // Il click SCEGLIE il punto: i campi sotto si riempiono con i suoi valori e
      // il punto si sposta o si toglie da lì. Cancellare al primo click era una
      // trappola (un doppio click faceva sparire la tacca).
      selectStop(Number(marker.dataset.pos));
      syncParagraphTabsInputs(view);
      return;
    }
    const rect = strip.getBoundingClientRect();
    if (!rect.width) return;
    const cm = ((e.clientX - rect.left) / rect.width) * (columnWidthPx(view) / CM_TO_PX);
    addTabStop(view, Math.round(cm * 10) / 10, alignSelect()?.value as TabAlign ?? "left", leaderSelect()?.value ?? null);
    syncParagraphTabsInputs(view);
    view.focus();
  });

  const add = document.getElementById("btn-tab-add");
  add?.addEventListener("click", () => {
    const view = getView();
    const inp = posInput();
    if (!view || !inp) return;
    const raw = inp.value.trim();
    if (raw === "") return;
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) return;
    const widthCm = columnWidthPx(view) / CM_TO_PX;
    addTabStop(view, Math.round(Math.max(0, Math.min(widthCm, n)) * 100) / 100,
      alignSelect()?.value as TabAlign ?? "left", leaderSelect()?.value ?? null);
    inp.value = "";
    syncParagraphTabsInputs(view);
    view.focus();
  });

  const clear = document.getElementById("btn-tab-clear");
  clear?.addEventListener("click", () => {
    const view = getView();
    if (!view) return;
    setParagraphTabStops(view, []);
    selectedStop = null;
    syncParagraphTabsInputs(view);
    view.focus();
  });

  const canonical = document.getElementById("inp-tab-stops") as HTMLInputElement | null;
  canonical?.addEventListener("change", () => {
    const view = getView();
    if (!view) return;
    setParagraphTabStops(view, parseTabStops(canonical.value));
    syncParagraphTabsInputs(view);
    view.focus();
  });

  for (const [id, field] of [
    ["inp-tab-pos", "pos"],
    ["sel-tab-align", "align"],
    ["sel-tab-leader", "leader"],
  ] as const) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      updateSelected(field, (e.target as HTMLInputElement).value);
    });
  }

  document.getElementById("btn-tab-remove")?.addEventListener("click", () => {
    const view = getView();
    if (!view || selectedStop == null) return;
    removeTabStop(view, selectedStop);
    selectedStop = null;
    syncParagraphTabsInputs(view);
    view.focus();
  });

  posInput()?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (document.getElementById("btn-tab-add") as HTMLButtonElement | null)?.click();
    }
    if (e.key === "Escape") {
      const view = getView();
      (e.target as HTMLInputElement).value = "";
      view?.focus();
    }
  });
}

// ============================================================================
// The ROUND TRIP of the character. ProseMirror's HTML parser collapses
// whitespace (the editor draws with `pre-wrap`, the parser does not know), and a
// tabulation is whitespace: it would come back as a space. A sentinel that is
// not whitespace survives the parse, and the tab returns afterwards.
// ============================================================================

/** Something no document contains and no normalisation touches. */
const TAB_SENTINEL = "";

/** Swap every tab character of a DOM tree for the sentinel, before parsing. */
export function protectTabs(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (text.data.includes("	")) text.data = text.data.split("	").join(TAB_SENTINEL);
  }
}

/** Put the tabulations back into a parsed document (no sentinel: nothing to do). */
export function restoreTabCharacters(doc: PMNode): PMNode {
  if (!doc.textContent.includes(TAB_SENTINEL)) return doc;
  const tr = new Transform(doc);
  const at: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    for (let i = text.indexOf(TAB_SENTINEL); i >= 0; i = text.indexOf(TAB_SENTINEL, i + 1)) {
      at.push({ from: pos + i, to: pos + i + 1 });
    }
    return true;
  });
  for (const { from, to } of at.reverse()) tr.replaceWith(from, to, doc.type.schema.text("	"));
  return tr.doc;
}

// ============================================================================
// The paper: the same advances the screen shows, applied to the serialized
// fragment. The tab character stays inside the span, so the HTML export (and a
// reimport) still reads a tabulation.
// ============================================================================

export interface TabAdvance {
  /** Character offset inside the block (0 = its first character). */
  offset: number;
  widthPx: number;
  leader: string | null;
}

/**
 * Wrap every `\t` of `root` in a span carrying its advance. `baseOffset` says
 * how many characters of the block this fragment leaves out (a paragraph that
 * continues from the previous sheet), so the advances line up again.
 */
export function applyTabAdvances(root: HTMLElement, advances: readonly TabAdvance[], baseOffset = 0): void {
  if (!advances.length) return;
  const wanted = new Map<number, TabAdvance>();
  for (const a of advances) if (a.offset >= baseOffset) wanted.set(a.offset - baseOffset, a);
  if (!wanted.size) return;
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  let at = 0;
  for (const text of texts) {
    const len = text.length;
    // Tabs inside this node, in order: split it and wrap each character.
    let node: Text | null = text;
    let cursor = at;
    while (node) {
      const idx = node.data.indexOf("\t");
      if (idx < 0) {
        cursor += node.length;
        break;
      }
      const advance = wanted.get(cursor + idx);
      const tab: Text = idx ? node.splitText(idx) : node;
      node = tab.length > 1 ? tab.splitText(1) : null;
      if (advance) {
        const span = document.createElement("span");
        span.className = "aw-tab aw-tab--leader";
        span.style.width = `${advance.widthPx}px`;
        if (advance.leader) {
          span.dataset.leader = advance.leader;
          span.style.setProperty("--aw-leader-w", `${advance.widthPx}px`);
        }
        tab.replaceWith(span);
        span.append(tab);
      }
      cursor += idx + 1;
    }
    at += len;
  }
}