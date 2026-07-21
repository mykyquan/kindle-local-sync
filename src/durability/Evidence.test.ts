import { describe, expect, it } from "vitest";
import {
	CompletionReceiptEvidence,
	InvalidEvidenceError,
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	canonicalizeJson,
	completionReceiptFilename,
	createContentImage,
	createExpectedStateMutationSha256,
	createNoteTargetKey,
	createOriginIdentity,
	createProfileIdentity,
	createVaultIdentity,
	encodeEvidence,
	isCanonicalUuid,
	isLowercaseSha256,
	journalFilename,
	originIdentityFilename,
	parseCompletionReceipt,
	parseOriginIdentity,
	parsePendingSentinel,
	parseProfileIdentity,
	parseRecoveryJournal,
	parseVaultIdentity,
	pendingSentinelFilename,
	profileIdentityFilename,
	sha256,
	vaultIdentityFilename,
} from "./Evidence";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN_ID = "22222222-2222-4222-8222-222222222222";
const VAULT_ID = "33333333-3333-4333-8333-333333333333";
const TRANSACTION_ID = "44444444-4444-4444-8444-444444444444";
const STRONG_ID = `kls2-${"a".repeat(64)}`;

describe("canonical evidence", () => {
	it("serializes keys deterministically and hashes the exact canonical bytes", () => {
		const first = canonicalizeJson({ z: 1, nested: { b: 2, a: 1 }, a: [3, 2] });
		const second = canonicalizeJson({ a: [3, 2], nested: { a: 1, b: 2 }, z: 1 });

		expect(first).toBe(second);
		expect(encodeEvidence({ z: 1, a: 2 })).toEqual({
			body: { z: 1, a: 2 },
			bytes: "{\"a\":2,\"z\":1}",
			sha256: sha256("{\"a\":2,\"z\":1}"),
		});
	});

	it("accepts only canonical UUID and lowercase SHA-256 forms", () => {
		expect(isCanonicalUuid(PROFILE_ID)).toBe(true);
		expect(isCanonicalUuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase())).toBe(false);
		expect(isCanonicalUuid("../11111111-1111-4111-8111-111111111111")).toBe(false);
		expect(isLowercaseSha256("a".repeat(64))).toBe(true);
		expect(isLowercaseSha256("A".repeat(64))).toBe(false);
	});

	it("round-trips profile, origin, and vault identity evidence", () => {
		const profile = createProfileIdentity(PROFILE_ID);
		const origin = createOriginIdentity(PROFILE_ID, ORIGIN_ID);
		const vault = createVaultIdentity(VAULT_ID);

		expect(parseProfileIdentity(profileIdentityFilename(profile), encodeEvidence(profile).bytes)).toEqual(profile);
		expect(parseOriginIdentity(originIdentityFilename(origin), encodeEvidence(origin).bytes)).toEqual(origin);
		expect(parseVaultIdentity(vaultIdentityFilename(vault), encodeEvidence(vault).bytes)).toEqual(vault);
	});

	it("keeps pending evidence limited to the approved non-content fields", () => {
		const pending = createPending();
		const encoded = encodeEvidence(pending);

		expect(Object.keys(pending).sort()).toEqual([
			"journalSha256",
			"originInstanceId",
			"schema",
			"transactionId",
			"vaultId",
			"version",
		]);
		expect(encoded.bytes).not.toMatch(/note|title|author|content|state|operation|created/i);
		expect(parsePendingSentinel(pendingSentinelFilename(pending), encoded.bytes)).toEqual(pending);
	});

	it("rejects extra pending fields, mutated bodies, and filename hash mismatches", () => {
		const pending = createPending();
		const filename = pendingSentinelFilename(pending);
		const withContent = canonicalizeJson({ ...pending, title: "Private title" });

		expect(() => parsePendingSentinel(filename, withContent)).toThrow(InvalidEvidenceError);
		expect(() => parsePendingSentinel(filename, encodeEvidence({ ...pending, vaultId: PROFILE_ID }).bytes))
			.toThrow(InvalidEvidenceError);
		expect(() => parsePendingSentinel(filename.replace(/[a-f0-9]{64}/, "0".repeat(64)), encodeEvidence(pending).bytes))
			.toThrow(InvalidEvidenceError);
	});

	it("round-trips a completion receipt and enforces paired note hashes", () => {
		const receipt = createReceipt();
		const encoded = encodeEvidence(receipt);

		expect(parseCompletionReceipt(completionReceiptFilename(receipt), encoded.bytes)).toEqual(receipt);
		expect(() => completionReceiptFilename({ ...receipt, noteTargetKey: null })).toThrow(InvalidEvidenceError);
		expect(() => completionReceiptFilename({ ...receipt, completedAt: "tomorrow" })).toThrow(InvalidEvidenceError);
	});

	it("round-trips and verifies every journal content hash", () => {
		const journal = createJournal();
		const encoded = encodeEvidence(journal);

		expect(parseRecoveryJournal(journalFilename(journal), encoded.bytes)).toEqual(journal);
		const corrupted = structuredClone(journal);
		if (corrupted.note?.postimage.kind === "present") {
			corrupted.note.postimage.content = "Truncated";
		}
		expect(() => journalFilename(corrupted)).toThrow(InvalidEvidenceError);
	});

	it("binds the note target hash to one canonical vault-relative path", () => {
		const journal = createJournal();
		const note = journal.note;
		if (!note) {
			throw new Error("Expected a note transaction fixture.");
		}

		expect(note.targetKey).toBe(createNoteTargetKey(note.targetPath));
		expect(() => journalFilename({
			...journal,
			note: { ...note, targetKey: "0".repeat(64) },
		})).toThrow(InvalidEvidenceError);
		expect(() => createNoteTargetKey("C:/Users/reader/private.md")).toThrow(InvalidEvidenceError);
		expect(() => createNoteTargetKey("Kindle/unsafe\0name.md")).toThrow(InvalidEvidenceError);
		for (const alias of [
			"/Kindle/book.md",
			"Kindle//book.md",
			"Kindle/./book.md",
			"Kindle/../book.md",
			"Kindle/book.md/",
			"Kindle\\book.md",
		]) {
			expect(() => createNoteTargetKey(alias)).toThrow(InvalidEvidenceError);
		}
	});

	it("accepts only the frozen collision implementation's exact highlight ID formats", () => {
		expect(() => journalFilename(createJournal({ strongIds: [STRONG_ID], legacyIds: ["kls-one"] })))
			.not.toThrow();
		for (const strongId of ["kls2-one", `kls2-${"A".repeat(64)}`, `kls2-${"a".repeat(63)}`]) {
			expect(() => journalFilename(createJournal({ strongIds: [strongId] }))).toThrow(InvalidEvidenceError);
		}
		for (const legacyId of ["kls-", "kls-UPPER", "legacy-one", "kls-one_two"]) {
			expect(() => journalFilename(createJournal({ legacyIds: [legacyId] }))).toThrow(InvalidEvidenceError);
		}
	});

	it("rejects noncanonical JSON even when its parsed value is valid", () => {
		const pending = createPending();
		const pretty = JSON.stringify(pending, null, 2);

		expect(() => parsePendingSentinel(pendingSentinelFilename(pending), pretty)).toThrow(InvalidEvidenceError);
	});
});

