# AuraWrite

---

<h1 align="center">
  <img src="assets/aurawrite_logo.png" alt="AuraWrite Logo" width="80" style="vertical-align: middle; border-radius: 16px;">
  &nbsp;AuraWrite
</h1>

<p align="center">
  <strong>An editor that remembers your story.</strong>
</p>

<p align="center">
  <em>Local. Libre. Life-long.</em>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-5_min-4299E1?style=for-the-badge" alt="Quick Start"></a>
  <a href="#-installation"><img src="https://img.shields.io/badge/Installer-Simple-48BB78?style=for-the-badge" alt="Simple Installer"></a>
  <a href="#-privacy"><img src="https://img.shields.io/badge/Privacy-100%25_Local-E53E3E?style=for-the-badge" alt="Privacy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-F6E05E?style=for-the-badge" alt="License"></a>
  <a href="https://www.patreon.com/c/PatataLab"><img src="https://img.shields.io/badge/Patreon-Support-FF424D?style=for-the-badge&logo=patreon&logoColor=white" alt="Patreon"></a>
  <a href="https://buymeacoffee.com/patatalab"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%23FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy Me A Coffee"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/typescript-5.0+-blue?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/rust-1.70+-orange?logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/tauri-v2-lightblue?logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/Privacy-Local%20Only-red?logo=privacy-essentials" alt="Privacy">
  <img src="https://img.shields.io/badge/Offline-First-purple" alt="Offline">
</p>

---

<p align="center">
  <a href="https://youtu.be/knWIYa8g9QI">
    <img src="https://img.youtube.com/vi/knWIYa8g9QI/maxresdefault.jpg" alt="AuraWrite Presentation Video" width="800" style="max-width: 100%; border-radius: 12px;">
  </a>
</p>

<p align="center">
  🎬 <strong>Watch the presentation video on <a href="https://youtu.be/knWIYa8g9QI">YouTube</a></strong>
</p>

---

## What is AuraWrite?

AuraWrite is a free, open-source writing app for desktop. It runs entirely on your machine: your text, your project, your AI — nothing leaves your computer.

By default AuraWrite is fully offline and self-contained: no external service is required, no account, no telemetry. If you prefer to use a cloud or online provider, you can — AuraWrite supports seven of them, including OpenAI, Anthropic, DeepSeek, OpenRouter, and others. The choice is yours: local-first by design, cloud-ready when you want it.

It's built for people who write — novels, screenplays, technical books, business documents, and anything else you want to put on the page.

![AuraWrite screenshot — editor with project panel] <!-- da inserire, vedi TODOAssets -->

### Who it's for

| If you are... | AuraWrite gives you... |
|---|---|
| A novelist or screenwriter | a Project → Section → Document hierarchy, templates for books, characters and locations tracked automatically, an AI that remembers the plot across sessions |
| A professional drafting long documents (legal, technical, business) | style-aware suggestions, a local AI you can interrogate on the whole document, export to DOCX/Markdown |
| Anyone who doesn't trust cloud editors with their manuscript | works fully offline by default — no telemetry, no account, no subscription, no surprise paywall. Cloud providers are available as an option, never a requirement. |

---

## Why AuraWrite?

**AuraWrite channels lightning.**

> *"The electric lamp may indeed be ignored, for the simple reason that it is so insignificant and transitory. And anyway, it is certain that fairy-stories have much more permanent and fundamental things to talk about. The lightning, for instance."*
> — J.R.R. Tolkien

Modern tools — including AI — support the human, they don't replace the human. The light of the lamp is useful, but transient. The lightning of imagination is what lasts.

AuraWrite exists to channel that lightning. A spark of an idea, caught in the right moment, guided by the right tool, can become something that outlasts us.

### What you get

- ⚡ **A serious editor** — ProseMirror underneath, with real A4 pagination, tables, images, links, undo/redo, find & replace
- 🧠 **An AI that remembers** — proactive suggestions in the writing style you choose, plus a conversational assistant that can query your project's database, your characters, your documents
- 🔒 **100% local, your data, your rules** — works offline, no telemetry, no cloud account
- 🎨 **Themes per project** — Calvino-style for one manuscript, Hemingway-style for another, dark mode for late nights
- 🗄️ **Your formats, your choice** — JSON, Markdown, HTML, DOCX. EPUB and Obsidian vault export coming soon.
- ♾️ **Life-long** — MIT licensed, download once, keep it forever, no one to cancel

