# ProseMirror Pagination - Knowledge Base

**Ultimo aggiornamento:** 2026-04-02
**Stato:** ❌ ABANDONED - Plugin non utilizzabile

---

## ⚠️ VERDETTO FINALE

**prosemirror-pagination non è utilizzabile in AuraWrite.**

### Motivi dell'Abbandono

| Problema | Severità | Descrizione |
|----------|----------|-------------|
| **Bug critico su split** | 🔴 BLOCCANTE | `TypeError: Cannot read properties of undefined (reading 'lastChild')` quando cerca di dividere le pagine |
| **Documentazione inesistente** | 🔴 ALTA | README di 3 righe, nessun esempio funzionante, nessun API doc |
| **Dipendenze conflittuali** | 🔴 ALTA | Richiede `prosemirror-tables@^0.9.1` (noi abbiamo 1.8.5) - Issue #4 confermata |
| **Schema invasivo** | 🟡 MEDIA | Devi usare il loro schema completo, non integrabile con schemi esistenti |
| **Zero manutenzione** | 🟡 MEDIA | 96 stelle, 13 fork, 5 issue aperte, risposta lenta o assente |

---

## Test Eseguiti

**Data:** 2026-04-02
**Ambiente:** Test isolato con Vite

### Risultati Test

| Test | Risultato | Dettagli |
|------|-----------|----------|
| Schema caricamento | ✅ PASS | Schema ha 23 nodi, 15 marks |
| Struttura iniziale | ✅ PASS | `doc > page > (start, body, end, page_counter)` corretto |
| JSON export/import | ✅ PASS | Roundtrip funziona |
| Formattazione (bold, italic) | ✅ PASS | Marks disponibili e funzionanti |
| Heading | ✅ PASS | Nodo heading funziona |
| **Inserimento testo lungo** | ❌ **FAIL** | Crash: `lastChild` undefined |
| **Editing manuale** | ❌ **FAIL** | Crash quando overflow rilevato |
| **Creazione pagina automatica** | ❌ **FAIL** | Non funziona |

### Errore Critico

```javascript
TypeError: Cannot read properties of undefined (reading 'lastChild')
    at Plugin.appendTransaction (prosemirror-pagination.js:8833)
```

**Causa:** Il plugin cerca `doc.lastChild` durante l'operazione di split, ma quando chiama `appendTransaction`, il documento non è ancora pronto.

**Codice problematico (linea 8833 del bundle):**
```javascript
// Nel plugin, dentro appendTransaction
const { lastChild } = state.doc;  // ← lastChild è undefined
```

---

## 1. Cosa è prosemirror-pagination

Plugin per ProseMirror che simula impaginazione A4 nel browser.

**Repository:** https://github.com/todorstoev/prosemirror-pagination
**Versione:** 0.1.5
**Stelle:** 96
**Licenza:** MIT

---

## 2. Struttura Schema Richiesto

### Schema Base (AuraWrite attuale)

```
doc (pos 0)
├── paragraph (pos 1)
│   └── text "Ciao mondo" (pos 2-12)
```

### Schema Pagination (OBBLIGATORIO)

```
doc (pos 0)
└── page (pos 1)
    ├── start (nodo vuoto)
    ├── body (contenitore)
    │   ├── paragraph
    │   └── heading
    ├── end (nodo vuoto)
    └── page_counter (nodo vuoto)
```

**Offset aggiunto:** ~5 posizioni per i wrapper nodes.

---

## 3. Nodi Richiesti

| Nodo | Obbligatorio | Stato nel Plugin |
|------|-------------|-----------------|
| `page` | **SÌ** | ✅ Funziona |
| `start` | **SÌ** | ✅ Funziona |
| `body` | **SÌ** | ✅ Funziona |
| `end` | **SÌ** | ✅ Funziona |
| `page_counter` | **SÌ** | ✅ Funziona |
| `header` | No | Nodo opzionale |
| `footer` | No | Nodo opzionale |
| `table` | (?) | Incluso ma causa conflitto |

---

## 4. CSS Richiesto per Rilevamento Overflow

