# Kindle Local Sync

Import Kindle highlights and notes into Obsidian without sending your reading data anywhere.

Kindle Local Sync is a desktop-only Obsidian plugin. It reads the local `My Clippings.txt` file from a Kindle connected by USB, then writes the highlights you approve to Markdown notes in your vault.

## Demo

![Kindle Local Sync demo](docs/assets/demo.gif)

## Features

- Local, USB-first import with no Amazon or Readwise account.
- Automatic Kindle path detection on macOS, Windows, and Linux, with a manual path option.
- One Markdown note per book.
- A review step for first-time and newly found highlights.
- Temporary Skip choices and persistent Ignore choices.
- Reconnection to existing Kindle Local Sync notes when saved sync data is missing.
- Recovery review for previously imported highlights that are missing from their expected Obsidian notes.
- Protection for personal writing outside the plugin-managed section.
- Duplicate clipping protection and safe filename handling.

## Languages

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## Installation from Obsidian Community Plugins

After the plugin is approved for the community directory:

Settings → Community plugins → Browse → search for **Kindle Local Sync** → Install → Enable.

Until then, use BRAT or a GitHub Release ZIP only if you are testing a beta release.

## Quick start

1. Connect your Kindle by USB.
2. Open Obsidian and enable **Kindle Local Sync**.
3. If your Kindle is not detected, set **My clippings.txt path** in the plugin settings.
4. Select the book icon in the ribbon, or run **Sync local kindle highlights** from the command palette.
5. Review any highlights that need a choice.
6. Select **Finish Sync**, then open the configured highlights folder to see the results.

## How Kindle Local Sync works

1. The plugin reads `My Clippings.txt` from your Kindle or the local path you configured.
2. It parses highlights and notes, skips bookmarks and malformed entries, and groups the remaining clippings by book.
3. When review is required, you choose what to Import, Skip for this sync, or Ignore.
4. Nothing from that review is applied until you select **Finish Sync**.
5. Approved highlights are written to the matching Obsidian book note. A new note is created only when an approved import needs one.
6. On later syncs, the plugin compares the current Kindle file, its saved choices, and the plugin-managed sections in your existing notes.
7. Personal writing outside the plugin-managed section is preserved.

`My Clippings.txt` is an import source, not a reliable deletion record. The plugin does not automatically delete an Obsidian highlight merely because it is absent from the current Kindle file.

## For new users

If there is no trusted saved sync history and no existing Kindle Local Sync note, the first sync opens **First Sync Preview**. Every detected highlight starts without a choice so you can decide what belongs in Obsidian.

- **Import** adds the highlight when you finish the sync.
- **Skip This Sync** leaves it unchanged and may show it again next time.
- **Ignore** keeps it out of future syncs until you remove it from the Ignore list.

Book notes are not created merely by opening the review or selecting a temporary choice. The plugin writes and saves your choices only after **Finish Sync**. Unreviewed highlights are treated like a one-time skip and may return on the next sync.

## For returning users

### With saved sync history

When `data.json` contains trusted import or Ignore history, already imported highlights whose markers are still present are refreshed automatically. Ignored highlights stay out of the sync. Normally, only new highlights and previously imported highlights missing from their expected notes need attention.

The plugin does not use `My Clippings.txt` as permission to remove older highlights from Obsidian. If it cannot safely refresh a book without dropping existing managed content, that book is left unchanged and the summary explains that it needs attention.

### With existing notes but no trusted `data.json`

If the configured highlights folder contains a valid Kindle Local Sync managed section but trusted sync history is missing, the plugin shows **Existing Kindle notes found**.

Select **Continue with existing notes** to reconnect:

- Exact highlight markers found in their expected book notes are recorded as existing imports.
- Highlights that cannot be matched are shown in **Review New Highlights**.
- Existing notes stay in place, and personal writing outside the managed section is preserved.
- Old Ignore choices cannot be reconstructed from Markdown alone, so they are not guessed.

This means you should normally review only unmatched highlights, not approve every old highlight again.

### After updating from an older version

