# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-17

---

## Sessione 2026-04-17 — Cosa e' stato fatto

1. **Semantic Search Toggle in Preferences** — PARZIALMENTE IMPLEMENTATO
   - Aggiunto `semanticSearchEnabled` boolean in Preferences interface + default (true)
   - Aggiunto checkbox UI in `index.html` con label "Automatically index documents when saving (requires Ollama)"
   - Aggiunto `pref-semantic-search-enabled` in `savePreferencesFromModal()` e `openPreferencesModal()`
   - **BUG RISOLTO**: mancava `pref-semantic-search-enabled` nella querySelectorList che attiva il salvataggio su change/input
   - **BUG RISOLTO**: import circolare (`project-panel.ts` importava da `main.ts` che importa `project-panel.ts`). Sostituito con lettura diretta da localStorage
   - **BUG NOTO**: il toggle NON funziona ancora. I documenti vengono indicizzati comunque. Possibili cause: Vite HMR non ricarica il modulo, oppure il valore letto da localStorage non e' corretto. **DA DEBUGGARE**

2. **CSS Dark Mode fix per Preferences**
   - Aggiunto `[data-theme="dark"]` rules per select, option, input[type=number], textarea
   - Aggiunto `appearance: none` con SVG arrow per dropdown in dark mode
   - **BUG NOTO**: dropdown chiuso ancora con sfondo chiaro. Il fix CSS potrebbe non funzionare per WebKit/GTK rendering dei select nativi. **DA VERIFICARE**

3. **Scrollbar in Preferences modal**
   - Aggiunto `overflow-y: auto; max-height: 70vh;` a `.modal-body`
   - **DA VERIFICARE** se funziona

4. **Labels Preferences** — migliorate:
   - "Enable automatic indexing" → "Automatically index documents when saving (requires Ollama)"
   - "Clear selection on document click" → "Automatically clear text selection when clicking in the editor"

---

## DA FARE — Prossima Sessione (in ordine di priorita')

### 1. [BUG] Semantic Search Toggle non funziona
- I documenti vengono indicizzati anche quando il toggle e' disattivato
- La funzione `indexDocumentForSearch` legge da localStorage ma non rispetta il valore
- **Debug step**: aggiungere `console.log` prima del check per vedere cosa legge da localStorage
- Verificare che la chiave sia corretta (`aurawrite-preferences`)
- Verificare che il valore `semanticSearchEnabled` venga salvato come `false` (non stringa)

### 2. [BUG] Dropdown select sfondo chiaro in dark mode
- I select "Toolbar Display" e "Theme" hanno sfondo bianco in dark mode
- Prova: usare `color-scheme: dark` sul root, oppure `<select>` custom con div/span
- Oppure: forzare `background-color` con `!important`

### 3. [FEATURE] Cancellazione embeddings quando si modifica/cancella contenuto

**Quando salvo un documento aggiornato:**
- `embedding_save_document` in Rust DEVE fare DELETE di tutti i vecchi chunk del documento PRIMA di inserire i nuovi
- Se non lo fa gia', aggiungere la logica: `DELETE FROM embeddings WHERE project_id = ? AND entity_id = ?`
- Poi INSERT dei nuovi chunk
- Risultato: il DB riflette esattamente il documento corrente, niente di vecchio/orfano

**Quando elimino un'entita':**
- Eliminare progetto → DELETE tutti gli embedding del progetto (`delete_embeddings_for_project` esiste gia' in embeddings.rs ma non e' usato)
- Eliminare sezione → DELETE tutti gli embedding dei documenti in quella sezione
- Eliminare documento → DELETE tutti i suoi embedding ( verificare che `handleDeleteDocument` chiami delete )

4. [FEATURE] Scrollbar Preferences — verificare se funziona, altrimenti sistemare

5. [FEATURE] A4 Pagination — bloccante per layout stampa (vedi sezione dedicata sotto)

---

## Completato (sessioni precedenti)

### Phase A — SQLite CRUD (2026-04-11/14)
- ✅ Backend Rust CRUD completo
- ✅ Frontend TypeScript client completo
- ✅ Schema database completo
- ✅ ProjectPanel UI (Project → Section → Document)
- ✅ Dirty tracking, notifications, save dialogs
- ✅ Per-document save, project save, auto-save

### Phase B — AI + Semantic Search (2026-04-16)
- ✅ nomic-embed-text-v2-moe via Ollama
- ✅ SQLite + cosine similarity (non sqlite-vec virtual table)
- ✅ Automatic embedding indexing on save (3 punti: single doc, project, auto-save)
- ✅ Tool Calling framework (7 tools)
- ✅ Project type dropdown (custom dialog)
- ✅ Delete confirmation dialogs (custom)
- ✅ Text extraction from ProseMirror JSON

### Decisioni confermate (2026-04-16)
- NO soft-delete o versioning per embeddings (troppo complesso)
- SI': manual saves overwrite automatic saves
- SI': Save aggiorna embeddings (deve fare delete + re-insert)
- SI': Delete documento/progetto/sezione deve eliminare embeddings correlati

---

## Priority 1: Bugs

- [x] "Could not save document" — version_number overflow i32 ✅
- [x] Click tra documenti senza check modifiche ✅
- [x] Auto-salvataggio non chiamato ✅
- [x] UI freeze dopo 12s ✅
- [x] Document switch bug ✅
- [x] Empty document switch ✅
- [x] AI panels non si aprono ✅
- [ ] Discard lento (dipende dal modello AI)
- [ ] Semantic Search Toggle non funziona (vedi sopra)
- [ ] Dropdown select sfondo chiaro in dark mode (vedi sopra)

---

## Priority 2: Features

- [ ] Tool Calling integration nel pannello AI chat
- [ ] Hugging Face GGUF local models (rimuovere dipendenza Ollama)
- [ ] Enhanced title bar (font/style)
- [ ] Cronologia modifiche persistenti
- [ ] Writing stats, token counter, sentence counter
- [ ] Export PDF/ePub migliorato

---

## Priority 3: Paginazione A4 (Future)

**Stato:** Formato continuo con page break manuali.

| Soluzione testata | Esito | Problema |
|---|---|---|
| prosemirror-pagination | ❌ | Schema rigido |
| Lexical (Meta) | ❌ | Non funzionante |
| TipTap | ❌ | Esiti pessimi |

**Piano:**
1. Ora: formato continuo con page break manuali
2. Futuro: decorations per overflow + Paged.js per export

---

## Note Tecniche

- Sistema Slot-based: `SentenceSlot` con `docFrom`/`docTo`, MAI `textContent.indexOf()`
- Modelli con reasoning lenti (30-60s): considerare modelli senza reasoning
- Embedding: `embedding_save_document` in `embeddings.rs` — verificare se fa DELETE prima di INSERT
- Funzioni Rust non usate: `delete_embeddings_for_project`, `search_similar_entities`, `get_embeddings_for_entity` — da collegare o rimuovere
- Circular import risolto: `project-panel.ts` non importa piu' da `main.ts`, legge localStorage direttamente

*Aggiornato 2026-04-17*