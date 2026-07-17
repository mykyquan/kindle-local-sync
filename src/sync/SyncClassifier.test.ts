import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import { CurrentClippingIdentityIndex } from "./HighlightIdentity";
import { classifyHighlightsForSync } from "./SyncClassifier";

describe("classifyHighlightsForSync", () => {
	it("classifies ignored highlights as ignored", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [{
				id: createClippingId(highlight),
				title: highlight.bookTitle,
				textPreview: highlight.content,
				ignoredAt: "2099-07-07T00:00:00.000Z",
			}],
			importedHighlights: [],
			identityIndex: new CurrentClippingIdentityIndex([highlight]),
			highlightExistsInNote: () => false,
		});

		expect(classification.ignoredHighlights).toEqual([highlight]);
	});

	it("classifies unseen highlights as new", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [],
			identityIndex: new CurrentClippingIdentityIndex([highlight]),
			highlightExistsInNote: () => false,
		});

		expect(classification.newHighlights).toEqual([highlight]);
	});

	it("classifies previously imported missing-from-note highlights for recovery review", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(highlight)],
			identityIndex: new CurrentClippingIdentityIndex([highlight]),
			highlightExistsInNote: () => false,
		});

		expect(classification.possibleReappearedHighlights).toEqual([highlight]);
	});

	it("keeps a previously imported highlight as a duplicate while its managed ID is present", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(highlight)],
			identityIndex: new CurrentClippingIdentityIndex([highlight]),
			highlightExistsInNote: () => true,
		});

		expect(classification.duplicateHighlights).toEqual([highlight]);
		expect(classification.possibleReappearedHighlights).toEqual([]);
	});

	it("classifies all previously imported source highlights as missing when their IDs are absent", async () => {
		const first = createHighlight();
		const second = createHighlight({
			location: "160",
			content: "Second managed highlight.",
		});
		const highlights = [first, second];
		const classification = await classifyHighlightsForSync(highlights, {
			ignoredHighlights: [],
			importedHighlights: highlights.map(createImportedRecord),
			identityIndex: new CurrentClippingIdentityIndex(highlights),
			highlightExistsInNote: () => false,
		});

		expect(classification.possibleReappearedHighlights).toEqual(highlights);
		expect(classification.duplicateHighlights).toEqual([]);
	});

	it("falls back safely when note lookup fails", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(highlight)],
			identityIndex: new CurrentClippingIdentityIndex([highlight]),
			highlightExistsInNote: () => {
				throw new Error("Read failed");
			},
		});

		expect(classification.duplicateHighlights).toEqual([highlight]);
		expect(classification.possibleReappearedHighlights).toEqual([]);
	});

	it("does not share imported or duplicate state across colliding books", async () => {
		const safe = createCollisionHighlight("Collision 1y0rlvz 2269");
		const protectedHighlight = createCollisionHighlight("Collision 1h0o65e 20hu");
		const highlights = [safe, protectedHighlight];
		const classification = await classifyHighlightsForSync(highlights, {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(safe)],
			identityIndex: new CurrentClippingIdentityIndex(highlights),
			highlightExistsInNote: (_id, highlight) => highlight === safe,
		});

		expect(createClippingId(safe)).toBe(createClippingId(protectedHighlight));
		expect(classification.duplicateHighlights).toEqual([safe]);
		expect(classification.newHighlights).toEqual([protectedHighlight]);
	});

	it("resolves an authorless record when the complete input has one distinct candidate", async () => {
		const highlight = createHighlight();
		const legacyRecord = createLegacyImportedRecord(highlight);
		const classification = await classifyHighlightsForSync([highlight, { ...highlight }], {
			ignoredHighlights: [],
			importedHighlights: [legacyRecord],
			identityIndex: new CurrentClippingIdentityIndex([highlight, { ...highlight }]),
			highlightExistsInNote: () => true,
		});

		expect(classification.duplicateHighlights).toEqual([highlight, { ...highlight }]);
		expect(classification.newHighlights).toEqual([]);
	});

	it("fails closed for an authorless record with multiple distinct authors", async () => {
		const first = createSameTitleAuthorCollision("Author i5onjs phg65z");
		const second = createSameTitleAuthorCollision("Author 1lqf5c4 1t7ix5f");
		const legacyRecord = createLegacyImportedRecord(first);
		const classification = await classifyHighlightsForSync([first, second], {
			ignoredHighlights: [],
			importedHighlights: [legacyRecord],
			identityIndex: new CurrentClippingIdentityIndex([first, second]),
			highlightExistsInNote: () => true,
		});

		expect(createClippingId(first)).toBe(createClippingId(second));
		expect(classification.newHighlights).toEqual([first, second]);
		expect(classification.duplicateHighlights).toEqual([]);
	});

	it("does not let an ambiguous authorless ignored record suppress either author", async () => {
		const first = createSameTitleAuthorCollision("Author i5onjs phg65z");
		const second = createSameTitleAuthorCollision("Author 1lqf5c4 1t7ix5f");
		const classification = await classifyHighlightsForSync([first, second], {
			ignoredHighlights: [{
				id: createClippingId(first),
				title: first.bookTitle,
				textPreview: "Legacy ignored preview",
				ignoredAt: "2099-07-07T00:00:00.000Z",
			}],
			importedHighlights: [],
			identityIndex: new CurrentClippingIdentityIndex([first, second]),
			highlightExistsInNote: () => true,
		});

		expect(classification.ignoredHighlights).toEqual([]);
		expect(classification.newHighlights).toEqual([first, second]);
	});

	it("gives no trust to an authorless record with zero current candidates", async () => {
		const current = createHighlight({ bookTitle: "Current" });
		const historical = createHighlight({ bookTitle: "Historical" });
		const legacyRecord = createLegacyImportedRecord(historical);
		const classification = await classifyHighlightsForSync([current], {
			ignoredHighlights: [],
			importedHighlights: [legacyRecord],
			identityIndex: new CurrentClippingIdentityIndex([current]),
			highlightExistsInNote: () => true,
		});

		expect(classification.newHighlights).toEqual([current]);
	});
});

function createImportedRecord(highlight: KindleHighlight) {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		author: highlight.author,
		textPreview: highlight.content,
		importedAt: "2099-07-07T00:00:00.000Z",
	};
}

function createLegacyImportedRecord(highlight: KindleHighlight) {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		textPreview: highlight.content,
		importedAt: "2099-07-07T00:00:00.000Z",
	};
}

function createCollisionHighlight(bookTitle: string): KindleHighlight {
	return createHighlight({
		bookTitle,
		author: "Author",
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});
}

function createSameTitleAuthorCollision(author: string): KindleHighlight {
	return createHighlight({
		bookTitle: "Same Title",
		author,
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});
}

function createHighlight(overrides: Partial<KindleHighlight> = {}): KindleHighlight {
	return {
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight",
		...overrides,
	};
}
