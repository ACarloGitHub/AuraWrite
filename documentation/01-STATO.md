# AuraWrite — Stato Attuale

**Ultimo aggiornamento:** 2026-04-23

---

## Funzionalita' Completate

### Core Editor
- Editor ProseMirror funzionante
- File operations: Save, Save As, Open, Export — in File dropdown menu
- File dropdown: Save, Save As, Open, Export + Save Project, Index Document, Index & Create Entities
- Toolbar formatting: Bold, Italic, Underline, Strikethrough (toggle mode via storedMarks)
- Heading dropdown (H1/H2/H3/Normal)
- Lists: Bullet, Ordered (splitListItem per continuare elenco)
- Blockquote toggle (wrapIn/lift)
- Code Block toggle (setBlockType/paragraph)
- Alignment (left/center/right/justify) — funziona su selezioni multiple
- Font family, font size, text color, highlight toggle + color picker
- Text color: nero non parsato come mark (gestito dal tema CSS)
- Line height (1.0, 1.15, 1.5, 2.0)
- Find (Ctrl+F) and Find & Replace (Ctrl+H) con decorations e navigazione (posizione: gruppo EDIT)
- Title bar centrato con Georgia serif bold 16px e dirty indicator
- Theme toggle (light/dark/custom)
- Preferences modal trascinabile con hint descrittivi
- Toolbar icon-only con tooltip nativo (rimosso display mode text/both/icon)

### Database SQLite — Phase A + B
- Backend Rust CRUD completo (projects, sections, documents, entities, entity_types, versions)
- Frontend TypeScript client (`db.ts`)
- ProjectPanel UI con gerarchia Project → Section → Document
- Dirty tracking, save dialogs, auto-save (12s)
- Per-document save, project save
- Delete cascade: progetto → sezione → documento cancellano embeddings correlate
- `embedding_delete_for_project` comando Tauri esposto

### AI Infrastructure
- Provider interface: Ollama, OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio
- AI Manager per gestire chiamate
- AURA_EDIT system per modifiche documento (replace, insert, delete, format)
- Suggestions Panel (sinistra) con trigger su punteggiatura
- AI Assistant Panel (destra) con chat e contesto documento
- 6 provider AI con model/API key/base URL configurabili nelle Preferenze
- Lingua interfaccia + lingua scrittura separate
- Nome assistente + nome utente personalizzabili
- Prompt editabili con pulsante Ripristina default

### Semantic Search + Embeddings
- nomic-embed-text-v2-moe via Ollama (768-dim, prefissi search_document/search_query)
- SQLite + cosine similarity in Rust
- Automatic embedding indexing on save (con delete before insert)
- Semantic Search Toggle nelle preferenze

### Tool Calling (INTEGRATO)
- `tools.ts`: 8 tools definiti con parser, esecuzione, system prompt
- Tools: search_entities, get_entity_details, list_entities_by_type, search_documents, get_document_content, get_project_structure, semantic_search, entities_in_document
- Integrato nel chat panel con loop prompt-based XML
- Tool `entities_in_document` usa la tabella `links` per filtrare entities per documento

### Document-Entity Links
- Tabella `links` (già nello schema) ora usata per collegare entities ai documenti
- `link_type='extracted_from'`: documento → entity estratte da quel documento
- Delete cascade: progetto/sezione/documento cancellano anche i link correlati
- Re-indicizzazione: cancella vecchi link del documento, poi ricrea
- Indicatore semaforo: rosso (non indicizzato), giallo (outdated), verde (aggiornato)

---

## Preferences (ristrutturato a 5 schede)
- **General**: theme, toolbar display, custom colors
- **AI Provider**: provider dropdown, model, API key, base URL (visibilità condizionale)
- **AI Behavior**: lingua interfaccia, lingua scrittura, nome assistente, nome utente, intervals, prompt editabili
- **Editor & Data**: incremental save, max snapshots, deselect, semantic search
- **Indexing & Tools**: extraction role, extraction prompt, tool calling prompt, semantic search toggle
- localStorage unificato: `aurawrite-preferences` (migrato dal vecchio `aurawrite-ai-settings`)

## Bug Notevoli (Risolti)
- Selection positions: uso di nodesBetween, mai textContent.indexOf()
- AURA_EDIT: parser con 3 strategie, supporto testo formattato
- Semantic Search Toggle: bug ID duplicato HTML risolto
- Embeddings orfani su delete: ora cancellati automaticamente

