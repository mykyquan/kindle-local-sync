import { KindleHighlight } from "../parser/parseClippings";

export interface StoredHighlightIdentity {
	id: string;
	title: string;
	author?: string;
}

export type BookIdentityKey = string;
export type HighlightIdentityKey = string;

export function createClippingId(clipping: KindleHighlight): string {
	const stableInput = [
		clipping.bookTitle,
		clipping.author,
		clipping.type,
		clipping.location,
		clipping.dateAdded,
		clipping.content,
	]
		.map(normalizeHashField)
		.join("\u001f");

	return `kls-${fnv1aHash(stableInput)}`;
}

/** Uses exact source fields; title and author normalization would merge distinct Kindle books. */
export function createBookIdentityKey(title: string, author: string): BookIdentityKey {
	return JSON.stringify([title, author]);
}

export function hasSameBookIdentity(left: KindleHighlight, right: KindleHighlight): boolean {
	return createBookIdentityKey(left.bookTitle, left.author)
		=== createBookIdentityKey(right.bookTitle, right.author);
}

export function createStoredBookIdentityKey(record: Pick<StoredHighlightIdentity, "title" | "author">): string {
	return JSON.stringify([record.title, record.author ?? null]);
}

export function createHighlightIdentityKey(
	title: string,
	author: string,
	id: string
): HighlightIdentityKey {
	return JSON.stringify([title, author, id]);
}

export function createKindleHighlightIdentityKey(highlight: KindleHighlight): HighlightIdentityKey {
	return createHighlightIdentityKey(
		highlight.bookTitle,
		highlight.author,
		createClippingId(highlight)
	);
}

export function hasSameHighlightIdentity(left: KindleHighlight, right: KindleHighlight): boolean {
	return createKindleHighlightIdentityKey(left) === createKindleHighlightIdentityKey(right);
}

/**
 * Resolves legacy authorless records only against the complete clipping input for one sync.
 * Duplicate copies collapse, while multiple distinct authors remain deliberately ambiguous.
 */
export class CurrentClippingIdentityIndex {
	private readonly candidatesByLegacyKey: ReadonlyMap<string, ReadonlySet<HighlightIdentityKey>>;

	constructor(highlights: readonly KindleHighlight[]) {
		const candidates = new Map<string, Set<HighlightIdentityKey>>();

		for (const highlight of highlights) {
			const id = createClippingId(highlight);
			const legacyKey = createLegacyIdentityKey(highlight.bookTitle, id);
			const identities = candidates.get(legacyKey) ?? new Set<HighlightIdentityKey>();

			identities.add(createHighlightIdentityKey(highlight.bookTitle, highlight.author, id));
			candidates.set(legacyKey, identities);
		}

		this.candidatesByLegacyKey = candidates;
	}

	resolveStoredIdentity(record: StoredHighlightIdentity): HighlightIdentityKey | null {
		if (record.author !== undefined) {
			return createHighlightIdentityKey(record.title, record.author, record.id);
		}

		const candidates = this.candidatesByLegacyKey.get(createLegacyIdentityKey(record.title, record.id));

		if (!candidates || candidates.size !== 1) {
			return null;
		}

		for (const candidate of candidates) {
			return candidate;
		}

		return null;
	}
}

export function createStoredHighlightIdentityKeySet(
	records: readonly StoredHighlightIdentity[],
	identityIndex: CurrentClippingIdentityIndex
): Set<HighlightIdentityKey> {
	const identities = new Set<HighlightIdentityKey>();

	for (const record of records) {
		const identity = identityIndex.resolveStoredIdentity(record);

		if (identity) {
			identities.add(identity);
		}
	}

	return identities;
}

/** Explicit decisions need a durable authored record even when legacy trust resolves for this run. */
export function createAuthoredStoredHighlightIdentityKeySet(
	records: readonly StoredHighlightIdentity[],
	identityIndex: CurrentClippingIdentityIndex
): Set<HighlightIdentityKey> {
	return createStoredHighlightIdentityKeySet(
		records.filter((record) => record.author !== undefined),
		identityIndex
	);
}

function createLegacyIdentityKey(title: string, id: string): string {
	return JSON.stringify([title, id]);
}

function normalizeHashField(value: string): string {
	return value.trim().replace(/\r\n/g, "\n");
}

function fnv1aHash(value: string): string {
	let hash = 0x811c9dc5;

	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(36);
}
