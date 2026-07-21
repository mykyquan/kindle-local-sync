import {
	CompletionReceiptEvidence,
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	canonicalizeJson,
} from "./Evidence";

export const RECEIPT_MIN_RETENTION_DAYS = 365;
export const RECEIPT_LIMIT = 4096;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface ScannedEvidence<T> {
	filename: string;
	sha256: string;
	body: T;
}

export type CompletionArtifactStatus = "matched" | "not-arrived" | "conflicting" | "unknown";

export interface StartupEvidenceInput {
	vaultId?: string;
	originInstanceId?: string;
	identityConflict?: boolean;
	corruptEvidenceFilenames: string[];
	journals: ScannedEvidence<RecoveryJournalEvidence>[];
	pending: ScannedEvidence<PendingSentinelEvidence>[];
	receipts: ScannedEvidence<CompletionReceiptEvidence>[];
	artifactStatusByTransactionId: Readonly<Record<string, CompletionArtifactStatus | undefined>>;
	receiptRetentionExhausted?: boolean;
	receiptCapacityReached?: boolean;
}

export type StartupEvidenceKind =
	| "no-evidence"
	| "matching-journal-pending"
	| "pending-without-local-journal"
	| "journal-without-pending"
	| "matching-completion-receipt"
	| "completion-artifacts-not-arrived"
	| "corrupt-evidence"
	| "evidence-mismatch"
	| "identity-conflict"
	| "multiple-unresolved-pending"
	| "receipt-retention-exhausted";

export type StartupEvidenceStatus = "clear" | "blocked" | "reconciliation-required";

export interface StartupEvidenceIssue {
	kind: Exclude<StartupEvidenceKind, "no-evidence" | "matching-completion-receipt">;
	transactionId?: string;
	originInstanceId?: string;
	filenames: string[];
}

export interface StartupEvidenceClassification {
	kind: StartupEvidenceKind;
	status: StartupEvidenceStatus;
	issues: StartupEvidenceIssue[];
	originInstanceIds: string[];
	completedTransactionIds: string[];
}

export interface ReceiptRetentionEntry {
	filename: string;
	transactionId: string;
	completedAt: string;
}

export interface ReceiptRetentionPlan {
	receiptCount: number;
	limit: number;
	minimumRetentionDays: number;
	eligibleForCleanup: string[];
	protectedByPending: string[];
	tooYoung: string[];
	canStartNewTransaction: boolean;
	limitReached: boolean;
	exhausted: boolean;
}

