/**
 * The one door a stored document walks through to get into the editor.
 *
 * `installDocument` is the door: EVERY surface that puts a document in front of
 * the writer goes through it - the project panel, the verification tool, and
 * each File > Open format in `toolbar.ts` (which translate first, and then
 * install the node like everybody else). It exists because the sequence has a
 * step that is easy to forget and impossible to notice: replacing the state
 * rebuilds the editor's plugin views, and a rebuilt view never gets its
 * `update` call (`prosemirror-view/dist/index.js:5561-5575` destroys and
 * re-creates them when the plugins array is not the same object, which is what
 * any fresh `EditorState.create` gives). So nothing that lives in an `update`
 * - including the reserved-space measurement, which is painted one frame later
 * - happens by itself after an open. Measured on 2026-09-17: a document that
 * had just been opened showed ZERO reservation pieces while the calculator
 * booked three, and the first keystroke (which does reach `update`) restored
 * them. A road that installs without asking gets an editor whose text runs
 * under the pictures until the writer types.
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

/**
 * Put exactly this document in front of the writer, and ask again for the space
 * its free elements reserve to the text. The two things are one step on purpose:
 * the second only makes sense for the document that is now on the page, so no
 * caller should ever have to remember to say it.
 */
export function installDocument(view: EditorView, doc: PMNode): void {
  view.updateState(
    EditorState.create({
      schema: view.state.schema,
      doc,
      plugins: view.state.plugins,
    }),
  );
  askForBandMeasurement(view);
}

/** Show an empty document (File > New, and a file whose folder was deleted). */
export function installEmptyDocument(view: EditorView): void {
  view.updateState(
    EditorState.create({
      schema: view.state.schema,
      plugins: view.state.plugins,
    }),
  );
  askForBandMeasurement(view);
}

/** Make the editor show exactly this stored text, through the one door. */
export function applyDocumentJson(view: EditorView, text: string): void {
  installDocument(view, documentNodeFromJson(view, text));
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
 * more shortly after. The ask is the same measurement the plugin runs after every
 * paint; it only costs a re-measure, and it empties the reservations of the
 * document that is going away as well as filling in the new one's.
 */
function askForBandMeasurement(view: EditorView): void {
  // Direttamente la misura, non un evento che la chieda: misurato il 17-09 su un
  // documento aperto, l'evento delle metriche e quello della pittura non
  // producevano nessuna fascia (0 pezzi, 0 fasce in memoria), mentre la stessa
  // misura chiamata da qui le produce. Il documento appena aperto deve mostrare
  // subito lo spazio riservato al testo, senza dover cliccare.
  const ask = (force: boolean): void => {
    if (!view.isDestroyed) refreshFreeWrapBands(view, force ? { force: true } : undefined);
  };
  // `force`: opening a document is a deliberate action, and a page that has just
  // been built needs several passes to settle (band -> text -> anchor -> band).
  // Without it the third measurement stays withheld and the lines run under the
  // pictures until something else forces a measure - which is exactly what the
  // print preview used to do, moving everything as it opened (L01, 2026-10-23).
  ask(true);
  window.requestAnimationFrame(() => {
    ask(false);
    window.requestAnimationFrame(() => ask(false));
  });
  window.setTimeout(() => ask(true), 250);
}

/** Empty the editor, the same way an empty stored document empties it. */
export function clearEditorDocument(view: EditorView): void {
  const tr = view.state.tr;
  tr.delete(0, tr.doc.content.size);
  view.dispatch(tr);
  syncDocumentPaginationState(view);
}
