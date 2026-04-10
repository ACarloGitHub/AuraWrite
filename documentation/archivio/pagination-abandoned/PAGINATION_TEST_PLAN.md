# Piano Test prosemirror-pagination

**Data**: 2026-04-01
**Stato**: Pronto per esecuzione
**Branch suggerito**: `feature/pagination-test`

---

## 1. Analisi del Plugin

### 1.1 Informazioni Repository

| Metrica | Valore |
|---------|--------|
| Repository | https://github.com/todorstoev/prosemirror-pagination |
| Versione | 0.1.5 |
| Stelline | 96 |
| Fork | 13 |
| Ultimo commit | Dicembre 2024 |
| Licenza | MIT |

### 1.2 Issue Aperte

| # | Titolo | Severità | Note |
|---|--------|----------|------|
| 1 | Example? | Bassa | Richiesta documentazione |
| 3 | example | Bassa | Richiesta documentazione |
| 4 | RangeError: Duplicate use of selection JSON ID cell | **ALTA** | Conflitto con prosemirror-tables |
| 5 | Example | Bassa | Richiesta documentazione |
| 6-8 | Dependabot PRs | Bassa | Security fixes |
| 7 | How to implement | Bassa | Richiesta documentazione |

### 1.3 Conflitto Potenziale

**Issue #4**: Il plugin include `prosemirror-tables` nel bundle con ID JSON duplicati.

**AuraWrite**: Ha `prosemirror-tables@1.8.5` come dipendenza già installata.

**Rischio**: Conflitto durante l'uso combinato di entrambi.

**Verifica necessaria**: Testare se il conflitto si manifesta nel nostro caso.

---

## 2. Schema Differences

### 2.1 Schema Base (AuraWrite attuale)

```
doc (pos 0)
├── paragraph (pos 1)
│   └── text "Ciao mondo" (pos 2-12)
├── heading (pos 13)
│   └── text "Titolo" (pos 14-20)
└── paragraph (pos 21)
    └── text "Altro testo" (pos 22-33)
```

### 2.2 Schema prosemirror-pagination

```
doc (pos 0)
└── page (pos 1)
    ├── start (pos 1)              // NODO VUOTO - offset +1
    ├── header? (pos 2)            // OPZIONALE
    ├── body (pos 3)                // CONTENITORE
    │   ├── paragraph (pos 4)
    │   │   └── text "Ciao" (pos 5-9)
    │   └── heading (pos 10)
    │       └── text "Titolo" (pos 11-17)
    ├── footer? (pos 18)           // OPZIONALE
    ├── end (pos 19)               // NODO VUOTO - offset +1
    └── page_counter (pos 20)      // NODO VUOTO - offset +1
```

### 2.3 Differenze Critiche

| Aspetto | Schema Base | Schema Pagination |
|---------|-------------|-------------------|
| Root content | `block+` | `page+` |
| Offset minimo | 0 | ~5 (wrapper nodes) |
| Nodi vuoti | Nessuno | `start`, `end`, `page_counter` obbligatori |
| Contenimento testo | Diretto in doc | In `page > body > paragraph` |

---

## 3. FASE 1: Test Isolato

### 3.1 Setup

```bash
# Branch test
git checkout -b feature/pagination-test

# Dipendenze già installate
npm list prosemirror-pagination
# Output: prosemirror-pagination@0.1.5
```

### 3.2 File Test

Creare `test-pagination.html` nella root del progetto:

