# ProseMirror + Paged.js: Architettura Sincronizzazione Bidirezionale

## Data: 2026-04-02
## Autore: Aura (OpenClaw)

---

## 1. Panoramica del Problema

### Obiettivo
Creare un editor di testo che supporti:
- **Vista continua** (ProseMirror): editing fluido, history, decorations per AI
- **Vista paginata** (Paged.js): anteprima stampa A4, editing nelle pagine
- **Sincronizzazione bidirezionale**: modifiche in entrambe le viste

### Il Nodo Centrale
Paged.js pagina automaticamente in base all'altezza contenuto. Questo crea **break automatici** che non corrispondono a posizioni nel documento ProseMirror.

---

## 2. Limitazioni Tecniche

### Paged.js è One-Way
- Prende HTML, lo pagina, renderizza
- Non espone API per mappare "nodo X → pagina Y"
- I `BreakToken` sono riferimenti DOM temporanei (invalidi dopo il render)

### ProseMirror è Strutturato
- Usa nodi tipizzati (`paragraph`, `page_break`, ecc.)
- Decorations per AI suggestions
- History e transazioni precise

### Il Divario
| Aspetto | ProseMirror | Paged.js |
|---------|-------------|----------|
| Modello | Albero di nodi | HTML piatto |
| Page break | Nodo esplicito | CSS `break-before` |
| Break automatici | Non esistono | Calcolati dal motore |

---

## 3. Soluzione Proposta: Marker Espliciti

### Concetto
Usare **marker nel DOM** che sono riconoscibili da entrambi i sistemi:

```html
<!-- In HTML passato a Paged.js -->
<div class="page-break-marker" data-prosemirror-break="true">
    — Nuova Pagina —
</div>
```

### CSS per Paged.js
```css
.page-break-marker {
    break-before: page;
    page-break-before: always;
}
```

### Flusso Completo

#### A) ProseMirror → Paged.js
1. ProseMirror esporta HTML con nodi `page_break` → `<div class="page-break-marker">`
2. Paged.js renderizza, rispetta i marker
3. **Break automatici** di Paged.js aggiunti dove serve

#### B) Paged.js → ProseMirror (Sync)
1. Estrai HTML dal DOM renderizzato
2. Trova tutti `.page-break-marker` → ricrea nodi `page_break`
3. Parsa il resto come contenuto normale
4. Sostituisci documento ProseMirror

### Cosa SI preserva
- ✅ Testo modificato in Paged.js
- ✅ Page break **manuali** (marker espliciti)
- ✅ Formattazione di base (paragrafi, heading)

### Cosa NON si preserva
- ❌ Page break **automatici** di Paged.js (overflow)
- ❌ Posizione esatta elementi
- ❌ Stili specifici di pagina (header/footer)

---

## 4. Implementazione

### 4.1 Schema ProseMirror
```javascript
nodes: {
    page_break: {
        group: "block",
        toDOM: () => ["div", { 
            class: "page-break-marker",
            "data-prosemirror-break": "true" 
        }, "— Nuova Pagina —"]
    }
}
```

### 4.2 CSS Paged.js
```css
@page {
    size: A4;
    margin: 25mm 20mm;
}

.page-break-marker {
    break-before: page;
    text-align: center;
    color: #666;
    padding: 10px;
}
```

### 4.3 Funzione di Sync
```javascript
function syncFromPagedToProseMirror(pagedContainer, prosemirrorView) {
    // 1. Estrai HTML
    const html = pagedContainer.innerHTML;
    
    // 2. Converti marker in nodi page_break
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 3. Trova e sostituisci marker
    const markers = doc.querySelectorAll('.page-break-marker');
    markers.forEach(marker => {
        // Ricrea come nodo ProseMirror
    });
    
    // 4. Crea nuovo documento ProseMirror
    // 5. Sostituisci
}
```

---

## 5. UI/UX

### Modalità di Lavoro
| Modalità | Uso |
|----------|-----|
| **Continua** | Editing normale, AI suggestions |
| **Paginata** | Anteprima stampa, aggiustamenti layout |

### Popup di Avviso
Quando si passa da Paged.js a Continuo:

> ⚠️ **Attenzione**: Le modifiche al testo verranno sincronizzate. 
> I page break automatici (dovuti a overflow) verranno persi. 
> Solo i page break manuali (inseriti con il pulsante) verranno preservati.

---

## 6. Casi d'Uso

### Caso 1: Scrivi → Anteprima
1. Scrivi in ProseMirror (vista continua)
2. Inserisci manualmente page break dove vuoi
3. Passa a vista Paged → vedi pagine A4
4. Torna a ProseMirror → tutto intatto

### Caso 2: Modifica in Paged
1. Sei in vista Paged
2. Modifichi un paragrafo (testo)
3. Torna a ProseMirror → testo aggiornato, page break manuali preservati

### Caso 3: Paged aggiunge break automatici
1. Testo lungo, Paged.js spezza pagina automaticamente
2. Torna a ProseMirror → **quel break si perde**
3. Se necessario, reinserisci manualmente in ProseMirror

---

## 7. Conclusione

### Vantaggi
- ✅ Editing potente con ProseMirror
- ✅ Anteprima pagine A4 con Paged.js
- ✅ Sincronizzazione testo bidirezionale
- ✅ Page break manuali preservati

### Limitazioni Accettabili
- ⚠️ Break automatici di Paged.js non tornano indietro
- ⚠️ Necessita pulsante "Sync" esplicito

### Alternativa Scartata
Usare solo Paged.js (senza ProseMirror) → perderei decorations per AI suggestions, che è il cuore di AuraWrite.

---

## 8. Riferimenti

- ProseMirror: https://prosemirror.net/
- Paged.js: https://pagedjs.org/
- CSS Paged Media: https://www.w3.org/TR/css-page-3/

---

*Documento creato per il progetto AuraWrite*
