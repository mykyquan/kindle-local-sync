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

const orchardHighlight: KindleHighlight = {
	bookTitle: "The Clockwork Orchard",
	author: "Mira Vale",
	location: "154-155",
	content: "Clockwork apples chime at midnight.",
	dateAdded: "Monday, October 5, 2099 9:41 AM",
	type: "Highlight",
};

const orchardNote: KindleHighlight = {
	bookTitle: "The Clockwork Orchard",
	author: "Mira Vale",
	location: "160",
	content: "Revisit the orchard map later.",
	dateAdded: "Monday, October 5, 2099 9:42 AM",
	type: "Note",
};

describe("groupHighlightsByBook", () => {
	it("groups highlights by title and author", () => {
		const groups = groupHighlightsByBook([
			orchardHighlight,
			orchardNote,
			{
				...orchardHighlight,
				bookTitle: "Night Trains to Lumen Bay",
				author: "Owen Hart",
			},
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight, orchardNote],
		});
		expect(groups[1]).toMatchObject({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
		});
	});
});

describe("createClippingId", () => {
	it("creates stable deterministic IDs from clipping content", () => {
		expect(createClippingId(orchardHighlight)).toBe(createClippingId({ ...orchardHighlight }));
		expect(createClippingId(orchardHighlight)).toMatch(/^kls2-[0-9a-f]{64}$/);
	});

	it("changes the ID when an important clipping field changes", () => {
		expect(createClippingId(orchardHighlight)).not.toBe(
			createClippingId({
				...orchardHighlight,
				content: "A different highlight.",
			})
		);
	});
});

describe("dedupeClippings", () => {
	it("removes duplicate clippings with the same stable ID", () => {
		const result = dedupeClippings([orchardHighlight, { ...orchardHighlight }, orchardNote]);

		expect(result.clippings).toEqual([orchardHighlight, orchardNote]);
		expect(result.duplicatesSkipped).toBe(1);
	});
});

describe("renderClippingMarkdown", () => {
	it("renders highlights as block quotes with location, date, and ID", () => {
		const markdown = renderClippingMarkdown(orchardHighlight);

		expect(markdown).toContain("### Highlight - Location 154-155");
		expect(markdown).toContain("> Clockwork apples chime at midnight.");
		expect(markdown).toContain("Added: Monday, October 5, 2099 9:41 AM");
		expect(markdown).toContain("<!-- kindle-local-sync-legacy-id: kls-");
		expect(markdown).toContain("<!-- kindle-local-sync-id: kls2-");
	});

	it("renders missing location and date gracefully", () => {
		const markdown = renderClippingMarkdown({
			...orchardNote,
			location: "",
			dateAdded: "",
		});

		expect(markdown).toContain("### Note\n");
		expect(markdown).toContain("Revisit the orchard map later.");
		expect(markdown).not.toContain("Location undefined");
		expect(markdown).not.toContain("Added: ");
	});
});

describe("renderBookMarkdown", () => {
	it("renders frontmatter, book heading, author, sync region, and clippings", () => {
		const markdown = renderBookMarkdown({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight, orchardNote],
		});

		expect(markdown).toContain("---\ntitle: \"The Clockwork Orchard\"\nauthor: \"Mira Vale\"");
		expect(markdown).toContain("# The Clockwork Orchard");
		expect(markdown).toContain("Author: Mira Vale");
		expect(markdown).toContain(SYNC_START_MARKER);
		expect(markdown).toContain(SYNC_END_MARKER);
		expect(markdown).toContain("### Highlight - Location 154-155");
		expect(markdown).toContain("### Note - Location 160");
	});
});

describe("replaceOrAppendSyncRegion", () => {
	it("replaces only the generated sync region when markers exist", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardNote],
		});
		const existingMarkdown = [
			"# The Clockwork Orchard",
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
				"# The Clockwork Orchard",
				"",
				"User introduction.",
				"",
				newRegion,
				"",
				"User outro.",
			].join("\n")
		);
	});

	it("preserves adjacent user content outside markers and replaces content inside managed markers", () => {
		const oldGeneratedHighlight = renderClippingMarkdown(orchardHighlight);
		const newRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardNote],
		});
		const existingMarkdown = [
			"# The Clockwork Orchard",
			"",
			`User note immediately above marker.${SYNC_START_MARKER}`,
			"",
			oldGeneratedHighlight,
			"Manual note directly after the generated highlight block.",
			"",
			"Manual note inside the managed region.",
			`${SYNC_END_MARKER}User note immediately below marker.`,
		].join("\n");
		const updatedMarkdown = replaceOrAppendSyncRegion(existingMarkdown, newRegion);

		expect(updatedMarkdown).toContain("User note immediately above marker.");
		expect(updatedMarkdown).toContain("User note immediately below marker.");
		expect(updatedMarkdown).not.toContain("Manual note inside the managed region.");
		expect(updatedMarkdown).not.toContain("Manual note directly after the generated highlight block.");
		expect(updatedMarkdown).toBe(
			[
				"# The Clockwork Orchard",
				"",
				`User note immediately above marker.${newRegion}User note immediately below marker.`,
			].join("\n")
		);
	});

	it("appends a generated sync region when markers do not exist", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight],
		});

		expect(replaceOrAppendSyncRegion("# The Clockwork Orchard\n\nUser notes.", newRegion)).toBe(
			`# The Clockwork Orchard\n\nUser notes.\n\n## Kindle Highlights & Notes\n\n${newRegion}\n`
		);
	});

	it("preserves marker-free user content byte-for-byte before appending a restored region", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight],
		});
		const existingMarkdown = "Personal introduction.\r\n\r\nPersonal ending.  \r\n \t";
		const updatedMarkdown = replaceOrAppendSyncRegion(existingMarkdown, newRegion);

		expect(updatedMarkdown.slice(0, existingMarkdown.length)).toBe(existingMarkdown);
		expect(updatedMarkdown).toBe(
			`${existingMarkdown}\r\n\r\n## Kindle Highlights & Notes\n\n${newRegion}\n`
		);
	});

	it("preserves a broken start marker as user content and appends a new region", () => {
		const newRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight],
		});
		const existingMarkdown = `# The Clockwork Orchard\n\nUser notes.\n\n${SYNC_START_MARKER}\n\npartial generated content`;

		expect(replaceOrAppendSyncRegion(existingMarkdown, newRegion)).toBe(
			`${existingMarkdown}\n\n## Kindle Highlights & Notes\n\n${newRegion}\n`
		);
	});
});
