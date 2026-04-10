# Fake Pagination in ProseMirror — Piano di Implementazione

## ⚠️ DOCUMENTO PRECEDENTE ARCHIVIATO
Il documento `PROSEMIRROR_PAGEDJS_SYNC.OLD.md` contiene il tentativo fallito di usare Paged.js per editing bidirezionale live. Quel approccio è **archiviato**.

---

## Data: 2026-04-02
## Autore: Aura (OpenClaw) — Sintesi da Qwen, Deepseek, GPT
## Stato: PIANO DEFINITIVO

---

## 1. Perché il Vecchio Approccio Non Funziona

### Paged.js è un motore One-Way

```
HTML sorgente → [Paged.js layout engine] → Pagine renderizzate
                      ↑
            Non è progettato per tornare indietro
```

Paged.js:
- Applica `break-before` **solo durante il layout iniziale**
- Non ha reattività — le modifiche al DOM dopo il render vengono ignorate
- I break automatici (overflow) **non sono esposti come nodi**
- Clona il DOM in una struttura shadow interna

**Conclusione:** Paged.js può essere solo anteprima PDF, non editor paginato live.

---

## 2. Architettura Finale

```
┌──────────────────────────────────────────────────────────┐
│                  ProseMirror (Unica Fonte)                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Schema: page_break node (marker esplicito)         │  │
│  │ Plugin: pagination debounced                        │  │
│  │ Misurazione: hidden container con stessi CSS       │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Vista Continua (editor) ←→ Vista Paginata          │  │
│  │ (scroll-snap container con pagine A4 fittizie)     │  │
│  └────────────────────────────────────────────────────┘  │
│                          ↓                                │
│               Paged.js (solo export PDF)                  │
└──────────────────────────────────────────────────────────┘
```

### Tre Viste Distinte

| Vista | Scopo | Editing |
|-------|-------|---------|
| **Continua** | Scrittura principale | ✅ Sì |
| **Paginata** | Anteprima layout | ✅ Sì (modifiche sincronizzate) |
| **PDF Export** | Stampa/PDF finale | ❌ Solo lettura |

---

## 3. Piano di Implementazione in 5 Fasi

### FASE 1: Base — Page Break Manuali
- [ ] Schema ProseMirror con nodo `page_break`
- [ ] Container con scroll-snap per pagine A4
- [ ] Page break che forza nuova pagina visiva
- [ ] Toggle tra vista continua e paginata

### FASE 2: Overflow Detection
- [ ] Hidden container per misurazione altezza
- [ ] Rilevamento quando contenuto eccede spazio pagina
- [ ] Spostamento nodo intero alla pagina successiva

### FASE 3: Split Intelligente
- [ ] Split paragrafi quando non entrano (mantenere marks)
- [ ] Gestione immagini/tabelle come blocchi atomici

### FASE 4: UI/UX Completa
- [ ] Indicatore pagina corrente / totale
- [ ] Navigazione tastiera (PgUp/PgDown)
- [ ] Shortcut per inserire page break
- [ ] Debounce 300ms per performance

### FASE 5: Integrazione Paged.js
- [ ] Serializzazione doc → HTML per Paged.js
- [ ] Anteprima PDF read-only
- [ ] Export PDF

---

## 4. Dettaglio Tecnico

### 4.1 Schema — Nodo page_break

```javascript
page_break: {
  group: "block",
  isolating: true,
  selectable: true,
  draggable: false,
  toDOM: () => ["div", {
    "data-page-break": "true",
    class: "pm-page-break"
  }, "📄 Nuova Pagina"],
  parseDOM: [{
    tag: "div[data-page-break='true']",
    getAttrs: () => ({})
  }]
}
```

### 4.2 Algoritmo di Paginazione (Pseudo-codice)

