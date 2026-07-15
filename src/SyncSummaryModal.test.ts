import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import type { HighlightImportResult } from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, groupHighlightsByBook } from "./render/renderMarkdown";
import { IgnoredHighlight } from "./settings";
import { SyncClassification } from "./sync/SyncClassifier";
import {
	createBookIdentityKey,
	createKindleHighlightIdentityKey,
	CurrentClippingIdentityIndex,
} from "./sync/HighlightIdentity";
import {
	IgnoredHighlightCleanupSummary,
	IgnoredHighlightCleanupTargetOutcome,
} from "./sync/IgnoredHighlightCleanup";
import { createVaultWritePlan, VaultBookWriteOutcome } from "./sync/VaultWriter";
import { InvalidVaultWriteContractError } from "./sync/VaultWriteContract";
import {
	createEmptyIgnoreResultsPresentation,
	createIgnoreResultsPresentation,
	createProtectedBooksPresentation,
	IgnoreResultsPresentation,
	ProtectedBooksPresentation,
} from "./SyncOutcomePresentation";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

let SyncSummaryModal: typeof import("./SyncSummaryModal").SyncSummaryModal;

beforeAll(async () => {
	SyncSummaryModal = (await import("./SyncSummaryModal")).SyncSummaryModal;
});

describe("SyncSummaryModal ignored highlights navigation", () => {
	it("retains only the UI-safe initial Ignore presentation", () => {
		const cleanupResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [],
		};
		const ignoreResults = createIgnoreResultsPresentation([cleanupResult]);
		const modal = createModal({ ignoreResults });

		expect((modal as unknown as {
			ignoreResults: IgnoreResultsPresentation;
		}).ignoreResults).toEqual(ignoreResults);
		expect(JSON.stringify(modal)).not.toContain("filesScanned");
	});

	it("explains that unreviewed or skipped highlights return on the next sync", () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"Unreviewed or skipped highlights will appear again next time you sync."
		);
	});

	it("uses shared modal action button styling in the summary action row", () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
				possibleReappearedHighlights: [createHighlight()],
			}),
			skippedThisSyncHighlights: [createSummaryItem()],
			protectedBooks: createProtectedBooksPresentation([createHighlight()], []),
			ignoreResults: createIgnoreResultsPresentation([
				createCleanupResult([createAllCleanupOutcomes()[0]!]),
			]),
		});

		modal.onOpen();
		const actionRow = elementByClass(modal.contentEl, "kls-summary-actions");
		const actionButtons = elementsByClass(actionRow, "kls-action-button");

		expect(elementsByClass(modal.contentEl, "kls-glass-scope")).toHaveLength(1);
		expect(elementsByClass(modal.contentEl, "kls-summary-actions")).toHaveLength(1);
		expect(actionRow.classes.has("kls-button-row")).toBe(true);
		expect(actionButtons.map((button) => button.text())).toEqual([
			"Review Missing Managed Highlights",
			"View Books Left Unchanged",
			"Review Ignore Results",
			"View Ignored Highlights",
			"Review Skipped This Sync",
			"Close",
		]);
		expect(actionButtons.every((button) => button.classes.has("kls-glass-subtle"))).toBe(true);
		expect(elementsByClass(modal.contentEl, "kls-glass-strong")).toHaveLength(0);
		expect(findByText(actionRow, "Close").classes.has("mod-cta")).toBe(false);
		expect(findByText(actionRow, "Close").classes.has("mod-warning")).toBe(false);
	});

	it("uses subtle glass for safe recovery actions while Ignore and Skip remain native", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		const reviewButton = findByText(modal.contentEl, "Review Missing Managed Highlights");

		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
		await reviewButton.click();

		const backButton = findByText(modal.contentEl, "Back to Summary");
		const importButton = findByText(modal.contentEl, "Import Again");
		const ignoreButton = findByText(modal.contentEl, "Ignore Going Forward");
		const skipButton = findByText(modal.contentEl, "Skip This Time");

		expect(backButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(importButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(ignoreButton.classes.has("mod-warning")).toBe(true);
		expectNativeGlassTreatment(ignoreButton);
		expectNativeGlassTreatment(skipButton);
	});

	it("keeps Remove and Ignore actions native while their navigation and Cancel actions use subtle glass", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();

		expect(findByText(modal.contentEl, "Back to Summary").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Review Highlights").classes.has("kls-glass-subtle")).toBe(true);
		expectNativeGlassTreatment(findByText(modal.contentEl, "Remove All From Ignore List"));

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(findByText(modal.contentEl, "Back to Ignored Highlights").classes.has("kls-glass-subtle")).toBe(true);
		expectNativeGlassTreatment(findByText(modal.contentEl, "Remove From Ignore List"));

		await findByText(modal.contentEl, "Back to Ignored Highlights").click();
		await findByText(modal.contentEl, "Back to Summary").click();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(findByText(modal.contentEl, "Back to Summary").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Review Highlights").classes.has("kls-glass-subtle")).toBe(true);
		const ignoreAllButton = findByText(modal.contentEl, "Ignore All Highlights");

		expectNativeGlassTreatment(ignoreAllButton);
		await ignoreAllButton.click();

		const cancelButton = findByText(modal.contentEl, "Cancel");
		const confirmIgnoreButton = findByText(modal.contentEl, "Ignore All Highlights");

		expect(cancelButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(confirmIgnoreButton.classes.has("mod-warning")).toBe(true);
		expectNativeGlassTreatment(confirmIgnoreButton);
	});

	it("uses Title Case button labels in Sync Summary", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
				possibleReappearedHighlights: [createHighlight()],
			}),
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Review Missing Managed Highlights",
			"View Ignored Highlights",
			"Review Skipped This Sync",
			"Close",
		]));

		await findByText(modal.contentEl, "View Ignored Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back to Summary",
			"Review Highlights",
			"Remove All From Ignore List",
		]));

		await findByText(modal.contentEl, "Back to Summary").click();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back to Summary",
			"Review Highlights",
			"Ignore All Highlights",
		]));

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back to Skipped Books",
			"Ignore Going Forward",
		]));
	});

	it("shows View Ignored Highlights when ignored highlights were skipped", () => {
		const modal = createModal({
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("View Ignored Highlights");
	});

	it("renders ignored highlights grouped by book when clicked", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [
					createIgnoredHighlight(),
					createIgnoredHighlight({ id: "kls-ignored-two", textPreview: "Second ignored highlight." }),
					createIgnoredHighlight({ id: "kls-ignored-three", title: "Deep Work", textPreview: "Deep focus matters." }),
				],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("2 ignored highlights");
		expect(readText(modal.contentEl)).toContain("Deep Work");
		expect(readText(modal.contentEl)).toContain("1 ignored highlight");
		expect(readText(modal.contentEl)).not.toContain("Small habits make a big difference.");
		expect(readText(modal.contentEl)).not.toContain("Second ignored highlight.");
		expect(readText(modal.contentEl)).not.toContain("Deep focus matters.");
	});

	it("shows Back to Summary in ignored highlights view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("Back to Summary");
	});

	it("returns to summary when Back to Summary is clicked", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
	});

	it("uses shared book card structure in ignored highlights view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();

		const card = elementByClass(modal.contentEl, "kls-book-card");
		const header = elementByClass(card, "kls-book-header");

		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
		expect(card.classes.has("kls-book-section")).toBe(true);
		expect(elementByClass(header, "kls-book-title").text()).toBe("Atomic Habits");
		expect(elementByClass(card, "kls-book-review-summary").text()).toBe("1 ignored highlight");
		expect(elementsByClass(card, "kls-ignored-highlight-text")).toHaveLength(0);
		expect(elementsByClass(modal.contentEl, "kls-ignored-highlight-item")).toHaveLength(0);
		expect(elementsByClass(header, "kls-action-button").map((button) => button.text())).toEqual([
			"Review Highlights",
		]);
		const actions = elementByClass(card, "kls-book-actions");
		expect(actions.classes.has("kls-button-row")).toBe(true);
		expect(elementsByClass(actions, "kls-action-button").map((button) => button.text())).toEqual([
			"Remove All From Ignore List",
		]);
		expect(findByText(actions, "Remove All From Ignore List").classes.has("mod-cta")).toBe(false);
		expect(findByText(actions, "Remove All From Ignore List").classes.has("mod-warning")).toBe(false);
	});

	it("removes all ignored highlights for a book from the ignored highlights summary", async () => {
		const plugin = createPlugin({
			ignoredHighlights: [
				createIgnoredHighlight({ id: "one", title: "Atomic Habits" }),
				createIgnoredHighlight({ id: "two", title: "Atomic Habits", textPreview: "Second ignored highlight." }),
				createIgnoredHighlight({ id: "three", title: "Deep Work" }),
			],
		});
		const modal = createModal({
			plugin,
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, "Atomic Habits"), "Remove All From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
		expect(plugin.unignoreHighlight).not.toHaveBeenCalledWith(expect.objectContaining({ id: "three" }));
		expect(readText(modal.contentEl)).not.toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("Deep Work");
	});

	it("shows the ignored empty state after removing all ignored highlights from the last book", async () => {
		const plugin = createPlugin({
			ignoredHighlights: [createIgnoredHighlight()],
		});
		const modal = createModal({
			plugin,
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Remove All From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "kls-ignored" }));
		expect(readText(modal.contentEl)).toContain(
			"No ignored highlights. Highlights you ignore during sync will appear here."
		);
	});

	it("opens ignored highlight detail view from a book card", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("Back to Ignored Highlights");
		const detailCard = elementByClass(modal.contentEl, "kls-ignored-detail-card");
		expect(elementByClass(detailCard, "kls-book-title").text()).toBe("Atomic Habits");
		expect(elementByClass(detailCard, "kls-book-review-summary").text()).toBe("1 ignored highlight");
		expect(elementByClass(detailCard, "kls-book-meta").text()).toBe("Ignored 7/9/2026");
		expect(elementByClass(detailCard, "kls-ignored-highlight-text").text()).toBe("Small habits make a big difference.");
		expect(buttonTexts(modal.contentEl)).toContain("Remove From Ignore List");
	});

	it("keeps the ignored detail book title inside the detail card", async () => {
		const longTitle = "A Very Long Atomic Habits Title That Should Wrap Cleanly In The Detail Card";
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight({ title: longTitle })],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const detailHeader = elementByClass(modal.contentEl, "kls-ignored-detail-header");
		const detailCard = elementByClass(modal.contentEl, "kls-ignored-detail-card");

		expect(elementsByClass(detailHeader, "kls-book-title")).toHaveLength(0);
		expect(elementByClass(detailCard, "kls-book-title").text()).toBe(longTitle);
	});

	it("removes an ignored highlight when Remove From Ignore List is clicked", async () => {
		const plugin = createPlugin({
			ignoredHighlights: [createIgnoredHighlight()],
		});
		const modal = createModal({
			plugin,
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Remove From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "kls-ignored" }));
		expect(readText(modal.contentEl)).toContain("No ignored highlights left in this book.");
	});

	it("returns from ignored detail view to ignored summary view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Back to Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("1 ignored highlight");
		expect(readText(modal.contentEl)).not.toContain("Small habits make a big difference.");
		expect(buttonTexts(modal.contentEl)).toContain("Review Highlights");
	});
});

