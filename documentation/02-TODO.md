# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-14

---

## 🎯 Completato Oggi (SQLite Phase A)

| Componente | Stato |
|------------|-------|
| Backend Rust CRUD | ✅ Completo |
| Frontend TypeScript client | ✅ Completo |
| Schema database | ✅ Completo |

**Prossima sessione:** Phase A.2 — UI Integration (ProjectPanel, New Project, Document switch)

---

## Future Architecture Decisions — DECISIONE CONFERMATA

**DECISIONE CONFERMATA (2026-04-14): sqlite-vec per VectorDB**
- Approccio scelto: sqlite-vec integrato nel database SQLite esistente
- Un solo file `.db` per dati strutturati E embedding vettoriali
- Riferimento: https://whoisryosuke.com/blog/2025/offline-vector-database-with-tauri
- Ollama è installato e attivo sul sistema
- Modello embedding: `nomic-embed-text`
- Documentazione tecnica: `REFERENZA-Tauri-SQLite-VectorDB.md`

**Alternativa scartata:** Approccio Karpathy (Markdown + link ipertestuali)
- Fonte: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Motivo: sqlite-vec offre ricerca semantica nativa, più potente del linking manuale

---

## Priority 1: Bugs

- [x] **"Could not save document"** — `version_number` overflowava `i32` (fixato 2026-04-11) ✅
- [x] **Click tra documenti senza check modifiche** — ora usa `handleCloseDocument()` ✅
- [x] **Auto-salvataggio non chiamato** — ora connesso tramite evento `aurawrite:content-changed` ✅
- [x] **UI freeze dopo 12s** — flag globale `__aurawrite_loading` coordinato tra moduli ✅
- [ ] **Auto-salvataggio da testare** — verificare che l'evento venga emesso/ricevuto
- [x] **Document switch bug** — selectDocument ora legge contenuto fresco dal DB (2026-04-14) ✅
- [x] **Empty document switch** — documenti vuoti ora svuotano l'editor (2026-04-14) ✅
- [x] **AI panels non si aprono** — setupAIPanel/setupSuggestionsPanel rimossi accidentalmente (2026-04-14) ✅
- [ ] Discard lento: dipende dal modello AI (reasoning). Considerare modelli senza reasoning per Suggestions.

---

## Saving System Architecture (2026-04-14)

**Discussion with Carlo:**
The current saving system conflates multiple concepts that need to be separated:

### Current Issues
- Auto-save vs manual save confusion
- Document save vs Project save confusion  
- No per-document save button
- User cannot promote draft to version

### Concepts to Separate

| Concept | Storage | Trigger | Description |
|---------|---------|---------|-------------|
| **Draft** | `documents.content_json` | Auto-save (debounce) | Working copy, overwritten on each auto-save |
| **Version** | `versions` table | Manual save (Ctrl+S or Save button) | Named snapshot, kept for history |
| **File Export** | File system (.json/.md/.txt) | File → Save As | External backup |

### Key Decisions
1. **Per-document Save button** — each document in ProjectPanel has its own Save button
2. **No auto-select on create** — new documents are NOT automatically opened
3. **Save creates Version** — manual save always creates a versioned snapshot
4. **Auto-save updates Draft only** — does NOT create versions

### Future Features (Phase B)
- **Save with name** — for named project backups
- **Duplicate** project/section/document
- **Rename inline** — click to edit names
- **Drag & drop** — reorder sections and documents
- **Copy sections between projects**

---

### Rust Warning Cleanup (2026-04-14)
- [x] Remove `package.private` from `src-tauri/Cargo.toml` ✅
- [x] Remove `debug_list_projects` and `debug_list_sections` from `src-tauri/src/database.rs` ✅

---

## AI + Database Architecture (2026-04-14)

**CONFIRMED DECISIONS:**

### Database Choice: sqlite-vec
- Single SQLite database for structured data AND vector embeddings
- No separate vector database needed
- Requires Ollama with `nomic-embed-text` for embedding generation
- Fallback: FTS5 for full-text search when Ollama unavailable

### AI Panel — What Exists (MUST PRESERVE)
- **Chat Panel** (`chat.ts`): context display, chunk selector, AURA_EDIT edits
- **Suggestions Panel** (`suggestions-panel.ts`): sentence suggestions, Accept/Reject/Switch
- **AI Manager** (`ai-manager.ts`): multi-provider (Ollama, OpenAI, Anthropic)
- **Edit Executor** (`edit-executor.ts`): AURA_EDIT format parsing → ProseMirror operations
- **Chunking** (`chunks.ts`): sentence-based document splitting with configurable size
- **Modification Hub** (`modification-hub.ts`): event bus for document changes

### AI Panel — What's Missing (TO IMPLEMENT)

