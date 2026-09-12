# AuraWrite — Schema della wiki e regole di lavoro

Questo è il file schema del pattern *LLM Wiki* per AuraWrite. Ogni agente lo legge
per primo: dice dove stanno le cose, come si legge, come si scrive, cosa si aggiorna.

## I tre livelli

1. **`raw/`** — fonti grezze, **immutabili**: memo di release, report datati, bug,
   pareri AI, piani, audit, specifiche dei template, schermate. Si leggono e si
   citano, non si riscrivono.
2. **`wiki/`** — la conoscenza **compilata** dall'agente: pagine di concetto,
   entità, sintesi, procedure, più l'indice e il registro. Qui si sintetizza e si
   collega. Include lo **stato vivente del progetto** (`wiki/STATO.md`).
3. **Il codice** (`src/`, `src-tauri/`) — la **fonte ultima di verità**. Non si
   duplica nella wiki: si legge e si cita. Lo schema è questo file.

Per capire il progetto si legge **la wiki**, che sa dove stanno le fonti in `raw/`.

## Ordine di orientamento (all'inizio di ogni sessione)

1. Questo file (le regole).
2. `wiki/index.md` — il catalogo.
3. `wiki/todo/_index.md` — dove siamo e quale priorità è corrente.
4. `wiki/STATO.md` — com'è fatto il progetto adesso (verificato sul codice).
5. Le ultime voci di `wiki/log.md` e, se serve, il memo dell'ultima release.

Solo dopo si approfondiscono le pagine pertinenti. Non si legge tutta la wiki.

## Regole di sessione con Carlo

1. **All'inizio ci si orienta attraverso l'indice**, non leggendo tutta la wiki.
2. **Si legge il codice per capire.** Nessuna supposizione non fondata sul codice.
   Se una richiesta, scritta in astratto, a schermo diventa inutile o dannosa, la
   si contesta in lettura prima di eseguirla.
3. **In plan mode la conversazione è dialogica**: una domanda per volta, senza
   elenchi di opzioni, senza la parola "oppure". Se serve un confronto, si chiede
   a Carlo cosa ne pensa.
4. **Una sola domanda per messaggio.**
5. **A Carlo si scrive in italiano semplice**: niente abbreviazioni, pezzi di
   codice, nomi di funzioni o file, parole inglesi. **Mai usare i codici delle
   voci** (per esempio `T1.2`): i codici servono agli agenti, non a lui.
6. **Lingua**: codice, nomi di file, messaggi di commit e interfaccia sono in
   **inglese**; la conversazione con Carlo, la wiki (`wiki/`) e le fonti (`raw/`)
   sono in **italiano**.
7. **Un commit per ogni evoluzione significativa del codice.** Non si accumulano
   più fasi in un commit e non si lasciano modifiche non committate a fine sessione.
8. **La wiki si aggiorna solo dopo che Carlo ha confermato che il codice funziona.**
   Documenta ciò che esiste e funziona, non ciò che si vorrebbe fare.
9. **Prima di committare e di aggiornare la wiki, si aspetta la prova di Carlo.**
   Ogni passo consegnato deve contenere un comportamento che lui possa usare e
   giudicare; un pezzo di solo modello dati non è un passo da collaudare.
10. **La wiki è la memoria tra una sessione e l'altra**: descrizioni complete,
    riferimenti a file e commit, stato delle cose in evidenza.
11. **Cross-platform Windows, macOS, Linux.** Nessuna dipendenza di una sola
    piattaforma senza un piano per le altre.
12. **Mai inventare parole.** Italiano corretto e comune; i termini tecnici
    inglesi consolidati (drag, wrap, livello…) si usano e si definiscono una volta.
    Rileggere ogni testo prima di ritenerlo chiuso.
13. **Modifiche a file esistenti con uno script: mai lavorare d'indizio.** Verificare
    che l'ancoraggio esista, non dare per buona una sostituzione a metà, e rileggere
    il file dopo (numero di righe, ordine dei titoli).

