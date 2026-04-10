# File Operations Implementation

## State Tracking

```typescript
interface DocumentState {
  path: string | null; // Current file path
  format: string | null; // Current format (json, md, txt, docx)
  isDirty: boolean; // Has unsaved changes
  lastSavedContent: string | null; // Content at last save
}
```

## Flow

### Save Button

1. If no path OR isDirty=false → do nothing (already saved)
2. If path exists → save to existing path with existing format
3. If no path → call Save As

### Save As Button

- Opens native save dialog with format filter
- User chooses path and extension
- Detects format from extension
- Saves and updates documentState

### Open Button

- Opens native open dialog with format filter (including "\*" for all)
- User selects any file
- Detects format from extension
- Loads and converts to ProseMirror
- Updates documentState

### Export Button

- Opens native save dialog with format filter (no JSON)
- User chooses path and extension
- Detects format from extension
- Saves copy WITHOUT updating documentState

## Formats

| Format           | Extension | Save | Open | Export |
| ---------------- | --------- | ---- | ---- | ------ |
| ProseMirror JSON | .json     | ✅   | ✅   | -      |
| Markdown         | .md       | ✅   | ✅   | ✅     |
| Plain Text       | .txt      | ✅   | ✅   | ✅     |
| HTML             | .html     | -    | -    | ✅     |
| DOCX             | .docx     | ✅   | ✅   | ✅     |

## Rust Commands

```rust
save_document(path, content)      // Text files
save_binary_file(path, base64)   // Binary files (DOCX)
load_document(path)              // Text files
load_binary_file(path)           // Binary files, returns base64
```

## Dirty Tracking

- Hook into ProseMirror `dispatchTransaction`
- Compare `JSON.stringify(newState.doc.toJSON())` with `lastSavedContent`
- Set `isDirty = true` if different

## Window Title

```
Untitled - AuraWrite          (new document)
mydoc.md - AuraWrite          (saved, no changes)
mydoc.md * - AuraWrite        (saved, has changes)
```

## Title Bar (Document Info)

Above toolbar, shows:

- Document name (filename or "Untitled")
- Dirty indicator (\*) when unsaved changes
- Format name (JSON, Markdown, Plain Text, HTML, Word Document)

## Incremental Save (Placeholder)

```typescript
function saveIncremental() {
  // TODO: Integrate with SQLite
  // - Save content to incremental_saves table
  // - When max reached, delete oldest or stop (configurable)
  console.log("Incremental save triggered (placeholder for DB integration)");
}
```

## Open Document Indexing (TODO)

When opening a document created elsewhere (exported DOCX, etc.):

- Decision needed: should it be indexed in database?
- Options:
  1. Yes, always create database entry
  2. No, only track files opened via Open (not Export)
  3. Ask user

## Key Files

- `src/editor/toolbar.ts` - All file operations
- `src-tauri/src/lib.rs` - Rust commands
- `src/formats/*.ts` - Format converters

## Changelog

- 2026-03-29: Removed dropdown menus, direct native dialog integration for Save As, Open, Export
- 2026-03-29: Added title bar showing document name, dirty indicator, and format
