# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-18

---

## Sessione 2026-04-18 — Cosa e' stato fatto

1. **Embedding cleanup su delete** — `db_delete_project/section/document` ora cancellano embeddings correlate
2. **Tool Calling integration** — chat.ts loop con parse `<tool>`, executeTool, indicatore visivo, max 3 iterazioni
3. **Bug fix "Already processing"** — lock management spostato da sendToAI a chat.ts
4. **Inline rename** — doppioclick per rinominare progetti, sezioni, documenti + update DB
5. **Entity Extraction System** — `entity-extraction.ts` con AI extraction, dedup, upsert, pulsanti 🗂
6. **Section expand/collapse** — pulsante ▶/▼, default tutte espanse
7. **Modello default** — cambiato da `gemma4:31b-cloud` a `kimi-k2.5:cloud`
8. **Fix notifiche** — indexing toast persistente, selector CSS rotto
9. **Fix created_at** — mancava in db_update_entity

---

## Completato (tutte le sessioni)

- Phase A: SQLite CRUD completo, ProjectPanel UI, dirty tracking, save/load
- Phase B: Semantic search (nomic-embed-text + cosine similarity), embedding indexing on save
- Tool Calling: 7 tools definiti, integrati nel chat panel con loop prompt-based XML
- AURA_EDIT: replace/insert/delete/format, funzionante, NON si tocca
- Sessione 2026-04-17: Semantic Search Toggle, dark mode CSS, scrollbar, draggable modal

---

## Decisioni di Architettura (CONFIRMED)

1. **Tool calling = prompt-based con XML `<tool>`** — nessuna API nativa, funziona con tutti i provider
2. **AURA_EDIT resta separato dai tools** — tools per LEGGERE dal DB, AURA_EDIT per SCRIVERE nel documento
3. **Nomic = modello di embedding (vettori)** — NON estrae entità, NON ragiona, crea solo vettori per ricerca semantica
4. **L'AI (GLM/Gemma/GPT/Claude) = modello linguistico** — legge testo, comprende, estrae entità, ragiona
5. **Due pipeline parallele e indipendenti:**
   - Pipeline ricerca: Documento → Nomic crea vettori → embeddings → ricerca semantica
   - Pipeline struttura: Documento → AI legge a chunk → estrae/aggiorna entities → DB
6. **Delete cascade**: progetto/section/documento cancellano embeddings correlate
7. **Delete before insert**: `embedding_save_document` cancella vecchi chunk prima di inserire nuovi

---

## PROSSIMO: Entity Extraction System ("Index Entities")

### Il Problema

Attualmente il database ha una tabella `entities` VUOTA. I personaggi, luoghi e oggetti esistono solo come testo dentro i documenti. L'AI Assistant, quando interrogata, non trova nulla nella tabella `entities` perché nessuno l'ha popolata.

### La Soluzione

Un sistema di **"Index Entities"** che usa l'AI per leggere i documenti, estrarre le entità, e scriverle nel database. Attivato manualmente dall'utente tramite pulsanti dedicati (non automatico).

### Come Funziona — Flusso Dettagliato

```
1. L'utente preme "Index Entities" (su documento, sezione o progetto)
2. Per ogni documento nel target selezionato:
   a. Il testo del documento viene spezzato in chunk (dimensione configurabile nelle preferenze)
   b. PRIMA di estrarre, l'AI legge la lista delle entities gia' esistenti nel progetto
      - Solo: nome, tipo, descrizione breve (pochi token per non consumare contesto)
      - Questo le permette di aggiornare invece che duplicare
   c. Per ogni chunk, l'AI riceve un prompt di estrazione che include:
      - Il testo del chunk
      - La lista delle entities esistenti (nome + tipo + descrizione breve)
      - Il project type come contesto ("questo e' un romanzo, cerca personaggi, luoghi, eventi")
      - Istruzioni per estrarre nuove entities o aggiornare esistenti
   d. L'AI risponde con le entities estratte in formato JSON
   e. Il codice TypeScript prende la risposta, e per ogni entity:
      - Se il nome corrisponde a un'entity esistente → AGGIORNA la descrizione
      - Se e' nuova → CREA l'entity nel DB
   f. Passa al chunk successivo
3. Al termine di tutti i chunk, il contesto dell'AI viene liberato
4. L'utente vede un feedback: "Indexed: 5 entities extracted, 3 updated"
```

### Entity Types: Come Vengono Creati

**Approccio: l'AI crea entity types dal contesto.**
Il project type fornisce un SUGGERIMENTO nel prompt di estrazione:

| Project Type | Suggerimento nel prompt |
|---|---|
| Novel | "Extract: Characters, Locations, Objects, Events" |
| Script | "Extract: Characters, Locations, Scenes, Props" |
| Article | "Extract: Sources, Topics, Key Concepts" |
| Notes | "Extract: Topics, References" |
| Legal | "Extract: Clients, Articles, Communications, Evidence" |
| Research | "Extract: Sources, Topics, Hypotheses, Experiments" |
| Custom | Prompt di estrazione EDITABILE dall'utente nelle preferenze |

