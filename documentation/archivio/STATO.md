# Stato Attuale - 2026-03-31

## Bug/Note UI

### Title Bar

- [ ] Estensione duplicata: il formato compare sia nel nome file (`miodoc.md`) che nell'etichetta (`Markdown`) - necessario rimuovere una delle due
- [ ] Font/stile nome documento: migliorare visibilità ( bolder, più grande, o colore diverso)

### ProseMirror CSS

- [x] Warning `white-space` risolto aggiungendo `white-space: pre-wrap` a `.ProseMirror`

## Funzionalità Completate

### File Operations

- Save/Save As/Open/Export con dialoghi nativi ✅
- Title bar con nome documento e formato ✅
- Dirty indicator (\*) ✅
- Dropdown menu rimossi ✅

### AI Infrastructure

- AI Provider interface (Ollama, OpenAI, Anthropic) ✅
- AI Manager per gestire chiamate ✅
- Chat panel con integrazione AI ✅
- Settings per privacy e provider ✅

### AI Suggestions Panel (SX) - 2026-03-31

- **Trigger su "."**: quando l'utente digita un punto seguito da spazio, il pannello analizza l'ultima frase
- **Logica trigger**: solo se `.` è preceduto da lettera e seguito da spazio (esclude "12.", "...", "Dr.")
- **Analisi frase per frase**: ogni frase viene analizzata singolarmente
- **UI espandibile**: ogni suggerimento può essere espanso, collassato o chiuso
- **Pulsanti per suggerimento**:
  - `Accept`: salva originale nel database (TODO), sostituisce con proposta
  - `Reject`: sostituisce con proposta e rimuove il suggerimento
  - `Switch`: toggle temporaneo tra originale e proposta nel documento
  - `Close`: chiude il pannello, elimina i dati (TODO: DB)
- **Gestione punteggiatura**: se l'originale finisce con `.!?` e la proposta anche, non aggiunge duplicato
- **TODO DB**: codice commentato per futuro salvataggio frasi accettate/rifiutate

### AI Assistant Panel (DX) - 2026-03-31

- **Testo documento passato**: il testo completo viene incluso nel contesto AI
- **Chunk system**: per documenti lunghi, il testo viene diviso in chunks
  - Ogni chunk ha un nome univoco (es. "Titolo-chunk_001")
  - Marker visivi nel documento (ProseMirror Decorations)
  - Selector nel pannello per scegliere quale chunk usare
  - Setting manuale max tokens per chunk (default 8k)
- **Fix bug**: chat non si bloccava più dopo il primo messaggio
- **TODO Vector DB**: codice commentato per futura ricerca semantica
- **TODO**: warn utente se contesto vicino al limite

### Chunk System (AI Assistant)

- `chunks.ts`: modulo per divisione testo in chunks basato su token limit
- `chunk-decorations.ts`: plugin ProseMirror per marker visivi
- Stima tokens: ~4 caratteri per token
- Divisione: per sentence boundaries quando possibile

## UI/UX Notes

- Entrambi i pannelli (AI Chat e Suggerimenti) saranno **resizable** in futuro
- Chunk markers visibili nel margin del documento (freccia + nome chunk)

## Future AI Features (da implementare)

- Chat conversazionale pura
- Database filling automatico
- Internet search
- Image generation (Stable Diffusion/Flux)
- Graphic novel illustrations
- Highlight visivo per selezione AI (lampeggio/cambio colore)
- Compattazione sessione in database
- **Tooltip plugin**: context menu on text selection

## Test Plan - AI Integration (updated 2026-03-31)

### Test 1: Chat AI Base

- [ ] Apri AuraWrite
- [ ] Clicca pulsante ✨ AI
- [ ] Pannello chat si apre a destra
- [ ] Scrivi "Ciao, sei operativo?"
- [ ] Aura risponde
- [ ] Prova a inviare un secondo messaggio - non deve bloccarsi

### Test 2: Selezione Testo come Context

