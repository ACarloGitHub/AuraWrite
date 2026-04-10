# Brainstorming: Database Architecture

**Data:** 2026-03-29
**Partecipanti:** Carlo, Agent (OpenCode)
**Stato:** In elaborazione - piano in fase di definizione

---

## Visione Complessiva

AuraWrite deve supportare:

1. **Salvataggio incrementale** con versioni consultabili
2. **Relazioni fra documenti** (personaggi, luoghi, capitoli)
3. **Publishing ebook** (EPUB)
4. **AI integrata** che può interrogare il database
5. **Sync multi-dispositivo**

---

## AI Implementation

### Provider Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI PROVIDER INTERFACE                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  interface AIProvider {                                      │
│    name: string;                                            │
│    displayName: string;                                     │
│    isLocal: boolean;                                        │
│    stream(prompt, context): Promise<AIResponse>;           │
│    stop(): void;                                            │
│  }                                                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Ollama     │  │   OpenAI     │  │  Anthropic   │    │
│  │  (local)     │  │   (API)      │  │   (API)      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Files Created

```
src/ai-panel/
├── providers.ts           # Interface e settings
├── ollama-provider.ts     # Ollama implementation
├── remote-providers.ts    # OpenAI + Anthropic
├── ai-manager.ts          # Central AI manager
├── chat.ts               # Chat panel UI
└── suggestions-panel.ts   # Suggestions panel UI (left side)
```

### AI UI Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  [Toolbar]                                                        │
├──────────────┬─────────────────────────────────┬────────────────┤
│              │                                 │                │
│  SUGGERIMENTI│         EDITOR                   │   AI CHAT      │
│  ────────────│                                 │   ──────────   │
│              │                                 │                │
│  📝 Paragrafo  │     Contenuto documento       │   [Chat]       │
│  suggerisce:  │                                │                │
│  "migliora    │                                │   "Cosa ne     │
│  la frase..."  │                                │   pensi?"      │
│              │                                 │                │
│  [Accetta ✓] │                                 │                │
│  [Rifiuta ✗] │                                 │                │
│              │                                 │                │
├──────────────┴─────────────────────────────────┴────────────────┤
```

### AI Behavior

- **Context Display**: Quando testo è selezionato, appare badge "Selected: '...'" nel pannello chat
- **Selection Range**: Salvato quando si clicca su AI, non deselezionato al click nella chat
- **Suggestions Panel**: Appare a sinistra, accetta/rifiuta suggerimenti

### AI Modes

1. **Modalità "Suggerimento" (Proattiva)** - futuro
   - Aura legge documento a intervalli regolari
   - Suggerisce miglioramenti automaticamente
   - Intervallo configurabile (30s, 60s, 120s)

2. **Modalità "Lazy" (Reattiva)** - attuale
   - Aura in ascolto silenzioso
   - Utente attiva lettura con comando/pulsante

### Context & Token Management - futuro

- Token counter con warning a 80%/95%
- Opzione A: Compatta sessione in DB
- Opzione B: Crea JSON/MD con metadati per indicizzazione

### AI Settings

```typescript
interface AISettings {
  enabled: boolean;
  provider: "ollama" | "openai" | "anthropic";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  streamResponses: boolean;
  autoIndexDocument: boolean; // Per database filling
  privacyDisclaimerShown: boolean;
}
```

### Privacy

- **Local provider (Ollama)**: Nessun dato esce dal dispositivo
- **Cloud providers (OpenAI, Anthropic)**:
  - Richiede disclaimer nelle preferenze
  - Opzione per disabilitare indicizzazione automatica
  - Contenuto mandato ai server del provider

### Models Available for Testing

| Model                                      | Type   | Use                |
| ------------------------------------------ | ------ | ------------------ |
| `kimi-k2.5:cloud`                          | Cloud  | Testing principale |
| `huihui_ai/glm-4.7-flash-abliterated:q4_K` | Locale | Testing offline    |

### AI Functions

```typescript
// Chat
sendToAI(prompt, context): Promise<AIResponse>

// Text improvement
improveText(text, instruction, context): Promise<AIResponse>
continueText(text, context): Promise<AIResponse>
suggestAlternatives(text, context): Promise<string[]>

