# Bundled Fonts (v0.4.0+)

AuraWrite bundles three open-source fonts licensed under the **SIL Open Font License (OFL) 1.1**:

| File | Family | Weights | License | Source |
|------|--------|---------|---------|--------|
| `Lora-Variable.ttf` | Lora Serif | 100-900 (variable) | [OFL-1.1](https://github.com/google/fonts/blob/main/ofl/lora/OFL.txt) | [google/fonts](https://github.com/google/fonts/tree/main/ofl/lora) |
| `Inter-Variable.ttf` | Inter (Sans) | 100-900 (variable) | [OFL-1.1](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt) | [google/fonts](https://github.com/google/fonts/tree/main/ofl/inter) |
| `JetBrainsMono-Variable.ttf` | JetBrains Mono | 100-800 (variable) | [OFL-1.1](https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt) | [google/fonts](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono) |

## Why these fonts?

- **Lora** (serif): well-suited for long-form prose, the primary use case of a writing app. Excellent readability at small sizes. Warm, friendly character set.
- **Inter** (sans): modern, neutral, optimized for UI/screens. Used by GitHub, Figma, and many open-source projects.
- **JetBrains Mono** (monospace): technical/code contexts (AURA_EDIT, JSON previews, etc.).

All three are:
- **Variable fonts** (one file = all weights) — keeps the bundle small
- **SIL OFL 1.1** — permissive, allows bundling and redistribution, compatible with AuraWrite's MIT license
- **Maintained by Google Fonts** — stable, well-tested, with regular updates

## How to use

These fonts are **always available** in AuraWrite (Level 2 of the font priority chain) when the user has the "Use bundled fonts" preference enabled. They are registered via `@font-face` in `src/styles.css` and used in the `--font-family` and `--font-editor` CSS custom properties.

## Font priority chain

1. **User folder** (`%APPDATA%\aurawrite\fonts\` or equivalent) — files dropped by the user
2. **Bundled** (this folder) — Lora, Inter, JetBrains Mono
3. **System** — any font installed on the OS (Georgia, Times New Roman, Segoe UI, etc.)
4. **Generic fallback** — `serif`, `sans-serif`, `monospace`

The Preferences → Fonts tab shows the available font for each level with a suffix indicating the source (e.g. "Lora Serif (bundled)", "Georgia (system)").

## License compliance

OFL 1.1 allows:
- ✓ Free use, modification, and redistribution
- ✓ Bundling in commercial and non-commercial software
- ✓ Creation of derivative works (with renamed family)

OFL 1.1 requires:
- Keep the OFL notice and license text with the font files
- Rename modified versions (we have not modified the fonts)

For full text: https://scripts.sil.org/OFL