AuraWrite is free and open source. It will stay that way — MIT guarantees it.

---

## Quick Start

### 1. Download

Go to the [Releases](https://github.com/ACarloGitHub/AuraWrite/releases) page and grab the installer for your platform:

| Platform | Installer |
|---|---|
| **Windows** | `.msi` (WiX) or `.exe` setup (NSIS) |
| **macOS** | `.dmg` (universal — Intel + Apple Silicon) |
| **Linux** | `.deb` (Debian/Ubuntu), `.rpm` (Fedora/RHEL), or `.AppImage` (portable) |

### 2. Install on Windows

AuraWrite is **not code-signed** — a one-person MIT project, the $200–$400/year for a signing certificate isn't in the budget yet. This means Windows SmartScreen will warn you the first time. It is a false positive: the code is auditable on GitHub.

This is what you'll see, and what to do: Windows shows a "Windows protected your PC" screen. Click **More info**, then **Run anyway**. The installer proceeds normally.

(The same is true on macOS — right-click the `.dmg` and choose "Open" from the context menu. On Linux, no warnings.)

### 3. Open AuraWrite

On first launch, a short **setup wizard** walks you through what AuraWrite can do for you. It will help you enable the features that match how you write: a memory layer that remembers the people, places, and themes you mention across your documents, and an AI that suggests rephrasings and edits to the text you've already written.

The editor works on its own from the start — you can write, save, and export right away. The wizard is there to make sure the parts you care about are turned on, without forcing anything on you.

### Build from source

Requires Node.js 18+, Rust stable, and Tauri CLI v2.

```bash
git clone https://github.com/ACarloGitHub/AuraWrite.git
cd AuraWrite
npm install
npm run tauri:dev      # development
npm run tauri:build    # production build
```

---

## What's in the box

AuraWrite organises your work in **projects**. A project has sections, sections have documents, and every project is shaped by a **template** that gives you a head start.

Four templates ship today:

- **Custom** — empty, you build the structure
- **Book** — for novels, screenplays, long-form fiction: 7 top-level sections (Plot, Characters, World, Props & Themes, Chapters, Research, Tracking) and 33+ tutorial documents, ready to fill. 12 writing styles to choose from — Hemingway, Calvino, Le Guin, King, Asimov, Tolkien, Murakami, Pushkin, Dostoevsky, plus a Custom one you write yourself
- **Chef** — for cookbooks, restaurants, menus: recipes work as both **entities** (searchable by region, allergens, diet) and as free documents you write in. Two variants: a flat 12-section version, and a multi-branch one for big collections
- **Legal** — for solo practitioners: organised by client, with 5 entity types (Case, Client, Counterparty, Deadline, Filing) and writing styles tuned for legal and plain-language work

### The two AI panels

AuraWrite has two AI panels that work together.

The **Suggestions panel** (on the left) watches what you write. After you finish a sentence — a `.`, `!`, `?`, or `:` — it offers a rephrased version in the style you chose for that document. Styles range from formal and legal to the voice of a specific author — plus a Custom one you write yourself. Accept a suggestion, switch to another, or reject it. No interruption, no popup, no nag.

The **Assistant panel** (on the right) is a conversation. You can ask it anything about your project:

- "Who are the characters in chapter 3 and what motivates them?"
- "What did I write last week about the lighthouse scene?"
- "Is the timeline consistent between chapter 1 and chapter 5?"
- "Rewrite this paragraph tighter, in Hemingway style."

The Assistant has access to your project — characters, locations, themes, full document content — and can modify the document directly when you ask it to.

### Memory, the way it works in practice

AuraWrite stores your work in a local SQLite database, on your machine. There are three kinds of memory:

- **A precise database** of the things you've named — characters, places, objects, events, recipes, cases. You write them, the database indexes them, the AI can query them.
- **A semantic search** layer. Every document you save is automatically embedded (using a local model called `nomic-embed-text`, run by the built-in llama.cpp engine) and indexed. You can search by meaning, not just by keyword: "where do I talk about loneliness?" returns the right scenes even if the word "loneliness" never appears.
- **The writing style cascade** — you can set a style at the project level, override it at the section level, override again at the document level. The most specific setting wins.

This is what makes the AI feel less like a stranger typing in your document and more like a co-writer who actually read the previous chapters.

---

## 🤖 AI Configuration

AuraWrite works with the AI provider of your choice. You can mix and match, switch at any time, and your settings stay on your machine.

**Built-in local engine — llama.cpp**

AuraWrite ships with its own local inference engine based on llama.cpp, an open-source project (not developed by us, used under its own license). It runs inside AuraWrite: no installation of Ollama, LM Studio, or any other external tool is required. The engine supports an unlimited number of GGUF models, and AuraWrite includes a curated selection tuned for different hardware profiles — from a few gigabytes of RAM up to multi-GPU workstations. The first time you enable it, the wizard helps you pick a model that fits your machine.

**External providers (optional)**

If you prefer a cloud or hosted provider, AuraWrite works with:

- **Ollama (Local)** — `http://localhost:11434`, no API key, free, supports free `-cloud` models after `ollama signin`
- **Ollama (Cloud)** — `https://ollama.com`, API key
- **OpenAI** — `gpt-4o`, `gpt-4o-mini`, etc.
- **Anthropic** — `claude-sonnet-4-20250514`
- **DeepSeek** — `deepseek-chat`, `deepseek-reasoner`
- **OpenRouter** — 300+ models
- **LM Studio** — your local GGUF models, auto-detected
- **MiniMax** — MiniMax M-series, 1M context window

### Model Auto-Discovery

Every provider supports auto-discovery of available models. You don't need to memorise model names or copy them from documentation — the editor asks the provider what it has and shows you the list.

| Provider | Endpoint | Auth |
|---|---|---|
| **Built-in (llama.cpp)** | local file system (`resources/models/`) | None |
| Ollama (Local) | `GET /api/tags` | None |
| Ollama (Cloud) | `GET /api/tags` | Bearer |
| LM Studio | `GET /models` | None |
| OpenAI | `GET /models` | Bearer |
| Anthropic | `GET /models` | `x-api-key` header (with `anthropic-version: 2023-06-01`) |
| DeepSeek | `GET /models` | Bearer |
| OpenRouter | `GET /models` | Bearer (with `HTTP-Referer: https://aurawrite.app`) |
| MiniMax | `GET /models` | Bearer |

The model dropdown auto-refreshes when you change provider, base URL, or API key. Results are cached for 1 hour. You can always type a custom model name in the free-text input if the one you want isn't listed.

For the **built-in local engine**, model discovery works differently: AuraWrite reads the GGUF files in its models folder (configurable — see Preferences → Local Models), combines them with the curated catalog, and shows the union. To add a new model, drop a `.gguf` file into the folder, click Refresh, and it appears in the dropdown.

---

## 💾 Data Storage

Your work lives in your user data folder, in a local SQLite database:

```
Linux:   ~/.config/aurawrite/
Windows: %APPDATA%\aurawrite\
macOS:   ~/Library/Application Support/aurawrite/
```

Export anytime to JSON, Markdown, HTML, or DOCX. EPUB and Obsidian vault export are coming soon.

---

## 🛡️ Security & Trust

AuraWrite is **not code-signed**. This is normal for a one-person MIT project — code signing costs $200–$400/year, and the budget isn't there yet.

What this means in practice:
- **Windows:** SmartScreen warns "Windows protected your PC" → click "More info" → "Run anyway"
- **macOS:** Gatekeeper blocks the `.dmg` → right-click → "Open" from the context menu
- **Linux:** `.deb` / `.rpm` / `.AppImage` install without warnings

If you prefer not to trust the binary, you can **build from source** in 5 minutes — the entire codebase is auditable on GitHub under the MIT License.

Code signing is on the roadmap once the project is more mature.

---

## 🤝 Contributing

Issues, pull requests, and feedback are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

When opening an issue, please include:
- OS and version
- Steps to reproduce
- Error messages (if any)

---

## 📄 License

[MIT](LICENSE) — Copyright © 2026 Carlo / PatataLab.

Local. Libre. Life-long.

---

### Notes

- **Supported platforms:** Windows, macOS, Linux. Mobile / web / e-ink reader are not in the roadmap.
- **AI memory:** the conversational assistant has long-term memory of your project's entities and documents. It cannot modify your database — only read from it.