## Cura della wiki

1. **La wiki è lo strumento dell'agente** (memoria condivisa), non un deliverable
   per Carlo.
2. **Mai committare `wiki/` e `raw/`**: sono locali, fuori dal controllo versione.
3. **Mai toccare il codice senza che Carlo lo chieda.** Lui decide funzionalità,
   priorità e ordine.
4. **Niente piani per versione.** Le voci si organizzano per priorità, non per
   release (la versione è un'etichetta finale).
5. **Niente duplicazione.** Prima di creare una pagina, cercare se esiste già;
   aggiornare invece di replicare.
6. **Una pagina per concetto, breve.** Oltre le 200 righe: spezzare, salvo eccezioni
   documentate (memoriali di architetture defunte, pagine-contratto monografiche).
7. **Le lezioni apprese si preservano** anche per le architetture defunte.
8. **Lingua della wiki e delle fonti: italiano** (nomi di file e termini tecnici
   propri possono restare in inglese).

## Todo — disciplina

Il todo vive in `wiki/todo/` ed è l'unico posto delle cose da fare.

- `_index.md` — **solo orientamento**: dove siamo, la priorità corrente, i rimandi.
  Nessun dettaglio (che sarebbe un duplicato dei file di priorità).
- `_priorita-1.md` … `_priorita-5.md` — le voci, per priorità fissa.
- `_rimandate.md`, `_scartate.md`, `_bug-aperti.md`.
- I task chiusi si spostano in `wiki/concepts/todo-archive.md`, copiando le righe.

Ogni voce ha: un **codice stabile** (per esempio `T1.2`), il titolo, uno **stato**
fisso, la priorità, il **piano** a cui appartiene (rimando), le dipendenze e la
**prova** (come Carlo la verifica); il commit solo quando è storia.

**Stati ammessi:** `idea`, `da fare`, `in corso`, `da verificare`, `fatto`, `scartato`.

**Collegamenti:** ogni piano (pagina in `wiki/concepts/`) è richiamato da almeno
una voce; ogni voce dice a quale piano appartiene. Un piano senza voce è un orfano:
va collegato o rimosso.

**I codici sono interni agli agenti. Con Carlo non si usano mai.**

## Direttorio

```
Cartella_di_Sviluppo/
├── AGENTS.md                  # questo schema
├── wiki/                      # conoscenza compilata (agente)
│   ├── index.md               # catalogo delle pagine
│   ├── log.md                 # registro cronologico (solo voci correnti)
│   ├── log-archive-*.md       # registri ruotati
│   ├── STATO.md               # stato vivente del progetto (dal codice)
│   ├── concepts/              # concetti, contratti, piani
│   │   └── todo/              # le cose da fare (priorità 1-5, …)
│   ├── entities/              # un file di codice per pagina
│   ├── procedures/            # procedure passo-passo
│   ├── syntheses/             # analisi trasversali
│   └── summaries/             # riassunti di fonti esterne
├── raw/                       # fonti grezze e storiche (immutabili)
│   ├── releases/              # memo di release + _INDICE.md
│   ├── archive/               # report datati + _INDICE.md
│   ├── ai-reviews/            # pareri AI grezzi
│   ├── templates/             # specifiche tecniche dei template
│   ├── screenshots/
│   ├── BUGS_*.md, piano-*.md, report-*.md, audit…
│   └── RELEASE_PROCESS… (unificata in wiki/procedures/github-release.md)
└── src/, src-tauri/           # il codice
```

## Frontmatter delle pagine

```yaml
---
title: "Titolo"
type: concept | entity | procedure | summary | synthesis
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: high | medium | low
---
```

## Collegamenti

- Stile Obsidian, relativo alla radice della wiki: `[[concepts/prosemirror-editor]]`.
- Niente pagine orfane; collegamento bidirezionale dove ha senso.
- Date in formato ISO 8601 (`YYYY-MM-DD`).

## Flussi di lavoro

### Ingest (una fonte nuova)
1. Leggere la fonte per intero.
2. Aggiornare le pagine di concetto ed entità esistenti (mai duplicare).
3. Collegare in modo bidirezionale.
4. Aggiornare `wiki/index.md` e aggiungere una voce in `wiki/log.md`.
5. Segnalare le contraddizioni trovate.

### Query
1. Partire da `wiki/index.md` e aprire le due o tre pagine pertinenti.
2. Per le cose da fare: `wiki/todo/_index.md`.
3. Per i fatti sul codice: verificare su `wiki/STATO.md` e sul codice stesso.
4. Rispondere citando le pagine usate.

### Lint (periodico)
1. Link rotti, pagine orfane, contraddizioni fra pagine.
2. Pagine attive oltre 200 righe: spezzare (salvo eccezioni documentate).
3. `wiki/index.md` allineato alla realtà.
4. Numeri e stato che invecchiano: una pagina che descrive lo stato attuale non
   deve contenere conteggi e valori che cambiano da soli; si manda al punto dove
   il valore vive (il codice, il registro). La cronaca può citare un commit preciso.

### Rotazione
- **`log.md`**: oltre ~1000 righe, spostare le voci vecchie in
  `log-archive-<AAAA-MM>.md`, lasciando in testa un puntatore.
- **`wiki/todo/`**: i task chiusi vanno copiati in `wiki/concepts/todo-archive.md`.

### Chiusura di sessione (obbligatoria)
1. Aggiornare `wiki/todo/` (nuove voci; le chiuse → archivio).
2. Aggiungere una voce in `wiki/log.md` (`## YYYY-MM-DD — Titolo`).
3. Se c'è stata una release: memo in `raw/releases/`, indice aggiornato,
   `wiki/procedures/github-release.md` se cambia qualcosa.
4. Se ci sono decisioni di progetto: aggiornare la pagina di concetto pertinente.
5. Se `wiki/STATO.md` è disallineata col codice: correggerla.
6. Verificare che questo schema sia ancora allineato.

## Dove si scrive

| Cosa | Dove |
|------|------|
| Cose da fare (aperte) | `wiki/todo/` (parti da `_index.md`) |
| Task chiusi | `wiki/concepts/todo-archive.md` |
| Registro per sessione | `wiki/log.md` |
| Stato del progetto | `wiki/STATO.md` |
| Contratti, concetti, piani | `wiki/concepts/` |
| Un file di codice | `wiki/entities/<file>.md` |
| Procedure | `wiki/procedures/` |
| Sintesi trasversali | `wiki/syntheses/` |
| Memo di release | `raw/releases/RESUME_MEMO_vX.Y.Z.md` |
| Report datati, bug, audit, piani storici | `raw/` (+ `raw/archive/`) |
| Pareri AI grezzi | `raw/ai-reviews/` |
| Specifiche dei template | `raw/templates/<name>.md` |

## Comandi

```bash
npm install            # dipendenze
npm run tauri:dev      # sviluppo
npm run tauri:build    # build di produzione
npm run typecheck      # controllo TypeScript
npm run lint           # ESLint
```

Le verifiche di routine sono `typecheck`, `lint`, `build` più la **prova di Carlo**.
I test automatici sono temporanei: si scrivono quando servono e si cancellano.

## Errori comuni da evitare

- Token GitHub: leggerlo da `C:\Users\carlo\.config\aurawrite\github_token.txt`,
  non chiederlo e non committarlo.
- Bump della versione **prima** del tag, mai dopo.
- Verificare `git status` prima di pushare; **non** pushare `wiki/` e `raw/`.
- Dimenticare di aggiornare `wiki/todo/` e `wiki/log.md` a fine sessione.
- Lasciare task chiusi nel todo invece di archiviarli.
- Duplicare nella wiki l'albero del codice o lo stack: rimandare a `wiki/STATO.md`.
