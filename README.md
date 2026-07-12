# Kindle Local Sync

Local-only Kindle highlights and notes import for Obsidian.

Kindle Local Sync is a desktop-only Obsidian plugin that reads a USB-connected Kindle's local `My Clippings.txt` file and writes Kindle highlights and notes into Markdown files inside your Obsidian vault.

## Demo

![Kindle Local Sync demo](docs/assets/demo.gif)

Demo: set the local `My Clippings.txt` path, sync Kindle highlights, and review the generated Markdown note output.

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

## Languages

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## Installation from Obsidian Community Plugins

From the community directory (once approved):

Settings → Community plugins → Browse → search "Kindle Local Sync" → Install → Enable.

## Quick Start

1. Connect your Kindle by USB.
2. Open Obsidian.
3. Install and enable **Kindle Local Sync**.
4. Set **My clippings.txt path** if the plugin does not detect your Kindle automatically.
5. Select the book icon in the ribbon, or run **Sync local kindle highlights** from the command palette.
6. Open the configured highlights folder to inspect generated notes.

## How It Works

1. The plugin detects `My Clippings.txt` from a connected Kindle or a manually configured path.
2. It reads the local clipping file as UTF-8 text.
3. It parses Kindle highlights and notes, skipping bookmark entries.
4. It groups clippings by book.
5. It creates the configured highlights folder if needed.
6. It writes or updates one Markdown note per book.

The plugin only manages content between these markers:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

Content outside those markers is preserved.

New or unreviewed highlights are added to Obsidian notes only after you approve them. Highlights you already approved may be refreshed during sync to keep your notes up to date.

Keep personal notes outside the Kindle Local Sync section, because that section is managed by the plugin and may be replaced during sync.

## Privacy

Kindle Local Sync is local-only by design.

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- No vault content leaves your machine through this plugin.

The plugin reads `My Clippings.txt` from your local filesystem and writes Markdown files inside your Obsidian vault.

## Troubleshooting

- **Plugin is not listed yet**: Install from Obsidian Community Plugins after approval. Until then, use BRAT or the GitHub Release ZIP if you are testing a beta release.
- **My Clippings.txt is not found**: Connect your Kindle by USB, then set the absolute **My clippings.txt path** manually in plugin settings.
- **No highlights are imported**: Confirm your Kindle has a local `My Clippings.txt` file and that it contains highlight or note entries, not only bookmarks.
- **Second sync looks unchanged**: This is expected when the same clippings were already imported. The plugin avoids duplicate highlights and files.
- **User notes were added to generated files**: Keep personal content outside the `kindle-local-sync` markers so it is preserved on future syncs.

## Roadmap

- Broader parser fixtures from real Kindle clipping variants.
- More manual QA across macOS, Windows, and Linux.
- Release packaging checklist for community plugin submission.
- Optional note format refinements based on user feedback.
