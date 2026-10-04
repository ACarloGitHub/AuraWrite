/**
 * Dropping the notes AuraWrite keeps in the window's internal memory (the
 * WebView's localStorage): the lists of models offered by a provider, and the
 * context size of each model. Every note has a label, so "drop the notes of one
 * provider" means "drop every label that begins with this text".
 *
 * That loop was written three times: twice in ai-panel/model-listing.ts (the
 * notes of one provider, and all of them) and once in ai-panel/context-window.ts.
 * One home on purpose: a change in how the labels are built is now one edit, and
 * the three places cannot drift apart.
 */
export function removeKeysWithPrefix(prefix: string): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
