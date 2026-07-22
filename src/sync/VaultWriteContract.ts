import { KindleHighlight } from "../parser/parseClippings";
import { groupHighlightsByBook } from "../render/renderMarkdown";
import type { IgnoredHighlightCleanupSummary } from "./IgnoredHighlightCleanup";
import {
	createBookIdentityKey,
	createKindleHighlightIdentityKey,
} from "./HighlightIdentity";
import {
	createVaultWritePlan,
	VAULT_BOOK_PROTECTION_REASONS,
	VaultBookWriteOutcome,
	VaultWriteSummary,
} from "./VaultWriter";

export type VaultWriteContractErrorCode =
	| "summary-shape"
	| "outcome-count"
	| "duplicate-outcome"
	| "conflicting-outcome"
	| "outcome-order"
	| "book-title"
	| "book-author"
	| "note-path"
	| "outcome-status"
	| "protection-reason"
	| "duplicate-highlight-id"
	| "highlight-id-sequence"
	| "aggregate-mismatch";

export class InvalidVaultWriteContractError extends Error {
	readonly preservedIgnoreCleanupResults: IgnoredHighlightCleanupSummary[] = [];

	constructor(
		readonly code: VaultWriteContractErrorCode,
		readonly bookIndex?: number
	) {
		super("Kindle sync writer returned an invalid result contract.");
		this.name = "InvalidVaultWriteContractError";
	}

	retainIgnoreCleanupResult(result: IgnoredHighlightCleanupSummary): void {
		this.preservedIgnoreCleanupResults.push(result);
	}
}

export interface ValidatedHighlightWritePartition {
	writeSummary: VaultWriteSummary;
	safelyCompletedHighlights: KindleHighlight[];
	protectedHighlights: KindleHighlight[];
}

/**
 * Validates the complete writer result before exposing any per-book authorization.
 * A malformed contract rejects atomically because no individual outcome can be trusted.
 */
export function validateAndPartitionVaultWriteSummary(
	highlightsFolder: string,
	originalHighlights: readonly KindleHighlight[],
	summary: unknown
): ValidatedHighlightWritePartition {
	const normalizedSummary = normalizeVaultWriteSummary(summary);
	const expectedGroups = groupHighlightsByBook([...originalHighlights]);
	const writePlan = createVaultWritePlan(highlightsFolder, expectedGroups);

	validateOutcomes(writePlan.bookPlans, normalizedSummary.bookOutcomes);
	validateAggregates(writePlan, normalizedSummary);

	const statusByBookIdentity = new Map<string, VaultBookWriteOutcome["status"]>();

	for (const outcome of normalizedSummary.bookOutcomes) {
		statusByBookIdentity.set(
			createBookIdentityKey(outcome.bookTitle, outcome.author),
			outcome.status
		);
	}

	const safelyCompletedHighlights: KindleHighlight[] = [];
	const protectedHighlights: KindleHighlight[] = [];
	const seenHighlights = new Set<string>();

	for (const highlight of originalHighlights) {
		const highlightIdentity = createKindleHighlightIdentityKey(highlight);

		if (seenHighlights.has(highlightIdentity)) {
			continue;
		}

		seenHighlights.add(highlightIdentity);
		const status = statusByBookIdentity.get(
			createBookIdentityKey(highlight.bookTitle, highlight.author)
		);

		if (!status) {
			throw new InvalidVaultWriteContractError("outcome-count");
		}

		if (status === "protected") {
			protectedHighlights.push(highlight);
		} else {
			safelyCompletedHighlights.push(highlight);
		}
	}

	return {
		writeSummary: normalizedSummary,
		safelyCompletedHighlights,
		protectedHighlights,
	};
}

type VaultBookWritePlan = ReturnType<typeof createVaultWritePlan>["bookPlans"][number];

function validateOutcomes(
	expectedPlans: readonly VaultBookWritePlan[],
	outcomes: readonly VaultBookWriteOutcome[]
): void {
	if (!Array.isArray(outcomes) || outcomes.length !== expectedPlans.length) {
		throw new InvalidVaultWriteContractError("outcome-count");
	}

	const expectedIndexByBookIdentity = new Map<string, number>();
	const seenOutcomes = new Map<string, unknown>();

	for (const [index, plan] of expectedPlans.entries()) {
		expectedIndexByBookIdentity.set(
			createBookIdentityKey(plan.group.bookTitle, plan.group.author),
			index
		);
	}

	for (const [index, outcome] of outcomes.entries()) {
		if (!isRecord(outcome)) {
			throw new InvalidVaultWriteContractError("outcome-status", index);
		}

		const title = outcome.bookTitle;
		const author = outcome.author;
		const status = outcome.status;

		if (typeof title === "string" && typeof author === "string") {
			const identity = createBookIdentityKey(title, author);
			const previousStatus = seenOutcomes.get(identity);

			if (previousStatus !== undefined) {
				throw new InvalidVaultWriteContractError(
					previousStatus === status ? "duplicate-outcome" : "conflicting-outcome",
					index
				);
			}

			seenOutcomes.set(identity, status);
		}

		const expected = expectedPlans[index];

		if (!expected) {
			throw new InvalidVaultWriteContractError("outcome-count");
		}

		validateOutcomeIdentity(expected, outcome, index, expectedIndexByBookIdentity);
		validateOutcomeStatus(outcome, index);
		validateHighlightIds(expected.highlightIds, outcome.highlightIds, index);
	}
}

