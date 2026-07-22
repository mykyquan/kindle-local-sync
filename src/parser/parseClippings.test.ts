import { describe, expect, it } from "vitest";
import { parseClippings } from "./parseClippings";
import {
	createSyntheticSameBookCollision,
	renderSyntheticSameBookCollisionClippings,
} from "../testFixtures/syntheticSameBookCollision";

describe("parseClippings", () => {
	it("preserves both distinct records in the verified same-book legacy collision fixture", () => {
		expect(parseClippings(renderSyntheticSameBookCollisionClippings()))
			.toEqual(createSyntheticSameBookCollision());
	});
	it("returns an empty array for empty input", () => {
		expect(parseClippings("")).toEqual([]);
	});

	it("returns an empty array for whitespace-only input", () => {
		expect(parseClippings(" \n\t ")).toEqual([]);
	});

	it("parses a valid highlight block", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Location 154-155 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				location: "154-155",
				content: "Clockwork apples chime at midnight.",
				dateAdded: "Monday, October 5, 2099 9:41 AM",
				type: "Highlight",
			},
		]);
	});

	it("parses a valid note block", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Note on page 13 | Location 160 | Added on Monday, October 5, 2099 9:42 AM

Revisit the orchard map later.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				location: "160",
				content: "Revisit the orchard map later.",
				dateAdded: "Monday, October 5, 2099 9:42 AM",
				type: "Note",
			},
		]);
	});

	it("skips bookmark blocks", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Bookmark on page 14 | Location 170 | Added on Monday, October 5, 2099 9:43 AM

==========`;

		expect(parseClippings(rawText)).toEqual([]);
	});

	it("uses Unknown when the author is missing", () => {
		const rawText = `The Clockwork Orchard
- Your Highlight on page 12 | Location 154 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(parseClippings(rawText)[0]).toMatchObject({
			bookTitle: "The Clockwork Orchard",
			author: "Unknown",
		});
	});

	it("extracts the author from the last parenthesis pair", () => {
		const rawText = `A Book Title (Expanded Edition) (Author Name)
- Your Highlight on page 12 | Location 154 | Added on Monday, October 5, 2099 9:41 AM

The title contains parentheses.
==========`;

		expect(parseClippings(rawText)[0]).toMatchObject({
			bookTitle: "A Book Title (Expanded Edition)",
			author: "Author Name",
		});
	});

	it("parses Location ranges", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Location 154-155 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("154-155");
	});

	it("parses Loc. values", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Highlight at Loc. 154 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("154");
	});

	it("uses an empty string when location is missing", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("");
	});

	it("skips malformed blocks without throwing", () => {
		const rawText = `This block is malformed
==========
The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Location 154 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;

		expect(() => parseClippings(rawText)).not.toThrow();
		expect(parseClippings(rawText)).toHaveLength(1);
	});

	it("parses multiple clipping blocks correctly", () => {
		const rawText = `The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Location 154 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========
Night Trains to Lumen Bay (Owen Hart)
- Your Note on page 20 | Loc. 220 | Added on Tuesday, October 6, 2099 10:15 AM

Reserve a window seat before moonrise.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				location: "154",
				content: "Clockwork apples chime at midnight.",
				dateAdded: "Monday, October 5, 2099 9:41 AM",
				type: "Highlight",
			},
			{
				bookTitle: "Night Trains to Lumen Bay",
				author: "Owen Hart",
				location: "220",
				content: "Reserve a window seat before moonrise.",
				dateAdded: "Tuesday, October 6, 2099 10:15 AM",
				type: "Note",
			},
		]);
	});
});