```css
.page-body {
    height: 1000px;      /* OBBLIGATORIO: altezza fissa */
    overflow: hidden;     /* OBBLIGATORIO: per overflow detection */
}

.page {
    width: 794px;         /* A4 at 96dpi */
    min-height: 1122px;    /* A4 at 96dpi */
}
```

Il plugin rileva overflow con:
```javascript
function isOverflown({ clientHeight, scrollHeight }) {
    return scrollHeight > clientHeight;
}
```

Senza `height` fisso, `clientHeight` è sempre uguale a `scrollHeight`, quindi mai overflow.

---

## 5. Dipendenze

| Pacchetto | Versione Richiesta | Conflitto? |
|-----------|-------------------|------------|
| `prosemirror-state` | ^1.x | ✅ OK |
| `prosemirror-view` | ^1.x | ✅ OK |
| `prosemirror-model` | ^1.x | ✅ OK |
| `prosemirror-utils` | ^1.x | ✅ OK |
| `prosemirror-transform` | ^1.x | ✅ OK |
| `prosemirror-tables` | **^0.9.1** | ❌ CONFLITTO (noi: 1.8.5) |

**Nota:** Il plugin include tabelle nello schema ma non dichiara correttamente la dipendenza.

---

## 6. Come Funziona il Plugin (Teoricamente)

### 6.1 Flusso Documentato

1. Utente scrive testo
2. `page-body` overflow → `scrollHeight > clientHeight`
3. Plugin chiama `splitPage()`
4. Crea nuova pagina
5. Sposta contenuto overflow nella nuova pagina
6. Aggiunge header/footer/page_counter

### 6.2 Cosa Succede Realmente

1. Utente scrive testo
2. Rileva overflow correttamente
3. Chiama `splitPage()`
4. **CRASH**: `Cannot read properties of undefined (reading 'lastChild')`
5. ❌ Nessuna pagina creata
6. Contenuto tagliato/invisibile

---

## 7. Cosa Abbiamo Imparato

### 7.1 Funziona

- ✅ Schema caricamento
- ✅ Creazione documento iniziale con struttura corretta
- ✅ JSON export/import
- ✅ Nodi base (paragraph, heading)
- ✅ Marks base (strong, em)

### 7.2 NON Funziona

- ❌ Divisione automatica pagine (bug critico)
- ❌ Editing con overflow (crash)
- ❌ Integrazione con schema esistente
- ❌ Documentazione utilizzabile

### 7.3 Integrazione con AuraWrite

**Problemi Insormontabili:**

1. **Schema Invasivo**: Dobbiamo ristrutturare tutto il documento (doc > page > body...)
2. **Posizioni Shiftate**: ~5 posizioni offset per wrapper nodes
3. **Bug Critico**: Non crea nuove pagine
4. **Dipendenze**: Conflitto con `prosemirror-tables`
5. **Suggestions Panel**: Dovrebbe essere riscritto per gestire offset
6. **AI Operations**: `findTextInDoc()` funzionerebbe, ma posizioni cambiate

**Impatto Stimato:**
- 6+ file da modificare
- Rischio di rompere AI panels esistenti
- Tempi: 2-3 giorni solo per integrazione base
- E il plugin non funziona!

---

## 8. Alternative da Considerare

### Opzione A: Visual Page Break Markers (RACCOMANDATA)

**Cosa:**
- Nessun cambio schema
- Marker visuali per interruzioni pagina (linee tratteggiate)
- Calcolo altezza con JavaScript
- Esportazione con Paged.js per PDF/ePub

**Vantaggi:**
- ✅ Nessun cambio schema
- ✅ Nessun rischio per codice esistente
- ✅ Controllo totale
- ✅ Facile da mantenere
- ✅ Funziona con AI panels attuali

**Svantaggi:**
- Non è WYSIWYG perfetto (solo preview)

**Implementazione:**
```typescript
// Plugin ProseMirror per visual markers
const pageBreakPlugin = new Plugin({
    props: {
        decorations(state) {
            const decorations = [];
            // Calcola dove cade la pagina (es. ogni 1000px)
            // Aggiungi linea tratteggiata
            return DecorationSet.create(state.doc, decorations);
        }
    }
});
```

### Opzione B: Paged.js per Export

**Cosa:**
- AuraWrite editor normale (senza pagination visuale)
- Export PDF/ePub con Paged.js
- Impaginazione professionale durante generazione

