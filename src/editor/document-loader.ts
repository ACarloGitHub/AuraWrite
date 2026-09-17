/**
 * The one door a stored document walks through to get into the editor.
 *
 * Three places used to repeat the sequence by hand - the project panel's
 * document selection, the "clear the editor" event, and (empty text) the
 * parse-error fallback - and a fourth one (the verification tool) had to reach
 * inside the view to do it. The sequence is short but it has a step with
 * consequences: after the state is replaced, the pagination must be re-synced,
 * and a caller that forgets that step gets an editor that shows one document
 * and paginates another.
 *
 * `applyDocumentJson` throws on unusable text: the caller decides whether an
 * unusable document clears the editor (the panel's long-standing behaviour) or
 * reports the error back (the tool's need).
 */
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { migrateLegacyDocumentJson } from "./enriched-schema";
import { syncDocumentPaginationState } from "./editor";

/** Stored text (ProseMirror JSON) → the node, with the legacy shape migrated. */
export function documentNodeFromJson(view: EditorView, text: string): PMNode {
  const raw = JSON.parse(text) as unknown;
  return view.state.schema.nodeFromJSON(migrateLegacyDocumentJson(raw));
}

/** Make the editor show exactly this document, then re-sync the pagination. */
export function applyDocumentJson(view: EditorView, text: string): void {
  const doc = documentNodeFromJson(view, text);
  view.updateState(
    EditorState.create({
      schema: view.state.schema,
      doc,
      plugins: view.state.plugins,
    }),
  );
  syncDocumentPaginationState(view);
}

/** Empty the editor, the same way an empty stored document empties it. */
export function clearEditorDocument(view: EditorView): void {
  const tr = view.state.tr;
  tr.delete(0, tr.doc.content.size);
  view.dispatch(tr);
  syncDocumentPaginationState(view);
}
