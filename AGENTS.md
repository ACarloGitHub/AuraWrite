# AuraWrite — Documentation Guidelines

## Where to READ Project Information

**Always read these files at the start of every session, in this order:**

1. `AuraWrite-Wiki/concepts/roadmap.md` — Index of all pending tasks (START HERE)
2. `AuraWrite-Wiki/concepts/todo-list.md` — Detailed task status, priorities, technical notes
3. `documentation/STATO.md` — Current project state overview
4. `documentation/RESUME_MEMO_v0.X.Y.md` — Latest release memo (read the most recent)
5. **`documentation/RELEASE_PROCESS.md`** — **Step-by-step release procedure (read BEFORE any release)**
6. `AuraWrite-Wiki/log.md` — Activity log of all sessions

**For wiki schema and rules:** `AuraWrite-Wiki/CLAUDE.md`

---

## Where to WRITE Project Information

| What | Where | Notes |
|------|-------|-------|
| Task tracking (detailed) | `AuraWrite-Wiki/concepts/todo-list.md` | Update status, add new tasks |
| Task index (synthetic) | `AuraWrite-Wiki/concepts/roadmap.md` | Keep in sync with todo-list |
| Session activity log | `AuraWrite-Wiki/log.md` | Append-only entry per session |
| Release memo | `documentation/RESUME_MEMO_v0.X.Y.md` | One file per release |
| Release plan (optional) | `documentation/RESUME_MEMO_v0.X.Y_PLAN.md` | Planning notes for a release |
| **Release procedure** | **`documentation/RELEASE_PROCESS.md`** | **Step-by-step release procedure (TL;DR + lessons learned). Read this BEFORE any release.** |
| TODO audit snapshot | `documentation/TODO_AUDIT_YYYY-MM-DD.md` | Periodic audit results |
| Project status overview | `documentation/STATO.md` | Update when state changes |
| Improvement plans | `documentation/piano-miglioramento-*.md` | Strategic planning |
| Bug investigations | `documentation/BUGS_*.md` | Bug tracking and analysis |
| Code analysis reports | `documentation/report-analisi-codice.md` | Code quality findings |
| Wiki concept pages | `AuraWrite-Wiki/concepts/<topic>.md` | Architecture, patterns, features |
| Wiki entity pages | `AuraWrite-Wiki/entities/<name>.md` | Module/component documentation |
| Wiki summaries | `AuraWrite-Wiki/summaries/<name>.md` | Source document summaries |
| Wiki syntheses | `AuraWrite-Wiki/syntheses/<name>.md` | Cross-cutting analyses |
| Wiki procedures | `AuraWrite-Wiki/procedures/<name>.md` | Step-by-step procedures |
| Templates spec | `documentation/templates/<name>.md` | Template specifications |
| Test screenshots | `documentation/screenshots/` | Test artifacts |

---

## Session Closing Checklist (MANDATORY)

Before ending any session, the agent MUST:

1. **Update `AuraWrite-Wiki/concepts/roadmap.md`** — Add/close tasks
2. **Update `AuraWrite-Wiki/concepts/todo-list.md`** — Technical details of changes
3. **Add entry in `AuraWrite-Wiki/log.md`** — Format: `## YYYY-MM-DD — Title`
4. **If release shipped:** Create/update `documentation/RESUME_MEMO_v0.X.Y.md`
5. **If design decisions made:** Update relevant `AuraWrite-Wiki/concepts/<name>.md`
6. **Verify** `documentation/STATO.md` is still accurate

---

## IMPORTANT RULES

- **NEVER write files or create folders** in `W:\SviluppoProgetti\AuraWrite\` (root) without explicit authorization from Carlo
- **NEVER push** `documentation/`, `AuraWrite-Wiki/`, or `AGENTS.md` to GitHub — they are local only
- **Prefer updating** existing files over creating duplicates
- **Always update** `roadmap.md` and `todo-list.md` after changes — this is the #1 anti-pattern to avoid (losing tasks between sessions)
- **Communicate** with Carlo in Italian; use English for code, commits, wiki page text, and log entries

---

## Key Paths Reference

| Resource | Path |
|----------|------|
| Source code | `src/` |
| Rust backend | `src-tauri/src/` |
| Wiki (knowledge base) | `AuraWrite-Wiki/` |
| Documentation (local) | `documentation/` |
| Tests (local) | `Tests/` |
| Discontinued (archive) | `Discontinued/` |
| Public assets | `public/` |
| Build config | `package.json`, `vite.config.ts`, `tsconfig.json` |
| Rust config | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` |
| CI/CD | `.github/workflows/` |
| Wiki schema | `AuraWrite-Wiki/CLAUDE.md` |
