# AuraWrite — Architettura

**Ultimo aggiornamento:** 2026-04-07

---

## Struttura Cartelle

```
aurawrite/
├── src/
│   ├── editor/
│   │   ├── editor.ts              # Editor ProseMirror principale
│   │   ├── schema.ts              # Schema ProseMirror (paragraph, heading, etc.)
│   │   ├── text-utils.ts          # Utility per ricerca testo
│   │   └── toolbar.ts             # Toolbar e file operations
│   │
│   ├── ai-panel/
│   │   ├── chat.ts                # AI Assistant panel (destra)
│   │   ├── suggestions-panel.ts    # Suggestions panel (sinistra)
│   │   ├── operations.ts          # Tipi AURA_EDIT
│   │   ├── edit-parser.ts         # Parser AURA_EDIT
│   │   ├── edit-executor.ts       # Esecuzione operazioni
│   │   ├── modification-hub.ts     # Bus eventi sincronizzazione
│   │   ├── ai-manager.ts          # Gestione provider AI
│   │   ├── providers.ts           # Interface provider
│   │   ├── ollama-provider.ts     # Provider locale
│   │   └── remote-providers.ts    # OpenAI, Anthropic
│   │
│   ├── formats/
│   │   ├── json.ts                # ProseMirror JSON
│   │   ├── markdown.ts            # Markdown
│   │   ├── html.ts                # HTML
│   │   └── docx.ts                # Word DOCX
│   │
│   └── styles/
│       └── main.css               # Stili (tema chiaro/scuro)
│
├── src-tauri/
│   ├── src/lib.rs                 # Comandi Rust (file I/O)
│   └── tauri.conf.json            # Config Tauri
│
├── documentation/                  ← Questa cartella
│
├── AGENTS.md                      # Istruzioni per agenti AI
├── START_HERE.md                 # Quick start
└── README.md                     # Descrizione progetto
```

---

## Componenti Principali

### Editor (ProseMirror)

**File:** `src/editor/editor.ts`

```typescript
// Schema principale
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", attrs: { pageBreakBefore: { default: false } } },
    heading: { content: "inline*", attrs: { level: { default: 1 } } },
    text: { inline: true }
  },
  marks: {
    strong: {},    // bold
    em: {},        // italic
    underline: {}
  }
})
```

**State management:**
- `EditorState` con history plugin
- `EditorView` con dispatchTransaction

---

### AI Panel (Sinistra — Suggestions)

**File:** `src/ai-panel/suggestions-panel.ts`

**Funzionamento:**
1. Trigger su `.` seguito da spazio
2. Analizza frase con AI
3. Mostra suggerimento in UI espandibile
4. Pulsanti: Accept, Reject, Switch, Close

**Sistema posizioni:**
```typescript
interface SentenceSlot {
  id: string
  text: string
  state: "pending" | "processing" | "suggested" | "accepted" | "closed"
  suggestion: string | null
  reason: string | null
  docFrom: number  // Posizione ProseMirror INIZIO
  docTo: number    // Posizione ProseMirror FINE
}
```

**Pattern corretto:**
```typescript
// MAI usare textContent.indexOf()
// SEMPRE usare nodesBetween per trovare posizioni
doc.nodesBetween(0, doc.content.size, (node, pos) => {
  if (node.isText && node.text) {
    // pos è la posizione ProseMirror corretta
  }
})
```

---

### AI Panel (Destra — Assistant)

**File:** `src/ai-panel/chat.ts`

**Funzionamento:**
1. Chat conversazionale con AI
2. Passa contesto documento (o chunk selezionato)
3. Risponde in chat o modifica documento con AURA_EDIT

**Sistema AURA_EDIT:**
```json
{
  "aura_edit": {
    "message": "Spiegazione",
    "operations": [
      { "op": "replace", "find": "testo vecchio", "content": [{"type": "text", "text": "nuovo"}] },
      { "op": "format", "find": "testo", "addMark": "bold" },
      { "op": "insert", "find": "dopo", "position": "after", "content": [...] },
      { "op": "delete", "find": "testo" }
    ]
  }
}
```

**Parser:** `edit-parser.ts` con 3 strategie:
1. Delimitatore `<<<AURA_EDIT>>>...<<<END_AURA_EDIT>>>`
2. Markdown code block
3. Ricerca chiave `{"aura_edit": ...}`

---

### Modification Hub

**File:** `src/ai-panel/modification-hub.ts`

**Scopo:** Sincronizzare posizioni quando più pannelli modificano il documento.

```typescript
type Source = "suggestions" | "ai_assistant" | "external"

export function subscribeToChanges(id: string, listener: ChangeListener): () => void
export function notifyDocumentChange(change: {from, oldLen, newLen}, source: Source): void
```

**Regola:** Ogni pannello chiama `notifyDocumentChange` dopo una modifica. Gli altri pannelli ricevono la notifica e aggiornano le posizioni.

---

## Pattern Importanti

### 1. Mai fidarsi di indici su stringhe

```typescript
// SBAGLIATO
const index = doc.textContent.indexOf(text)

// CORRETTO
doc.nodesBetween(0, doc.content.size, (node, pos) => {
  if (node.isText && node.text?.includes(text)) {
    // usa pos
  }
})
```

### 2. Aggiornare posizioni dopo modifiche

```typescript
// Dopo un replace
tr = state.tr.replaceWith(from, to, newContent)
dispatch(tr)

// Aggiornare le posizioni salvate
slotPositions.get(id).to = from + newLength
```

### 3. Validare posizioni memorizzate

```typescript
// Prima di usare una posizione salvata
const livePos = findTextInDoc(view, expectedText)
if (!livePos || livePos.from !== savedFrom) {
  // Ricalcola o annulla
}
```

---

## Dipendenze

| Package | Versione | Uso |
|---------|----------|-----|
| prosemirror-state | ^1.4 | Editor state |
| prosemirror-view | ^1.33 | Editor view |
| prosemirror-model | ^1.19 | Document model |
| @tauri-apps/api | ^2.0 | Desktop API |

---

## Build

```bash
npm install          # Installa dipendenze
npm run tauri dev    # Sviluppo
npm run tauri build  # Produzione
```

---

*Aggiornato da Aura — 2026-04-07*