export type DocumentChange = {
  from: number;
  oldLen: number;
  newLen: number;
};

export type Source = "suggestions" | "ai_assistant" | "external";

export type ChangeListener = (change: DocumentChange, source: Source) => void;

const listeners: Map<string, ChangeListener> = new Map();

export function subscribeToChanges(
  id: string,
  listener: ChangeListener,
): () => void {
  listeners.set(id, listener);
  return () => {
    listeners.delete(id);
  };
}

export function unsubscribe(id: string): void {
  listeners.delete(id);
}

export function notifyDocumentChange(
  change: DocumentChange,
  source: Source,
): void {
  listeners.forEach((listener, id) => {
    listener(change, source);
  });
}

export function getActiveListeners(): string[] {
  return Array.from(listeners.keys());
}
