# Kindle Local Sync

Local-only Kindle highlights and notes import for Obsidian.

Languages:
- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

Kindle Local Sync is a desktop-only Obsidian plugin that reads a USB-connected Kindle's local `My Clippings.txt` file and writes Kindle highlights and notes into Markdown files inside your Obsidian vault.

## What it does

- Detects `My Clippings.txt` from a connected Kindle or a manually configured path.
- Reads the local clipping file as UTF-8 text.
- Parses Kindle highlights and notes.
- Skips Kindle bookmark entries.
- Groups clippings by book.
- Writes one Markdown note per book into a configurable vault folder.
- Preserves user-written content outside the plugin-managed sync region.
- Avoids duplicate output when the same clipping appears more than once.

## Why local-only matters

Kindle Local Sync is designed for readers who want their reading notes in Obsidian without routing them through a cloud service.

It does not require:

- Amazon login
- Readwise
- Cloud sync
- Telemetry
- External services
- Network requests

The plugin reads from a local Kindle file and writes to your local Obsidian vault.

## Best fit users

This plugin is especially useful if you:

- Read sideloaded Kindle books.
- Keep your notes in Obsidian.
- Prefer local-first tools.
- Want to avoid third-party highlight services.
- Are comfortable connecting a Kindle over USB.

## Features

- Desktop-only Obsidian plugin.
- USB-first Kindle clipping import.
- Manual `My Clippings.txt` path support.
- macOS, Windows, and Linux path detection.
- Markdown output inside the Obsidian vault.
- One note per book.
- Generated sync region with stable clipping IDs.
- Safe filename and folder path sanitization.
- Parser and vault writer test coverage.

## How it works

1. Connect your Kindle over USB.
2. Run **Sync local kindle highlights** from the ribbon icon or command palette.
3. The plugin looks for `My Clippings.txt`.
4. It reads and parses local Kindle highlights and notes.
5. It creates the configured highlights folder if needed.
6. It writes or updates Markdown notes in your vault.

The plugin only manages content between these markers:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

Content outside those markers is preserved.

## Installation / manual install

This plugin is currently best installed via BRAT for beta testing until an official Obsidian Community Plugin submission is ready.

### A. Recommended beta install: BRAT

1. Install BRAT from Obsidian Community Plugins.
2. Open the Command Palette.
3. Run `BRAT: Add a beta plugin for testing`.
4. Paste `https://github.com/mykyquan/kindle-local-sync`.
5. Enable **Kindle Local Sync** in **Settings -> Community plugins**.

### B. Manual install from GitHub Release

1. Download the latest release zip from GitHub Releases.
2. Extract it into:

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

3. Ensure the folder contains:
   - `main.js`
   - `manifest.json`
   - `styles.css` if present
4. Reload Obsidian.
5. Enable **Kindle Local Sync** in **Settings -> Community plugins**.

### C. Build from source for developers

1. Clone this repository.
2. Run `npm ci`.
3. Run `npm run build`.
4. Copy `main.js` and `manifest.json` into:

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

5. Copy `styles.css` too if present.
6. Reload Obsidian and enable the plugin.

## Usage

1. Connect your Kindle by USB.
2. Open Obsidian.
3. Select the book icon in the ribbon, or run **Sync local kindle highlights** from the command palette.
4. Review the sync summary Notice.
5. Open the configured highlights folder to inspect generated notes.

## Settings

- **My clippings.txt path**: Optional absolute path to `My Clippings.txt`. If blank, the plugin checks common Kindle USB mount locations.
- **Highlights folder**: Vault folder where generated book notes are written. Default: `Kindle Highlights`.
- **Strict local only**: Keeps the plugin positioned around local-only behavior. The current plugin does not perform network sync.

## Example output

```markdown
---
title: "Atomic Habits"
author: "James Clear"
source: "kindle"
sync: "kindle-local-sync"
---

# Atomic Habits

Author: James Clear

## Kindle Highlights & Notes

<!-- kindle-local-sync:start -->

### Highlight - Location 154

> Small habits make a big difference.

Added: Thursday, May 14, 2026 2:44 PM

<!-- kindle-local-sync-id: kls-example -->

<!-- kindle-local-sync:end -->
```

## Screenshots

![Kindle Local Sync demo](docs/assets/demo.gif)

Demo: install and enable the plugin, set `My Clippings.txt`, sync Kindle highlights, and review the generated Markdown note output.

## Privacy statement

Kindle Local Sync is local-only by design.

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- No vault content leaves your machine through this plugin.

The plugin reads `My Clippings.txt` from your local filesystem and writes Markdown files inside your Obsidian vault.

## Current limitations

- Deleting a highlight from Kindle may not automatically remove it from Obsidian. Kindle's `My Clippings.txt` can behave like an append-style log, so this plugin is designed as a safe local import/sync tool and does not automatically delete existing Obsidian content.
- Locale-specific Kindle clipping formats may need more parser coverage over time.
- This plugin is desktop-only because it depends on local filesystem access.
- Generated notes are Markdown-first and intentionally simple.

## Development commands

```bash
npm install
npm run build
npm run lint
npm test
```

To create release assets locally:

```bash
npm run package
```

This builds the plugin and writes `main.js`, `manifest.json`, optional `styles.css`, and `kindle-local-sync-v<version>.zip` to `release/`.

For development watch mode:

```bash
npm run dev
```

## Roadmap

- Broader parser fixtures from real Kindle clipping variants.
- More manual QA across macOS, Windows, and Linux.
- Release packaging checklist for community plugin submission.
- Optional note format refinements based on user feedback.

## Feedback and bug reports

Use GitHub Issues for bugs and feature requests. Use the bug report template for sync, install, or parsing issues, and use the feature request template for new ideas.

Remove private highlights, personal notes, and sensitive reading data before sharing logs or `My Clippings.txt` examples. GitHub Discussions may be used for general questions if enabled.

## Contributing

Contributions are welcome if they preserve the plugin's local-only privacy model.

Please avoid adding:

- Cloud sync
- Telemetry
- Amazon login
- External highlight services
- Network-based APIs

Before opening a pull request, run:

```bash
npm run build
npm run lint
npm test
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
