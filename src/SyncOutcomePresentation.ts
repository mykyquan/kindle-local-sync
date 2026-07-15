import { KindleHighlight } from "./parser/parseClippings";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import {
	createBookIdentityKey,
	createHighlightIdentityKey,
	hasSameHighlightIdentity,
} from "./sync/HighlightIdentity";
import {
	IgnoredHighlightCleanupSummary,
	IgnoredHighlightCleanupTargetOutcome,
} from "./sync/IgnoredHighlightCleanup";

export interface ProtectedBookPresentation {
	title: string;
	author: string;
	affectedHighlightCount: number;
	selectedHighlightCount: number;
}

export interface ProtectedBooksPresentation {
	bookCount: number;
	affectedHighlightCount: number;
	selectedHighlightCount: number;
	books: ProtectedBookPresentation[];
}

export type IgnoreResultPresentationStatus =
	| "removed"
	| "note-not-found"
	| "already-absent"
	| "multiple-notes-unchanged"
	| "note-unchanged"
	| "not-removed"
	| "change-unconfirmed";

export interface IgnoreResultPresentationItem {
	bookTitle: string;
	author: string;
	highlightPreview?: string;
	status: IgnoreResultPresentationStatus;
}

export interface IgnoreResultsPresentation {
	highlightCount: number;
	removedCount: number;
	noMatchingNoteCount: number;
	alreadyAbsentCount: number;
	unchangedCount: number;
	failedCount: number;
	unconfirmedCount: number;
	nonRemovalCount: number;
	items: IgnoreResultPresentationItem[];
}

/**
 * Converts validated protected-highlight partitions into book-level UI data.
 * Writer paths, protection reasons, marker details, and highlight IDs never cross this boundary.
 */
export function createProtectedBooksPresentation(
	protectedHighlights: readonly KindleHighlight[],
	explicitlySelectedHighlights: readonly KindleHighlight[]
): ProtectedBooksPresentation {
	const booksByIdentity = new Map<string, ProtectedBookPresentation>();
	let selectedHighlightCount = 0;

	for (const highlight of protectedHighlights) {
		const identity = createBookIdentityKey(highlight.bookTitle, highlight.author);
		const book = booksByIdentity.get(identity) ?? {
			title: highlight.bookTitle,
			author: highlight.author,
			affectedHighlightCount: 0,
			selectedHighlightCount: 0,
		};
		const wasExplicitlySelected = explicitlySelectedHighlights.some((selectedHighlight) =>
			hasSameHighlightIdentity(selectedHighlight, highlight)
		);

		book.affectedHighlightCount++;
		if (wasExplicitlySelected) {
			book.selectedHighlightCount++;
			selectedHighlightCount++;
		}

		booksByIdentity.set(identity, book);
	}

	return {
		bookCount: booksByIdentity.size,
		affectedHighlightCount: protectedHighlights.length,
		selectedHighlightCount,
		books: Array.from(booksByIdentity.values()),
	};
}

/** Maps current Ignore cleanup outcomes into ordered, non-technical UI rows. */
export function createIgnoreResultsPresentation(
	summaries: readonly IgnoredHighlightCleanupSummary[],
	previewSources: readonly SyncSummaryHighlightItem[] = []
): IgnoreResultsPresentation {
	const items: IgnoreResultPresentationItem[] = [];

	for (const summary of summaries) {
		for (const bookOutcome of summary.bookOutcomes) {
			for (const targetOutcome of bookOutcome.targetOutcomes) {
				const previewSource = previewSources.find((source) =>
					createHighlightIdentityKey(source.title, source.author, source.id)
						=== createHighlightIdentityKey(
							targetOutcome.target.bookTitle,
							targetOutcome.target.author,
							targetOutcome.target.id
						)
				);
				const item: IgnoreResultPresentationItem = {
					bookTitle: bookOutcome.bookTitle,
					author: bookOutcome.author,
					status: mapIgnoreCleanupStatus(targetOutcome),
				};

				if (previewSource?.textPreview) {
					item.highlightPreview = previewSource.textPreview;
				}

				items.push(item);
			}
		}
	}

	return createIgnoreResultsPresentationFromItems(items);
}

export function mergeIgnoreResultsPresentations(
	current: IgnoreResultsPresentation,
	additional: IgnoreResultsPresentation
): IgnoreResultsPresentation {
	return createIgnoreResultsPresentationFromItems([
		...current.items,
		...additional.items,
	]);
}

export function createEmptyIgnoreResultsPresentation(): IgnoreResultsPresentation {
	return createIgnoreResultsPresentationFromItems([]);
}

function createIgnoreResultsPresentationFromItems(
	items: IgnoreResultPresentationItem[]
): IgnoreResultsPresentation {
	const removedCount = items.filter((item) => item.status === "removed").length;
	const noMatchingNoteCount = items.filter((item) => item.status === "note-not-found").length;
	const alreadyAbsentCount = items.filter((item) => item.status === "already-absent").length;
	const unchangedCount = items.filter((item) => isConfirmedUnchangedIgnoreResult(item.status)).length;
	const failedCount = items.filter((item) => item.status === "not-removed").length;
	const unconfirmedCount = items.filter((item) => item.status === "change-unconfirmed").length;

	return {
		highlightCount: items.length,
		removedCount,
		noMatchingNoteCount,
		alreadyAbsentCount,
		unchangedCount,
		failedCount,
		unconfirmedCount,
		nonRemovalCount: items.length - removedCount,
		items,
	};
}

function isConfirmedUnchangedIgnoreResult(status: IgnoreResultPresentationStatus): boolean {
	return status === "multiple-notes-unchanged"
		|| status === "note-unchanged";
}

function mapIgnoreCleanupStatus(
	outcome: IgnoredHighlightCleanupTargetOutcome
): IgnoreResultPresentationStatus {
	switch (outcome.status) {
		case "removed-safely":
			return "removed";
		case "no-matching-note":
			return "note-not-found";
		case "no-matching-highlight-block":
			return "already-absent";
		case "ambiguous-note-ownership":
			return "multiple-notes-unchanged";
		case "unsafe-managed-region":
			return "note-unchanged";
		case "cleanup-failed":
			return "not-removed";
		case "cleanup-state-unknown":
			return "change-unconfirmed";
		default:
			return assertNever(outcome);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unhandled Ignore cleanup outcome: ${String(value)}`);
}