describe("SyncSummaryModal skipped-this-sync navigation", () => {
	it("shows Review Skipped This Sync when skippedThisSyncHighlights exist", () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Review Skipped This Sync");
	});

	it("renders skipped books grouped by title", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "Atomic Habits" }),
				createSummaryItem({ id: "two", title: "Atomic Habits", textPreview: "Second highlight." }),
				createSummaryItem({ id: "three", title: "Deep Work" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(readText(modal.contentEl)).toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("2 highlights skipped this sync");
		expect(readText(modal.contentEl)).toContain("Deep Work");
	});

	it("uses the shared book card structure in skipped books review rows", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		const card = elementByClass(modal.contentEl, "kls-book-card");
		const header = elementByClass(card, "kls-book-header");
		const title = elementByClass(header, "kls-book-title");
		const actions = elementByClass(card, "kls-book-actions");

		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
		expect(card.classes.has("kls-book-section")).toBe(true);
		expect(title.text()).toBe("Atomic Habits");
		expect(elementByClass(card, "kls-book-review-summary").text()).toBe("1 highlight skipped this sync");
		expect(elementsByClass(header, "kls-action-button").map((button) => button.text())).toEqual([
			"Review Highlights",
		]);
		expect(actions.classes.has("kls-button-row")).toBe(true);
		expect(elementsByClass(actions, "kls-action-button").map((button) => button.text())).toEqual([
			"Ignore All Highlights",
		]);
	});

	it("uses shared button row styling in skipped books review actions", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		const card = elementByClass(modal.contentEl, "kls-book-card");
		const header = elementByClass(card, "kls-book-header");
		const actions = elementByClass(card, "kls-book-actions");

		expect(header.classes.has("kls-button-row")).toBe(false);
		expect(actions.classes.has("kls-button-row")).toBe(true);
		expect(findByText(header, "Review Highlights").classes.has("kls-action-button")).toBe(true);
		expect(findByText(actions, "Ignore All Highlights").classes.has("kls-action-button")).toBe(true);
	});

	it("shows Back to Summary in skipped books view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(readText(modal.contentEl)).toContain("Back to Summary");
	});

	it("returns to summary when Back to Summary is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
	});

	it("renders per-book skipped highlight review when Review Highlights is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(readText(modal.contentEl)).toContain("Small habits make a big difference.");
		expect(readText(modal.contentEl)).toContain("Ignore Going Forward");
	});

	it("uses shared button classes in per-book skipped highlight review", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const row = elementByClass(modal.contentEl, "kls-highlight-row");
		const buttonRow = elementByClass(row, "kls-button-row");

		expect(elementsByClass(buttonRow, "kls-action-button").map((button) => button.text())).toEqual([
			"Ignore Going Forward",
		]);
	});

	it("shows Back to Skipped Books in per-book review", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(readText(modal.contentEl)).toContain("Back to Skipped Books");
	});

	it("returns to skipped books when Back to Skipped Books is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(readText(modal.contentEl)).toContain("1 highlight skipped this sync");
	});

	it("adds a skipped highlight to ignoredHighlights when Ignore Going Forward is clicked", async () => {
		const plugin = createPlugin();
		const highlight = createSummaryItem();
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: [highlight],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(
			highlight,
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("removes the highlight row after Ignore Going Forward", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(readText(modal.contentEl)).not.toContain("Small habits make a big difference.");
		expect(readText(modal.contentEl)).toContain("No skipped highlights left in this book.");
	});

	it("opens confirmation before ignoring all skipped highlights from a book", async () => {
		const plugin = createPlugin();
		const highlights = [
			createSummaryItem({ id: "one" }),
			createSummaryItem({ id: "two", textPreview: "Second highlight." }),
		];
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: highlights,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignore all skipped highlights from this book?");
		expect(readText(modal.contentEl)).toContain(
			"These highlights will be ignored in future syncs. You can restore them later from the ignored highlights view."
		);
		expect(buttonTexts(modal.contentEl)).toEqual(["Cancel", "Ignore All Highlights"]);
		expect(plugin.ignoreSummaryHighlight).not.toHaveBeenCalled();
	});

	it("leaves skipped highlights unchanged when Ignore All Highlights confirmation is canceled", async () => {
		const plugin = createPlugin();
		const highlights = [
			createSummaryItem({ id: "one" }),
			createSummaryItem({ id: "two", textPreview: "Second highlight." }),
		];
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: highlights,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(plugin.ignoreSummaryHighlight).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(readText(modal.contentEl)).toContain("2 highlights skipped this sync");
	});

	it("adds all skipped highlights from a book to ignoredHighlights after confirmation", async () => {
		const plugin = createPlugin();
		const highlights = [
			createSummaryItem({ id: "one" }),
			createSummaryItem({ id: "two", textPreview: "Second highlight." }),
		];
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: highlights,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(
			highlights[0],
			expect.any(CurrentClippingIdentityIndex)
		);
		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(
			highlights[1],
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("keeps a colliding skipped item from another book after Ignore Going Forward", async () => {
		const plugin = createPlugin();
		const bookA = createCollisionHighlight("Collision 1h0o65e 20hu");
		const bookB = createCollisionHighlight("Collision 1y0rlvz 2269");
		const itemA = createSummaryItem({
			id: createClippingId(bookA),
			title: bookA.bookTitle,
			author: bookA.author,
		});
		const itemB = createSummaryItem({
			id: createClippingId(bookB),
			title: bookB.bookTitle,
			author: bookB.author,
		});
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: [itemA, itemB],
		});

		expect(itemA.id).toBe(itemB.id);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(bookCardByTitle(modal.contentEl, itemA.title), "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(
			itemA,
			expect.any(CurrentClippingIdentityIndex)
		);
		expect(readText(modal.contentEl)).not.toContain(itemA.title);
		expect(readText(modal.contentEl)).toContain(itemB.title);
	});

	it("shows empty state when all skipped highlights are handled", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(readText(modal.contentEl)).toContain("No skipped highlights left to review.");
	});
});