// Vocabulary
getSynonyms(word, context): Promise<string[]>
```

### Future AI Features (Preso Nota)

- [ ] Image generation (Stable Diffusion/Flux) - future
- [ ] Internet search - future
- [ ] Graphic novel illustrations - future
- [ ] Database filling automatico - after Phase 1

### AI Prompt Templates

```typescript
// Synonyms/Antonyms
const SYNONYMS_PROMPT = `Find synonyms and antonyms for "${word}".
Respond in JSON format: { "synonyms": [], "antonyms": [] }`;

// Improve text
const IMPROVE_PROMPT = `${instruction}:\n\n"${text}"`;

// Continue text
const CONTINUE_PROMPT = `Continue naturally:\n\n"${text}"`;

// Alternatives
const ALTERNATIVES_PROMPT = `Suggest 3 alternatives. JSON: { "alternatives": [] }`;
```

---

## Query Architecture: Tool Calling

**Decisione:** 2026-04-08 — Tool Calling come approccio principale per query AI al database.

### Perché Tool Calling

| Approccio | Pro | Contro |
|-----------|-----|--------|
| **Template predefiniti** | Sicuro, prevedibile | Limitato, risultati scarni |
| **Tool Calling** | Potente, naturale, risultati ricchi | Richiede modello che supporti tools |
| **Text-to-SQL** | Flessibile | Rischio SQL injection |

**Scelta:** Tool Calling. L'utente si aspetta query "intelligenti" sui personaggi. Template predefiniti deludono.

### Sicurezza

Il modello può usare SOLO i tools che definiamo:

| Limite | Valore |
|--------|--------|
| Max tool calls per query | 5 |
| Timeout per tool | 10s |
| Tools disponibili | Solo lettura (SELECT) |
| Nessun tool di scrittura | L'utente conferma sempre |

**Il modello NON può:**
- Modificare/eliminare dati
- Accedere al filesystem
- Fare chiamate di rete
- Generare SQL arbitrario

### Tools Proposti

```typescript
const TOOLS = [
  {
    name: "search_characters",
    description: "Cerca personaggi nel progetto",
    params: { name: "string" }
  },
  {
    name: "search_locations",
    description: "Cerca luoghi nel progetto",
    params: { name: "string" }
  },
  {
    name: "find_scenes",
    description: "Trova scene con entità in capitoli",
    params: { entity: "string", chapters: "number[]" }
  },
  {
    name: "count_occurrences",
    description: "Conta menzioni di un'entità",
    params: { entity: "string", range?: { from: number, to: number } }
  },
  {
    name: "get_chapter_summary",
    description: "Riassunto di un capitolo",
    params: { chapter: "number" }
  },
  {
    name: "find_similar_scenes",
    description: "Trova scene semanticamente simili (richiede VectorDB)",
    params: { text: "string", limit: "number" }
  },
  {
    name: "list_entities_by_type",
    description: "Lista tutte le entità di un tipo",
    params: { type: "string" }
  }
];
```

### Implementazione Ollama

```typescript
import ollama from 'ollama';

const response = await ollama.chat({
  model: 'qwen3',  // Modello che supporta tool calling
  messages: [{ role: 'user', content: prompt }],
  tools: TOOL_DEFINITIONS,
});

if (response.message.tool_calls) {
  for (const call of response.message.tool_calls) {
    const result = await executeTool(call.function.name, call.function.arguments);
    messages.push({ role: 'tool', tool_name: call.function.name, content: result });
  }
  // Seconda chiamata per generare risposta finale
  const final = await ollama.chat({ model: 'qwen3', messages });
}
```

### Fallback

Se il modello non supporta tool calling o Ollama non è attivo:
- Usare FTS5 per ricerca full-text
- Risultati più semplici ma funzionano

### UI

> **"AuraWrite usa un agente AI per interrogare il tuo progetto. Può rispondere a domande sui personaggi, luoghi, scene."}

Settings:
- Modalità Agente: [Avanzata (default)] / [Base]
- Avanzata: Tool calling per query potenti
- Base: Template predefiniti (più limitato)

---

## Schema Database Proposto (Completo)

### Core Tables

```sql
-- Progetti
projects (
  id, name, type, description,
  created_at, updated_at
)

