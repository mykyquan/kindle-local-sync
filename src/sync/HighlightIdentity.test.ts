import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import {
	createAuthoredStoredHighlightIdentityKeySet,
	createBookIdentityKey,
	createHighlightIdentityKey,
	createKindleHighlightIdentityKey,
	CurrentClippingIdentityIndex,
	hasSameHighlightIdentity,
} from "./HighlightIdentity";

describe("highlight identity", () => {
	it("serializes exact title, author, and clipping ID without normalizing", () => {
		const highlight = createHighlight();
		const id = createClippingId(highlight);

		expect(createBookIdentityKey(highlight.bookTitle, highlight.author)).toBe(
			JSON.stringify([highlight.bookTitle, highlight.author])
		);
		expect(createKindleHighlightIdentityKey(highlight)).toBe(
			createHighlightIdentityKey(highlight.bookTitle, highlight.author, id)
		);
		expect(createBookIdentityKey(" Title", "Author")).not.toBe(createBookIdentityKey("Title", "Author"));
	});

	it("keeps books separate when their real 32-bit clipping IDs collide", () => {
		const first = createCollisionHighlight("Collision 1h0o65e 20hu");
		const second = createCollisionHighlight("Collision 1y0rlvz 2269");

		expect(createClippingId(first)).toBe(createClippingId(second));
		expect(hasSameHighlightIdentity(first, second)).toBe(false);
	});

	it("collapses repeated identical clippings when resolving a legacy record", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight, { ...highlight }]);

		expect(index.resolveStoredIdentity({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
		})).toBe(createKindleHighlightIdentityKey(highlight));
	});

	it("does not resolve an authorless record across multiple distinct authors", () => {
		const first = createSameTitleAuthorCollision("Author i5onjs phg65z");
		const second = createSameTitleAuthorCollision("Author 1lqf5c4 1t7ix5f");
		const index = new CurrentClippingIdentityIndex([first, second]);

		expect(createClippingId(first)).toBe(createClippingId(second));
		expect(index.resolveStoredIdentity({
			id: createClippingId(first),
			title: first.bookTitle,
		})).toBeNull();
	});

	it("requires authored records to match their exact author", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);

		expect(index.resolveStoredIdentity({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: "Different Author",
		})).not.toBe(createKindleHighlightIdentityKey(highlight));
	});

	it("excludes uniquely resolved legacy records from explicit authored deduplication", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);
		const identities = createAuthoredStoredHighlightIdentityKeySet([
			{ id: createClippingId(highlight), title: highlight.bookTitle },
		], index);

		expect(index.resolveStoredIdentity({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
		})).toBe(createKindleHighlightIdentityKey(highlight));
		expect(identities).toEqual(new Set());
	});

	it("retains exact authored records for explicit decision deduplication", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);
		const identity = createKindleHighlightIdentityKey(highlight);

		expect(createAuthoredStoredHighlightIdentityKeySet([{
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: highlight.author,
		}], index)).toEqual(new Set([identity]));
	});
});

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
		bookTitle: "Atomic Habits",
		author: "James Clear",
		location: "154",
		content: "Small habits make a big difference.",
		dateAdded: "Thursday, May 14, 2026 2:44 PM",
		type: "Highlight",
		...overrides,
	};
}