function createPending(): PendingSentinelEvidence {
	return {
		schema: "kindle-local-sync.pending",
		version: 1,
		transactionId: TRANSACTION_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		journalSha256: "a".repeat(64),
	};
}

function createReceipt(): CompletionReceiptEvidence {
	return {
		schema: "kindle-local-sync.completed",
		version: 1,
		transactionId: TRANSACTION_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		journalSha256: "a".repeat(64),
		pendingSha256: "b".repeat(64),
		noteTargetKey: "c".repeat(64),
		notePostSha256: "d".repeat(64),
		statePostSha256: "e".repeat(64),
		completedAt: "2099-01-02T03:04:05.000Z",
	};
}

function createJournal(overrides: Partial<RecoveryJournalEvidence> = {}): RecoveryJournalEvidence {
	const notePreimage = createContentImage("Personal preimage\n");
	const notePostimage = createContentImage("Personal postimage\n");
	const statePreimage = createContentImage("{\"old\":true}");
	const statePostimage = createContentImage("{\"expected\":true}");
	return {
		schema: "kindle-local-sync.journal",
		version: 1,
		transactionId: TRANSACTION_ID,
		profileId: PROFILE_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		operation: "managed-note-sync",
		createdAt: "2099-01-02T03:04:05.000Z",
		note: {
			targetPath: "Kindle Highlights/The Clockwork Orchard.md",
			targetKey: createNoteTargetKey("Kindle Highlights/The Clockwork Orchard.md"),
			preimage: notePreimage,
			postimage: notePostimage,
		},
		state: {
			preimage: statePreimage,
			postimage: statePostimage,
			expectedMutationSha256: createExpectedStateMutationSha256(statePreimage, statePostimage),
		},
		strongIds: [STRONG_ID],
		legacyIds: ["kls-one"],
		...overrides,
	};
}
