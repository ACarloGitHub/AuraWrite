# Piano di Implementazione - Suggestions Panel

**Creato:** 2026-04-03
**Stato:** 📋 Da implementare

---

## Riferimenti

- `/mnt/AI-Ubuntu/progetti/AuraWrite/documentation/06-roadmap/Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md` - Analisi completa dei bug e soluzioni proposte da multiple AI

---

## Fasi di Implementazione

### FASE 1: Fix Immediato (Bug Critico oldLen)

**Priorità:** MASSIMA - Bug che causa lo slittamento

**Obiettivo:** Correggere il calcolo di `oldLen` in `switchSuggestion` e `acceptSuggestion`

**Modifiche:**

1. **`src/ai-panel/suggestions-panel.ts` - `switchSuggestion` (linea 600)**
   - Spostare il calcolo di `oldLen` DOPO la validazione/correzione della posizione
   - NON calcolare prima della correzione

2. **`src/ai-panel/suggestions-panel.ts` - `acceptSuggestion` (linea 524)**
   - Stessa correzione

**Codice da cambiare (switchSuggestion):**
```typescript
// PRIMA (sbagliato):
const oldLen = pos.to - pos.from;
if (!validatePosition(id)) {
  const livePos = findTextInDoc(...);
  // ...
}

// DOPO (corretto):
if (!validatePosition(id)) {
  const livePos = findTextInDoc(...);
  // ...
}
const oldLen = pos.to - pos.from; // Dopo la correzione!
```

**Nota:** Questo fix da solo potrebbe risolvere il 70% dello slittamento.

---

### FASE 2: Fix Rapido - findTextInDocNear

**Priorità:** ALTA

**Obiettivo:** Sostituire `findTextInDoc` con `findTextInDocNear` per evitare il bug delle frasi identiche

**Soluzione di riferimento:** Proposta di Claude (8.5/10)

**Modifiche:**

1. **`src/editor/text-utils.ts`**
   - Aggiungere funzione `findTextInDocNear`

2. **`src/ai-panel/suggestions-panel.ts`**
   - Sostituire `findTextInDoc` con `findTextInDocNear` nel fallback di `switchSuggestion` e `acceptSuggestion`

---

### FASE 3: Soluzione a Lungo Termine - ProseMirror Decorations

**Priorità:** MEDIA (dopo che le fasi 1 e 2 sono stabili)

**Obiettivo:** Eliminare completamente il tracciamento manuale delle posizioni

**Soluzione di riferimento:** Proposta di Gemini (10/10)

**Approccio:**
- Creare un plugin per le Decorations
- Ogni slot ha una decoration con ID univoco
- ProseMirror gestisce automaticamente le posizioni

**Vantaggi:**
- Nessuno slittamento
- Nessun accumulate di errori
- Codice più pulito

**Passi:**
1. Creare `src/editor/suggestions-marker-plugin.ts`
2. Integrare il plugin in `editor.ts`
3. Riscrivere `switchSuggestion` e `acceptSuggestion`
4. Rimuovere `updatePositionsAfterChange` e `validatePosition`

---

## FASE 4: Limite Frasi per Suggestions

**Priorità:** ALTA - Performance

**Obiettivo:** Evitare che Suggestions analizzi tutto il documento quando viene incollato molto testo

**Problema:** Quando si incolla molto testo, Suggestions analizza tutte le frasi, causando rallentamenti

**Soluzione:**
- Aggiungere preferenza per limite massimo frasi (default: 10)
- Preferenza per analizzare "prime" o "ultime" N frasi
- Quando il documento supera N frasi, analizza solo quelle selezionate

**Preferenze da aggiungere in `Preferences`:**
```typescript
{
  suggestionsMaxSentences: number;      // 10 default
  suggestionsWindowPosition: "first" | "last";  // "first" = prime, "last" = ultime
}
```

**UI in Preferenze:**
- Sezione "Suggestions"
- Toggle: "First" / "Last" (radio buttons)
- Campo numerico: "Numero frasi da analizzare" (default: 10)

**Logica in `setupDotTrigger`:**
```typescript
function getSentencesToAnalyze(doc: Node, maxSentences: number, position: "first" | "last"): string[] {
  const sentences = extractSentences(doc.textContent);
  if (position === "first") {
    return sentences.slice(0, maxSentences);
  } else {
    return sentences.slice(-maxSentences);
  }
}
```

---

## Dipendenze tra Fasi

```
FASE 1 (oldLen fix)
    ↓
FASE 2 (findTextInDocNear)
    ↓
FASE 3 (Decorations)
    ↓
FASE 4 (Limite frasi) ← NUOVA
```

---

## Criteri di Completamento

### FASE 4 Completata quando:
- [ ] Preferenze caricate da localStorage
- [ ] UI in Preferenze per First/Last e numero frasi
- [ ] Logica in `setupDotTrigger` rispetta il limite
- [ ] Test con documento lungo (50+ frasi): analizza solo N frase

---

## Note per la Prossima Sessione

1. **Iniziare dalla FASE 1** - È il fix più critico
2. **Testare incrementalmente** - Dopo ogni modifica, verificare con frasi identiche
3. **Consultare** `/mnt/AI-Ubuntu/progetti/AuraWrite/documentation/06-roadmap/Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md` per le soluzioni dettagliate

---

## File da Modificare

| Fase | File | Modifica |
|------|------|----------|
| 1 | `src/ai-panel/suggestions-panel.ts` | Fix oldLen |
| 2 | `src/editor/text-utils.ts` | Aggiungere findTextInDocNear |
| 2 | `src/ai-panel/suggestions-panel.ts` | Usare findTextInDocNear |
| 3 | `src/editor/suggestions-marker-plugin.ts` | Nuovo file - Decorations |
| 3 | `src/ai-panel/suggestions-panel.ts` | Riscrivere con Decorations |
| 3 | `src/editor/editor.ts` | Integrare plugin |

---

*Piano redatto per la prossima sessione di lavoro*