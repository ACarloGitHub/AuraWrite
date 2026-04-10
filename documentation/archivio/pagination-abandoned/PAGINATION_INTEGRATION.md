# Integrazione Pagination in AuraWrite

**Data**: 2026-04-01
**Stato**: Analisi completata, implementazione in sospeso

---

## Sommario

Questo documento analizza l'integrazione di `prosemirror-pagination` in AuraWrite, i problemi riscontrati durante il primo tentativo, e il piano dettagliato per un'integrazione corretta.

---

## 1. Cosa è successo nel primo tentativo

### 1.1 Installazione iniziale
- Installato `prosemirror-pagination` (v0.1.5)
- Modificato `editor.ts` per usare lo schema del plugin
- Aggiunto CSS per le pagine

### 1.2 Problemi riscontrati

| Problema | Descrizione | Causa |
|----------|-------------|-------|
| **CSS sovrapposto** | Si vedevano due "pagine": una dal CSS originale, una dal plugin | Mancata rimozione dello stile `max-width: 720px` da `.ProseMirror` |
| **Pagina a sinistra** | Dopo rimozione CSS, la pagina era allineata a sinistra | CSS del plugin: `.page { margin: 20px auto }` non funziona con flexbox |
| **Tema non rispettato** | Sfondo bianco con tema scuro | `.page` usava `background: var(--color-surface)` che non era definito correttamente |
| **Crash su Suggestions** | Il pannello Suggestions faceva crashare l'app | Conflitto tra il nuovo schema e le funzioni che calcolano posizioni |

### 1.3 Reazione (errata)
Abbiamo ripristinato tutto allo schema base, perdendo l'opportunità di debuggare e fixare i problemi uno alla volta.

---

## 2. Analisi dello Schema

### 2.1 Schema originale (prosemirror-schema-basic)

```javascript
doc: {
  content: "block+"
}

nodes: {
  paragraph, heading, blockquote, 
  bullet_list, ordered_list, list_item,
  code_block, horizontal_rule, hard_break,
  image, text
}

marks: {
  strong, em
}
```

Struttura documento:
```
doc (pos 0)
├── paragraph (pos 1)
│   └── text "Ciao mondo" (pos 2-12)
├── heading (pos 13)
│   └── text "Titolo" (pos 14-20)
└── paragraph (pos 21)
    └── text "Altro testo" (pos 22-33)
```

### 2.2 Schema di prosemirror-pagination

```javascript
doc: {
  content: "page+"  // NOTA: richiede almeno una pagina!
}

page: {
  content: "start header? body footer? end page_counter"
}

nodes: {
  page, start, end, header, footer, body,
  page_counter, paragraph, heading, 
  blockquote, bullet_list, ordered_list,
  list_item, code_block, hard_break,
  horizontal_rule, image, text
  // + nodi tabella
}

marks: {
  strong, em, underline, code, link,
  // + molti altri marks
}
```

Struttura documento:
```
doc (pos 0)
└── page (pos 1)
    ├── start (pos 1)              // NODO VUOTO - offset +1
    ├── header? (pos 2)            // OPZIONALE - offset variabile
    ├── body (pos 3)               // CONTENITORE - offset +1
    │   ├── paragraph (pos 4)
    │   │   └── text "Ciao" (pos 5-9)
    │   └── heading (pos 10)
    │       └── text "Titolo" (pos 11-17)
    ├── footer? (pos 18)          // OPZIONALE
    ├── end (pos 19)              // NODO VUOTO - offset +1
    └── page_counter (pos 20)      // NODO VUOTO - offset +1
```

### 2.3 Differenze critiche

| Aspetto | Schema base | Schema pagination |
|---------|-------------|-------------------|
| **Root** | `doc` contiene blocchi | `doc` contiene `page+` |
| **Offset minimo** | 0 (inizio doc) | ~5 (per nodi wrapper) |
| **Posizioni** | Lineari | Shiftate di N per wrapper |
| **Nodi vuoti** | Nessuno obbligatorio | `start`, `end`, `page_counter` obbligatori |
| **Contenimento** | Testo diretto in doc | Testo in `page > body > paragraph` |

---

## 3. Analisi dei file che usano posizioni/offset

### 3.1 File: `src/editor/text-utils.ts`

**Funzione**: `findTextInDoc()`

```typescript
export function findTextInDoc(
  view: EditorView,
  text: string,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (result) return false;
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text);
      if (idx !== -1) {
        result = { from: pos + idx, to: pos + idx + text.length };
        return false;
      }
    }
  });
  
  // Fallback: cerca in doc.textContent
  if (!result) {
    // ... codice che converte char index a PM position
  }
  
  return result;
}
```