describe("SyncSummaryModal protected-book outcomes", () => {
	it("omits protected outcome UI when no book was protected", () => {
		const modal = createModal();

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("Some books were left unchanged");
		expect(buttonTexts(modal.contentEl)).not.toContain("View Books Left Unchanged");
	});

	it("shows singular selected-import copy and the neutral protected panel", () => {
		const selected = createHighlight();
		const modal = createModal({
			protectedBooks: createProtectedBooksPresentation([selected], [selected]),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).toContain("Some books were left unchanged");
		expect(readText(modal.contentEl)).toContain(
			"1 existing book note was left unchanged because it could not be updated safely."
		);
		expect(readText(modal.contentEl)).toContain(
			"1 selected highlight was not imported and will be available for review next time."
		);
		expect(elementsByClass(modal.contentEl, "kls-outcome-panel")).toHaveLength(1);
		expect(buttonTexts(modal.contentEl)).toContain("View Books Left Unchanged");
	});

	it("shows automatic-history copy without describing selected new imports", async () => {
		const automatic = [
			createHighlight(),
			createHighlight({ bookTitle: "Deep Work", author: "Cal Newport" }),
		];
		const modal = createModal({
			protectedBooks: createProtectedBooksPresentation(automatic, []),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).toContain(
			"2 existing book notes were left unchanged because they could not be updated safely."
		);
		expect(readText(modal.contentEl)).toContain("Their existing imported history was kept.");
		expect(readText(modal.contentEl)).not.toContain("selected highlight");

		await findByText(modal.contentEl, "View Books Left Unchanged").click();
		expect(readText(modal.contentEl)).toContain("Existing imported history was kept for this book.");
		expect(readText(modal.contentEl)).not.toContain("selected highlight");
	});

	it("renders long protected-book details with only Back and Close, then restores summary scroll", async () => {
		const highlights = Array.from({ length: 24 }, (_, index) => createHighlight({
			bookTitle: `Book ${index + 1}`,
			author: `Author ${index + 1}`,
			content: `Highlight ${index + 1}`,
		}));
		const modal = createModal({
			protectedBooks: createProtectedBooksPresentation(highlights, [highlights[0]!]),
		});
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();
		setScrollTop(modal.contentEl, 510);
		await findByText(modal.contentEl, "View Books Left Unchanged").click();

		expect(readText(modal.contentEl)).toContain("Books left unchanged");
		expect(elementsByClass(modal.contentEl, "kls-book-card")).toHaveLength(24);
		expect(readText(modal.contentEl)).toContain("Author: Author 24");
		expect(readText(modal.contentEl)).toContain("1 affected highlight");
		expect(readText(modal.contentEl)).toContain("1 selected highlight returning for review");
		expect(readText(modal.contentEl)).toContain("Existing imported history was kept for this book.");
		expect(readText(modal.contentEl)).not.toContain("0 selected highlights returning for review");
		expect(buttonTexts(modal.contentEl)).toEqual(["Back", "Close"]);
		for (const label of ["Back", "Close"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-glass-subtle")).toBe(true);
			expect(button.classes.has("kls-glass-strong")).toBe(false);
		}
		expect(readText(modal.contentEl)).not.toMatch(
			/kls-|kindle-local-sync|unsafe-existing-managed-region|notePath|collision|marker/i
		);

		await findByText(modal.contentEl, "Close").click();
		expect(closeSpy).toHaveBeenCalledTimes(1);
		await findByText(modal.contentEl, "Back").click();
		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(scrollTop(modal.contentEl)).toBe(510);
	});
});

describe("SyncSummaryModal Ignore outcomes", () => {
	it("omits Ignore result UI when there are no current target outcomes", () => {
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createEmptyCleanupResult()]),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).not.toContain("Ignore results");
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Ignore Results");
	});

	it("renders every approved non-technical cleanup result in original order", async () => {
		const outcomes = createAllCleanupOutcomes();
		const presentation = createIgnoreResultsPresentation([
			createCleanupResult(outcomes),
		]);
		const modal = createModal({ ignoreResults: presentation });

		modal.onOpen();
		await findByText(modal.contentEl, "Review Ignore Results").click();
		const text = readText(modal.contentEl);
		const approvedCopy = [
			"This highlight was removed from the matching note.",
			"No matching note was found. No existing note was changed.",
			"This highlight was already absent from the matching note. No note change was needed.",
			"More than one note matched this book, so the existing notes were left unchanged.",
			"The existing note could not be updated safely, so it was left unchanged.",
			"The existing note could not be updated. It may still contain this highlight.",
			"We couldn’t confirm whether the existing note changed. Check the note before trying again.",
		];

		expect(elementsByClass(modal.contentEl, "kls-book-card")).toHaveLength(7);
		for (const copy of approvedCopy) {
			expect(text).toContain(copy);
		}
		expect(approvedCopy.map((copy) => text.indexOf(copy))).toEqual(
			[...approvedCopy].map((copy) => text.indexOf(copy)).sort((left, right) => left - right)
		);
		expect(buttonTexts(modal.contentEl)).toEqual(["Back", "Close"]);
		for (const label of ["Back", "Close"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-glass-subtle")).toBe(true);
			expect(button.classes.has("kls-glass-strong")).toBe(false);
		}
		expect(text).not.toMatch(/start-without-end|discovery|cleanup-failed|cleanup-state-unknown|kls-/);
	});

	it("shows accurate mixed removed and already-absent counts without false removal wording", async () => {
		const highlight = createHighlight();
		const target = createCleanupTarget(highlight);
		const presentation = createIgnoreResultsPresentation([createCleanupResult([
			{ target, status: "removed-safely", blocksRemoved: 1 },
			{ target, status: "no-matching-highlight-block" },
		])]);
		const modal = createModal({ ignoreResults: presentation });

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("2 highlights will be ignored in future syncs.");
		expect(readText(modal.contentEl)).toContain(
			"Your ignore choices were saved for future syncs. Some existing notes were left unchanged."
		);
		expect(readText(modal.contentEl)).toContain("1 highlight was removed from an existing note.");
		await findByText(modal.contentEl, "Review Ignore Results").click();
		expect(readText(modal.contentEl).match(/removed from the matching note/g)).toHaveLength(1);
		expect(readText(modal.contentEl).match(/already absent from the matching note/g)).toHaveLength(1);
	});

	it("uses neutral overview wording when cleanup could not be completed", () => {
		const outcome = createAllCleanupOutcomes()[5]!;
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createCleanupResult([outcome])]),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("1 highlight will be ignored in future syncs.");
		expect(readText(modal.contentEl)).toContain(
			"The existing-note update could not be completed for 1 highlight."
		);
		expect(readText(modal.contentEl)).not.toContain("left unchanged");
		expect(readText(modal.contentEl)).not.toContain("was removed");
	});

	it("does not describe a missing matching note as an unchanged existing note", () => {
		const outcome = createAllCleanupOutcomes()[1]!;
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createCleanupResult([outcome])]),
		});

		modal.onOpen();
		const text = readText(modal.contentEl);

		expect(text).toContain(
			"No existing-note change was made for highlights without a matching note."
		);
		expect(text).toContain("No matching note was found for 1 highlight.");
		expect(text).not.toContain("Some existing notes were left unchanged");
		expect(text).not.toContain("existing note was left unchanged");
	});

	it("uses neutral overview wording when the cleanup state is unconfirmed", () => {
		const outcome = createAllCleanupOutcomes()[6]!;
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createCleanupResult([outcome])]),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"The final note state could not be confirmed for 1 highlight."
		);
		expect(readText(modal.contentEl)).not.toContain("left unchanged");
		expect(readText(modal.contentEl)).not.toContain("was removed");
	});

	it("accurately distinguishes missing, absent, unchanged, failed, and unconfirmed mixed results", () => {
		const outcomes = createAllCleanupOutcomes();
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createCleanupResult([
				...outcomes,
			])]),
		});

		modal.onOpen();
		const text = readText(modal.contentEl);

		expect(text).toContain("1 highlight was removed from an existing note.");
		expect(text).toContain(
			"No existing-note change was made for highlights without a matching note."
		);
		expect(text).toContain("No matching note was found for 1 highlight.");
		expect(text).toContain("1 highlight was already absent from its matching note.");
		expect(text).toContain("Existing notes were left unchanged for 2 highlights.");
		expect(text).toContain("The existing-note update could not be completed for 1 highlight.");
		expect(text).toContain("The final note state could not be confirmed for 1 highlight.");
		expect(text).not.toContain("Some existing notes were left unchanged");
	});

	it("restores summary scroll after Ignore details and supports Close", async () => {
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([
				createCleanupResult([createAllCleanupOutcomes()[1]!]),
			]),
		});
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();
		setScrollTop(modal.contentEl, 390);
		await findByText(modal.contentEl, "Review Ignore Results").click();
		await findByText(modal.contentEl, "Close").click();
		expect(closeSpy).toHaveBeenCalledTimes(1);
		await findByText(modal.contentEl, "Back").click();
		expect(scrollTop(modal.contentEl)).toBe(390);
	});
});

