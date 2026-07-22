import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import type { HighlightImportResult } from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createSyntheticSameBookCollision } from "./testFixtures/syntheticSameBookCollision";
import { createClippingId, groupHighlightsByBook } from "./render/renderMarkdown";
import { IgnoredHighlight } from "./settings";
import { SyncClassification } from "./sync/SyncClassifier";
import {
	createBookIdentityKey,
	createKindleHighlightIdentityKey,
	createLegacyClippingId,
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

	it("generates return-next-sync copy for skipped, unreviewed, both, and neither", () => {
		const skipped = createModal({
			skippedThisSyncHighlights: [createSummaryItem({ returnReason: "skipped" })],
		});
		const unreviewed = createModal({
			skippedThisSyncHighlights: [createSummaryItem({ returnReason: "unreviewed" })],
		});
		const both = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "skipped", returnReason: "skipped" }),
				createSummaryItem({ id: "unreviewed", returnReason: "unreviewed" }),
			],
		});
		const neither = createModal();

		for (const modal of [skipped, unreviewed, both, neither]) {
			modal.onOpen();
		}
		expect(readText(skipped.contentEl)).toContain(
			"Temporarily skipped highlights may appear again next time you sync."
		);
		expect(readText(unreviewed.contentEl)).toContain(
			"Unreviewed highlights may appear again next time you sync."
		);
		expect(readText(both.contentEl)).toContain(
			"Unreviewed and temporarily skipped highlights may appear again next time you sync."
		);
		expect(readText(neither.contentEl)).not.toContain("may appear again next time you sync");
		expect(readText(skipped.contentEl)).toContain("1 temporary Skip choice left for a later sync");
		expect(readText(unreviewed.contentEl)).toContain("1 unreviewed highlight left for a later sync");
	});

	it("emphasizes summary numbers and reserves attention styling for missing review work", () => {
		const modal = createModal({
			importedCount: 2,
			classification: createClassification({
				ignoredHighlights: [createHighlight(), createHighlight({ location: "155" })],
				duplicateHighlights: [createHighlight({ location: "156" })],
				possibleReappearedHighlights: [createHighlight({ location: "157" })],
			}),
		});

		modal.onOpen();
		const rows = elementsByClass(modal.contentEl, "kls-summary-count-row");

		expect(rows.map((row) => row.text())).toEqual([
			"2 new highlights imported",
			"2 persisted Ignore choices kept out of this sync",
			"1 duplicate skipped",
			"1 missing highlight needs review",
		]);
		expect(rows.map((row) => elementByClass(row, "kls-summary-count-value").text())).toEqual([
			"2",
			"2",
			"1",
			"1",
		]);
		expect(rows.map((row) => elementByClass(row, "kls-summary-count-label").text())).toEqual([
			"new highlights imported",
			"persisted Ignore choices kept out of this sync",
			"duplicate skipped",
			"missing highlight needs review",
		]);
		expect(rows.slice(0, 3).every((row) => !row.classes.has("kls-summary-count-row-attention"))).toBe(true);
		expect(rows[3]?.classes.has("kls-summary-count-row-attention")).toBe(true);
		expect(rows[0]?.classes.has("kls-summary-count-row-primary")).toBe(true);
	});

	it("omits every zero-value metric row", () => {
		const modal = createModal();

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-summary-count-row")).toHaveLength(0);
		expect(readText(modal.contentEl)).not.toContain("0 new highlights imported");
	});

	it("uses exact singular and plural Missing Highlights summary copy", () => {
		const singularModal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});
		const pluralModal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight(), createHighlight({ location: "155" })],
			}),
		});

		singularModal.onOpen();
		pluralModal.onOpen();

		expect(readText(singularModal.contentEl)).toContain("1 missing highlight needs review");
		expect(readText(pluralModal.contentEl)).toContain("2 missing highlights need review");
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
		const navigationActions = elementByClass(actionRow, "kls-summary-navigation-actions");
		const closeActions = elementByClass(actionRow, "kls-summary-close-actions");
		const actionButtons = elementsByClass(actionRow, "kls-action-button");

		expect(elementsByClass(modal.contentEl, "kls-glass-scope")).toHaveLength(1);
		expect(elementsByClass(modal.contentEl, "kls-summary-actions")).toHaveLength(1);
		expect(actionRow.classes.has("kls-button-row")).toBe(false);
		expect(actionRow.children).toEqual([navigationActions, closeActions]);
		expect(buttonTexts(navigationActions)).toEqual([
			"Review Missing Highlights",
			"View Books Left Unchanged",
			"Manage Ignored Highlights",
			"Review Skipped This Sync",
		]);
		expect(buttonTexts(closeActions)).toEqual(["Close"]);
		expect(actionButtons.map((button) => button.text())).toEqual([
			"Review Missing Highlights",
			"View Books Left Unchanged",
			"Manage Ignored Highlights",
			"Review Skipped This Sync",
			"Close",
		]);
		const ignorePanel = findSectionByHeading(modal.contentEl, "Ignore results");

		expect(buttonTexts(ignorePanel)).not.toContain("Manage Ignored Highlights");
		expect(elementsByClass(ignorePanel, "kls-ignore-results-actions")).toHaveLength(0);
		expect(actionButtons.every((button) => button.classes.has("kls-glass-subtle"))).toBe(true);
		expect(elementsByClass(modal.contentEl, "kls-glass-strong")).toHaveLength(0);
		expect(findByText(closeActions, "Close").classes.has("mod-cta")).toBe(false);
		expect(findByText(closeActions, "Close").classes.has("mod-warning")).toBe(false);
	});

	it("uses strong glass for Import and subtle glass for neutral decisions", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		const reviewButton = findByText(modal.contentEl, "Review Missing Highlights");

		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
		await reviewButton.click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const backButton = findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights");
		const importButton = findByText(modal.contentEl, "Import Again");
		const ignoreButton = findByText(modal.contentEl, "Ignore Going Forward");
		const skipButton = findByText(modal.contentEl, "Skip This Time");

		expect(backButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(importButton.classes.has("kls-glass-strong")).toBe(true);
		expect(ignoreButton.classes.has("mod-warning")).toBe(false);
		expect(ignoreButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(skipButton.classes.has("kls-glass-subtle")).toBe(true);
		for (const button of [backButton, importButton, ignoreButton, skipButton]) {
			expect(button.classes.has("kls-pill-button")).toBe(true);
		}
	});

	it("uses subtle glass for management and Ignore actions", async () => {
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();

		expect(findButtonByAriaLabel(modal.contentEl, "Back to Summary").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Review Highlights").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Remove All From Ignore List").classes.has("kls-glass-subtle")).toBe(true);

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Ignored Highlights").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Remove From Ignore List").classes.has("kls-glass-subtle")).toBe(true);

		await findButtonByAriaLabel(modal.contentEl, "Back to Ignored Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(findButtonByAriaLabel(modal.contentEl, "Back to Summary").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(modal.contentEl, "Review Highlights").classes.has("kls-review-action-button")).toBe(true);
		const ignoreAllButton = findByText(modal.contentEl, "Ignore All Highlights");

		expect(ignoreAllButton.classes.has("mod-warning")).toBe(false);
		expect(ignoreAllButton.classes.has("kls-glass-subtle")).toBe(true);
		await ignoreAllButton.click();

		const backButton = findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books");
		const confirmIgnoreButton = findByText(modal.contentEl, "Ignore All Highlights");

		expect(backButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(backButton.classes.has("kls-review-back-button")).toBe(true);
		expect(confirmIgnoreButton.classes.has("mod-warning")).toBe(false);
		expect(confirmIgnoreButton.classes.has("kls-glass-subtle")).toBe(true);
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
			"Review Missing Highlights",
			"Manage Ignored Highlights",
			"Review Skipped This Sync",
			"Close",
		]));

		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back",
			"Review Highlights",
			"Remove All From Ignore List",
		]));

		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back",
			"Review Highlights",
			"Ignore All Highlights",
		]));

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back",
			"Ignore Going Forward",
		]));
	});

	it("shows Manage Ignored Highlights in the footer only when persisted ignored highlights exist", () => {
		const modal = createModal({
			plugin: createPlugin({ ignoredHighlights: [createIgnoredHighlight()] }),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Manage Ignored Highlights");
		expect(findSectionByHeading(modal.contentEl, "Ignore results").text()).not.toContain("Manage Ignored Highlights");
		expect(findByText(elementByClass(modal.contentEl, "kls-summary-actions"), "Manage Ignored Highlights")).toBeDefined();
	});

	it("does not treat Ignore results as temporary skipped-review items", () => {
		const modal = createModal({
			classification: createClassification({ ignoredHighlights: [createHighlight()] }),
		});

		modal.onOpen();

		expect(buttonTexts(modal.contentEl)).not.toContain("Manage Ignored Highlights");
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Skipped This Sync");
		expect(readText(modal.contentEl)).not.toContain("Unreviewed or temporarily skipped highlights may appear again next time you sync.");
	});

	it("hides Ignore results and management when no Ignore state was persisted", () => {
		const modal = createModal();

		modal.onOpen();

		expect(readText(modal.contentEl)).not.toContain("Ignore results");
		expect(buttonTexts(modal.contentEl)).not.toContain("Manage Ignored Highlights");
	});

	it("renders ignored highlights grouped by book when clicked", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [
					createIgnoredHighlight(),
					createIgnoredHighlight({ id: "kls-ignored-two", textPreview: "Second ignored highlight." }),
					createIgnoredHighlight({ id: "kls-ignored-three", title: "Night Trains to Lumen Bay", textPreview: "Moonlit rail maps matter." }),
				],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).toContain("2 ignored highlights");
		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
		expect(readText(modal.contentEl)).toContain("1 ignored highlight");
		expect(readText(modal.contentEl)).not.toContain("Clockwork apples chime at midnight.");
		expect(readText(modal.contentEl)).not.toContain("Second ignored highlight.");
		expect(readText(modal.contentEl)).not.toContain("Moonlit rail maps matter.");
	});

	it("shows Back with a summary destination label in ignored highlights view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();

		expect(buttonTexts(modal.contentEl)).toContain("Back");
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Summary")).toBeDefined();
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();

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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();

		const card = elementByClass(modal.contentEl, "kls-book-card");
		const header = elementByClass(card, "kls-book-header");

		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
		expect(card.classes.has("kls-book-section")).toBe(true);
		expect(elementByClass(header, "kls-book-title").text()).toBe("The Clockwork Orchard");
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
				createIgnoredHighlight({ id: "one", title: "The Clockwork Orchard" }),
				createIgnoredHighlight({ id: "two", title: "The Clockwork Orchard", textPreview: "Second ignored highlight." }),
				createIgnoredHighlight({ id: "three", title: "Night Trains to Lumen Bay" }),
			],
		});
		const modal = createModal({
			plugin,
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"), "Remove All From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
		expect(plugin.unignoreHighlight).not.toHaveBeenCalledWith(expect.objectContaining({ id: "three" }));
		expect(readText(modal.contentEl)).not.toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(buttonTexts(modal.contentEl)).toContain("Back");
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Ignored Highlights")).toBeDefined();
		const detail = elementByClass(modal.contentEl, "kls-book-detail-view");
		const header = elementByClass(detail, "kls-book-detail-header");
		const navigation = elementByClass(detail, "kls-book-detail-back");
		const row = elementByClass(detail, "kls-book-detail-highlight");

		expect(detail.children[0]).toBe(header);
		expect(header.children[0]).toBe(navigation);
		expect(header.children[1]?.classes.has("kls-book-title")).toBe(true);
		expect(elementByClass(detail, "kls-book-title").text()).toBe("The Clockwork Orchard");
		expect(elementByClass(detail, "kls-book-author").text()).toBe("Mira Vale");
		expect(elementByClass(detail, "kls-book-detail-count").text()).toBe("1 ignored highlight");
		expect(row.children.map((child) => [...child.classes][0])).toEqual([
			"kls-book-detail-highlight-text",
			"kls-book-detail-highlight-meta",
			"kls-button-row",
		]);
		expect(findByText(row, "Ignored 7/9/2099").text()).toBe("Ignored 7/9/2099");
		expect(elementByClass(row, "kls-book-detail-highlight-text").text()).toBe("Clockwork apples chime at midnight.");
		expect(elementsByClass(detail, "kls-book-card")).toHaveLength(0);
		expect(buttonTexts(modal.contentEl)).toContain("Remove From Ignore List");
	});

	it("uses the complete ignored book title as the direct detail heading", async () => {
		const longTitle = "A Very Long Clockwork Orchard Almanac Title That Should Wrap Cleanly In The Detail Card";
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight({ title: longTitle })],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const detail = elementByClass(modal.contentEl, "kls-book-detail-view");
		const header = elementByClass(detail, "kls-book-detail-header");

		expect(header.children[0]?.classes.has("kls-book-detail-back")).toBe(true);
		expect(header.children[1]?.classes.has("kls-book-title")).toBe(true);
		expect(elementByClass(detail, "kls-book-title").text()).toBe(longTitle);
		expect(elementsByClass(detail, "kls-book-card")).toHaveLength(0);
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("1 ignored highlight");
		expect(readText(modal.contentEl)).not.toContain("Clockwork apples chime at midnight.");
		expect(buttonTexts(modal.contentEl)).toContain("Review Highlights");
	});
});

