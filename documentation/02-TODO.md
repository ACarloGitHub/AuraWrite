# AuraWrite — TODO List

**Ultimo aggiornamento:** 2026-04-22

---

## Sessione 2026-04-22 — Toolbar Fix & Find/Replace

1. **Bug critico: setupToolbar() mai chiamata** — importata in main.ts ma mai invocata. Fix: aggiunta chiamata.
2. **Toggle marks** — Bold/Italic/Underline/Strikethrough usano ora storedMarks per modalità toggle (click poi scrivi)
3. **Blockquote toggle** — controlla se cursore dentro blockquote, poi lift o wrapIn
4. **Code block toggle** — rileva nodo corrente, converte in paragrafo se già code_block
5. **Allineamento su selezione multipla** — nodesBetween applica align a tutti i paragrafi/heading nella selezione
6. **Liste numerate** — splitListItem/liftListItem/sinkListItem aggiunti al keymap ProseMirror
7. **File dropdown** — Save/SaveAs/Open/Export + Save Project/Index/Index&CreateEntities in menu a tendina
8. **Toolbar overflow** — menu ⋯ per gruppi che non ci stanno
9. **Find/Replace** — Ctrl+F, Ctrl+H, decorations, navigazione risultati, replace one/all
10. **TextColor mark** — nero/rgb(0,0,0)/black non parsati come mark (gestito dal tema CSS)
11. **Highlight toggle** — pulsante 🖎 per on/off + color picker separato
12. **Replace word boundary** — dopo replaceOne salta oltre la regione sostituita per evitare sottostringhe

---

1. **Aggiunto `order_index` ai documenti** — tabella DB aggiornata, struct Rust, CRUD e query `ORDER BY order_index`
2. **SortableJS per DnD** — libreria installata, nativa DnD API rimossa
3. **Riordino sezioni** — drag handle `⋮`, SortableJS su `.sections-list`, salva `order_index`
4. **Riordino documenti** — drag handle `⋮`, SortableJS su `.docs-list`, salva `order_index`
5. **Sposta documenti tra sezioni** — cross-group SortableJS (`pull: true, put: ["documents"]`)
6. **CSS ghost compatta** — `.sortable-drag`: max-height 40px, nasconde docs, azioni, riduce padding
7. **DB cancellato e ricreato** per applicare schema con `order_index`

---

## Sessione 2026-04-21 — Bug Fixes

1. **Wiki aggiornata** — log.md, index.md; nuove pagine: preferences-system, ai-providers, model-benchmark (proposta)
2. **Toast indexing fix** — toast blu persistente fino a notifica successo/errore successivo
3. **ESLint fix** — aggiunti `CustomEvent`, `setTimeout`/`clearTimeout`, `HTMLButtonElement`, `HTMLAnchorElement` nelle globals
4. **Model Benchmark proposta** — framework per testare modelli su AURA_EDIT, suggestions, entity extraction, tool calling

---

## Sessione 2026-04-20 — Cosa e' stato fatto

1. **Preferences ristrutturato a 5 schede** — General, AI Provider, AI Behavior, Editor & Data, Indexing & Tools
2. **6 provider AI** — Ollama, OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio
3. **Campo Provider/Model/API Key/Base URL** — nella scheda AI Provider con visibilità condizionale
4. **Lingua interfaccia + lingua scrittura** — doppio selettore lingua nella scheda AI Behavior
5. **Nome assistente + Nome utente** — personalizzabili nella scheda AI Behavior
6. **Prompt editabili con pulsante Reset** — Suggestions, AI Assistant, Entity Extraction, Tool Calling
7. **Entity Extraction Role** — campo libero per prospettiva (es. "avvocato", "medico")
8. **Unificazione localStorage** — `aurawrite-ai-settings` migrato in `aurawrite-preferences`
9. **Nuovi campi AIContext** — assistantName, userName, interfaceLanguage, writingLanguage, customAssistantPrompt
10. **Style presets placeholder** — spazio riservato per futuri preset (Tolkien, Shakespeare, etc.)
11. **Bug noti ereditati**: toast indexing, ESLint config, dropdown dark mode

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

## Piano Sessioni 2026-04-22+ — Core Editing, Output, Colori UI

Discussione del 2026-04-22: Carlo ha richiesto una serie di miglioramenti all'interfaccia di editing e all'usabilita' generale. Abbiamo suddiviso il lavoro in 3 sessioni.

---