describe("SyncSummaryModal missing managed highlight review", () => {
	it("keeps a colliding missing-managed item from another book after Ignore Going Forward", async () => {
		const plugin = createPlugin();
		const bookA = createCollisionHighlight("Collision 1h0o65e 20hu");
		const bookB = createCollisionHighlight("Collision 1y0rlvz 2269");
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [bookA, bookB],
			}),
		});

		expect(createClippingId(bookA)).toBe(createClippingId(bookB));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();
		await buttonsByText(modal.contentEl, "Ignore Going Forward")[0]!.click();

		expect(plugin.ignoreHighlights).toHaveBeenCalledWith(
			[bookA],
			expect.any(CurrentClippingIdentityIndex)
		);
		expect(readText(modal.contentEl)).not.toContain(bookA.bookTitle);
		expect(readText(modal.contentEl)).toContain(bookB.bookTitle);
	});

	it("increments the imported count and removes a successfully imported recovery item", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();

		expect(plugin.importHighlights).toHaveBeenCalledWith(
			[highlight],
			expect.any(CurrentClippingIdentityIndex),
			true,
			[highlight]
		);
		expect(readText(modal.contentEl)).toContain("No missing managed highlights left to review.");
		await findByText(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("1 new highlights imported");
		expect(readText(modal.contentEl)).toContain("Missing managed highlights to review: 0");
	});

	it("returns to completion wording after a protected recovery retry later succeeds", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		plugin.importHighlights
			.mockResolvedValueOnce(createImportResult([highlight], ["protected"]))
			.mockResolvedValueOnce(createImportResult([highlight]));
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();
		setScrollTop(modal.contentEl, 275);
		await findByText(modal.contentEl, "Import Again").click();

		expect(buttonTexts(modal.contentEl)).toContain("Import Again");
		expect(readText(modal.contentEl)).toContain(
			"This note was left unchanged. This highlight is still available to try again."
		);
		const status = elementByClass(modal.contentEl, "kls-inline-status");
		expect(status.attributes.get("role")).toBe("status");
		expect(status.attributes.get("aria-live")).toBe("polite");
		expect(scrollTop(modal.contentEl)).toBe(275);
		expect(readText(modal.contentEl)).not.toContain("kls-");
		expect(readText(modal.contentEl)).not.toContain("kindle-local-sync:start");
		expect(readText(modal.contentEl)).not.toContain("unsafe-existing-managed-region");
		expect(readText(modal.contentEl)).not.toContain("Kindle Highlights/Atomic Habits");
		await findByText(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).not.toContain("Sync complete");
		expect(readText(modal.contentEl)).toContain("0 new highlights imported");
		expect(readText(modal.contentEl)).toContain("Missing managed highlights to review: 1");

		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();
		expect(readText(modal.contentEl)).toContain(
			"This note was left unchanged. This highlight is still available to try again."
		);
		await findByText(modal.contentEl, "Import Again").click();
		expect(readText(modal.contentEl)).not.toContain("This note was left unchanged.");
		expect(readText(modal.contentEl)).toContain("No missing managed highlights left to review.");
		await findByText(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("Sync finished");
		expect(readText(modal.contentEl)).toContain("1 new highlights imported");
	});

	it("keeps a recovery item and count unchanged when the writer contract is invalid", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		plugin.importHighlights.mockRejectedValueOnce(
			new InvalidVaultWriteContractError("outcome-count")
		);
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();
		await expect(findByText(modal.contentEl, "Import Again").click())
			.rejects.toBeInstanceOf(InvalidVaultWriteContractError);

		expect(buttonTexts(modal.contentEl)).toContain("Import Again");
		await findByText(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("0 new highlights imported");
		expect(readText(modal.contentEl)).toContain("Missing managed highlights to review: 1");
	});

	it("explains why previously imported highlights need recovery review", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		expect(readText(modal.contentEl)).toContain("Missing managed highlights to review: 1");
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();

		expect(readText(modal.contentEl)).toContain("Missing managed highlights");
		expect(readText(modal.contentEl)).toContain(
			"These highlights were previously imported, but their generated marker was not found in your notes. Review them before importing again, ignoring, or skipping."
		);
		expect(readText(modal.contentEl)).toContain(
			"This can happen if a generated note or sync block was deleted, moved, or edited."
		);
		expect(buttonTexts(modal.contentEl)).toContain("Back to Summary");
	});

	it("uses shared button classes in missing managed highlight review rows", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Managed Highlights").click();

		const row = elementByClass(modal.contentEl, "kls-highlight-row");
		const buttonRow = elementByClass(row, "kls-button-row");

		expect(elementsByClass(buttonRow, "kls-action-button").map((button) => button.text())).toEqual([
			"Import Again",
			"Ignore Going Forward",
			"Skip This Time",
		]);
	});
});

