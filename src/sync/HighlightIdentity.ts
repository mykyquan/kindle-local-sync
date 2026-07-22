import { createHash } from "crypto";
import { KindleHighlight } from "../parser/parseClippings";

export const STRONG_CLIPPING_ID_VERSION = 2 as const;
export const STRONG_CLIPPING_ID_PREFIX = "kls2-";
export const LEGACY_CLIPPING_ID_PREFIX = "kls-";

export interface StoredHighlightIdentity {
	id: string;
	title: string;
	author?: string;
	legacyId?: string;
	identityVersion?: number;
}

export interface ClippingIdentity {
	id: string;
	legacyId: string;
	identityVersion: typeof STRONG_CLIPPING_ID_VERSION;
	canonicalInput: string;
}

export type BookIdentityKey = string;
export type HighlightIdentityKey = string;

export class StrongFingerprintCollisionError extends Error {
	constructor(readonly fingerprint: string) {
		super("Two different canonical clippings produced the same strong fingerprint.");
		this.name = "StrongFingerprintCollisionError";
	}
}

/** Tracks one complete clipping input and is released with the operation that owns it. */
export class StrongFingerprintCollisionRegistry {
	private readonly canonicalInputByStrongId = new Map<string, string>();

	assertConsistent(id: string, canonicalInput: string): void {
		const previousCanonicalInput = this.canonicalInputByStrongId.get(id);

		if (previousCanonicalInput !== undefined && previousCanonicalInput !== canonicalInput) {
			throw new StrongFingerprintCollisionError(id);
		}

		this.canonicalInputByStrongId.set(id, canonicalInput);
	}
}

/**
 * Serializes every authoritative clipping field with named JSON members and an explicit schema version.
 * Page is intentionally absent because the parser has never made page part of clipping identity.
 */
export function serializeCanonicalClippingIdentity(clipping: KindleHighlight): string {
	return JSON.stringify({
		schema: "kindle-local-sync/clipping-identity",
		version: STRONG_CLIPPING_ID_VERSION,
		fields: {
			title: normalizeIdentityField(clipping.bookTitle),
			author: normalizeIdentityField(clipping.author),
			type: normalizeIdentityField(clipping.type),
			location: normalizeIdentityField(clipping.location),
			dateAdded: normalizeIdentityField(clipping.dateAdded),
			content: normalizeIdentityField(clipping.content),
		},
	});
}

export function createClippingIdentity(clipping: KindleHighlight): ClippingIdentity {
	const canonicalInput = serializeCanonicalClippingIdentity(clipping);
	const id = `${STRONG_CLIPPING_ID_PREFIX}${createHash("sha256").update(canonicalInput, "utf8").digest("hex")}`;

	return {
		id,
		legacyId: createLegacyClippingId(clipping),
		identityVersion: STRONG_CLIPPING_ID_VERSION,
		canonicalInput,
	};
}

/** The authoritative identity written by this plugin version. */
export function createClippingId(clipping: KindleHighlight): string {
	return createClippingIdentity(clipping).id;
}

/** Preserves the public 0.1.0-0.1.2 32-bit identifier for verified lazy migration only. */
export function createLegacyClippingId(clipping: KindleHighlight): string {
	const stableInput = [
		clipping.bookTitle,
		clipping.author,
		clipping.type,
		clipping.location,
		clipping.dateAdded,
		clipping.content,
	]
		.map(normalizeIdentityField)
		.join("\u001f");

	return `${LEGACY_CLIPPING_ID_PREFIX}${fnv1aHash(stableInput)}`;
}

export function isStrongClippingId(id: string): boolean {
	return /^kls2-[0-9a-f]{64}$/.test(id);
}

