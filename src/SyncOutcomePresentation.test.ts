import { describe, expect, it } from "vitest";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId } from "./render/renderMarkdown";
import {
	createIgnoreResultsPresentation,
	createProtectedBooksPresentation,
} from "./SyncOutcomePresentation";
import { createSyncSummaryHighlightItem } from "./SyncSummaryTypes";
import {
	IgnoredHighlightCleanupSummary,
	IgnoredHighlightCleanupTargetOutcome,
} from "./sync/IgnoredHighlightCleanup";

describe("SyncOutcomePresentation protected books", () => {
	it("groups protected highlights by book and counts only explicit selections", () => {
		const automatic = createHighlight({ content: "Previously imported." });
		const selected = createHighlight({ content: "Selected now.", location: "2" });
		const selectedOtherBook = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			content: "Focus deeply.",
		});

		expect(createProtectedBooksPresentation(
			[automatic, selected, selectedOtherBook],
			[selected, selectedOtherBook]
		)).toEqual({
			bookCount: 2,
			affectedHighlightCount: 3,
			selectedHighlightCount: 2,
			books: [
				{
					title: "Atomic Habits",
					author: "James Clear",
					affectedHighlightCount: 2,
					selectedHighlightCount: 1,
				},
				{
					title: "Deep Work",
					author: "Cal Newport",
					affectedHighlightCount: 1,
					selectedHighlightCount: 1,
				},
			],
		});
	});

	it("returns UI-safe fields without writer details or highlight IDs", () => {
		const highlight = createHighlight();
		const presentation = createProtectedBooksPresentation([highlight], [highlight]);
		const serialized = JSON.stringify(presentation);

		expect(serialized).not.toContain(createClippingId(highlight));
		expect(serialized).not.toContain("notePath");
		expect(serialized).not.toContain("reason");
		expect(serialized).not.toContain("marker");
		expect(Object.keys(presentation.books[0] ?? {})).toEqual([
			"title",
			"author",
			"affectedHighlightCount",
			"selectedHighlightCount",
		]);
	});
});

describe("SyncOutcomePresentation Ignore results", () => {
	it("exhaustively maps every cleanup status to a limited presentation status", () => {
		const highlight = createHighlight();
		const target = createTarget(highlight);
		const outcomes: IgnoredHighlightCleanupTargetOutcome[] = [
			{ target, status: "removed-safely", blocksRemoved: 1 },
			{ target, status: "no-matching-note" },
			{ target, status: "no-matching-highlight-block" },
			{ target, status: "ambiguous-note-ownership" },
			{ target, status: "unsafe-managed-region", reason: "start-without-end" },
			{ target, status: "cleanup-failed", stage: "write" },
			{ target, status: "cleanup-state-unknown", stage: "write" },
		];
		const presentation = createIgnoreResultsPresentation(
			[createCleanupSummary(outcomes)],
			[createSyncSummaryHighlightItem(highlight)]
		);

		expect(presentation.items.map((item) => item.status)).toEqual([
			"removed",
			"note-not-found",
			"already-absent",
			"multiple-notes-unchanged",
			"note-unchanged",
			"not-removed",
			"change-unconfirmed",
		]);
		expect(presentation).toMatchObject({
			highlightCount: 7,
			removedCount: 1,
			noMatchingNoteCount: 1,
			alreadyAbsentCount: 1,
			unchangedCount: 2,
			failedCount: 1,
			unconfirmedCount: 1,
			nonRemovalCount: 6,
		});
	});

	it("keeps no-matching-note separate from confirmed unchanged outcomes", () => {
		const highlight = createHighlight();
		const presentation = createIgnoreResultsPresentation([createCleanupSummary([
			{ target: createTarget(highlight), status: "no-matching-note" },
		])]);

		expect(presentation).toMatchObject({
			highlightCount: 1,
			noMatchingNoteCount: 1,
			alreadyAbsentCount: 0,
			unchangedCount: 0,
			failedCount: 0,
			unconfirmedCount: 0,
		});
		expect(presentation.items).toEqual([expect.objectContaining({
			status: "note-not-found",
		})]);
	});

	it("preserves result order, attaches only safe previews, and removes internal cleanup details", () => {
		const first = createHighlight({ content: "First preview." });
		const second = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			content: "Second preview.",
		});
		const presentation = createIgnoreResultsPresentation([
			createCleanupSummary([
				{ target: createTarget(first), status: "cleanup-failed", stage: "read" },
			], first),
			createCleanupSummary([
				{
					target: createTarget(second),
					status: "unsafe-managed-region",
					reason: "nested-markers",
				},
			], second),
		], [first, second].map(createSyncSummaryHighlightItem));
		const serialized = JSON.stringify(presentation);

		expect(presentation.items).toEqual([
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				highlightPreview: "First preview.",
				status: "not-removed",
			},
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				highlightPreview: "Second preview.",
				status: "note-unchanged",
			},
		]);
		expect(serialized).not.toContain(createClippingId(first));
		expect(serialized).not.toContain('"read"');
		expect(serialized).not.toContain('"nested-markers"');
		expect(serialized).not.toContain('"stage"');
		expect(serialized).not.toContain('"reason"');
	});

	it("does not invent current results for an empty cleanup summary", () => {
		expect(createIgnoreResultsPresentation([createCleanupSummary([])])).toEqual({
			highlightCount: 0,
			removedCount: 0,
			noMatchingNoteCount: 0,
			alreadyAbsentCount: 0,
			unchangedCount: 0,
			failedCount: 0,
			unconfirmedCount: 0,
			nonRemovalCount: 0,
			items: [],
		});
	});
});

function createCleanupSummary(
	targetOutcomes: IgnoredHighlightCleanupTargetOutcome[],
	highlight = createHighlight()
): IgnoredHighlightCleanupSummary {
	return {
		filesScanned: 1,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes: targetOutcomes.length === 0 ? [] : [{
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			targetOutcomes,
		}],
	};
}

function createTarget(highlight: KindleHighlight) {
	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		id: createClippingId(highlight),
	};
}

function createHighlight(overrides: Partial<KindleHighlight> = {}): KindleHighlight {
	return {
		bookTitle: "Atomic Habits",
		author: "James Clear",
		location: "1",
		content: "Small habits compound.",
		dateAdded: "Thursday, May 14, 2026 2:44 PM",
		type: "Highlight",
		...overrides,
	};
}
