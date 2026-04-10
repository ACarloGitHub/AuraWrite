# Resume Memo - AuraWrite AI Integration

**Last Session:** 2026-04-03 (sera)
**Status:** Piano implementazione completato. Da iniziare FASE 1 (Suggestions)

---

## Sessione 2026-04-03 (Sera) — Piano Definitivo

### ✅ Obiettivo Raggiunto

Piano di implementazione completo scritto in `documentation/PIANO_IMPLEMENTAZIONE.md`.

### 📋 Piano Approvato (3 Fasi)

| Fase | Descrizione | Priorità |
|------|-------------|----------|
| **FASE 1** | Fix Suggestions con ProseMirror Decorations | 🔴 MASSIMA |
| **FASE 2** | Fake Pagination con Pretext (formato A4) | 🔴 ALTA |
| **FASE 3** | Justify (futuro) | 🟡 MEDIA |

### 🔑 Decisioni Prese

1. **Fake Pagination**: Rettangoli A4 separati, editabili, impilati verticalmente
2. **Pretext**: Calcola altezze per overflow, NON per tracciare slot
3. **Suggestions**: ProseMirror Decorations (soluzione definitiva)
4. **Justify**: Non prioritario per ora

### 📁 Riferimenti

| File | Contenuto |
|------|-----------|
| `documentation/PIANO_IMPLEMENTAZIONE.md` | **⭐ PIANO COMPLETO** |
| `documentation/06-roadmap/Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md` | Analisi bug + proposte AI |
| `AGENTS.md` | Aggiornato con riferimento al piano |

### ⏭️ Prossima Sessione

1. Leggere `PIANO_IMPLEMENTAZIONE.md`
2. Iniziare **FASE 1**: Suggestions con Decorations
3. Creare `src/editor/suggestions-marker-plugin.ts`

---

## Sessione 2026-04-03 (Pomeriggio) — Analisi Pretext per Layout Pagine

### 📋 Obiettivo

Implementare **Layout A4 WYSIWYG completo** con:
- Margini configurabili dall'utente
- Font e line-height dinamici
- Posizioni testo precise per Suggestions Panel
- Pretext come motore di calcolo veloce

### ❌ Problema: Proposte AI Fuorvianti

Le AI consultate (Claude, Gemini, Deepseek, Qwen) hanno proposto soluzioni che:
- Nascondono l'editor ProseMirror (container separato)
- Creano anteprima pagine in modalità "sola lettura"
- **NON corrisponde a ciò che Carlo ha chiesto**

Carlo vuole: **WYSIWYG completo** — editare mentre vedi le pagine A4.

### 🔬 Analisi Pretext Completa (v0.0.4)

**Cosa può fare:**

| Feature | Supporto | Note |
|---------|----------|------|
| Calcolo altezza testo | ✅ SÌ | `layout()` in ~0.1-0.5ms |
| Conteggio righe | ✅ SÌ | `layoutWithLines()` |
| Resize window | ✅ ISTANTANEOO | `layout()` con nuovo width |
| Cambio line-height | ✅ ISTANTANEOO | Parametro di `layout()` |
| Documenti 100+ pagine | ✅ SÌ | Chunk per paragrafo: 10-60ms/paragrafo |

**Cosa NON può fare:**

| Feature | Supporto | Problema |
|---------|----------|----------|
| **Text-align: justify** | ❌ NO | Non implementato, usa greedy breaking |
| **Letter-spacing** | ❌ NO | Issue #78 aperto |
| **Word-spacing** | ❌ NO | Non supportato |
| Inline formatting (bold/italic) | ⚠️ PARZIALE | Sperimentale con `prepareInlineFlow()` |
| Margini/padding | ❌ NO | Pretext misura solo testo, non contenitore |

**Performance reale:**

| Documento | Caratteri | `prepare()` | `layout()` |
|-----------|-----------|------------|-----------|
| Arabo (106K) | 106,857 | 63.4ms | 0.3ms |
| Cinese (9K) | 9,428 | 19ms | 0.08ms |
| Sintetico (78K) | 78,679 | 18.9ms | 0.42ms |

