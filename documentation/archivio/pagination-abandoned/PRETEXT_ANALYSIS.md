# Pretext Analysis — AuraWrite Layout Pagine

**Data:** 2026-04-03
**Versione:** Pretext v0.0.4
**Obiettivo:** Valutare Pretext per WYSIWYG word processor professionale

---

## 1. Panoramica Pretext

**Cos'è:** Libreria JavaScript pura per misurazione testo multilinea senza DOM reflow.

**Autore:** chenglou (ReasonML/OCaml community)

**Repository:** https://github.com/chenglou/pretext

**Principio base:**
- `prepare()` fa lavoro costoso una volta
- `layout()` è istantaneo per resize/line-height

---

## 2. API Principali

### `prepare(text, font, options?)`

Prepara il testo per misurazioni successive.

```typescript
import { prepare } from '@chenglou/pretext'

const prepared = prepare('Hello world', '12pt Georgia')
// Costo: 10-60ms per documento lungo
// Caching interno per caratteri
```

**Opzioni:**
- `whiteSpace: 'normal' | 'pre-wrap'` — default 'normal'

**Quando re-run:**
- Testo cambia
- Font cambia
- Font size cambia

**Quando NON re-run:**
- Container width cambia
- Line height cambia
- Margini cambiano (externi a Pretext)

### `layout(prepared, maxWidth, lineHeight)`

Calcola altezza e numero righe.

```typescript
import { layout } from '@chenglou/pretext'

const result = layout(prepared, 500, 18)
// result.lineCount: numero righe
// result.height: lineCount * lineHeight

// Costo: <0.5ms per resize
// Ottimizzato per chiamate frequenti
```

### `prepareWithSegments(text, font)`

Per `layoutWithLines`.

```typescript
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('Hello world', '12pt Georgia')
const result = layoutWithLines(prepared, 500, 18)

// result.lines: LayoutLine[]
// LayoutLine = { text, width, start, end }
```

**Uso:** Bounds pixel per ogni riga.

---

## 3. Performance

### Benchmark Ufficiale

| Operazione | Tempo | Note |
|------------|------|------|
| `prepare()` | 10-60ms | Per documento lungo (100K char) |
| `layout()` | 0.1-0.5ms | Per resize |
| `layoutWithLines()` | 5-8ms | Per rendering bounds |
| `walkLineRanges()` | 0.03ms | Solo geometria, senza testo |

### Documenti Reali

| Lingua | Caratteri | Righe | `prepare()` | `layout()` |
|--------|-----------|-------|-------------|-----------|
| Arabo | 106,857 | 2,643 | 63.4ms | 0.3ms |
| Cinese | 9,428 | 626 | 19ms | 0.08ms |
| Thai | 34,033 | 1,024 | 14.3ms | 0.1ms |
| Sintetico | 78,679 | 2,860 | 18.9ms | 0.42ms |

### Architettura Consigliata per Documenti Lunghi

**NON fare:**
```typescript
// SBAGLIATO: prepare intero documento
const prepared = prepare(doc.textContent, font)
```

**FARE:**
```typescript
// GIUSTO: chunk per paragrafo
const paragraphs = doc.content.content
const prepared = paragraphs.map(p => prepare(p.textContent, font))

// Oppure cache con debouncing
let preparedCache = new Map<string, PreparedText>()
function getPrepared(text: string, font: string) {
  const key = `${text}|${font}`
  if (!preparedCache.has(key)) {
    preparedCache.set(key, prepare(text, font))
  }
  return preparedCache.get(key)
}
```

---

## 4. Cosa Pretext NON Fornisce

### ❌ Text Alignment (Justify)

Pretext usa **greedy line breaking**, **non Knuth-Plass**.

Il demo mostra confronto tra:
- CSS `text-align: justify`
- Pretext greedy
- Knuth-Plass (output, non API)

**Conclusione:** Justify NON è supportato.

**Per word processor:** Problema serio.

### ❌ Letter Spacing

Issue #78 aperto, non implementato.

### ❌ Word Spacing

Non supportato.

### ❌ Margini e Padding

Pretext misura solo testo. Margini vanno gestiti esternamente.

### ❌ Coordinate Y

Pretext restituisce solo `lineCount`. Le coordinate Y si calcolano:

```typescript
const { lines } = layoutWithLines(prepared, width, lineHeight)

for (let i = 0; i < lines.length; i++) {
  const y = i * lineHeight  // TU calcoli questo
  const line = lines[i]
  // x dipende da alignment (non fornito da Pretext)
}
```

### ❌ Page Break Logic

Nessun supporto per widow/orphan control, figure, footnotes.

---

## 5. Cosa Pretext PUÒ Fare

### ✅ Calcolo Altezza Documento

```typescript
const paragraphs = document.querySelectorAll('p')
let totalHeight = 0

paragraphs.forEach(p => {
  const prepared = prepare(p.textContent, '12pt Georgia')
  const { height } = layout(prepared, pageWidth, lineHeight)
  totalHeight += height
})

const pagesNeeded = Math.ceil(totalHeight / pageHeight)
```

### ✅ Conteggio Righe per Overflow

```typescript
const paragraphs = doc.content.content.slice(currentPageIndex)
let linesRemaining = linesPerPage

paragraphs.forEach(p => {
  const prepared = prepare(p.textContent, font)
  const { lineCount } = layout(prepared, pageWidth, lineHeight)
  
  if (linesRemaining >= lineCount) {
    linesRemaining -= lineCount
    addToCurrentPage(p)
  } else {
    // Split paragraph
    const { lines } = layoutWithLines(prepareWithSegments(p.textContent, font), pageWidth, lineHeight)
    // lines[linesRemaining] è dove tagliare
  }
})
```

