# AI Assistant Panel — Specifica

**Ultimo aggiornamento:** 2026-04-07

---

## Concept

AI Assistant è un **agente conversazionale**. L'utente chatta, l'agente risponde. Quando l'utente chiede esplicitamente di modificare, l'agente modifica.

**Non servono pulsanti "Apply" o formule magiche.**

---

## Scenari

### Scenario 1: Nessuna Selezione (Documento Intero)

1. Utente apre AI Assistant (✨)
2. Chatta con Aura
3. Quando chiede di modificare, Aura modifica
4. Il replace avviene su tutto il documento o sulla porzione indicata

**Vincolo:** Aura può modificare tutto il testo.

### Scenario 2: Con Selezione (Porzione Specifica)

1. Utente seleziona testo
2. Appare badge "Selected: '...'" nel pannello
3. Aura sa che può modificare SOLO quella porzione
4. Utente può chiedere qualsiasi cosa sulla selezione

**Vincolo:** Aura può modificare SOLO la porzione selezionata.

---

## AURA_EDIT System

### Formato

```json
{
  "aura_edit": {
    "message": "Spiegazione per l'utente",
    "operations": [
      { "op": "replace", "find": "testo vecchio", "content": [{"type": "text", "text": "nuovo"}] },
      { "op": "format", "find": "testo", "addMark": "bold" },
      { "op": "insert", "find": "dopo questo", "position": "after", "content": [...] },
      { "op": "delete", "find": "testo da rimuovere" }
    ]
  }
}
```

### Operazioni Supportate

| Operazione | Descrizione |
|------------|-------------|
| `replace` | Sostituisce testo trovato |
| `format` | Aggiunge mark (bold, italic, underline) |
| `insert` | Inserisce testo (before/after) |
| `delete` | Rimuove testo trovato |

### Parser (3 strategie)

1. **Delimitatore**: `<<<AURA_EDIT>>>...<<<END_AURA_EDIT>>>`
2. **Markdown**: code block ` ```json...``` `
3. **Chiave**: ricerca `{"aura_edit": ...}`

---

## Chunk System

Per documenti lunghi, il testo viene diviso in chunks.

**Default:** ~8000 tokens per chunk

**Struttura:**
```typescript
interface Chunk {
  id: string           // "Titolo-chunk_001"
  title: string
  content: string
  startOffset: number
  endOffset: number
}
```

**UI:** Selector nel pannello per scegliere chunk.

**Attenzione:** Gli offset sono in caratteri, non posizioni ProseMirror. Da convertire per decorations.

---

## File

| File | Responsabilità |
|------|----------------|
| `src/ai-panel/chat.ts` | UI, gestione chat |
| `src/ai-panel/operations.ts` | Tipi AURA_EDIT |
| `src/ai-panel/edit-parser.ts` | Parser JSON |
| `src/ai-panel/edit-executor.ts` | Esecuzione operazioni |
| `src/ai-panel/modification-hub.ts` | Sincronizzazione con Suggestions |

---

## Modifiche Documento

```typescript
// 1. Parse risposta AI
const result = parseAuraEdit(response.content)
if (!result || !hasValidOperations(result)) {
  // Mostra come testo normale
  return
}

// 2. Esegui operazioni
const applied = applyAuraEdit(result, editorView, currentSelection)

// 3. Notifica altri pannelli
notifyDocumentChange({from, oldLen, newLen}, "ai_assistant")
```

---

## Integrazione con Suggestions

Entrambi i pannelli possono modificare il documento. Il **modification hub** sincronizza le posizioni:

```typescript
// AI Assistant modifica
notifyDocumentChange(change, "ai_assistant")

// Suggestions riceve e aggiorna posizioni
subscribeToChanges("suggestions", (change, source) => {
  if (source === "ai_assistant") {
    updateSlotPositions(change)
  }
})
```

---

## Provider AI

| Provider | Tipo | Note |
|----------|------|------|
| Ollama | Locale | Gratuito, richiede hardware |
| OpenAI | API | API key necessaria |
| Anthropic | API | API key necessaria |

**Modelli testati:**
- kimi-k2.5:cloud — Lento (reasoning), capisce AURA_EDIT
- glm-5:cloud — Veloce, buono per chat

---

## Selezione Testo Dinamica

### Comportamento

1. Quando il pannello AI Assistant è aperto
2. E l'utente clicca nel box di input della chat
3. Il testo selezionato nel documento viene evidenziato
4. L'AI riceve la selezione corrente nel context

### Implementazione

```typescript
// Event listener sull'input
aiInput?.addEventListener('focus', () => {
  const selection = getSelectionRange(view)
  if (selection) {
    currentSelection = selection
    applySelectionHighlight(view, selection)
  }
})

// Event listener sulla selezione (mentre il pannello è aperto)
view.dom.addEventListener('mouseup', () => {
  if (!isPanelOpen) return
  const selection = getSelectionRange(view)
  if (selection) {
    currentSelection = selection
    applySelectionHighlight(view, selection)
    updateContextDisplay()
  }
})
```

### Context Display

Mostra sempre:
- **Selected:** il testo selezionato (se presente)
- **Chunk:** il chunk selezionato (se documento lungo)

### Vincoli Modifica

| Scenario | Vincolo |
|----------|--------|
| Nessuna selezione | AI può modificare tutto il documento |
| Con selezione | AI può modificare SOLO la porzione selezionata |

---

## Future

- **Document as AI Role Prompt**: salvare documento come prompt di sistema
- **Language Selector**: scegliere lingua risposte
- **Tooltip plugin**: context menu su selezione

---

*Aggiornato da Aura — 2026-04-08*