**Vantaggi:**
- ✅ Editor semplice
- ✅ Output PDF professionale
- ✅ Standard del settore (W3C)
- ✅ Nessun cambio schema

**Svantaggi:**
- Non vedi le pagine mentre scrivi

---

## 9. Codice di Test (Reference)

File salvati in `test-pagination/`:

- `test.js` - Test completo con Vite
- `index.html` - Pagina test
- `vite.config.js` - Configurazione Vite

**Per rieseguire i test:**
```bash
cd test-pagination
npm run dev
# Apri http://localhost:5173
```

---

## 10. Codice Utile dal Plugin (Reference)

### Schema Definition

```javascript
// Da prosemirror-pagination/src/schema.ts
export const schema = new Schema({
    nodes: {
        doc: { content: 'page+' },
        page: { content: 'start header? body footer? end page_counter' },
        start: { content: '', group: 'empty' },
        end: { content: '', group: 'empty' },
        page_counter: { content: '', attrs: { pageNumber: { default: 1 } } },
        body: { content: 'block+' },
        // ... altri nodi
    },
    marks: {
        strong, em, underline, code, link, // ... altri marks
    }
});
```

### Overflow Detection

```javascript
// Da prosemirror-pagination/src/paginationPlugin.ts
const isOverflown = ({ clientHeight, scrollHeight, clientWidth, scrollWidth }) => {
    return scrollHeight > clientHeight || scrollWidth > clientWidth;
};

// Nel plugin view.update
if (inserting || deleting) {
    const bodyBoundaries = pageBody.getBoundingClientRect();
    view.dispatch(tr.setMeta('splitPage', { bodyHeight, bodyWidth }));
}
```

### Split Logic (Crasha Qui!)

```javascript
// Linea 8833 nel bundle
function splitDocument(tr, state) {
    const { lastChild } = state.doc;  // ← CRASH: lastChild è undefined
    // ...
}
```

---

## 11. Conclusione

**Non usare prosemirror-pagination.**

**Motivi finali:**
1. Bug bloccante che impedisce la funzione principale
2. Documentazione insufficiente per debug
3. Manutenzione inesistente
4. Dipendenze conflittuali
5. Schema troppo invasivo

**Alternativa consigliata:** Visual Page Break Markers + Paged.js per export

---

_File da aggiornare se si riprende in considerazione in futuro._

Plugin per ProseMirror che simula impaginazione A4 nel browser.

**Repository:** https://github.com/todorstoev/prosemirror-pagination
**Versione:** 0.1.5
**Stelle:** 96
**Licenza:** MIT

---

## 2. Struttura Schema

### Schema Base (AuraWrite attuale)

```
doc (pos 0)
├── paragraph (pos 1)
│   └── text "Ciao mondo" (pos 2-12)
├── heading (pos 13)
│   └── text "Titolo" (pos 14-20)
```

### Schema Pagination (richiesto dal plugin)

```
doc (pos 0)
└── page (pos 1)
    ├── start (pos 1)              // NODO VUOTO - offset +1
    ├── header? (pos 2)            // OPZIONALE
    ├── body (pos 3)               // CONTENITORE REALE
    │   ├── paragraph (pos 4)
    │   │   └── text "Ciao" (pos 5-9)
    │   └── heading (pos 10)
    │       └── text "Titolo" (pos 11-17)
    ├── footer? (pos 18)           // OPZIONALE
    ├── end (pos 19)               // NODO VUOTO - offset +1
    └── page_counter (pos 20)      // NODO VUOTO - offset +1
```

**Offset aggiunto:** ~5 posizioni per i wrapper nodes.

---

## 3. Nodi Richiesti

| Nodo | Obbligatorio? | Descrizione |
|------|---------------|-------------|
| `page` | **SÌ** | Contenitore pagina |
| `start` | **SÌ** | Nodo vuoto, marca inizio pagina |
| `body` | **SÌ** | Contenitore del contenuto |
| `header` | No | Eventuale intestazione |
| `footer` | No | Eventuale piè di pagina |
| `end` | **SÌ** | Nodo vuoto, marca fine pagina |
| `page_counter` | **SÌ** | Nodo vuoto, contatore pagina |