```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Test prosemirror-pagination</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f0f0;
            padding: 20px;
        }
        #editor {
            max-width: 900px;
            margin: 0 auto;
            background: #e0e0e0;
            padding: 20px;
        }
        .ProseMirror {
            min-height: 200px;
            background: white;
            padding: 10px;
        }
        .ProseMirror .page {
            width: 794px;
            min-height: 1122px;
            margin-bottom: 20px;
            padding: 40px;
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        #test-results {
            margin-top: 20px;
            padding: 20px;
            background: white;
            border: 1px solid #ccc;
        }
        .test-pass { color: green; }
        .test-fail { color: red; }
    </style>
</head>
<body>
    <h1>Test prosemirror-pagination v0.1.5</h1>
    <div id="editor"></div>
    <div id="test-results">
        <h2>Risultati Test</h2>
        <ul id="results-list"></ul>
    </div>

    <script type="module">
        import { EditorState, Plugin } from 'prosemirror-state';
        import { EditorView } from 'prosemirror-view';
        import { EditorView as PMEditorView } from 'prosemirror-view';

        // Import pagination plugin e schema
        // NOTA: Il plugin espone 'schema' e 'paginationPlugin'
        import * as PaginationPkg from './node_modules/prosemirror-pagination/dist/bundle.js';

        const schema = PaginationPkg.schema;
        const paginationPlugin = PaginationPkg.paginationPlugin;

        // Test tracking
        let testResults = [];
        function test(name, fn) {
            try {
                const result = fn();
                testResults.push({ name, pass: result, error: null });
            } catch (e) {
                testResults.push({ name, pass: false, error: e.message });
            }
        }
        function reportResults() {
            const list = document.getElementById('results-list');
            testResults.forEach(r => {
                const li = document.createElement('li');
                li.className = r.pass ? 'test-pass' : 'test-fail';
                li.textContent = `${r.pass ? '✓' : '✗'} ${r.name}${r.error ? ': ' + r.error : ''}`;
                list.appendChild(li);
            });
        }

        // 1. Schema loading test
        test('Schema caricato', () => {
            return schema && schema.nodes && schema.nodes.page && schema.nodes.body;
        });

        // 2. Plugin creation test
        test('Plugin creato', () => {
            const plugin = paginationPlugin();
            return plugin && typeof plugin === 'object';
        });

        // 3. Editor state creation
        const state = EditorState.create({
            schema: schema,
            plugins: [paginationPlugin()]
        });
        test('State creato', () => state !== null);

        // 4. Editor view creation
        const view = new EditorView(document.getElementById('editor'), {
            state: state
        });
        test('View creata', () => view !== null);

        // 5. Check document structure
        test('Documento ha struttura page', () => {
            const doc = view.state.doc;
            return doc.firstChild && doc.firstChild.type.name === 'page';
        });

        // 6. Insert text test
        test('Inserimento testo funziona', () => {
            try {
                const tr = view.state.tr;
                const pos = findEditablePosition(view);
                if (pos === null) return false;
                tr.insertText('Testo di prova', pos);
                view.dispatch(tr);
                return view.state.doc.textContent.includes('Testo di prova');
            } catch (e) {
                return false;
            }
        });

        // 7. Undo test
        test('Undo funziona', () => {
            const before = view.state.doc.textContent;
            const { undo } = require('prosemirror-history');
            // Prova undo
            try {
                undo(view.state, view.dispatch);
                return true;
            } catch (e) {
                return false;
            }
        });

        // 8. JSON export test
        test('JSON export funziona', () => {
            const json = view.state.doc.toJSON();
            return json && json.type === 'doc';
        });

        // 9. JSON import test
        test('JSON import funziona', () => {
            const json = view.state.doc.toJSON();
            const newDoc = schema.nodeFromJSON(json);
            return newDoc !== null;
        });

        // Helper: find editable position
        function findEditablePosition(view) {
            let pos = null;
            view.state.doc.descendants((node, p) => {
                if (node.isTextblock && pos === null) {
                    pos = p + 1;
                }
            });
            return pos;
        }

        // Report all results
        reportResults();

        console.log('Schema nodes:', Object.keys(schema.nodes));
        console.log('Document structure:', view.state.doc.toJSON());
    </script>
</body>
</html>
```

### 3.3 Test Checklist

Eseguire in ordine:

| # | Test | Passato | Note |
|---|------|---------|------|
| 1 | Schema caricato | ⬜ | |
| 2 | Plugin creato | ⬜ | |
| 3 | State creato | ⬜ | |
| 4 | View creata | ⬜ | |
| 5 | Documento ha struttura page | ⬜ | |
| 6 | Inserimento testo funziona | ⬜ | |
| 7 | Undo funziona | ⬜ | |
| 8 | JSON export funziona | ⬜ | |
| 9 | JSON import funziona | ⬜ | |
| 10 | Overflow causa nuova pagina | ⬜ | Manuale: scrivere molto testo |
| 11 | Cursore si muove tra pagine | ⬜ | Manuale: frecce |
| 12 | Selezione multi-pagina | ⬜ | Manuale: mouse |
| 13 | Backspace rimuove pagine vuote | ⬜ | Manuale |
| 14 | Nessun conflitto con prosemirror-tables | ⬜ | Verificare console |
| 15 | Tema CSS applicato | ⬜ | Visivo |
| 16 | Zoom funziona | ⬜ | Opzionale |

### 3.4 Criteri di Successo FASE 1

**PASS**: Almeno 14/16 test passano, nessun crash critico.
**FAIL**: Crash gravi, conflitto con prosemirror-tables non risolvibile.

---

## 4. FASE 2: Analisi Integrazione con Suggestions

### 4.1 Premessa

Se FASE 1 ha successo, procedere con analisi dell'integrazione.

### 4.2 File Coinvolti

1. `src/editor/editor.ts` - Cambio schema
2. `src/editor/text-utils.ts` - `findTextInDoc()`
3. `src/ai-panel/suggestions-panel.ts` - Calcolo posizioni
4. `src/ai-panel/edit-executor.ts` - Applicazione modifiche
5. `src/ai-panel/chunks.ts` - Calcolo offset chunks
6. `src/ai-panel/chunk-decorations.ts` - Decorazioni visive

### 4.3 Prompt per AI Consulting (Claude, Gemini, GPT, DeepSeek, GLM-5)

