# Pagination — Stato e Piano

**Ultimo aggiornamento:** 2026-04-07

---

## Stato Attuale

**Formato:** Continuo con page break manuali

AuraWrite usa un formato continuo (senza pagine). L'utente può marcare i punti dove inserire interruzioni pagina.

---

## Tentativi Falliti

| Soluzione | Esito | Problema |
|-----------|-------|----------|
| **prosemirror-pagination** | ❌ Non utilizzabile | Schema rigido: richiede nodi `page > body`, non permette toggle continuo/paginato |
| **Lexical (Meta)** | ❌ Fallito | Paginazione minima non funzionante |
| **TipTap** | ❌ Fallito | Esiti pessimi |

### Perché hanno fallito

Tutti i plugin di paginazione per editor hanno lo stesso problema fondamentale: **modificano lo schema del documento in modo irreversibile**.

Una volta che il documento usa nodi `page`, `body`, etc., non è possibile tornare alla visualizzazione continua senza perdere informazioni.

---

## Soluzione Corretta

### Principio
- Tenere lo schema semplice (formato continuo)
- Calcolare i break **visivamente** con decorations
- Esportare in formato paginato solo all'export (Paged.js)

### Page Break Manuali (Implementato)

L'utente può marcare un paragrafo come "inizio nuova pagina":

```typescript
// Schema
paragraph: {
  attrs: { pageBreakBefore: { default: false } }
}

// CSS visivo
.page-break-before::before {
  content: "⏎ Nuova Pagina";
  // ...
}
```

---

## Piano per Page Break Automatici

### Fase 1: Calcolo Altezza

Usare **Pretext** per misurare il testo senza DOM reflow:

```typescript
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare(text, '12pt Georgia')
const { height, lineCount } = layout(prepared, pageWidth, lineHeight)

// Se height > pageHeight → overflow → suggerire break
```

### Fase 2: Decorations

Usare **ProseMirror Decorations** per mostrare indicatori visivi:

```typescript
// Marca dove il testo supera l'altezza pagina
const decorations = DecorationSet.create(doc, [
  Decoration.widget(pos, createBreakIndicator())
])
```

### Fase 3: Suggerimento Break

Quando l'utente digita e il testo overflow:
- Mostrare indicatore visivo
- Chiedere se vuole inserire break
- NON inserire automaticamente

### Fase 4: Export con Paged.js

Per esportare in PDF/ePub:
- Usare Paged.js per generare layout paginato
- Rispettare i `pageBreakBefore` come `break-before: page`
- Generare PDF professionale

---

## Cosa Serve

### Librerie

| Libreria | Uso | Stato |
|----------|-----|-------|
| `@chenglou/pretext` | Misurazione testo | Testato in `pretext_test/` |
| `paged.js` | Export PDF | Da integrare |

### File da Creare

| File | Responsabilità |
|------|----------------|
| `src/editor/pagination.ts` | Calcolo altezze con Pretext |
| `src/editor/page-decorations.ts` | Decorations per indicatori |
| `src/editor/export-pdf.ts` | Export con Paged.js |

---

## Test Importanti

### Prima di Implementare

1. **Con AI panels attivi**: Verificare che i marker non interferiscano con `findTextInDoc`
2. **Con documenti lunghi**: Testare performance con testo >50k caratteri
3. **Con formattazione**: Verificare che bold/italic non rompano il calcolo

---

## Risorse

- **Pretext repo:** https://github.com/chenglou/pretext
- **Pretext demo:** https://chenglou.me/pretext/
- **Paged.js:** https://pagedjs.org/
- **Test effettuati:** `/home/carlo/Documenti/Aurawrite - Materiale di studio/pretext_test/`

---

## Archivio Tentativi

La documentazione dettagliata dei tentativi falliti è in:
- `documentation/archivio/pagination-abandoned/`
- `documentation/06-roadmap/PAGINATION_KNOWLEDGE.md`
- `documentation/06-roadmap/PAGINATION_FAILED_ATTEMPTS.md`

---

*Aggiornato da Aura — 2026-04-07*