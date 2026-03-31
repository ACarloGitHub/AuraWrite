# Test Plan - AuraWrite 2026-03-31

## Setup

1. Clona il repo su una macchina pulita (o usa `npm run tauri dev`)
2. Assicurati di avere:
   - Node.js 18+
   - Rust installato
   - Tauri CLI (`npm i -g @tauri-apps/cli`)

## Test 1: Editor Base

- [ ] L'editor ProseMirror si carica correttamente
- [ ] Puoi digitare testo
- [ ] Bold e Italic funzionano dalla toolbar
- [ ] Undo/Redo funzionano (Ctrl+Z / Ctrl+Y)

## Test 2: File Operations

- [ ] Save: File → Save apre dialogo, salva .json
- [ ] Save As: salva in formato scelto
- [ ] Open: apre un file .json precedentemente salvato
- [ ] Export: esporta in Markdown, TXT, HTML, DOCX
- [ ] Window title mostra nome file e dirty indicator (\*)

## Test 3: Theme

- [ ] Theme toggle (sole/luna) cambia tema
- [ ] Preferenze: puoi scegliere light/dark/custom
- [ ] Custom colors vengono applicati

## Test 4: AI Providers

- [ ] Ollama: configura in settings e verifica connessione
- [ ] OpenAI: inserisci API key e verifica funziona
- [ ] Anthropic: inserisci API key e verifica funziona

## Test 5: Suggestions Panel (SX)

**Trigger su ".":**

- [ ] Scrivi una frase: "Ciao mondo."
- [ ] Premi SPAZIO dopo il punto
- [ ] Il pannello Suggestions si attiva e mostra il suggerimento

**Verifiche trigger:**

- [ ] "12. 2024" NON triggera (numero ordinale)
- [ ] "Ciao..." NON triggera (ellissi)
- [ ] "Dr. Smith" NON triggera (abbreviazione)
- [ ] "1.5" NON triggera (decimale)
- [ ] "Hello. Yes" SÌ triggera (lettera + punto + spazio)

**UI:**

- [ ] Pannelli sono espandibili (▶/▼)
- [ ] Pulsante Accept funziona
- [ ] Pulsante Reject funziona
- [ ] Pulsante Switch alterna originale/proposta
- [ ] Pulsante Close chiude il pannello

**Punteggiatura:**

- [ ] Se originale finisce con "." e proposta anche, NON aggiunge punto doppio

## Test 6: AI Assistant Panel (DX)

**Test base:**

- [ ] Click ✨ AI apre pannello a destra
- [ ] Scrivi messaggio, AI risponde
- [ ] Secondo messaggio NON blocca

**Testo documento:**

- [ ] Il testo del documento viene passato all'AI
- [ ] Se selezioni testo, appare nel badge "Selected"

**Chunk System:**

- [ ] Con documento lungo (>8000 tokens), appare chunk selector
- [ ] Puoi selezionare quale chunk usare
- [ ] I marker nel documento mostrano l'inizio di ogni chunk
- [ ] Puoi cambiare max tokens nel setting

## Test 7: Zoom

- [ ] Zoom +/- funzionano
- [ ] Ctrl++ / Ctrl+- funzionano
- [ ] Percentuale viene aggiornata

## Test 8: Cross-Platform

**Windows:**

- [ ] Build funziona: `npm run tauri build`
- [ ] .exe viene generato

**Linux:**

- [ ] Build funziona
- [ ] Binary funziona

**macOS:**

- [ ] Build funziona (se disponibile)
- [ ] .app viene generato

## Test 9: GitHub Ready

- [ ] .gitignore è presente e corretto
- [ ] Nessun path hardcoded
- [ ] documentation/ è in .gitignore
- [ ] node_modules/ è in .gitignore
- [ ] AGENTS.md è presente

## Note

- Testare su macchina pulita senza Ollama locale potrebbe mostrare errori di connessione - questo è OK
- Per test completi AI, assicurati che Ollama sia in esecuzione o API keys siano configurate