function validateOutcomeIdentity(
	expected: VaultBookWritePlan,
	outcome: Record<string, unknown>,
	index: number,
	expectedIndexByBookIdentity: ReadonlyMap<string, number>
): void {
	const title = outcome.bookTitle;
	const author = outcome.author;

	if (typeof title === "string" && typeof author === "string") {
		const actualExpectedIndex = expectedIndexByBookIdentity.get(createBookIdentityKey(title, author));

		if (actualExpectedIndex !== undefined && actualExpectedIndex !== index) {
			throw new InvalidVaultWriteContractError("outcome-order", index);
		}
	}

	if (title !== expected.group.bookTitle) {
		throw new InvalidVaultWriteContractError("book-title", index);
	}

	if (author !== expected.group.author) {
		throw new InvalidVaultWriteContractError("book-author", index);
	}

	if (outcome.notePath !== expected.notePath) {
		throw new InvalidVaultWriteContractError("note-path", index);
	}
}

function validateOutcomeStatus(outcome: Record<string, unknown>, index: number): void {
	const status = outcome.status;

	if (status !== "created" && status !== "updated" && status !== "confirmed" && status !== "protected") {
		throw new InvalidVaultWriteContractError("outcome-status", index);
	}

	if (status === "protected") {
		if (!VAULT_BOOK_PROTECTION_REASONS.some((reason) => reason === outcome.reason)) {
			throw new InvalidVaultWriteContractError("protection-reason", index);
		}

		return;
	}

	if ("reason" in outcome) {
		throw new InvalidVaultWriteContractError("conflicting-outcome", index);
	}
}

function validateHighlightIds(
	expectedIds: readonly string[],
	actualValue: unknown,
	index: number
): void {
	if (!Array.isArray(actualValue)) {
		throw new InvalidVaultWriteContractError("highlight-id-sequence", index);
	}

	const actualIds: string[] = [];

	// Array iteration helpers skip sparse holes, so validate ownership at every numeric index.
	for (let idIndex = 0; idIndex < actualValue.length; idIndex++) {
		if (!Object.prototype.hasOwnProperty.call(actualValue, idIndex)) {
			throw new InvalidVaultWriteContractError("highlight-id-sequence", index);
		}

		const id = actualValue[idIndex] as unknown;

		if (typeof id !== "string") {
			throw new InvalidVaultWriteContractError("highlight-id-sequence", index);
		}

		actualIds.push(id);
	}

	if (new Set(actualIds).size !== actualIds.length) {
		throw new InvalidVaultWriteContractError("duplicate-highlight-id", index);
	}

	if (actualIds.length !== expectedIds.length
		|| actualIds.some((id, idIndex) => id !== expectedIds[idIndex])) {
		throw new InvalidVaultWriteContractError("highlight-id-sequence", index);
	}
}

function normalizeVaultWriteSummary(summary: unknown): VaultWriteSummary {
	if (!isRecord(summary) || Array.isArray(summary)) {
		throw new InvalidVaultWriteContractError("summary-shape");
	}

	const aggregateFields = [
		"books",
		"filesCreated",
		"filesUpdated",
		"filesUnchanged",
		"filesProtected",
		"highlightsRendered",
		"duplicatesSkipped",
	] as const;

	if (!Object.prototype.hasOwnProperty.call(summary, "bookOutcomes")
		|| !Array.isArray(summary.bookOutcomes)) {
		throw new InvalidVaultWriteContractError("summary-shape");
	}

	for (const field of aggregateFields) {
		if (!Object.prototype.hasOwnProperty.call(summary, field)) {
			throw new InvalidVaultWriteContractError("summary-shape");
		}

		const value = summary[field];

		if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
			throw new InvalidVaultWriteContractError("summary-shape");
		}
	}

	return summary as unknown as VaultWriteSummary;
}

function validateAggregates(
	writePlan: ReturnType<typeof createVaultWritePlan>,
	summary: VaultWriteSummary
): void {
	const expected = {
		books: writePlan.bookPlans.length,
		filesCreated: summary.bookOutcomes.filter((outcome) => outcome.status === "created").length,
		filesUpdated: summary.bookOutcomes.filter((outcome) => outcome.status === "updated").length,
		filesUnchanged: summary.bookOutcomes.filter((outcome) => outcome.status === "confirmed").length,
		filesProtected: summary.bookOutcomes.filter((outcome) => outcome.status === "protected").length,
		highlightsRendered: writePlan.highlightsRendered,
		duplicatesSkipped: writePlan.duplicatesSkipped,
	};

	for (const [field, expectedValue] of Object.entries(expected)) {
		if (summary[field as keyof typeof expected] !== expectedValue) {
			throw new InvalidVaultWriteContractError("aggregate-mismatch");
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
