# Sessione - 2026-03-29 (Pomeriggio)

## Layout

- [x] AI e Suggestions: spostare entrambi i pulsanti nel footer (sopra Words/Characters)
- [x] Suggestions va a sinistra nel footer, AI a destra

## Interactions

### 1. Suggestions Panel (Proattivo)

- [x] Click pulsante → apre pannello sinistro
- [x] AI legge il testo ricorsivamente a intervalli regolari
- [x] Intervallo configurabile nelle preferences (default: 30s)
- [x] AI analizza prima le frasi iniziali per capire tono/contesto
- [x] Poi fornisce suggerimenti frase-per-frase
- [x] Ogni suggerimento ha: titolo (prime 5 parole + "..."), eventuale correzione
- [x] Pulsante Accept/Replace e Reject/Discard per ogni suggerimento
- [x] Stile: fumetti/riquadri chat come in AI Assistant

### 2. AI Assistant Panel (Ractive)

- [x] Riceve contesto automaticamente (intervallo configurabile, default: 30s)
- [x] NON c'è pulsante per inviare testo
- [x] Utente scrive domande libere sul documento
- [x] AI risponde con contesto del documento

### 3. Selezione Testo (Seconda Interazione)

- [x] Utente seleziona testo
- [x] Testo evidenziato temporaneamente (colore diverso) per mostrare focus
- [x] AI si concentra sulla selezione
- [x] Click altrove → deselezione → AI torna al documento intero

### 4. Modifica Documento da AI Assistant

- [ ] AI può proporre modifiche al testo (come Suggestions)
- [ ] Accept/Replace e Reject/Discard per ogni modifica proposta

## Preferences

- [x] `aiSuggestionsInterval`: intero (secondi), default 30
- [x] `aiContextInterval`: intero (secondi), default 30
- [x] `suggestionsPrompt`: testo (prompt per Suggestions mode)
- [x] `aiAssistantPrompt`: testo (prompt per AI Assistant mode)

## File Modificati

- `index.html` - spostare pulsanti nel footer
- `src/styles.css` - stile footer, highlight selezione, status display
- `src/main.ts` - aggiunte preferenze AI
- `src/ai-panel/suggestions-panel.ts` - frase-per-frase, accept/reject, timer
- `src/ai-panel/chat.ts` - highlight selezione, context updater
- `src/editor/editor.ts` - aggiunto selectionHighlightPlugin
- `src/editor/selection-highlight.ts` - plugin per decoration highlight

## Note

- I pannelli Suggestions e AI Assistant devono rimanere separati
- Accept/Replace e Reject/Discard in inglese

## Bug Noti / Da Fare

1. AI Assistant accetta modifiche: richiede design specifico per parsing automatico risposte
2. Il pannello suggestions si apre/chiude con toggle pulsante (funziona)
3. Il pannello AI si apre/chiude con toggle pulsante (funziona)
