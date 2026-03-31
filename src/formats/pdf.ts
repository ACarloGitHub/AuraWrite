/**
 * PDF Import/Export - Placeholder
 * 
 * TODO: Implementare estrazione PDF strutturata
 * 
 * Per l'import PDF:
 * - Usare pdf.js per leggere il PDF
 * - Estrarre testo con posizioni
 * - Tentare di ricostruire la struttura (titoli, paragrafi)
 * - Limitazione: layout complesso non sarà preservato
 * 
 * Per l'export PDF:
 * - Usare pdf-lib per creare PDF da zero
 * - Mappare nodi ProseMirror a elementi PDF
 * - Supporto base per testo, titoli, liste
 * 
 * Riferimenti:
 * - pdf.js: https://mozilla.github.io/pdf.js/
 * - pdf-lib: https://pdf-lib.com/
 */

export async function fromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  throw new Error(
    "PDF import not yet implemented. " +
    "This is a placeholder for future enhancement."
  );
}

export function toPDF(doc: any): any {
  throw new Error(
    "PDF export not yet implemented. " +
    "This is a placeholder for future enhancement."
  );
}