Older versions may have saved your plugin settings without saving highlight history. After updating, you may see **Existing Kindle notes found**. Select **Continue with existing notes** to reconnect: the plugin keeps your existing notes, recognizes highlights with matching markers, and asks you to review only highlights it cannot match.

If no valid existing Kindle Local Sync notes are found, the plugin uses **First Sync Preview** instead.

## What each choice means

| Choice | What happens | Example |
| --- | --- | --- |
| **Import** | Temporarily selects one highlight for writing when you select **Finish Sync**. | Import a quotation you want to reference in a project note. |
| **Skip This Sync** | Skips one highlight, or every highlight in a book when used on the book card, for this sync only. It may return next time. | Leave a long passage undecided until your next review. |
| **Ignore** | Saves a lasting Ignore choice after **Finish Sync**. The highlight stays out of future syncs until removed from the Ignore list. | Hide a clipping that is not useful. |
| **Import All** | Changes every temporary choice in that book to Import. | Import every reviewed clipping from one book. |
| **Ignore All** | Changes every temporary choice in that book to Ignore. | Keep an entire book's current highlights out of future syncs. |
| **Import All Books** | Changes every current review choice, including hidden books, to Import. If you already selected Skip or Ignore, the plugin asks for confirmation first. Previously saved Ignore choices are not changed. | Approve the whole current first-sync review at once. |
| **Finish Sync** | Applies the current choices, saves confirmed state, and opens **Sync complete** or **Sync finished**. Unreviewed highlights are skipped this time. | Finish after reviewing only the books you care about today. |
| **Cancel** | Closes immediately if no choice changed. If unsaved choices exist, asks whether to keep reviewing or discard them. Search, filters, scrolling, and navigation alone do not trigger this warning. | Leave without saving accidental selections. |

Later bulk choices take precedence over earlier temporary choices. For example, if you Ignore one highlight and then select **Import All** for that book, every current highlight in that book changes to Import. **Import All Books** does the same across the entire review after confirmation. No review choice is persisted before **Finish Sync**.

### Finding and reviewing choices

- **Search books...** matches book titles and authors without changing your selections. It does not search highlight text.
- **All Books**, **Needs Review**, and **Reviewed** filter the book list while keeping the complete review state.
- **How choices work** and the `?` button show the same short in-app guide.
- **Review Highlights** opens individual highlight choices for one book.

## Sync Summary and follow-up actions

After a completed sync, the summary reports what was imported, ignored, skipped, left unreviewed, detected as duplicate, or found missing. Depending on the result, it may offer:

- **Review Skipped This Sync**: inspect temporary skips. You can keep them skipped for now or choose **Ignore Going Forward**. At book level, **Ignore All Highlights** requires confirmation.
- **Manage Ignored Highlights**: review ignored items by book and use **Remove From Ignore List** or **Remove All From Ignore List**. Removing an Ignore choice does not immediately rewrite a note; the highlight returns to normal new-or-missing handling on a later sync if it is still in `My Clippings.txt`.
- **Review Missing Highlights**: decide what to do with previously imported highlights that are no longer found in their expected notes.
- **View Books Left Unchanged**: see books the plugin protected because it could not update them safely.
- **Review Note Update Issues**: inspect Ignore cleanup results that failed or could not be confirmed.

## Missing Highlights

A highlight is considered missing only when all of these are true:

1. The current `My Clippings.txt` still contains it.
2. `data.json` has a matching imported-highlight record that can be trusted for this sync.
3. Its exact marker is not found inside a valid managed section at the expected book-note path.

The check runs during a returning-user sync after the Kindle file is parsed. If the expected note cannot be read safely, the plugin does not automatically call the highlight missing.

For each missing highlight, you can choose:

- **Import Again**: try to restore it. The item disappears from the missing list only after the writer confirms a safe result; otherwise it stays available to retry.
- **Ignore Going Forward**: save an Ignore choice and keep it out of future syncs. The old imported record remains; Ignore takes precedence. If you later remove the Ignore choice while the marker is still absent, the highlight can return as missing.
- **Skip This Time**: remove it from the current summary only. Nothing is saved, so it can return next sync.