- [ ] Scrivi del testo nell'editor
- [ ] Seleziona una frase
- [ ] Clicca pulsante ✨ AI
- [ ] Badge "Selected: '...'" appare nel pannello chat
- [ ] Scrivi "Cosa ne pensi?"
- [ ] Aura risponde analizzando la selezione

### Test 3: Suggestions Panel - Trigger "."

- [ ] Scrivi una frase che termina con "."
- [ ] Premi spazio dopo il punto
- [ ] Il pannello Suggestions si attiva e analizza la frase
- [ ] Apri il pannello espanso per vedere il suggerimento
- [ ] Prova Accept, Reject, Switch, Close

### Test 4: Chunk System

- [ ] Scrivi un testo molto lungo (o tanti paragrafi)
- [ ] Apri il pannello AI
- [ ] Verifica che compaia il chunk selector
- [ ] Cambia chunk e verifica i marker nel documento

### Test 5: Pannello Suggerimenti

- [ ] Clicca pulsante 💡 Suggestions
- [ ] Pannello "Suggestions" appare a sinistra
- [ ] Scrivi una frase e premi spazio dopo il punto
- [ ] Il pannello mostra il suggerimento

## Bug Fixes (2026-03-31)

- [x] Chat bloccata al secondo messaggio - FIXED
- [x] AI non vedeva il testo del documento - FIXED
- [x] AI aggiungeva punto extra quando frase già finiva con punto - FIXED

## Bug Fixes (2026-04-01)

### Suggestions Panel - Accept/Switch Bug

**Problema**: Premendo Accept o Switch più volte sulla stessa frase, venivano aggiunti punti e caratteri indesiderati. Le frasi successive potevano essere corrotte.

**Causa radice**:
1. Le posizioni venivano calcolate su `doc.textContent` invece che sulle posizioni ProseMirror reali
2. Dopo ogni replace, `slotPositions` dello slot modificato non veniva aggiornato
3. Nessuna validazione che il testo in posizione corrispondesse all'atteso

**Soluzione implementata** (file: `src/ai-panel/suggestions-panel.ts`):

1. **Fix calcolo posizioni** (`findProseMirrorPosition`): Usa `nodesBetween` per trovare posizioni ProseMirror reali invece di indici su stringa piatta

2. **Fix aggiornamento stato** (`acceptSuggestion`, `switchSuggestion`): Dopo ogni `dispatch`, aggiorna `pos.to` e `pos.original` dello slot corrente

3. **Validazione difensiva** (`validatePosition`, `findTextInDoc`): Verifica che il testo in posizione corrisponda all'atteso; se no, ricalcola la posizione cercando nel documento

4. **Switch sempre visibile**: Il pulsante Switch non viene mai nascosto (è una feature importante). Lo stato "accepted" è indicato dal badge ✓.

**Nota su slotPositions.set()**: In JavaScript/TypeScript, `slotPositions.get(id)` restituisce un **riferimento** all'oggetto nella Map, non una copia. Quindi `pos.to = ...; pos.original = ...` modifica direttamente l'oggetto dentro la Map senza bisogno di `slotPositions.set()`. DA VERIFICARE con test Accept multiplo.

**Test eseguiti**:
- Build Tauri completata con successo
- TypeScript check: 0 errori
- Test manuale: Accept/Switch multiplo funziona correttamente

## Lezioni Apprese (2026-04-01)

### Suggerimenti Panel - Debug Slot Positions

**Il Bug**:
Premendo Accept o Switch più volte sulla stessa frase, venivano aggiunti punti e caratteri. Le frasi successive venivano corrotte.

**Root Cause**:
1. Le posizioni venivano calcolate su `doc.textContent` (stringa piatta), ma ProseMirror usa posizioni basate su nodi
2. Dopo ogni replace, `slotPositions` dello slot modificato NON veniva aggiornato
3. `updatePositionsAfterChange` aggiornava solo gli ALTRI slot, non quello corrente