L'AI NON e' vincolata a questi tipi — se trova qualcosa che non rientra, crea un entity type nuovo. Ma il suggerimento la guida verso nomi consistenti.

### Entity Types per Project Type Custom

Problema: nel Custom type, non c'e' un suggerimento predefinito.
Soluzione: nelle Preferenze, aggiungere un campo **"Custom Extraction Prompt"** (textarea) dove l'utente scrive cosa l'AI deve estrarre. Esempio: "Extract: Patients, Diagnoses, Treatments, Medications" per un progetto medico.

**Questo campo appare solo quando il project type e' "Custom".**

### Deduplicazione — Come Funziona

**L'AI legge le entities esistenti PRIMA di estrarre.**

```
Chunk 1: "Mr. Pickwick entered the room..."
AI vede: [nessuna entity esistente]
AI estrae: {name: "Mr. Pickwick", type: "character", description: "The protagonist..."}
→ CREA nel DB

Chunk 5: "Pickwick smiled at his friend..."
AI vede: [{name: "Mr. Pickwick", type: "character", desc: "The protagonist..."}]
AI riconosce "Pickwick" = "Mr. Pickwick"
AI aggiorna: {name: "Mr. Pickwick", type: "character", description: "The protagonist, a cheerful gentleman..."}
→ AGGIORNA nel DB
```

La lista delle entities esistenti include solo nome + tipo + descrizione breve (max 200 char). Pochi token, per consumare meno contesto possibile.

La descrizione breve viene troncata per il contesto dell'AI, ma la descrizione piena è salvata nel DB.

### Pulsanti "Index Entities" — Dove e Come

| Target | Pulsante | Cosa fa |
|---|---|---|
| **Documento** | Accanto a "Save" nella toolbar o nel ProjectPanel | Estrae entities solo dal documento corrente |
| **Sezione** | Nel ProjectPanel, accanto al nome della sezione | Estrae entities da tutti i documenti della sezione |
| **Progetto** | Nel ProjectPanel, in alto (es. toolbar del progetto) | Estrae entities da tutti i documenti del progetto |

Ogni pulsante mostra un feedback progressivo: "Indexing document 1/5...", "Indexing document 2/5...", ecc.

### Preferenze — Nuovi Campi

| Campo | Tipo | Default | Descrizione |
|---|---|---|---|
| **Indexing Chunk Tokens** | number | 2000 | Dimensione dei chunk per l'estrazione entities (piu' piccolo = piu' preciso, ma piu' chiamate AI) |
| **Custom Extraction Prompt** | textarea | "" | Prompt di estrazione per project type Custom. Appare solo se il progetto corrente e' Custom |

### Implementazione — Step in Ordine

#### Step 1: Prompt di estrazione entities
- Creare `src/ai-panel/entity-extraction.ts`
- Funzione `buildExtractionPrompt(chunk, existingEntities, projectType)` che genera il prompt per l'AI
- Mappa project type → suggerimento di estrazione
- L'AI risponde in formato JSON: `[{name, type, description}]`

#### Step 2: Logica di estrazione
- In `entity-extraction.ts`: funzione `extractEntitiesFromDocument(documentId, projectId, projectType)`
  - Legge il documento dal DB
  - Spezza in chunk (usa settings.tokensPerChunk o un valore dedicato)
  - Per ogni chunk: chiama AI con extraction prompt
  - Parse della risposta JSON dell'AI
  - Deduplica: se nome esiste → UPDATE, altrimenti → CREATE
- Funzioni `extractEntitiesFromSection(sectionId, projectId, projectType)` e `extractEntitiesFromProject(projectId, projectType)` che iterano sui documenti

#### Step 3: API Tauri per entities
- Verificare che `db_create_entity`, `db_update_entity`, `db_get_entities` funzionino
- Aggiungere `db_create_entity_type` se non esiste
- Potrebbe servire `db_search_entity_by_name` per la deduplicazione efficiente (invece di scaricare tutte le entities del progetto ogni volta)

#### Step 4: UI pulsanti
- Aggiungere pulsante "🗂 Index Entities" nel ProjectPanel:
  - Accanto a ogni documento (icona minuscola)
  - Accanto a ogni sezione
  - In testa al progetto
- Quando premuto: mostra progresso, disabilita il pulsante durante l'estrazione
- Al termine: toast con risultato "5 entities created, 3 updated"

#### Step 5: Preferenze
- Aggiungere "Indexing Chunk Tokens" (number input) nelle preferenze
- Aggiungere "Custom Extraction Prompt" (textarea) — visibile solo se progetto Custom

