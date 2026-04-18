# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-18

---

## Sessione 2026-04-18 — Cosa e' stato fatto

1. **Embedding cleanup su delete** — IMPLEMENTATO
   - `db_delete_project` → chiama `embeddings::delete_embeddings_for_project`
   - `db_delete_section` → legge documenti della sezione e cancella le loro embeddings
   - `db_delete_document` → chiama `embeddings::delete_embeddings_for_entity`
   - Aggiunto comando Tauri `embedding_delete_for_project`

2. **`embedding_save_document` DELETE before INSERT** — gia' risolto nella sessione precedente

---

## Completato (sessioni precedenti)

### Sessione 2026-04-17
- Semantic Search Toggle — checkbox UI + lettura da localStorage + bug ID duplicato risolto
- CSS Dark Mode per Preferences — select, option, input, textarea
- Scrollbar Preferences — overflow-y auto + max-height 70vh
- LabelsPreferences migliorate + preference-hint
- Modal trascinabile e piu' largo (520px)

### Phase B — AI + Semantic Search (2026-04-16)
- nomic-embed-text-v2-moe via Ollama
- SQLite + cosine similarity
- Automatic embedding indexing on save
- Tool Calling framework (7 tools) — DEFINITO, NON COLLEGATO
- Project type dropdown (custom dialog)
- Delete confirmation dialogs
- Text extraction from ProseMirror JSON

### Phase A — SQLite CRUD (2026-04-11/14)
- Backend Rust CRUD completo
- Frontend TypeScript client completo
- Schema database completo
- ProjectPanel UI
- Dirty tracking, notifications, save dialogs
- Per-document save, project save, auto-save

### Decisioni confermate
- NO soft-delete o versioning per embeddings
- SI': manual saves overwrite automatic saves
- SI': Save aggiorna embeddings (delete + re-insert)
- SI': Delete documento/progetto/sezione elimina embeddings correlati
- SI': Tool calling prompt-based con XML `<tool>` (non API nativa)
- SI': AURA_EDIT resta separato dai tools (non diventa un tool)
- NO: tool calling nativo per ora (stesso costo in tokens, piu' complesso da mantenere)

---

## IN CORSO — Tool Calling Integration nel Chat Panel

### Obiettivo
Permettere all'AI Assistant di interrogare il database per rispondere a domande sul progetto (es. "scrivimi la scheda di tutti i personaggi").

### Cosa ESISTE (già implementato, da collegare)
- `tools.ts` — 7 tools con definizione, esecuzione via Tauri invoke, parser XML, system prompt builder, pipeline `processAIResponseWithTools`
- `chat.ts` — pannello chat funzionante ma senza tools
- 3 provider (Ollama, OpenAI, Anthropic) — senza supporto multi-turno né tools nel prompt
- AURA_EDIT — funzionante, non si tocca

### Cosa MANCA (gap da implementare)

#### Step 1 — AIContext con projectId (`providers.ts`)
- Aggiungere `projectId?: string` ad `AIContext`
- Passare projectId nella catena chat → ai-manager → provider

#### Step 2 — projectId nel flusso chat (`chat.ts`)
- Importare `currentProject` da `project-panel.ts`
- Passare `projectId` nel contesto quando si chiama `sendToAI()`

#### Step 3 — System prompt con tools (`ai-manager.ts`)
- Quando c'e' `projectId`, chiamare `buildToolSystemPrompt()` da `tools.ts`
- Iniettare le istruzioni dei tools nel system prompt del provider
- Tools appaiono solo quando un progetto e' aperto

#### Step 4 — Provider accetta system prompt esteso
- `ollama-provider.ts`: metodo `stream()` accetta system prompt con tools nel prompt
- `remote-providers.ts`: OpenAI e Anthropic accettano system prompt con tools nel prompt
- NON si riscrive l'architettura dei provider — si aggiunge solo il testo dei tools al system prompt esistente

#### Step 5 — Loop tool calling in sendMessage (`chat.ts`)
- Dopo che l'AI risponde, controllare se contiene `<tool>` tags
- Se si: parsare con `parseToolCalls()`, eseguire con `executeTool()` per ogni call
- Mostrare indicatore discreto "Searching database..." con pallini animati
- Rimandare i risultati come contesto aggiuntivo all'AI
- Ripetere max 3 volte
- Quando l'AI risponde senza `<tool>`, mostrare la risposta + processare AURA_EDIT

#### Step 6 — Indicatore visivo (`styles.css`)
- Riga discreta nel flusso della chat: "🔍 Searching database..." con animazione pallini
- Non un banner, non invasivo

#### Step 7 — Message type aggiornato (`chat.ts`)
- Aggiungere ruoli `"system"` e `"tool_result"` al tipo `Message`
- Costruire message history per contesto multi-turno

### Considerazioni per il futuro
- Il system prompt dei tools occupa ~500-800 tokens ad ogni richiesta
- Possibile ottimizzazione: includere i tools solo quando l'AI ha bisogno di dati dal DB
- Futuro: il system prompt potrebbe includere anche il "ruolo" dell'agente (scrittore, revisore, avvocato, correttore di bozze)
- Futuro: aggiungere tool calling nativo per OpenAI/Anthropic come ottimizzazione

---

## Priority 1: Bugs aperti

- [ ] Discard lento (dipende dal modello AI)
- [ ] Dropdown select in dark mode (GTK) — minor, workaround CSS parziale

---

## Priority 2: Features

- [x] Tool Calling integration nel pannello AI chat — IN CORSO
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
- Embedding: `embedding_save_document` fa DELETE prima di INSERT
- `embedding_delete_for_project` comando Tauri esposto al frontend
- `search_similar_entities` e `get_embeddings_for_entity` ancora non usate (futuro: AI tool calling)
- Circular import risolto: `project-panel.ts` legge localStorage direttamente
- Delete progetto/sezione/documento cancella embeddings correlate
- Tool calling: approccio prompt-based con XML `<tool>`, NON API nativa
- AURA_EDIT resta separato dai tools (lettura DB = tools, scrittura documento = AURA_EDIT)

*Aggiornato 2026-04-18*