-- Tipi di entità per progetto (definibile dall'utente)
entity_types (
  id, project_id, name, icon, color, fields_json,
  created_at
)

-- Sezioni (gerarchia ricorsiva)
sections (
  id, project_id, parent_id, name, order_index, color,
  section_type, -- "book", "part", "chapter", "generic", ecc.
  created_at
)

-- Documenti
documents (
  id, section_id, title, content_json (ProseMirror),
  status, word_count, tags, created_at, updated_at
)

-- Entità (personaggi, luoghi, casi, funzioni...)
entities (
  id, project_id, entity_type_id, name,
  description, image_path, metadata_json, created_at
)

-- Collegamentibidirezionali
links (
  id, source_type, source_id,
  target_type, target_id,
  link_type, -- "mention", "reference", "dependency"
  context_json, created_at
)

-- Versioni incrementali (backup esterno)
versions (
  id, document_id, version_number,
  backup_path, -- percorso file esterno .aurawrite/versions/
  content_json, -- solo per preview veloce, non per backup completo
  word_count, note, size_bytes, created_at
)

-- Eventi/Timeline
events (
  id, project_id, title, description,
  event_date, duration, entities_involved_json,
  created_at
)

-- Board/Kanban
board_items (
  id, document_id, status_column, order_index
)

-- Tags globali
tags (
  id, project_id, name, color
)

-- Tag-Document links
document_tags (
  document_id, tag_id
)

-- Ricerca full-text
search_index (
  id, project_id, entity_type, entity_id,
  content_text, -- testo indicizzato
  created_at, updated_at
)

-- Attachments
attachments (
  id, entity_id, file_path, file_type, size_bytes,
  created_at
)

-- Project settings (configurazioni arbitrarie)
project_settings (
  project_id, key, value
)

-- Publishing metadata
publishing_metadata (
  project_id, key, value
  -- keys: author, isbn, genre, template, chapter_order, ecc.
)
```

---

## Schema Database Proposto (Completo - SQL Dettagliato)

```sql
-- ============================================================================
-- AURAWRITE DATABASE SCHEMA
-- ============================================================================

-- Progetti (ogni progetto ha un "tipo" che definisce le entità disponibili)
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'novel', 'notes', 'legal', 'software', 'personal'
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tipi di entità per progetto (definibile dall'utente)
CREATE TABLE entity_types (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- 'Personaggio', 'Luogo', 'API', 'Caso'
    icon TEXT, -- emoji o codice icona
    color TEXT, -- es. #4a90d9
    fields_json TEXT, -- schema custom: {"età": "number", "descrizione": "text"}
    created_at INTEGER NOT NULL
);

-- Sezioni (gerarchia ricorsiva: book → parts → chapters)
CREATE TABLE sections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    color TEXT,
    section_type TEXT, -- 'book', 'part', 'chapter', 'generic'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Documenti (il contenuto vero e proprio)
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content_json TEXT NOT NULL, -- ProseMirror doc JSON
    status TEXT DEFAULT 'draft', -- 'todo', 'draft', 'review', 'done'
    word_count INTEGER DEFAULT 0,
    tags TEXT, -- comma-separated: "tag1,tag2,tag3"
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Entità (personaggi, luoghi, casi, funzioni...)
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type_id TEXT NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    image_path TEXT, -- path relativo a project folder
    metadata_json TEXT, -- dati custom definiti in entity_type
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Collegamentibidirezionali (documento ↔ entità, entità ↔ entità)
CREATE TABLE links (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL CHECK(source_type IN ('document', 'entity')),
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('document', 'entity')),
    target_id TEXT NOT NULL,
    link_type TEXT DEFAULT 'mention', -- 'mention', 'reference', 'dependency', 'contains'
    context_json TEXT, -- posizione nel testo, nota, etc.
    created_at INTEGER NOT NULL,
    UNIQUE(source_type, source_id, target_type, target_id)
);

-- Versioni incrementali (backup su file esterno)
CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    backup_path TEXT NOT NULL, -- percorso file: .aurawrite/versions/doc1_v1.json
    content_json TEXT, -- solo per preview veloce, non per backup completo
    word_count INTEGER,
    note TEXT, -- optional, like commit message
    size_bytes INTEGER,
    created_at INTEGER NOT NULL
);