#### Step 6: Tool calling per entities
- I tools esistenti (`search_entities`, `list_entities_by_type`) funzionano gia' — non serve modificarli
- Una volta che le entities sono nel DB, l'AI Assistant potra' interrogarle

### Vulnerabilita' e Mitigazioni

| Vulnerabilita' | Descrizione | Mitigazione |
|---|---|---|
| Latenza | Ogni chunk richiede una chiamata AI (5-30s) | Indicizzazione manuale, non automatica. Progress feedback. |
| Costo/VRAM | Chiamate AI multiple consumano risorse | L'utente decide quando indicizzare. Ollama scarica modello dopo timeout. |
| Duplicati | L'AI potrebbe creare "Pickwick" e "Mr. Pickwick" come due entities | Lista entities esistenti nel contesto. Fuzzy matching sul nome come backup. |
| Inconsistenza entity types | L'AI potrebbe creare "Character" e "Personaggio" come due tipi diversi | Project type suggerisce nomi. Prompt dice "use consistent type names". |
| Qualita' estrazione | L'AI potrebbe perdere personaggi minori o estrarre falsi positivi | Estrarre e' meglio che non estrarre. L'utente puo' re-indexare. |
| Aggiornamenti | Se cancello un personaggio dal testo, l'entity resta nel DB | Comportamento corretto — entity persiste anche se non menzionata. L'utente puo' cancellarla manualmente in futuro (UI da fare). |

---

## PRIORITY 1: Bugs aperti

- [ ] Bug: "+ doc" crea documento sotto sezione sbagliata (assegna sempre section_id della prima sezione)
- [ ] Feature: titoli di sezioni e documenti devono essere editabili (doppioclick per rinominare + update DB)
- [ ] Discard lento (dipende dal modello AI)
- [ ] Dropdown select in dark mode (GTK) — minor

---

## PRIORITY 2: Features (in ordine)

1. **Entity Extraction System** — implementato e funzionante
2. **Drag & Drop** — riordinare documenti e sezioni nel ProjectPanel (future, non urgente)
3. **Provider/Model/API Key nelle Preferenze** — dropdown con provider (Ollama, OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio), model selection, API key input
4. **LM Studio support** — gia' funzionante via OpenAI provider con baseUrl http://localhost:1234/v1, aggiungere preset nelle preferenze
5. **Tool calling nativo per provider che lo supportano** — OpenAI e Anthropic hanno API tools nativa, LM Studio supporta function calling. Per ora usiamo prompt-based XML per tutti. Futuro: aggiungere supporto nativo come opzione per provider compatibili
6. **Migliorare system prompt per tool calling** — forzare AI a chiamare tools prima di rispondere "no entities found", aggiungere project_id esplicito, esempi più chiari
7. **Show AI thinking** — opzione nel pannello AI Assistant (header) per mostrare/nascondere il thinking del modello. Solo per modelli che supportano reasoning (es. kimi-k2.5)
8. **Preferences a schede** — ristrutturare il modal Preferenze con tab/schede (es. "General", "AI Settings", "Editor", "Indexing") invece di una lista unica
9. **Hugging Face GGUF local models** (rimuovere dipendenza Ollama)
8. **Enhanced title bar** (font/style)
9. **Cronologia modifiche persistenti**
10. **Writing stats, token counter, sentence counter**
11. **Export PDF/ePub migliorato**

---

## PRIORITY 3: Paginazione A4 (Future)

**Stato:** Formato continuo con page break manuali.

| Soluzione testata | Esito |
|---|---|
| prosemirror-pagination | ❌ Schema rigido |
| Lexical (Meta) | ❌ Non funzionante |
| TipTap | ❌ Esiti pessimi |

**Piano:** formato continuo ora, decorations + Paged.js in futuro.

---

## Note Tecniche

- **Nomic** = modello di EMBEDDING (vettori 768-dim per ricerca semantica). NON estrae entità.
- **AI** (GLM/Gemma/GPT/Claude) = modello LINGUISTICO. Legge, comprende, estrae entità.
- **Due pipeline parallele:** (1) ricerca semantica via Nomic, (2) struttura via AI entity extraction
- **Deduplicazione entities:** AI legge lista entities esistenti (nome+tipo+desc breve) prima di ogni estrazione
- **Entity types:** creati dall'AI dal contesto, suggeriti dal project type. Custom: prompt editabile.
- Tool calling: prompt-based XML `<tool>`, NON API nativa
- AURA_EDIT: resta separato dai tools (read DB = tools, write doc = AURA_EDIT)
- Sistema Slot-based: `SentenceSlot` con `docFrom`/`docTo`, MAI `textContent.indexOf()`
- Embedding: `embedding_save_document` fa DELETE prima di INSERT
- Delete progetto/sezione/documento cancella embeddings correlate

*Aggiornato 2026-04-18*