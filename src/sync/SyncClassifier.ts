import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import { IgnoredHighlight, ImportedHighlightRecord } from "../settings";
import {
	createBookIdentityKey,
	createKindleHighlightIdentityKey,
	createStoredHighlightIdentityKeySet,
	CurrentClippingIdentityIndex,
} from "./HighlightIdentity";
import { AmbiguousLegacyClippingIdentityError } from "./VaultHighlightLookup";

export interface SyncClassification {
	newHighlights: KindleHighlight[];
	duplicateHighlights: KindleHighlight[];
	ignoredHighlights: KindleHighlight[];
	possibleReappearedHighlights: KindleHighlight[];
	/** Books with old state/markers that map one legacy ID to multiple canonical records. */
	identityConflictHighlights?: KindleHighlight[];
}

export interface SyncClassificationOptions {
	ignoredHighlights: IgnoredHighlight[];
	importedHighlights: ImportedHighlightRecord[];
	identityIndex: CurrentClippingIdentityIndex;
	highlightExistsInNote: (id: string, highlight: KindleHighlight) => Promise<boolean> | boolean;
}

export async function classifyHighlightsForSync(
	highlights: KindleHighlight[],
	options: SyncClassificationOptions
): Promise<SyncClassification> {
	const ignoredIdentities = createStoredHighlightIdentityKeySet(options.ignoredHighlights, options.identityIndex);
	const importedIdentities = createStoredHighlightIdentityKeySet(options.importedHighlights, options.identityIndex);
	const seenIdentities = new Set<string>();
	const classification: SyncClassification = {
		newHighlights: [],
		duplicateHighlights: [],
		ignoredHighlights: [],
		possibleReappearedHighlights: [],
		identityConflictHighlights: [],
	};
	const conflictedBookIdentities = options.identityIndex.findAmbiguousStoredBookIdentities([
		...options.ignoredHighlights,
		...options.importedHighlights,
	]);

	for (const highlight of highlights) {
		const identity = createKindleHighlightIdentityKey(highlight);

		if (seenIdentities.has(identity)) {
			classification.duplicateHighlights.push(highlight);
			continue;
		}

		seenIdentities.add(identity);
		const bookIdentity = createBookIdentityKey(highlight.bookTitle, highlight.author);

		if (conflictedBookIdentities.has(bookIdentity)) {
			continue;
		}

		let existsInNote = false;
		let lookupFailed = false;

		try {
			existsInNote = await options.highlightExistsInNote(createClippingId(highlight), highlight);
		} catch (error) {
			if (error instanceof AmbiguousLegacyClippingIdentityError) {
				conflictedBookIdentities.add(bookIdentity);
				continue;
			}

			lookupFailed = true;
		}

		if (ignoredIdentities.has(identity)) {
			classification.ignoredHighlights.push(highlight);
			continue;
		}

		if (!importedIdentities.has(identity)) {
			classification.newHighlights.push(highlight);
			continue;
		}

		if (existsInNote || lookupFailed) {
			classification.duplicateHighlights.push(highlight);
		} else {
			classification.possibleReappearedHighlights.push(highlight);
		}
	}

	if (conflictedBookIdentities.size > 0) {
		classification.newHighlights = withoutConflictedBooks(classification.newHighlights, conflictedBookIdentities);
		classification.duplicateHighlights = withoutConflictedBooks(
			classification.duplicateHighlights,
			conflictedBookIdentities
		);
		classification.ignoredHighlights = withoutConflictedBooks(
			classification.ignoredHighlights,
			conflictedBookIdentities
		);
		classification.possibleReappearedHighlights = withoutConflictedBooks(
			classification.possibleReappearedHighlights,
			conflictedBookIdentities
		);
		classification.identityConflictHighlights = highlights.filter((highlight, index) =>
			conflictedBookIdentities.has(createBookIdentityKey(highlight.bookTitle, highlight.author))
			&& highlights.findIndex((candidate) =>
				createKindleHighlightIdentityKey(candidate) === createKindleHighlightIdentityKey(highlight)
			) === index
		).sort(compareHighlightIdentity);
	}

	classification.possibleReappearedHighlights.sort(compareHighlightIdentity);

	return classification;
}

function compareHighlightIdentity(left: KindleHighlight, right: KindleHighlight): number {
	return createKindleHighlightIdentityKey(left).localeCompare(createKindleHighlightIdentityKey(right));
}

function withoutConflictedBooks(
	highlights: KindleHighlight[],
	conflictedBookIdentities: ReadonlySet<string>
): KindleHighlight[] {
	return highlights.filter((highlight) =>
		!conflictedBookIdentities.has(createBookIdentityKey(highlight.bookTitle, highlight.author))
	);
}
