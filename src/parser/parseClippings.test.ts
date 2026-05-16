import { describe, expect, it } from "vitest";
import { parseClippings } from "./parseClippings";

describe("parseClippings", () => {
	it("returns an empty array for empty input", () => {
		expect(parseClippings("")).toEqual([]);
	});

	it("returns an empty array for whitespace-only input", () => {
		expect(parseClippings(" \n\t ")).toEqual([]);
	});

	it("parses a valid highlight block", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Highlight on page 12 | Location 154-155 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				location: "154-155",
				content: "Small habits make a big difference.",
				dateAdded: "Thursday, May 14, 2026 2:44 PM",
				type: "Highlight",
			},
		]);
	});

	it("parses a valid note block", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Note on page 13 | Location 160 | Added on Thursday, May 14, 2026 2:45 PM

Review this idea later.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				location: "160",
				content: "Review this idea later.",
				dateAdded: "Thursday, May 14, 2026 2:45 PM",
				type: "Note",
			},
		]);
	});

	it("skips bookmark blocks", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Bookmark on page 14 | Location 170 | Added on Thursday, May 14, 2026 2:46 PM

==========`;

		expect(parseClippings(rawText)).toEqual([]);
	});

	it("uses Unknown when the author is missing", () => {
		const rawText = `Atomic Habits
- Your Highlight on page 12 | Location 154 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(parseClippings(rawText)[0]).toMatchObject({
			bookTitle: "Atomic Habits",
			author: "Unknown",
		});
	});

	it("extracts the author from the last parenthesis pair", () => {
		const rawText = `A Book Title (Expanded Edition) (Author Name)
- Your Highlight on page 12 | Location 154 | Added on Thursday, May 14, 2026 2:44 PM

The title contains parentheses.
==========`;

		expect(parseClippings(rawText)[0]).toMatchObject({
			bookTitle: "A Book Title (Expanded Edition)",
			author: "Author Name",
		});
	});

	it("parses Location ranges", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Highlight on page 12 | Location 154-155 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("154-155");
	});

	it("parses Loc. values", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Highlight at Loc. 154 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("154");
	});

	it("uses an empty string when location is missing", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Highlight on page 12 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(parseClippings(rawText)[0]?.location).toBe("");
	});

	it("skips malformed blocks without throwing", () => {
		const rawText = `This block is malformed
==========
Atomic Habits (James Clear)
- Your Highlight on page 12 | Location 154 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========`;

		expect(() => parseClippings(rawText)).not.toThrow();
		expect(parseClippings(rawText)).toHaveLength(1);
	});

	it("parses multiple clipping blocks correctly", () => {
		const rawText = `Atomic Habits (James Clear)
- Your Highlight on page 12 | Location 154 | Added on Thursday, May 14, 2026 2:44 PM

Small habits make a big difference.
==========
Deep Work (Cal Newport)
- Your Note on page 20 | Loc. 220 | Added on Friday, May 15, 2026 8:15 AM

Schedule focus time.
==========`;

		expect(parseClippings(rawText)).toEqual([
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				location: "154",
				content: "Small habits make a big difference.",
				dateAdded: "Thursday, May 14, 2026 2:44 PM",
				type: "Highlight",
			},
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				location: "220",
				content: "Schedule focus time.",
				dateAdded: "Friday, May 15, 2026 8:15 AM",
				type: "Note",
			},
		]);
	});
});
