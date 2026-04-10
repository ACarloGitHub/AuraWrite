# Roadmap AuraWrite

## Fase 1: Editor Base ✅ COMPLETE

- [x] Editor text
- [x] Basic schema (paragraphs, heading)
- [x] Toolbar formatting (bold, italic)
- [x] Save/load JSON
- [x] Theme toggle
- [x] **File operations (2026-03-29)**: Save, Save As, Open, Export working

## Fase 2: tooltip AI ⬜ TODO

- [ ] Plugin tooltip su selezione
- [ ] Panel AI laterale
- [ ] Comunicazione editor ↔ panel
- [ ] Invio testo selezionato ad AI

## Fase 3: Funzioni AI ⬜ TODO

- [ ] Sinonimi su parola
- [ ] Revisione frase/riga
- [ ] Generazione continuazione
- [ ] Memoria personaggi/luoghi

## Fase 4: Bozze Multiple ⬜ TODO

- [ ] Nodo "bozza" con varianti
- [ ] UI linguette a margine
- [ ] Switch tra versioni

## Fase 5: Import/Export ⬜ TODO

- [x] Importa: DOCX, TXT → ProseMirror (✅)
- [x] Esporta: DOCX, HTML, MD, TXT → ProseMirror (✅)
- [ ] Importa: ODT, PDF → ProseMirror
- [ ] Esporta: ODT, PDF

## Fase 6: Polish ⬜ TODO

- [x] Tema dark/light (✅)
- [x] Zoom controls (✅)
- [x] Preferences modal (✅)
- [ ] Writing stats

## Database Integration ⬜ TODO

- [ ] SQLite con rusqlite
- [ ] Schema: projects, documents, incremental_saves
- [ ] Incremental save automatico

---

## Quick Status (2026-03-29)

**Working**: Save, Save As, Open, Export all formats (JSON, MD, TXT, DOCX, HTML)
**Issue**: When opening exported DOCX/TXT/MD, document state tracking needs review (see FILE_OPS.md)
**Next**: Test all formats, then database integration
