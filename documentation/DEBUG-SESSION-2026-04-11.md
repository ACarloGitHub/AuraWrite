# Debug Session — 2026-04-11

## Panoramica

Sessione di debug concentrata su tre bug principali:
1. "Could not save document" — errore salvataggio
2. Click tra documenti senza check modifiche
3. UI freeze dopo auto-salvataggio

---

## Bug #1: "Could not save document"

### Causa
```typescript
// db.ts (VECCHIO)
version_number: Date.now()  // timestamp in millisecondi
```

Il valore `Date.now()` restituisce un numero > 1.7 trilioni, che overflowa `i32` in Rust (max ~2 miliardi).

### Fix
```typescript
// db.ts (NUOVO)
const existingVersions = await getVersions(document.id);
const nextVersionNumber = existingVersions.length > 0 
  ? Math.max(...existingVersions.map(v => v.version_number)) + 1 
  : 1;
```

Usare numero progressivo (1, 2, 3...) invece di timestamp.

---

## Bug #2: Click tra documenti senza check modifiche

### Causa
```typescript
// project-panel.ts (VECCHIO)
header.addEventListener("click", (e) => {
  e.stopPropagation();
  selectDocument(doc);  // ← chiamata diretta, nessun check
});
```

### Fix
```typescript
// project-panel.ts (NUOVO)
header.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (currentDocument?.id === doc.id) return;
  
  const action = await handleCloseDocument();  // ← check modifiche
  if (action === 'proceed') {
    selectDocument(doc);
  }
});
```

---

## Bug #3: Auto-salvataggio non chiamato

### Causa
`scheduleAutoSave()` definita in `project-panel.ts` ma mai invocata.

### Fix
```typescript
// toolbar.ts
if (transaction.docChanged) {
  window.dispatchEvent(new CustomEvent("aurawrite:content-changed"));
}

// project-panel.ts
window.addEventListener("aurawrite:content-changed", () => {
  scheduleAutoSave();
});
```

---

## Bug #4: UI freeze dopo 12 secondi

### Causa
Tre moduli con flag `isLoadingDocument` separati:
- `main.ts` — flag locale
- `toolbar.ts` — non aveva flag
- `project-panel.ts` — flag locale

Quando si cambiava documento, `toolbar.ts` emetteva l'evento prima che gli altri moduli potessero bloccarlo.

### Fix
Flag globale coordinato:

```typescript
// main.ts
(window as any).__aurawrite_loading = false;
function setLoading(val: boolean) {
  (window as any).__aurawrite_loading = val;
}

// toolbar.ts
const isLoading = (window as any).__aurawrite_loading === true;
if (!isLoading) {
  window.dispatchEvent(new CustomEvent("aurawrite:content-changed"));
}

// project-panel.ts
function selectDocument(doc: Document): void {
  (window as any).__aurawrite_loading = true;
  // ...carica documento...
  setTimeout(() => {
    (window as any).__aurawrite_loading = false;
  }, 100);
}
```

---

## Bug Ancora Presenti

### 1. Auto-salvataggio probabilmente non funziona
- Il log "Auto-saving document..." non appare
- Possibili cause:
  - Evento non emesso (toolbar.ts)
  - Evento non ricevuto (project-panel.ts)
  - `checkUnsavedChanges()` restituisce false

### 2. Sistema versioni non testato
- Funzioni implementate in Rust e TypeScript
- Dialog creato
- Ma nessun test reale effettuato

---

## Commit Effettuati

| Hash | Descrizione |
|------|-------------|
| `9ff8e7b` | fix: document versioning and close dialog logic |
| `deaf19a` | fix: connect dirty tracking to auto-save |
| `52c463a` | fix: prevent auto-save during document loading (UI freeze) |

---

## File Modificati

- `src-tauri/src/database.rs`
- `src-tauri/src/lib.rs`
- `src/database/db.ts`
- `src/editor/project-panel.ts`
- `src/editor/toolbar.ts`
- `src/main.ts`
- `src/styles.css`
- `src/types/database.ts`
- `documentation/02-TODO.md`

---

## Prossima Sessione

1. **Test auto-salvataggio**: aggiungere log per capire dove si ferma
2. **Test dialog**: provare scenari Save/Don't Save/Cancel
3. **Test versioni**: verificare creazione e caricamento versioni

---

*Sessione sospesa 17:08 — Carlo doveva andare*