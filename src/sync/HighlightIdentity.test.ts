import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import {
	createSyntheticSameBookCollision,
	SYNTHETIC_LEGACY_COLLISION_ID,
} from "../testFixtures/syntheticSameBookCollision";
import {
	createAuthoredStoredHighlightIdentityKeySet,
	createBookIdentityKey,
	createClippingIdentity,
	createClippingId,
	createHighlightIdentityKey,
	createKindleHighlightIdentityKey,
	createLegacyClippingId,
	CurrentClippingIdentityIndex,
	hasSameHighlightIdentity,
	serializeCanonicalClippingIdentity,
	StrongFingerprintCollisionError,
	StrongFingerprintCollisionRegistry,
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

	it("keeps books separate when their real legacy 32-bit clipping IDs collide", () => {
		const first = createCollisionHighlight("Collision 1h0o65e 20hu");
		const second = createCollisionHighlight("Collision 1y0rlvz 2269");

		expect(createLegacyClippingId(first)).toBe(createLegacyClippingId(second));
		expect(createClippingId(first)).not.toBe(createClippingId(second));
		expect(hasSameHighlightIdentity(first, second)).toBe(false);
	});

	it("gives the verified same-book collision separate full SHA-256 identities", () => {
		const [first, second] = createSyntheticSameBookCollision();

		expect(createLegacyClippingId(first)).toBe(SYNTHETIC_LEGACY_COLLISION_ID);
		expect(createLegacyClippingId(second)).toBe(SYNTHETIC_LEGACY_COLLISION_ID);
		expect(createClippingId(first)).toMatch(/^kls2-[0-9a-f]{64}$/);
		expect(createClippingId(second)).toMatch(/^kls2-[0-9a-f]{64}$/);
		expect(createClippingId(first)).not.toBe(createClippingId(second));
	});

	it("uses explicitly versioned named JSON fields instead of delimiter concatenation", () => {
		const clipping = createHighlight({ content: "left\u001fright" });
		const serialized = serializeCanonicalClippingIdentity(clipping);

		expect(JSON.parse(serialized)).toEqual({
			schema: "kindle-local-sync/clipping-identity",
			version: 2,
			fields: {
				title: clipping.bookTitle,
				author: clipping.author,
				type: clipping.type,
				location: clipping.location,
				dateAdded: clipping.dateAdded,
				content: clipping.content,
			},
		});
	});

	it("intentionally treats records that differ only by an unparsed page as one logical highlight", () => {
		const clipping = createHighlight();
		const firstPage = { ...clipping, page: "10" };
		const secondPage = { ...clipping, page: "11" };

		expect(serializeCanonicalClippingIdentity(firstPage)).toBe(serializeCanonicalClippingIdentity(secondPage));
		expect(createClippingId(firstPage)).toBe(createClippingId(secondPage));
	});

	it("fails closed within one input but does not retain collision state across unrelated operations", () => {
		const fingerprint = `kls2-${"f".repeat(64)}`;
		const firstOperation = new StrongFingerprintCollisionRegistry();
		const unrelatedOperation = new StrongFingerprintCollisionRegistry();

		firstOperation.assertConsistent(fingerprint, "canonical-one");
		expect(() => firstOperation.assertConsistent(fingerprint, "canonical-two"))
			.toThrow(StrongFingerprintCollisionError);
		expect(() => unrelatedOperation.assertConsistent(fingerprint, "canonical-two"))
			.not.toThrow();
	});

	it("collapses repeated identical clippings when resolving a legacy record", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight, { ...highlight }]);

		expect(index.resolveStoredIdentity({
			id: createLegacyClippingId(highlight),
			title: highlight.bookTitle,
		})).toBe(createKindleHighlightIdentityKey(highlight));
	});

	it("does not resolve an authorless record across multiple distinct authors", () => {
		const first = createSameTitleAuthorCollision("Author i5onjs phg65z");
		const second = createSameTitleAuthorCollision("Author 1lqf5c4 1t7ix5f");
		const index = new CurrentClippingIdentityIndex([first, second]);

		expect(createLegacyClippingId(first)).toBe(createLegacyClippingId(second));
		expect(index.resolveStoredIdentity({
			id: createLegacyClippingId(first),
			title: first.bookTitle,
		})).toBeNull();
	});

	it("requires authored records to match their exact author", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);

		expect(index.resolveStoredIdentity({
			id: createLegacyClippingId(highlight),
			title: highlight.bookTitle,
			author: "Different Author",
		})).not.toBe(createKindleHighlightIdentityKey(highlight));
	});

	it("excludes uniquely resolved legacy records from explicit authored deduplication", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);
		const identities = createAuthoredStoredHighlightIdentityKeySet([
			{ id: createLegacyClippingId(highlight), title: highlight.bookTitle },
		], index);

		expect(index.resolveStoredIdentity({
			id: createLegacyClippingId(highlight),
			title: highlight.bookTitle,
		})).toBe(createKindleHighlightIdentityKey(highlight));
		expect(identities).toEqual(new Set());
	});

	it("retains exact versioned strong records for explicit decision deduplication", () => {
		const highlight = createHighlight();
		const index = new CurrentClippingIdentityIndex([highlight]);
		const identity = createKindleHighlightIdentityKey(highlight);
		const clippingIdentity = createClippingIdentity(highlight);

		expect(createAuthoredStoredHighlightIdentityKeySet([{
			id: clippingIdentity.id,
			legacyId: clippingIdentity.legacyId,
			identityVersion: clippingIdentity.identityVersion,
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
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight",
		...overrides,
	};
}