export function isLegacyClippingId(id: string): boolean {
	return /^kls-[a-z0-9]+$/.test(id);
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

interface CurrentIdentityCandidate {
	bookIdentity: BookIdentityKey;
	highlightIdentity: HighlightIdentityKey;
	strongId: string;
	legacyId: string;
}

/**
 * Resolves old state only against the complete current clipping input. Exact duplicate copies collapse,
 * while every legacy ID with multiple distinct canonical candidates remains deliberately ambiguous.
 */
export class CurrentClippingIdentityIndex {
	private readonly candidatesByStrongKey = new Map<string, CurrentIdentityCandidate>();
	private readonly candidatesByLegacyTitleKey = new Map<string, Map<HighlightIdentityKey, CurrentIdentityCandidate>>();
	private readonly candidatesByLegacyBookKey = new Map<string, Map<HighlightIdentityKey, CurrentIdentityCandidate>>();

	constructor(highlights: readonly KindleHighlight[]) {
		const collisionRegistry = new StrongFingerprintCollisionRegistry();

		for (const highlight of highlights) {
			const clippingIdentity = createClippingIdentity(highlight);

			collisionRegistry.assertConsistent(clippingIdentity.id, clippingIdentity.canonicalInput);
			const candidate: CurrentIdentityCandidate = {
				bookIdentity: createBookIdentityKey(highlight.bookTitle, highlight.author),
				highlightIdentity: createHighlightIdentityKey(
					highlight.bookTitle,
					highlight.author,
					clippingIdentity.id
				),
				strongId: clippingIdentity.id,
				legacyId: clippingIdentity.legacyId,
			};

			this.candidatesByStrongKey.set(
				createStrongCandidateKey(highlight.bookTitle, highlight.author, clippingIdentity.id),
				candidate
			);
			addCandidate(
				this.candidatesByLegacyTitleKey,
				createLegacyTitleKey(highlight.bookTitle, clippingIdentity.legacyId),
				candidate
			);
			addCandidate(
				this.candidatesByLegacyBookKey,
				createLegacyBookKey(highlight.bookTitle, highlight.author, clippingIdentity.legacyId),
				candidate
			);
		}
	}

	resolveStoredIdentity(record: StoredHighlightIdentity): HighlightIdentityKey | null {
		if (isStrongClippingId(record.id)) {
			if (record.author === undefined
				|| (record.identityVersion !== undefined && record.identityVersion !== STRONG_CLIPPING_ID_VERSION)) {
				return null;
			}

			const candidate = this.candidatesByStrongKey.get(
				createStrongCandidateKey(record.title, record.author, record.id)
			);

			if (!candidate || (record.legacyId !== undefined && record.legacyId !== candidate.legacyId)) {
				return null;
			}

			return candidate.highlightIdentity;
		}

		if (!isLegacyClippingId(record.id)) {
			return null;
		}

		return getOnlyCandidate(
			record.author === undefined
				? this.candidatesByLegacyTitleKey.get(createLegacyTitleKey(record.title, record.id))
				: this.candidatesByLegacyBookKey.get(createLegacyBookKey(record.title, record.author, record.id))
		)?.highlightIdentity ?? null;
	}

	isLegacyIdAmbiguousForBook(title: string, author: string, legacyId: string): boolean {
		return (this.candidatesByLegacyBookKey.get(createLegacyBookKey(title, author, legacyId))?.size ?? 0) > 1;
	}

	resolveLegacyIdForBook(title: string, author: string, legacyId: string): HighlightIdentityKey | null {
		return getOnlyCandidate(
			this.candidatesByLegacyBookKey.get(createLegacyBookKey(title, author, legacyId))
		)?.highlightIdentity ?? null;
	}

	getStrongIdentityMetadata(
		title: string,
		author: string,
		strongId: string
	): Pick<ClippingIdentity, "legacyId" | "identityVersion"> | null {
		const candidate = this.candidatesByStrongKey.get(createStrongCandidateKey(title, author, strongId));

		return candidate
			? { legacyId: candidate.legacyId, identityVersion: STRONG_CLIPPING_ID_VERSION }
			: null;
	}

	findAmbiguousStoredBookIdentities(records: readonly StoredHighlightIdentity[]): Set<BookIdentityKey> {
		const ambiguousBooks = new Set<BookIdentityKey>();

		for (const record of records) {
			if (!isLegacyClippingId(record.id)) {
				continue;
			}

			const candidates = record.author === undefined
				? this.candidatesByLegacyTitleKey.get(createLegacyTitleKey(record.title, record.id))
				: this.candidatesByLegacyBookKey.get(createLegacyBookKey(record.title, record.author, record.id));

			if (!candidates || candidates.size <= 1) {
				continue;
			}

			const candidateCountByBook = new Map<BookIdentityKey, number>();

			for (const candidate of candidates.values()) {
				candidateCountByBook.set(
					candidate.bookIdentity,
					(candidateCountByBook.get(candidate.bookIdentity) ?? 0) + 1
				);
			}

			for (const [bookIdentity, count] of candidateCountByBook) {
				if (count > 1) {
					ambiguousBooks.add(bookIdentity);
				}
			}
		}

		return ambiguousBooks;
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

/** New decisions append a strong record; resolving an old record must not suppress that lazy upgrade. */
export function createAuthoredStoredHighlightIdentityKeySet(
	records: readonly StoredHighlightIdentity[],
	identityIndex: CurrentClippingIdentityIndex
): Set<HighlightIdentityKey> {
	return createStoredHighlightIdentityKeySet(
		records.filter((record) => record.author !== undefined && isStrongClippingId(record.id)),
		identityIndex
	);
}

function addCandidate(
	index: Map<string, Map<HighlightIdentityKey, CurrentIdentityCandidate>>,
	key: string,
	candidate: CurrentIdentityCandidate
): void {
	const candidates = index.get(key) ?? new Map<HighlightIdentityKey, CurrentIdentityCandidate>();

	candidates.set(candidate.highlightIdentity, candidate);
	index.set(key, candidates);
}

function getOnlyCandidate(
	candidates: ReadonlyMap<HighlightIdentityKey, CurrentIdentityCandidate> | undefined
): CurrentIdentityCandidate | null {
	if (!candidates || candidates.size !== 1) {
		return null;
	}

	for (const candidate of candidates.values()) {
		return candidate;
	}

	return null;
}

function createStrongCandidateKey(title: string, author: string, id: string): string {
	return JSON.stringify([title, author, id]);
}

function createLegacyTitleKey(title: string, legacyId: string): string {
	return JSON.stringify([title, legacyId]);
}

function createLegacyBookKey(title: string, author: string, legacyId: string): string {
	return JSON.stringify([title, author, legacyId]);
}

function normalizeIdentityField(value: string): string {
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
