import { describe, expect, it } from "vitest";
import {
	createClippingId,
	dedupeClippings,
	groupHighlightsByBook,
	replaceOrAppendSyncRegion,
	renderBookMarkdown,
	renderClippingMarkdown,
	renderSyncRegion,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "./renderMarkdown";
import { KindleHighlight } from "../parser/parseClippings";

const atomicHighlight: KindleHighlight = {
	bookTitle: "Atomic Habits",
	author: "James Clear",
	location: "154-155",
	content: "Small habits make a big difference.",
	dateAdded: "Thursday, May 14, 2026 2:44 PM",
	type: "Highlight",
};

const atomicNote: KindleHighlight = {
	bookTitle: "Atomic Habits",
	author: "James Clear",
	location: "160",
	content: "Review this idea later.",
	dateAdded: "Thursday, May 14, 2026 2:45 PM",
	type: "Note",
};

describe("groupHighlightsByBook", () => {
	it("groups highlights by title and author", () => {
		const groups = groupHighlightsByBook([
			atomicHighlight,
			atomicNote,
			{
				...atomicHighlight,
				bookTitle: "Deep Work",
				author: "Cal Newport",
			},
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight, atomicNote],
		});
		expect(groups[1]).toMatchObject({
			bookTitle: "Deep Work",
			author: "Cal Newport",
		});
	});
});

describe("createClippingId", () => {
	it("creates stable deterministic IDs from clipping content", () => {
		expect(createClippingId(atomicHighlight)).toBe(createClippingId({ ...atomicHighlight }));
		expect(createClippingId(atomicHighlight)).toMatch(/^kls-[a-z0-9]+$/);
	});

	it("changes the ID when an important clipping field changes", () => {
		expect(createClippingId(atomicHighlight)).not.toBe(
			createClippingId({
				...atomicHighlight,
				content: "A different highlight.",
			})
		);
	});
});

describe("dedupeClippings", () => {
	it("removes duplicate clippings with the same stable ID", () => {
		const result = dedupeClippings([atomicHighlight, { ...atomicHighlight }, atomicNote]);

		expect(result.clippings).toEqual([atomicHighlight, atomicNote]);
		expect(result.duplicatesSkipped).toBe(1);
	});
});

describe("renderClippingMarkdown", () => {
	it("renders highlights as block quotes with location, date, and ID", () => {
		const markdown = renderClippingMarkdown(atomicHighlight);

		expect(markdown).toContain("### Highlight - Location 154-155");
		expect(markdown).toContain("> Small habits make a big difference.");
		expect(markdown).toContain("Added: Thursday, May 14, 2026 2:44 PM");
		expect(markdown).toContain("<!-- kindle-local-sync-id: kls-");
	});

	it("renders missing location and date gracefully", () => {
		const markdown = renderClippingMarkdown({
			...atomicNote,
			location: "",
			dateAdded: "",
		});

		expect(markdown).toContain("### Note\n");
		expect(markdown).toContain("Review this idea later.");
		expect(markdown).not.toContain("Location undefined");
		expect(markdown).not.toContain("Added: ");
	});
});

describe("renderBookMarkdown", () => {
	it("renders frontmatter, book heading, author, sync region, and clippings", () => {
		const markdown = renderBookMarkdown({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight, atomicNote],
		});

		expect(markdown).toContain("---\ntitle: \"Atomic Habits\"\nauthor: \"James Clear\"");
		expect(markdown).toContain("# Atomic Habits");
		expect(markdown).toContain("Author: James Clear");
		expect(markdown).toContain(SYNC_START_MARKER);
		expect(markdown).toContain(SYNC_END_MARKER);
		expect(markdown).toContain("### Highlight - Location 154-155");
		expect(markdown).toContain("### Note - Location 160");
	});
});

describe("replaceOrAppendSyncRegion", () => {
	it("replaces only the generated sync region when markers exist", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicNote],
		});
		const existingMarkdown = [
			"# Atomic Habits",
			"",
			"User introduction.",
			"",
			SYNC_START_MARKER,
			"",
			"old generated content",
			"",
			SYNC_END_MARKER,
			"",
			"User outro.",
		].join("\n");

		expect(replaceOrAppendSyncRegion(existingMarkdown, newRegion)).toBe(
			[
				"# Atomic Habits",
				"",
				"User introduction.",
				"",
				newRegion,
				"",
				"User outro.",
			].join("\n")
		);
	});

	it("appends a generated sync region when markers do not exist", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight],
		});

		expect(replaceOrAppendSyncRegion("# Atomic Habits\n\nUser notes.", newRegion)).toBe(
			`# Atomic Habits\n\nUser notes.\n\n## Kindle Highlights & Notes\n\n${newRegion}\n`
		);
	});

	it("preserves a broken start marker as user content and appends a new region", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight],
		});
		const existingMarkdown = `# Atomic Habits\n\nUser notes.\n\n${SYNC_START_MARKER}\n\npartial generated content`;

		expect(replaceOrAppendSyncRegion(existingMarkdown, newRegion)).toBe(
			`${existingMarkdown}\n\n## Kindle Highlights & Notes\n\n${newRegion}\n`
		);
	});
});