---

## 4. CSS Richiesto

Il plugin cerca elementi con:

- `.page` - contenitore pagina
- `.page-body` - il body della pagina
- Attributi `id` sui paragrafi per calcolare altezze

**Layout A4:**
```css
.page {
  width: 794px;   /* A4 at 96dpi */
  min-height: 1122px;
  padding: 40px;
  margin-bottom: 20px;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
```

---

## 5. Dipendenze

| Pacchetto | Versione Richiesta | Note |
|-----------|-------------------|------|
| `prosemirror-state` | ^1.x | Standard |
| `prosemirror-view` | ^1.x | Standard |
| `prosemirror-model` | ^1.x | Standard |
| `prosemirror-transform` | ^1.x | Standard |
| `prosemirror-utils` | ^1.x | **Richiesto** per `findParentDomRefOfType` |
| `prosemirror-tables` | ^0.9.1 | **CONFLITTO** - noi abbiamo 1.8.5 |

**Issue #4 Confermata:** Conflitto con versioni recenti di `prosemirror-tables`.

**Workaround possibili:**
1. `npm install --legacy-peer-deps` (ignora conflitto)
2. Rimuovere `prosemirror-tables` se non usato
3. Forkare il plugin e aggiornare dipendenze

---

## 6. Come Funziona il Plugin

### 6.1 Inizializzazione

```javascript
import { schema, paginationPlugin } from 'prosemirror-pagination';

const state = EditorState.create({
  schema: schema,  // OBBLIGATORIO usare il loro schema
  plugins: [paginationPlugin()]
});

const view = EditorView(mountPoint, { state });
```

### 6.2 Suddivisione Pagine

Il plugin:
1. Calcola l'altezza del contenuto
2. Quando overflow → crea nuova pagina
3. Usa `splitPage()` internamente
4. Aggiunge/rimuove pagine dinamicamente

### 6.3 Calcolo Altezza

Il codice chiama:

```javascript
paragraphDOM.getBoundingClientRect().height
```

Se il paragrafo non è nel DOM, usa un fallback con padding.

---

## 7. Cosa NON Sappiamo Ancora

Domande da verificare nei test:

- [ ] Come si attiva la paginazione automatica?
- [ ] Come si inserisce testo in una posizione specifica?
- [ ] Le posizioni ProseMirror sono calcolate correttamente?
- [ ] Come si gestisce l'overflow manuale?
- [ ] Come si contano le pagine?
- [ ] Come si contano le parole?
- [ ] Header/footer come si personalizzano?
- [ ] Funziona con formattazione (bold, italic, heading)?
- [ ] Che succede con tabelle? (Issue #4)
- [ ] È possibile disabilitare le tabelle dallo schema?

---

## 8. Codice Utile dal Plugin

### Split Page (da `src/utils/splitPage.ts`)

Funzione interna che divide il contenuto tra pagine.

### Page Counter

Il nodo `page_counter` tiene traccia del numero di pagina.

### Header/Footer

Usa `sessionStorage` per cache di header/footer.

---

## 9. Problemi Noti

1. **Documentazione inesistente** - Solo 3 righe nel README
2. **Schema invasivo** - Devi usare il loro, non il tuo
3. **Conflitto tables** - Issue #4 confermata
4. **Dipendenze implicite** - Non dichiarate nel package.json
5. **Nessun esempio** - Demo directory ha solo GIF

---

## 10. Alternativa: Visual Page Break + Paged.js

Se `prosemirror-pagination` non funziona:

### Opzione A: Visual Markers

- Niente cambio schema
- CSS linee tratteggiate per interruzioni pagina
- Calcolo altezza con JavaScript
- Esportazione con Paged.js per PDF/ePub

### Opzione B: Paged.js per tutto

- Editor senza impaginazione visuale
- Export con Paged.js che impagina durante generazione PDF
- Più semplice da mantenere

---

## 11. Risorse

- Repository: https://github.com/todorstoev/prosemirror-pagination
- Codice sorgente utile: `src/paginationPlugin.ts`, `src/schema.ts`, `src/utils/splitPage.ts`
- Alternativa: https://pagedjs.org/

---

_Questo documento va aggiornato ad ogni nuova scoperta su pagination._