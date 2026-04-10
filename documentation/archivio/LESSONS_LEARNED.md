# Lezioni Apprese - AuraWrite

## Suggerimenti Panel - Slot Position Tracking (2026-04-01)

### Il Bug
Premendo Accept o Switch più volte sulla stessa frase, venivano aggiunti punti e caratteri. Le frasi successive venivano corrotte.

### Root Cause
1. Le posizioni venivano calcolate su `doc.textContent` (stringa piatta), ma ProseMirror usa posizioni basate su **nodi**
2. Dopo ogni replace, `slotPositions` dello slot modificato **NON** veniva aggiornato
3. `updatePositionsAfterChange` aggiornava solo gli **ALTRI** slot, non quello corrente

### Pattern Errato
```typescript
// SBAGLIATO: usare indici su textContent
const fullText = doc.textContent;
const index = fullText.indexOf(sentence);

// SBAGLIATO: non aggiornare lo slot dopo modifica
editorViewRef.dispatch(tr);
updatePositionsAfterChange(id, pos.from, oldLen, newLen);
// slotPositions[id] ha ancora le vecchie posizioni!
```

### Pattern Corretto
```typescript
// CORRETTO: usare nodesBetween per posizioni ProseMirror
function findProseMirrorPosition(view, text, fallbackIndex) {
  let foundPos = -1;
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        foundPos = pos + idx;
        return false;
      }
    }
  });
  return foundPos !== -1 ? foundPos : fallbackIndex;
}

// CORRETTO: aggiornare lo slot dopo ogni modifica
editorViewRef.dispatch(tr);
pos.to = pos.from + newLen;
pos.original = finalSuggested; // aggiorna anche il testo memorizzato
updatePositionsAfterChange(id, pos.from, oldLen, newLen);

// CORRETTO: validazione difensiva
if (!validatePosition(id)) {
  const livePos = findTextInDoc(editorViewRef, finalSuggested);
  if (livePos) {
    pos.from = livePos.from;
    pos.to = livePos.to;
  }
}
```

### Strutture Dati da Mantenere Sincronizzate
Quando si fa replace nel documento, bisogna aggiornare:
- `slotPositions` (from, to, original, suggested)
- `slots[]` (stato: pending/processing/suggested/accepted/closed)
- `suggestions[]` (isAccepted, showingOriginal, isExpanded, isCollapsed)

### Validazione Sempre Necessaria
Dopo ogni operazione, verificare che il testo in posizione corrisponda all'atteso. Se no, ricalcolare.

---

## Principi Generali per ProseMirror

### 1. Mai fidarsi di indici su stringhe
`textContent.indexOf()` dà indici sbagliati se il documento ha formattazione, liste, paragrafi multipli.

### 2. Usare sempre `nodesBetween`
Per cercare testo nel documento, usare:
```typescript
doc.nodesBetween(0, doc.content.size, (node, pos) => {
  if (node.isText && node.text) {
    // node.text contiene il testo a questa posizione
  }
});
```

### 3. Le posizioni ProseMirror includono i nodi
Una posizione ProseMirror non è solo un indice carattere, ma tiene conto della struttura del documento (paragrafi, nodi, ecc.).

### 4. Dopo ogni transazione, aggiornare lo stato
Se si memorizzano posizioni, dopo `dispatch(tr)` quelle posizioni potrebbero essere invalide se altri slot sono stati spostati.

---

## Da Non Replicare per AI Assistant Panel

L'AI Assistant panel ha lo stesso sistema di chunk positions. Quando si implementa il replace o si modifica il documento:

1. **Calcolare posizioni con nodesBetween**, non textContent
2. **Aggiornare chunkPositions** dopo ogni modifica al documento
3. **Validare** che la posizione memorizzata corrisponda al testo corrente
4. **Non rimuovere** un slot/chunk dalla mappa finché si potrebbe ancora interagire con esso
5. **Loggare** sempre le operazioni per debugging

---

## Chunk System - AI Assistant (2026-04-01)

### Scopo del Chunking
Ogni modello AI ha una finestra di contesto diversa. Il chunking permette di:
- Mandare porzioni di documento gestibili all'AI
- Non perdere informazioni preziose
- Permettere all'utente di discutere porzioni specifiche

### Finestre di Contesto Tipiche
- **Ollama locali**: 25k, 65k tokens (dipende dal modello)
- **Gemini API**: fino a 1 milione tokens
- **Default AuraWrite**: chunking conservativo (~8k tokens), modificabile nelle preferenze

### Come Funziona il Chunking
1. Documento diviso per sentence boundaries (`/[^.!?]+[.!?]+/g`)
2. Accumula sentences fino a `tokensPerChunk * 4` caratteri (~4 chars/token)
3. Ogni chunk ha: id, title, content, startOffset, endOffset