export function classifyStartupEvidence(input: StartupEvidenceInput): StartupEvidenceClassification {
	const issues: StartupEvidenceIssue[] = [];
	const completedTransactionIds = new Set<string>();
	const originInstanceIds = new Set<string>();

	for (const pending of input.pending) {
		originInstanceIds.add(pending.body.originInstanceId);
	}
	for (const journal of input.journals) {
		originInstanceIds.add(journal.body.originInstanceId);
	}
	for (const receipt of input.receipts) {
		originInstanceIds.add(receipt.body.originInstanceId);
	}

	if (input.corruptEvidenceFilenames.length > 0) {
		issues.push({ kind: "corrupt-evidence", filenames: [...input.corruptEvidenceFilenames].sort() });
	}
	if (input.identityConflict) {
		issues.push({ kind: "identity-conflict", filenames: [] });
	}
	if (input.receiptRetentionExhausted || input.receiptCapacityReached) {
		issues.push({ kind: "receipt-retention-exhausted", filenames: [] });
	}

	const conflictingReceiptTransactionIds = findConflictingReceiptTransactionIds(input.receipts);
	for (const transactionId of conflictingReceiptTransactionIds) {
		issues.push({
			kind: "evidence-mismatch",
			transactionId,
			filenames: input.receipts
				.filter((receipt) => receipt.body.transactionId === transactionId)
				.map((receipt) => receipt.filename)
				.sort(),
		});
	}

	const unresolvedPendingIssues: StartupEvidenceIssue[] = [];
	for (const pending of input.pending) {
		const transactionId = pending.body.transactionId;
		if (conflictingReceiptTransactionIds.has(transactionId)) {
			continue;
		}
		if (!matchesCurrentVault(input.vaultId, pending.body.vaultId)) {
			unresolvedPendingIssues.push(issue("evidence-mismatch", transactionId, pending.body.originInstanceId, pending.filename));
			continue;
		}
		const receipt = input.receipts.find((candidate) => receiptMatchesPending(candidate, pending));
		if (receipt) {
			const artifactStatus = input.artifactStatusByTransactionId[transactionId] ?? "unknown";
			if (artifactStatus === "matched") {
				completedTransactionIds.add(transactionId);
				continue;
			}
			unresolvedPendingIssues.push(issue(
				artifactStatus === "conflicting" ? "evidence-mismatch" : "completion-artifacts-not-arrived",
				transactionId,
				pending.body.originInstanceId,
				pending.filename,
				receipt.filename
			));
			continue;
		}
		const journal = input.journals.find((candidate) =>
			journalMatchesPending(candidate, pending, input.originInstanceId)
		);
		if (journal) {
			unresolvedPendingIssues.push(issue(
				"matching-journal-pending",
				transactionId,
				pending.body.originInstanceId,
				pending.filename,
				journal.filename
			));
			continue;
		}
		const sameTransactionJournal = input.journals.find((candidate) => candidate.body.transactionId === transactionId);
		unresolvedPendingIssues.push(issue(
			sameTransactionJournal ? "evidence-mismatch" : "pending-without-local-journal",
			transactionId,
			pending.body.originInstanceId,
			pending.filename,
			...(sameTransactionJournal ? [sameTransactionJournal.filename] : [])
		));
	}

	if (unresolvedPendingIssues.length > 1) {
		issues.push({
			kind: "multiple-unresolved-pending",
			filenames: unresolvedPendingIssues.flatMap((entry) => entry.filenames).sort(),
		});
	}
	issues.push(...unresolvedPendingIssues);

	for (const journal of input.journals) {
		if (conflictingReceiptTransactionIds.has(journal.body.transactionId)) {
			continue;
		}
		if (!matchesCurrentVault(input.vaultId, journal.body.vaultId)) {
			issues.push(issue("evidence-mismatch", journal.body.transactionId, journal.body.originInstanceId, journal.filename));
			continue;
		}
		const matchingPending = input.pending.some((candidate) =>
			journalMatchesPending(journal, candidate, input.originInstanceId)
		);
		if (matchingPending) {
			continue;
		}
		const matchingReceipt = input.receipts.find((candidate) => receiptMatchesJournal(candidate, journal));
		if (matchingReceipt && input.artifactStatusByTransactionId[journal.body.transactionId] === "matched") {
			completedTransactionIds.add(journal.body.transactionId);
			continue;
		}
		issues.push(issue(
			matchingReceipt ? "completion-artifacts-not-arrived" : "journal-without-pending",
			journal.body.transactionId,
			journal.body.originInstanceId,
			journal.filename,
			...(matchingReceipt ? [matchingReceipt.filename] : [])
		));
	}

	for (const receipt of input.receipts) {
		if (conflictingReceiptTransactionIds.has(receipt.body.transactionId)) {
			continue;
		}
		if (!matchesCurrentVault(input.vaultId, receipt.body.vaultId)) {
			issues.push(issue("evidence-mismatch", receipt.body.transactionId, receipt.body.originInstanceId, receipt.filename));
			continue;
		}
		if (completedTransactionIds.has(receipt.body.transactionId)) {
			continue;
		}
		const artifactStatus = input.artifactStatusByTransactionId[receipt.body.transactionId] ?? "unknown";
		if (artifactStatus === "matched") {
			completedTransactionIds.add(receipt.body.transactionId);
			continue;
		}
		if (!issues.some((entry) => entry.transactionId === receipt.body.transactionId)) {
			issues.push(issue(
				artifactStatus === "conflicting" ? "evidence-mismatch" : "completion-artifacts-not-arrived",
				receipt.body.transactionId,
				receipt.body.originInstanceId,
				receipt.filename
			));
		}
	}

	const uniqueIssues = dedupeIssues(issues);
	const primary = selectPrimaryIssue(uniqueIssues);
	if (primary) {
		return {
			kind: primary.kind,
			status: primary.kind === "matching-journal-pending" ? "reconciliation-required" : "blocked",
			issues: uniqueIssues,
			originInstanceIds: [...originInstanceIds].sort(),
			completedTransactionIds: [...completedTransactionIds].sort(),
		};
	}
	return {
		kind: completedTransactionIds.size > 0 ? "matching-completion-receipt" : "no-evidence",
		status: "clear",
		issues: [],
		originInstanceIds: [...originInstanceIds].sort(),
		completedTransactionIds: [...completedTransactionIds].sort(),
	};
}

function findConflictingReceiptTransactionIds(
	receipts: ScannedEvidence<CompletionReceiptEvidence>[]
): Set<string> {
	const fingerprintsByTransaction = new Map<string, Set<string>>();
	for (const receipt of receipts) {
		const fingerprints = fingerprintsByTransaction.get(receipt.body.transactionId) ?? new Set<string>();
		fingerprints.add(`${receipt.sha256}\0${canonicalizeJson(receipt.body)}`);
		fingerprintsByTransaction.set(receipt.body.transactionId, fingerprints);
	}
	return new Set(
		[...fingerprintsByTransaction]
			.filter(([, fingerprints]) => fingerprints.size > 1)
			.map(([transactionId]) => transactionId)
	);
}