**Impatto del cambio schema**:
- `nodesBetween()` attraversa comunque tutti i nodi ✅
- Le posizioni `pos` sono già corrette (include wrapper offset) ✅
- Il fallback con `doc.textContent` funziona ✅

**Verdetto**: **COMPATIBILE** - funziona già con qualsiasi schema.

**Azione necessaria**: Nessuna, ma aggiungere test.

---

### 3.2 File: `src/ai-panel/suggestions-panel.ts`

#### 3.2.1 Trigger su "." keypress

```typescript
view.dom.addEventListener("keydown", (e: KeyboardEvent) => {
  if (![".", "!", "?", ":"].includes(e.key)) return;
  
  setTimeout(() => {
    const doc = view.state.doc;
    const fullText = doc.textContent;  // ✅ Funziona con nuovo schema
    
    const sentenceRegex = /[^.!?:]+[.!?:]+\s*/g;
    // ... trova frasi
  }, 100);
});
```

**Impatto**: **NESSUNO** - `doc.textContent` restituisce tutto il testo indipendentemente dalla struttura.

#### 3.2.2 `findProseMirrorPosition()` (righe 96-150)

```typescript
function findProseMirrorPosition(
  view: EditorView,
  text: string,
  fallbackIndex: number,
): number {
  let result = -1;
  
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (isTextParagraph(node)) {
      const nodeText = node.textContent;
      const relativeIndex = nodeText.indexOf(text);
      if (relativeIndex !== -1) {
        result = pos + relativeIndex + 1; // +1 per entrare nel nodo
        return false;
      }
    }
  });
  
  // Fallback: cerca nel documento completo
  if (result === -1) {
    const fullText = doc.textContent;
    const charIdx = fullText.indexOf(text);
    // ... converte char index a posizione
  }
  
  return result;
}
```

**Problema**: La funzione `isTextParagraph()` verifica:

```typescript
function isTextParagraph(node: Node): boolean {
  return (
    node.type.name === "paragraph" ||
    node.type.name === "heading"
  );
}
```

Con il nuovo schema, `paragraph` e `heading` sono dentro `body`, non direttamente in `doc`.

**Impatto**: **ALTO** - la funzione potrebbe non trovare i nodi corretti.

**Soluzione**: La funzione `nodesBetween()` attraversa comunque l'intero albero, quindi i nodi `paragraph` vengono visited anche se sono dentro `body`. Tuttavia, la posizione calcolata `pos + relativeIndex + 1` deve tenere conto che `pos` ora include l'offset dei wrapper.

**Verdetto**: **DA VERIFICARE** - potrebbe funzionare, ma serve test.

**Azione necessaria**: Testare con documento paginato.

#### 3.2.3 `replaceSuggestionInDoc()` (righe 400-500)

```typescript
function replaceSuggestionInDoc(
  view: EditorView,
  slot: SentenceSlot
): boolean {
  const { from, to, original, suggested } = slotPositions.get(slot.id) || {};
  
  if (from === undefined || to === undefined) return false;
  
  const tr = view.state.tr;
  
  // Verifica che il testo sia ancora lì
  const currentText = view.state.doc.textBetween(from, to);
  if (currentText !== original) return false;
  
  // Sostituisce
  const marks = view.state.doc.resolve(from).marks();
  const newTextNode = view.state.schema.text(suggested, marks);
  
  tr.replaceWith(from, to, newTextNode);
  view.dispatch(tr);
  
  return true;
}
```

**Impatto**: 
- Le posizioni `from` e `to` vengono da `slotPositions` Map
- Se i calcoli di posizione sono corretti, questo funziona ✅
- `tr.replaceWith()` funziona con qualsiasi schema ✅

**Verdetto**: **COMPATIBILE** se le posizioni sono calcolate correttamente.

---

### 3.3 File: `src/ai-panel/chunk-decorations.ts`

```typescript
function createChunkMarker(chunk: Chunk, isStart: boolean): Decoration {
  return Decoration.widget(
    isStart ? chunk.startOffset : chunk.endOffset,
    () => {
      const span = document.createElement("span");
      span.className = "chunk-marker chunk-marker--start";
      span.setAttribute("data-chunk-id", chunk.id);
      span.setAttribute("data-chunk-title", chunk.title);
      span.textContent = `\u2190 ${chunk.title}`;
      return span;
    },
    { key: `chunk-${chunk.id}-${isStart ? "start" : "end"}` }
  );
}
```