-- Timeline/Eventi
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    event_date INTEGER, -- timestamp
    duration_minutes INTEGER,
    entities_involved TEXT, -- JSON array: ["entity_id1", "entity_id2"]
    created_at INTEGER NOT NULL
);

-- Board/Kanban (stato dei documenti)
CREATE TABLE board_items (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    status_column TEXT NOT NULL, -- 'backlog', 'in-progress', 'review', 'done'
    order_index INTEGER NOT NULL
);

-- Tags globali
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT
);

-- Tag-Document links
CREATE TABLE document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);

-- Ricerca full-text
CREATE TABLE search_index (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- 'document', 'entity'
    entity_id TEXT NOT NULL,
    content_text TEXT NOT NULL, -- testo indicizzato
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Attachments
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_type TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL
);

-- Project settings (configurazioni arbitrarie)
CREATE TABLE project_settings (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (project_id, key)
);

-- Publishing metadata
CREATE TABLE publishing_metadata (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL, -- 'author', 'isbn', 'genre', 'template', 'chapter_order'
    value TEXT,
    PRIMARY KEY (project_id, key)
);

-- ============================================================================
-- INDICES
-- ============================================================================
CREATE INDEX idx_sections_project ON sections(project_id);
CREATE INDEX idx_sections_parent ON sections(parent_id);
CREATE INDEX idx_documents_section ON documents(section_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_entities_project ON entities(project_id);
CREATE INDEX idx_entities_type ON entities(entity_type_id);
CREATE INDEX idx_links_source ON links(source_type, source_id);
CREATE INDEX idx_links_target ON links(target_type, target_id);
CREATE INDEX idx_versions_document ON versions(document_id);
CREATE INDEX idx_versions_created ON versions(created_at);
CREATE INDEX idx_events_project ON events(project_id);
CREATE INDEX idx_events_date ON events(event_date);
CREATE INDEX idx_search_project ON search_index(project_id);
CREATE INDEX idx_search_entity ON search_index(entity_type, entity_id);
```

---

## Vector DB Integration (ChromaDB o simile)

### Collections

```json
{
  "document_chunks": {
    "documents": [
      "chunk_id",
      "document_id",
      "text_chunk",
      "embedding",
      "position"
    ],
    "indexes": ["document_id"]
  },
  "character_descriptions": {
    "documents": ["id", "entity_id", "description", "embedding"],
    "indexes": ["entity_id"]
  },
  "plot_semantics": {
    "documents": ["id", "chapter_id", "semantic_summary", "embedding"],
    "indexes": ["chapter_id"]
  }
}
```

### Pattern Ibrido SQL + Vector

```python
def search_characters_by_context(project_id, context_text):
    # 1. SQL: trova entity_ids di personaggi nel progetto
    characters = sql("SELECT id, name FROM entities WHERE project_id = ? AND entity_type_id = ?",
                   [project_id, 'character_type_id'])

    # 2. Vector: trova descrizioni simili al contesto
    similar = vector_db.query(
        collection="character_descriptions",
        query_embedding=encode(context_text),
        where={"entity_id": [c['id'] for c in characters]}
    )

    # 3. Combina risultati
    return merge_sql_vector_results(characters, similar)
```

---

## AI Linking Automatico

### Prompt Strutturato

```python
LINKING_PROMPT = """
Tu sei un assistente per linking di entità in un progetto di scrittura.

Contesto progetto:
{project_context}

Entità esistenti nel progetto:
{existing_entities}

Documento corrente:
{current_document_text}

Compito:
1. Identifica menzioni di entità nel testo
2. Per ogni menzione, determina se è un riferimento a un'entità esistente
3. Suggerisci link con tipo appropriato ('mention', 'reference', 'dependency')

Output formato JSON:
{{
  "links": [
    {{
      "text": "nome_entità_trovato",
      "start_pos": 123,
      "end_pos": 130,
      "entity_id": "id_entità_o_null",
      "entity_name": "nome_entità",
      "link_type": "mention",
      "confidence": 0.95
    }}
  ]
}}

Importante:
- Se un'entità non esiste ancora, proponi di crearla con entity_type adeguato
- Considera il contesto: "Marco entrò nella stanza" vs "Marco (il gatto)" sono lo stesso nome ma entità diverse
"""
```

### Workflow di Linking

1. **Digitazione**: Utente digita "Marco" nel documento
2. **Trigger**: Dopo 500ms di pausa o alla fine della parola
3. **Lookup locale**: Cerca "Marco" nelle entità del progetto (SQL LIKE)
4. **AI arricchimento** (opzionale): Se trovati multipli "Marco", usa prompt per disambiguare
5. **Popup**: "Hai trovato: Marco (protagonista) — vuoi creare un link?"
6. **Conferma**: Link creato in tabella `links`

---

## Sync Multi-Dispositivo

### Architettura Proposta

```
┌─────────────────────────────────────────────────────────────┐
│                    SYNC ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Local (SQLite) ──► Sync Engine ──► Cloud Storage         │
│        │                   │                    │           │
│        ▼                   ▼                    ▼           │
│   .aurawrite/         Conflict          Dropbox/GDrive/    │
│   └── db.sqlite      Resolution         iCloud/Git         │
│   └── versions/                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Conflict Resolution Strategy

```python
class SyncConflict:
    LOCAL = "local_wins"
    REMOTE = "remote_wins"
    MERGE = "merge"  # per documenti: crea entrambe le versioni come variants
    ASK = "ask_user"

def resolve_conflict(local_version, remote_version, conflict_type):
    if conflict_type == "settings":
        return SyncConflict.REMOTE  # sempre remote per settings
    elif conflict_type == "document":
        if local_version.updated_at == remote_version.updated_at:
            return SyncConflict.MERGE
        return SyncConflict.ASK  # l'utente sceglie
    elif conflict_type == "entity":
        return SyncConflict.MERGE  # merge intelligente per entità
```

### Cloud Provider Options

| Provider         | Vantaggi                 | Svantaggi               |
| ---------------- | ------------------------ | ----------------------- |
| **Dropbox**      | Semplice, familiare      | Limiti API              |
| **Google Drive** | Grande capacità          | OAuth complesso         |
| **iCloud**       | Solo Apple               | Cross-platform limitato |
| **Git**          | Version control naturale | Curva apprendimento     |
| **Self-hosted**  | Controllo totale         | Setup richiesto         |

**Nota:** Implementare prima solo locale. Sync è feature futura.

---

## Publishing

### EPUB Structure

```
book.epub/
├── META-INF/
│   └── container.xml
├── mimetype
├── content.opf          -- metadata + manifest
├── toc.ncx              -- table of contents
├── nav.xhtml            -- navigation (EPUB3)
├── styles/
│   └── styles.css
├── fonts/
│   └── font.ttf
└── chapters/
    ├── chapter1.xhtml
    ├── chapter2.xhtml
    └── ...
```

### Publishing Metadata Table

```sql
-- Esempio entries in publishing_metadata
INSERT INTO publishing_metadata (project_id, key, value) VALUES
  ('proj1', 'author', 'Nome Autore'),
  ('proj1', 'isbn', '978-1234567890'),
  ('proj1', 'genre', 'Fantasy'),
  ('proj1', 'language', 'it'),
  ('proj1', 'publisher', 'Self-published'),
  ('proj1', 'chapter_order', '["ch1", "ch2", "ch3"]'),  -- JSON array
  ('proj1', 'template', 'novel_standard');
```

---

## UI Wireframe — Pannello Progetto

```
┌──────────────────────────────────────────────────────────┐
│  📁 AuraWrite                              [Progetto ▼]  │
├──────────────────────────────────────────────────────────┤
│  📖 ROMANZO: "La Mappa del Tempo"                        │
├──────────┬───────────────────────────────────────────────┤
│          │  📋 SEZIONI                🔍 Cerca          │
│  NAV     │  ├─ 🟦 Parte I: L'Inizio                     │
│  ─────   │  │   ├─ 📄 Cap. 1: La bottega [✓]           │
│  📄 Docs │  │   └─ 📄 Cap. 2: Il viandante [~]          │
│  👥 Pers │  ├─ 🟨 Parte II: Il Viaggio                  │
│  📍 Luog │  │   └─ 📄 Cap. 3: La notte [○]              │
│  ⏱️ Time │  └─ 🟥 Parte III: La Città                   │
│  📌 Board│                                              │
│  🗂️ Tutte│  👤 ENTITÀ                                    │
│          │  ├─ Marco (protagonista)      [Roma] (luogo)  │
│          │  ├─ Laura (alleata)            [Milano](luogo) │
│          └───────────────────────────────────────────────┘
```

### Interazione Contestuale

Quando si scrive in un documento e si digita il nome di un'entità (es. "Marco"):

1. Appare popup: "👤 Marco — Inserisci link?"
2. Conferma → crea link nel testo
3. Link cliccabile → apre profilo entità o evidenzia menzioni

---

## Fasi Implementative

### Fase A: Database Base (SQLite)

1. [x] Schema core: projects, sections, documents (in questo doc)
2. [ ] CRUD base per progetti e documenti
3. [ ] Connessione toolbar → database

### Fase B: Versioni/Incremental Save

1. [ ] Tabella versions con backup_path
2. [ ] Salvataggio versioni automatico
3. [ ] UI per visualizzare/recoverare versioni

### Fase C: Entità Base

1. [ ] Schema entities, entity_types
2. [ ] Poche entità predefinite: Personaggio, Luogo, Oggetto
3. [ ] Linking manuale documento ↔ entità

### Fase D: AI Linking

1. [ ] Integrazione prompt strutturato
2. [ ] Riconoscimento automatico menzioni
3. [ ] Suggerimento link

### Fase E: Board/Timeline

1. [ ] Tabella board_items
2. [ ] UI kanban
3. [ ] Timeline view

### Fase F: Publishing

1. [ ] Tabella publishing_metadata
2. [ ] Export EPUB base
3. [ ] Template formattazione

### Fase G: Estensioni

1. [ ] Tags globali
2. [ ] Search full-text
3. [ ] Attachments
4. [ ] Entity types personalizzati

### Fase H: Sync (Futuro)

1. [ ] Architettura sync
2. [ ] Conflict resolution
3. [ ] Cloud provider integration

---

## Note Implementative

1. Usare `rusqlite` per SQLite in Tauri
2. Le query devono essere preparate (prepared statements) per sicurezza
3. JSON content viene salvato come TEXT, parsing in TypeScript
4. Creare indices su `project_id`, `section_id`, `entity_type_id` per performance

---

## Decisioni Prese

- [x] Schema SQL dettagliato con CREATE TABLE
- [x] Gerarchie ricorsive per sezioni
- [x] Link bidirezionali con link_type
- [x] Versioni con backup_path esterno
- [x] Entity types personalizzabili
- [x] Board/Kanban per stato documenti
- [x] Timeline/Eventi
- [x] Tags globali
- [x] Search full-text
- [x] Attachments
- [x] Publishing metadata
- [x] AI linking con prompt strutturati
- [x] Sync multi-dispositivo (architettura, implementazione futura)
- [x] Vector DB integration per ricerche semantiche

---

## Approccio: Gerarchie

### Tipi di Gerarchia

**1. Predefinite (per libri/romanzi):**

```
Book → Parts → Chapters → Scenes
```

**2. Generiche (personalizzabili):**

```
Project → Sections → Documents
(dove section_type può essere "part", "folder", "category", ecc.)
```

### Implementazione

```sql
-- Section type definisce il comportamento
section_types (
  id, project_id, name, -- "book", "part", "chapter", "generic"
  icon, color, max_depth, allows_documents BOOLEAN
)
```

---

## AI Linking Automatico

### Come Funziona

1. L'utente scrive nel documento
2. Quando digita un nome entità (es. "Marco"), il sistema:
   - Cerca entità "Marco" nel progetto
   - Se trovata, propone link
3. **Con AI**: il prompt strutturato permette:
   - Riconoscimento contesto (Marco protagonista vs Marco comparsa)
   - Proposta link basata su semantica, non solo matching esatto
   - Suggerimento entità correlate

### Prompt Strutturato Proposto

```
Tu sei un assistente per linking di entità in un romanzo.
Contesto: {project_context}
Documento: {current_document_text}
Entità esistenti: {existing_entities}
Compito: identifica menzioni di entità nel testo e suggerisci link.
Output: JSON con [{entity_name, start_pos, end_pos, link_type, confidence}]
```

---

## Sync Multi-Dispositivo

### Architettura Proposta

**Opzione: Git-like con conflict resolution**

```
.aurawrite/
├── projects/
│   └── IlMioLibro/
│       ├── .aurawrite/           -- database e versioni
│       ├── chapters/
│       └── .git/                 -- sync metadata
└── settings.json
```

**Alternativa: Cloud Provider (futuro)**

- Dropbox, Google Drive, iCloud
- Conflict resolution automatico

**Nota:** Questa feature è per future. Ora implementare solo locale.

---

## Struttura Cartelle (Non Nascosta)

```
~/Documenti/AuraWrite/
├── projects/
│   └── IlMioLibro/
│       ├── .aurawrite/
│       │   ├── db.sqlite
│       │   └── versions/           -- backup versioni
│       │       ├── doc1_v1.json
│       │       └── doc1_v2.json
│       ├── chapters/
│       │   └── capitolo1.json
│       ├── characters/
│       │   └── personaggi.json
│       └── IlMioLibro.auraproj    -- file progetto
├── aura_settings.json              -- configurazione globale
└── aura.db                         -- database globale (settings, projects list)
```

---

## SQL vs Vector DB

### Quando SQL:

- Relazioni esatte e cronologiche
- Query precise su struttura
- Publishing (capitolo → ebook)

### Quando Vector DB:

- Ricerca semantica ("trova passaggi simili a...")
- Suggerimenti AI basati su similarità

### Il Problema del Vector DB (Rilevato):

> Non riesce a restituire sequenze cronologiche precise.

**Soluzione ibrida:**

1. SQL per struttura e cronologia
2. Vector DB per ricerche semantiche
3. AI chiede prima a SQL per dati esatti, poi a Vector per similarità

---

## Prossimi Passi Implementativi

### Fase A: Database Base (SQLite)

1. Schema core: projects, sections, documents
2. CRUD base per progetti e documenti
3. Connessione toolbar → database

### Fase B: Versioni/Incremental Save

1. Tabella versions con backup_path
2. Salvataggio versioni automatico
3. UI per visualizzare/recoverare versioni

### Fase C: Entità Base

1. Schema entities, entity_types
2. Poche entità predefinite: Personaggio, Luogo, Oggetto
3. Linking manuale documento ↔ entità

### Fase D: AI Linking

1. Integrazione prompt strutturato
2. Riconoscimento automatico menzioni
3. Suggerimento link

### Fase E: Board/Timeline

1. Tabella board_items
2. UI kanban
3. Timeline view

### Fase F: Publishing

1. Tabella publishing_metadata
2. Export EPUB base
3. Template formattazione

### Fase G: Estensioni

1. Tags globali
2. Search full-text
3. Attachments
4. Entity types personalizzati

### Fase H: Sync (Futuro)

1. Architettura sync
2. Conflict resolution
3. Cloud provider integration

---

## Decisioni Prese

- [x] Approccio 2 (complesso) adottato
- [x] Cartella NON nascosta
- [x] Schema ibrido SQL + Vector DB
- [x] SQL per relazioni esatte e cronologia
- [x] Vector per ricerche semantiche AI
- [x] Gerarchie personalizzabili per casi specifici
- [x] AI per linking automatico con prompt strutturati
- [x] Publishing con metadati EPUB e template
- [x] Sync multi-dispositivo - prendere nota per futuro
- [x] Backup versioni su file esterno (backup_path)
- [x] Tags globali, search, attachments inclusi

---

## Domande Aperte (per ora risolte mentalmente, da confermare)

1. ~~Quanto è complessa la struttura immaginata?~~ → Complessa, include tutto
2. ~~Partire con solo SQL?~~ → Sì, Vector DB in fase successiva
3. ~~EPUB come formato?~~ → Sì, standard per publishing
