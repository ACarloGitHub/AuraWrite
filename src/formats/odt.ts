/**
 * ODT Import/Export - Placeholder
 * 
 * TODO: Implementare supporto ODT
 * 
 * La libreria 'odf' potrebbe non essere compatibile con il setup attuale.
 * Alternativa: usare JSZip per creare manualmente il file ODT (formato ZIP)
 */

export function toOdt(doc: any): any {
  throw new Error(
    "ODT export not yet implemented. " +
    "This is a placeholder for future enhancement."
  );
}

export async function fromOdt(arrayBuffer: ArrayBuffer): Promise<string> {
  throw new Error(
    "ODT import not yet implemented. " +
    "This is a placeholder for future enhancement."
  );
}