```javascript
function paginate(view, pageHeight) {
  const pages = [];
  let currentPage = [];
  let remainingHeight = pageHeight;

  view.state.doc.forEach(node => {
    // Page break manuale → nuova pagina
    if (node.type.name === 'page_break') {
      pages.push(currentPage);
      currentPage = [];
      remainingHeight = pageHeight;
      return;
    }

    const nodeHeight = measureNode(node); // misura in hidden container

    if (nodeHeight <= remainingHeight) {
      currentPage.push(node);
      remainingHeight -= nodeHeight;
    } else {
      // Nodo troppo grande → split o nuova pagina
      if (canSplit(node)) {
        const [first, second] = splitNode(node, remainingHeight);
        currentPage.push(first);
        pages.push(currentPage);
        currentPage = [second];
        remainingHeight = pageHeight - measureNode(second);
      } else {
        // Forza nuova pagina col nodo intero
        pages.push(currentPage);
        currentPage = [node];
        remainingHeight = pageHeight - nodeHeight;
      }
    }
  });

  if (currentPage.length) pages.push(currentPage);
  return pages;
}
```

### 4.3 Misurazione Nodi

```javascript
function measureNode(node) {
  const container = getHiddenContainer();
  container.innerHTML = '';
  const serializer = DOMSerializer.fromSchema(schema);
  container.appendChild(serializer.serializeFragment(node.content));
  return container.getBoundingClientRect().height;
}
```

### 4.4 Plugin Pagination (debounced)

```javascript
const paginationPlugin = new Plugin({
  view(view) {
    let timer;
    return {
      update(view, prevState) {
        if (view.state.doc.eq(prevState.doc)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const pages = paginate(view, PAGE_HEIGHT);
          renderPages(pages);
        }, 300);
      }
    };
  }
});
```

### 4.5 CSS per Fake Pages

```css
.page-container {
  height: 100vh;
  overflow-y: scroll;
  scroll-snap-type: y mandatory;
}

.page {
  width: 210mm;
  height: 297mm;
  margin: 20px auto;
  background: white;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  scroll-snap-align: start;
  overflow: hidden;
  box-sizing: border-box;
  padding: 25mm 20mm;
}

.page-content {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
```

---

## 5. Split Nodi — Dettaglio

### Split Paragrafo (mantenendo Marks)

```javascript
function splitParagraph(paraNode, splitAt) {
  const firstText = paraNode.textContent.slice(0, splitAt);
  const secondText = paraNode.textContent.slice(splitAt);

  const firstMarks = getMarksAt(paraNode, 0, splitAt);
  const secondMarks = getMarksAt(paraNode, splitAt);

  const first = schema.node('paragraph', null, [
    schema.text(firstText, firstMarks)
  ]);
  const second = schema.node('paragraph', null, [
    schema.text(secondText, secondMarks)
  ]);

  return [first, second];
}
```

**Nota:** Usare `node.cut(from, to)` di ProseMirror quando possibile.

---

## 6. Gestione Performance

| Problema | Soluzione |
|----------|----------|
| Lag durante digitazione | Debounce 300ms |
| Cursor jump | Salva/restora selection con `tr.mapping.map()` |
| Misurazione CSS divergente | Hidden container con stessi stili esatti |
| Immagini/tabelle overflow | Trattare come blocchi atomici, break prima/dopo |

---

## 7. Limitazioni Note

| Funzionalità | V1 | Futuro |
|-------------|-----|--------|
| Page break manuali | ✅ | ✅ |
| Overflow detection | ✅ | ✅ |
| Split paragrafi | ❌ | ✅ |
| Split inline (a metà frase) | ❌ | ✅ |
| Immagini ridimensionamento | ❌ | ✅ |

---

## 8. Prossimi Passi

### Step 1: Prototipo Minimo
Creare un test HTML con:
- Schema base + nodo page_break
- Container con scroll-snap (1 pagina visibile)
- Toggle vista continua/paginata
- Page break manuali che funzionano

### Step 2: Overflow Detection
- Hidden container per misura
- Logica sposta nodo alla pagina successiva

### Step 3: Integrazione Completa
- Plugin ProseMirror
- Debounce
- UI completa

### Step 4: Paged.js Export
- Serializzazione
- Preview PDF

---

## 9. Riferimenti

- ProseMirror: https://prosemirror.net/
- CSS Scroll Snap: https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-snap
- Paged.js (solo export): https://pagedjs.org/
- ProseMirror Node.cut(): https://prosemirror.net/docs/ref/#model.Node.cut

---

## 10. Conclusione

Questo approccio è **complessità gestibile** e **professionale**:
- ProseMirror rimane l'unica fonte di verità
- Page break sono nodi persistenti
- Fake pagination dà UX pagine senza dipendenza da Paged.js
- Paged.js usato solo per export PDF

*Documento creato per il progetto AuraWrite*