### IMPORTANTISSIMO - Bug Offset
**I chunk offsets sono attualmente in caratteri, non posizioni ProseMirror!**
Stesso bug che avevamo in Suggestions.
I chunk decorations usano questi offset direttamente, che falliranno con documenti formattati.

**FIX NECESSARIO**: Usare `nodesBetween` per calcolare posizioni ProseMirror corrette.

### I Chunks Sono Decorations
- Non compaiono nel documento esportato
- Servono solo all'utente per identificare porzioni di testo
- AI può leggere chunk singoli e rispondere consapevolmente

### Interazione con AI
L'utente può:
- "Aura, leggi il chunk Untitled-chunk_005 e dimmi se lo stile è coerente"
- Selezionare porzione di testo e chiedere modifiche
- Chiedere modifiche su tutto il documento

### Futuro: Indicizzazione Vector DB
I chunks saranno indicizzati per ricerca semantica. AuraWrite è uno strumento di supporto alla scrittura di libri.

### UI - Etichette Chunk
Attualmente le etichette sono troppo piccole. Devono essere ingrandite per migliore leggibilità.

---

## Pattern per Modificare il Documento (AI Assistant)

Quando AI deve modificare il documento (dopo conferma utente):

```typescript
// 1. Calcolare posizioni con nodesBetween (NON textContent!)
const livePos = findTextInDoc(editorViewRef, textToReplace);
if (!livePos) {
  log(`ERROR: Text not found in document`);
  return;
}

// 2. Validare che la posizione sia corretta
if (!validatePosition(id)) {
  // ricalcola...
}

// 3. Apply replace
const tr = editorViewRef.state.tr.replaceWith(
  livePos.from,
  livePos.to,
  editorViewRef.state.schema.text(newText),
);
editorViewRef.dispatch(tr);

// 4. Aggiornare le posizioni di TUTTI gli slot/chunks
updatePositionsAfterChange(id, livePos.from, oldLen, newLen);

// 5. Aggiornare la posizione dello slot corrente
pos.to = pos.from + newLen;
pos.original = newText;
```

---

## AI Assistant - Comportamento Atteso (2026-04-01)

### Principio Fondamentale
AI Assistant è un **agente conversazionale**. Funziona come Claude, OpenCode, o qualsiasi altro assistente AI. L'utente chatta, l'agente risponde. Quando l'utente chiede esplicitamente di modificare il testo, l'agente lo fa.

**Non servono pulsanti, bottoni "Apply", o formule magiche.**

---

### Scenario 1 - Nessuna Selezione (Documento Intero)

1. L'utente apre AI Assistant (o è già aperto)
2. Chatta con Aura sul testo in generale
3. Quando l'utente chiede esplicitamente di modificare ("Aura, applica le modifiche", "Aura, riscrivi il terzo paragrafo", ecc.)
4. Aura modifica il testo come richiesto
5. Il replace avviene sul documento intero o sulla porzione indicata dall'utente

**Vincolo**: Aura può modificare tutto il testo, non ci sono limiti.

---

### Scenario 2 - Con Selezione (Porzione Specifica)

1. L'utente seleziona una porzione di testo (parola, frase, paragrafo)
2. Clicca nel box di dialogo di AI Assistant
3. Il testo selezionato viene evidenziato
4. Aura sa che può modificare SOLO quella porzione
5. L'utente può chiedere qualsiasi cosa su quella porzione:
   - "Aura, suggerisci sinonimi per questa parola"
   - "Aura, rendi questa frase più incisiva"
   - "Aura, riscrivi questo paragrafo"
6. Quando l'utente vuole applicare, lo dice esplicitamente
7. Aura modifica solo la porzione selezionata

**Vincolo**: Aura può modificare SOLO la porzione selezionata. Il resto del documento non viene toccato.

---

### Interazione con Suggestions Panel

Entrambi i pannelli possono operare contemporaneamente:
- Suggestions analizza frasi una per una
- AI Assistant può modificare porzioni selezionate
- Le posizioni DEVONO rimanere sincronizzate

**Problema tecnico**: Quando un pannello modifica il testo, le posizioni dell'altro diventano invalide.
**Soluzione**: Sistema di validazione e ricalcolo posizioni (come in Suggestions).

---

### Interfaccia Conversazionale

L'interfaccia è completamente conversazionale:
- L'utente scrive nella casella di testo
- Preme Send o invia con Enter
- I messaggi appaiono nella chat
- Aura risponde
- L'utente può chiedere qualsiasi cosa, in qualsiasi modo