describe("SyncSummaryModal scroll restoration", () => {
	it("restores summary scroll position after returning from ignored highlights view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		setScrollTop(modal.contentEl, 420);
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		setScrollTop(modal.contentEl, 75);
		await findByText(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(scrollTop(modal.contentEl)).toBe(420);
	});

	it("restores summary scroll position after returning from skipped books view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		setScrollTop(modal.contentEl, 360);
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 90);
		await findByText(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(scrollTop(modal.contentEl)).toBe(360);
	});

	it("keeps skipped books view rendered after returning from a book review view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "Atomic Habits" }),
				createSummaryItem({ id: "two", title: "Deep Work" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(modal.contentEl, 45);
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(readText(modal.contentEl)).toContain("Atomic Habits");
	});
});

describe("SyncSummaryModal skipped books anchor restoration", () => {
	it("stores the clicked skipped book as a return anchor when Review Highlights is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "Atomic Habits" }),
				createSummaryItem({ id: "two", title: "Deep Work" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(findSectionByHeading(modal.contentEl, "Deep Work"), "Review Highlights").click();
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "Deep Work"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "Atomic Habits"))).toHaveLength(0);
	});

	it("scrolls the clicked book back into view when Back to Skipped Books is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "Atomic Habits" }),
				createSummaryItem({ id: "two", title: "Deep Work" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(findSectionByHeading(modal.contentEl, "Deep Work"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 10);
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		const deepWorkSection = bookCardByTitle(modal.contentEl, "Deep Work");

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(scrollIntoViewCalls(deepWorkSection)).toEqual([{ block: "center" }]);
	});

	it("falls back safely when the return anchor no longer exists", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "Atomic Habits" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();
		setScrollTop(modal.contentEl, 10);
		await findByText(modal.contentEl, "Back to Skipped Books").click();

		expect(readText(modal.contentEl)).toContain("No skipped highlights left to review.");
		expect(scrollTop(modal.contentEl)).toBe(280);
	});

	it("uses Title Case for Ignored Highlights and Skipped This Sync view titles", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View Ignored Highlights").click();
		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignored highlights");

		await findByText(modal.contentEl, "Back to Summary").click();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(readText(modal.contentEl)).not.toContain("Skipped this sync");
	});
});