**Problema**: `chunk.startOffset` e `chunk.endOffset` vengono calcolati altrove.

Cerco dove vengono calcolati:

```typescript
// In chunks.ts o simile
function calculateChunks(doc: Node): Chunk[] {
  const chunks: Chunk[] = [];
  // ... calcolo basato su posizioni
  return chunks;
}
```

Devo verificare come vengono calcolati gli offset.

**Azione necessaria**: Controllare `src/ai-panel/chunks.ts`.

---

### 3.4 File: `src/ai-panel/edit-executor.ts`

```typescript
export function applyAuraEdit(
  view: EditorView,
  edit: AuraEdit
): number {
  const operations = edit.operations || [];
  let operationsApplied = 0;
  
  for (const op of operations) {
    if (op.op === "replace") {
      const { find, content } = op;
      const found = findTextInDoc(view, find);
      
      if (found) {
        const tr = view.state.tr;
        // ... applica la modifica
        operationsApplied++;
      }
    }
    // ... altre operazioni
  }
  
  return operationsApplied;
}
```

**Impatto**: 
- Usa `findTextInDoc()` che è **COMPATIBILE** ✅
- Le operazioni `tr.replaceWith()` funzionano con qualsiasi schema ✅

**Verdetto**: **COMPATIBILE**.

---

### 3.5 File: `src/editor/editor.ts`

```typescript
export function createEditor(element: HTMLElement): EditorViewType {
  const state = EditorState.create({
    schema: editorSchema,  // ← QUI SI CAMBIA LO SCHEMA
    plugins: [...],
  });
  // ...
}

export function getEditorContent(view: EditorViewType): string {
  return view.state.doc.textContent;  // ✅ Funziona con nuovo schema
}

export function getSelectedText(view: EditorViewType): string {
  const { from, to } = view.state.selection;
  if (from === to) return "";
  return view.state.doc.textBetween(from, to);  // ✅ Funziona
}

export function parseHTML(html: string): any {
  // ... parsing HTML in documento ProseMirror
  const pmParser = ProseMirrorDOMParser.fromSchema(editorSchema);
  return pmParser.parse(div);
}
```

**Impatto**:
- `createEditor()`: Deve usare lo schema del plugin
- `getEditorContent()`: **COMPATIBILE** ✅
- `getSelectedText()`: **COMPATIBILE** ✅
- `parseHTML()`: Deve usare lo schema del plugin, e il parsing deve creare nodi `page`, `body`, etc.

**Problema**: Se l'utente incolla HTML, come lo convertiamo in `page > body > ...`?

**Azione necessaria**: Creare funzione che wrappa il contenuto in una struttura pagina.

---

### 3.6 File: `src/editor/toolbar.ts` e funzioni di salvataggio

Il salvataggio usa `view.state.doc.toJSON()` e il caricamento usa `state.schema.nodeFromJSON()`.

**Impatto**:
- I documenti salvati con il vecchio schema non saranno compatibili con il nuovo
- Serve migrazione o supporto per entrambi i formati

**Azione necessaria**: 
1. Decidere se convertire tutti i documenti esistenti
2. Oppure supportare entrambi gli schemi

---

## 4. CSS: Problemi e soluzioni

### 4.1 Layout centrato

**Problema**: `.page` con `margin: 20px auto` non si centra in un container flexbox.

**Soluzione**:
```css
#editor {
  display: flex;
  flex-direction: column;
  align-items: center;  /* Centra orizzontalmente */
  overflow: auto;
  padding: var(--spacing-xl);
}

.ProseMirror {
  width: 100%;
  max-width: 100%;  /* Non limitare - le pagine gestiscono la larghezza */
}

.ProseMirror .page {
  width: 794px;           /* A4 width in pixels at 96dpi */
  min-height: 1122px;     /* A4 height in pixels */
  margin-bottom: 40px;    /* Spazio tra pagine */
  padding: 40px;
  background: var(--color-surface);
  box-shadow: var(--shadow-editor);
  border-radius: 4px;
}

.ProseMirror .page:last-child {
  margin-bottom: 0;
}
```

### 4.2 Temi (light/dark)

**Problema**: Con tema scuro, le pagine apparivano bianche.

**Soluzione**:
```css
/* Light theme (default) */
:root {
  --color-surface: #ffffff;
  --color-background: #f5f5f5;
  --color-text: #222222;
}

/* Dark theme */
[data-theme="dark"] {
  --color-surface: #1e1e1e;
  --color-background: #121212;
  --color-text: #e0e0e0;
}

.ProseMirror .page {
  background: var(--color-surface);
  color: var(--color-text);
}
```

