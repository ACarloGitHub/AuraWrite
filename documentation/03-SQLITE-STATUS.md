# AuraWrite — Stato Implementazione SQLite
**Data:** 2026-04-10
**Sessione:** Phase A.2 UI Integration COMPLETATO

---

## ✅ Completato (2026-04-10)

### Phase A.2: UI Integration

| Componente | Stato |
|------------|-------|
| `project-panel.ts` | ✅ **UI completa** — Project, Section, Document gerarchici |
| `project-panel.ts` | ✅ **Salvataggio** — Save collegato a `updateDocument` |
| `project-panel.ts` | ✅ **Caricamento** — Clicca documento, carica JSON nell'editor |
| `main.ts` | ✅ **Dirty tracking** — `hasUnsavedChanges`, conferma cambio progetto |
| `project-panel.ts` | ✅ **Notifiche** — toast "Document saved!" |
| `styles.css` | ✅ **Stili gerarchici** — Projects prominent, elementi indentati |

**Comportamenti implementati:**
- Save → Salva documento corrente nel database
- Open → Torna alla lista progetti
- Nuovo progetto con modifiche → Chiede conferma "Vuoi salvare?"
- Clicca documento → Carica contenuto nell'editor
- Pulsanti + Sec / + Doc inline su ogni elemento

**Commit:** `8c2b912`

---

## ✅ Completato Oggi

### Backend Rust (Tauri)

| File | Stato |
|------|-------|
| `database.rs` | ✅ **Tipi Rust** (Project, Section, Document, Entity, EntityType) |
| `database.rs` | ✅ **CRUD completo** - create/read/update/delete per tutte le entità |
| `lib.rs` | ✅ **Comandi Tauri esposti** - tutti i comandi registrati in `invoke_handler` |
| `lib.rs` | ✅ **State management** - `AppState` con `Mutex<Connection>` |
| `Cargo.toml` | ✅ Già configurato con `rusqlite` + `dirs` |

**Comandi Tauri disponibili:**
- `db_create_project`, `db_get_projects`, `db_get_project`, `db_update_project`, `db_delete_project`
- `db_create_section`, `db_get_sections`, `db_update_section`, `db_delete_section`
- `db_create_document`, `db_get_documents`, `db_get_document`, `db_update_document`, `db_delete_document`
- `db_create_entity`, `db_get_entities`, `db_update_entity`, `db_delete_entity`
- `db_create_entity_type`, `db_get_entity_types`, `db_delete_entity_type`

### Frontend TypeScript

| File | Stato |
|------|-------|
| `src/types/database.ts` | ✅ **Interfacce TypeScript** per tutte le entità |
| `src/types/database.ts` | ✅ **Helper functions** - `createProject()`, `createSection()`, `createDocument()`, `generateId()` |
| `src/types/database.ts` | ✅ **Default entity types** - Personaggio, Luogo, Oggetto per romanzi |
| `src/database/db.ts` | ✅ **Client DB** - wrapper `invoke()` per tutti i comandi |
| `src/database/db.ts` | ✅ **Convenience helpers** - `createProjectWithDefaults()`, `createSectionWithDocument()` |

---

## 📋 Schema Database Implementato

Tutte le tabelle dello schema completo (da `documentation/feature/database.md`):

- `projects` - ✅ CRUD completo
- `sections` - ✅ CRUD completo (gerarchia con `parent_id`)
- `documents` - ✅ CRUD completo
- `entities` - ✅ CRUD completo
- `entity_types` - ✅ CRUD completo
- `links` - Schema presente, CRUD non ancora implementato
- `versions` - Schema presente, CRUD non ancora implementato
- `events` - Schema presente, CRUD non ancora implementato
- `board_items` - Schema presente, CRUD non ancora implementato
- `tags`, `document_tags` - Schema presente, CRUD non ancora implementato
- `search_index` - Schema presente, CRUD non ancora implementato
- `attachments` - Schema presente, CRUD non ancora implementato
- `project_settings`, `publishing_metadata` - Schema presente, CRUD non ancora implementato

---

## 🔧 Da Fare (Prossima Sessione)

### ⚠️ Fix veloce (1 minuto)
- [ ] Rimuovere `DbState` warning in `database.rs` (struct non usata)