```markdown
## Problema: Integrazione prosemirror-pagination con pannelli AI

### Contesto

Sto integrando `prosemirror-pagination` in un editor che ha pannelli AI che calcolano posizioni nel documento.

### Schema ProseMirror Base (attuale)

```
doc (pos 0)
├── paragraph (pos 1)
│   └── text "Ciao mondo" (pos 2-12)
├── heading (pos 13)
│   └── text "Titolo" (pos 14-20)
```

### Schema prosemirror-pagination (nuovo)

```
doc (pos 0)
└── page (pos 1)
    ├── start (nodo vuoto, offset +1)
    ├── body
    │   └── paragraph...
    ├── end (nodo vuoto, offset +1)
    └── page_counter (nodo vuoto, offset +1)
```

### Funzioni Problematiche

**1. findTextInDoc() - Cerca testo nel documento:**

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
  
  return result;
}
```

**2. findProseMirrorPosition() - Calcola posizione per suggestions:**

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
        result = pos + relativeIndex + 1;
        return false;
      }
    }
  });
  
  return result;
}
```

**3. Chunk offset calculation:**

```typescript
export function splitIntoChunks(
  text: string,
  documentTitle: string,
  maxTokens?: number,
): Chunk[] {
  // ... calcolo basato su text.length
  // Offset calcolati come caratteri, non posizioni ProseMirror
}
```

### Domanda

Come posso implementare un comportamento prevedibile per gestire le posizioni con entrambi gli schemi?

Considerazioni:
1. Le posizioni ProseMirror cambiano con wrapper nodes
2. `doc.textContent` rimane uguale (solo testo)
3. Ho bisogno di mappare tra posizioni char e posizioni PM
4. Il codice deve funzionare con schema base E schema pagination

### Requisiti

1. Soluzione che funzioni con entrambi gli schemi
2. Preferibilmente senza duplicare codice
3. Manutenibile nel lungo termine
```

---

## 5. FASE 3: Layout Grafico

### 5.1 CSS Richiesto

```css
/* Container editor */
#editor {
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: auto;
    padding: var(--spacing-xl);
    background: var(--color-background);
}

/* ProseMirror con pagine */
.ProseMirror {
    width: 100%;
    max-width: 100%;
}

/* Pagina A4 */
.ProseMirror .page {
    width: 794px;
    min-height: 1122px;
    margin-bottom: 40px;
    padding: 40px;
    background: var(--color-surface);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    border-radius: 4px;
}

/* Tema scuro */
[data-theme="dark"] .ProseMirror .page {
    background: var(--color-surface);
    color: var(--color-text);
}

/* Zoom */
.editor-wrapper {
    transform: scale(var(--zoom-level, 1));
    transform-origin: top center;
}
```

### 5.2 Verifiche Visive

1. Pagina centrata orizzontalmente
2. Tema light: sfondo grigio, pagina bianca
3. Tema dark: sfondo scuro, pagina con tema dark
4. Zoom: scala correttamente
5. Margini corretti tra pagine

---

## 6. FASE 4: Piano di Integrazione

### 6.1 Strategia Consigliata

Dopo analisi AI consulting, sintetizzare:

1. **Adapter Pattern**: Creare `PositionAdapter` che gestisce offset
2. **Schema Detection**: Rilevare automaticamente quale schema è attivo
3. **Test di Regressione**: Testare tutti i moduli AI con nuovo schema

### 6.2 Conversione Documenti

Documenti salvati con schema base non saranno compatibili con schema pagination.

Soluzione: Funzione di conversione:

```typescript
function convertToPaginationDoc(oldDoc: Node, schema: Schema): Node {
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

---

## 7. Fallback se FASE 1 Fallisce

### 7.1 Visual Page Break Markers

Se prosemirror-pagination non è affidabile, implementare:

1. **Nodo `page_break`** nello schema
2. **Linee tratteggiate** calcolate via JS
3. **Export con Paged.js**

### 7.2 Vantaggi Fallback

- Nessun cambio schema
- Nessun rischio per AI panels esistenti
- Implementazione più semplice
- Controllo totale sul codice

---

## 8. Comandi Utili

```bash
# Avviare app
npm run tauri dev

# Type check
npm run typecheck

# Lint
npm run lint

# Creare branch test
git checkout -b feature/pagination-test

# Verificare dipendenze
npm list prosemirror-pagination
npm list prosemirror-tables
```

---

## 9. File da Modificare (se integrazione procede)

1. `src/editor/editor.ts` - Import schema pagination
2. `src/styles.css` - CSS per pagine
3. `src/editor/text-utils.ts` - Aggiornare se necessario
4. `src/ai-panel/suggestions-panel.ts` - Adattare posizioni
5. `src/ai-panel/chunks.ts` - Adattare calcolo offset
6. `src/formats/*.ts` - Adattare import/export

---

## 10. Riferimenti

- Repository: https://github.com/todorstoev/prosemirror-pagination
- Analisi precedente: `documentation/06-roadmap/PAGINATION_INTEGRATION.md`
- Resume memo: `documentation/RESUME_MEMO.md`

---

_Fine documento. Iniziare da FASE 1._