## Sessione 7: Core Editing — Schema ProseMirror + Toolbar

**Obiettivo:** Aggiornare lo schema ProseMirror e la toolbar con tutte le funzioni di editing di base.

### Schema ProseMirror da aggiungere
- **Marks:**
  - `underline` (Ctrl+U)
  - `strikethrough` (Ctrl+Shift+X)
  - `textColor` — colore del testo (non del tema)
  - `highlight` — evidenziazione del testo
  - `fontSize` — dimensione font
  - `fontFamily` — scelta font
- **Nodi:**
  - `heading` (H1, H2, H3, Normal/Paragraph) via dropdown
  - `bullet_list` — elenco puntato
  - `ordered_list` — elenco numerato
  - `list_item` — elemento di lista
  - `blockquote` — citazione
  - `code_block` — blocco codice
- **Attributi:**
  - `alignment` (left/center/right/justify) sui paragrafi e heading
  - `lineHeight` (interlinea: 1.0, 1.15, 1.5, 2.0)

### Toolbar ristrutturata in gruppi logici
```
[File: Save | Save As | Open | Export]
[Edit: Undo | Redo]
[Style: Font | Size | Color | Highlight]
[Format: B | I | U | S | H1 ▼ | List ▼ | Quote | Code]
[Align: ← | ↔ | → | ≡]
[Page: Break | Auto]
```

### Note tecniche
- L'editor attuale usa `basicSchema` con paragraph override (pageBreakBefore). Andrà esteso lo schema invece di sovrascrivere.
- Interlinea: attributo `lineHeight` su paragraph e heading.
- Colori testo/evidenziazione: attributi `style` gestiti con `toDOM`/`parseDOM`.
- Font: uso di CSS variables e attributo `data-font`.

### Commits previsti
1. `feat(schema): add underline, strikethrough, textColor, highlight marks`
2. `feat(schema): add heading, bullet_list, ordered_list, blockquote, code_block nodes`
3. `feat(schema): add alignment and lineHeight attributes`
4. `feat(toolbar): add font, size, color, highlight, alignment controls`
5. `feat(toolbar): add heading, list, quote, code controls`

---

## Sessione 8: Output, Stampa, Colori Box

**Obiettivi:**
1. **Paged.js** per anteprima di stampa (`@media print` + paginazione A4)
2. **Stampa nativa** (`window.print()` nel WebView Tauri)
3. **Aggiornare import/export** (Markdown/HTML/DOCX/TXT) per supportare i nuovi marks/nodi
4. **Color picker per project/section/document box** — ispirato a 3LO (`color_picker.js`):
   - Colori solidi predefiniti + color picker custom
   - Gradienti opzionali per sfondi
   - Testo colorato contrasto automatico
   - Preview live
   - Reset ai default
   - Cache per evitare query ripetute
   - Stato nel database SQLite
   - Pulsante colore su ogni box (project card nella home, section header, document item)

---

## Sessione 9: Polish & AI

**Obiettivi:**
1. **Show AI Thinking** — toggle nell'header del pannello AI Assistant per mostrare/nascondere il reasoning dei modelli (modelli con `<thinking>` o tag simili)
2. **Test Entity Extraction end-to-end** — il codice esiste in `entity-extraction.ts`, serve un test reale con documento demo
3. **Bug Discard lento** — investigare per quali modelli la chiamata AI su `Discard` è lenta (possibile: modelli con thinking esteso)
4. **Migliorare system prompt tool calling** — forzare AI a chiamare tools prima di rispondere "no entities found", esempi piu' chiari, project_id esplicito
5. **Prompt presets per modello** — dropdown per caricare prompt ottimizzati per modello (Qwen, Kimi, GPT-4o, Claude) — placeholder gia' presente nelle Preferenze

---

## Regola per i Commit
- Un commit dopo ogni modifica importante che raggiunge un risultato o implementa qualcosa di nuovo che non rompe cio' che c'e' gia' e funziona.
- Non fare commit su main ma su branch `feat/sessione-7`, poi merge a fine sessione.

---

## PRIORITY 1: Bugs aperti

- [ ] Discard lento (dipende dal modello AI)
- [ ] Accept/Switch mangia spazi residuale — mitigato con segnaposto precisi, ma si ripresenta con testo lungo. Investigare pattern a due transazioni
- [x] Dropdown select in dark mode (GTK) — CSS fix
- [x] Toast "indexing" scompare senza notifica — fix: toast blu persistente fino a successo/errore
- [x] Entity extraction: extraction falliva silenziosamente per utente con provider senza API key (es. OpenAI/Anthropic senza key inserita) — aggiunto log di debug e controllo preventivo pre-chiamata AI con messaggio errore che guida a Preferences > AI Provider
- [x] ESLint config: aggiunti globals browser

