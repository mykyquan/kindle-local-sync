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
- `manifest.json` and `package.json` versions match.
- `versions.json` maps the plugin version to the current minimum Obsidian app version.
- Release artifacts are built and checked:
  - `manifest.json`
  - `main.js`
  - `styles.css` if present
- Release zip is built and checked:
  - `release/kindle-local-sync-v<version>.zip`
  - Plugin files are at the root of the zip.
- Release packaging validates desktop-only metadata, MIT license, matching versions, and `versions.json`.
- No generated release artifacts are committed.

## Maintainer release flow

1. Ensure build, lint, and tests pass:

```bash
npm run build
npm run lint
npm test
```

2. Update `manifest.json` and `package.json` versions if needed.
3. Run `npm run package` and inspect `release/`.
4. Commit the release metadata and documentation changes.
5. Create a tag:

```bash
git tag v0.1.0
```

6. Push the tag:

```bash
git push origin v0.1.0
```

7. GitHub Actions creates the GitHub Release and uploads `main.js`, `manifest.json`, optional `styles.css`, and the release zip.

## User install flow

1. Download the release zip from GitHub Releases.
2. Extract it into:

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

3. Ensure the folder contains `main.js`, `manifest.json`, and `styles.css` if present.
4. Reload Obsidian.
5. Enable **Kindle Local Sync** in **Settings -> Community plugins**.
