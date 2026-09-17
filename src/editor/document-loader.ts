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
import { refreshFreeWrapBands } from "./pagination-cassie-plugin";

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
  askForBandMeasurement(view);
}

/**
 * After a document is REPLACED (opened, not edited) the space a free element
 * reserves to the text has to be measured again, and it has to be asked for
 * after the new nodes are on the page: measured on this build, an opened
 * document had ZERO reservation pieces and the text ran under the pictures until
 * the first keystroke - while the same document, typed in, had them.
 *
 * One ask is not enough: the free elements are placed one frame after the state
 * update (see free-layout-plugin), and a picture that has just been mounted can
 * still report a size of zero. So: immediately, on the next two frames, and once
 * more shortly after. The ask is the same event the program already fires when
 * the fonts or the theme change; it only costs a re-measure.
 */
function askForBandMeasurement(view: EditorView): void {
  // Direttamente la misura, non un evento che la chieda: misurato il 17-09 su un
  // documento aperto, l'evento delle metriche e quello della pittura non
  // producevano nessuna fascia (0 pezzi, 0 fasce in memoria), mentre la stessa
  // misura chiamata da qui le produce. Il documento appena aperto deve mostrare
  // subito lo spazio riservato al testo, senza dover cliccare.
  const ask = (): void => {
    if (!view.isDestroyed) refreshFreeWrapBands(view);
  };
  ask();
  window.requestAnimationFrame(() => {
    ask();
    window.requestAnimationFrame(ask);
  });
  window.setTimeout(ask, 250);
}

/** Empty the editor, the same way an empty stored document empties it. */
export function clearEditorDocument(view: EditorView): void {
  const tr = view.state.tr;
  tr.delete(0, tr.doc.content.size);
  view.dispatch(tr);
  syncDocumentPaginationState(view);
}
