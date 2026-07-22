import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import {
	groupHighlightsByBook,
} from "../render/renderMarkdown";
import {
	createVaultWritePlan,
	VaultBookWriteOutcome,
	VaultWriteSummary,
} from "./VaultWriter";
import {
	InvalidVaultWriteContractError,
	validateAndPartitionVaultWriteSummary,
	VaultWriteContractErrorCode,
} from "./VaultWriteContract";

const HIGHLIGHTS_FOLDER = "Kindle Highlights";

describe("validateAndPartitionVaultWriteSummary", () => {
	it("accepts a complete full-success contract", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input, ["created", "confirmed"]);

		const result = validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, input, summary);

		expect(result.safelyCompletedHighlights).toEqual([input[0], input[1], input[3]]);
		expect(result.protectedHighlights).toEqual([]);
	});

	it("accepts dense valid highlight ID arrays", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		expect(summary.bookOutcomes[0]!.highlightIds).toHaveLength(2);
		expect(validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, input, summary))
			.toMatchObject({ protectedHighlights: [] });
	});

	it("authorizes or protects complete books while preserving meaningful input order", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input, ["updated", "protected"]);

		const result = validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, input, summary);

		expect(result.safelyCompletedHighlights).toEqual([input[0], input[3]]);
		expect(result.protectedHighlights).toEqual([input[1]]);
	});

	it("accepts the exact empty contract", () => {
		const summary = createValidSummary([]);

		expect(validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, [], summary)).toMatchObject({
			safelyCompletedHighlights: [],
			protectedHighlights: [],
		});
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["number", 1],
		["string", "invalid"],
		["boolean", false],
		["array", []],
		["empty object", {}],
		["partial object", { bookOutcomes: [] }],
		["malformed counter", {
			books: "0",
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 0,
			filesProtected: 0,
			highlightsRendered: 0,
			duplicatesSkipped: 0,
			bookOutcomes: [],
		}],
	] as const)("rejects a malformed top-level %s summary with a contract error", (_label, summary) => {
		expectContractError([], summary, "summary-shape");
	});

	it("uses the shared deterministic allocator for sanitized path collisions", () => {
		const input = [
			createHighlight({ bookTitle: "Shared/Title", author: "Author", content: "First" }),
			createHighlight({ bookTitle: "Shared:Title", author: "Author", content: "Second" }),
		];
		const summary = createValidSummary(input, ["created", "created"]);

		expect(summary.bookOutcomes.map((outcome) => outcome.notePath)).toEqual([
			"Kindle Highlights/Shared Title - Author.md",
			"Kindle Highlights/Shared Title - Author 2.md",
		]);
		expect(validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, input, summary))
			.toMatchObject({ safelyCompletedHighlights: input, protectedHighlights: [] });
	});

	it("rejects a missing outcome", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes.pop();

		expectContractError(input, summary, "outcome-count");
	});

	it("rejects an extra outcome", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes.push({ ...summary.bookOutcomes[0]! });

		expectContractError(input, summary, "outcome-count");
	});

	it("rejects a duplicate outcome", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes[1] = { ...summary.bookOutcomes[0]! };

		expectContractError(input, summary, "duplicate-outcome");
	});

	it("rejects conflicting safe and protected outcomes for one book", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);
		const first = summary.bookOutcomes[0]!;

		summary.bookOutcomes[1] = {
			bookTitle: first.bookTitle,
			author: first.author,
			notePath: first.notePath,
			highlightIds: [...first.highlightIds],
			status: "protected",
			reason: "existing-highlights-not-retained",
		};

		expectContractError(input, summary, "conflicting-outcome");
	});

	it("rejects an incomplete highlight ID sequence", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.highlightIds.pop();

		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects an extra highlight ID", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.highlightIds.push("kls-extra");

		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects a duplicate highlight ID", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);
		const firstId = summary.bookOutcomes[0]!.highlightIds[0]!;

		summary.bookOutcomes[0]!.highlightIds.push(firstId);

		expectContractError(input, summary, "duplicate-highlight-id");
	});

	it("rejects a wrong highlight ID", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.highlightIds[0] = "kls-wrong";

		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects a wrong title", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.bookTitle = "Wrong title";

		expectContractError(input, summary, "book-title");
	});

	it("rejects a wrong author", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.author = "Wrong author";

		expectContractError(input, summary, "book-author");
	});

	it("rejects a wrong allocated note path", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input);

		summary.bookOutcomes[0]!.notePath = "Kindle Highlights/Wrong.md";

		expectContractError(input, summary, "note-path");
	});

	it("rejects reordered outcomes", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);

		summary.bookOutcomes.reverse();

		expectContractError(input, summary, "outcome-order");
	});

	it("rejects an unknown status", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input);

		(summary.bookOutcomes[0] as unknown as { status: string }).status = "failed";

		expectContractError(input, summary, "outcome-status");
	});

	it("rejects an invalid protection reason", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input, ["protected"]);

		(summary.bookOutcomes[0] as unknown as { reason: string }).reason = "invalid-reason";

		expectContractError(input, summary, "protection-reason");
	});

	it("rejects a protected outcome with no protection reason property", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input, ["protected"]);
		const outcome = summary.bookOutcomes[0] as unknown as { reason?: string };

		delete outcome.reason;

		expectContractError(input, summary, "protection-reason");
	});

	it("rejects a safe outcome carrying a conflicting protection reason", () => {
		const input = [createHighlight()];
		const summary = createValidSummary(input);

		(summary.bookOutcomes[0] as unknown as { reason: string }).reason = "unsafe-existing-managed-region";

		expectContractError(input, summary, "conflicting-outcome");
	});

	it("rejects two otherwise valid dense IDs swapped out of order", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);
		const ids = summary.bookOutcomes[0]!.highlightIds;
		const first = ids[0]!;
		const second = ids[1]!;

		ids[0] = second;
		ids[1] = first;

		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects a sparse trailing highlight ID position", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);
		const denseIds = summary.bookOutcomes[0]!.highlightIds;
		const ids = new Array<string>(2);

		ids[0] = denseIds[0]!;
		summary.bookOutcomes[0]!.highlightIds = ids;

		expect(ids).toHaveLength(2);
		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects a sparse first highlight ID position", () => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input);
		const denseIds = summary.bookOutcomes[0]!.highlightIds;
		const ids = new Array<string>(2);

		ids[1] = denseIds[1]!;
		summary.bookOutcomes[0]!.highlightIds = ids;

		expect(ids).toHaveLength(2);
		expectContractError(input, summary, "highlight-id-sequence");
	});

	it("rejects a sparse middle position in a longer highlight ID array", () => {
		const input = [
			createHighlight({ content: "First", location: "1" }),
			createHighlight({ content: "Second", location: "2" }),
			createHighlight({ content: "Third", location: "3" }),
		];
		const summary = createValidSummary(input);
		const denseIds = summary.bookOutcomes[0]!.highlightIds;
		const ids = new Array<string>(3);

		ids[0] = denseIds[0]!;
		ids[2] = denseIds[2]!;
		summary.bookOutcomes[0]!.highlightIds = ids;

		expect(ids).toHaveLength(3);
		expectContractError(input, summary, "highlight-id-sequence");
	});

	it.each([
		"books",
		"filesCreated",
		"filesUpdated",
		"filesUnchanged",
		"filesProtected",
		"highlightsRendered",
		"duplicatesSkipped",
	] as const)("rejects an inconsistent %s aggregate", (field) => {
		const input = createInterleavedInput();
		const summary = createValidSummary(input, ["created", "protected"]);

		summary[field]++;

		expectContractError(input, summary, "aggregate-mismatch");
	});
});