---

## PRIORITY 2: Features (in ordine di priorità)

1. ~~**Indicatore stato indicizzazione sull'icona 🗂**~~ — ✅ Completato: rosso=non indicizzato, giallo=outdated, verde=aggiornato. Usa la tabella `links` con `link_type='extracted_from'`.
2. **Provider/Model/API Key nelle Preferenze** — ✅ Completato: 6 provider (Ollama, OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio), model input, API key, base URL, visibilità condizionale
3. **Show AI thinking** — opzione nel pannello AI Assistant (header) per mostrare/nascondere il thinking del modello. Solo per modelli che supportano reasoning (es. kimi-k2.5)
4. **Migliorare system prompt per tool calling** — forzare AI a chiamare tools prima di rispondere "no entities found", aggiungere project_id esplicito, esempi più chiari
5. **Preferences a schede** — ✅ Completato: 5 tab (General, AI Provider, AI Behavior, Editor & Data, Indexing & Tools)
6. **LM Studio preset** — gia' funzionante via OpenAI provider con baseUrl http://localhost:1234/v1, aggiungere preset nelle preferenze
7. **Tool calling nativo per provider che lo supportano** — OpenAI e Anthropic hanno API tools nativa, LM Studio supporta function calling. Per ora usiamo prompt-based XML per tutti. Futuro: aggiungere supporto nativo come opzione per provider compatibili
8. **Prompt presets per modello** — dropdown per caricare prompt ottimizzati per modello (Qwen, Kimi, GPT-4o, Claude). Da implementare quando avremo più esperienza con i vari modelli
9. **Style presets (semi)** — sistema ComfyUI-like con preset stile (Tolkien, Shakespeare, etc.) che configurano tono, ruolo estrazione, lingua. Placeholder già presente nelle Preferenze
10. **MCP Server** — Carlo ha creato un server MCP (2026-04-20). In prospettiva, implementare l'integrazione MCP in AuraWrite per permettere a client esterni di interagire con il database e le funzionalità dell'app.
11. ~~**Drag & Drop**~~ — ✅ Completato: SortableJS al posto del nativo DnD. Riordino sezioni e documenti, spostamento inter-sezione, ghost compatta con CSS. Richiede `order_index` nella tabella `documents`.
9. **Hugging Face GGUF local models** (rimuovere dipendenza Ollama)
10. ~~**Enhanced title bar**~~ — ✅ Completato: centrato, Georgia serif bold 16px
11. **Cronologia modifiche persistenti**
12. **Writing stats, token counter, sentence counter**
13. **Export PDF/ePub migliorato**
14. **Icone personalizzate SVG** — Sostituire le emoji nella toolbar con icone SVG custom. Ideale: set di icone minimal monocromatiche che cambi colore col tema. Da progettare: stile consistente, dimensione standard, stroke width uniforme. Non dipendere da librerie esterne di icone per evitare vincoli di licenza e dipendenze.

---

## PRIORITY 3: Materiali Esterni e Import (Future)

Spazio dedicato nel progetto per materiale esterno (fonti, siti, PDF, ePub, immagini). L'idea è poter importare e indicizzare contenuti non-narrativi affiancati ai documenti di scrittura.

| Feature | Descrizione |
|---------|-------------|
| **Sezione "Risorse" nel progetto** | Area dedicata per materiale esterno, separata dalle sezioni narrative |
| **Import documenti** | Importare PDF, ePub, TXT, MD nel progetto come risorse indicizzabili |
| **Indicizzazione risorse** | Le risorse importate vengono indicizzate (embeddings + entity extraction) come i documenti |
| **Immagini per modelli multimodali** | Importare immagini (mappe, personaggi, copertine) per l'AI multimodale |
| **Riferimenti web** | Salvare URL con estrazione testo/cache per consultazione AI |
| **Ricerca semantica estesa** | Ricerca semantica copre sia documenti che risorse importate |

Nota: la tabella `attachments` già esiste nello schema DB (con `entity_id`, `document_id`, `file_path`, `file_type`) — può essere la base per questa feature.

---

## PRIORITY 4: Paginazione A4 (Future)

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