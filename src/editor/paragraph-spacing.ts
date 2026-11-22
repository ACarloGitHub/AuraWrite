/**
 * E1 — paragraph spacing before/after (the Word `w:spacing` pair).
 *
 * The contract: a pt value on the paragraph or heading, null = the
 * stylesheet's own rhythm. The screen renders it as the block's margins
 * (CSS collapses neighbours to the larger), and the page calculator already
 * walks margins with Math.max(pendingAfter, before) — ONE model, so the
 * editor, the preview and the paper agree by construction. The probe keeps
 * measuring the plain stylesheet blocks: an attribute overrides the probe
 * for ITS node only (`spacingOverride`), never the shared base.
 *
 * The value rides as data-space-before/after plus the inline variables
 * --aw-sb/--aw-sa (05-document.css turns them into margins), so the HTML
 * export carries it and the reimport reads it back (D10). A continuation
 * sheet strips the leading margin (11-print-sheet.css, .aw-print-cont):
 * the engine gives a split paragraph's second fragment no before, and the
 * class rule outranks the variable-based margin.
 */
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { BlockSpacing } from "./text-metrics";

/** Word counts spacing in pt; the screen lives in px (96 dpi). */
export const PT_TO_PX = 96 / 72;

/** The node's own choice beats the probed base; null keeps the base. */
export function spacingOverride(node: PMNode, base: BlockSpacing): BlockSpacing {
  const before = node.attrs?.spaceBefore;
  const after = node.attrs?.spaceAfter;
  const hasBefore = typeof before === "number" && Number.isFinite(before);
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  if (!hasBefore && !hasAfter) return base;
  return {
    beforePx: hasBefore ? Math.max(0, before * PT_TO_PX) : base.beforePx,
    afterPx: hasAfter ? Math.max(0, after * PT_TO_PX) : base.afterPx,
  };
}

/** Read a pt attribute from markup (export, paste, DOCX import). */
export function parseSpacingPt(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const isTextBlock = (name: string): boolean => name === "paragraph" || name === "heading";

// Where the engine MEASURES the pair: the flow (spacingFor in the page walk)
// and table cells (measureCellContent). A list is measured as one text flow
// (measureTextBlock) and a box's content is not walked block by block: a value
// there would draw on screen and not exist on paper, so the fields don't write
// it. Scope grows when the measurement does.
const measuredParent = (name: string): boolean =>
  name === "doc" || name === "table_cell" || name === "table_header";

/**
 * Apply one field to every paragraph/heading the selection touches; with a
 * collapsed caret, to the caret's block. Same walk as the line spacing:
 * setNodeMarkup never changes sizes, so one transaction, one recompute.
 */
export function setParagraphSpacing(
  view: EditorView,
  field: "spaceBefore" | "spaceAfter",
  pt: number | null,
): void {
  const { state } = view;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  let changed = false;
  const set = (node: PMNode, pos: number): void => {
    if (node.attrs[field] !== pt) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [field]: pt });
      changed = true;
    }
  };
  if (empty) {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (isTextBlock(node.type.name)) {
        if (d >= 1 && measuredParent($from.node(d - 1).type.name)) set(node, $from.before(d));
        break;
      }
    }
  } else {
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (isTextBlock(node.type.name)) {
        if (parent && measuredParent(parent.type.name)) set(node, pos);
        return false;
      }
      return true;
    });
  }
  if (changed) view.dispatch(tr);
}

/** The block whose values the fields show: the caret's, or the selection's first. */
function shownBlock(view: EditorView): PMNode | null {
  let { $from } = view.state.selection;
  // Ctrl+A anchors at the document's edge (depth 0): step inside the first
  // block, the same lesson the line-height select learned (8ce2142).
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

/** The fields say what the shown block carries; empty means Default (null). */
export function syncParagraphSpacingInputs(view: EditorView): void {
  const before = document.getElementById("inp-space-before") as HTMLInputElement | null;
  const after = document.getElementById("inp-space-after") as HTMLInputElement | null;
  if (!before || !after) return;
  const node = shownBlock(view);
  const sb = node?.attrs?.spaceBefore;
  const sa = node?.attrs?.spaceAfter;
  const bv = typeof sb === "number" ? String(sb) : "";
  const av = typeof sa === "number" ? String(sa) : "";
  // Never fight the writer mid-edit: only rewrite a field that is not focused.
  if (document.activeElement !== before && before.value !== bv) before.value = bv;
  if (document.activeElement !== after && after.value !== av) after.value = av;
}

/**
 * Wire the dropdown once. The panel reuses the margins-dropdown markup and
 * CSS, so the overflow menu replicates its rows with no new code. Empty
 * input = Default; a typed number is pt, clamped like Word's dialog.
 */
export function setupParagraphSpacing(getView: () => EditorView | null): void {
  const btn = document.getElementById("btn-spacing");
  const panel = document.getElementById("spacing-panel");
  if (!btn || !panel) return;

  const close = (): void => panel.classList.remove("visible");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.classList.contains("visible")) {
      close();
      return;
    }
    const view = getView();
    if (view) syncParagraphSpacingInputs(view);
    const rect = btn.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.left = `${rect.left}px`;
    panel.classList.add("visible");
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  });

  const fields: Array<{ id: string; field: "spaceBefore" | "spaceAfter" }> = [
    { id: "inp-space-before", field: "spaceBefore" },
    { id: "inp-space-after", field: "spaceAfter" },
  ];
  for (const { id, field } of fields) {
    const inp = document.getElementById(id) as HTMLInputElement | null;
    if (!inp) continue;
    inp.addEventListener("change", () => {
      const view = getView();
      if (!view) return;
      const raw = inp.value.trim();
      const pt = raw === "" ? null : Math.max(0, Math.min(600, Number(raw)));
      setParagraphSpacing(view, field, pt !== null && Number.isFinite(pt) ? pt : null);
      view.focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      if (e.key === "Escape") {
        const view = getView();
        if (view) syncParagraphSpacingInputs(view);
        close();
        view?.focus();
      }
    });
  }
}