function createValidSummary(
	highlights: KindleHighlight[],
	statuses: Array<VaultBookWriteOutcome["status"]> = []
): VaultWriteSummary {
	const plan = createVaultWritePlan(HIGHLIGHTS_FOLDER, groupHighlightsByBook(highlights));
	const bookOutcomes = plan.bookPlans.map((bookPlan, index): VaultBookWriteOutcome => {
		const status = statuses[index] ?? "updated";
		const base = {
			bookTitle: bookPlan.group.bookTitle,
			author: bookPlan.group.author,
			notePath: bookPlan.notePath,
			highlightIds: [...bookPlan.highlightIds],
		};

		return status === "protected"
			? { ...base, status, reason: "existing-highlights-not-retained" }
			: { ...base, status };
	});

	return {
		books: plan.bookPlans.length,
		filesCreated: bookOutcomes.filter((outcome) => outcome.status === "created").length,
		filesUpdated: bookOutcomes.filter((outcome) => outcome.status === "updated").length,
		filesUnchanged: bookOutcomes.filter((outcome) => outcome.status === "confirmed").length,
		filesProtected: bookOutcomes.filter((outcome) => outcome.status === "protected").length,
		highlightsRendered: plan.highlightsRendered,
		duplicatesSkipped: plan.duplicatesSkipped,
		bookOutcomes,
	};
}

function expectContractError(
	highlights: KindleHighlight[],
	summary: unknown,
	code: VaultWriteContractErrorCode
): void {
	try {
		validateAndPartitionVaultWriteSummary(HIGHLIGHTS_FOLDER, highlights, summary);
		throw new Error("Expected the writer contract to be rejected.");
	} catch (error) {
		expect(error).toBeInstanceOf(InvalidVaultWriteContractError);
		expect((error as InvalidVaultWriteContractError).code).toBe(code);
	}
}

function createInterleavedInput(): KindleHighlight[] {
	const first = createHighlight({ content: "First A", location: "1" });
	const secondBook = createHighlight({
		bookTitle: "Book B",
		author: "Author B",
		content: "First B",
		location: "2",
	});
	const secondInFirstBook = createHighlight({ content: "Second A", location: "3" });

	return [first, secondBook, { ...first }, secondInFirstBook];
}

function createHighlight(overrides: Partial<KindleHighlight> = {}): KindleHighlight {
	return {
		bookTitle: "Book A",
		author: "Author A",
		location: "1",
		content: "Highlight",
		dateAdded: "Date",
		type: "Highlight",
		...overrides,
	};
}
