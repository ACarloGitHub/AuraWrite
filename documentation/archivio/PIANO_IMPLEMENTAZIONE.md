# AuraWrite - Piano di Implementazione Pretext e Suggestions

**Creato:** 2026-04-03
**Stato:** Piano approvato - Da implementare

---

## Contesto

Dopo un'estesa analisi (2026-04-03), abbiamo definito un piano in fasi per sviluppare:
1. **Fake Pagination** con Pretext (formato pagine A4 fake come Google Docs)
2. **Fix Suggestions Panel** con ProseMirror Decorations
3. **Justify** (futuro)

**Principio architetturale:** "Cipolla" - ogni fase deve essere implementabile senza demolire le precedenti.

---

## Pretext - Comprensione

### Cosa fa Pretext
- **Misura altezza/larghezza testo** senza toccare il DOM (evita reflow costoso)
- Usa Canvas internamente per misurazioni accurate
- `prepare()` → analisi + cache (19ms per 500 testi)
- `layout()` → calcolo veloce (0.09ms) con altezza e lineCount
- `layoutWithLines()` → dice esattamente dove ogni linea si spezza
- `walkLineRanges()` → per layout custom line-by-line
- Supporta RTL, CJK, emoji, tutte le lingue

### Cosa NON fa Pretext
- Non memorizza posizioni nel documento
- Non traccia "slot" dopo modifiche
- Non è un sistema di ancoraggio

### Risorse
- Repo: https://github.com/chenglou/pretext
- Demos: https://chenglou.me/pretext/
- Pacchetto: `@chenglou/pretext@0.0.4`

---

## FASE 1: Fix Suggestions Panel (Bug Critico)

**Priorità:** 🔴 MASSIMA
**Stato:** Bug noto - slittamento posizioni su frasi identiche

### Problema
Il sistema Suggestions traccia gli slot con posizioni numeriche (`from`, `to`) che diventano obsolete dopo modifiche al testo. Il recovery usa `findTextInDoc` che trova sempre la **prima occorrenza** nel documento.

### Soluzione Adottata
**ProseMirror Decorations** (proposta Gemini - voto 10/10)

Ogni slot avrà una Decoration con ID univoco ancorata nel documento. ProseMirror aggiorna automaticamente le posizioni.

### File da Modificare/Creare

| File | Azione |
|------|--------|
| `src/editor/suggestions-marker-plugin.ts` | **CREARE** - Plugin per Decorations |
| `src/ai-panel/suggestions-panel.ts` | **MODIFICARE** - Usa Decorations invece di slotPositions |
| `src/ai-panel/suggestions-panel.ts` | Rimuovere `findTextInDoc`, `validatePosition`, `updatePositionsAfterChange` |
| `src/editor/editor.ts` | **MODIFICARE** - Integrare plugin |

### Dettaglio Implementazione

#### 1. Creare `suggestions-marker-plugin.ts`

```typescript
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const suggestionsMarkerPluginKey = new PluginKey("suggestionsMarkers");

export const suggestionsMarkerPlugin = new Plugin({
  key: suggestionsMarkerPluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, set) => {
      set = set.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(suggestionsMarkerPluginKey);
      if (meta?.add) set = set.add(tr.doc, meta.add);
      if (meta?.remove) set = set.remove(meta.remove);
      return set;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

export function getPositionForSlot(state, slotId: string): { from: number; to: number } | null {
  const decorations = suggestionsMarkerPluginKey.getState(state);
  const found = decorations.find(null, null, (spec) => spec.id === slotId);
  if (found.length) {
    return { from: found[0].from, to: found[0].to };
  }
  return null;
}
```

#### 2. Modificare `setupDotTrigger`
Alla creazione dello slot, creare una decoration:

```typescript
const decoration = Decoration.inline(pmFrom, pmFrom + sentence.length, {
  class: 'suggestion-marker',
  'data-slot-id': slot.id
}, { id: slot.id });

const tr = view.state.tr.setMeta(suggestionsMarkerPluginKey, { add: [decoration] });
view.dispatch(tr);
```

#### 3. Riscrivere `switchSuggestion` e `acceptSuggestion`
Usare `getPositionForSlot` invece di `slotPositions.get()`:

```typescript
export function switchSuggestion(id: string): void {
  const currentPos = getPositionForSlot(editorViewRef.state, id);
  if (!currentPos) {
    log(`SWITCH ERROR: Could not find decoration for slot ${id}`);
    closeSuggestion(id);
    return;
  }
  // ... procedi con sostituzione
}
```

#### 4. Rimuovere Codice Obsoleto
- `slotPositions` Map
- `validatePosition()`
- `updatePositionsAfterChange()`
- `findTextInDoc` (per Suggestions)

### Criteri di Completamento
- [ ] Switch su frasi identiche funziona correttamente
- [ ] Nessuno slittamento dopo multiple modifiche
- [ ] Nessuna dependenza da `findTextInDoc` in Suggestions

