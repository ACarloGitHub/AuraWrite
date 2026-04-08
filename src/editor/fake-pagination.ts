/**
 * Fake Pagination — Toggle auto pagination on/off
 *
 * Based on tiptap-pagination-breaks logic:
 * https://github.com/adityayaduvanshi/tiptap-pagination-breaks
 *
 * Uses ProseMirror Decorations for automatic page breaks.
 * Single editor, visual page breaks only.
 */

import type { EditorView } from "prosemirror-view";
import { setPluginEnabled, getPluginEnabled } from "./page-break-plugin";

let autoPaginationEnabled = false;
let editorView: EditorView | null = null;
let editorContainer: HTMLElement | null = null;

export function getPaginationEnabled(): boolean {
  return autoPaginationEnabled;
}

export function setPaginationEnabled(
  enabled: boolean,
  view?: EditorView,
): void {
  if (view) editorView = view;
  autoPaginationEnabled = enabled;
  applyMode();
}

export function togglePagination(view?: EditorView): boolean {
  if (view) editorView = view;
  autoPaginationEnabled = !autoPaginationEnabled;
  applyMode();
  return autoPaginationEnabled;
}

export function initPagination(container: HTMLElement, view: EditorView): void {
  editorContainer = container;
  editorView = view;
  applyMode();
}

function applyMode(): void {
  if (!editorContainer || !editorView) return;

  // Reset mode classes
  editorContainer.classList.remove(
    "pagination-mode-continuous",
    "pagination-mode-paged",
  );

  if (autoPaginationEnabled) {
    editorContainer.classList.add("pagination-mode-paged");
    setPluginEnabled(true);
  } else {
    editorContainer.classList.add("pagination-mode-continuous");
    setPluginEnabled(false);
  }
}

export function updateOnTextChange(view?: EditorView): void {
  if (view) editorView = view;
  if (autoPaginationEnabled && editorView) {
    // Force re-render of decorations
    const tr = editorView.state.tr;
    editorView.dispatch(tr);
  }
}
