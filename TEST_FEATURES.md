# Test Nuove Features - AuraWrite 2026-03-31

## Test Focus: AI Panels

Questi test verificano le nuove funzionalità implementate oggi.

---

## 1. Suggestions Panel - Trigger "."

### Test 1.1: Trigger Base

```
PASSO: Scrivi "Ciao mondo." nel editor
PASSO: Premi SPAZIO dopo il punto
RISULTATO ATTESO: Il pannello Suggestions mostra il suggerimento per quella frase
```

### Test 1.2: Logica Trigger (NON devono triggere)

```
PASSO 1: Scrivi "12. 2024 è un anno"
PASSO 2: Premi spazio
RISULTATO: NON deve attivarsi

PASSO 3: Scrivi "Ciao..."
PASSO 4: Premi spazio
RISULTATO: NON deve attivarsi

PASSO 5: Scrivi "Il Dr. Smith arrivò"
PASSO 6: Premi spazio
RISULTATO: NON deve attivarsi

PASSO 7: Scrivi "Il prezzo è 19.99 euro"
PASSO 8: Premi spazio
RISULTATO: NON deve attivarsi
```

### Test 1.3: Trigger Valido

```
PASSO 1: Scrivi "Hello. Yes, I agree."
PASSO 2: Premi spazio dopo l'ultimo punto
RISULTATO: DEVE attivarsi (lettera + punto + spazio)
```

---

## 2. Suggestions Panel - UI

### Test 2.1: Espandi/Collassa

```
PASSO: Dopo aver triggato un suggerimento
PASSO: Clicca su ▶ (toggle)
RISULTATO: Il pannello si espande mostrando original, suggested, reason
PASSO: Clicca su ▼
RISULTATO: Il pannello si collassa mostrando solo il titolo
```

### Test 2.2: Pulsante Accept

```
PASSO: Mostra un suggerimento
PASSO: Clicca "Accept"
RISULTATO: La frase nel documento viene sostituita con la proposta
RISULTATO: Il suggerimento scompare dalla lista
```

### Test 2.3: Pulsante Reject

```
PASSO: Mostra un suggerimento
PASSO: Clicca "Reject"
RISULTATO: La frase nel documento viene sostituita con la proposta
RISULTATO: Il suggerimento scompare dalla lista
```

### Test 2.4: Pulsante Switch

```
PASSO: Mostra un suggerimento
PASSO: Nota la frase nel documento (es. "Ciao mondo.")
PASSO: Clicca "Switch"
RISULTATO: La frase cambia alla proposta (es. "Saluti a tutti.")
PASSO: Clicca "Switch" di nuovo
RISULTATO: La frase torna all'originale ("Ciao mondo.")
```

### Test 2.5: Pulsante Close

```
PASSO: Mostra un suggerimento
PASSO: Clicca "✕"
RISULTATO: Il suggerimento viene chiuso e rimosso
RISULTATO: Nel documento la frase resta originale
```

---

## 3. Gestione Punteggiatura

### Test 3.1: Punto Doppio

```
PASSO: Scrivi una frase che finisce con "."
PASSO: L'AI propone una versione che finisce anch'essa con "."
PASSO: Premi Accept
RISULTATO: Nel documento NON ci deve essere ".."
RISULTATO: Solo un punto finale
```

### Test 3.2: Altri Segni

```
PASSO: Prova con frasi che finiscono con "!" e "?"
PASSO: Accetta una proposta che finisce con lo stesso segno
RISULTATO: Non ci devono essere segni duplicati
```

---

## 4. AI Assistant - Chat Non Bloccata

### Test 4.1: Secondo Messaggio

```
PASSO: Apri il pannello AI (✨)
PASSO: Scrivi "Ciao"
PASSO: Invia
PASSO: Aspetta risposta
PASSO: Scrivi "Come ti chiami?"
PASSO: Invia
RISULTATO: Il secondo messaggio viene inviato e risposto
RISULTATO: La chat NON si blocca
```

### Test 4.2: Invio con Enter

```
PASSO: Apri chat
PASSO: Scrivi un messaggio
PASSO: Premi Enter (non Shift+Enter)
RISULTATO: Il messaggio viene inviato
```

---

## 5. AI Assistant - Testo Documento

### Test 5.1: Documento Passato

```
PASSO: Scrivi un testo lungo nell'editor (almeno 2 paragrafi)
PASSO: Apri il pannello AI
PASSO: Scrivi "Di cosa parla il mio documento?"
PASSO: Invia
RISULTATO: L'AI risponde facendo riferimento al contenuto del documento
```

### Test 5.2: Selezione come Context

```
PASSO: Scrivi del testo
PASSO: Seleziona una frase
PASSO: Apri il pannello AI
PASSO: Verifica che appaia "Selected: '...'"
PASSO: Scrivi "Cosa ne pensi?"
RISULTATO: L'AI risponde analizzando la selezione
```

---

## 6. AI Assistant - Chunk System

### Test 6.1: Chunk Selector Appare

```
PASSO: Scrivi un documento molto lungo (tanti paragrafi, >8000 chars)
PASSO: Apri il pannello AI
RISULTATO: Appare un selector "Document Chunks (N)"
RISULTATO: Il documento è stato diviso in chunks
```

### Test 6.2: Marker Visivi

```
PASSO: Con chunk selector visibile
RISULTATO: Nel documento appaiono marker nel testo: "← titolo-chunk_001"
```

### Test 6.3: Cambia Chunk

```
PASSO: Seleziona un chunk diverso dal dropdown
RISULTATO: Il marker visivo cambia per indicare il chunk attivo
```

### Test 6.4: Impostazione Tokens

```
PASSO: Trova il campo "Max tokens per chunk"
PASSO: Cambia il valore (es. 4000)
PASSO: Clicca "Apply"
RISULTATO: I chunk vengono ricalcolati con il nuovo limite
```

---

## 7. Bug Fixes

### Test 7.1: Errore "Original text not found"

```
PASSO: Fai una modifica manuale al documento
PASSO: Prova ad accettare un suggerimento
RISULTATO: Se il testo originale non esiste più, non deve crashare
RISULTATO: Il suggerimento viene rimosso senza errori
```

---

## Checklist Finale

- [ ] Tutti i trigger "." funzionano
- [ ] Trigger escludono correttamente numeri, decimali, abbreviazioni
- [ ] Accept/Reject/Switch/Close funzionano
- [ ] Espandi/Collassa funziona
- [ ] Punteggiatura non viene duplicata
- [ ] Chat non si blocca al secondo messaggio
- [ ] Testo documento viene passato all'AI
- [ ] Chunk system funziona per documenti lunghi
- [ ] Marker visivi mostrano i chunk

---

## Note

- Per testare Ollama: assicurati che sia in esecuzione su localhost:11434
- Per testare OpenAI/Anthropic: inserisci API key nelle impostazioni
- Se non hai AI configurato, i pannelli mostreranno errori di connessione
