import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { KindleHighlight } from "./parser/parseClippings";
import { IgnoredHighlight } from "./settings";
import { SyncClassification } from "./sync/SyncClassifier";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

let SyncSummaryModal: typeof import("./SyncSummaryModal").SyncSummaryModal;

beforeAll(async () => {
	SyncSummaryModal = (await import("./SyncSummaryModal")).SyncSummaryModal;
});

describe("SyncSummaryModal ignored highlights navigation", () => {
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
			}),
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		const actionRow = elementByClass(modal.contentEl, "kls-summary-actions");
		const actionButtons = elementsByClass(actionRow, "kls-action-button");

		expect(elementsByClass(modal.contentEl, "kls-summary-actions")).toHaveLength(1);
		expect(actionRow.classes.has("kls-button-row")).toBe(true);
		expect(actionButtons.map((button) => button.text())).toEqual([
			"View Ignored Highlights",
			"Review Skipped This Sync",
			"Close",
		]);
		expect(findByText(actionRow, "Close").classes.has("mod-cta")).toBe(false);
		expect(findByText(actionRow, "Close").classes.has("mod-warning")).toBe(false);
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
			"Review Suspicious Items",
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

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("one");
		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("two");
		expect(plugin.unignoreHighlight).not.toHaveBeenCalledWith("three");
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

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("kls-ignored");
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

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("kls-ignored");
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

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlight);
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

	it("adds all skipped highlights from a book to ignoredHighlights when Ignore All Highlights is clicked", async () => {
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

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlights[0]);
		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlights[1]);
	});

	it("shows empty state when all skipped highlights are handled", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(readText(modal.contentEl)).toContain("No skipped highlights left to review.");
	});
});

describe("SyncSummaryModal suspicious item button styling", () => {
	it("shows Back to Summary in suspicious item review", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Suspicious Items").click();

		expect(buttonTexts(modal.contentEl)).toContain("Back to Summary");
	});

	it("uses shared button classes in suspicious item review rows", async () => {
		const modal = createModal({
			classification: createClassification({
				possibleReappearedHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Suspicious Items").click();

		const row = elementByClass(modal.contentEl, "kls-highlight-row");
		const buttonRow = elementByClass(row, "kls-button-row");

		expect(elementsByClass(buttonRow, "kls-action-button").map((button) => button.text())).toEqual([
			"Import Again",
			"Ignore Forever",
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
} = {}) {
	return new SyncSummaryModal(new App() as never, (options.plugin ?? createPlugin()) as never, {
		classification: options.classification ?? createClassification(),
		automaticHighlights: [],
		importedCount: 0,
		skippedThisSyncHighlights: options.skippedThisSyncHighlights ?? [],
	});
}

function createPlugin(options: { ignoredHighlights?: IgnoredHighlight[] } = {}) {
	const settings = {
		ignoredHighlights: [...(options.ignoredHighlights ?? [])],
	};

	return {
		importHighlights: vi.fn(async () => {}),
		ignoreHighlights: vi.fn(async () => {}),
		ignoreSummaryHighlight: vi.fn(async (highlight: SyncSummaryHighlightItem) => {
			settings.ignoredHighlights = settings.ignoredHighlights.filter((existing) => existing.id !== highlight.id);
			settings.ignoredHighlights.push({
				id: highlight.id,
				title: highlight.title,
				textPreview: highlight.textPreview,
				ignoredAt: "2026-07-09T00:00:00.000Z",
				lang: highlight.lang,
			});
		}),
		unignoreHighlight: vi.fn(async (id: string) => {
			settings.ignoredHighlights = settings.ignoredHighlights.filter((highlight) => highlight.id !== id);
		}),
		settings,
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

function createIgnoredHighlight(overrides: Partial<IgnoredHighlight> = {}): IgnoredHighlight {
	return {
		id: "kls-ignored",
		title: "Atomic Habits",
		textPreview: "Small habits make a big difference.",
		ignoredAt: "2026-07-09T12:00:00.000Z",
		...overrides,
	};
}

function createSummaryItem(overrides: Partial<SyncSummaryHighlightItem> = {}): SyncSummaryHighlightItem {
	return {
		id: "kls-skipped",
		title: "Atomic Habits",
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