## Bug Aperti
- [ ] Discard lento (dipende dal modello AI)
- [ ] Accept/Switch mangia spazi residuale (mitigato, si ripresenta con testo lungo)

## Bug Risolti (Sessione 9)
- [x] AI panel non si collassava con btn-ai — fix: classList.toggle invece di remove
- [x] Discard suggestions senza feedback — fix: isProcessing flag + spinner "Generating new suggestion..."
- [x] Toolbar display mode incoerente — fix: rimossa opzione text/both, toolbar icon-only con tooltip
- [x] Find/Replace posizione insolita — fix: spostati nel gruppo EDIT dopo Undo/Redo
- [x] Title bar non centrato — fix: justify-content:center, Georgia serif bold 16px

## Bug Risolti (Sessione 8)
- [x] Toolbar buttons non funzionavano — setupToolbar() non veniva chiamata in main.ts
- [x] Bold/Italic/Underline/Strikethrough non funzionavano in modalità toggle (storedMarks)
- [x] Blockquote aggiungeva sempre blocco senza toglierlo — fix: toggle con lift/wrapIn
- [x] Code block non aveva "off" — fix: rileva nodo corrente, converte in paragrafo
- [x] Allineamento non funzionava su testo ampio — fix: nodesBetween per applicare a tutti i paragrafi nella selezione
- [x] Liste numerate non continuavano con Enter — fix: splitListItem nel keymap
- [x] File dropdown non visibile — fix: overflow:hidden rimosso, z-index corretto
- [x] TextColor mark nero forzato in tema dark — fix: nero/rgb(0,0,0)/black non parsati come mark
- [x] Highlight non aveva toggle — fix: pulsante 🖎 per on/off + color picker separato
- [x] Replace "ecco" in "cecco" poi rimpiazzava sottostringa — fix: skip past replaced region
- [x] Dropdown select sfondo chiaro in dark mode (GTK/Linux) — CSS fix in styles.css
- [x] ESLint config: aggiunto CustomEvent, setTimeout/clearTimeout, HTMLButtonElement/AnchorElement in globals

---

## Drag & Drop (ProjectPanel)
- SortableJS per drag & drop fluido nella sidebar
- Riordino sezioni nel progetto attivo
- Riordino documenti intra-sezione
- Spostamento documenti tra sezioni diverse
- Handle `⋮` visibile su ogni riga per attivare il drag
- Ghost compatta (CSS `.sortable-drag`) — clone volante ridotto e arrotondato
- Campo `order_index` aggiunto alla tabella `documents` nel DB SQLite

---

## Tecnologia

| Componente | Tecnologia |
|------------|------------|
| Editor | ProseMirror |
| Desktop | Tauri v2 |
| Frontend | TypeScript, Vite, CSS puro |
| Backend | Rust (tauri) |
| Database | SQLite (rusqlite) |
| AI Provider | Ollama, OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio |
| Embeddings | nomic-embed-text-v2-moe via Ollama |
| Vector Search | SQLite + cosine similarity in Rust |

---

## File Principali

```
src/
├── editor/
│   ├── editor.ts              # Editor principale
│   ├── toolbar.ts             # Toolbar e file operations
│   └── project-panel.ts       # Sidebar, save, indexing
├── ai-panel/
│   ├── chat.ts                # AI Assistant panel (destra)
│   ├── suggestions-panel.ts   # Suggestions panel (sinistra)
│   ├── operations.ts          # Tipi AURA_EDIT
│   ├── edit-parser.ts         # Parser AURA_EDIT
│   ├── edit-executor.ts       # Esecuzione operazioni AURA_EDIT
│   ├── modification-hub.ts     # Bus sincronizzazione
│   ├── ai-manager.ts          # Gestione provider AI
│   ├── providers.ts           # Interface provider
│   ├── ollama-provider.ts     # Provider locale
│   ├── remote-providers.ts    # OpenAI, Anthropic, DeepSeek, OpenRouter, LM Studio
│   ├── chunks.ts              # Document chunking per contesto
│   ├── tools.ts               # Tool calling per DB (8 tools, integrato)
│   └── entity-extraction.ts   # Entity extraction con link document→entity
├── formats/                   # Convertitori formato
├── database/
│   └── db.ts                  # SQLite operations (Tauri invoke)
└── main.ts                    # Entry point, preferences, UI setup

src-tauri/
└── src/
    ├── lib.rs                 # Tauri commands (con embedding cleanup)
    ├── database.rs            # Rust DB operations
    └── embeddings.rs          # Vector embeddings, semantic search
```

---

*Aggiornato 2026-04-23*