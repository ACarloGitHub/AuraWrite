# Fake Pagination — Piano di Implementazione (tiptap-pagination-breaks)

**Data:** 2026-04-03
**Stato:** Da implementare
**Approccio:** Basato su tiptap-pagination-breaks

---

## Riferimenti

- **Repo originale:** https://github.com/adityayaduvanshi/tiptap-pagination-breaks
- **Codice sorgente:** `src/index.ts` nel repo
- **Tentativi falliti:** `documentation/06-roadmap/PAGINATION_FAILED_ATTEMPTS.md`

---

## Come Funziona tiptap-pagination-breaks

### Architettura

```
Un SOLO editor ProseMirror
    ↓
Plugin ProseMirror con decorations
    ↓
Itera nodi: doc.descendants()
    ↓
Calcola altezza: nodeDOM.offsetHeight
    ↓
Se currentPageHeight > effectivePageHeight
    ↓
Inserisci page-break decoration
```

### Punti Chiave del Codice

1. **Plugin ProseMirror** con `addProseMirrorPlugins()`
2. **State del plugin:** `{ pageHeight, pageWidth, pageMargin, label, showPageNumber }`
3. **Decorations:** Widget page-break inseriti tra i nodi blocco
4. **Calcolo altezza:** `nodeDOM.offsetHeight` per ogni nodo blocco
5. **Gestione liste:** Caso speciale — accumula altezza di tutti i listItem prima di decidere il page break
6. **CSS:** `.page-break` con linea tratteggiata e numero pagina

### Codice Chiave (adattato per ProseMirror vanilla)

```typescript
// Plugin state
const options = {
  pageHeight: 1056,    // px (A4 a 96dpi)
  pageWidth: 816,      // px
  pageMargin: 96,      // px
  label: 'Pagina',
  showPageNumber: true,
};

// Decorations
doc.descendants((node, pos) => {
  if (!node.isBlock) return;
  
  const nodeDOM = view.nodeDOM(pos);
  if (!(nodeDOM instanceof HTMLElement)) return;
  
  const nodeHeight = nodeDOM.offsetHeight;
  
  if (currentPageHeight + nodeHeight > effectivePageHeight) {
    decorations.push(createPageBreak(pos));
    currentPageHeight = nodeHeight;
  } else {
    currentPageHeight += nodeHeight;
  }
});
```

---

## Piano di Implementazione

### FASE 1: Plugin ProseMirror per Page Break

**File:** `src/editor/page-break-plugin.ts` (nuovo)

**Cosa fare:**
1. Creare plugin ProseMirror con `PluginKey`
2. State: `{ pageHeight, pageWidth, pageMargin, showPageNumber }`
3. `decorations` prop che itera sui nodi e inserisce page-break widget
4. Widget: `<div class="page-break">` con numero pagina
5. Gestire liste come caso speciale

**Dettagli tecnici:**
- `pageHeight: 1122` px (A4 a 96dpi: 297mm × 3.78)
- `pageWidth: 794` px (A4 a 96dpi: 210mm × 3.78)
- `pageMargin: 96` px (25mm top/bottom, 20mm left/right)
- `effectivePageHeight = pageHeight - 2 * pageMargin`

### FASE 2: CSS per Stile A4

**File:** `src/styles.css` (modificare)

**Cosa aggiungere:**
```css
/* Modalità paged */
.pagination-mode-paged .ProseMirror {
  width: 794px;
  margin: 0 auto;
  background: var(--color-paper, #ffffff);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  padding: 96px;
  min-height: 1122px;
}

/* Page break widget */
.page-break {
  height: 20px;
  width: 100%;
  border-top: 2px dashed rgba(0, 100, 255, 0.4);
  margin: 10px 0;
  position: relative;
}

.page-break .page-number {
  position: absolute;
  right: 0;
  top: -10px;
  font-size: 12px;
  color: #666;
  background: var(--color-paper, #ffffff);
  padding: 0 8px;
  border-radius: 4px;
}
```

### FASE 3: Integrazione in editor.ts

**File:** `src/editor/editor.ts` (modificare)

**Cosa fare:**
1. Importare `pageBreakPlugin`
2. Aggiungere ai plugins dell'EditorState
3. Toggle modalità: Continuo → Paged → Misto

### FASE 4: Toggle nella Toolbar

**File:** `src/editor/toolbar.ts` (modificare)

**Cosa fare:**
1. Pulsante "Pages" cicla tra 3 modalità
2. Aggiornare CSS del container in base alla modalità
3. In modalità "paged": stile A4 + page break decorations
4. In modalità "mixed": solo page break decorations
5. In modalità "continuous": nessun page break

### FASE 5: Test e Refinement

**Test da fare:**
- [ ] Testo lungo → page break automatici
- [ ] Undo/redo funziona con page break
- [ ] Selezione testo attraversa page break
- [ ] Liste non vengono spezzate a metà
- [ ] Toggle modalità funziona
- [ ] Suggestions Panel funziona con page break
- [ ] AI Assistant funziona con page break

---

## Dipendenze tra Fasi

```
FASE 1 (Plugin) → FASE 2 (CSS) → FASE 3 (Integrazione) → FASE 4 (Toggle) → FASE 5 (Test)
```

---

## Note Tecniche

### Differenze rispetto a tiptap-pagination-breaks

1. **No Tiptap** — Usiamo ProseMirror vanilla
2. **No textStyle** — Non aggiungiamo global attributes
3. **Pretext** — Possiamo usarlo per calcoli più precisi se necessario
4. **Suggerimenti** — Dobbiamo assicurarci che le decorations non confliggano

### Gestione Liste

tiptap-pagination-breaks gestisce liste in modo speciale:
- Accumula altezza di tutti i listItem
- Solo quando la lista è completa, decide se fare page break
- Questo evita di spezzare una lista a metà

Dobbiamo replicare questa logica.

### Performance

- `nodeDOM.offsetHeight` causa reflow — ma è necessario per accuratezza
- Pretext potrebbe essere usato per calcoli preliminari, ma il DOM è l'unica fonte vera
- Debounce su resize/scroll se necessario