### Phase A.2: UI Integration
- [ ] Creare `ProjectPanel` component (sidebar per progetti/sezioni/documenti)
- [ ] Integrare `db.ts` in `main.ts` - inizializzazione e gestione stato
- [ ] Aggiungere "New Project" / "Open Project" nella toolbar
- [ ] Implementare switch documento da database (vs file system corrente)

### Phase A.3: Testing
- [ ] Test creazione progetto con default entity types
- [ ] Test gerarchia sezioni (book → part → chapter)
- [ ] Test salvataggio documento con contenuto ProseMirror
- [ ] Performance test con documento 50k+ parole

### Phase B: Versioni
- [ ] Implementare `save_version()` - backup del documento
- [ ] Tabella `versions` con `backup_path` per file esterni
- [ ] UI per visualizzare/recuperare versioni

### Phase C: Entity Linking
- [ ] Implementare ricerca entità nel testo (menzioni)
- [ ] Popup "Crea link?" quando si digita nome entità
- [ ] Visualizzazione link nel documento (decoration ProseMirror)

### Phase D: Tool Calling per AI
- [ ] Tools SQL di sola lettura per query AI
- [ ] Integrazione con AI Assistant panel
- [ ] Toggle "Agent Mode: Advanced/Basic" nelle preferenze

---

## 📁 File Modificati/Creati

```
src-tauri/
├── src/
│   ├── database.rs       ✅ (aggiornato - tipi + CRUD)
│   └── lib.rs            ✅ (aggiornato - comandi + state)
└── Cargo.toml            ✅ (già ok)

src/
├── types/
│   └── database.ts       ✅ (creato - interfacce + helpers)
├── database/
│   └── db.ts             ✅ (creato - client Tauri)
└── main.ts               ⏳ (da integrare)
```

---

## 🚀 Build Test

Prima di continuare con l'UI, testare il build:

```bash
cd /home/carlo/progetti/AuraWrite/Cartella_di_Sviluppo
cargo build --release
# Se ok → npm run build
```

---

## 🔄 Alternative Future (Non Implementate)

### sqlite-vec: SQLite come Vector Database

**Riferimento:** [Offline Vector Database with Tauri](https://whoisryosuke.com/blog/2025/offline-vector-database-with-tauri) di Ryosuke (Nov 2025)

**Cosa fa:** Estensione C per SQLite che aggiunge supporto vector embedding. Permette ricerca semantica (cosine similarity, L2) direttamente nel database SQLite esistente.

**Vantaggi:**
- Un solo file .db per dati strutturati E embedding
- Offline, locale, efficiente
- Supportato da Mozilla (sqlite-vec)

**Limitazioni:**
- Non supporta foreign keys nelle tabelle virtuali
- Richiede rusqlite (non il plugin SQL Tauri ufficiale)
- Richiede sqlite3_auto_extension() per caricare l'estensione C

**Per Karpathy Approach:**
**Riferimento:** [Andrej Karpathy - Building Personal Knowledge Base](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

Karpathy propone: Markdown + link ipertestuali + AI per costruire "cervello digitale". Approccio alternativo al database SQL: file MD organizzati automaticamente.

**Confronto approcci:**

**Il nostro metodo (SQLite strutturato):**
- Progetti, sezioni, documenti in tabelle relazionali
- CRUD preciso, transazioni ACID
- Query SQL per struttura gerarchica

**Metodo Karpathy (Markdown + link):**
- Tutto in file MD con link [[wiki]]
- Grafo delle idee, visualizzazione connessioni
- Portabile, future-proof, niente dipendenze

**Decisione attuale:**
Proseguiamo con il database SQLite strutturato. Valutiamo sqlite-vec e/o approccio Karpathy dopo aver testato a fondo la nostra implementazione.

---

## Note Tecniche

**Mutex<Connection>:** Il pattern standard Tauri per SQLite. La connessione è thread-safe tramite Mutex.

**ID Generation:** `generateId()` usa timestamp + random - sufficiente per uso single-user locale.

**Error Handling:** Tutte le funzioni Rust ritornano `Result<T, String>` per compatibilità Tauri. Errori SQLite mappati a stringhe.

**JSON Content:** `content_json` nei documenti è stringa JSON - parsing in TypeScript con `JSON.parse()`.

---

*Documentato da Aura - 2026-04-08*