function createModal(options: {
	plugin?: ReturnType<typeof createPlugin>;
	classification?: SyncClassification;
	skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
	protectedBooks?: ProtectedBooksPresentation;
	ignoreResults?: IgnoreResultsPresentation;
	automaticHighlights?: KindleHighlight[];
	importedCount?: number;
} = {}) {
	const classification = options.classification ?? createClassification();

	return new SyncSummaryModal(new App() as never, (options.plugin ?? createPlugin()) as never, {
		classification,
		automaticHighlights: options.automaticHighlights ?? [],
		importedCount: options.importedCount ?? 0,
		skippedThisSyncHighlights: options.skippedThisSyncHighlights ?? [],
		identityIndex: new CurrentClippingIdentityIndex([
			...classification.newHighlights,
			...classification.duplicateHighlights,
			...classification.ignoredHighlights,
			...classification.possibleReappearedHighlights,
		]),
		protectedBooks: options.protectedBooks,
		ignoreResults: options.ignoreResults,
	});
}

function createPlugin(options: { ignoredHighlights?: IgnoredHighlight[] } = {}) {
	const settings = {
		ignoredHighlights: [...(options.ignoredHighlights ?? [])],
	};

	return {
		importHighlights: vi.fn(async (highlights: KindleHighlight[]): Promise<HighlightImportResult> =>
			createImportResult(highlights)),
		ignoreHighlights: vi.fn(async () => ({
			cleanupResult: createEmptyCleanupResult(),
			outcomePresentation: createEmptyIgnoreResultsPresentation(),
		})),
		ignoreSummaryHighlight: vi.fn(async (highlight: SyncSummaryHighlightItem) => {
			settings.ignoredHighlights.push({
				id: highlight.id,
				title: highlight.title,
				author: highlight.author,
				textPreview: highlight.textPreview,
				ignoredAt: "2026-07-09T00:00:00.000Z",
				lang: highlight.lang,
			});

			return {
				cleanupResult: createEmptyCleanupResult(),
				outcomePresentation: createEmptyIgnoreResultsPresentation(),
			};
		}),
		unignoreHighlight: vi.fn(async (target: IgnoredHighlight) => {
			settings.ignoredHighlights = settings.ignoredHighlights.filter((highlight) => highlight !== target);
		}),
		settings,
	};
}