export function planReceiptRetention(options: {
	receipts: ReceiptRetentionEntry[];
	pendingTransactionIds: ReadonlySet<string>;
	now: Date;
}): ReceiptRetentionPlan {
	const eligibleForCleanup: string[] = [];
	const protectedByPending: string[] = [];
	const tooYoung: string[] = [];
	const cutoff = options.now.getTime() - RECEIPT_MIN_RETENTION_DAYS * DAY_MILLISECONDS;

	for (const receipt of [...options.receipts].sort(compareReceipts)) {
		// Keep completion proof while delayed sync can still make its matching pending marker visible.
		if (options.pendingTransactionIds.has(receipt.transactionId)) {
			protectedByPending.push(receipt.filename);
			continue;
		}
		const completedAt = Date.parse(receipt.completedAt);
		if (!Number.isFinite(completedAt) || completedAt > cutoff) {
			tooYoung.push(receipt.filename);
			continue;
		}
		eligibleForCleanup.push(receipt.filename);
	}

	const limitReached = options.receipts.length >= RECEIPT_LIMIT;
	return {
		receiptCount: options.receipts.length,
		limit: RECEIPT_LIMIT,
		minimumRetentionDays: RECEIPT_MIN_RETENTION_DAYS,
		eligibleForCleanup,
		protectedByPending,
		tooYoung,
		canStartNewTransaction: !limitReached,
		limitReached,
		exhausted: limitReached && eligibleForCleanup.length === 0,
	};
}

function journalMatchesPending(
	journal: ScannedEvidence<RecoveryJournalEvidence>,
	pending: ScannedEvidence<PendingSentinelEvidence>,
	currentOriginInstanceId?: string
): boolean {
	return journal.body.transactionId === pending.body.transactionId
		&& journal.body.originInstanceId === pending.body.originInstanceId
		&& (currentOriginInstanceId === undefined || journal.body.originInstanceId === currentOriginInstanceId)
		&& journal.body.vaultId === pending.body.vaultId
		&& journal.sha256 === pending.body.journalSha256;
}

function receiptMatchesPending(
	receipt: ScannedEvidence<CompletionReceiptEvidence>,
	pending: ScannedEvidence<PendingSentinelEvidence>
): boolean {
	return receipt.body.transactionId === pending.body.transactionId
		&& receipt.body.originInstanceId === pending.body.originInstanceId
		&& receipt.body.vaultId === pending.body.vaultId
		&& receipt.body.journalSha256 === pending.body.journalSha256
		&& receipt.body.pendingSha256 === pending.sha256;
}

function receiptMatchesJournal(
	receipt: ScannedEvidence<CompletionReceiptEvidence>,
	journal: ScannedEvidence<RecoveryJournalEvidence>
): boolean {
	return receipt.body.transactionId === journal.body.transactionId
		&& receipt.body.originInstanceId === journal.body.originInstanceId
		&& receipt.body.vaultId === journal.body.vaultId
		&& receipt.body.journalSha256 === journal.sha256;
}

function matchesCurrentVault(currentVaultId: string | undefined, evidenceVaultId: string): boolean {
	return currentVaultId === undefined || currentVaultId === evidenceVaultId;
}

function issue(
	kind: StartupEvidenceIssue["kind"],
	transactionId: string,
	originInstanceId: string,
	...filenames: string[]
): StartupEvidenceIssue {
	return { kind, transactionId, originInstanceId, filenames: filenames.sort() };
}

function dedupeIssues(issues: StartupEvidenceIssue[]): StartupEvidenceIssue[] {
	const byKey = new Map<string, StartupEvidenceIssue>();
	for (const entry of issues) {
		const key = `${entry.kind}\0${entry.transactionId ?? ""}\0${entry.filenames.join("\0")}`;
		byKey.set(key, entry);
	}
	return [...byKey.values()];
}

function selectPrimaryIssue(issues: StartupEvidenceIssue[]): StartupEvidenceIssue | undefined {
	const priority: StartupEvidenceIssue["kind"][] = [
		"corrupt-evidence",
		"identity-conflict",
		"evidence-mismatch",
		"multiple-unresolved-pending",
		"receipt-retention-exhausted",
		"pending-without-local-journal",
		"journal-without-pending",
		"completion-artifacts-not-arrived",
		"matching-journal-pending",
	];
	return priority.map((kind) => issues.find((entry) => entry.kind === kind)).find(Boolean);
}

function compareReceipts(first: ReceiptRetentionEntry, second: ReceiptRetentionEntry): number {
	return first.completedAt.localeCompare(second.completedAt) || first.filename.localeCompare(second.filename);
}