**Per keystroke in tempo reale:**
- `prepare()` necessario per testo cambiato → 1-3ms per paragrafo
- `layout()` per resize → <0.5ms (istantaneo)

### 🚨 Gap Critici per WYSIWYG Professionale

1. **Justify non supportato** — Problema serio per word processor
2. **Letter/word spacing non supportati** — Issue #78 aperto
3. **Ogni cambio font richiede re-prepare** — 10-60ms
4. **Architettura attuale di `pagination.ts`** — Crea container separato (non voluto)

### 📐 Stato Attuale Codice

**File esistenti:**
- `src/editor/pagination.ts` — Modulo Pretext con `paginate()`, `measureNode()`, `getLineInfo()`
- `src/editor/editor.ts` — Entry point ProseMirror, schema con `pageBreakBefore`
- `src/editor/page-break-widget.ts` — Widget per page break manuali

**Problema identificato:**
- `renderPages()` crea un container separato `.aw-paginated-container`
- Nasconde l'editor ProseMirror
- **Non è quello che Carlo vuole**

### ❓ Domande Aperte

| # | Domanda | Opzioni |
|---|---------|---------|
| 1 | **Justify è indispensabile?** | A) Sì → servono misurazioni DOM | B) No per ora → usare Pretext |
| 2 | **Come visualizzare "Pagina 2"?** | A) Linee tratteggiate inline | B) Margini visivi A4 | C) Blocchi pagina separati |
| 3 | **Cosa deve fare Pretext?** | A) Calcolare overflow | B) Bounds per Suggestions | C) Entrambi | D) Solo per export PDF |
| 4 | **Font/margini dinamici: quando?** | A) Solo in preferenze globali | B) Anche durante editing in tempo reale |

### 📊 Piano di Test (Da Definire)

**Test separati necessari:**

1. **Test Pretext con documenti lunghi** — Verificare performance reali
2. **Test justify alignment** — Verificare se servono workaround
3. **Test integrazione ProseMirror** — Mantenere editing mentre si vedono pagine
4. **Test bounds per Suggestions** — Verificare accuratezza posizioni pixel

### 📁 Documentazione della Sessione

| File | Contenuto |
|------|-----------|
| `/home/carlo/Scrivania/AuraWrite_Layout_Pagine_Relazione.md` | Relazione tecnica preparata da Carlo |
| `/home/carlo/Scrivania/Proposte3.md` | Proposte AI (fuorvianti) |
| `/home/carlo/Scrivania/AuraWrite_Layout_Pagine/` | Files di test layout |

### ⏭️ Prossimi Passi (InOrdine di Priorità)

1. **Chiarire architettura** — Rispondere alle 4 domande
2. **Decidere strategia justify** — Pretext vs DOM vs custom
3. **Creare test plan separato** — Un test per ogni aspetto
4. **Integrare Pretext correttamente** — Plugin ProseMirror senza container separato

---

## Sessione 2026-04-03 (Mattina)

### ✅ Page Break Implementati

**Funzionalità completate:**
- Widget con pulsante X per rimozione singola
- Nuovo paragrafo automatico dopo il marker
- CSS del foglio: ora cresce con il contenuto
- Export HTML e Markdown con page break

**Bug confermato in Suggestions:**
- Switch su frasi identiche: modifica la frase sbagliata
- Slittamento posizioni in documenti lunghi
- Page break aggrava il problema

**Documentazione:**
- `/home/carlo/Scrivania/RESOCONTO_BUG_SUGGESTIONS.md` - Resoconto dettagliato
- `/home/carlo/Scrivania/Proposte.md` - Proposte da multiple AI
- `/mnt/AI-Ubuntu/progetti/AuraWrite/documentation/06-roadmap/Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md` - Copia
- `/mnt/AI-Ubuntu/progetti/AuraWrite/documentation/06-roadmap/PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md` - Piano fasi

---

## Piano Implementazione Suggestions

### FASE 1: Fix oldLen (IMMEDIATO)
- Calcolare oldLen DOPO la validazione, non prima
- Riferimento: PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md

### FASE 2: findTextInDocNear (RAPIDO)
- Funzione che cerca vicino alla posizione attesa
- Sostituisce findTextInDoc nel fallback

