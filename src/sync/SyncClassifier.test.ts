import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import { classifyHighlightsForSync } from "./SyncClassifier";

describe("classifyHighlightsForSync", () => {
	it("classifies ignored highlights as ignored", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [{
				id: createClippingId(highlight),
				title: highlight.bookTitle,
				textPreview: highlight.content,
				ignoredAt: "2026-07-07T00:00:00.000Z",
			}],
			importedHighlights: [],
			highlightExistsInNote: () => false,
		});

		expect(classification.ignoredHighlights).toEqual([highlight]);
	});

	it("classifies unseen highlights as new", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [],
			highlightExistsInNote: () => false,
		});

		expect(classification.newHighlights).toEqual([highlight]);
	});

	it("classifies previously imported missing-from-note highlights for recovery review", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(highlight)],
			highlightExistsInNote: () => false,
		});

		expect(classification.possibleReappearedHighlights).toEqual([highlight]);
	});

	it("falls back safely when note lookup fails", async () => {
		const highlight = createHighlight();
		const classification = await classifyHighlightsForSync([highlight], {
			ignoredHighlights: [],
			importedHighlights: [createImportedRecord(highlight)],
			highlightExistsInNote: () => {
				throw new Error("Read failed");
			},
		});

		expect(classification.duplicateHighlights).toEqual([highlight]);
		expect(classification.possibleReappearedHighlights).toEqual([]);
	});
});

function createImportedRecord(highlight: KindleHighlight) {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		textPreview: highlight.content,
		importedAt: "2026-07-07T00:00:00.000Z",
	};
}

function createHighlight(overrides: Partial<KindleHighlight> = {}): KindleHighlight {
	return {
		bookTitle: "Atomic Habits",
		author: "James Clear",
		location: "154",
		content: "Small habits make a big difference.",
		dateAdded: "Thursday, May 14, 2026 2:44 PM",
		type: "Highlight",
		...overrides,
	};
}