---

## FASE 2: Fake Pagination con Pretext

**Priorità:** 🔴 ALTA
**Stato:** Da implementare

### Requisiti
- Ogni pagina è un **rettangolo separato** con proporzioni A4
- Testo **editabile** dentro ogni rettangolo
- Stile AuraWrite: colore pagina + ombra
- Overflow → nuova pagina automaticamente
- Zoom: una pagina intera al 100%, 2 pagine al 50%, ecc.
- Layout: impilate verticalmente (semplice), ma permettere griglia in futuro

### Componenti

| Componente | Responsabilità |
|------------|----------------|
| `src/editor/pagination.ts` | Calcolo altezze con Pretext, gestione pagine |
| `src/editor/page-renderer.ts` | Rendering rettangoli A4 con CSS |
| Preferenze | Toggle formato continuo/paginato, dimensioni pagina |

### API Pretext da Usare

```typescript
import { prepare, layout } from '@chenglou/pretext@0.0.4';

// 1. Prepara il testo (una volta)
const prepared = prepare(text, '12pt Georgia');

// 2. Calcola altezza (veloce, ogni resize)
const { height, lineCount } = layout(prepared, pageWidth, lineHeight);

// 3. Se height > pageHeight → overflow → nuova pagina
```

### Dettaglio Implementazione

#### 1. Creare `pagination.ts`

```typescript
import { prepare, layout } from '@chenglou/pretext@0.0.4';

interface PageLayout {
  index: number;
  startOffset: number;
  endOffset: number;
  height: number;
}

export function calculatePageBreaks(
  text: string,
  font: string,
  pageWidth: number,
  pageHeight: number,
  lineHeight: number
): PageLayout[] {
  const prepared = prepare(text, font);
  const { height: totalHeight } = layout(prepared, pageWidth, lineHeight);
  
  const pageCount = Math.ceil(totalHeight / pageHeight);
  const pages: PageLayout[] = [];
  
  // TODO: usare layoutWithLines per sapere esattamente dove il testo si spezza
  // e non tagliare parole a metà
  
  for (let i = 0; i < pageCount; i++) {
    pages.push({
      index: i,
      startOffset: i * pageHeight,
      endOffset: Math.min((i + 1) * pageHeight, totalHeight),
      height: pageHeight
    });
  }
  
  return pages;
}
```

#### 2. Creare `page-renderer.ts`

Struttura HTML:
```html
<div class="pagination-container">
  <div class="page-rectangle" style="width: 210mm; height: 297mm;">
    <div class="page-content">
      <!-- ProseMirror editor qui -->
    </div>
  </div>
  <div class="page-rectangle">...</div>
</div>
```

#### 3. Gestire l'Overflow

Quando l'utente digita:
1. Pretext calcola la nuova altezza
2. Se > pageHeight, aggiungere nuova pagina
3. Il cursore va alla nuova pagina

#### 4. Toggle Formato

In Preferenze:
- Formato continuo (default attuale)
- Formato pagine (fake A4)

### Criteri di Completamento
- [ ] Pagina A4 visibile con proporzioni corrette
- [ ] Testo editabile dentro la pagina
- [ ] Overflow crea nuova pagina automaticamente
- [ ] Zoom funziona (1 pagina al 100%, 2 al 50%, ecc.)
- [ ] Toggle preferenze funziona

---

## FASE 3: Justify

**Priorità:** 🟡 MEDIA
**Stato:** Futuro - da valutare

### Note
- Pretext ha demo "Justification Comparison" con Knuth-Plass
- ProseMirror supporta `textAlign` come attributo
- Non prioritario per ora

### Possibile Approccio
1. Verificare se ProseMirror supporta nativamente justify
2. Se sì, basta aggiungere toggle nella toolbar
3. Se no, usare Pretext per calcolare spacing

### Criteri di Completamento
- [ ] Toggle justify nella toolbar
- [ ] Testo giustificato visivamente corretto

---

## Dipendenze tra Fasi

```
FASE 1 (Suggestions Fix)
    ↓
FASE 2 (Fake Pagination)
    ↓
FASE 3 (Justify)
```

---

## Note per Prossime Sessioni

### Sessione Corrente (2026-04-03)
- [x] Analisi completa di Pretext
- [x] Analisi bug Suggestions
- [x] Piano scritto

### Prossima Sessione
1. Leggere questo piano
2. Iniziare FASE 1: Suggestions con Decorations
3. Testare con frasi identiche

---

## Riferimenti

- Documentazione bug Suggestions: `documentation/06-roadmap/Risorse/AI_PROPOSTE_BUG_SUGGESTIONS.md`
- Piano Suggestions implementazione: `documentation/06-roadmap/PIANO_SUGGESTIONS_IMPLEMENTAZIONE.md`
- Test Pretext: `/home/carlo/Documenti/Aurawrite - Materiale di studio/pretext_test/`
- Repo Pretext: https://github.com/chenglou/pretext
