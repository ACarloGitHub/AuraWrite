# Debug Log - AI Assistant Modification Bug (2026-04-01)

## Commit Falliti

### Tentativo 1 (REVERTED - c73e037)
**Commit**: `20fb136` "feat: AI Assistant document modification + modification hub"

**Descrizione**: 
Avevamo implementato:
- `modification-hub.ts` - bus eventi centralizzato
- Suggestions integrato nel hub
- AI Assistant con parsing JSON per modifiche documento
- UI standardizzata

**BUG SCOPERTO**:
Dopo il commit, il pannello Suggestions ha smesso di funzionare correttamente.

**Sintomi**:
- Testo scritto: "Questo è un test completo su scrittura e modifica di Aurawrite. Inizierò a scrivere alcune frasi per valurare se il pannello Suggestions continua a funzionare."
- Testo dopo modifica automatica: "Questo è un test completo sulle funzionalità di scrittura e modifica di AurawriteInizierò a scrivere alcune frasi per valurare se il pannello Suggestions continua a funzionare. funzionare."
- Problemi: punto mancante dopo "Aurawrite", a-capo scomparso, "funzionare." duplicato

## Analisi Pre-Revert

### Modifiche Fatte in quel Commit

| File | Modifiche |
|------|-----------|
| `modification-hub.ts` | NUOVO - bus eventi per sincronizzazione |
| `suggestions-panel.ts` | Export `findTextInDoc`, hub integration, `notifyDocumentChange` |
| `chat.ts` | Log, parsing JSON modifica, `applyDocumentEdit`, import hub |
| `remote-providers.ts` | Prompt JSON per modifiche |
| `index.html` | Toggle button, debug log |
| `styles.css` | Debug log AI, chunk labels ingranditi |

### Ipotesi sul Bug

1. **Possibile causa 1**: L'export di `findTextInDoc` da `suggestions-panel.ts` potrebbe aver creato un circolo vizioso di import tra `chat.ts` e `suggestions-panel.ts`

2. **Possibile causa 2**: `notifyDocumentChange` viene chiamato durante il setup iniziale prima che `editorViewRef` sia pronto

3. **Possibile causa 3**: Il modification hub notifica modifiche che Suggestions interpreta come esterne e aggiorna le posizioni di conseguenza

4. **Possibile causa 4**: Integrazione con hub in `setupSuggestionsPanel` + cleanup in `stopSuggestionsMode` potrebbe creare race condition

## Come Riprodurre il Bug

```bash
git checkout 20fb136
npm run tauri dev
# Scrivere una frase con .
# Osservare comportamenti anomali
```

## Come Ripartire per il Fix

### Approccio 1: Isolare il Problema

1. **Prima di tutto**: ripristina il commit funzionante:
   ```bash
   git checkout c73e037
   ```

2. **Poi aggiungi le modifiche UNA ALLA VOLTA**:
   - Solo `modification-hub.ts` → test
   - Solo `chat.ts` log → test
   - Solo export `findTextInDoc` → test
   - Solo hub integration in Suggestions → test
   - Solo parsing JSON in chat → test

### Approccio 2: Evitare il Circolo Vizioso

Invece di importare `findTextInDoc` da `suggestions-panel.ts` in `chat.ts`, creare un modulo separato:

```typescript
// src/editor/text-utils.ts (NUOVO)
export function findTextInDoc(view: EditorView, text: string): {from: number, to: number} | null {
  // stessa implementazione
}
```

Poi importare DA QUESTO MODULO in entrambi i pannelli.

### Approccio 3: Verificare il Modification Hub

Il bug potrebbe essere nel modo in cui Suggestions reagisce alle notifiche. Potrebbe bastare:

1. NON chiamare `notifyDocumentChange` in Suggestions (è lui stesso a fare la modifica)
2. Solo AI Assistant chiama `notifyDocumentChange` quando modifica
3. Suggestions si iscrive al hub e aggiorna solo su modifiche esterne

### Approccio 4: Testare Concorrenza

Il bug potrebbe manifestarsi solo quando:
- Suggestions è attivo
- AI Assistant modifica qualcosa
- Le posizioni di Suggestions vengono invalidates

## Note

- Il commit funzionante PRECEDENTE è `1c0a827`
- Il commit REVERTED è `20fb136`
- Il revert è `c73e037`
