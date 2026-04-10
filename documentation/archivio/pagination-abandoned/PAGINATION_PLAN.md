# Pagination Implementation Plan - Fase 1: Marker Manuali

## Overview
Implementazione marker pagina manuali per AuraWrite. L'utente può marcare qualsiasi paragrafo come "inizio nuova pagina".

## Specifiche Tecniche

### 1. Schema ProseMirror

Aggiungere attributo `pageBreakBefore` al nodo `paragraph`:

```typescript
// In schema.ts o dove definisci lo schema
const paragraph = {
  attrs: {
    pageBreakBefore: { default: false }
  },
  parseDOM: [{
    tag: "p",
    getAttrs: (dom: HTMLElement) => ({
      pageBreakBefore: dom.classList.contains("page-break-before")
    })
  }],
  toDOM: (node) => [
    "p", 
    { 
      class: node.attrs.pageBreakBefore ? "page-break-before" : undefined 
    },
    0
  ]
};
```

### 2. Stili CSS

```css
/* Visualizzazione del marker */
.page-break-before {
  position: relative;
  margin-top: 2rem;
}

.page-break-before::before {
  content: "⏎ Nuova Pagina";
  display: block;
  position: absolute;
  top: -1.5rem;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.75rem;
  color: #666;
  background: #f0f0f0;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  border: 1px dashed #999;
}

.page-break-before::after {
  content: "";
  display: block;
  border-top: 2px dashed #ccc;
  margin: 0.5rem 0;
}
```

### 3. Comando Toggle

```typescript
// Comando ProseMirror per attivare/disattivare marker
export const togglePageBreak = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
  const { from, to } = state.selection;
  const paragraphPos = state.doc.resolve(from).blockRange()?.parent;
  
  if (!paragraphPos) return false;
  
  const node = state.doc.nodeAt(from);
  if (!node || node.type.name !== "paragraph") return false;
  
  const currentValue = node.attrs.pageBreakBefore || false;
  
  if (dispatch) {
    const tr = state.tr.setNodeMarkup(from, undefined, {
      ...node.attrs,
      pageBreakBefore: !currentValue
    });
    dispatch(tr);
  }
  
  return true;
};
```

### 4. UI Toolbar

Aggiungere pulsante "↲ Page Break" nella toolbar che:
- Mostra stato attivo/inattivo
- Chiama `togglePageBreak`
- Cambia icona/colore quando il paragrafo corrente ha il marker

### 5. Integrazione con Paged.js (Fase 2)

Paged.js riconosce automaticamente `break-before: page`:

```css
@media print {
  .page-break-before {
    break-before: page;
  }
}
```

### 6. Test Importanti

**Test 1: AI Suggestions Panel**
- Inserire marker in un paragrafo
- Verificare che "Suggestions" triggerati su "." funzionino ancora
- Il testo del paragrafo deve essere trovabile da `findTextInDoc`

**Test 2: AI Assistant (AURA_EDIT)**
- Inserire marker
- Chiedere all'AI di modificare il paragrafo con marker
- Verificare che AURA_EDIT trovi e modifichi correttamente

**Test 3: Coordinate System**
- Inserire marker
- Verificare che le posizioni `from`/`to` nei risultati siano corrette
- Il marker non deve interferire con il calcolo dei caratteri

## Note per OpenCode

1. **Il marker è un attributo, non un nodo separato** → più stabile con il reflow
2. **Il paragrafo con marker rimane un paragrafo normale** → AI lo tratta come testo
3. **Il CSS mostra linea visiva** → l'utente vede dove c'è il salto pagina
4. **Pagine non esistono ancora** → questo è solo un "indicatore d'intento"

## Prossimi Passi

1. Implementare schema + CSS
2. Aggiungere comando + pulsante toolbar
3. Test con AI panels
4. Integrare Paged.js per export

---
*Generato da Aura per AuraWrite*