### ✅ Bounds per UI Overlay

```typescript
// Per Suggestions Panel
const { lines } = layoutWithLines(prepared, width, lineHeight)

lines.forEach((line, i) => {
  const y = i * lineHeight
  const x = 0 // left-aligned, altrimenti calcolare in base ad alignment
  const width = line.width
  
  // Posizionare overlay UI
  overlayElement.style.top = `${y}px`
  overlayElement.style.left = `${x}px`
  overlayElement.style.width = `${width}px`
})
```

### ✅ Performance Resize

```typescript
// Window resize: istantaneo
let prepared // cached

window.addEventListener('resize', () => {
  const newWidth = container.clientWidth
  const { height } = layout(prepared, newWidth, lineHeight)
  // <0.5ms
})
```

---

## 6. Use Cases per AuraWrite

### Scenario A: Virtualizzazione 100+ Pagine

**Fattibile con chunking:**

```typescript
// Per ogni paragrafo visibile
const visibleParagraphs = getVisibleParagraphs(scrollTop, viewportHeight)
const prepared = visibleParagraphs.map(p => getPrepared(p.textContent, font))

// Calcolo altezza totale (per scrollbar)
let totalHeight = 0
allParagraphs.forEach(p => {
  totalHeight += cachedHeight.get(p.id) || calculateHeight(p)
})
```

### Scenario B: Bounds per Suggestions Panel

**Fattibile:**

```typescript
// Quando l'utente seleziona testo o trigger "."
const { from, to } = selection
const text = doc.textBetween(from, to)
const prepared = prepareWithSegments(text, font)
const { lines } = layoutWithLines(prepared, editorWidth, lineHeight)

// Posizione nel documento
const startCoords = view.coordsAtPos(from)

// Posizione relativa alla selezione
lines.forEach((line, i) => {
  const absoluteY = startCoords.top + (i * lineHeight)
  // Mostra suggerimento a (startCoords.left, absoluteY)
})
```

### Scenario C: Layout A4 Real-Time

**Parzialmente fattibile:**

```typescript
// Calcolo righe per pagina
const linesPerPage = Math.floor(pageHeight / lineHeight)

// Itera sui paragrafi
let currentPage = 1
let currentLines = 0

doc.forEach((node, pos) => {
  const prepared = prepare(node.textContent, font)
  const { lineCount } = layout(prepared, pageWidth, lineHeight)
  
  if (currentLines + lineCount > linesPerPage) {
    // Nuova pagina
    currentPage++
    currentLines = lineCount
    insertPageBreakWidget(pos)
  } else {
    currentLines += lineCount
  }
})
```

**MA:**
- Non gestisce justify
- Non gestisce widow/orphan
- Richiede debounce su keystroke

---

## 7. Limiti per WYSIWYG Completo

| Requisito | Supporto Pretext | Workaround |
|-----------|------------------|------------|
| Margini utente configurabili | ❌ | Gestire esternamente |
| Font dinamici | ⚠️ | Re-prepare su cambio |
| Line-height dinamico | ✅ | Parametro layout |
| Justify alignment | ❌ | DOM o custom |
| Letter-spacing | ❌ | Issue #78 |
| Editing in tempo reale | ⚠️ | Debounce + chunk per paragrafo |
| 100+ pagine | ✅ | Chunking + virtualizzazione |
| Bounds per UI | ✅ | layoutWithLines |

---

## 8. Alternativa: DOM Measurement

**Per justify e letter-spacing:**

```typescript
// Lento ma preciso
function measureText(element: HTMLElement): { height: number; width: number } {
  const rect = element.getBoundingClientRect()
  return { height: rect.height, width: rect.width }
}

// Per ogni paragrafo
paragraphs.forEach(p => {
  const clone = p.cloneNode(true)
  clone.style.visibility = 'hidden'
  document.body.appendChild(clone)
  const height = measureText(clone).height
  document.body.removeChild(clone)
})
// Costo: reflow completo, ~10-50ms per misura
```

**Pro:** Supporta tutto (justify, letter-spacing, custom fonts)
**Contro:** Lento, causa reflow

---

## 9. Raccomandazioni

### Per Bounds Suggestions Panel

**Usare Pretext:**
- ✅ Veloce (<1ms)
- ✅ Preciso per coordinate riga
- ✅ Nessun DOM reflow
- ⚠️ Calcolare Y da lineIndex * lineHeight

### Per Layout A4

**Dipende da justify:**

| Se justify | Allora |
|------------|--------|
| Indispensabile | Usare DOM measurement (lento) o custom Knuth-Plass |
| Non indispensabile | Usare Pretext con debounce per keystroke |

### Per Margini Configurabili

**Gestire esternamente:**
- Pretext misura solo area testo
- Margini applicati al contenitore ProseMirror
- Dimensioni pagina passate a `layout(prepared, pageWidth - margins, lineHeight)`

---

## 10. Conclusione

**Pretext è adatto per:**
- Calcolo altezza documenti lunghi
- Virtualizzazione (minimap, scrollbar, minimap)
- Bounds per overlay UI (Suggestions Panel)
- Performance resize window

**Pretext NON è adatto per:**
- Text-align: justify
- Letter-spacing
- WYSIWYG perfetto con tipografia avanzata

**Per AuraWrite:**
- Usare Pretext perSuggestions Panel (bounds)
- Usare Pretext per contare righe/pagine (overview)
- Per justify: decidere se indispensabile o accettare left-align
- Per margini: gestire nel CSS del contenitore, non in Pretext

---

**Referenze:**

- Repository: https://github.com/chenglou/pretext
- Demo: https://chenglou.me/pretext/
- Analisi performance: Vedi benchmark nel repository