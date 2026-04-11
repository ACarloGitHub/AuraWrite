# AuraWrite — Developer Guide

**Ultimo aggiornamento:** 2026-04-08

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

# Run ESLint
npm run lint

# Format code with Prettier
npm run format
```

### Rust (src-tauri)

```bash
# Build Rust backend
cd src-tauri && cargo build

# Run Rust tests
cd src-tauri && cargo test

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

**Imports:**
- Group imports: external packages → internal modules → relative imports
- Use named exports, avoid default exports for utilities
- Import types with `import type` when only used for type annotations

**Error Handling:**
- Use `Result<T, E>` pattern for functions that can fail
- Always provide meaningful error messages
- Never swallow errors silently

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

### CSS

- Use CSS custom properties for theming
- BEM naming convention for component styles
- Group related styles together
- Mobile-first approach

---

## Project Structure

```
AuraWrite/
├── src/
│   ├── editor/
│   │   ├── editor.ts           # Main editor setup
│   │   ├── toolbar.ts          # Toolbar handlers
│   │   ├── suggestions-marker-plugin.ts  # Decorations for suggestions
│   │   └── ...
│   ├── ai-panel/
│   │   ├── chat.ts             # AI chat panel logic
│   │   ├── suggestions-panel.ts # Suggestions panel
│   │   ├── ai-manager.ts       # AI provider manager
│   │   └── ...
│   ├── formats/                # Import/export converters
│   ├── styles.css              # Main styles
│   └── main.ts                 # App entry point
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             # Entry point
│   │   └── lib.rs              # Rust commands
│   └── capabilities/           # Tauri permissions
├── index.html
└── package.json
```

---

## Git Conventions

**Regola: una feature alla volta, main sempre stabile.**

1. Aggiorna main:
   ```bash
   git switch main && git pull origin main
   ```

2. Crea branch per il task:
   ```bash
   git switch -c tipo/nome-chiaro
   ```
   Prefissi: `feat/` `fix/` `refactor/` `docs/` `chore/`

3. Sviluppa e committa solo su quel branch.

4. A task completato e testato, unisci a main:
   ```bash
   git switch main
   git merge --no-ff tipo/nome-chiaro
   git push origin main
   git branch -d tipo/nome-chiaro
   ```

5. Per abbandonare un branch senza merge:
   ```bash
   git switch main && git branch -D tipo/nome-chiaro
   ```

6. Se main remoto cambia mentre sei su un feature branch:
   ```bash
   git switch main && git pull origin main
   git switch tipo/nome-chiaro && git rebase main
   ```

7. **Milestone:** Push su GitHub ogni volta che si raggiunge un traguardo significativo.

**Divieti:**
- No commit diretti su main
- No due feature branch aperti insieme
- No nuovo branch finché il precedente non è mergiato e pushato

**Commit Messages:** English, imperative mood
```
feat: add tooltip plugin for text selection
fix: resolve selection coordinate calculation
docs: update ProseMirror plugin documentation
```

---

## General Principles

1. **No Magic** — Avoid hidden side effects; make behavior explicit
2. **Small Functions** — Functions should do one thing well (max ~50 lines)
3. **Document Complex Logic** — Add comments for non-obvious code paths
4. **Test Critical Paths** — Editor state, document persistence, Rust commands
5. **Type Safety First** — Avoid `any`, use proper error handling
6. **Consistent Patterns** — Follow existing code conventions; match surrounding style

---

*Consolidato da AGENTS.md — 2026-04-08*