### FASE 3: ProseMirror Decorations (LUNGO TERMINE)
- Soluzione definitiva con Decorations
- Riferimento: AI_PROPOSTE_BUG_SUGGESTIONS.md - Proposta Gemini (10/10)

### FASE 4: Limite Frasi per Suggestions (PERFORMANCE)
- Evita analisi di tutto il documento con molto testo
- Preferenze: First/Last + numero frasi (default 10)
- Riferimento: PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md

---

## Riferimenti Importanti

| File | Descrizione |
|------|------------|
| `RESUME_MEMO.md` | Questo file |
| `PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md` | Piano fasi fix Suggestions |
| `Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md` | Analisi e proposte da multiple AI |

---

## Sessione Precedenti

### 2026-04-02

### ❌ TEST PAGINATION COMPLETATO - VERDETTO NEGATIVO

**Risultato:** `prosemirror-pagination` NON è utilizzabile.

**Test eseguiti:**
- Setup: Test isolato con Vite ✅
- Schema: Caricamento corretto ✅
- Struttura: `doc > page > body > start > end > page_counter` ✅
- **Crash critico sullo split** ❌

**Bug fatale:**
```
TypeError: Cannot read properties of undefined (reading 'lastChild')
at Plugin.appendTransaction (prosemirror-pagination.js:8833)
```

**Problemi confermati:**
1. ❌ Bug critico: crash durante page split
2. ❌ Documentazione inesistente (3 righe README)
3. ❌ Dipendenze conflittuali (tables@0.9.1 vs 1.8.5)
4. ❌ Schema invasivo (23 nodi obbligatori)
5. ❌ Zero manutenzione (issue aperte senza risposta)

**Documentazione completa:** `documentation/06-roadmap/PAGINATION_KNOWLEDGE.md`

---

### ✅ DECISIONE: Visual Page Break Markers + Paged.js

**Alternativa scelta:**
- **Inline:** Visual markers nel editor (linee tratteggiate per interruzioni pagina)
- **Export:** Paged.js per generazione PDF/ePub professionale

**Vantaggi:**
- ✅ Nessun cambio schema ProseMirror
- ✅ Nessun rischio per codice esistente
- ✅ AI panels funzionano senza modifiche
- ✅ Controllo totale sull'implementazione
- ✅ Standard W3C per export

---

## Sessione 2026-04-02

### PIANO PAGINATION APPROVATO

**Obiettivo:** Testare `prosemirror-pagination` in isolamento per decidere se usarlo.

**FASI:**

**FASE 1: Test Isolato con Vite** (IN CORSO)
- Setup: test-pagination/ con Vite (NON HTML vanilla)
- Scopo: Capire come funziona il plugin
- Documentare: Tutto ciò che impariamo su pagination

**FASE 2: Test Base**
- Editor visivo funzionante
- Verificare: scrittura, overflow, nuova pagina automatica

**FASE 3: Test Avanzati**
- Formattazione: titoli, giustificazioni, a capo
- Conteggio: pagine, parole, coordinate documento
- Verificare: posizioni ProseMirror con schema pagination

**FASE 4: Consultazione AI Esterne**
- Fornire: conoscenza accumulata su pagination
- Fornire: codice attuale di `suggestions-panel.ts`
- Chiedere: ristrutturazione per compatibilità schema pagination
- Coinvolgere: Claude, Gemini, DeepSeek, GPT

**FASE 5: Decisione**
- Se pagination funziona bene → integrare
- Se pagination problematico → fallback (visual page break + Paged.js)

**DOCUMENTAZIONE OBBLIGATORIA:**
- Scrivere TUTTO ciò che impariamo su pagination
- Aggiornare `documentation/06-roadmap/PAGINATION_KNOWLEDGE.md`
- Aggiornare RESUME_MEMO.md ad ogni sessione
- NON perdere tempo a rileggere cose già fatte

**BRANCH:** `feature/pagination-test` (da creare)

**COSA SAPPIAMO GIÀ:**
- Schema pagination richiede: `doc > page > start > body > content > end > page_counter`
- Offset aggiuntivi: ~5 posizioni per wrapper nodes
- Dipendenza: `prosemirror-tables@^0.9.1` (conflitto con nostra 1.8.5)
- Workaround: usare `--legacy-peer-deps` o rimuovere tables
- Il plugin include tabelle nello schema (ma noi non le usiamo)