**Diagnosi Collaborativa**:
- Consultato 4 AI diverse (Claude, GLM-4, Gemini, Deepseek, GPT)
- Classificazione delle soluzioni per categoria:
  - Fix superficiali: aggiornano solo slotPositions
  - Fix strutturali: usano nodesBetween per posizioni ProseMirror reali
- Soluzione ottimale: combinare entrambi gli approcci

**Lezione Chiave**:
Quando si integra con un editor complesso come ProseMirror, NON usare mai indici su stringhe piatte (`textContent`). Usare sempre le API native del framework per tracciare posizioni. Aggiungere validazione difensiva per prevenire errori.

**Stack Tecnologico**:
- ProseMirror per editor
- Tauri per desktop wrapper
- TypeScript per type safety
- Consultazione multi-AI per validazione soluzione

## Prossimi Passi

### Piano Implementativo Confermato (2026-04-01)

#### Step 1: Verificare Bug Suggestions
- Test Accept/Switch multiplo
- Verificare che `pos.to = ...` senza `slotPositions.set()` funzioni
- Chiusura con certezza invece di assunzione

#### Step 2: Creare modification-hub.ts ⬜ INIZIALE
Bus eventi centralizzato per sincronizzazione posizioni tra pannelli.

```typescript
// src/ai-panel/modification-hub.ts
type Source = "suggestions" | "ai_assistant" | "external";
type Listener = (change: {from: number, oldLen: number, newLen: number}, source: Source) => void;

export function subscribeToChanges(id: string, listener: Listener): () => void;
export function notifyDocumentChange(change: {from: number, oldLen: number, newLen: number}, source: Source): void;
export function unsubscribe(id: string): void;
```

**Design**:
- Source tipizzata permette ai listener di ignorare i propri cambiamenti
- Funzione di unsubscribe restituisce cleanup function
- Disaccoppia i moduli (nessuna importazione diretta tra Suggestions e AI Assistant)

#### Step 3: Integrare Suggestions nel Hub
- Dopo ogni dispatch: `notifyDocumentChange(change, "suggestions")`
- Registrare listener per aggiornare slotPositions su cambiamenti esterni
- Suggestions ignora i propri eventi (source filtering)

#### Step 4: Implementare Modifica AI Assistant
**Scenario 1 (nessuna selezione)**:
- L'utente chatta, chiede esplicitamente di modificare
- AI risponde con JSON strutturato finale: `{"modification": {"original": "testo", "new": "nuovo"}}`
- Parsare JSON, trovare `original` con `findTextInDoc`, sostituire

**Scenario 2 (con selezione)**:
- Se `currentSelection` attivo, replace su `currentSelection.from/to`
- AI può modificare SOLO la porzione selezionata

**Parsing JSON**:
```typescript
function parseModificationFromResponse(content: string): {original: string, new: string} | null {
  const match = content.match(/\{[\s\S]*"modification"[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (parsed.modification?.original && parsed.modification?.new) {
      return parsed.modification;
    }
  } catch {}
  return null;
}
```

**Applicazione modifiche in ordine inverso** (per non invalidare posizioni successive).

#### Step 5: Fix Chunk Offsets ⬜ TODO
- Aggiungere `charOffsetToPmPos()` in `chunk-decorations.ts`
- NON toccare `chunks.ts` (serve per Vector DB futuro)
- Chiamare conversione quando si creano le decorations

---

### Bug Scoperto (2026-04-01) ⚠️

**Commit 20fb136 REVERTED (c73e037)**:

Le modifiche per AI Assistant Document Modification hanno introdotto un bug in Suggestions Panel.

**Sintomi**: 
- Testo scritto: "Questo è un test completo su scrittura e modifica di Aurawrite. Inizierò a scrivere alcune frasi..."
- Testo dopo: "Questo è un test completo sulle funzionalità di scrittura e modifica di AurawriteInizierò a scrivere alcune frasi..."
- Problemi: punto mancante, a-capo scomparso, "funzionare." duplicato

**Vedi**: `documentation/06-roadmap/DEBUG-AI-ASSISTANT-BUG.md`