describe("SyncSummaryModal skipped-this-sync navigation", () => {
	it("hides Review Skipped This Sync when this sync has no skipped highlights", () => {
		const modal = createModal();

		modal.onOpen();

		expect(buttonTexts(modal.contentEl)).not.toContain("Review Skipped This Sync");
	});

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
				createSummaryItem({ id: "one", title: "The Clockwork Orchard" }),
				createSummaryItem({ id: "two", title: "The Clockwork Orchard", textPreview: "Second highlight." }),
				createSummaryItem({ id: "three", title: "Night Trains to Lumen Bay" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(readText(modal.contentEl)).toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).toContain("2 highlights skipped this sync");
		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
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
		expect(title.text()).toBe("The Clockwork Orchard");
		expect(elementByClass(card, "kls-book-review-summary").text()).toBe("1 highlight skipped this sync");
		expect(elementsByClass(header, "kls-action-button")).toHaveLength(0);
		expect(actions.classes.has("kls-button-row")).toBe(true);
		expect(buttonTexts(actions)).toEqual(["Ignore All Highlights", "Review Highlights"]);
		expect(findByText(actions, "Review Highlights").classes.has("kls-review-action-button")).toBe(true);
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
		expect(findByText(actions, "Ignore All Highlights").classes.has("kls-action-button")).toBe(true);
		const reviewButton = findByText(actions, "Review Highlights");
		expect(reviewButton.classes.has("kls-review-action-button")).toBe(true);
		expect(reviewButton.classes.has("kls-action-button")).toBe(true);
		expect(reviewButton.classes.has("kls-pill-button")).toBe(true);
		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
	});

	it("shows Back with a summary destination label in skipped books view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();

		expect(buttonTexts(modal.contentEl)).toContain("Back");
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Summary")).toBeDefined();
		const titleIndex = directChildIndexByClass(modal.contentEl, "kls-review-view-title");
		const backIndex = directChildIndexByClass(modal.contentEl, "kls-review-navigation");
		const introIndex = directChildIndexByClass(modal.contentEl, "kls-review-view-intro");
		expect(titleIndex).toBeGreaterThan(-1);
		expect(backIndex).toBe(titleIndex + 1);
		expect(introIndex).toBe(backIndex + 1);
	});

	it("returns to summary when Back to Summary is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
	});

	it("renders per-book skipped highlight review when Review Highlights is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const detail = elementByClass(modal.contentEl, "kls-book-detail-view");
		const header = elementByClass(detail, "kls-book-detail-header");
		const navigation = elementByClass(detail, "kls-book-detail-back");
		const row = elementByClass(detail, "kls-book-detail-highlight");

		expect(detail.children[0]).toBe(header);
		expect(header.children[0]).toBe(navigation);
		expect(header.children[1]?.classes.has("kls-book-title")).toBe(true);
		expect(elementByClass(detail, "kls-book-title").text()).toBe("The Clockwork Orchard");
		expect(elementByClass(detail, "kls-book-author").text()).toBe("Mira Vale");
		expect(elementByClass(detail, "kls-book-detail-count").text()).toBe("1 highlight skipped this sync");
		expect(row.children.map((child) => [...child.classes][0])).toEqual([
			"kls-book-detail-highlight-text",
			"kls-book-detail-highlight-meta",
			"kls-button-row",
		]);
		expect(elementByClass(row, "kls-book-detail-highlight-text").text()).toBe("Clockwork apples chime at midnight.");
		expect(elementByClass(row, "kls-book-detail-highlight-meta").text()).toBe("Location 154");
		expect(elementsByClass(detail, "kls-book-card")).toHaveLength(0);
		expect(readText(detail)).toContain("Ignore Going Forward");
	});

	it("uses shared button classes in per-book skipped highlight review", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const row = elementByClass(modal.contentEl, "kls-book-detail-highlight");
		const buttonRow = elementByClass(row, "kls-book-detail-highlight-actions");

		expect(elementsByClass(buttonRow, "kls-action-button").map((button) => button.text())).toEqual([
			"Ignore Going Forward",
		]);
	});

	it("shows Back with a skipped-books destination label in per-book review", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(buttonTexts(modal.contentEl)).toContain("Back");
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books")).toBeDefined();
	});

	it("returns to skipped books when Back to Skipped Books is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

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

		expect(readText(modal.contentEl)).not.toContain("Clockwork apples chime at midnight.");
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
		expect(buttonTexts(modal.contentEl)).toEqual(["Back", "Ignore All Highlights"]);
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").classes.has("kls-review-back-button")).toBe(true);
		expect(plugin.ignoreSummaryHighlight).not.toHaveBeenCalled();
	});

	it("returns to skipped books without changing highlights when Ignore All confirmation goes Back", async () => {
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
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

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

		expect(createLegacyClippingId(bookA)).toBe(createLegacyClippingId(bookB));
		expect(itemA.id).not.toBe(itemB.id);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(bookCardByTitle(modal.contentEl, itemA.title), "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

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
	it("surfaces an actionable legacy identity conflict without reporting false duplicates", async () => {
		const collisionHighlights = createSyntheticSameBookCollision();
		const modal = createModal({
			classification: createClassification({
				identityConflictHighlights: collisionHighlights,
			}),
			protectedBooks: createProtectedBooksPresentation([], [], collisionHighlights),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"It protected those books and made no changes to their notes or saved choices."
		);
		expect(readText(modal.contentEl)).toContain("Back up the affected notes");
		expect(readText(modal.contentEl)).not.toContain("duplicate skipped");
		expect(readText(modal.contentEl)).not.toContain("hash");
		expect(readText(modal.contentEl)).not.toContain("canonical identity");
		await findByText(modal.contentEl, "View Books Left Unchanged").click();
		expect(readText(modal.contentEl)).toContain(
			"This book was not changed, and no Import or Ignore choice was saved."
		);
		expect(readText(modal.contentEl)).toContain("compare these highlights with My Clippings.txt");
	});

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
			createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" }),
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
		expect(readText(modal.contentEl)).toContain("Author 24");
		expect(readText(modal.contentEl)).not.toContain("Author: Author 24");
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
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
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

	it("removes the normal Ignore result drill-down while keeping summary copy", () => {
		const outcomes = createAllCleanupOutcomes();
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([createCleanupResult(outcomes.slice(0, 5))]),
		});

		modal.onOpen();
		const text = readText(modal.contentEl);

		expect(text).toContain("5 highlights will be ignored in future syncs.");
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Ignore Results");
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Note Update Issues");
		expect(text).not.toContain("This highlight was removed from the matching note.");
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
		expect(readText(modal.contentEl)).not.toContain("Some existing notes were left unchanged.");
		expect(readText(modal.contentEl)).toContain("1 highlight was removed from an existing Obsidian note.");
		expect(readText(modal.contentEl)).toContain(
			"1 ignored highlight had already been removed from its Obsidian note."
		);
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Ignore Results");
	});

	it("uses the approved plural copy for already removed ignored highlights", () => {
		const outcome = createAllCleanupOutcomes()[2]!;
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([
				createCleanupResult([outcome, outcome]),
			]),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"2 ignored highlights had already been removed from their Obsidian notes."
		);
	});

	it("uses exact plural copy for safe removals and missing notes", () => {
		const outcomes = createAllCleanupOutcomes();
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([
				createCleanupResult([
					outcomes[0]!,
					outcomes[0]!,
					outcomes[1]!,
					outcomes[1]!,
				]),
			]),
		});

		modal.onOpen();
		const text = readText(modal.contentEl);

		expect(text).toContain("2 highlights were removed from existing Obsidian notes.");
		expect(text).toContain(
			"No matching notes were found for 2 highlights, so no note changes were needed."
		);
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
			"No matching notes were found for 1 highlight, so no note changes were needed."
		);
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

		expect(text).toContain("1 highlight was removed from an existing Obsidian note.");
		expect(text).toContain(
			"No matching notes were found for 1 highlight, so no note changes were needed."
		);
		expect(text).toContain("1 ignored highlight had already been removed from its Obsidian note.");
		expect(text).toContain(
			"No note changes were made for 2 highlights because their existing notes could not be updated safely or unambiguously."
		);
		expect(text).toContain("The existing-note update could not be completed for 1 highlight.");
		expect(text).toContain("The final note state could not be confirmed for 1 highlight.");
		expect(text).not.toContain("Some existing notes were left unchanged");
	});

	it("keeps actionable failure details reachable and restores summary scroll", async () => {
		const modal = createModal({
			ignoreResults: createIgnoreResultsPresentation([
				createCleanupResult([
					createAllCleanupOutcomes()[5]!,
					createAllCleanupOutcomes()[6]!,
				]),
			]),
		});
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();
		setScrollTop(modal.contentEl, 390);
		expect(buttonTexts(modal.contentEl)).not.toContain("Review Ignore Results");
		await findByText(modal.contentEl, "Review Note Update Issues").click();
		expect(elementsByClass(modal.contentEl, "kls-book-card")).toHaveLength(2);
		expect(readText(modal.contentEl)).toContain("It may still contain this highlight.");
		expect(readText(modal.contentEl)).toContain("Check the note before trying again.");
		await findByText(modal.contentEl, "Close").click();
		expect(closeSpy).toHaveBeenCalledTimes(1);
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(scrollTop(modal.contentEl)).toBe(390);
	});
});

