// ============================================================================
// "Borders…" — the pen and the presets, in a panel under the table bar.
//
// One click on a preset paints it over the selected cells with the pen shown
// below (thickness in points, colour). The panel stays open, so a table can be
// given an outer line and then inner ones without reopening it.
//
// The pen starts from the cell under the caret when that cell already carries a
// border of its own: a second edit continues with the same colour instead of
// jumping back to the default. EdenText's TableTabs does the same.
// ============================================================================

import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import {
  parseBorder,
  setTableBorders,
  type BorderPen,
  type BorderPreset,
} from "./table-borders";

const MIN_WIDTH_PT = 0.25;
const MAX_WIDTH_PT = 12;
const DEFAULT_PEN: BorderPen = { widthPt: 0.5, color: "#000000" };

const PRESETS: { preset: BorderPreset; label: string; title: string }[] = [
  { preset: "all", label: "All", title: "Every side of the selected cells" },
  { preset: "outer", label: "Outer", title: "The edge around the selection" },
  { preset: "inner", label: "Inner", title: "Every line between the selected cells" },
  { preset: "innerH", label: "Horizontal", title: "The horizontal lines inside the selection" },
  { preset: "innerV", label: "Vertical", title: "The vertical lines inside the selection" },
  { preset: "none", label: "None", title: "No line at all" },
  { preset: "top", label: "Top", title: "The top edge of the selection" },
  { preset: "bottom", label: "Bottom", title: "The bottom edge of the selection" },
  { preset: "left", label: "Left", title: "The left edge of the selection" },
  { preset: "right", label: "Right", title: "The right edge of the selection" },
];

let panel: HTMLElement | null = null;
let widthInput: HTMLInputElement | null = null;
let colorInput: HTMLInputElement | null = null;
let pen: BorderPen = { ...DEFAULT_PEN };

function clampWidth(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PEN.widthPt;
  return Math.max(MIN_WIDTH_PT, Math.min(MAX_WIDTH_PT, n));
}

/** The cell the caret sits in, if any. */
function cellAt(view: EditorView): PMNode | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table_cell" || node.type.name === "table_header") return node;
  }
  return null;
}

function readPen(): BorderPen {
  const widthPt = clampWidth(widthInput?.value ?? String(DEFAULT_PEN.widthPt));
  const color = colorInput?.value || DEFAULT_PEN.color;
  return { widthPt, color: color.toUpperCase() };
}

function apply(view: EditorView, preset: BorderPreset): void {
  pen = readPen();
  setTableBorders(preset, preset === "none" ? null : pen)(view.state, view.dispatch, view);
  view.focus();
}

function ensurePanel(view: EditorView): HTMLElement {
  if (panel) return panel;

  panel = document.createElement("div");
  panel.className = "table-dropdown table-borders-panel hidden";
  panel.innerHTML =
    '<div class="table-borders-presets">' +
    PRESETS.map(
      (p) =>
        `<button type="button" class="table-borders-preset" data-preset="${p.preset}" title="${p.title}">${p.label}</button>`,
    ).join("") +
    "</div>" +
    '<div class="table-borders-pen">' +
    '<label class="table-picker-field">Thickness ' +
    `<input id="tbl-border-width" type="number" min="${MIN_WIDTH_PT}" max="${MAX_WIDTH_PT}" step="0.25" value="${DEFAULT_PEN.widthPt}" />` +
    "</label>" +
    '<label class="table-picker-field">Colour ' +
    `<input id="tbl-border-color" type="color" value="${DEFAULT_PEN.color}" />` +
    "</label>" +
    "</div>";
  document.body.appendChild(panel);

  widthInput = panel.querySelector<HTMLInputElement>("#tbl-border-width");
  colorInput = panel.querySelector<HTMLInputElement>("#tbl-border-color");

  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-preset]");
    if (!button) return;
    event.preventDefault();
    apply(view, button.dataset.preset as BorderPreset);
  });

  // The fields only move the pen: the next preset click paints with it.
  const onPen = () => {
    pen = readPen();
  };
  widthInput?.addEventListener("change", onPen);
  colorInput?.addEventListener("input", onPen);

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideBordersPanel();
      view.focus();
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (!panel || panel.classList.contains("hidden")) return;
    const target = event.target as HTMLElement;
    if (panel.contains(target) || target.closest("#tbl-borders")) return;
    hideBordersPanel();
  });

  return panel;
}

/** Show the panel under its button, with the pen of the cell under the caret. */
export function toggleBordersPanel(view: EditorView, button: HTMLElement): void {
  const element = ensurePanel(view);
  if (!element.classList.contains("hidden")) {
    hideBordersPanel();
    return;
  }

  const cell = cellAt(view);
  const inherited = cell ? parseBorder(cell.attrs.borderTop) : null;
  if (inherited && inherited !== "none") {
    pen = { widthPt: inherited.widthPt, color: inherited.color };
  }
  if (widthInput) widthInput.value = String(pen.widthPt);
  if (colorInput) colorInput.value = pen.color;

  const rect = button.getBoundingClientRect();
  const width = element.offsetWidth || 220;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 60));
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.classList.remove("hidden");
}

export function hideBordersPanel(): void {
  panel?.classList.add("hidden");
}
