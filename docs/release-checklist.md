# Release checklist

Use this checklist before tagging or publishing a Kindle Local Sync release.

- `npm run build` passes.
- `npm run lint` passes.
- `npm test` passes.
- Manual QA passes in an Obsidian test vault.
- Sync from a local `My Clippings.txt` file works.
- Existing user content outside sync markers is preserved.
- Repeated sync does not duplicate highlights.
- No network calls, telemetry, Amazon APIs, Readwise APIs, or cloud sync behavior are present.
- `manifest.json` has `isDesktopOnly` set to `true`.
- README is current.
- Package metadata is current.
- Release artifacts are built and checked:
  - `manifest.json`
  - `main.js`
  - `styles.css` if present