**Nota**: Verificare che le variabili CSS siano già definite correttamente in `styles.css`.

---

## 5. Piano di implementazione

### Fase 0: Backup e branch

```bash
git checkout -b feature/pagination-integration
git add .
git commit -m "Backup prima di integrazione paginazione"
```

### Fase 1: Installazione base

1. **Installare dipendenze**
   ```bash
   npm install prosemirror-pagination
   npm install prosemirror-tables prosemirror-utils prosemirror-transform
   ```

2. **Creare type declaration** (il plugin non ha tipi)
   ```typescript
   // src/types/prosemirror-pagination.d.ts
   declare module "prosemirror-pagination" {
     import { Schema } from "prosemirror-model";
     import { Plugin } from "prosemirror-state";
     export const schema: Schema;
     export const paginationPlugin: () => Plugin;
   }
   ```

3. **Verificare che compila** (senza usare il plugin)
   ```bash
   npm run typecheck
   ```

### Fase 2: Integrazione senza breaking changes

**Opzione A**: Doppio schema (consigliato per transizione)

```typescript
// src/editor/editor.ts
import { schema as basicSchema } from "prosemirror-schema-basic";
import { schema as paginationSchema, paginationPlugin } from "prosemirror-pagination";

// Flag per attivare paginazione
const USE_PAGINATION = false; // Cambiare a true quando pronto

const editorSchema = USE_PAGINATION ? paginationSchema : basicSchema;
```

**Opzione B**: Solo paginazione (più rischioso)

```typescript
import { schema as paginationSchema, paginationPlugin } from "prosemirror-pagination";

const editorSchema = paginationSchema;
```

### Fase 3: Fix CSS

1. **Rimuovere** stili `max-width` e `background` da `.ProseMirror`
2. **Aggiungere** stili per `.page`
3. **Verificare** tema light/dark

### Fase 4: Adattare i moduli (se necessario)

#### 4.1 Testare `findTextInDoc`
- Creare documento con 2+ pagine
- Cercare testo con `findTextInDoc`
- Verificare che le posizioni siano corrette

#### 4.2 Testare `suggestions-panel`
- Abilitare suggestions
- Verificare che il trigger su "." funzioni
- Verificare che le frasi vengano trovate correttamente
- Verificare che le modifiche vengano applicate alla posizione corretta

#### 4.3 Testare `chunk-decorations`
- Verificare che i marker appaiano alle posizioni corrette
- Verificare che i marker rimangano sincronizzati durante editing

#### 4.4 Testare `AI Assistant`
- Verificare `findTextInDoc` per operazioni AURA_EDIT
- Verificare che le modifiche vengano applicate correttamente

### Fase 5: Gestione documenti esistenti

**Problema**: Documenti salvati con schema base non possono essere aperti con schema pagination.

**Soluzioni**:

1. **Wrapping automatico**
   ```typescript
   function convertToPaginationDoc(oldDoc: Node, schema: Schema): Node {
     // Il vecchio doc contiene solo paragraph/heading
     // Creare: doc > page > start > body [contenuto] > end > page_counter
     const bodyContent = oldDoc.content;
     
     return schema.nodes.doc.create({}, [
       schema.nodes.page.create({}, [
         schema.nodes.start.create(),
         schema.nodes.body.create({}, bodyContent),
         schema.nodes.end.create(),
         schema.nodes.page_counter.create({ pageNumber: 1 }),
       ]),
     ]);
   }
   ```

2. **Doppio loader**
   ```typescript
   function loadDocument(json: any, schema: Schema): Node {
     // Se json ha la struttura vecchia (senza 'page')
     if (json.content && json.content[0] && !json.content[0].type?.startsWith('page')) {
       return convertToPaginationDoc(Node.fromJSON(oldSchema, json), schema);
     }
     return Node.fromJSON(schema, json);
   }
   ```

### Fase 6: Miglioramenti opzionali

1. **Zoom sulle pagine**
   ```css
   .editor-wrapper {
     transform: scale(var(--zoom-level));
     transform-origin: top center;
   }
   ```

2. **Numeri di pagina**
   ```javascript
   // Aggiornare i numeri delle pagine nel plugin
   function updatePageNumbers(view: EditorView) {
     const pages = view.dom.querySelectorAll('.page');
     pages.forEach((page, index) => {
       const counter = page.querySelector('.page-counter');
       if (counter) counter.textContent = String(index + 1);
     });
   }
   ```

