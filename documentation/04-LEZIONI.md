# AuraWrite — Lezioni Apprese

**Ultimo aggiornamento:** 2026-04-23

---

## Lezioni Principali

### 1. Posizioni ProseMirror vs Indici Stringa

**Errore:** Usare `textContent.indexOf()` per trovare testo nel documento.

**Problema:** ProseMirror usa posizioni basate su nodi, non indici carattere. Con formattazione, paragrafi multipli, o liste, gli indici sono sbagliati.

**Soluzione:**
```typescript
// SBAGLIATO
const idx = doc.textContent.indexOf(text)

// CORRETTO
doc.nodesBetween(0, doc.content.size, (node, pos) => {
  if (node.isText && node.text) {
    const idx = node.text.indexOf(text)
    if (idx !== -1) {
      foundPos = pos + idx  // pos è la posizione ProseMirror corretta
    }
  }
})
```

**File coinvolti:** `suggestions-panel.ts`, `chat.ts`, `text-utils.ts`

---

### 2. Aggiornare lo Stato dopo Modifiche

**Errore:** Non aggiornare le posizioni salvate dopo un `replace`.

**Problema:** Dopo `dispatch(tr)`, le posizioni `from`/`to` salvate diventano obsolete.

**Soluzione:**
```typescript
// Dopo ogni modifica
dispatch(tr)
slotPositions.get(id).to = from + newLength
slotPositions.get(id).original = newText
```

**Nota:** In JavaScript, `Map.get(id)` restituisce un riferimento all'oggetto. Modificare le proprietà aggiorna direttamente la Map senza bisogno di `set()`.

---

### 3. Validazione Difensiva

**Pattern:**
```typescript
// Prima di usare una posizione salvata
if (!validatePosition(id)) {
  const livePos = findTextInDoc(view, expectedText)
  if (livePos) {
    slotPositions.get(id).from = livePos.from
    slotPositions.get(id).to = livePos.to
  }
}
```

**Quando:** Sempre, prima di Accept/Switch/Replace.

---

### 4. Plugin di Paginazione e Schema Invasivo

**Errore:** Tentare di integrare plugin di paginazione che modificano lo schema.

**Plugin testati:** prosemirror-pagination, Lexical, TipTap

**Problema:** Tutti richiedono schema con nodi `page`, `body`, etc. Una volta integrato, non è possibile tornare alla visualizzazione continua senza perdere dati.

**Soluzione corretta:**
- Mantenere schema semplice (formato continuo)
- Calcolare break visivamente con decorations
- Esportare in formato paginato solo all'export (Paged.js)

**Documentazione:** `feature/pagination.md`

---

### 5. JSON Insufficiente per Modifiche Complesse

**Errore:** Formato `{original, new}` per modifiche AI.

**Problema:** Non supporta formattazione (bold, italic), elementi strutturati (liste, heading), o operazioni multiple.

**Soluzione:** Sistema AURA_EDIT con operazioni:
```json
{
  "aura_edit": {
    "operations": [
      { "op": "replace", "find": "x", "content": [...] },
      { "op": "format", "find": "x", "addMark": "bold" },
      { "op": "insert", "find": "x", "position": "after", "content": [...] },
      { "op": "delete", "find": "x" }
    ]
  }
}
```

**File:** `operations.ts`, `edit-parser.ts`, `edit-executor.ts`

---

### 6. Modelli AI con Reasoning sono Lenti

**Problema:** Kimi-k2.5:cloud può impiegare 30-60 secondi per frase (reasoning interno).

**Soluzione:**
- Per chat veloce: usare modelli senza reasoning
- Per modifiche documento: usare AURA_EDIT (più strutturato)
- Avvertire utente se contesto vicino al limite

---

## Bug Risolti

### Accept/Switch mangiava spazi (MITIGATO, non risolto)

**Sintomi:** Punti doppi, a-capo scomparsi, testo corrotto. Dopo correzioni con segnaposto precisi il problema e' molto mitigato, ma con testo lungo si ripresenta in alcuni frangenti.

**Root cause:**
1. Posizioni calcolate su `textContent` invece che su ProseMirror
2. `slotPositions` non aggiornato dopo modifica
3. `updatePositionsAfterChange` aggiornava solo gli ALTRI slot
4. Pattern a due transazioni (replace + decoration update) — le posizioni nella seconda transazione possono driftare su documenti lunghi

**Stato:** Molto mitigato grazie ai segnaposto precisi. Il problema residuo con testo lungo e' difficile da riprodurre e richiede test specifici con documenti lunghi multi-pagina.

**Da investigare:** Il pattern a due transazioni in `acceptSuggestion()` e `switchSuggestion()` potrebbe essere la causa residua. Valutare l'uso di una singola transazione con meta per entrambe le operazioni.

---

### Chat bloccata al secondo messaggio

**Problema:** AI Assistant non rispondeva dopo il primo messaggio.

**Root cause:** Stato non resettato tra messaggi.

**Soluzione:** Pulire stato nel handler del primo messaggio completato.

---

### JSON malformato da AI

**Problema:** A volte l'AI fornisce `original: ""` o JSON incompleto.

**Soluzione:** Parser robusto con 3 strategie (delimitatore, markdown, chiave) e validazione.

---

## Pattern Corretti

### Per Modifiche Documento

```typescript
// 1. Calcolare posizioni con nodesBetween
const livePos = findTextInDoc(editorView, textToReplace)

// 2. Validare posizione
if (!livePos) {
  log("ERROR: Text not found")
  return
}

// 3. Applicare replace
const tr = editorView.state.tr.replaceWith(
  livePos.from,
  livePos.to,
  editorView.state.schema.text(newText)
)
editorView.dispatch(tr)

// 4. Aggiornare posizioni
slotPositions.get(id).to = livePos.from + newText.length
slotPositions.get(id).original = newText

// 5. Notificare altri pannelli
notifyDocumentChange({from: livePos.from, oldLen, newLen}, "ai_assistant")
```

### Per Ricerca Testo

```typescript
export function findTextInDoc(view: EditorView, text: string): {from: number, to: number} | null {
  let result: {from: number, to: number} | null = null
  
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text)
      if (idx !== -1) {
        result = { from: pos + idx, to: pos + idx + text.length }
        return false // stop iteration
      }
    }
  })
  
  return result
}
```

---

## Stack Tecnologico

| Tecnologia | Uso |
|------------|-----|
| ProseMirror | Editor WYSIWYG |
| Tauri | Desktop wrapper |
| TypeScript | Type safety |
| Ollama/OpenAI/Anthropic | AI providers |

---

## Consultazione Multi-AI

Per bug complessi, abbiamo consultato 4 AI diverse (Claude, GLM-4, Gemini, Deepseek, GPT) classificando le soluzioni per categoria:
- **Fix superficiali**: aggiornano solo variabili
- **Fix strutturali**: cambiano approccio fondamentale

La soluzione ottimale combina entrambi: usare API native (`nodesBetween`) + validazione difensiva.

---

*Aggiornato da Aura — 2026-04-23*