function createImportResult(
	highlights: KindleHighlight[],
	statuses: Array<VaultBookWriteOutcome["status"]> = []
): HighlightImportResult {
	const plan = createVaultWritePlan("Kindle Highlights", groupHighlightsByBook(highlights));
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
	const protectedBookIdentities = new Set(bookOutcomes
		.filter((outcome) => outcome.status === "protected")
		.map((outcome) => createBookIdentityKey(outcome.bookTitle, outcome.author)));
	const safelyCompletedHighlights = highlights.filter((highlight, index) =>
		highlights.findIndex((candidate) =>
			createKindleHighlightIdentityKey(candidate) === createKindleHighlightIdentityKey(highlight)
		) === index
		&& !protectedBookIdentities.has(createBookIdentityKey(highlight.bookTitle, highlight.author))
	);
	const protectedHighlights = highlights.filter((highlight, index) =>
		highlights.findIndex((candidate) =>
			createKindleHighlightIdentityKey(candidate) === createKindleHighlightIdentityKey(highlight)
		) === index
		&& protectedBookIdentities.has(createBookIdentityKey(highlight.bookTitle, highlight.author))
	);

	return {
		writeSummary: {
			books: plan.bookPlans.length,
			filesCreated: bookOutcomes.filter((outcome) => outcome.status === "created").length,
			filesUpdated: bookOutcomes.filter((outcome) => outcome.status === "updated").length,
			filesUnchanged: bookOutcomes.filter((outcome) => outcome.status === "confirmed").length,
			filesProtected: bookOutcomes.filter((outcome) => outcome.status === "protected").length,
			highlightsRendered: plan.highlightsRendered,
			duplicatesSkipped: plan.duplicatesSkipped,
			bookOutcomes,
		},
		safelyCompletedHighlights,
		protectedHighlights,
	};
}

function createEmptyCleanupResult() {
	return {
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes: [],
	};
}