**Esempi di richieste valide**:
- "Aura, cambia 'cacca' in 'qualcosa di più decoroso'"
- "Aura, riscrivi il secondo capoverso"
- "Aura, applica la modifica che hai proposto"
- "Fammi vedere come verrebbe questa frase in un altro stile"

---

## Pattern per Modificare il Documento (AI Assistant) - AURA_EDIT

### Nuovo Sistema AURA_EDIT

```typescript
// 1. Parse con edit-parser.ts
import { parseAuraEdit, hasValidOperations } from './edit-parser';

// 2. Esegui con edit-executor.ts
import { applyAuraEdit } from './edit-executor';

const result = applyAuraEdit(response.content, editorViewRef, currentSelection);

if (result.operationsApplied > 0) {
  // Successo!
  placeholder.textContent = `✓ ${result.operationsApplied} modifica/e applicata/e`;
} else if (result.error) {
  // Errore di parsing
  placeholder.textContent = response.content;
}
```

### Formato JSON
```json
{
  "aura_edit": {
    "message": "Spiegazione per l'utente",
    "operations": [
      { "op": "replace", "find": "testo vecchio", "content": [{ "type": "text", "text": "nuovo" }] },
      { "op": "format", "find": "testo", "addMark": "bold" },
      { "op": "insert", "find": "dopo questo", "position": "after", "content": [...] },
      { "op": "delete", "find": "testo da rimuovere" }
    ]
  }
}
```

### Parser Robusto
3 strategie in ordine:
1. Delimitatore `<<<AURA_EDIT>>>...<<<END_AURA_EDIT>>>`
2. Markdown code block ` ```json ... ``` `
3. Ricerca chiave `{"aura_edit": ...}`

---

## Modification Hub - Sincronizzazione tra Pannelli

Quando più pannelli possono modificare il documento, serve un bus eventi centralizzato:

```typescript
// modification-hub.ts
type Source = "suggestions" | "ai_assistant" | "external";
type Listener = (change: {from: number, oldLen: number, newLen: number}, source: Source) => void;

const listeners: Map<string, ChangeListener> = new Map();

export function subscribeToChanges(id: string, listener: ChangeListener): () => void {
  listeners.set(id, listener);
  return () => listeners.delete(id);
}

export function notifyDocumentChange(change, source): void {
  listeners.forEach((listener, id) => {
    listener(change, source);
  });
}
```

**In Suggestions**: ignora i propri eventi (source filtering).
**In AI Assistant**: chiama notifyDocumentChange dopo ogni modifica.

---

## Bug Scoperto - AI Assistant Modification (2026-04-01)

### Commit Fallito: 20fb136

Il commit "feat: AI Assistant document modification + modification hub" ha introdotto un bug in Suggestions Panel.

**Sintomi**:
- Testo: "Aurawrite. Inizierò" → "AurawriteInizierò" (punto mancante)
- A-capo scomparso
- "funzionare." duplicato

**Possibili Cause**:
1. Circolo vizioso di import tra chat.ts e suggestions-panel.ts
2. notifyDocumentChange chiamato prima che editorViewRef sia pronto
3. Race condition nel modification hub

**Documentazione**: `documentation/06-roadmap/DEBUG-AI-ASSISTANT-BUG.md`

---

## Problema JSON Insufficiente (2026-04-01) - RISOLTO

### ~~Il Modello Capisce MA...~~

~~Kimi-k2.5:cloud è un ottimo agente. Capisce perfettamente la distinzione documento/chat. MA:~~

~~1. Scrive prima in chat per spiegare cosa fa~~
~~2. POI fornisce il JSON~~
~~3. A volte fornisce JSON malformato (`original: ""`)~~

### ~~Causa Root~~

~~Il formato JSON attuale è troppo limitato:~~
```json
{"modification": {"original": "testo", "new": "nuovo testo""}}
```

### ✅ SOLUZIONE: AURA_EDIT Format

Nuovo formato robusto:
```json
{
  "aura_edit": {
    "message": "Spiegazione",
    "operations": [
      { "op": "replace", "find": "testo", "content": [...] },
      { "op": "format", "find": "testo", "addMark": "bold" },
      { "op": "insert", "find": "dopo", "content": [...] },
      { "op": "delete", "find": "testo" }
    ]
  }
}
```

**Implementato in**:
- `operations.ts` - tipi TypeScript
- `edit-parser.ts` - parser robusto con 3 strategie
- `edit-executor.ts` - esecuzione operazioni ProseMirror

**Funziona!** Kimi-k2.5:cloud capisce il formato e applica le modifiche al documento.

---

## Stack Tecnologico
- ProseMirror per editor
- Tauri per desktop wrapper
- TypeScript per type safety
- Consultazione multi-AI per validazione soluzione