describe("SyncSummaryModal missing managed highlight review", () => {
	it("groups by exact book identity with stable book/highlight order and correct counts", async () => {
		const first = createHighlight({ content: "First orchard note.", location: "10" });
		const second = createHighlight({ content: "Second orchard note.", location: "20" });
		const sameTitleDifferentAuthor = createHighlight({
			author: "Another Author",
			content: "Different exact book.",
			location: "30",
		});
		const lumenBay = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			content: "Lumen Bay route detail.",
			location: "40",
		});
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [first, second, sameTitleDifferentAuthor, lumenBay],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		const cards = elementsByClass(modal.contentEl, "kls-book-card");

		expect(cards).toHaveLength(3);
		expect(cards.map((card) => elementByClass(card, "kls-book-title").text())).toEqual([
			"The Clockwork Orchard",
			"The Clockwork Orchard",
			"Night Trains to Lumen Bay",
		]);
		expect(elementByClass(cards[0], "kls-book-author").text()).toBe("Mira Vale");
		expect(elementByClass(cards[0], "kls-book-review-summary").text()).toBe("2 missing highlights");
		expect(elementByClass(cards[1], "kls-book-author").text()).toBe("Another Author");
		expect(elementByClass(cards[1], "kls-book-review-summary").text()).toBe("1 missing highlight");

		await findByText(cards[0], "Review Highlights").click();
		const detailText = readText(modal.contentEl);

		expect(detailText).toContain("First orchard note.");
		expect(detailText).toContain("Second orchard note.");
		expect(detailText).not.toContain("Different exact book.");
		expect(detailText).not.toContain("Lumen Bay route detail.");
		expect(detailText.indexOf("First orchard note.")).toBeLessThan(detailText.indexOf("Second orchard note."));
	});

	it("returns to grouped books and keeps mixed per-highlight decisions across reopening", async () => {
		const first = createHighlight({ content: "Skip this recovery.", location: "10" });
		const second = createHighlight({ content: "Ignore this recovery.", location: "20" });
		const otherBook = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [first, second, otherBook],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"), "Review Highlights").click();
		await buttonsByText(modal.contentEl, "Skip This Time")[0]!.click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();

		expect(elementByClass(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"), "kls-book-review-summary").text())
			.toBe("1 missing highlight");
		await findByText(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"), "Review Highlights").click();
		expect(readText(modal.contentEl)).not.toContain("Skip this recovery.");
		expect(readText(modal.contentEl)).toContain("Ignore this recovery.");
		await findByText(modal.contentEl, "Ignore Going Forward").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();

		expect(plugin.ignoreHighlights).toHaveBeenCalledWith([second], expect.any(CurrentClippingIdentityIndex));
		expect(readText(modal.contentEl)).not.toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
	});

	it("scopes every book-level action to that book's currently missing highlights", async () => {
		const first = createHighlight({ content: "First missing.", location: "10" });
		const second = createHighlight({ content: "Second missing.", location: "20" });
		const otherBook = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [first, second, otherBook],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"), "Import All Again").click();

		expect(plugin.importHighlights).toHaveBeenCalledWith(
			[first, second],
			expect.any(CurrentClippingIdentityIndex),
			true,
			[first, second]
		);
		expect(readText(modal.contentEl)).not.toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
		await findByText(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"), "Ignore All Going Forward").click();
		expect(plugin.ignoreHighlights).toHaveBeenCalledWith([otherBook], expect.any(CurrentClippingIdentityIndex));

		const skipPlugin = createPlugin();
		const skipModal = createModal({
			plugin: skipPlugin,
			classification: createClassification({ possibleReappearedHighlights: [first, otherBook] }),
		});

		skipModal.onOpen();
		await findByText(skipModal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(skipModal.contentEl, "The Clockwork Orchard"), "Skip All This Time").click();
		expect(skipPlugin.importHighlights).not.toHaveBeenCalled();
		expect(skipPlugin.ignoreHighlights).not.toHaveBeenCalled();
		expect(readText(skipModal.contentEl)).not.toContain("The Clockwork Orchard");
		expect(readText(skipModal.contentEl)).toContain("Night Trains to Lumen Bay");
	});

	it("does not restore or persist anything merely from grouped/detail navigation", async () => {
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();

		expect(plugin.importHighlights).not.toHaveBeenCalled();
		expect(plugin.ignoreHighlights).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("1 missing highlight needs review");
	});

	it("restores the selected missing book as the grouped-view return anchor", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [
					createHighlight(),
					createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" }),
				],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 20);
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();

		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"))).toHaveLength(0);
	});

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

		expect(createLegacyClippingId(bookA)).toBe(createLegacyClippingId(bookB));
		expect(createClippingId(bookA)).not.toBe(createClippingId(bookB));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, bookA.bookTitle), "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(plugin.ignoreHighlights).toHaveBeenCalledWith(
			[bookA],
			expect.any(CurrentClippingIdentityIndex)
		);
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
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
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();

		expect(plugin.importHighlights).toHaveBeenCalledWith(
			[highlight],
			expect.any(CurrentClippingIdentityIndex),
			true,
			[highlight]
		);
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("1 new highlight imported");
		expect(readText(modal.contentEl)).not.toContain("missing highlights need review");
	});

	it("removes a skipped recovery item only from the current summary without persisting a decision", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Time").click();

		expect(plugin.importHighlights).not.toHaveBeenCalled();
		expect(plugin.ignoreHighlights).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
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
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
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
		expect(readText(modal.contentEl)).not.toContain("Kindle Highlights/The Clockwork Orchard");
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).not.toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("new highlights imported");
		expect(readText(modal.contentEl)).toContain("1 missing highlight needs review");

		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(readText(modal.contentEl)).toContain(
			"This note was left unchanged. This highlight is still available to try again."
		);
		await findByText(modal.contentEl, "Import Again").click();
		expect(readText(modal.contentEl)).not.toContain("This note was left unchanged.");
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("Sync finished");
		expect(readText(modal.contentEl)).toContain("1 new highlight imported");
	});

	it("keeps a recovery item and count unchanged when the writer contract is invalid", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();

		expect(buttonTexts(modal.contentEl)).toContain("Try Import Again");
		expect(readText(modal.contentEl)).toContain("Import not completed");
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).not.toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("new highlights imported");
		expect(readText(modal.contentEl)).toContain("1 missing highlight needs review");
		consoleError.mockRestore();
	});

	it("shows an accessible retryable Import Again failure and succeeds on retry", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(modal.contentEl, 260);
		await findByText(modal.contentEl, "Import Again").click();

		const failure = elementByClass(modal.contentEl, "kls-operation-failure");

		expect(failure.attributes.get("role")).toBe("alert");
		expect(failure.attributes.get("tabindex")).toBe("-1");
		expect(failure.children[0]?.tagName).toBe("h3");
		expect(failure.focusCalls).toBe(1);
		expect(readText(failure)).toContain("Import not completed");
		expect(readText(failure)).toContain(
			"We couldn’t confirm the final import result. This highlight is still available here. Some note changes may have occurred."
		);
		expect(readText(failure)).not.toContain("left unchanged");
		expect(buttonTexts(modal.contentEl)).toContain("Try Import Again");
		expect(readText(modal.contentEl)).toContain("1 missing highlight");
		expect(scrollTop(modal.contentEl)).toBe(260);

		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync finished");
		expect(readText(modal.contentEl)).not.toContain("Sync complete");
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Try Import Again").click();

		expect(plugin.importHighlights).toHaveBeenCalledTimes(2);
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
		expect(readText(modal.contentEl)).not.toContain("Import not completed");
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(readText(modal.contentEl)).not.toContain("Sync finished");
		expect(readText(modal.contentEl)).toContain("1 new highlight imported");
		expect(readText(modal.contentEl)).not.toContain("2 new highlights imported");
		consoleError.mockRestore();
	});

	it("prevents duplicate Import Again requests while one import is pending", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const pendingImport = createDeferred<HighlightImportResult>();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		plugin.importHighlights.mockReturnValueOnce(pendingImport.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		const importButton = findByText(modal.contentEl, "Import Again");
		const firstClick = importButton.click();

		await Promise.resolve();
		expect(importButton.disabled).toBe(true);
		expect(importButton.attributes.get("aria-busy")).toBe("true");
		expect((modal.contentEl as unknown as TestElement).attributes.get("aria-busy")).toBe("true");
		await importButton.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);

		pendingImport.resolve(createImportResult([highlight]));
		await firstClick;
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
	});

	it.each(["Skip This Time", "Ignore Going Forward"])(
		"blocks %s for the same highlight while Import Again is pending",
		async (actionLabel) => {
			const highlight = createHighlight();
			const plugin = createPlugin();
			const pendingImport = createDeferred<HighlightImportResult>();
			const modal = createModal({
				plugin,
				classification: createClassification({
					possibleReappearedHighlights: [highlight],
				}),
			});

			plugin.importHighlights.mockReturnValueOnce(pendingImport.promise);
			modal.onOpen();
			await findByText(modal.contentEl, "Review Missing Highlights").click();
			await findByText(modal.contentEl, "Review Highlights").click();
			const importButton = findByText(modal.contentEl, "Import Again");
			const importRequest = importButton.click();

			await Promise.resolve();
			const conflictingAction = findByText(modal.contentEl, actionLabel);

			expect(conflictingAction.disabled).toBe(true);
			conflictingAction.disabled = false;
			await conflictingAction.click();
			expect(plugin.ignoreHighlights).not.toHaveBeenCalled();
			expect(readText(modal.contentEl)).toContain(highlight.content);
			expect(readText(modal.contentEl)).toContain("1 missing highlight");

			pendingImport.resolve(createImportResult([highlight]));
			await importRequest;
			expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
		}
	);

	it("retains pending identity locks through Back and reopening", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const pendingImport = createDeferred<HighlightImportResult>();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		plugin.importHighlights.mockReturnValueOnce(pendingImport.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		const importRequest = findByText(modal.contentEl, "Import Again").click();

		await Promise.resolve();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		expect(findByText(modal.contentEl, "Import All Again").disabled).toBe(true);
		expect(findByText(modal.contentEl, "Ignore All Going Forward").disabled).toBe(true);
		expect(findByText(modal.contentEl, "Skip All This Time").disabled).toBe(true);
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(findByText(modal.contentEl, "Import Again").disabled).toBe(true);
		expect(findByText(modal.contentEl, "Ignore Going Forward").disabled).toBe(true);
		expect(findByText(modal.contentEl, "Skip This Time").disabled).toBe(true);

		pendingImport.resolve(createImportResult([highlight]));
		await importRequest;
		expect(readText(modal.contentEl)).toContain("No missing highlights left in this book.");
	});

	it("prevents Import All Again from overlapping a pending per-highlight request", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const pendingImport = createDeferred<HighlightImportResult>();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		plugin.importHighlights.mockReturnValueOnce(pendingImport.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		const importRequest = findByText(modal.contentEl, "Import Again").click();

		await Promise.resolve();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		const importAll = findByText(modal.contentEl, "Import All Again");

		expect(importAll.disabled).toBe(true);
		importAll.disabled = false;
		await importAll.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);

		pendingImport.resolve(createImportResult([highlight]));
		await importRequest;
	});

	it.each([
		["ordinary writer rejection", new Error("Disk write failed.")],
		["invalid writer contract", new InvalidVaultWriteContractError("outcome-count")],
		["settings persistence rejection", new Error("Settings save failed.")],
	] as const)("keeps every bulk recovery item after %s", async (_label, error) => {
		const first = createHighlight();
		const second = createHighlight({
			location: "160",
			content: "Second missing highlight.",
		});
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [first, second],
			}),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockRejectedValueOnce(error);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Import All Again").click();

		const failure = elementByClass(modal.contentEl, "kls-operation-failure");

		expect(failure.attributes.get("role")).toBe("alert");
		expect(failure.focusCalls).toBe(1);
		expect(readText(failure)).toContain(
			"We couldn’t confirm the final import result. These 2 highlights are still available here. Some note changes may have occurred."
		);
		expect(readText(failure)).not.toContain("left unchanged");
		expect(readText(modal.contentEl)).toContain("2 missing highlights");
		expect(buttonTexts(modal.contentEl)).toContain("Try Import All Again");
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	it("prevents duplicate bulk requests and removes items only after a successful retry", async () => {
		const first = createHighlight();
		const second = createHighlight({
			location: "160",
			content: "Second missing highlight.",
		});
		const plugin = createPlugin();
		const retry = createDeferred<HighlightImportResult>();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [first, second],
			}),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights
			.mockRejectedValueOnce(new Error("Disk write failed."))
			.mockReturnValueOnce(retry.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Import All Again").click();
		const retryButton = findByText(modal.contentEl, "Try Import All Again");
		const retryRequest = retryButton.click();

		await Promise.resolve();
		expect(retryButton.disabled).toBe(true);
		expect(retryButton.attributes.get("aria-busy")).toBe("true");
		await retryButton.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(2);
		expect(readText(modal.contentEl)).toContain("2 missing highlights");

		retry.resolve(createImportResult([first, second]));
		await retryRequest;
		expect(readText(modal.contentEl)).toContain("No missing highlights left to review.");
		consoleError.mockRestore();
	});

	it.each([
		["ordinary writer rejection", new Error("Disk write failed.")],
		["invalid writer contract", new InvalidVaultWriteContractError("outcome-count")],
	] as const)("clears stale protected feedback before a retry ends in %s", async (_label, error) => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights
			.mockResolvedValueOnce(createImportResult([highlight], ["protected"]))
			.mockRejectedValueOnce(error);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [highlight] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();
		expect(readText(modal.contentEl)).toContain("This note was left unchanged.");

		await findByText(modal.contentEl, "Import Again").click();

		expect(readText(modal.contentEl)).toContain("Import not completed");
		expect(readText(modal.contentEl)).not.toContain("This note was left unchanged.");
		consoleError.mockRestore();
	});

	it("suppresses protected feedback while a retry is pending and restores it after a validated protected result", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const retry = createDeferred<HighlightImportResult>();

		plugin.importHighlights
			.mockResolvedValueOnce(createImportResult([highlight], ["protected"]))
			.mockReturnValueOnce(retry.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [highlight] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();
		const retryRequest = findByText(modal.contentEl, "Import Again").click();

		await Promise.resolve();
		expect(readText(modal.contentEl)).not.toContain("This note was left unchanged.");
		expect(findByText(modal.contentEl, "Import Again").disabled).toBe(true);

		retry.resolve(createImportResult([highlight], ["protected"]));
		await retryRequest;
		expect(readText(modal.contentEl)).toContain(
			"This note was left unchanged. This highlight is still available to try again."
		);
	});

	it("keeps protected feedback for unrelated identities while another retry is pending", async () => {
		const first = createHighlight();
		const second = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const retry = createDeferred<HighlightImportResult>();

		plugin.importHighlights
			.mockResolvedValueOnce(createImportResult([first], ["protected"]))
			.mockResolvedValueOnce(createImportResult([second], ["protected"]))
			.mockReturnValueOnce(retry.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Review Highlights").click();
		const retryRequest = findByText(modal.contentEl, "Import Again").click();

		await Promise.resolve();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Review Highlights").click();
		expect(readText(modal.contentEl)).toContain("This note was left unchanged.");

		retry.resolve(createImportResult([first], ["protected"]));
		await retryRequest;
	});

	it("serializes rapid individual imports within one exact book and unlocks after settlement", async () => {
		const first = createHighlight();
		const second = createHighlight({ location: "160", content: "Second missing highlight." });
		const plugin = createPlugin();
		const firstImport = createDeferred<HighlightImportResult>();

		plugin.importHighlights.mockReturnValueOnce(firstImport.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		const originalImportButtons = buttonsByText(modal.contentEl, "Import Again");
		const firstRequest = originalImportButtons[0]!.click();

		await Promise.resolve();
		expect(originalImportButtons[1]!.disabled).toBe(true);
		originalImportButtons[1]!.disabled = false;
		await originalImportButtons[1]!.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);

		firstImport.resolve(createImportResult([first]));
		await firstRequest;
		await findByText(modal.contentEl, "Import Again").click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(2);
	});

	it("serializes rapid individual imports across different exact books", async () => {
		const first = createHighlight();
		const second = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const firstImport = createDeferred<HighlightImportResult>();

		plugin.importHighlights.mockReturnValueOnce(firstImport.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Review Highlights").click();
		const firstRequest = findByText(modal.contentEl, "Import Again").click();

		await Promise.resolve();
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Review Highlights").click();
		const secondImport = findByText(modal.contentEl, "Import Again");

		expect(secondImport.disabled).toBe(true);
		secondImport.disabled = false;
		await secondImport.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);

		firstImport.resolve(createImportResult([first]));
		await firstRequest;
	});

	it.each(["Ignore Going Forward", "Skip This Time"])(
		"blocks %s in another book while an import is pending",
		async (actionLabel) => {
			const first = createHighlight();
			const second = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
			const plugin = createPlugin();
			const firstImport = createDeferred<HighlightImportResult>();

			plugin.importHighlights.mockReturnValueOnce(firstImport.promise);
			const modal = createModal({
				plugin,
				classification: createClassification({ possibleReappearedHighlights: [first, second] }),
			});

			modal.onOpen();
			await findByText(modal.contentEl, "Review Missing Highlights").click();
			await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Review Highlights").click();
			const firstRequest = findByText(modal.contentEl, "Import Again").click();

			await Promise.resolve();
			await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
			await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Review Highlights").click();
			const conflictingAction = findByText(modal.contentEl, actionLabel);

			expect(conflictingAction.disabled).toBe(true);
			conflictingAction.disabled = false;
			await conflictingAction.click();
			expect(plugin.ignoreHighlights).not.toHaveBeenCalled();
			expect(readText(modal.contentEl)).toContain(second.content);

			firstImport.resolve(createImportResult([first]));
			await firstRequest;
		}
	);

	it("prevents an individual import from starting while Import All Again is pending", async () => {
		const first = createHighlight();
		const second = createHighlight({ location: "160", content: "Second missing highlight." });
		const plugin = createPlugin();
		const bulkImport = createDeferred<HighlightImportResult>();

		plugin.importHighlights.mockReturnValueOnce(bulkImport.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		const bulkRequest = findByText(modal.contentEl, "Import All Again").click();

		await Promise.resolve();
		await findByText(modal.contentEl, "Review Highlights").click();
		const individualImport = buttonsByText(modal.contentEl, "Import Again")[0]!;

		expect(individualImport.disabled).toBe(true);
		individualImport.disabled = false;
		await individualImport.click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(1);

		bulkImport.resolve(createImportResult([first, second]));
		await bulkRequest;
	});

	it("unlocks recovery mutations after failure", async () => {
		const first = createHighlight();
		const second = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const failedImport = createDeferred<HighlightImportResult>();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockReturnValueOnce(failedImport.promise);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Review Highlights").click();
		const firstRequest = findByText(modal.contentEl, "Import Again").click();

		failedImport.reject(new Error("Disk write failed."));
		await firstRequest;
		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Review Highlights").click();
		expect(findByText(modal.contentEl, "Import Again").disabled).toBe(false);
		await findByText(modal.contentEl, "Import Again").click();
		expect(plugin.importHighlights).toHaveBeenCalledTimes(2);
		consoleError.mockRestore();
	});

	it("clears only the ignored identity's failure state", async () => {
		const first = createHighlight();
		const second = createHighlight({ location: "160", content: "Second missing highlight." });
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Import All Again").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(elementsByClass(modal.contentEl, "kls-operation-failure")).toHaveLength(2);

		await buttonsByText(modal.contentEl, "Ignore Going Forward")[0]!.click();

		expect(plugin.ignoreHighlights).toHaveBeenCalledTimes(1);
		expect(plugin.ignoreHighlights).toHaveBeenCalledWith([first], expect.anything());
		expect(readText(modal.contentEl)).not.toContain(first.content);
		expect(readText(modal.contentEl)).toContain(second.content);
		expect(elementsByClass(modal.contentEl, "kls-operation-failure")).toHaveLength(1);
		expect(readText(modal.contentEl)).toContain("Try Import Again");
		consoleError.mockRestore();
	});

	it("clears only the skipped identity's failure state", async () => {
		const first = createHighlight();
		const second = createHighlight({ location: "160", content: "Second missing highlight." });
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Import All Again").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(elementsByClass(modal.contentEl, "kls-operation-failure")).toHaveLength(2);

		await buttonsByText(modal.contentEl, "Skip This Time")[0]!.click();

		expect(plugin.ignoreHighlights).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).not.toContain(first.content);
		expect(readText(modal.contentEl)).toContain(second.content);
		expect(elementsByClass(modal.contentEl, "kls-operation-failure")).toHaveLength(1);
		expect(readText(modal.contentEl)).toContain("Try Import Again");
		consoleError.mockRestore();
	});

	it("removes only validated completed highlights from a partial bulk result", async () => {
		const first = createHighlight();
		const second = createHighlight({ location: "160", content: "Second missing highlight." });
		const plugin = createPlugin();
		const partialResult = createImportResult([first, second]);

		partialResult.safelyCompletedHighlights = [first];
		partialResult.protectedHighlights = [second];
		plugin.importHighlights.mockResolvedValueOnce(partialResult);
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Import All Again").click();

		expect(readText(modal.contentEl)).toContain("1 missing highlight");
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(readText(modal.contentEl)).not.toContain(first.content);
		expect(readText(modal.contentEl)).toContain(second.content);
		expect(readText(modal.contentEl)).toContain("This note was left unchanged.");
	});

	it("focuses a failed recovery only once after Back and reopening", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import Again").click();
		expect(elementByClass(modal.contentEl, "kls-operation-failure").focusCalls).toBe(1);

		await findButtonByAriaLabel(modal.contentEl, "Back to Missing Highlights").click();
		expect(elementByClass(modal.contentEl, "kls-operation-failure").focusCalls).toBe(0);
		await findByText(modal.contentEl, "Review Highlights").click();
		expect(elementByClass(modal.contentEl, "kls-operation-failure").focusCalls).toBe(0);
		consoleError.mockRestore();
	});

	it("focuses each newly failed book without refocusing an older failure", async () => {
		const first = createHighlight();
		const second = createHighlight({ bookTitle: "Night Trains to Lumen Bay", author: "Owen Hart" });
		const plugin = createPlugin();
		const modal = createModal({
			plugin,
			classification: createClassification({ possibleReappearedHighlights: [first, second] }),
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.importHighlights
			.mockRejectedValueOnce(new Error("First disk write failed."))
			.mockRejectedValueOnce(new Error("Second disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(bookCardByTitle(modal.contentEl, first.bookTitle), "Import All Again").click();
		expect(elementByClass(
			bookCardByTitle(modal.contentEl, first.bookTitle),
			"kls-operation-failure"
		).focusCalls).toBe(1);

		await findByText(bookCardByTitle(modal.contentEl, second.bookTitle), "Import All Again").click();
		const firstFailure = elementByClass(
			bookCardByTitle(modal.contentEl, first.bookTitle),
			"kls-operation-failure"
		);
		const secondFailure = elementByClass(
			bookCardByTitle(modal.contentEl, second.bookTitle),
			"kls-operation-failure"
		);

		expect(firstFailure.focusCalls).toBe(0);
		expect(secondFailure.focusCalls).toBe(1);
		expect(plugin.importHighlights).toHaveBeenCalledTimes(2);
		consoleError.mockRestore();
	});

	it("explains why previously imported highlights need recovery review", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		expect(readText(modal.contentEl)).toContain("1 missing highlight needs review");
		await findByText(modal.contentEl, "Review Missing Highlights").click();

		expect(elementsByClass(modal.contentEl, "kls-review-view-title").map((element) => element.text())).toEqual([
			"Missing Highlights",
		]);
		expect(elementsByClass(modal.contentEl, "kls-review-view-intro").map((element) => element.text())).toEqual([
			"These highlights were imported before, but they’re no longer in their Obsidian notes. Review them and choose whether to import them again, ignore them, or skip them for now.",
			"This may happen if a highlight, note, or synced section was deleted or edited.",
		]);
		expect(buttonTexts(modal.contentEl)).toContain("Back");
		const titleIndex = directChildIndexByClass(modal.contentEl, "kls-review-view-title");
		const backIndex = directChildIndexByClass(modal.contentEl, "kls-review-navigation");
		const introIndex = directChildIndexByClass(modal.contentEl, "kls-review-view-intro");

		expect(backIndex).toBe(titleIndex + 1);
		expect(introIndex).toBe(backIndex + 1);
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Summary").classes.has("kls-review-back-button")).toBe(true);
	});

	it("uses shared button classes in missing managed highlight review rows", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();

		const row = elementByClass(modal.contentEl, "kls-ignored-highlight-item");
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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		setScrollTop(modal.contentEl, 75);
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();

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
		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
		expect(scrollTop(modal.contentEl)).toBe(360);
	});

	it("keeps skipped books view rendered after returning from a book review view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "The Clockwork Orchard" }),
				createSummaryItem({ id: "two", title: "Night Trains to Lumen Bay" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(modal.contentEl, 45);
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(readText(modal.contentEl)).toContain("The Clockwork Orchard");
	});
});

describe("SyncSummaryModal skipped books anchor restoration", () => {
	it("stores the clicked skipped book as a return anchor when Review Highlights is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "The Clockwork Orchard" }),
				createSummaryItem({ id: "two", title: "Night Trains to Lumen Bay" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"), "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(bookCardByTitle(modal.contentEl, "The Clockwork Orchard"))).toHaveLength(0);
	});

	it("scrolls the clicked book back into view when Back to Skipped Books is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "The Clockwork Orchard" }),
				createSummaryItem({ id: "two", title: "Night Trains to Lumen Bay" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 10);
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

		const lumenBaySection = bookCardByTitle(modal.contentEl, "Night Trains to Lumen Bay");

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(scrollIntoViewCalls(lumenBaySection)).toEqual([{ block: "center" }]);
	});

	it("falls back safely when the return anchor no longer exists", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [
				createSummaryItem({ id: "one", title: "The Clockwork Orchard" }),
			],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		setScrollTop(modal.contentEl, 280);
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();
		setScrollTop(modal.contentEl, 10);
		await findButtonByAriaLabel(modal.contentEl, "Back to Skipped Books").click();

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
		await findByText(modal.contentEl, "Manage Ignored Highlights").click();
		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignored highlights");

		await findButtonByAriaLabel(modal.contentEl, "Back to Summary").click();
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
				ignoredAt: "2099-07-09T00:00:00.000Z",
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
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
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
		title: "The Clockwork Orchard",
		author: "Mira Vale",
		textPreview: "Clockwork apples chime at midnight.",
		ignoredAt: "2099-07-09T12:00:00.000Z",
		...overrides,
	};
}

function createSummaryItem(overrides: Partial<SyncSummaryHighlightItem> = {}): SyncSummaryHighlightItem {
	return {
		id: "kls-skipped",
		title: "The Clockwork Orchard",
		author: "Mira Vale",
		textPreview: "Clockwork apples chime at midnight.",
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
	disabled: boolean;
	focusCalls: number;
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolver, rejecter) => {
		resolve = resolver;
		reject = rejecter;
	});

	return { promise, resolve, reject };
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

function findButtonByAriaLabel(element: unknown, label: string): TestElement {
	const buttons: TestElement[] = [];

	collectElementsByTag(element as TestElement, "button", buttons);
	const match = buttons.find((button) => button.attributes.get("aria-label") === label);
	if (!match) {
		throw new Error(`Could not find button with aria-label: ${label}`);
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

function directChildIndexByClass(element: unknown, className: string): number {
	return (element as TestElement).children.findIndex((child) => child.classes.has(className));
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
