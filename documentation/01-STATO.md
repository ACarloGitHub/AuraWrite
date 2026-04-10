# AuraWrite — Stato Attuale

**Ultimo aggiornamento:** 2026-04-08

---

## Funzionalità Completate

### Core Editor
- Editor ProseMirror funzionante
- File operations: Save, Save As, Open, Export (JSON, MD, TXT, HTML, DOCX)
- Title bar con nome documento e dirty indicator
- Theme toggle (light/dark)

### AI Infrastructure
- Provider interface: Ollama, OpenAI, Anthropic
- AI Manager per gestire chiamate
- Settings per privacy e provider

### Suggestions Panel (SX)
- Trigger su "." seguito da spazio
- Logica trigger: solo se punto preceduto da lettera
- UI espandibile/collassabile
- Pulsanti: Accept, Reject, Switch, Close
- Gestione punteggiatura (no duplicati)
- **FIXATO**: Bug spazi mangiati con sistema `docFrom`/`docTo`

### AI Assistant Panel (DX)
- [x] Chat con AI
- [x] Testo documento passato come contesto
- [x] **Selezione testo dinamica**: evidenziata quando si clicca nell'input
- [x] **Pulsante ✕ per deselezionare** manualmente
- [x] **Opzione nelle preferenze**: "Clear selection on document click" (default: attivo)
- [x] **NO deselezione automatica** dopo modifica AI (utente può iterare)
- [ ] **Cronologia modifiche**: mark persistenti, database SQLite (post-DB)
- Chunk system per documenti lunghi
- AURA_EDIT system per modifiche documento
- Formattazione supportata (bold, italic, liste)
- **Tool Calling** (documentato in [[feature/database.md]])

### Database SQLite — Phase A.2 COMPLETATO
- [x] Backend Rust con rusqlite — CRUD completo
- [x] Frontend TypeScript client (`db.ts`)
- [x] Schema: projects, sections, documents, entities, entity_types
- [x] **ProjectPanel UI** — sidebar con gerarchia Project → Section → Document
- [x] **Salvataggio documento** — Save button collegato al database
- [x] **Caricamento documento** — clicca documento, carica contenuto nell'editor
- [x] **Dirty tracking** — `hasUnsavedChanges`, conferma cambio progetto
- [x] **Notifiche** — toast "Document saved!" / "Failed to save"

**File database:** `~/.config/aurawrite/aurawrite.db`

**Commit:** `8c2b912` — ProjectPanel: UI fixes, save/load functionality, dirty tracking, notifications

### AURA_EDIT System
- Parser robusto con 3 strategie
- Operazioni: replace, insert, delete, format
- Supporta testo formattato
- File: `operations.ts`, `edit-parser.ts`, `edit-executor.ts`

---

## Bug Notevoli (Risolti)

### Suggestions — Posizioni obsolete
- **Problema**: `doc.textContent.indexOf()` dà posizioni sbagliate
- **Soluzione**: Usare `nodesBetween` per posizioni ProseMirror
- **File**: `suggestions-panel.ts`

### AI Assistant — JSON insufficiente
- **Problema**: Formato `{original, new}` limitato
- **Soluzione**: Sistema AURA_EDIT con operazioni multiple

---

## Bug Aperti

### Suggestions
- [ ] Discard lento (dipende dal modello AI — non è bug del codice)

### Title Bar
- [ ] Estensione duplicata nel nome file
- [ ] Font/stile da migliorare

---

## Tecnologia

| Componente | Tecnologia |
|------------|------------|
| Editor | ProseMirror |
| Desktop | Tauri |
| Language | TypeScript |
| AI Provider | Ollama, OpenAI, Anthropic |

---

## File Principali

```
src/
├── editor/
│   ├── editor.ts          # Editor principale
│   ├── text-utils.ts      # Utility testo
│   └── suggestions-marker-plugin.ts  # (da creare)
├── ai-panel/
│   ├── chat.ts            # AI Assistant panel
│   ├── suggestions-panel.ts  # Suggestions panel
│   ├── operations.ts      # Tipi AURA_EDIT
│   ├── edit-parser.ts     # Parser AURA_EDIT
│   ├── edit-executor.ts   # Esecuzione operazioni
│   └── modification-hub.ts # Bus sincronizzazione
└── formats/               # Convertitori formato
```

---

## Modelli AI Testati

| Modello | Velocità | Note |
|---------|----------|------|
| kimi-k2.5:cloud | Lento (reasoning) | 30-60s per frase, capisce AURA_EDIT |
| glm-5:cloud | Veloce | Buono per chat |
| Modelli locali Ollama | Variabile | Dipende dall'hardware |

---

## Prossima Sessione

1. Leggi [[02-TODO.md]] per task prioritari
2. Per pagination: vedi [[feature/pagination.md]]
3. Per bugs: vedi [[04-LEZIONI.md]] per pattern corretti

---

*Aggiornato da Aura — 2026-04-10*

**Ultimo commit:** `8c2b912` — ProjectPanel: UI fixes, save/load functionality, dirty tracking, notifications