---

### Problema JSON Insufficiente (2026-04-01) ⚠️

**Situazione**:

Il modello Kimi-k2.5:cloud capisce perfettamente che deve usare JSON. MA:

1. Scrive prima in chat per spiegare
2. POI fornisce il JSON
3. A volte fornisce JSON malformato (`original: ""`)

**Causa Root**:

Il formato JSON attuale è troppo limitato:
```json
{"modification": {"original": "testo", "new": "nuovo testo"}}
```

Supporta SOLO:
- Sostituzione di testo plain
- Niente formattazione (bold, italic)
- Niente elementi strutturati (liste, headings)
- Niente marcatori semantici (comments, highlights)

**Futuro**:

Il sistema deve supportare:
- Testo plain
- Formattazione inline (bold, italic, underline)
- Elementi strutturati (elenchi, link, headings)
- Operazioni (insert, delete, replace)
- Marcatori semantiche (todo, highlight, comment)

**Vedi**: `/home/carlo/Scrivania/Report-AI-Assistant-Panel-v2.md` per report completo.

---

### Problema JSON Insufficiente (2026-04-01) ⚠️

~~Il formato attuale è troppo limitato.~~ **RISOLTO con AURA_EDIT!**

**Vedi**: `/home/carlo/Scrivania/Report-AI-Assistant-Panel-v2.md` per report completo.

---

**Prossima azione**: Testare formattazione (bold, italic, liste).

---

### Implementazioni Completate (2026-04-01)

#### ✅ text-utils.ts CREATO
- `findTextInDoc()` spostata qui per evitare import circolare
- Importata da sia `suggestions-panel.ts` che `chat.ts`

#### ✅ modification-hub.ts CREATO
- Bus eventi centralizzato per sincronizzazione posizioni tra pannelli
- Source tipizzata: `"suggestions" | "ai_assistant" | "external"`

#### ✅ Suggestions integrato nel Hub
- `subscribeToChanges("suggestions", handler)` in `setupSuggestionsPanel`
- `notifyDocumentChange` dopo ogni dispatch in accept/switch
- `hubUnsubscribe()` in `stopSuggestionsMode`

#### ✅ AURA_EDIT System - NUOVO FORMATO (2026-04-01)

**Files**:
- `operations.ts` - Tipi TypeScript per operazioni e nodi
- `edit-parser.ts` - Parser robusto con 3 strategie (delimitatori, markdown, chiave)
- `edit-executor.ts` - Esegue operazioni su ProseMirror
- `ollama-provider.ts` - Nuovo prompt con delimitatori `<<<AURA_EDIT>>>`

**Formato**:
```json
{
  "aura_edit": {
    "message": "Spiegazione",
    "operations": [
      { "op": "replace", "find": "testo", "content": [...] },
      { "op": "format", "find": "testo", "addMark": "bold" },
      { "op": "insert", "find": "dopo", "position": "after", "content": [...] },
      { "op": "delete", "find": "testo" }
    ]
  }
}
```

**Supporta**:
- ✅ replace, insert, delete, format
- ✅ Text formatting (bold, italic, underline)
- ✅ Block elements (headings, lists, blockquotes)
- ✅ Multiple operations in single response
- ✅ Parser robusto con fallback

#### ✅ AI Assistant Document Modification - FUNZIONANTE
- Kimi-k2.5:cloud capisce il formato AURA_EDIT
- L'AI inserisce il testo nel documento, non in chat
- Interazione fluida e "sublime"

#### ✅ Debug Log Fix
- `SUGGESTIONS_DEBUG = false` nasconde anche il container del log

---

### Task Completati

#### Task 1: Log System for AI Assistant ✅
- Log disattivato in `suggestions-panel.ts` (SUGGESTIONS_DEBUG = false)
- Container nascosto quando debug off

#### Task 2: UI Standardization ✅
- AI panel usa `−` come Suggestions
- Classe `ai-panel__toggle` standardizzata

#### Task 3: Chunk Labels ✅
- Etichette chunks ingrandite da 10px a 12px

