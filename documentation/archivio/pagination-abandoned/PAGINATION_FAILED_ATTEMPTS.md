# Fake Pagination — Tentativi Falliti e Lezioni Apprese

**Data:** 2026-04-03
**Stato:** Nuovo approccio basato su tiptap-pagination-breaks

---

## Tentativo 1: Overlay Decorativo (2026-04-03)

**Cosa ho fatto:**
- Creato `fake-pagination.ts` con overlay CSS sopra l'editor
- Rettangoli A4 trasparenti sovrapposti all'editor continuo
- Nessun contenimento del testo

**Risultato:** ❌ FALLITO

**Problema:**
- I rettangoli erano solo decorativi, il testo non era contenuto
- Nessuna differenza visiva tra continuo e paged (solo sfondo)
- Carlo: "è una cosa completamente inutile, anzi fastidiosa"

**Lezione:** Un overlay sopra l'editor non crea pagine reali. Il testo deve essere DENTRO le pagine.

---

## Tentativo 2: Container Separati con contenteditable (2026-04-03)

**Cosa ho fatto:**
- Creato rettangoli A4 separati con `contenteditable` dentro
- Nascosto l'editor ProseMirror originale
- Testo diviso tra pagine usando Pretext
- Sync manuale da pagina → ProseMirror

**Risultato:** ❌ FALLITO

**Problema:**
- Container separati non funzionano con ProseMirror
- Undo/redo rotto (ogni pagina ha il suo undo stack)
- Selezione testo non attraversa pagine
- Sync manuale fragile e lento
- Carlo: "non funziona. Non è possibile mettere un container separato vero?"

**Lezione:** ProseMirror è UN SOLO editor. Non può essere diviso in container separati.

---

## Tentativo 3: CSS sull'Editor Singolo (2026-04-03)

**Cosa ho fatto:**
- Un SOLO editor ProseMirror
- CSS trasforma l'editor in forma A4 (larghezza, margini, sfondo, ombra)
- Pretext calcola overflow → inserisce page break automatici
- Toggle 3 modalità: Continuo → Paged → Misto

**Risultato:** ❌ FALLITO

**Problema:**
- L'editor aveva forma A4 ma il testo overflowava senza page break
- Nessuna separazione visiva tra pagine
- Pretext calcolava altezza ma non inseriva page break nel documento

**Lezione:** CSS da solo non basta. Serve un plugin ProseMirror che inserisce page break decorations.

---

## Tentativo 4: prosemirror-pagination (2026-04-02)

**Cosa ho fatto:**
- Installato `prosemirror-pagination@0.1.5`
- Cambiato schema per usare nodi `page`, `body`, etc.

**Risultato:** ❌ FALLITO

**Problemi:**
- Bug critico: `TypeError: Cannot read properties of undefined (reading 'lastChild')`
- Schema invasivo (23 nodi obbligatori)
- Conflitto dipendenze (`prosemirror-tables@^0.9.1`)
- Documentazione inesistente
- Zero manutenzione

**Lezione:** Plugin esterni non mantenuti sono un rischio enorme.

---

## Analisi di Soluzioni Esterne (2026-04-03)

### tiptap-pagination-breaks ✅ APPROCCIATO CORRETTO

**Repo:** https://github.com/adityayaduvanshi/tiptap-pagination-breaks

**Come funziona:**
1. Un SOLO editor ProseMirror (Tiptap è wrapper di ProseMirror)
2. Plugin ProseMirror con `decorations`
3. Calcola altezza DOM con `nodeDOM.offsetHeight` per ogni nodo blocco
4. Itera sui nodi con `doc.descendants()`
5. Quando `currentPageHeight > effectivePageHeight` → inserisce page-break decoration
6. Gestisce liste come caso speciale

**Perché funziona:**
- Non cambia lo schema
- Usa ProseMirror Decorations (native)
- Undo/redo funziona
- Selezione attraversa pagine
- Un solo editor, un solo documento

### vue-document-editor ❌ NON COMPATIBILE

**Repo:** https://github.com/motla/vue-document-editor

**Problemi:**
- Usa Vue.js, non ProseMirror
- Undo/redo nativo NON funziona (devi implementarlo tu)
- Multiple contenteditable separati
- La docs stessa dice: "non intende sostituire un vero editor documenti"

---

## Lezioni Apprese

1. **ProseMirror è UN SOLO editor** — Non può essere diviso in container separati
2. **Decorations sono la via giusta** — Si aggiornano automaticamente, non rompono undo/redo
3. **CSS da solo non basta** — Serve logica per calcolare overflow e inserire page break
4. **Pretext non serve per page break** — Serve per misurare testo, ma il page break va nel documento ProseMirror
5. **Plugin esterni non mantenuti sono rischiosi** — `prosemirror-pagination` è abbandonato
6. **tiptap-pagination-breaks mostra la via giusta** — Un solo editor, decorations per page break

---

## Nuovo Approccio (Implementato 2026-04-03)

Basato su `tiptap-pagination-breaks`:

1. **Plugin ProseMirror** (`page-break-plugin.ts`) con `decorations` per page-break widget
2. **Calcolo altezza DOM** con `nodeDOM.offsetHeight` per ogni nodo blocco
3. **Iterazione nodi** con `doc.descendants()`
4. **Page break automatici** quando overflow → inserisce decoration widget
5. **Toggle 2 modalità:** Auto Pagination ↔ Continuous

**UI:**
- Pulsante "Auto" nella toolbar → attiva/disattiva paginazione automatica
- Quando attivo: stile A4 + page break decorations con numero pagina
- Quando disattivato: editor continuo normale

**Riferimenti:**
- https://github.com/adityayaduvanshi/tiptap-pagination-breaks
- Codice sorgente: `src/index.ts` nel repo
- File implementati: `page-break-plugin.ts`, `fake-pagination.ts`