#### Phase B.1: Tool Calling (Database Queries from AI)
The AI Assistant must be able to query the project database:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `search_entities` | `type, query` | Search characters/places by name |
| `find_scenes` | `entity_id` | Find scenes containing an entity |
| `get_chapter_summary` | `chapter_id` | Get summary of a chapter |
| `list_entities` | `type` | List all entities of a type |
| `count_occurrences` | `entity, range?` | Count entity mentions in text |

#### Phase B.2: sqlite-vec Integration (Semantic Search)

**Schema:**
```sql
-- Virtual table for vector embeddings
CREATE VIRTUAL TABLE embeddings USING vec0(embedding float[768]);

-- Metadata table linking embeddings to content
CREATE TABLE embeddings_metadata (
  id TEXT PRIMARY KEY,
  embedding_rowid INTEGER,  -- links to vec0 virtual table
  entity_id TEXT,             -- links to entities table
  document_id TEXT,           -- links to documents table
  chunk_index INTEGER,        -- which chunk of the document
  chunk_text TEXT,            -- the actual text chunk
  project_id TEXT,
  created_at INTEGER
);
```

**Embedding Pipeline:**
1. Document text → `chunks.ts` splits into chunks
2. Each chunk → Ollama `nomic-embed-text` → 768-dim vector
3. Store vector in `embeddings` + metadata in `embeddings_metadata`
4. Query: user question → embedding → cosine similarity → top-k results

**Check before indexing:**
- Verify Ollama is running (`ollama list`)
- Verify `nomic-embed-text` model is available
- Fallback to FTS5 if Ollama unavailable

#### Phase B.3: Entity Types per Project Category

| Category | Entity Types |
|----------|-------------|
| Novel | Character, Location, Object, Event |
| Script | Character, Location, Object, Scene |
| Article | Source, Topic, Note |
| Legal | Client, Article, Communication, Evidence |
| Research | Source, Topic, Note, Deepening |
| Software | Module, API, Component, Dependency |
| Custom | User-defined |

Each entity type has custom fields stored as JSON in `entity_types.fields_json`.

### Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                 FRONTEND (TypeScript)             │
│                                                   │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Chat     │  │ Suggestions  │  │ Project    │  │
│  │ Panel    │  │ Panel        │  │ Panel      │  │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  │
│       │               │                │           │
│  ┌────┴───────────────┴────────────────┴─────┐   │
│  │              AI Manager                    │   │
│  │    (provider selection, tool calling)       │   │
│  └────┬───────────────┬───────────────────────┘   │
│       │               │                           │
│  ┌────┴────┐    ┌─────┴──────┐                   │
│  │ Ollama  │    │ Tool       │                   │
│  │ Provider│    │ Calling    │                   │
│  └────┬────┘    └─────┬──────┘                   │
│       │               │                           │
└───────┼───────────────┼───────────────────────────┘
        │               │
        │         ┌─────┴──────┐
        │         │ db.ts      │
        │         │ (queries)  │
        │         └─────┬──────┘
        │               │
┌───────┼───────────────┼───────────────────────────┐
│       │     BACKEND (Rust / Tauri)                 │
│  ┌────┴────┐    ┌─────┴──────────────┐             │
│  │ Embed   │    │ SQLite             │             │
│  │ Ollama  │    │ ├ projects         │             │
│  │ API     │    │ ├ sections          │             │
│  │ :11434  │    │ ├ documents         │             │
│  └─────────┘    │ ├ entities          │             │
│                  │ ├ entity_types      │             │
│  ┌─────────┐     │ ├ versions          │             │
│  │ sqlite  │     │ ├ search_index      │             │
│  │ -vec    │     │ └ embeddings_meta  │             │
│  │ (vec0)  │     │                     │             │
│  └─────────┘     └─────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

---

## Priority 2: Features (aggiornato post-SQLite Phase A)
- [ ] AI Assistant (pannello dx) può interrogare il database
- [ ] Tool calling per: search_characters, find_scenes, get_chapter_summary
- [ ] Inserimento dati di test: capitoli, sezioni, personaggi, luoghi
- [ ] Debug tool per Aura: visualizzare/modificare database durante test

### UI: Drag and Drop [TODO NUOVO]
- [ ] Trascinare documenti/sezioni per riordinarli
- [ ] Spostare documenti tra sezioni
- [ ] Aggiornare `order_index` nel database dopo drag

### Project Categorization (2026-04-14)

**Current state:** `window.prompt()` asks "Project type (novel/script/article)" — arbitrary, not visible after creation, not editable.

**Decision (Carlo):** Replace with dropdown menu including "Custom" option.
- Dropdown with preset categories: Novel, Script, Article, Notes, Legal, Software
- "Custom" option allows user to define their own category name
- Category must be visible and editable after project creation (inline edit or project settings)
- UI labels and titles in English

---

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