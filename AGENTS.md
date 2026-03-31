# AuraWrite — Agent Guidelines

## Communication

- **Talk with Carlo and Aura**: Italian
- **Code, commits, docs**: English

## Project Overview

AuraWrite is a desktop writing application built with **Tauri** (Rust backend) and **ProseMirror** (rich text editor). The frontend uses vanilla JavaScript/TypeScript with CSS/HTML5 — no heavy frameworks.

**Tech Stack:**

- Frontend: TypeScript/JavaScript (vanilla)
- Editor: ProseMirror
- Backend: Rust (Tauri)
- UI: Plain CSS, HTML5

---

## Build/Lint/Test Commands

### Tauri Commands

```bash
# Development mode (hot reload)
npm run tauri dev

# Build for production
npm run tauri build

# Run Tauri in debug mode
npm run tauri dev -- --debug

# Open Tauri DevTools
npm run tauri dev
# Then press Ctrl+Shift+I in the app window
```

### TypeScript/JavaScript

```bash
# TypeScript type checking
npm run typecheck
npx tsc --noEmit

# Type check specific file
npx tsc src/main.ts --noEmit

# Run ESLint
npm run lint

# Lint specific file or directory
npx eslint src/editor/
npx eslint src/editor/editor.ts

# Format code with Prettier
npm run format

# Format specific file
npx prettier --write src/editor/editor.ts
```

### Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- src/editor/editor.test.ts
npx vitest run src/editor/editor.test.ts

# Run tests in watch mode
npm test -- --watch
npx vitest src/editor/

# Run tests matching pattern
npm test -- --grep "tooltip"
```

### Rust (src-tauri)

```bash
# Build Rust backend
cd src-tauri && cargo build

# Run Rust tests
cd src-tauri && cargo test

# Run specific Rust test
cd src-tauri && cargo test test_save_document

# Check Rust code (linter)
cd src-tauri && cargo clippy

# Format Rust code
cd src-tauri && cargo fmt
```

---

## Code Style Guidelines

### TypeScript/JavaScript

**File Naming:**

- Components/modules: `kebab-case.ts` (e.g., `editor-state.ts`, `ai-panel.ts`)
- Types/interfaces: `kebab-case.ts` with descriptive names
- Test files: `*.test.ts` suffix

**Naming Conventions:**

```typescript
// Variables and functions: camelCase
const editorState = ...
function saveDocument() {}

// Types and interfaces: PascalCase
interface EditorConfig {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;

// Private methods: prefix with underscore
_privateMethod() {}

// Event handlers: suffixed with Handler
function onClickHandler() {}
```

**TypeScript Rules:**

- Always use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes
- Use `unknown` instead of `any`; narrow types appropriately
- Enable strict mode in tsconfig.json

```typescript
// Good
function processText(text: string): EditorTransaction {
  return view.state.tr.insertText(text);
}

// Avoid
function processText(text: any) {
  return view.state.tr.insertText(text);
}
```

**Imports:**

- Group imports: external packages → internal modules → relative imports
- Use named exports, avoid default exports for utilities
- Import types with `import type` when only used for type annotations

```typescript
import { EditorState } from "prosemirror-state";
import type { Plugin } from "prosemirror-state";

import { createEditorPlugin } from "./plugins";
import { schema } from "./schema";
```

**Error Handling:**

- Use `Result<T, E>` pattern for functions that can fail
- Always provide meaningful error messages
- Never swallow errors silently

```typescript
// Good
async function loadDocument(path: string): Promise<Result<string, string>> {
  try {
    const content = await readFile(path);
    return { ok: true, value: content };
  } catch (e) {
    return { ok: false, error: `Failed to load: ${path} - ${e.message}` };
  }
}

// Avoid
async function loadDocument(path: string): Promise<string> {
  try {
    return await readFile(path);
  } catch (e) {
    console.error(e); // Silent swallow - avoid
    return "";
  }
}
```

### Rust

**File Naming:** `snake_case.rs`

**Naming Conventions:**

- Functions and variables: `snake_case`
- Structs and enums: `PascalCase`
- Modules: `snake_case`
- Constants: `SCREAMING_SNAKE_CASE`

**Error Handling:**

- Return `Result<T, String>` for commands (Tauri convention)
- Use `map_err(|e| e.to_string())` to convert errors to strings

```rust
#[tauri::command]
fn save_document(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content)
        .map_err(|e| e.to_string())
}
```

### ProseMirror Patterns

**Plugin Structure:**

```typescript
import { Plugin, PluginKey } from "prosemirror-state";

const myPluginKey = new PluginKey("myPlugin");

