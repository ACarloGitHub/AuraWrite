# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-08

---

## 🎯 Completato Oggi (SQLite Phase A)

| Componente | Stato |
|------------|-------|
| Backend Rust CRUD | ✅ Completo |
| Frontend TypeScript client | ✅ Completo |
| Schema database | ✅ Completo |

**Prossima sessione:** Phase A.2 — UI Integration (ProjectPanel, New Project, Document switch)

---

## Future Architecture Decisions (Post Phase A Testing)

**Alternativa valutata:** sqlite-vec per VectorDB integrato in SQLite
**Fonte:** https://whoisryosuke.com/blog/2025/offline-vector-database-with-tauri
**Stato:** Da decidere dopo test completo del database SQL strutturato

**Alternativa valutata:** Approccio Karpathy (Markdown + link ipertestuali)
**Fonte:** https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
**Stato:** Da decidere dopo test completo del database SQL strutturato

**Nota:** Entrambe le alternative sono state documentate in `03-SQLITE-STATUS.md`.

---

## Priority 1: Bugs

- [ ] Discard lento: dipende dal modello AI (reasoning). Considerare modelli senza reasoning per Suggestions.

---

## Priority 2: Features (aggiornato post-SQLite Phase A)

### Database SQLite — Phase A.2 UI Integration [IN CORSO]

