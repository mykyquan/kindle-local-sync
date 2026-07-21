import { describe, expect, it } from "vitest";
import {
	CompletionReceiptEvidence,
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	createContentImage,
	createExpectedStateMutationSha256,
	encodeEvidence,
} from "./Evidence";
import {
	RECEIPT_LIMIT,
	ScannedEvidence,
	StartupEvidenceInput,
	classifyStartupEvidence,
	planReceiptRetention,
} from "./StartupEvidence";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORIGIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VAULT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VAULT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRANSACTION_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_TRANSACTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("startup evidence classification", () => {
	it("classifies no evidence as clear", () => {
		expect(classifyStartupEvidence(createInput())).toMatchObject({
			kind: "no-evidence",
			status: "clear",
			issues: [],
		});
	});

	it("requires reconciliation for one valid local journal and matching pending sentinel", () => {
		const journal = scannedJournal();
		const pending = scannedPending(journal);

		expect(classifyStartupEvidence(createInput({ journals: [journal], pending: [pending] }))).toMatchObject({
			kind: "matching-journal-pending",
			status: "reconciliation-required",
			originInstanceIds: [ORIGIN_ID],
		});
	});

	it("blocks non-origin pending evidence without the local full journal", () => {
		const pending = scannedPending(scannedJournal(), { originInstanceId: OTHER_ORIGIN_ID });

		expect(classifyStartupEvidence(createInput({ pending: [pending] }))).toMatchObject({
			kind: "pending-without-local-journal",
			status: "blocked",
			originInstanceIds: [OTHER_ORIGIN_ID],
		});
	});

	it("distinguishes a journal whose pending sentinel is missing", () => {
		expect(classifyStartupEvidence(createInput({ journals: [scannedJournal()] }))).toMatchObject({
			kind: "journal-without-pending",
			status: "blocked",
		});
	});

	it("accepts a matching completion receipt only after local artifacts match", () => {
		const journal = scannedJournal();
		const pending = scannedPending(journal);
		const receipt = scannedReceipt(journal, pending);

		expect(classifyStartupEvidence(createInput({
			receipts: [receipt],
			artifactStatusByTransactionId: { [TRANSACTION_ID]: "matched" },
		}))).toMatchObject({
			kind: "matching-completion-receipt",
			status: "clear",
			completedTransactionIds: [TRANSACTION_ID],
		});
		expect(classifyStartupEvidence(createInput({
			pending: [pending],
			receipts: [receipt],
			artifactStatusByTransactionId: { [TRANSACTION_ID]: "not-arrived" },
		}))).toMatchObject({
			kind: "completion-artifacts-not-arrived",
			status: "blocked",
		});
	});

	it("blocks corrupt, conflicting, and mismatched evidence deterministically", () => {
		expect(classifyStartupEvidence(createInput({ corruptEvidenceFilenames: ["truncated.json"] }))).toMatchObject({
			kind: "corrupt-evidence",
			status: "blocked",
		});
		expect(classifyStartupEvidence(createInput({ identityConflict: true }))).toMatchObject({
			kind: "identity-conflict",
			status: "blocked",
		});
		const mismatched = scannedPending(scannedJournal(), { vaultId: OTHER_VAULT_ID });
		expect(classifyStartupEvidence(createInput({ pending: [mismatched] }))).toMatchObject({
			kind: "evidence-mismatch",
			status: "blocked",
		});
	});

	it("classifies several unresolved pending transactions as a whole-vault block", () => {
		const firstJournal = scannedJournal();
		const secondJournal = scannedJournal({ transactionId: OTHER_TRANSACTION_ID });
		const first = scannedPending(firstJournal);
		const second = scannedPending(secondJournal, { transactionId: OTHER_TRANSACTION_ID });

		expect(classifyStartupEvidence(createInput({ pending: [first, second] }))).toMatchObject({
			kind: "multiple-unresolved-pending",
			status: "blocked",
		});
	});

	it("blocks new work when receipt retention is exhausted", () => {
		expect(classifyStartupEvidence(createInput({ receiptCapacityReached: true }))).toMatchObject({
			kind: "receipt-retention-exhausted",
			status: "blocked",
		});
	});

	it("blocks semantically conflicting receipts independent of iteration order", () => {
		const journal = scannedJournal();
		const pending = scannedPending(journal);
		const first = scannedReceipt(journal, pending);
		const conflictingBody = {
			...first.body,
			statePostSha256: "f".repeat(64),
		};
		const conflictingEncoded = encodeEvidence(conflictingBody);
		const second = {
			filename: "conflicting.completed.json",
			sha256: conflictingEncoded.sha256,
			body: conflictingBody,
		};

		for (const receipts of [[first, second], [second, first]]) {
			expect(classifyStartupEvidence(createInput({
				receipts,
				artifactStatusByTransactionId: { [TRANSACTION_ID]: "matched" },
			}))).toMatchObject({
				kind: "evidence-mismatch",
				status: "blocked",
				completedTransactionIds: [],
			});
		}
	});
});

