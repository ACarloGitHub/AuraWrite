# Suggestions Panel — Specifica

**Ultimo aggiornamento:** 2026-04-07

---

## Concept

**1 frase = 1 box = 1 suggerimento**

Tutti i box sono indipendenti tra loro.

---

## Trigger

Quando l'utente digita `.` seguito da spazio, il pannello analizza l'ultima frase.

**Regex:**
```javascript
/[a-zA-Z][.!?]\s/
```

**NON triggera su:**
- Numeri ordinali: `12.` → NO
- Decimali: `3.14` → NO
- Ellissi: `...` → NO
- Abbreviazioni: `Dr.` → NO

---

## UI

### Box espandibile
- **Collapsed**: mostra solo titolo frase
- **Expanded**: mostra originale, proposta, motivazione

### Pulsanti

| Pulsante | Azione | Documento | AI |
|----------|--------|-----------|-----|
| **Accept** | Sostituisce con proposta | Modificato | Stop per questa frase |
| **Reject** | Mantiene originale | Non modificato | Nuova richiesta per STESSA frase |
| **Switch** | Toggle originale↔proposal | Toggle | Stop |
| **Close (X)** | Chiude box | Non modificato | Dimentica frase |

**Regola:** Solo Close chiude il box. Accept/Reject/Switch tengono il box aperto.

---

## Data Structures

```typescript
interface SentenceSlot {
  id: string
  text: string
  state: "pending" | "processing" | "suggested" | "accepted" | "closed"
  suggestion: string | null
  reason: string | null
  docFrom: number  // ProseMirror position START
  docTo: number    // ProseMirror position END
}

interface SentenceSuggestion {
  id: string
  sentenceTitle: string
  original: string
  suggested: string | null
  reason: string | null
  isExpanded: boolean
  showingOriginal: boolean
  isAccepted: boolean
}

// Salvati per Switch
acceptedOriginals: Map<id, original_text>

// Frasi chiuse/dimenticate
closedSentences: Set<lowercase>
```

---

## Coordinate-Based Replacement

**MAI** usare `textContent.indexOf()`.

**SEMPRE** usare coordinate ProseMirror:
1. Alla creazione dello slot: calcolare `docFrom`/`docTo` con `doc.descendants()`
2. Accept/Switch: usare `replaceWith(slot.docFrom, slot.docTo, newText)`
3. Preserva spazi e testo circostante

---

## File

| File | Responsabilità |
|------|----------------|
| `src/ai-panel/suggestions-panel.ts` | UI, trigger, logica |
| `src/ai-panel/ai-manager.ts` | Chiamate AI |
| `src/editor/text-utils.ts` | Ricerca testo nel documento |

---

## Test

Vedi `documentation/archivio/TEST_FEATURES.md` per casi di test dettagliati.

---

## Bug Noti

- **Discard lento**: Dipende dal modello AI (reasoning). Non è bug del codice.

---

## Future

- Undo per suggerimenti (conservare `previousVersions`)
- Database integration (salvare frasi accettate/rifiutate)
- ProseMirror Decorations per ancoraggio slot (più robusto)

---

*Aggiornato da Aura — 2026-04-07*