The book-level equivalents are **Import All Again**, **Ignore All Going Forward**, and **Skip All This Time**.

Limitations: missing detection depends on saved imported metadata, the current clipping still being in the file, the expected note path, and a readable managed section. A manually moved note can therefore look missing, while a highlight cannot be checked at all after it disappears from both the current Kindle file and trusted saved identity data.

## If a highlight is deleted

### Deleted from an Obsidian note

If you manually remove a plugin-managed highlight but leave its markers and the rest of the note valid, it appears under **Missing Highlights** on the next sync when the required saved import record and Kindle-file entry still exist. Deleting the whole managed section can make every tracked highlight from that note appear missing.

You can then import it again, ignore it going forward, or skip it this time. Personal text outside the managed markers remains separate from this check.

### Deleted from Kindle

Kindle Local Sync has no Kindle deletion API. It can only read `My Clippings.txt`, and Kindle devices may leave deleted highlights in that file.

- If the deleted highlight is no longer in `My Clippings.txt`, the plugin does not treat its absence as permission to delete the Obsidian copy.
- If it is still in `My Clippings.txt`, the plugin still sees it as a normal clipping. Depending on saved state and the note, it may be refreshed, reviewed, ignored, or shown as missing.

The plugin therefore cannot promise to detect every deletion made on the Kindle device.

## Protecting personal notes

Kindle Local Sync manages only the section between these markers:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

The managed section may be refreshed during sync. Keep your own writing before or after the markers. Content outside the markers is preserved.

If marker structure is broken or an update would remove an existing managed highlight without explicit authority, the plugin leaves that book note unchanged instead of guessing.

## Duplicate handling

Repeated copies of the exact same clipping are written once. New records use a full SHA-256 `kls2-...` identity, so distinct clippings remain independent even when their older 32-bit `kls-...` IDs collide.

Older notes and saved choices are migrated lazily only after one old ID and its physical block or state match exactly one current clipping. If an old ID is ambiguous within a book, that book and its saved decisions are left unchanged and the summary explains the conflict; unrelated books can continue.

If only one member of an older collision is currently present, the plugin cannot know which highlight an earlier Import or Ignore choice described. It preserves the older evidence; if the second highlight later appears and makes the conflict observable, the book is left unchanged for review.

Downgrade warning: versions through `0.1.2` are not collision-safe and do not understand the new authoritative identity. Do not use an older version to rewrite or clean up notes/state written by this version.

## Privacy

All highlight processing is local. The runtime source contains no network request, cloud sync, analytics, telemetry, Amazon API, or Readwise API path. The plugin does not send highlight text or vault content over the network.

It reads `My Clippings.txt` from the local filesystem and writes Markdown plus plugin state inside your Obsidian vault. The **Strict local only** setting is stored, but the current runtime remains local even if that toggle is changed because no network feature exists.

## Troubleshooting

- **My Clippings.txt is not found**: connect the Kindle by USB, then set the absolute **My clippings.txt path** manually.
- **No highlights are found**: confirm the file contains Highlight or Note entries, not only bookmarks.
- **A later sync has no changes**: this is expected when the same imported markers are already present.
- **A book was left unchanged**: the plugin could not prove that replacing its managed section was safe. Check its markers and keep a backup before editing the managed section.
- **Existing Kindle notes found appears after an upgrade**: this is the expected reconnect step described in [After updating from an older version](#after-updating-from-an-older-version). Your existing notes are kept.
- **Personal writing is inside a generated note**: move it outside the `kindle-local-sync` markers so future managed-section refreshes do not replace it.

## Technical documentation

For architecture, sync-state rules, persistence, safety invariants, known limitations, and the source/test map, see [Technical architecture](docs/ARCHITECTURE.md).

## Roadmap

- Complete clean-vault manual QA for new, returning, reconnect, missing, Ignore, Skip, cancel, and managed-region flows.
- Replace the current demo with a verified privacy-safe recording.
- Verify reproducible, installable release artifacts before publication.