**Problemi da risolvere (feedback Carlo 2026-04-09):**
- [ ] Ogni elemento (progetto/sezione/doc) deve essere in un box visivo con bordo
- [ ] Pulsante "×" per eliminare in alto a destra del box (non in fondo)
- [ ] Inconsistenza nomi: mostrare SOLO il nome, non "Sezione: nome"
- [ ] Allargare ProjectPanel da 200px a 280-300px
- [ ] Documento separato da sezione — da rivalutare (forse ridondante)
- [ ] Aggiungere modo per consultare il database (visualizzare cosa c'è salvato)

**Completato:**
- [x] Creare `ProjectPanel` component (sidebar progetti/sezioni/documenti) ✅
- [x] Integrare `db.ts` in `main.ts` ✅
- [x] Pulsante "📁 Projects" nella status bar ✅
- [x] Pulsanti "+ Sezione" e "+ Documento" ✅
- [x] Pulsanti "×" per eliminare progetti/sezioni ✅
- [x] Fix: Tauri parametri camelCase vs snake_case ✅
- [x] Fix: null invece di undefined per campi opzionali ✅

**Da fare:**
- [ ] Migliorare UI: box visivi per ogni elemento
- [ ] Migliorare UI: X in alto a destra
- [ ] Migliorare UI: mostrare solo nomi, non label generiche
- [ ] Allargare ProjectPanel
- [ ] Implementare salvataggio documento nel database
- [ ] Test: creare, modificare, salvare documento

### Suggestions Panel
- [ ] **Undo per suggerimenti**: conservare testo originale per ripristino dopo Accept/Switch
- [x] **Database integration**: ✅ SQLite implementato — pronto per salvare frasi accettate/rifiutate
- [ ] **Warn utente se contesto vicino al limite**: avvertire quando ci si avvicina al limite token

### AI Assistant Panel
- [ ] **Insert AI responses directly**: inserire risposte AI direttamente nel documento
- [ ] **Tooltip plugin**: context menu su selezione testo
- [ ] **Document as AI Role Prompt**: salvare documento come prompt di sistema per definire ruolo AI (es. "esperto legale", "scrittore fantasy")
- [ ] **Language Selector in Preferences**: selettore lingua per risposte AI (nel prompt: "rispondi ed elabora in lingua [selezione]")
- [x] **Dynamic text selection**: ✅ evidenziare selezione quando si clicca nell'input
- [x] **Clear selection button**: ✅ pulsante ✕ per deselezionare manualmente
- [x] **Deselect preference**: ✅ opzione per deselezionare con click nel documento
- [ ] **Modification history**: mark persistenti su testo modificato, database SQLite (post-Phase A)
- [ ] **Tool Calling**: implementare tools di sola lettura per query database (search_characters, find_scenes, ecc.)
- [ ] **Agent Mode UI**: toggle Avanzata/Base nelle preferenze

### Cronologia Modifiche (Future)

**Concept:** Parole modificate dalla AI evidenziate con tratteggio/rettangolo. Click → dropdown con cronologia versioni.

**Architettura proposta:**

| Componente | Tecnologia |
|------------|------------|
| Mark nel documento | ProseMirror decorations con ID univoco |
| Database cronologia | SQLite (Tauri) — tabella `edits_history` |
| UI dropdown | CSS absolute positioning + JS |

**Tabella `edits_history`:**

```sql
CREATE TABLE edits_history (
  id TEXT PRIMARY KEY,
  position_from INTEGER,
  position_to INTEGER,
  original_text TEXT,
  modified_text TEXT,
  source TEXT,  -- 'ai_assistant' | 'suggestions'
  timestamp INTEGER
);
```

**Dipendenza:** Database SQLite (vedi Priority 3)

---

## Test Plan: Database + VectorDB

### Fase 1: SQLite Base

**Obiettivo:** Validare che SQLite funzioni per struttura documenti.

**Step:**
1. Creare database SQLite vuoto (`~/.config/aurawrite/aurawrite.db`)
2. Inserire documento lungo (50k+ parole)
3. Testare FTS5 per full-text search
4. Testare chunking su documento lungo
5. Misurare performance (query time, memory)

**File necessario:** Documento lungo reale o generato.

### Fase 2: VectorDB (con Ollama)

**Obiettivo:** Validare embedding e semantic search.

**Prerequisiti:**
- Ollama installato e attivo
- Modello embedding scaricato (`nomic-embed-text` o simile)

**Step:**
1. Implementare generazione embeddings
2. Testare indicizzazione documento lungo
3. Testare query semantiche ("trova scene simili")
4. Confrontare risultati FTS5 vs VectorDB
5. Misurare performance (index time, query time, disk space)

### Fase 3: Import Documenti

**Obiettivo:** Testare import di documenti esterni.

**Step:**
1. Import DOCX lungo (romanzo completo)
2. Verificare che chunking funzioni
3. Verificare che indicizzazione funzioni
4. Testare UI: "Importa documento" + stato indicizzazione

### Metriche di Successo

| Metrica | Target |
|---------|--------|
| Query FTS5 (< 10k parole) | < 100ms |
| Query VectorDB (< 10k parole) | < 500ms |
| Indicizzazione VectorDB (1k parole) | < 5s |
| Dimensione DB (50k parole) | < 50MB |

---

### General
- [ ] **New documento**: tasto per creare documento vuoto
- [ ] **Writing stats**: statistiche di scrittura
- [ ] **Token counter**: mostrare token stimati nella status bar (insieme a Words/Characters)
- [ ] **Sentence counter**: mostrare numero frasi nella status bar
- [ ] **Chunk settings UI**: preferenze per configurare tokensPerChunk (default conservativo)
- [ ] **Export enhancements**: migliorare export PDF/ePub

---

## Priority 3: Architettura

### Database (SQLite + Vector DB)
- [ ] Design schema per documenti, versioni, metadati
- [ ] Integrazione per ricerca semantica (vector DB)
- [ ] Relazioni fra documenti (personaggi, luoghi, capitoli)
- [ ] **Dipendenze**: Documentare che VectorDB richiede Ollama con modello embedding
- [ ] **Fallback**: Implementare FTS5 quando Ollama non disponibile
- [ ] **Check Ollama**: Verificare se Ollama è attivo prima di indicizzare

### Modification Hub
- [x] Creato bus eventi centralizzato
- [x] Suggestions integrato
- [ ] Test concorrenza con AI Assistant attivo

---

## Future: Pagination

### Stato attuale (2026-04-08)

**Decisione:** Formato continuo con page break manuali.

| Soluzione testata | Esito | Problema |
|-------------------|-------|----------|
| prosemirror-pagination | ❌ Non utilizzabile | Schema rigido, non permette toggle continuo/paginato |
| Lexical (Meta) | ❌ Fallito | Paginazione minima non funzionante |
| TipTap | ❌ Fallito | Esiti pessimi |

### Piano
1. **Ora**: Formato continuo con page break manuali (già implementati)
2. **Sviluppo**: Continuare funzionalità (AI panels, database, export)
3. **Futuro**: Page break automatici — prima in test, poi in sviluppo

### Cosa serve per page break automatici
- Decorations che calcolano overflow testo
- Inserimento automatico `pageBreakBefore` attribute
- Test con AI panels attivi

---

## Note Tecniche

### Sistema Slot-based
Usa `SentenceSlot` con `docFrom`/`docTo` per posizioni ProseMirror. Mai usare `textContent.indexOf()`.

### Modelli AI con reasoning
Possono essere lenti (30-60s). Considerare modelli senza reasoning per risposte veloci.

### Paginazione — Lezione appresa
I plugin paginazione modificano lo schema in modo irreversibile. Soluzione corretta: tenere schema semplice, calcolare break con decorations, export con Paged.js.

---

*Aggiornato da Aura — 2026-04-08*