3. **Header/Footer dinamici**
   ```javascript
   // Permettere all'utente di definire header/footer
   function setHeader(view: EditorView, content: Node) {
     // Aggiornare header in ogni pagina
   }
   ```

---

## 6. Test checklist

### Test base (schema base, senza paginazione)
- [ ] Editor si avvia correttamente
- [ ] Temi light/dark funzionano
- [ ] Scrittura testo funziona
- [ ] Formattazione (bold, italic) funziona
- [ ] Undo/redo funziona
- [ ] Salvataggio/caricamento funziona
- [ ] AI Assistant legge il documento
- [ ] AI Assistant applica modifiche
- [ ] Suggestions Panel si apre
- [ ] Suggestions trova frasi
- [ ] Suggestions applica modifiche
- [ ] Chunks markers visibili

### Test paginazione (schema pagination)
- [ ] Editor si avvia con schema pagination
- [ ] Pagina appare centrata
- [ ] Tema rispettato su pagina
- [ ] Testo overflow causa nuova pagina
- [ ] Più pagine visibili
- [ ] Scrittura funziona su pagina 1
- [ ] Scrittura funziona su pagina 2+
- [ ] Navigazione tra pagine funziona
- [ ] Undo/redo funziona con pagine
- [ ] Salvataggio documento paginato
- [ ] Caricamento documento paginato

### Test AI con paginazione
- [ ] AI Assistant legge documento paginato
- [ ] findTextInDoc trova testo in pagina 1
- [ ] findTextInDoc trova testo in pagina 2+
- [ ] AURA_EDIT applica modifiche su pagina 1
- [ ] AURA_EDIT applica modifiche su pagina 2+
- [ ] Suggestions trigger "." funziona su pagina 1
- [ ] Suggestions trova frasi su pagina 2+
- [ ] Suggestions applica modifiche correttamente
- [ ] Chunk markers posizionati correttamente
- [ ] Chunk markers rimangono su pagina corretta durante edit

---

## 7. Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| Schema incompatibile con documenti esistenti | Alta | Alto | Funzione di conversione automatica |
| Crash su suggestions/ai | Media | Alto | Test incrementali, blocco try-catch |
| Prestazioni degrade con molte pagine | Media | Medio | Virtualizzazione, paginazione lazy |
| Plugin non mantenuto/bug | Bassa | Alto | Fork locale pronto, backup codice |
| CSS conflitti con temi | Media | Basso | Test visivi su entrambi i temi |

---

## 8. Note per la ripresa

### Stato attuale
- ✅ `prosemirror-pagination` installato
- ✅ Type declaration creata
- ⏳ Schema non ancora integrato (siamo tornati allo schema base)
- ⏳ CSS non ancora adattato
- ⏳ Moduli non ancora adattati

### Cosa fare il prossimo incontro

1. **Verificare CSS per temi**: Controllare che `--color-surface` e altre variabili siano definite correttamente per entrambi i temi

2. **Creare branch di test**:
   ```bash
   git checkout -b feature/pagination-test
   ```

3. **Integrare lo schema** con la flag `USE_PAGINATION = false` inizialmente

4. **Testare visivamente** la paginazione con `USE_PAGINATION = true` (suggestions disabilitate)

5. **Abilitare suggestions** una alla volta e fixare eventuali crash

### Comandi utili

```bash
# Avviare l'app
npm run tauri dev

# Type check
npm run typecheck

# Lint
npm run lint

# Testare la paginazione in isolamento
# (creare file HTML con solo il plugin)
```

### File da modificare

1. `src/editor/editor.ts` - Cambio schema
2. `src/styles.css` - CSS per pagine
3. `src/editor/text-utils.ts` - Testare con nuovo schema
4. `src/ai-panel/suggestions-panel.ts` - Testare posizioni
5. `src/ai-panel/chunk-decorations.ts` - Adattare calcolo offset
6. `src/ai-panel/chunks.ts` - Verificare calcolo chunk
7. `src/formats/*.ts` - Adattare import/export per nuovo schema

---

## 9. Riferimenti

- [prosemirror-pagination GitHub](https://github.com/todorstoev/prosemirror-pagination)
- [ProseMirror schema basics](https://prosemirror.net/docs/guide/#schema)
- [ProseMirror decorations](https://prosemirror.net/docs/guide/#decoration)
- [Paged.js](https://pagedjs.org/) - Alternativa per export PDF

---

**Fine documento. Prossimo passo: riprendere dalla Fase 1 e procedere incrementalmente con test ad ogni modifica.**