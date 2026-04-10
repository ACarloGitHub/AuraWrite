# AuraWrite — Indice Documentazione

**Ultimo aggiornamento:** 2026-04-08

---

## Struttura

```
documentation/
├── 00-INDICE.md          ← Questo file
├── 01-STATO.md           ← Dove siamo ora (max 200 righe)
├── 02-TODO.md            ← Cosa fare (prioritizzato)
├── 03-ARCHITETTURA.md    ← Com'è fatto il codice
├── 04-LEZIONI.md         ← Cosa abbiamo imparato (errori passati)
├── 05-DEVGUIDE.md        ← Guida sviluppo, build, style
│
├── feature/              ← Documentazione per feature
│   ├── suggestions-panel.md
│   ├── ai-assistant-panel.md
│   └── pagination.md
│
└── archivio/             ← File obsoleti conservati per riferimento
    ├── pagination-abandoned/
    ├── debug-old/
    └── sessions/
```

---

## Lettura Rapida per Agenti AI

### Inizio sessione
1. Leggi `01-STATO.md` — stato attuale del progetto
2. Leggi `02-TODO.md` — task prioritari

### Implementazione feature
1. Leggi `03-ARCHITETTURA.md` — struttura del codice
2. Leggi `feature/[nome-feature].md` — specifica della feature

### Debugging
1. Leggi `04-LEZIONI.md` — errori passati e soluzioni

---

## File Principali

| File | Scopo | Quando leggerlo |
|------|------|------------------|
| [[01-STATO.md]] | Stato attuale, funzionalità completate, bug noti | Inizio sessione |
| [[02-TODO.md]] | Task da fare, priorità, note tecniche | Inizio sessione |
| [[03-ARCHITETTURA.md]] | Struttura cartelle, file principali, pattern | Prima di modifiche |
| [[04-LEZIONI.md]] | Errori passati, soluzioni, pattern corretti | Quando trovi bug |
| [[05-DEVGUIDE.md]] | Guida sviluppo, build, style | Prima di modifiche codice |
| [[feature/suggestions-panel.md]] | Pannello suggerimenti (sinistra) | Lavori su suggestions |
| [[feature/ai-assistant-panel.md]] | Pannello chat AI (destra) | Lavori su AI assistant |
| [[feature/database.md]] | Architettura database | Integrazione DB |
| [[feature/pagination.md]] | Paginazione (abbandonata) | Riferimento storico |

---

## Archivio

I file in `archivio/` sono conservati per riferimento storico ma **non sono più validi**. Contengono:
- Tentativi di paginazione falliti (prosemirror-pagination, Lexical, TipTap)
- Debug log di bug risolti
- Sessioni vecchie

---

## Cartella Root

Nella root di AuraWrite:
- `README.md` — Descrizione del progetto
- `package.json` — Dipendenze e script
- `src/` — Codice TypeScript
- `src-tauri/` — Codice Rust

---

## Note per Manutenzione

### Quando aggiornare
- `01-STATO.md`: Dopo ogni sessione di lavoro
- `02-TODO.md`: Quando si completano/aggiungono task
- `04-LEZIONI.md`: Quando si impara qualcosa di nuovo (bug, pattern)
- `feature/*.md`: Quando si modificano le specifiche

### Cosa spostare in archivio
- File più vecchi di 30 giorni che non sono più rilevanti
- Tentativi falliti documentati
- Session log completati

---

*Indice creato da Aura per organizzare la documentazione AuraWrite*