# Kindle Local Sync — Codex Working Instructions

## Project purpose

Kindle Local Sync is a privacy-first Obsidian plugin that reads Kindle highlights from a local `My Clippings.txt` file and imports approved highlights into Markdown notes.

The plugin must remain local-first. Do not add cloud sync, analytics, tracking, telemetry, or external data transmission unless explicitly requested.

## User safety principles

Data safety is more important than implementation convenience.

- Never silently delete, overwrite, or discard user-authored content.
- Content outside the managed markers must always be preserved.
- The managed region is bounded by:
  - `<!-- kindle-local-sync:start -->`
  - `<!-- kindle-local-sync:end -->`
- Clearly distinguish existing users from new users.
- Existing users may already have Kindle highlight Markdown notes even when plugin data is missing.
- Existing notes and highlights must remain unless the user explicitly ignores or removes them.
- Existing users should normally review only new, missing, or unmatched highlights.
- New users must approve highlights before they are imported for the first time.
- Treat changes to sync, migration, note detection, managed-region replacement, ignored highlights, and ID generation as high-risk changes.

## Working boundaries

Unless the current prompt explicitly authorizes it:

- Do not commit.
- Do not push.
- Do not merge branches.
- Do not create pull requests.
- Do not publish or release the plugin.
- Do not change unrelated files.
- Do not perform broad refactors.
- Do not rename public APIs or user-facing concepts.
- Do not change existing behavior merely to make the code cleaner.
- Do not rebuild, stage, force-add, or commit `main.js` or other ignored/generated artifacts unless the user explicitly authorizes that exact action.
- When production-build verification is required but the real repository bundle must remain unchanged, use a clean disposable clone or worktree and verify there.
- A successful build does not authorize copying generated output back into the repository.
- `PROGRESS.md` and all QA vaults or QA evidence are local-only and must not be staged or committed unless the user explicitly changes that policy.
- Preserve existing user changes in the working tree.

If the requested task conflicts with current behavior, data-safety rules, or documented project decisions, stop and explain the conflict before implementing it.

## Investigation before implementation

Before changing code:

1. Inspect the relevant implementation and tests.
2. Trace the complete call path when sync behavior or stored data is involved.
3. Identify affected files and behavior.
4. Check whether the requested change could delete or rewrite existing Markdown content.
5. State any important assumption before relying on it.

Do not claim a bug is fixed until the relevant path has been tested.

## Code quality

- Follow the existing TypeScript style and project architecture.
- Prefer small, focused changes.
- Avoid duplicated logic.
- Use descriptive names.
- Keep functions focused on one responsibility.
- Do not introduce abstractions unless they reduce real complexity.
- Handle edge cases explicitly.
- Preserve backward compatibility unless a breaking change is explicitly approved.
- Do not use `any` merely to bypass TypeScript errors.
- Do not suppress lint rules without explaining why.

## Code comments

Add comments where they help a future developer understand intent, risk, or non-obvious behavior.

Comment requirements:

- Write code comments in clear English.
- Add comments for non-obvious sync rules, data-safety boundaries, migration behavior, managed-region behavior, and unusual edge cases.
- Explain why a decision exists, not merely what the next line does.
- Add concise JSDoc to important public methods or complex functions when their contract is not obvious.
- Update or remove comments when the related behavior changes.
- Do not comment every line.
- Do not add comments that simply repeat the code.
- Do not leave misleading, speculative, or outdated comments.
- Use TODO comments only when they include a specific reason or follow-up action.

Example of a useful comment:

// Preserve user-authored text outside the managed region when replacing synced highlights.

Example of an unnecessary comment:

// Increment the index by one.
index++;

## Testing requirements

For behavior changes:

- Add or update focused tests.
- Include regression tests for confirmed bugs.
- Test both the successful path and relevant edge cases.
- For data-writing changes, test preservation of content outside managed markers.
- For existing-user flows, test notes with and without plugin data.
- For review decisions, test Import, Skip this sync, and Ignore separately when applicable.
- Avoid weakening assertions only to make a failing test pass.

Run the repository’s relevant verification commands, normally including:

- Focused tests: `npx vitest run src/SyncSummaryModal.test.ts` (substitute the relevant tracked test file when another focused suite applies).
- Full tests: `npm test`.
- TypeScript checking: `npx tsc --noEmit --skipLibCheck`.
- Lint: `npm run lint`.
- Production build: `npm run build`.
- Git diff checking: `git diff --check`.

If a command cannot be run or fails for an unrelated reason, report that clearly. Do not describe verification as passed unless it actually passed.

## User-facing copy

- Use concise, beginner-friendly language.
- Avoid unnecessarily technical or alarming wording.
- Clearly explain what will be kept, added, skipped, ignored, or removed.
- Do not imply that existing users must approve all previous highlights again.
- Keep terminology consistent across the UI, README, and localized documentation.
- When English user-facing text changes, check whether Vietnamese, Simplified Chinese, and Traditional Chinese versions also need updates.

## Scope control

Before editing, list the files expected to change.

After editing, report:

- files changed
- behavior changed
- behavior intentionally unchanged
- comments added or updated
- tests added or updated
- exact verification results
- remaining risks or manual checks

Do not include unrelated cleanup in the same task.

## Communication style

Explain findings in a beginner-friendly but technically accurate way.

When identifying a problem, separate:

- confirmed behavior
- likely behavior
- assumptions
- recommendations

When discussing a risky change, explain the concrete user scenario in which data could be affected.