---

## Sessione 2026-04-01 (Mattina)

### Discussione Importante: Strategia Pagination

Abbiamo discusso a fondo come procedere con l'impaginazione professionale.

**Obiettivo chiaro**: AuraWrite come strumento completo per scrivere E pubblicare (libri, ebook, documenti formali).

**Tre livelli di complessità identificati:**

| Livello | Cosa | Difficoltà |
|---------|------|------------|
| Page Break Manuale | Utente inserisce interruzione pagina | BASSA |
| Visualizzazione Pagine | Linee tratteggiate che mostrano dove cade la pagina | MEDIA |
| prosemirror-pagination | Struttura documento cambiata in `doc > page > body` | ALTA |

**Possibili alternative a ProseMirror:**

| Editor | Pagination | Note |
|--------|------------|------|
| Lexical (Meta) | Nessuna | Non adatto per document editing |
| CKEditor 5 | Sì (premium) | Costo licenza, migrazione massiva |
| TipTap | Sì (plugin) | È ProseMirror sotto |
| **Rimanere su ProseMirror** | Via Paged.js | **RACCOMANDATO** |

### Completato (2026-04-01 e 2026-04-02)

1. **Bug fix findTextInDoc** - Ora attraversa correttamente i nodi ProseMirror
   - File: `src/editor/text-utils.ts`
   - L'AI può ora formattare testo e inserire testo che attraversa paragrafi

2. **Test completo AI Assistant**
   - ✅ L'AI legge il documento
   - ✅ L'AI inserisce testo formattato
   - ✅ L'AI applica modifiche con AURA_EDIT

3. **Analisi e test prosemirror-pagination** - **RISULTATO: ABANDONED**
   - Vedi `PAGINATION_KNOWLEDGE.md` per dettagli completi
   - Bug critico: crash su split (`lastChild` undefined)
   - Documentazione inesistente
   - Conflitto dipendenze (`prosemirror-tables`)

4. **Piano Pagination Definitivo** - **APPROVATO**
   - Vedi `PAGINATION_PLAN.md`
   - Strategia: Marker Manuali → Paged.js per export
   - Nessun cambio schema ProseMirror
   - AI panels continuano a funzionare

---

## Cosa è Stato Fatto (Storico)

### AI Infrastructure

- `src/ai-panel/providers.ts` - AIProvider interface, settings
- `src/ai-panel/ollama-provider.ts` - Ollama implementation
- `src/ai-panel/remote-providers.ts` - OpenAI + Anthropic
- `src/ai-panel/ai-manager.ts` - Central AI manager

### AI UI

- `src/ai-panel/chat.ts` - Chat panel with selection context
- `src/ai-panel/suggestions-panel.ts` - Suggestions panel (left side)
- `src/ai-panel/operations.ts` - AURA_EDIT operation types
- `src/ai-panel/edit-parser.ts` - Robust JSON parser
- `src/ai-panel/edit-executor.ts` - Execute operations on ProseMirror

### Utility

- `src/editor/text-utils.ts` - `findTextInDoc()` for cross-node text search
- `src/ai-panel/modification-hub.ts` - Event bus for position sync

---

## Struttura ai-panel/

```
src/ai-panel/
├── providers.ts           # AIProvider interface + AISettings
├── ollama-provider.ts     # Ollama local implementation
├── remote-providers.ts    # OpenAI + Anthropic cloud
├── ai-manager.ts          # Central manager (sendToAI, etc)
├── chat.ts                # Chat panel UI + selection context
├── suggestions-panel.ts   # Suggestions panel UI
├── operations.ts          # AURA_EDIT operation types
├── edit-parser.ts         # Robust JSON parser
├── edit-executor.ts       # Execute operations on ProseMirror
├── chunks.ts              # Document chunking for AI context
├── chunk-decorations.ts   # Visual markers for chunks
└── modification-hub.ts     # Event bus for position sync
```

---

## Come Riprendere

### Per Pagination

