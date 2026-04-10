# Riferimento Tecnico: Vector Database con Tauri

**Fonte:** [Offline Vector Database with Tauri - Ryosuke](https://whoisryosuke.com/blog/2025/offline-vector-database-with-tauri)  
**Data:** 9 Aprile 2026  
**Rilevanza per AuraWrite:** ⭐⭐⭐⭐⭐ (Alta)

---

## TL;DR

Articolo che descrive implementazione completa di SQLite come **vector database** in Tauri. Include: Tauri + SQLite + `sqlite-vec` + `rusqlite` + Drizzle ORM per migrazioni. Use case molto simile a AuraWrite (app AI-powered per documenti con RAG).

---

## Stack Tecnologico

| Componente | Scopo | Perché usato |
|------------|-------|--------------|
| **Tauri** | Framework cross-platform | App ibrida Rust + web tech |
| **SQLite** | Database locale | Persistenza file-based (.db) |
| **sqlite-vec** | Estensione vector per SQLite | Store/query vettori embeddings |
| **rusqlite** | Crate Rust per SQLite | Supporta nativamente sqlite-vec |
| **Drizzle ORM** | Gestione migrazioni | Genera file SQL automaticamente |

---

## Architettura Database

### Tabelle create da sqlite-vec

```sql
-- Tabella VIRTUALE (non contiene dati diretti)
CREATE VIRTUAL TABLE embeddings USING vec0(embedding float[1024])
```

sqlite-vec crea automaticamente:

1. `embeddings` — tabella virtuale per query
2. `embeddings_vector_chunks` — **BLOBs** con i vettori
3. `embeddings_chunks` — metadata (dimensioni, chunk IDs)
4. `embeddings_rowids` — mapping item → chunk

### ⚠️ Limitazione Critica

La tabella virtuale **non supporta**:
- Foreign keys
- NOT NULL constraints
- Proprietà custom dirette

**Soluzione:** Tabella separata `embeddings_metadata` per relazioni e metadati.

---

## Query Vector Search

```sql
SELECT rowid, distance
FROM embeddings
WHERE embedding MATCH :embedding_data  -- embedding come bytecode
ORDER BY distance
LIMIT 3
```

**Distanze supportate:**
- Cosine similarity (default)
- Euclidean distance (L2)

---

## Workflow Embeddings (dal documento)

```
PDF → Estrazione testo → Chunking (by token) → 
OpenAI API (/v1/embeddings) → Array float → 
Salvataggio come BLOB in SQLite
```

### Chunking Strategy

```typescript
// Limite: ~400 caratteri minimo per ricerca affidabile
// Calcolo token per chunk
if (tokenCount > MAX_TEXT_LENGTH) {
    dataset.push(currentItem);
    currentItem = "";
}
```

---

## Setup Tauri + rusqlite

### 1. Inizializzazione sqlite-vec

```rust
// Prima di creare la connessione!
unsafe {
    sqlite3_auto_extension(Some(
        std::mem::transmute(sqlite3_vec_init as *const ())
    ));
}
```

### 2. State Management (condivisione DB)

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_sqlite_extensions();  // Prima del builder

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path()
                .app_local_data_dir()
                .expect("Couldn't get app directory");

            let db = Database::new(&app_data_dir)?;
            db.run_migrations(&app_data_dir);

            // Salva nello state per accesso globale
            app.manage(Mutex::new(DatabaseState { database: db }));
            Ok(())
        })
}
```

### 3. Accesso DB dai comandi

```rust
#[tauri::command]
pub fn query_embeddings(
    state: State<'_, Mutex<DatabaseState>>,
    query: Vec<f32>
) -> Vec<(i64, f64)> {
    let mut state = state.lock().unwrap();
    state.database.query_embeddings(query)
}
```

---

## Drizzle ORM per Migrazioni

### Flusso di lavoro

1. Definisci schema in TypeScript
2. Drizzle genera file SQL numerati: `0001_init.sql`, `0002_add_index.sql`
3. Carica da Rust e applica in ordine

### Tracking migrazioni

```rust
// File: migration.txt nella cartella app
// Contiene nome ultima migrazione eseguita
// Filtra ed esegue solo quelle nuove
```

---

## Decisioni di Design Interessanti

### ✅ Cosa hanno fatto bene:

1. **Data models modulari** — funzioni separate per ogni entità (documents.rs)
2. **Custom error types** — enum `DatabaseError` con `Display` trait
3. **SQL in file separati** — include_str!("../sql/documents/store.sql")
4. **State management Tauri** — Mutex per thread-safety
5. **Migrazioni con tracking** — file `migration.txt` semplice ed efficace

### ❌ Cosa hanno evitato:

- ORM Rust (Diesel) — troppo complesso per sqlite-vec
- Tauri SQL plugin — non supporta estensioni
- LocalStorage per dati — limitato a 5MB, ricerca JS lenta

---

## Relevanza per AuraWrite

### ✅ Allineati:

- Tauri + SQLite + Rust backend
- Vector search per documenti
- Chunking testo per embeddings
- RAG con LLM locale/API

### 🤔 Da considerare:

| Aspetto | Approccio articolo | Il nostro |
|---------|-------------------|-----------|
| ORM | Drizzle (JS) per migrazioni | Manuale Rust? |
| Vector DB | sqlite-vec | Ancora da decidere |
| Chunking | By token | By frasi/capitoli? |
| Embeddings | Ollama/OpenAI API | Ollama locale |

---

## Domande Aperte

1. **sqlite-vec vs VectorDB separato?** sqlite-vec è tutto in SQLite, più semplice, ma `sqlite-vec` richiede caricamento estensione C.

2. **Migrazioni:** Usiamo Drizzle (richiede setup JS) o facciamo tutto in Rust con script custom?

3. **Chunking:** Token-based (come articolo) o frase/capitolo (più semantico per scrittura)?

4. **Foreign keys:** sqlite-vec non li supporta nella tabella virtuale — design alternativo per relazioni?

---

## Link Utili

- Articolo originale: https://whoisryosuke.com/blog/2025/offline-vector-database-with-tauri
- sqlite-vec: https://github.com/asg017/sqlite-vec
- rusqlite: https://github.com/rusqlite/rusqlite
- Drizzle ORM: https://orm.drizzle.team/

---

*Salvato da Aura il 9 Aprile 2026 — durante test Ollama web search*