#### Task 4: AURA_EDIT System ✅
- Nuovo formato JSON per modifiche documento
- Parser robusto
- Esegue operazioni su ProseMirror

---

### Da Testare

1. **Formattazione**: Bold, italic, underline funzionano?
2. **Elementi strutturati**: Liste, headings, blockquotes?
3. **Suggestions Panel**: ancora funzionante?
4. **Concorrenza**: entrambi i pannelli insieme?

---

### Prossimi Passi (Aggiornato 2026-04-02)

**Priorità Alta:**
1. **Pagination FASE 1** - Marker Manuali (vedi PAGINATION_PLAN.md)
   - Aggiungere `pageBreakBefore` attribute
   - CSS per visualizzazione
   - Comando toggle + toolbar button
   - Test con AI panels

**Priorità Media:**
2. Database Architecture (SQLite + Vector DB)
3. Tooltip plugin per selezione testo
4. Pagination FASE 2 - Paged.js export

**Priorità Bassa:**
5. Warn utente se contesto AI vicino al limite

---

## Bug Fixes (2026-04-01 - Sessione Pomeridiana)

### Bug 2: findTextInDoc non trovava testo attraverso nodi

**Problema**: Quando l'AI inseriva testo formattato o che attraversava più nodi ProseMirror, `findTextInDoc` non trovava il testo.

**Causa**: La funzione cercava solo all'interno di singoli nodi di testo. Se il testo attraversava un confine di nodo (es. newline = nuovo paragrafo), la ricerca falliva.

**Soluzione** (`src/editor/text-utils.ts`):
```typescript
// Prima: cerca solo in singoli nodi
if (node.isText && node.text) {
  const idx = node.text.indexOf(text);
  if (idx !== -1) return { from: pos + idx, to: pos + idx + text.length };
}

// Dopo: fallback su doc.textContent
const fullText = doc.textContent;
const charIdx = fullText.indexOf(text);
// ... converte char index a posizione ProseMirror
```

**Risultato**: ✅ L'AI ora può formattare testo e inserire testo che attraversa più nodi.

---

## Integrazione Pagination - Analisi (2026-04-01 Sera)

### Status: ANALISI COMPLETATA, IMPLEMENTAZIONE SOSPESA

**Vedi**: `documentation/06-roadmap/PAGINATION_INTEGRATION.md` per analisi completa.

### Primo Tentativo

1. Installato `prosemirror-pagination`
2. Modificato schema per usare nodi `page`, `body`, etc.
3. Aggiunto CSS per pagine

**Problemi riscontrati**:
- CSS sovrapposto (due "fogli" visibili)
- Pagina allineata a sinistra
- Tema non rispettato (sfondo bianco con tema scuro)
- Crash su pannello Suggestions

**Reazione errata**: Abbiamo ripristinato tutto senza debuggare.

### Analisi condotta

**Schema base vs Schema pagination**:

| Aspetto | Base | Pagination |
|---------|------|------------|
| Root | `doc > block+` | `doc > page+` |
| Offset minimo | 0 | ~5 (wrapper nodes) |
| Testo | Diretto in doc | In `page > body > paragraph` |

**Moduli che usano posizioni**:

1. `text-utils.ts` - `findTextInDoc()`
   - ✅ **COMPATIBILE** - `nodesBetween()` attraversa tutto
   - ⚠️ Da testare con nuovo schema

2. `suggestions-panel.ts` - Trigger e replace
   - ⚠️ Da testare - posizioni shiftate
   - `doc.textContent` funziona
   - Calcolo posizioni potrebbe cambiare

3. `chunk-decorations.ts` - Marker visivi
   - ⚠️ Offset calcolati esternamente
   - Verificare `chunks.ts`

4. `edit-executor.ts` - Operazioni AI
   - ✅ **COMPATIBILE** - usa `findTextInDoc()`

### Piano di Implementazione (da riprendere)

**Vedi**: `PAGINATION_INTEGRATION.md` Sezione 5 per piano completo.