function createCleanupResult(
	targetOutcomes: IgnoredHighlightCleanupTargetOutcome[]
): IgnoredHighlightCleanupSummary {
	const firstTarget = targetOutcomes[0]?.target;

	return {
		filesScanned: 1,
		filesUpdated: targetOutcomes.some((outcome) => outcome.status === "removed-safely") ? 1 : 0,
		blocksRemoved: targetOutcomes.filter((outcome) => outcome.status === "removed-safely").length,
		bookOutcomes: firstTarget ? [{
			bookTitle: firstTarget.bookTitle,
			author: firstTarget.author,
			targetOutcomes,
		}] : [],
	};
}

function createAllCleanupOutcomes(): IgnoredHighlightCleanupTargetOutcome[] {
	const target = createCleanupTarget(createHighlight());

	return [
		{ target, status: "removed-safely", blocksRemoved: 1 },
		{ target, status: "no-matching-note" },
		{ target, status: "no-matching-highlight-block" },
		{ target, status: "ambiguous-note-ownership" },
		{ target, status: "unsafe-managed-region", reason: "start-without-end" },
		{ target, status: "cleanup-failed", stage: "discovery" },
		{ target, status: "cleanup-state-unknown", stage: "write" },
	];
}

function createCleanupTarget(highlight: KindleHighlight) {
	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		id: createClippingId(highlight),
	};
}

function createClassification(overrides: Partial<SyncClassification> = {}): SyncClassification {
	return {
		newHighlights: [],
		duplicateHighlights: [],
		ignoredHighlights: [],
		possibleReappearedHighlights: [],
		...overrides,
	};
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

function createCollisionHighlight(bookTitle: string): KindleHighlight {
	return createHighlight({
		bookTitle,
		author: "Author",
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});
}

function createIgnoredHighlight(overrides: Partial<IgnoredHighlight> = {}): IgnoredHighlight {
	return {
		id: "kls-ignored",
		title: "Atomic Habits",
		author: "James Clear",
		textPreview: "Small habits make a big difference.",
		ignoredAt: "2026-07-09T12:00:00.000Z",
		...overrides,
	};
}

function createSummaryItem(overrides: Partial<SyncSummaryHighlightItem> = {}): SyncSummaryHighlightItem {
	return {
		id: "kls-skipped",
		title: "Atomic Habits",
		author: "James Clear",
		textPreview: "Small habits make a big difference.",
		location: "154",
		...overrides,
	};
}

interface TestElement {
	tagName: string;
	children: TestElement[];
	classes: Set<string>;
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
	scrollTop: number;
	scrollIntoViewCalls: unknown[];
	attributes: Map<string, string>;
}

function expectNativeGlassTreatment(element: TestElement): void {
	expect(element.classes.has("kls-glass-subtle")).toBe(false);
	expect(element.classes.has("kls-glass-strong")).toBe(false);
}

function readText(element: unknown): string {
	return (element as TestElement).text();
}

function findByText(element: unknown, text: string): TestElement {
	const match = (element as TestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find text: ${text}`);
	}

	return match;
}

function buttonTexts(element: unknown): string[] {
	const texts: string[] = [];
	collectButtonTexts(element as TestElement, texts);

	return texts;
}

function buttonsByText(element: unknown, text: string): TestElement[] {
	const buttons: TestElement[] = [];

	collectElementsByTag(element as TestElement, "button", buttons);
	return buttons.filter((button) => button.text() === text);
}

function elementsByClass(element: unknown, className: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByClass(element as TestElement, className, matches);

	return matches;
}

function elementByClass(element: unknown, className: string): TestElement {
	const match = elementsByClass(element, className)[0];

	if (!match) {
		throw new Error(`Could not find class: ${className}`);
	}

	return match;
}

function bookCardByTitle(element: unknown, title: string): TestElement {
	const match = elementsByClass(element, "kls-book-card")
		.find((card) => elementByClass(card, "kls-book-title").text() === title);

	if (!match) {
		throw new Error(`Could not find book card: ${title}`);
	}

	return match;
}

function collectButtonTexts(element: TestElement, texts: string[]): void {
	if (element.tagName === "button") {
		texts.push(element.text());
	}

	for (const child of element.children) {
		collectButtonTexts(child, texts);
	}
}

function collectElementsByClass(element: TestElement, className: string, matches: TestElement[]): void {
	if (element.classes.has(className)) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByClass(child, className, matches);
	}
}

function collectElementsByTag(element: TestElement, tagName: string, matches: TestElement[]): void {
	if (element.tagName === tagName) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByTag(child, tagName, matches);
	}
}

function setScrollTop(element: unknown, scrollPosition: number): void {
	(element as TestElement).scrollTop = scrollPosition;
}

function scrollTop(element: unknown): number {
	return (element as TestElement).scrollTop;
}

function scrollIntoViewCalls(element: unknown): unknown[] {
	return (element as TestElement).scrollIntoViewCalls;
}

function findSectionByHeading(element: unknown, heading: string): TestElement {
	const match = findSectionByHeadingText(element as TestElement, heading);

	if (!match) {
		throw new Error(`Could not find section heading: ${heading}`);
	}

	return match;
}

function findSectionByHeadingText(element: TestElement, heading: string): TestElement | null {
	if (
		element.tagName === "div" &&
		element.children.some((child) => child.tagName === "h3" && child.text() === heading)
	) {
		return element;
	}

	for (const child of element.children) {
		const match = findSectionByHeadingText(child, heading);

		if (match) {
			return match;
		}
	}

	return null;
}