describe("completion receipt retention", () => {
	it("retains receipts for at least 365 days and while matching pending is visible", () => {
		const now = new Date("2100-01-01T00:00:00.000Z");
		const old = receiptEntry("old", "2098-01-01T00:00:00.000Z", TRANSACTION_ID);
		const young = receiptEntry("young", "2099-12-31T00:00:00.000Z", OTHER_TRANSACTION_ID);
		const plan = planReceiptRetention({
			receipts: [old, young],
			pendingTransactionIds: new Set([TRANSACTION_ID]),
			now,
		});

		expect(plan.eligibleForCleanup).toEqual([]);
		expect(plan.protectedByPending).toEqual(["old.json"]);
		expect(plan.tooYoung).toEqual(["young.json"]);
	});

	it("makes a receipt eligible only after the minimum retention window", () => {
		const plan = planReceiptRetention({
			receipts: [receiptEntry("eligible", "2098-01-01T00:00:00.000Z", TRANSACTION_ID)],
			pendingTransactionIds: new Set(),
			now: new Date("2100-01-01T00:00:00.000Z"),
		});

		expect(plan.eligibleForCleanup).toEqual(["eligible.json"]);
	});

	it("blocks at 4,096 receipts and distinguishes safe cleanup from exhaustion", () => {
		const youngReceipts = Array.from({ length: RECEIPT_LIMIT }, (_, index) =>
			receiptEntry(`young-${index}`, "2099-12-31T00:00:00.000Z", uuidForIndex(index))
		);
		const exhausted = planReceiptRetention({
			receipts: youngReceipts,
			pendingTransactionIds: new Set(),
			now: new Date("2100-01-01T00:00:00.000Z"),
		});
		const withEligible = planReceiptRetention({
			receipts: [
				...youngReceipts.slice(1),
				receiptEntry("old", "2098-01-01T00:00:00.000Z", TRANSACTION_ID),
			],
			pendingTransactionIds: new Set(),
			now: new Date("2100-01-01T00:00:00.000Z"),
		});

		expect(exhausted).toMatchObject({ limitReached: true, exhausted: true, canStartNewTransaction: false });
		expect(withEligible).toMatchObject({ limitReached: true, exhausted: false, canStartNewTransaction: false });
		expect(withEligible.eligibleForCleanup).toContain("old.json");
	});
});

function createInput(overrides: Partial<StartupEvidenceInput> = {}): StartupEvidenceInput {
	return {
		vaultId: VAULT_ID,
		originInstanceId: ORIGIN_ID,
		corruptEvidenceFilenames: [],
		journals: [],
		pending: [],
		receipts: [],
		artifactStatusByTransactionId: {},
		...overrides,
	};
}

function scannedJournal(overrides: Partial<RecoveryJournalEvidence> = {}): ScannedEvidence<RecoveryJournalEvidence> {
	const preimage = createContentImage("{\"old\":true}");
	const postimage = createContentImage("{\"new\":true}");
	const body: RecoveryJournalEvidence = {
		schema: "kindle-local-sync.journal",
		version: 1,
		transactionId: TRANSACTION_ID,
		profileId: PROFILE_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		operation: "settings-mutation",
		createdAt: "2099-01-01T00:00:00.000Z",
		note: null,
		state: {
			preimage,
			postimage,
			expectedMutationSha256: createExpectedStateMutationSha256(preimage, postimage),
		},
		strongIds: [],
		legacyIds: [],
		...overrides,
	};
	const encoded = encodeEvidence(body);
	return { filename: `${body.transactionId}.journal.json`, sha256: encoded.sha256, body };
}

function scannedPending(
	journal: ScannedEvidence<RecoveryJournalEvidence>,
	overrides: Partial<PendingSentinelEvidence> = {}
): ScannedEvidence<PendingSentinelEvidence> {
	const body: PendingSentinelEvidence = {
		schema: "kindle-local-sync.pending",
		version: 1,
		transactionId: journal.body.transactionId,
		originInstanceId: journal.body.originInstanceId,
		vaultId: journal.body.vaultId,
		journalSha256: journal.sha256,
		...overrides,
	};
	const encoded = encodeEvidence(body);
	return { filename: `${body.transactionId}.pending.json`, sha256: encoded.sha256, body };
}

function scannedReceipt(
	journal: ScannedEvidence<RecoveryJournalEvidence>,
	pending: ScannedEvidence<PendingSentinelEvidence>
): ScannedEvidence<CompletionReceiptEvidence> {
	const body: CompletionReceiptEvidence = {
		schema: "kindle-local-sync.completed",
		version: 1,
		transactionId: journal.body.transactionId,
		originInstanceId: journal.body.originInstanceId,
		vaultId: journal.body.vaultId,
		journalSha256: journal.sha256,
		pendingSha256: pending.sha256,
		noteTargetKey: null,
		notePostSha256: null,
		statePostSha256: "e".repeat(64),
		completedAt: "2099-01-02T00:00:00.000Z",
	};
	const encoded = encodeEvidence(body);
	return { filename: `${body.transactionId}.completed.json`, sha256: encoded.sha256, body };
}

function receiptEntry(name: string, completedAt: string, transactionId: string) {
	return { filename: `${name}.json`, transactionId, completedAt };
}

function uuidForIndex(index: number): string {
	const suffix = index.toString(16).padStart(12, "0");
	return `dddddddd-dddd-4ddd-8ddd-${suffix}`;
}