1. **Leggi** `documentation/06-roadmap/PAGINATION_INTEGRATION.md`
2. **Seguire** il piano nella Sezione 5
3. **Creare** branch: `git checkout -b feature/pagination-test`
4. **Installare** dipendenze: `npm install prosemirror-pagination`
5. **Testare** in isolamento BEFORE integrating with AI modules

### Per Database

1. **Leggi** `documentation/06-roadmap/BRAINSTORMING_DB.md`
2. Definire schema SQL iniziale
3. Integrare con incremental save

### Per Sviluppo Generale

```bash
npm run tauri dev
npm run typecheck
npm run lint
```

---

## Bug Noti e Soluzioni

### Risolti

1. ✅ `findTextInDoc` non trovava testo attraverso nodi
2. ✅ Chat AI si bloccava dopo primo messaggio
3. ✅ AI aggiungeva punteggiatura duplicata

### Sospesi

1. ⏳ `prosemirror-pagination` causa crash su Suggestions Panel
   - Vedi PAGINATION_INTEGRATION.md per analisi completa

---

## Modelli AI Configurati

**Default settings (in providers.ts):**

- Cloud: `kimi-k2.5:cloud` (testato e funzionante)
- Locale: `huihui_ai/glm-4.7-flash-abliterated:q4_K`

---

## Lezioni Apprese

### Integrazione Plugin Esterni