export const myPlugin = new Plugin({
  key: myPluginKey,
  props: {
    handleClick(view, pos) {
      /* ... */
    },
  },
  state: {
    init() {
      return myPluginState;
    },
    apply(tr, prev) {
      /* transform state */
    },
  },
});
```

**Schema Definition:**

- Keep schema minimal and extensible
- Use attributes for customization
- Follow existing node specs pattern

### CSS

- Use CSS custom properties for theming
- BEM naming convention for component styles
- Group related styles together
- Mobile-first approach

```css
/* BEM naming */
.ai-panel__header {
}
.ai-panel__input {
}
.ai-panel--collapsed {
}

/* Custom properties for theming */
:root {
  --color-primary: #007bff;
  --color-background: #ffffff;
  --spacing-unit: 8px;
}
```

---

## Project Structure

```
AuraWrite/
├── src/
│   ├── editor/
│   │   ├── editor.ts           # Main editor setup + parseHTML
│   │   ├── toolbar.ts          # Toolbar handlers + file menu
│   │   ├── selection-highlight.ts  # Selection highlight plugin
│   │   ├── chunk-decorations.ts   # ProseMirror decorations for chunk markers
│   │   └── ...
│   ├── ai-panel/
│   │   ├── chat.ts             # AI chat panel logic
│   │   ├── suggestions-panel.ts # Sentence suggestions panel
│   │   ├── ai-manager.ts       # AI provider manager
│   │   ├── chunks.ts           # Document chunking system
│   │   ├── providers.ts        # AI provider interfaces
│   │   ├── ollama-provider.ts  # Ollama provider
│   │   └── remote-providers.ts # OpenAI/Anthropic providers
│   ├── formats/            # Import/export converters
│   │   ├── markdown.ts     # Markdown import/export
│   │   ├── txt.ts          # Plain text import/export
│   │   ├── html.ts         # HTML export
│   │   ├── docx.ts         # DOCX import/export
│   │   ├── odt.ts          # Placeholder ODT
│   │   └── pdf.ts          # Placeholder PDF
│   ├── styles.css          # Main styles (light/dark theme)
│   └── main.ts             # App entry point + theme logic
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   └── lib.rs          # Rust commands
│   └── capabilities/        # Tauri permissions
├── index.html
└── package.json
```

## Current Features (as of 2026-03-31)

### ✅ Implemented

- Editor ProseMirror with basic formatting (bold, italic)
- Undo/redo
- **File operations (2026-03-29)**: Save, Save As, Open, Export working
  - Formats: JSON, Markdown, TXT, HTML, DOCX
  - Document state tracking (path, format, dirty flag)
  - Window title shows filename and dirty state
- Theme system (light/dark/custom) with toggle button
- Theme persistence via localStorage
- Preferences modal with:
  - Toolbar display options (icon/text/both)
  - Theme selector (light/dark/custom)
  - Custom colors (background, toolbar, paper, editor text, button text)
  - Incremental save settings (enable + max saves)
- Zoom controls in status bar (+/- and percentage)
- Keyboard shortcuts for zoom (Ctrl++/Ctrl+-)
- **AI Suggestions Panel (2026-03-31)**:
  - Trigger on "." keypress (letter + space pattern)
  - Per-sentence analysis with individual suggestion panels
  - Expandable/collapsible/closeable suggestion items
  - Accept/Reject/Switch/Close buttons per suggestion
  - Switch toggles between original and suggested text in document
  - Accept saves original to database (future) and replaces with suggestion
  - Reject replaces with suggestion and removes suggestion
  - Context-aware punctuation handling (no duplicate .!?)
- **AI Assistant Panel (2026-03-31)**:
  - Document text passed to AI on every message
  - Chunk-based context management for large documents
  - ProseMirror decorations for chunk markers
  - Configurable max tokens per chunk (default 8k)
  - User can select which chunk to discuss with AI
  - Fix: chat no longer blocks after first message
  - Fix: document text properly passed to AI

### ✅ Toolbar Layout

```
[Save][Save As][Open][Export] | [Undo][Redo] | [B][I] | [AI][⚙️][🌙]
```

### ✅ AI Panels

| Feature                    | Status                           |
| -------------------------- | -------------------------------- |
| Suggestions Panel (left)   | ✅ Active - triggers on "."      |
| AI Assistant Panel (right) | ✅ Active - passes document text |
| Ollama provider            | ✅ Working                       |
| OpenAI provider            | ✅ Working                       |
| Anthropic provider         | ✅ Working                       |
| Document chunking          | ✅ Implemented                   |
| Chunk decorations          | ✅ Implemented                   |

### ✅ Import/Export Formats

| Format           | Import | Export |
| ---------------- | ------ | ------ |
| JSON ProseMirror | ✅     | ✅     |
| Markdown         | ✅     | ✅     |
| Plain Text       | ✅     | ✅     |
| HTML             | -      | ✅     |
| DOCX             | ✅     | ✅     |

### ⚠️ Placeholders (TODO)

- ODT import/export
- PDF import/export

---

## Roadmap

### Phase 1: Editor Base ✅ COMPLETE

- [x] Editor text
- [x] Basic schema (paragraphs, heading)
- [x] Toolbar formatting (bold, italic)
- [x] Save/load JSON
- [x] Theme toggle

### Phase 2: AI Tooltip ⬜ COMPLETE (2026-03-31)

- [x] AI Provider architecture (Ollama, OpenAI, Anthropic)
- [x] AI Suggestions Panel with "." trigger
- [x] Per-sentence analysis with accept/reject/switch/close
- [x] AI Assistant Panel with document context
- [x] Chunk-based context management for large documents
- [x] ProseMirror decorations for chunk markers
- [ ] Tooltip plugin on text selection (TODO)

### Phase 3: AI Functions ⬜ TODO

- [ ] Synonyms
- [ ] Phrase/line revision
- [ ] Continuation generation
- [ ] Character/place memory

### Phase 4: Multiple Drafts & Versions ⬜ TODO

- [x] Incremental save placeholder (done 2026-03-29)
- [ ] UI per visualizzare versioni e recuperarle
- [ ] Diff visivo fra versioni
- [ ] Preview versioni
- [ ] Gestione automatica spazio (limite versioni)

### Phase 5: Polish ⬜ TODO

- [x] Dark/light/custom theme (done ✅)
- [x] Zoom controls (done ✅)
- [x] Preferences modal (done ✅)
- [ ] Export enhancements
- [ ] Writing stats

---

## Next Tasks (Priority Order)

### 1. Database Architecture ⬜ IN PROGRESS

- [ ]等待 Carlo 完成研究后定义初始结构
- See `documentation/06-roadmap/BRAINSTORMING_DB.md` for vision
- Schema proposal: SQL + Vector DB hybrid
- Tables: documents, characters, locations, relationships, incremental_saves

### 2. Incremental Save Implementation ⬜ TODO

- UI per visualizzare versioni e recuperarle
- Diff visivo fra versioni
- Preview versioni
- Gestione automatica spazio (limite versioni)

### 3. AI Panel Enhancement ⬜ TODO

- [x] Document chunking (done 2026-03-31)
- [ ] Vector DB integration for semantic search
- [ ] Warn user when context is near limit (TODO)
- [ ] Insert AI responses directly into document

### 4. Tooltip Plugin ⬜ TODO

- Context menu on text selection
- AI-powered suggestions via tooltip

---

## General Principles

1. **No Magic** — Avoid hidden side effects; make behavior explicit
2. **Small Functions** — Functions should do one thing well (max ~50 lines)
3. **Document Complex Logic** — Add comments for non-obvious code paths
4. **Test Critical Paths** — Editor state, document persistence, Rust commands
5. **Type Safety First** — Avoid `any`, use proper error handling
6. **Consistent Patterns** — Follow existing code conventions; match surrounding style

## Git Conventions

**Commit Messages**: English, imperative mood

```
feat: add tooltip plugin for text selection
fix: resolve selection coordinate calculation
docs: update ProseMirror plugin documentation
```

**Branch Naming**: `feature/`, `fix/`, `docs/` prefixes

## GitHub & Local Files

**Use git normally** for version control.

**NEVER commit OpenCode files:**

```
.opencode/
.opencode/**
opencode.*
```

**GitHub (https://github.com/ACarloGitHub/AuraWrite) — only:**

- Code needed to build and run the project
- Essential configs (package.json, Cargo.toml, tsconfig.json, etc.)

**Local only (never on GitHub):**

- `documentation/` — design docs, notes, reflections
- `memory/` — character/world data files
- Any local-only config files

**Before pushing, always ask Carlo what to include.**

---

## Documentation

**Full documentation**: `documentation/` (local only, not on GitHub)

| File                             | Purpose                                |
| -------------------------------- | -------------------------------------- |
| `INDEX.md`                       | Quick reference index                  |
| `06-roadmap/STATO.md`            | Current status, bugs, progress         |
| `06-roadmap/FILE_OPS.md`         | File operations implementation details |
| `06-roadmap/BRAINSTORMING_DB.md` | Database architecture brainstorming    |
| `RESUME_MEMO.md`                 | Session resume memo for agents         |

---

## Documentation Practice

After every operation that changes code, state, or decisions, update documentation:

1. **AGENTS.md**: Update if new features added, new commands created, or structure changed
2. **documentation/06-roadmap/STATO.md**: Update for bugs fixed, new bugs found, implementation decisions
3. **documentation/06-roadmap/FILE_OPS.md**: Update for file operations changes
4. **documentation/RESUME_MEMO.md**: Update before ending session with current progress
5. **Other docs**: Update relevant documentation files in `/documentation/`

Key principle: The documentation must allow a future session (or another agent) to understand:

- What was done
- Where to find details
- What decisions were made and why