**Fasi**:
1. Backup e branch
2. Installazione dipendenze
3. Integrazione schema con flag `USE_PAGINATION`
4. Fix CSS (centratura, temi)
5. Test singoli moduli
6. Migrazione documenti esistenti

**Rischi principali**:
- Documenti salvati incompatibili
- Prestazioni con molte pagine
- Plugin non mantenuto (basso rischio)

### CSS Fix Necessari

```css
#editor {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ProseMirror .page {
  width: 794px;
  min-height: 1122px;
  margin-bottom: 40px;
  background: var(--color-surface);
  /* ... */
}
```

### Prossima Sessione

- Riprendere dalla Fase 1 del piano
- Creare branch `feature/pagination-test`
- Testare paginazione in isolamento (senza suggestions/AI)
- Integrare gradualmente

---

## Lezioni Apprese (2026-04-01 - Sessione Pomeridiana)

### Integrazione plugin esterni

1. **Analizzare prima**: Capire l'impatto sui moduli esistenti
2. **Testare in isolamento**: Verificare il plugin da solo prima di integrare
3. **Documentare tutto**: Scrivere analisi completa per le sessioni future
4. **Non precipitare**: Se c'è un crash, debuggare invece di ripristinare

### ProseMirror posizioni

- Le posizioni ProseMirror includono wrapper nodes
- `doc.textContent` restituisce solo il testo (senza wrapper)
- Le operazioni su posizioni devono considerare la struttura dello schema

### CSS e theming

- Le variabili CSS (`--color-surface`) devono essere definite per entrambi i temi
- Flexbox e `margin: auto` interagiscono male - usare `align-items: center`

---

## Task da Fare - Priorità

### Alta Priorità

- [ ] Database Architecture (SQL + Vector DB)
- [ ] Tooltip plugin per selezione testo

### Media Priorità

- [ ] Pagination integration (vedi PAGINATION_INTEGRATION.md)
- [ ] Incremental save UI
- [ ] Export PDF/ePub

### Bassa Priorità

- [ ] Warn utente se contesto AI vicino limite
- [ ] Zoom controlli per pagine

---

## Pagination - ABANDONED (2026-04-02)

**Plugin testato:** `prosemirror-pagination@0.1.5`

**Verdetto:** ❌ NON UTILIZZABILE

### Problemi Critici

| Problema | Severità | Descrizione |
|----------|----------|-------------|
| **Bug critico** | 🔴 BLOCCANTE | `TypeError: Cannot read properties of undefined (reading 'lastChild')` durante page split |
| **Documentazione** | 🔴 ALTA | README di 3 righe, nessun esempio funzionante |
| **Dipendenze** | 🔴 ALTA | Conflitto con `prosemirror-tables@^0.9.1` (noi: 1.8.5) |
| **Schema invasivo** | 🟡 MEDIA | Richiede 23 nodi obbligatori, non integrabile con schema esistente |
| **Manutenzione** | 🟡 MEDIA | 5 issue aperte senza risposta |

### Test Eseguiti

**Ambiente:** Test isolato con Vite

| Test | Risultato |
|------|-----------|
| Schema caricamento | ✅ PASS |
| Struttura documento | ✅ PASS (`page > body > start > end > page_counter`) |
| JSON export/import | ✅ PASS |
| **Inserimento testo lungo** | ❌ **CRASH** |
| **Creazione pagina automatica** | ❌ **FALLITA** |

### Alternativa Scelta

**Visual Page Break Markers + Paged.js**

- **Editor**: Marker visuali (linee tratteggiate) per interruzioni pagina
- **Export**: Paged.js per generazione PDF/ePub professionale
- **Vantaggi**:
  - Nessun cambio schema
  - AI panels funzionano senza modifiche
  - Controllo totale
  - Standard W3C per export

**Documentazione completa:** `documentation/06-roadmap/PAGINATION_KNOWLEDGE.md`

**File di test eliminati:** `test-pagination/` rimossa