1. **Analizzare PRIMA** l'impatto su tutti i moduli
2. **Testare in isolamento** prima di integrare
3. **Documentare TUTTO** per sessioni future
4. **Non precipitare** - debuggare invece di ripristinare
5. **Verificare conflitti** con dipendenze esistenti (es. Issue #4)

### ProseMirror Posizioni

- Le posizioni includono wrapper nodes
- `doc.textContent` = solo testo, senza wrapper
- Operazioni su posizioni devono considerare struttura schema
- Schema pagination aggiunge ~5 posizioni di offset per wrapper

### Pagination: Fatti Accertati

1. **Nemmeno Google Docs ha vera pagination WYSIWYG** nel browser
2. **Paged.js** è la soluzione standard per export PDF/EPUB
3. **prosemirror-pagination** cambia completamente la struttura documento
4. **Page Break manuale + Visual markers** è alternativa più sicura
5. **Lexical (Meta)** NON ha pagination - non è adatto per document editing

### Opzioni per Impaginazione Professionale

| Opzione | Difficoltà | Rischio | Consigliata |
|---------|------------|---------|-------------|
| prosemirror-pagination | Alta | Alto (cambia schema) | Testare prima |
| Visual markers + Paged.js | Media | Basso | ✅ Sì |
| Page break manuale | Bassa | Nessuno | ✅ Sì |

### CSS e Theming

- Variabili CSS (`--color-surface`) per entrambi i temi
- Flexbox + `margin: auto` = problemi → usare `align-items: center`

---

## Riferimenti

- `documentation/06-roadmap/PAGINATION_PLAN.md` - **⭐ PIANO APPROVATO: Marker Manuali → Paged.js**
- `documentation/06-roadmap/PAGINATION_KNOWLEDGE.md` - Perché prosemirror-pagination NON funziona (ABANDONED)
- `documentation/06-roadmap/STATO.md` - Stato attuale e test plan
- `documentation/06-roadmap/BRAINSTORMING_DB.md` - Architettura AI completa
- `documentation/06-roadmap/FILE_OPS.md` - File operations
- `AGENTS.md` - Linee guida progetto
- `/home/carlo/Scrivania/AuraWrite_Layout_Pagine_Relazione.md` - Relazione tecnica layout pagine
- `/home/carlo/Scrivania/Proposte3.md` - Proposte AI con analisi Pretext

---

## Pretext — Analisi Tecnica

### API Principali

```typescript
// Preparazione (costosa, solo quando testo/font cambia)
import { prepare, layout, prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
const prepared = prepare(text, '12pt Georgia')  // 10-60ms per documento lungo

// Layout (istantaneo, per resize/line-height)
const { lineCount, height } = layout(prepared, containerWidth, lineHeight)  // <0.5ms

// Informazioni righe (per bounds pixel)
const { lines } = layoutWithLines(preparedWithSegments, width, lineHeight)
// lines[].text, lines[].width, lines[].start, lines[].end
```

### Cosa Fornisce

- **Altezza documento** → Per calcolare pagine
- **Numero righe** → Per sapere dove tagliare
- **Larghezza righe** → Per bounds orizzontali
- **Coordinate righe** → Per posizionare overlay Suggestions

### Cosa NON Fornisce

- **Coordinate Y** → Si calcolano: `y = lineIndex * lineHeight`
- **Coordinate X per alignment** → Giustificazione NON supportata
- **Margini** → Si gestiscono esternamente
- **Page break** → Si implementa custom sopra lineCount

### Architettura Suggerita (da definire)

```
┌─────────────────────────────────────────────────────────┐
│                 ProseMirror Editor                       │
│   (contentEditable, undo/redo, selezione, formatting)    │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐    ┌─────────────────────────────────┐
│   Pretext       │    │   ProseMirror Decorations       │
│   (misurazione) │    │   - Separatori pagina visivi    │
│                 │    │   - Widget per numeri pagina     │
│   per:          │    │   - Overlay per Suggestions      │
│   - Altezza     │    │                                  │
│   - Righe       │    │   Posizioni da:                  │
│   - Bounds      │    │   coordsAtPos(from) + Pretext    │
└─────────────────┘    └─────────────────────────────────┘
```

### Limiti Conosciuti

| Limite | Workaround |
|--------|------------|
| Justify non supportato | Usare DOM per testo justified, o accettare left-align |
| Letter-spacing | Non implementato, Issue #78 |
| Re-prepare su cambio font | Debounce + cache per paragrafo |
| Margini | Gestire esternamente al contenitore ProseMirror |

---

## Per Chi Riprende (Carlo o Agente Futuro)

**Contesto attuale:**

- AI Assistant funziona ✅
- Page break widget funziona ✅
- CSS foglio continuo funziona ✅
- **Suggestions Panel: BUG CONFERMATO** - Switch su frasi identiche non funziona
- **Pretext installato** — `@chenglou/pretext@0.0.4` in package.json
- **pagination.ts esiste** — Ma crea container separato (non è WYSIWYG completo)

**Analisi Pretext completata (2026-04-03):**
- ✅ Documenti lunghi OK (chunk per paragrafo)
- ❌ Justify NON supportato
- ❌ Letter-spacing NON supportato
- ✅ Performance buona (63ms prepare per 100K char, <1ms layout)
- ⚠️ Ogni cambio font richiede re-prepare

**Bug Suggestions - Documentazione:**

- `/home/carlo/Scrivania/RESOCONTO_BUG_SUGGESTIONS.md` - Resoconto dettagliato
- `/home/carlo/Scrivania/Proposte.md` - Proposte da multiple AI

**Piano Suggestions:**

1. **FASE 1**: Fix oldLen (IMMEDIATO) - vedi PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md
2. **FASE 2**: findTextInDocNear (RAPIDO)
3. **FASE 3**: ProseMirror Decorations (LUNGO TERMINE)

**Piano Pagination (SOSPESO — in rivalutazione):**

Le proposte AI suggeriscono container separato, ma Carlo vuole WYSIWYG completo.
**Risolvere prima le 4 domande aperte** (vedi sopra).

**Domande da chiarire con Carlo:**

1. Justify è indispensabile?
2. Come visualizzare "Pagina 2"?
3. Cosa deve fare Pretext esattamente?
4. Font/margini dinamici: solo in preferenze o anche durante editing?

**Se qualcosa non funziona:**

1. Controlla console DevTools (Ctrl+Shift+I)
2. Verifica Ollama sia in esecuzione: `ollama list`
3. Testa con `npm run typecheck` e `npm run lint`

**Priorità attuali:**

1. 🔴 Alta: Chiarire architettura WYSIWYG (4 domande)
2. 🔴 Alta: Fix Suggestions Panel (FASE 1)
3. 🟡 Media: Test Pretext con documenti reali
4. 🟢 Bassa: Database architecture

---

_Questo memo serve per riprendere lavoro senza perdere contesto._