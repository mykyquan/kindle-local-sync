import { beforeAll, describe, expect, it, vi } from "vitest";
import { App, Notice } from "../__mocks__/obsidian";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import type { SyncCompletionResult } from "./FirstSyncPreviewModal";
import { InvalidVaultWriteContractError } from "./sync/VaultWriteContract";

let FirstSyncPreviewModal: typeof import("./FirstSyncPreviewModal").FirstSyncPreviewModal;

beforeAll(async () => {
	FirstSyncPreviewModal = (await import("./FirstSyncPreviewModal")).FirstSyncPreviewModal;
});

describe("FirstSyncPreviewModal skip and ignore behavior", () => {
	it("uses the actual imported count returned by completion", async () => {
		const plugin = createPlugin();
		const importedCounts: number[] = [];
		const modal = createModal(plugin, [createBookGroup()], {
			completionNotice: (importedCount) => {
				importedCounts.push(importedCount);
				return `Imported ${importedCount}`;
			},
		});
		plugin.completeFirstSync.mockResolvedValueOnce({
			importedCount: 1,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await buttonByTextAt(modal.contentEl, "Finish Sync", -1).click();

		expect(importedCounts).toEqual([1]);
	});

	it("uses finished wording when a selected import was protected", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const createCompletionNotice = (modal as unknown as {
			createCompletionNotice(result: SyncCompletionResult): string;
		}).createCompletionNotice.bind(modal);

		expect(createCompletionNotice({
			importedCount: 0,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 1,
		})).toBe("First sync finished: 0 highlights imported.");
	});

	it("keeps completion wording after a fully successful first sync", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const createCompletionNotice = (modal as unknown as {
			createCompletionNotice(result: SyncCompletionResult): string;
		}).createCompletionNotice.bind(modal);

		expect(createCompletionNotice({
			importedCount: 2,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		})).toBe("First sync complete: 2 highlights imported.");
	});

	it("labels book skip as Skip This Sync", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Skip This Sync");
		expect(readText(modal.contentEl)).not.toContain("Skip book");
	});

	it("does not persist skipped book highlights to ignoredHighlights", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith(
			[],
			[],
			expect.any(Array),
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("adds all book highlights to ignoredHighlights when Ignore All is clicked", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await chooseIgnoreAll(modal);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith(
			[],
			group.clippings,
			[],
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("keeps per-highlight skip non-persistent", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith(
			[],
			[],
			expect.any(Array),
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("keeps a per-highlight Ignore decision scoped when real clipping IDs collide", async () => {
		const plugin = createPlugin();
		const bookA = createCollisionBookGroup("Collision 1h0o65e 20hu");
		const bookB = createCollisionBookGroup("Collision 1y0rlvz 2269");
		const modal = createModal(plugin, [bookA, bookB]);

		expect(createClippingId(bookA.clippings[0]!)).toBe(createClippingId(bookB.clippings[0]!));
		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, `1 / 2 — ${bookA.bookTitle}`), "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const [imports, ignores, skipped] = plugin.completeFirstSync.mock.calls[0]!;

		expect(imports).toEqual([]);
		expect(ignores).toEqual(bookA.clippings);
		expect(skipped).toEqual([expect.objectContaining({
			id: createClippingId(bookB.clippings[0]!),
			title: bookB.bookTitle,
			author: bookB.author,
		})]);
	});

	it("keeps Ignore All scoped to its exact book when real clipping IDs collide", async () => {
		const plugin = createPlugin();
		const bookA = createCollisionBookGroup("Collision 1h0o65e 20hu");
		const bookB = createCollisionBookGroup("Collision 1y0rlvz 2269");
		const modal = createModal(plugin, [bookA, bookB]);

		modal.onOpen();
		await chooseIgnoreAll(
			modal,
			findSectionByHeading(modal.contentEl, `1 / 2 — ${bookA.bookTitle}`)
		);
		await findByText(findSectionByHeading(modal.contentEl, `2 / 2 — ${bookB.bookTitle}`), "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const [imports, ignores, skipped] = plugin.completeFirstSync.mock.calls[0]!;

		expect(imports).toEqual(bookB.clippings);
		expect(ignores).toEqual(bookA.clippings);
		expect(skipped).toEqual([]);
	});
});

describe("FirstSyncPreviewModal wording and layout", () => {
	it("uses Title Case button labels in First Sync Preview", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Review Highlights",
			"Import All",
			"Ignore All",
			"Skip This Sync",
			"Finish Sync",
		]));

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back",
			"Import",
			"Skip This Sync",
			"Ignore",
		]));
	});

	it("shows Ignore All instead of Ignore book", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Ignore All");
		expect(readText(modal.contentEl)).not.toContain("Ignore All Highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignore book");
	});

	it("places Review Highlights last in the shared book action row as a shared glass button", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const actions = elementByClassAt(modal.contentEl, "kls-book-actions", 0);
		expect(buttonTexts(actions)).toEqual([
			"Import All",
			"Skip This Sync",
			"Ignore All",
			"Review Highlights",
		]);
		const reviewButton = findByText(actions, "Review Highlights");
		expect(reviewButton.classes.has("kls-review-action-button")).toBe(true);
		expect(reviewButton.classes.has("kls-pill-button")).toBe(true);
		expect(reviewButton.classes.has("kls-action-button")).toBe(true);
		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
	});

	it("keeps book-list help hidden by default and expands or collapses it from the shared action button", async () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();

		const trigger = findByText(modal.contentEl, "How choices work");
		const helpPanel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);

		expect(trigger.classes.has("kls-pill-button")).toBe(true);
		expect(trigger.classes.has("kls-glass-subtle")).toBe(true);
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(trigger.attributes.get("aria-controls")).toBe("kls-book-list-choice-help");
		expect(helpPanel.attributes.get("id")).toBe("kls-book-list-choice-help");
		expect(helpPanel.attributes.has("hidden")).toBe(true);
		expect(helpPanel.attributes.get("role")).toBe("note");
		expect(helpPanel.attributes.get("aria-label")).toBe("How choices work");

		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("true");
		expect(helpPanel.attributes.has("hidden")).toBe(false);

		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(helpPanel.attributes.has("hidden")).toBe(true);
	});

	it("does not repeat the choices help under each book", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-choice-help-button")).toHaveLength(1);
		expect(elementsByClass(modal.contentEl, "kls-choice-help-panel")).toHaveLength(1);
	});

	it("keeps Ignore All behavior unchanged", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith(
			[],
			group.clippings,
			[],
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("styles Ignore All as a neutral secondary action", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const ignoreAll = findByText(modal.contentEl, "Ignore All");

		expect(ignoreAll.classes.has("kls-pill-button")).toBe(true);
		expect(ignoreAll.classes.has("mod-warning")).toBe(false);
		expect(ignoreAll.classes.has("kls-glass-subtle")).toBe(true);
		expect(ignoreAll.classes.has("kls-glass-strong")).toBe(false);
	});
});

describe("FirstSyncPreviewModal UI polish", () => {
	it("uses the shared pill and glass hierarchy for preview controls", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		expect(elementsByClass(modal.contentEl, "kls-glass-scope")).toHaveLength(1);

		for (const label of ["Import All", "Skip This Sync", "Cancel"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-pill-button")).toBe(true);
			expect(button.classes.has("kls-glass-subtle")).toBe(true);
			expect(button.classes.has("kls-glass-strong")).toBe(false);
			expect(button.classes.has("mod-cta")).toBe(false);
		}
		expect(buttonByTextAt(modal.contentEl, "Import All", 0).attributes.get("aria-pressed")).toBe("false");
		const reviewButton = findByText(modal.contentEl, "Review Highlights");
		expect(reviewButton.classes.has("kls-review-action-button")).toBe(true);
		expect(reviewButton.classes.has("kls-pill-button")).toBe(true);
		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(reviewButton.classes.has("kls-decision-button-active")).toBe(false);
		expect(reviewButton.attributes.get("aria-pressed")).toBeUndefined();

		for (const label of ["Finish Sync"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-pill-button")).toBe(true);
			expect(button.classes.has("kls-glass-strong")).toBe(true);
			expect(button.classes.has("mod-cta")).toBe(true);
		}
	});

	it("keeps filter controls identifiable while switching active glass treatment", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const all = findByText(modal.contentEl, "All Books");
		const needsReview = findByText(modal.contentEl, "Needs Review");
		const reviewed = findByText(modal.contentEl, "Reviewed");

		for (const button of [all, needsReview, reviewed]) {
			expect(button.classes.has("kls-book-filter-button")).toBe(true);
			expect(button.classes.has("kls-pill-button")).toBe(true);
			expect(button.classes.has("kls-action-button")).toBe(true);
		}
		expect(all.classes.has("kls-book-filter-button-active")).toBe(true);
		expect(all.classes.has("kls-glass-strong")).toBe(true);
		expect(all.attributes.get("aria-pressed")).toBe("true");
		expect(needsReview.classes.has("kls-glass-subtle")).toBe(true);
		expect(needsReview.attributes.get("aria-pressed")).toBe("false");
		expect(reviewed.classes.has("kls-glass-subtle")).toBe(true);

		await needsReview.click();

		expect(all.classes.has("kls-book-filter-button-active")).toBe(false);
		expect(all.classes.has("kls-glass-subtle")).toBe(true);
		expect(all.classes.has("kls-glass-strong")).toBe(false);
		expect(all.attributes.get("aria-pressed")).toBe("false");
		expect(needsReview.classes.has("kls-book-filter-button-active")).toBe(true);
		expect(needsReview.classes.has("kls-glass-strong")).toBe(true);
		expect(needsReview.classes.has("kls-glass-subtle")).toBe(false);
		expect(needsReview.attributes.get("aria-pressed")).toBe("true");
	});

	it("uses the same semantic help content in both disclosure locations", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const listPanel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);
		const listContent = helpContentSnapshot(modal.contentEl);
		const listStructure = helpStructureSnapshot(listPanel);
		await findByText(modal.contentEl, "Review Highlights").click();
		const detailPanel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);
		const detailContent = helpContentSnapshot(modal.contentEl);

		expect(detailContent).toEqual(listContent);
		expect(helpStructureSnapshot(detailPanel)).toEqual(listStructure);
		expect(listStructure).toEqual({
			panelClasses: ["kls-choice-help-panel"],
			panelChildren: ["p", "dl", "p"],
			definitionChildren: [
				"dt", "dd", "dt", "dd", "dt", "dd", "dt", "dd", "dt", "dd", "dt", "dd",
			],
		});
		expect(detailContent).toEqual({
			terms: [
				"Import All Books", "Import All", "Ignore All", "Skip This Sync", "Review Highlights", "Finish Sync",
			],
			descriptions: [
				"Selects every book in this review. Choices made here change to Import.",
				"Choose Import for every highlight in this book.",
				"Keep every highlight out of future syncs until you remove it from Ignored Highlights.",
				"Skip this book once — its highlights may return next sync.",
				"Choose Import, Skip, or Ignore one highlight at a time.",
				"Save your choices and sync. Highlights still needing review are skipped this time.",
			],
			opening: "How choices work: Your choices are temporary until you select Finish Sync.",
			status: "Reviewed: every highlight has a choice. Needs Review: at least one highlight still needs a choice.",
		});
		expect(elementsByTag(modal.contentEl, "dl")).toHaveLength(1);
	});

	it("keeps detail help hidden by default and supports click and Escape dismissal", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		const trigger = findButtonByAriaLabel(modal.contentEl, "Show how choices work");
		const helpPanel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);

		expect(trigger.text()).toBe("?");
		expect(trigger.classes.has("kls-choice-help-icon")).toBe(true);
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(trigger.attributes.get("aria-controls")).toBe("kls-highlight-choice-help");
		expect(helpPanel.attributes.has("hidden")).toBe(true);

		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("true");
		expect(helpPanel.attributes.has("hidden")).toBe(false);

		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(helpPanel.attributes.has("hidden")).toBe(true);

		await trigger.click();
		await trigger.keydown("Escape");
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(helpPanel.attributes.has("hidden")).toBe(true);
		expect(trigger.focusCalls).toBe(1);
	});

	it("opens book-list help without resetting selections, filters, search, or scroll", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Reviewed").click();
		await searchBooks(modal, "Clockwork");
		const input = elementsByTag(modal.contentEl, "input")[0];
		const body = elementByClassAt(modal.contentEl, "kls-modal-scroll-body", 0);
		const trigger = findByText(modal.contentEl, "How choices work");

		setScrollTop(body, 180);
		await trigger.click();

		expect(elementsByTag(modal.contentEl, "input")[0]).toBe(input);
		expect(input?.value).toBe("Clockwork");
		expect(findByText(modal.contentEl, "Reviewed").attributes.get("aria-pressed")).toBe("true");
		expect(findByText(modal.contentEl, "Import All").attributes.get("aria-pressed")).toBe("true");
		expect(scrollTop(body)).toBe(180);
	});

	it("opens detail help without resetting a selection or highlight-list scroll", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		const highlights = elementByClassAt(modal.contentEl, "kls-book-detail-highlights", 0);
		const detail = elementByClassAt(modal.contentEl, "kls-book-detail-view", 0);
		const header = elementByClassAt(detail, "kls-book-detail-header", 0);
		const headerIndex = directChildIndexByClass(detail, "kls-book-detail-header");
		const highlightsIndex = directChildIndexByClass(detail, "kls-book-detail-highlights");
		const trigger = findButtonByAriaLabel(modal.contentEl, "Show how choices work");

		setScrollTop(highlights, 175);
		await trigger.click();

		expect(findByText(modal.contentEl, "Import").attributes.get("aria-pressed")).toBe("true");
		expect(scrollTop(highlights)).toBe(175);
		expect(elementByClassAt(modal.contentEl, "kls-book-detail-header", 0)).toBe(header);
		expect(elementByClassAt(modal.contentEl, "kls-book-detail-highlights", 0)).toBe(highlights);
		expect(directChildIndexByClass(detail, "kls-book-detail-header")).toBe(headerIndex);
		expect(directChildIndexByClass(detail, "kls-book-detail-highlights")).toBe(highlightsIndex);
	});

	it("places detail help after the header and before the independently scrollable highlight list", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		const body = elementByClassAt(modal.contentEl, "kls-modal-scroll-body", 0);
		const detail = elementByClassAt(body, "kls-book-detail-view", 0);
		const headerIndex = directChildIndexByClass(detail, "kls-book-detail-header");
		const helpIndex = directChildIndexByClass(detail, "kls-choice-help-panel");
		const highlightsIndex = directChildIndexByClass(detail, "kls-book-detail-highlights");

		expect(body.classes.has("kls-highlight-review-layout")).toBe(true);
		expect(headerIndex).toBeLessThan(helpIndex);
		expect(helpIndex).toBeLessThan(highlightsIndex);
	});

	it("explains count meanings, actions, and Finish Sync clearly", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Show how choices work").click();

		const text = readText(modal.contentEl);
		expect(text).toContain("Your choices are temporary until you select Finish Sync.");
		expect(readText(modal.contentEl)).toContain("Finish Sync");
		expect(text).toContain("Choose Import for every highlight in this book.");
		expect(text).toContain("Keep every highlight out of future syncs until you remove it from Ignored Highlights.");
		expect(text).toContain("Skip this book once — its highlights may return next sync.");
		expect(text).toContain("Choose Import, Skip, or Ignore one highlight at a time.");
		expect(text).toContain("Save your choices and sync. Highlights still needing review are skipped this time.");
		expect(text).toContain("Reviewed: every highlight has a choice.");
		expect(text).toContain("Needs Review: at least one highlight still needs a choice.");
		expect(text).not.toContain("Checked");
		expect(text).not.toContain("Need Review");
		expect(readText(modal.contentEl)).not.toContain("unselected highlights");
		const panelText = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0).text();
		const panel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);

		expect(panelText.indexOf("Your choices are temporary until you select Finish Sync."))
			.toBeLessThan(panelText.indexOf("Import All"));
		expect(panelText.indexOf("Finish Sync"))
			.toBeLessThan(panelText.indexOf("Reviewed: every highlight has a choice."));
		expect(directChildIndexByClass(panel, "kls-choice-help"))
			.toBeLessThan(directChildIndexByClass(panel, "kls-choice-help-status"));
		expect(elementsByTag(modal.contentEl, "dl")).toHaveLength(1);
	});

	it("places the book-list help trigger and card before search, filters, progress, and books", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const body = elementByClassAt(modal.contentEl, "kls-modal-scroll-body", 0);
		const stickyIndex = directChildIndexByClass(body, "kls-review-sticky-summary");
		const bookListIndex = directChildIndexByClass(body, "kls-book-list");
		const stickySummary = elementByClassAt(body, "kls-review-sticky-summary", 0);
		const controlsPanel = elementByClassAt(stickySummary, "kls-review-controls-panel", 0);
		const helpButtonIndex = directChildIndexByClass(controlsPanel, "kls-choice-help-button");
		const helpPanelIndex = directChildIndexByClass(controlsPanel, "kls-choice-help-panel");
		const controlsIndex = directChildIndexByClass(controlsPanel, "kls-book-list-controls");
		const compactProgressIndex = directChildIndexByClass(controlsPanel, "kls-compact-review-progress");

		expect(stickyIndex).toBeGreaterThan(-1);
		expect(elementsByClass(body, "kls-review-controls-panel")).toHaveLength(1);
		expect(elementsByClass(body, "kls-book-list-controls")).toHaveLength(1);
		expect(elementsByClass(body, "kls-review-modal-heading")).toHaveLength(1);
		expect(elementsByClass(controlsPanel, "kls-choice-help-button")).toHaveLength(1);
		expect(elementByClassAt(controlsPanel, "kls-choice-help-panel", 0).attributes.get("role")).toBe("note");
		expect(elementsByClass(body, "kls-compact-review-progress")).toHaveLength(1);
		expect(elementsByClass(body, "kls-review-progress")).toHaveLength(0);
		expect(helpButtonIndex).toBeLessThan(helpPanelIndex);
		expect(helpPanelIndex).toBeLessThan(controlsIndex);
		expect(controlsIndex).toBeLessThan(compactProgressIndex);
		expect(bookListIndex).toBeGreaterThan(stickyIndex);
	});

	it("shows the full detail help content only once", async () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Show how choices work").click();

		expect(countText(
			readText(modal.contentEl),
			"Skip this book once — its highlights may return next sync."
		)).toBe(1);
	});

	it("omits Help from the Review New Highlights finish confirmation", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()], {
			title: "Review New Highlights",
		});

		modal.onOpen();
		expect(elementsByClass(modal.contentEl, "kls-choice-help-button")).toHaveLength(1);
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(readText(modal.contentEl)).toContain("Some highlights have not been reviewed.");
		expect(elementsByClass(modal.contentEl, "kls-choice-help-button")).toHaveLength(0);
	});

	it("orders per-highlight buttons as Import, Skip This Sync, Ignore", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		const buttons = buttonTexts(modal.contentEl);
		const importIndex = buttons.indexOf("Import");
		const skipIndex = buttons.indexOf("Skip This Sync");
		const ignoreIndex = buttons.indexOf("Ignore");

		expect(importIndex).toBeGreaterThan(-1);
		expect(importIndex).toBeLessThan(skipIndex);
		expect(skipIndex).toBeLessThan(ignoreIndex);
	});

	it("does not show an active per-highlight decision before a choice is selected", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(findByText(modal.contentEl, "Import").classes.has("mod-cta")).toBe(false);
		expect(findByText(modal.contentEl, "Import").classes.has("kls-decision-button-active")).toBe(false);
	});

	it("does not style per-highlight Ignore as mod-warning", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(findByText(modal.contentEl, "Ignore").classes.has("mod-warning")).toBe(false);
	});
});

describe("FirstSyncPreviewModal book dashboard controls", () => {
	it("filters books by title search", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await searchBooks(modal, "Lumen");

		expect(readText(modal.contentEl)).toContain("Night Trains to Lumen Bay");
		expect(readText(modal.contentEl)).not.toContain("The Clockwork Orchard");
	});

	it("filters books by title case-insensitively", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await searchBooks(modal, "clockwork");

		expect(readText(modal.contentEl)).toContain("The Clockwork Orchard");
		expect(readText(modal.contentEl)).not.toContain("Night Trains to Lumen Bay");
	});

	it("filters books by author search", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard", "Mira Vale"),
			createBookGroup("Winter on the Glass Moon", "Avery Sol"),
		]);

		modal.onOpen();
		await searchBooks(modal, "avery");

		expect(readText(modal.contentEl)).toContain("Winter on the Glass Moon");
		expect(readText(modal.contentEl)).not.toContain("The Clockwork Orchard");
	});

	it("keeps the search input mounted and typed value intact while filtering", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const input = elementsByTag(modal.contentEl, "input")[0];

		if (!input) {
			throw new Error("Could not find book search input.");
		}

		await input.input("Lu");

		expect(elementsByTag(modal.contentEl, "input")[0]).toBe(input);
		expect(input.value).toBe("Lu");
		expect(bookHeadings(modal)).toEqual(["2 / 2 — Night Trains to Lumen Bay"]);
	});

	it("renders the search input without a search icon button", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const inputs = elementsByTag(modal.contentEl, "input");

		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.type).toBe("search");
		expect(inputs[0]?.placeholder).toBe("Search books...");
		expect(elementsByClass(modal.contentEl, "kls-book-search-button")).toHaveLength(0);
	});

	it("renders search and filter controls inside the book list controls", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const controls = elementByClassAt(modal.contentEl, "kls-book-list-controls", 0);
		const searchControl = elementByClassAt(controls, "kls-book-search-control", 0);
		const filters = elementByClassAt(controls, "kls-book-filter-row", 0);

		expect(elementsByTag(searchControl, "input")).toHaveLength(1);
		expect(elementsByClass(searchControl, "kls-book-search-button")).toHaveLength(0);
		expect(buttonTexts(filters)).toEqual(["All Books", "Needs Review", "Reviewed"]);
	});

	it("keeps search text and visible filtering while typing", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const input = elementsByTag(modal.contentEl, "input")[0];

		if (!input) {
			throw new Error("Could not find book search input.");
		}

		await input.input("Lumen");
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 160);
		setScrollTop(modal.contentEl, 160);

		expect(input.value).toBe("Lumen");
		expect(bookHeadings(modal)).toEqual(["2 / 2 — Night Trains to Lumen Bay"]);
		expect(scrollTop(modal.contentEl)).toBe(160);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(160);
	});

	it("does not reset selected decisions when search text changes", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();
		await searchBooks(modal, "Lumen");
		await searchBooks(modal, "");

		const clockworkOrchard = findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard");
		const importAll = buttonByTextAt(clockworkOrchard, "Import All", 0);

		expect(readText(clockworkOrchard)).toContain("Import All");
		expect(importAll.classes.has("kls-decision-button-active-import")).toBe(true);
		expect(importAll.attributes.get("aria-pressed")).toBe("true");
	});

	it("does not change scroll position while searching", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 210);
		setScrollTop(modal.contentEl, 210);
		await searchBooks(modal, "Lumen");

		expect(scrollTop(modal.contentEl)).toBe(210);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(210);
	});

	it("shows an empty state when no books match search", async () => {
		const modal = createModal(createPlugin(), [createBookGroup("The Clockwork Orchard")]);

		modal.onOpen();
		await searchBooks(modal, "missing");

		expect(readText(modal.contentEl)).toContain("No matching books.");
		expect(elementsByClass(modal.contentEl, "kls-book-section")).toHaveLength(0);
	});

	it("filters All Books, Needs Review, and Reviewed books", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();

		await findByText(modal.contentEl, "Needs Review").click();
		expect(bookHeadings(modal)).toEqual(["2 / 2 — Night Trains to Lumen Bay"]);

		await findByText(modal.contentEl, "Reviewed").click();
		expect(bookHeadings(modal)).toEqual(["1 / 2 — The Clockwork Orchard"]);

		await findByText(modal.contentEl, "All Books").click();
		expect(bookHeadings(modal)).toEqual([
			"1 / 2 — The Clockwork Orchard",
			"2 / 2 — Night Trains to Lumen Bay",
		]);
	});

	it("preserves the original My Clippings book order instead of sorting alphabetically", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Zebra Notes"),
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		expect(bookHeadings(modal)).toEqual([
			"1 / 3 — Zebra Notes",
			"2 / 3 — The Clockwork Orchard",
			"3 / 3 — Night Trains to Lumen Bay",
		]);

		await findByText(findSectionByHeading(modal.contentEl, "2 / 3 — The Clockwork Orchard"), "Import All").click();
		expect(bookHeadings(modal)).toEqual([
			"1 / 3 — Zebra Notes",
			"2 / 3 — The Clockwork Orchard",
			"3 / 3 — Night Trains to Lumen Bay",
		]);
	});

	it("preserves original relative order while search hides non-matching books", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Zebra Notes", "Morgan Field"),
			createBookGroup("The Clockwork Orchard", "Mira Vale"),
			createBookGroup("Night Trains to Lumen Bay", "Morgan Field"),
		]);

		modal.onOpen();
		await searchBooks(modal, "morgan");

		expect(bookHeadings(modal)).toEqual([
			"1 / 3 — Zebra Notes",
			"3 / 3 — Night Trains to Lumen Bay",
		]);
	});

	it("combines search and status filter", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();
		await searchBooks(modal, "Lumen");
		await findByText(modal.contentEl, "Reviewed").click();

		expect(readText(modal.contentEl)).toContain("No matching books.");

		await findByText(modal.contentEl, "Needs Review").click();
		expect(bookHeadings(modal)).toEqual(["2 / 2 — Night Trains to Lumen Bay"]);
	});

	it("does not reset selected decisions while filtering and searching", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();
		await searchBooks(modal, "Lumen");
		await searchBooks(modal, "");

		const clockworkOrchard = findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard");
		const importAll = buttonByTextAt(clockworkOrchard, "Import All", 0);

		expect(readText(clockworkOrchard)).toContain("Import All");
		expect(importAll.classes.has("kls-decision-button-active-import")).toBe(true);
		expect(importAll.attributes.get("aria-pressed")).toBe("true");
	});

	it("keeps review progress global while search is active", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();
		await searchBooks(modal, "Lumen");

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 1/2 books · Needs Review: 1 book · Ignore: 0 highlights · Skip: 0 highlights"
		);
	});

	it("keeps the status in the header and Review Highlights in the action row", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const header = elementByClassAt(modal.contentEl, "kls-book-header", 0);
		const actions = elementByClassAt(modal.contentEl, "kls-book-actions", 0);

		expect(elementByClassAt(header, "kls-book-index", 0).text()).toBe("1 / 1");
		expect(elementByClassAt(header, "kls-book-title", 0).text()).toBe("The Clockwork Orchard");
		expect(buttonTexts(header)).toEqual([]);
		expect(buttonTexts(actions)).toEqual([
			"Import All", "Skip This Sync", "Ignore All", "Review Highlights",
		]);
	});

	it("renders each book as a shared card container", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-book-card")).toHaveLength(2);
		expect(elementsByClass(modal.contentEl, "kls-book-section")).toHaveLength(2);
	});

	it("renders long book titles inside the card header structure", () => {
		const longTitle = "A".repeat(140);
		const modal = createModal(createPlugin(), [createBookGroup(longTitle)]);

		modal.onOpen();
		const card = elementByClassAt(modal.contentEl, "kls-book-card", 0);
		const header = elementByClassAt(card, "kls-book-header", 0);
		const title = elementByClassAt(header, "kls-book-title", 0);

		expect(elementByClassAt(header, "kls-book-index", 0).text()).toBe("1 / 1");
		expect(title.text()).toBe(longTitle);
		expect(title.attributes.get("aria-label")).toBe(longTitle);
		expect(title.attributes.get("title")).toBe(longTitle);
		expect(buttonTexts(header)).toEqual([]);
		expect(buttonTexts(card)).toEqual([
			"Import All",
			"Skip This Sync",
			"Ignore All",
			"Review Highlights",
		]);
	});

	it("renders every stored title variant together without inferring or reordering languages", () => {
		const group = createBookGroup("Café at Dawn", "Mira Vale");

		group.clippings[1]!.bookTitle = "Dawn Café – Illustrated Edition";
		const modal = createModal(createPlugin(), [group]);
		const combinedTitle = "Café at Dawn · Dawn Café – Illustrated Edition";

		modal.onOpen();
		const card = elementByClassAt(modal.contentEl, "kls-book-card", 0);
		const title = elementByClassAt(card, "kls-book-title", 0);
		const authors = elementsByClass(card, "kls-book-meta");

		expect(elementByClassAt(card, "kls-book-index", 0).text()).toBe("1 / 1");
		expect(title.text()).toBe(combinedTitle);
		expect(title.attributes.get("aria-label")).toBe(combinedTitle);
		expect(title.attributes.get("title")).toBe(combinedTitle);
		expect(authors.map((author) => author.text())).toEqual(["Mira Vale"]);
		expect(authors[0]?.attributes.get("title")).toBe("Mira Vale");
	});

	it("keeps Review Highlights and per-book action buttons inside the same card", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const card = elementByClassAt(modal.contentEl, "kls-book-card", 0);
		const header = elementByClassAt(card, "kls-book-header", 0);
		const actions = elementByClassAt(card, "kls-book-actions", 0);

		expect(buttonTexts(header)).toEqual([]);
		expect(buttonTexts(actions)).toEqual(["Import All", "Skip This Sync", "Ignore All", "Review Highlights"]);
		expect(buttonTexts(card)).toEqual([
			"Import All",
			"Skip This Sync",
			"Ignore All",
			"Review Highlights",
		]);
	});

	it("renders incremental review copy without first-sync-only title text", () => {
		const modal = createModal(createPlugin(), [createBookGroup()], { title: "Review New Highlights" });

		modal.onOpen();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("Review New Highlights");
		expect(readText(modal.contentEl)).not.toContain("First Sync Preview");
	});

	it("renders the Kindle information panel as one concise paragraph", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const callout = elementByClassAt(modal.contentEl, "kls-review-warning-callout", 0);
		const paragraphs = elementsByTag(callout, "p");

		expect(paragraphs).toHaveLength(1);
		expect(paragraphs[0]?.children.map((child) => child.tagName)).toEqual(["span", "br", "span"]);
		expect(paragraphTexts(callout)).toEqual([
			"Some highlights deleted on your Kindle may still remain in My Clippings.txt. Review them before importing so only the highlights you want are added to your notes.",
		]);
	});
});

describe("FirstSyncPreviewModal selected decision states", () => {
	it("uses the same shared Skip This Sync base inside and outside book detail", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const bookSkip = findByText(modal.contentEl, "Skip This Sync");

		expect(bookSkip.classes.has("kls-skip-this-sync-button")).toBe(true);
		expect(bookSkip.classes.has("kls-action-button")).toBe(true);
		expect(bookSkip.classes.has("kls-pill-button")).toBe(true);
		expect(bookSkip.classes.has("kls-glass-subtle")).toBe(true);
		await findByText(modal.contentEl, "Review Highlights").click();
		const highlightSkip = findByText(modal.contentEl, "Skip This Sync");

		expect(highlightSkip.classes.has("kls-skip-this-sync-button")).toBe(true);
		expect(highlightSkip.classes.has("kls-action-button")).toBe(true);
		expect(highlightSkip.classes.has("kls-pill-button")).toBe(true);
		expect(highlightSkip.classes.has("kls-glass-subtle")).toBe(true);
		expect(highlightSkip.classes.has("kls-decision-button-active")).toBe(false);
	});

	it("renders the selected decision on its button without a duplicate indicator", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		const skipButton = findByText(modal.contentEl, "Skip This Sync");

		expect(skipButton.classes.has("kls-decision-button-active-skip")).toBe(true);
		expect(skipButton.attributes.get("aria-pressed")).toBe("true");
		expect(elementsByClass(modal.contentEl, "kls-selected-decision")).toHaveLength(0);
		expect(readText(modal.contentEl)).not.toContain("Selected:");
	});

	it("marks only the selected per-highlight decision button active", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).attributes.get("aria-pressed")).toBe("true");
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("mod-cta")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-glass-subtle")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).attributes.get("aria-pressed")).toBe("false");
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).attributes.get("aria-pressed")).toBe("false");

		await buttonByTextAt(modal.contentEl, "Ignore", 0).click();

		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).attributes.get("aria-pressed")).toBe("true");
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("mod-cta")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-glass-subtle")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).attributes.get("aria-pressed")).toBe("false");
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(false);

		await buttonByTextAt(modal.contentEl, "Import", 0).click();

		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).attributes.get("aria-pressed")).toBe("true");
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("mod-cta")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-glass-subtle")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).attributes.get("aria-pressed")).toBe("false");
	});
});

describe("FirstSyncPreviewModal skipped summary items", () => {
	it("includes explicitly skipped highlights in skippedThisSyncHighlights", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const skippedHighlights = getCompleteFirstSyncArgs(plugin)[2];
		expect(skippedHighlights.map((highlight) => highlight.textPreview)).toEqual([
			"Clockwork apples chime at midnight.",
			"Revisit the orchard map later.",
		]);
	});

	it("treats unselected highlights as skippedThisSyncHighlights on Finish Sync", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const skippedHighlights = getCompleteFirstSyncArgs(plugin)[2];
		expect(skippedHighlights).toHaveLength(group.clippings.length);
	});

	it("does not persist skippedThisSyncHighlights to settings", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(JSON.stringify(plugin.settings)).not.toContain("skippedThisSyncHighlights");
	});
});

describe("FirstSyncPreviewModal sticky actions", () => {
	it("shows sticky Finish Sync and Cancel actions in the book list view", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const stickyActions = elementsByClass(modal.contentEl, "kls-sticky-actions");

		expect(stickyActions).toHaveLength(1);
		expect(buttonTexts(stickyActions[0])).toEqual(["Import All Books", "Finish Sync", "Cancel"]);
		expect(stickyActions[0]?.classes.has("kls-first-sync-review-actions")).toBe(true);
		const bulkActions = elementByClassAt(stickyActions[0], "kls-first-sync-bulk-actions", 0);
		const completionActions = elementByClassAt(stickyActions[0], "kls-first-sync-completion-actions", 0);

		expect(buttonTexts(bulkActions)).toEqual(["Import All Books"]);
		expect(buttonTexts(completionActions)).toEqual(["Finish Sync", "Cancel"]);
		expect(stickyActions[0]?.children[0]).toBe(bulkActions);
		expect(stickyActions[0]?.children[1]).toBe(completionActions);
		expect(findByText(bulkActions, "Import All Books").classes.has("kls-glass-subtle")).toBe(true);
		expect(findByText(completionActions, "Finish Sync").classes.has("kls-glass-strong")).toBe(true);
	});

	it("places Back above the detail title and keeps only Cancel in sticky actions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		const stickyActions = elementsByClass(modal.contentEl, "kls-sticky-actions");
		const detailHeader = elementByClassAt(modal.contentEl, "kls-book-detail-header", 0);
		const titleIndex = directChildIndexByClass(detailHeader, "kls-book-title");
		const navigationIndex = directChildIndexByClass(detailHeader, "kls-review-navigation");

		expect(stickyActions).toHaveLength(1);
		expect(buttonTexts(stickyActions[0])).toEqual(["Cancel"]);
		expect(buttonTexts(elementByClassAt(detailHeader, "kls-review-navigation", 0))).toEqual(["Back"]);
		expect(findButtonByAriaLabel(detailHeader, "Back to Book List")).toBeDefined();
		expect(navigationIndex).toBeLessThan(titleIndex);
		expect(buttonsByAriaLabel(detailHeader, "How choices work")).toHaveLength(0);
	});

	it("Cancel closes the modal without completing first sync", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const close = vi.spyOn(modal, "close");

		modal.onOpen();
		await findByText(elementsByClass(modal.contentEl, "kls-sticky-actions")[0], "Cancel").click();

		expect(close).toHaveBeenCalledTimes(1);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("sticky Finish Sync uses the same completion path as the bottom Finish Sync button", async () => {
		const stickyPlugin = createPlugin();
		const stickyModal = createModal(stickyPlugin, [createBookGroup()]);

		stickyModal.onOpen();
		await findByText(stickyModal.contentEl, "Import All").click();
		await findByText(elementsByClass(stickyModal.contentEl, "kls-sticky-actions")[0], "Finish Sync").click();

		expect(stickyPlugin.completeFirstSync).toHaveBeenCalledWith(
			createBookGroup().clippings,
			[],
			[],
			expect.any(CurrentClippingIdentityIndex)
		);

		const bottomPlugin = createPlugin();
		const bottomModal = createModal(bottomPlugin, [createBookGroup()]);

		bottomModal.onOpen();
		await findByText(bottomModal.contentEl, "Import All").click();
		await buttonByTextAt(bottomModal.contentEl, "Finish Sync", -1).click();

		expect(bottomPlugin.completeFirstSync).toHaveBeenCalledWith(
			createBookGroup().clippings,
			[],
			[],
			expect.any(CurrentClippingIdentityIndex)
		);
	});
});

describe("FirstSyncPreviewModal Import All Books", () => {
	it("adds only the finalized help entry without changing the existing disclosure behavior or copy", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const trigger = findByText(modal.contentEl, "How choices work");
		const panel = elementByClassAt(modal.contentEl, "kls-choice-help-panel", 0);

		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(panel.attributes.has("hidden")).toBe(true);
		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("true");
		expect(panel.attributes.has("hidden")).toBe(false);
		expect(helpContentSnapshot(modal.contentEl)).toEqual({
			terms: [
				"Import All Books", "Import All", "Ignore All", "Skip This Sync", "Review Highlights", "Finish Sync",
			],
			descriptions: [
				"Selects every book in this review. Choices made here change to Import.",
				"Choose Import for every highlight in this book.",
				"Keep every highlight out of future syncs until you remove it from Ignored Highlights.",
				"Skip this book once — its highlights may return next sync.",
				"Choose Import, Skip, or Ignore one highlight at a time.",
				"Save your choices and sync. Highlights still needing review are skipped this time.",
			],
			opening: "How choices work: Your choices are temporary until you select Finish Sync.",
			status: "Reviewed: every highlight has a choice. Needs Review: at least one highlight still needs a choice.",
		});
		await trigger.click();
		expect(trigger.attributes.get("aria-expanded")).toBe("false");
		expect(panel.attributes.has("hidden")).toBe(true);
	});

	it("imports every reviewable highlight immediately when there are no current Skip or Ignore choices", async () => {
		const plugin = createPlugin();
		const groups = [createBookGroup("The Clockwork Orchard"), createBookGroup("Night Trains to Lumen Bay")];
		const modal = createModal(plugin, groups);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All Books").click();

		expect(currentChoiceValues(modal)).toEqual(["import", "import", "import", "import"]);
		expect(readText(modal.contentEl)).not.toContain("Import all books?");
		expect(findByText(modal.contentEl, "Import All Books").disabled).toBe(true);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it.each(["skip", "ignore", "mixed"] as const)(
		"shows the finalized confirmation for %s current choices without changing them",
		async (scenario) => {
			const plugin = createPlugin();
			const modal = createModal(plugin, [createBookGroup()]);

			modal.onOpen();
			await chooseImportAllConfirmationScenario(modal, scenario);
			const before = currentChoiceEntries(modal);
			await findByText(modal.contentEl, "Import All Books").click();

			expect(readText(modal.contentEl)).toContain("Import all books?");
			expect(paragraphTexts(modal.contentEl)).toEqual(expect.arrayContaining([
				"Your current Skip and Ignore choices will change to Import. Highlights ignored in earlier syncs won’t be affected.",
				"Nothing will be imported until you select Finish Sync.",
			]));
			expect(buttonTexts(elementsByClass(modal.contentEl, "kls-sticky-actions")[0])).toEqual([
				"Import All Books", "Keep Current Choices",
			]);
			const importAll = findByText(modal.contentEl, "Import All Books");
			const keepCurrent = findByText(modal.contentEl, "Keep Current Choices");

			expect(importAll.classes.has("kls-glass-subtle")).toBe(true);
			expect(importAll.classes.has("mod-cta")).toBe(false);
			expect(keepCurrent.classes.has("kls-glass-strong")).toBe(true);
			expect(keepCurrent.classes.has("mod-cta")).toBe(true);
			expect(keepCurrent.focusCalls).toBe(1);
			expect(currentChoiceEntries(modal)).toEqual(before);
			expect(plugin.completeFirstSync).not.toHaveBeenCalled();
		}
	);

	it.each(["button", "escape"] as const)(
		"keeps every choice and restores trigger focus when confirmation is canceled by %s",
		async (cancelMethod) => {
			const modal = createModal(createPlugin(), [createBookGroup()]);

			modal.onOpen();
			await chooseImportAllConfirmationScenario(modal, "mixed");
			const before = currentChoiceEntries(modal);
			await findByText(modal.contentEl, "Import All Books").click();
			if (cancelMethod === "button") {
				await findByText(modal.contentEl, "Keep Current Choices").click();
			} else {
				modal.close();
			}

			expect(currentChoiceEntries(modal)).toEqual(before);
			expect(readText(modal.contentEl)).not.toContain("Import all books?");
			expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
			expect(findByText(modal.contentEl, "Import All Books").focusCalls).toBe(1);
		}
	);

	it("changes every current modal choice to Import only after confirmation", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup(), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Skip This Sync").click();
		await chooseIgnoreAll(modal, findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"));
		await findByText(modal.contentEl, "Import All Books").click();
		expect(currentChoiceValues(modal)).toEqual(["skip", "skip", "ignore", "ignore"]);

		await findByText(modal.contentEl, "Import All Books").click();

		expect(currentChoiceValues(modal)).toEqual(["import", "import", "import", "import"]);
		expect(findByText(modal.contentEl, "Import All Books").disabled).toBe(true);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("includes books hidden by search and filter while preserving help, query, filter, and scroll", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup(), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();
		await findByText(modal.contentEl, "How choices work").click();
		await searchBooks(modal, "Clockwork");
		await findByText(modal.contentEl, "Reviewed").click();
		const body = elementByClassAt(modal.contentEl, "kls-modal-scroll-body", 0);

		expect(bookHeadings(modal)).toEqual([]);
		setScrollTop(body, 190);
		setScrollTop(modal.contentEl, 190);
		await findByText(modal.contentEl, "Import All Books").click();

		expect(currentChoiceValues(modal)).toEqual(["import", "import", "import", "import"]);
		expect(elementsByTag(modal.contentEl, "input")[0]?.value).toBe("Clockwork");
		expect(findByText(modal.contentEl, "Reviewed").attributes.get("aria-pressed")).toBe("true");
		expect(findByText(modal.contentEl, "How choices work").attributes.get("aria-expanded")).toBe("true");
		expect(scrollTop(modal.contentEl)).toBe(190);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(190);
		expect(bookHeadings(modal)).toEqual(["1 / 2 — The Clockwork Orchard"]);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("does not mutate previously persisted Ignore records", async () => {
		const plugin = createPlugin();
		const persistedIgnore = { id: "saved-id", title: "Saved Book", textPreview: "Saved", ignoredAt: "earlier" };
		plugin.settings = { ignoredHighlights: [persistedIgnore] };
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All Books").click();

		expect(plugin.settings).toEqual({ ignoredHighlights: [persistedIgnore] });
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("blocks Import All Books after a failure confirms Ignore records were already saved", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();
		const before = currentChoiceEntries(modal);
		const blockedButton = findByText(modal.contentEl, "Import All Books");

		expect(blockedButton.disabled).toBe(true);
		await blockedButton.click();
		expect(currentChoiceEntries(modal)).toEqual(before);
		expect(readText(modal.contentEl)).not.toContain("Import all books?");
		await findByText(modal.contentEl, "Return to review").click();
		expect(findByText(modal.contentEl, "Import All Books").disabled).toBe(true);
		consoleError.mockRestore();
	});

	it("passes the final live choices to Finish Sync after later individual edits", async () => {
		const plugin = createPlugin();
		const orchard = createBookGroup();
		const lumenBay = createBookGroup("Night Trains to Lumen Bay");
		const modal = createModal(plugin, [orchard, lumenBay]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All Books").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await buttonByTextAt(modal.contentEl, "Skip This Sync", 0).click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const [imports, ignores, skipped] = getCompleteFirstSyncArgs(plugin);

		expect(imports).toEqual(lumenBay.clippings);
		expect(ignores).toEqual([orchard.clippings[1]]);
		expect(skipped).toEqual([expect.objectContaining({
			id: createClippingId(orchard.clippings[0]!),
			returnReason: "skipped",
		})]);
	});

	it("disables for no eligible items or all-Import state and re-enables after an individual change", async () => {
		const emptyModal = createModal(createPlugin(), []);

		emptyModal.onOpen();
		expect(findByText(emptyModal.contentEl, "Import All Books").disabled).toBe(true);

		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const initialBulk = findByText(modal.contentEl, "Import All Books");
		expect(initialBulk.disabled).toBe(false);
		await initialBulk.click();
		expect(findByText(modal.contentEl, "Import All Books").disabled).toBe(true);
		await findByText(modal.contentEl, "Skip This Sync").click();
		expect(findByText(modal.contentEl, "Import All Books").disabled).toBe(false);
	});

	it("keeps dirty-close protection after applying Import All Books", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await findByText(modal.contentEl, "Import All Books").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(onClose).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("Discard your selections?");
	});
});

describe("FirstSyncPreviewModal book status", () => {
	it("shows Needs Review for untouched books", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Needs Review");
		expect(readText(modal.contentEl)).not.toContain("Status:");
	});

	it("renders untouched book status as a needs-review badge", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const status = elementsByClass(modal.contentEl, "kls-book-status")[0];
		const statusBadge = elementsByClass(status, "kls-status-badge")[0];

		expect(status?.classes.has("kls-book-status-needs-review")).toBe(true);
		expect(statusBadge?.classes.has("kls-book-status-value")).toBe(true);
		expect(statusBadge?.classes.has("kls-status-badge-needs-review")).toBe(true);
		expect(statusBadge?.text()).toBe("Needs Review");
		expect(status?.text()).toBe("Needs Review");
		expect(elementsByClass(status, "kls-book-status-label")).toHaveLength(0);
		const cardControls = elementByClassAt(modal.contentEl, "kls-book-card-controls", 0);

		expect(elementsByClass(cardControls, "kls-book-status")).toEqual([status]);
		expect(directChildIndexByClass(cardControls, "kls-book-status")).toBe(0);
		expect(buttonTexts(cardControls)).toEqual([]);
	});

	it("shows Import All and selects it only after all highlights are marked for Import", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		expect(readText(modal.contentEl)).toContain("Import All");
		expect(buttonByTextAt(modal.contentEl, "Import All", 0).classes.has("kls-decision-button-active-import")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Import All", 0).attributes.get("aria-pressed")).toBe("true");
		for (const label of ["Ignore All", "Skip This Sync"]) {
			const button = buttonByTextAt(modal.contentEl, label, 0);

			expect(button.classes.has("kls-decision-button-active")).toBe(false);
			expect(button.attributes.get("aria-pressed")).toBe("false");
		}
		const reviewButton = findByText(modal.contentEl, "Review Highlights");

		expect(reviewButton.classes.has("kls-glass-subtle")).toBe(true);
		expect(reviewButton.classes.has("kls-decision-button-active")).toBe(false);
		expect(readText(modal.contentEl)).not.toContain("Status:");
	});

	it("renders all-Import with the matching aggregate badge", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const status = elementsByClass(modal.contentEl, "kls-book-status")[0];
		const statusBadge = elementsByClass(status, "kls-status-badge")[0];

		expect(status?.classes.has("kls-book-status-import")).toBe(true);
		expect(statusBadge?.classes.has("kls-book-status-value")).toBe(true);
		expect(statusBadge?.classes.has("kls-status-badge-import")).toBe(true);
		expect(statusBadge?.text()).toBe("Import All");
		expect(status?.text()).toBe("Import All");
	});

	it("shows Ignore All as selected without a duplicate decision badge", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await chooseIgnoreAll(modal);

		const ignoreAll = findByText(modal.contentEl, "Ignore All");

		expect(readText(modal.contentEl)).toContain("Ignore All");
		expect(ignoreAll.classes.has("kls-decision-button-active-ignore")).toBe(true);
		expect(ignoreAll.attributes.get("aria-pressed")).toBe("true");
		expect(elementsByClass(modal.contentEl, "kls-status-badge-ignore")).toHaveLength(1);
		expect(readText(modal.contentEl)).not.toContain("Status:");
	});

	it("shows Skip This Sync as selected without a duplicate skipped badge", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		const skip = buttonByTextAt(modal.contentEl, "Skip This Sync", 0);

		expect(readText(modal.contentEl)).toContain("Skipped This Sync");
		expect(skip.classes.has("kls-decision-button-active-skip")).toBe(true);
		expect(skip.attributes.get("aria-pressed")).toBe("true");
		expect(elementsByClass(modal.contentEl, "kls-status-badge-skip")).toHaveLength(1);
		expect(readText(modal.contentEl)).not.toContain("Status:");
		expect(skip.classes.has("kls-glass-subtle")).toBe(true);
	});

	it("shows Needs Review while a book still has undecided highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-needs-review")).toBe(true);
		expect(statusBadge?.text()).toBe("Needs Review");
		expect(statusBadge?.classes.has("kls-needs-review-attention")).toBe(false);
		for (const label of ["Import All", "Ignore All", "Skip This Sync"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-decision-button-active")).toBe(false);
			expect(button.attributes.get("aria-pressed")).toBe("false");
		}
	});

	it("derives all-Import and complete mixed aggregate states from individual decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await buttonByTextAt(modal.contentEl, "Import", 1).click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		expect(buttonByTextAt(modal.contentEl, "Import All", 0).classes.has("kls-decision-button-active-import")).toBe(true);
		expect(elementsByClass(modal.contentEl, "kls-status-badge-import")[0]?.text()).toBe("Import All");

		await findByText(modal.contentEl, "Review Highlights").click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-reviewed")).toBe(true);
		expect(statusBadge?.text()).toBe("Reviewed");
		for (const label of ["Import All", "Ignore All", "Skip This Sync"]) {
			const button = findByText(modal.contentEl, label);

			expect(button.classes.has("kls-decision-button-active")).toBe(false);
			expect(button.attributes.get("aria-pressed")).toBe("false");
		}
		expect(readText(modal.contentEl)).not.toContain("Status:");
	});

	it("shows Reviewed for complete import and skip decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await buttonByTextAt(modal.contentEl, "Skip This Sync", 1).click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-reviewed")).toBe(true);
		expect(statusBadge?.text()).toBe("Reviewed");
	});

	it("shows Reviewed for complete skip and ignore decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-reviewed")).toBe(true);
		expect(statusBadge?.text()).toBe("Reviewed");
		expect(statusBadge?.text().trim()).not.toBe("");
	});
});

describe("FirstSyncPreviewModal review progress", () => {
	it("removes the full review progress section from the book list", () => {
		const modal = createModal(createPlugin(), [createBookGroup("The Clockwork Orchard"), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();

		expect(readText(modal.contentEl)).not.toContain("Review Progress");
		expect(elementsByClass(modal.contentEl, "kls-review-progress")).toHaveLength(0);
		expect(elementsByClass(modal.contentEl, "kls-review-progress-group")).toHaveLength(0);
	});

	it("shows compact sticky global progress while the book list renders", () => {
		const modal = createModal(createPlugin(), [createBookGroup("The Clockwork Orchard"), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 0/2 books · Needs Review: 2 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(elementsByClass(compactProgress, "kls-progress-chip").map((chip) => chip.text())).toEqual([
			"Reviewed: 0/2 books",
			"Needs Review: 2 books",
			"Ignore: 0 highlights",
			"Skip: 0 highlights",
		]);
		expect(elementsByClass(compactProgress, "kls-needs-review-attention")).toHaveLength(0);
		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
	});

	it("keeps compact progress global while search is active", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Import All").click();
		await searchBooks(modal, "Lumen");

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 1/2 books · Needs Review: 1 book · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(bookHeadings(modal)).toEqual(["2 / 2 — Night Trains to Lumen Bay"]);
	});

	it("updates progress after Import All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 1/1 books · Needs Review: 0 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(readText(modal.contentEl)).not.toContain("Imported");
	});

	it("updates progress after Ignore All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await chooseIgnoreAll(modal);

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 1/1 books · Needs Review: 0 books · Ignore: 2 highlights · Skip: 0 highlights"
		);
	});

	it("updates progress after Skip This Sync", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 1/1 books · Needs Review: 0 books · Ignore: 0 highlights · Skip: 2 highlights"
		);
	});

	it("updates progress after item-by-item review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 0/1 books · Needs Review: 1 book · Ignore: 0 highlights · Skip: 0 highlights"
		);
	});

	it("counts partially reviewed books as not reviewed", async () => {
		const modal = createModal(createPlugin(), [createBookGroup("The Clockwork Orchard"), createBookGroup("Night Trains to Lumen Bay")]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"), "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Reviewed: 0/2 books · Needs Review: 2 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(readText(modal.contentEl)).not.toContain("Partially Reviewed");
	});

	it("uses singular copy for one-highlight review summaries and progress", async () => {
		const modal = createModal(createPlugin(), [createSingleHighlightBookGroup()]);

		modal.onOpen();

		expect(readText(elementByClassAt(modal.contentEl, "kls-book-review-summary", 0))).toContain(
			"1 highlight needs review"
		);

		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(readText(elementByClassAt(modal.contentEl, "kls-book-review-summary", 0))).toContain(
			"1 skipped this sync"
		);
		expect(readText(elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0))).toContain(
			"Skip: 1 highlight"
		);
		expect(readText(modal.contentEl)).not.toContain("1 highlight need review");
		expect(readText(modal.contentEl)).not.toContain("1 highlights");
	});
});

describe("FirstSyncPreviewModal unsaved decision confirmation", () => {
	it("closes immediately when no Import, Skip, or Ignore decision changed", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await findByText(modal.contentEl, "Cancel").click();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
	});

	it("asks before Cancel discards a real decision change", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(onClose).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("Discard your selections?");
		expect(readText(modal.contentEl)).toContain(
			"Your Import, Skip, and Ignore choices have not been saved."
		);
		expect(readText(modal.contentEl)).toContain(
			"If you leave now, you’ll need to review these highlights again next time."
		);
	});

	it("keeps reviewing with the current decisions and view intact", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findByText(modal.contentEl, "Cancel").click();
		await findByText(modal.contentEl, "Keep reviewing").click();

		const skip = findByText(modal.contentEl, "Skip This Sync");

		expect(skip.classes.has("kls-decision-button-active-skip")).toBe(true);
		expect(skip.attributes.get("aria-pressed")).toBe("true");
		expect(readText(modal.contentEl)).not.toContain("Selected:");
		expect(buttonTexts(modal.contentEl)).toContain("Back");
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Book List")).toBeDefined();
	});

	it("discards pending decisions only after explicit confirmation", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Cancel").click();
		await findByText(modal.contentEl, "Discard and exit").click();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("uses the same guard for native close and Escape-style close requests", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();
		modal.close();

		expect(onClose).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("Discard your selections?");
		modal.close();
		expect(onClose).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("First Sync Preview");
	});

	it("does not warn after the completed save path", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
	});

	it("does not mark search, filters, scroll, book navigation, or Back as dirty", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		await searchBooks(modal, "Lumen");
		await findByText(modal.contentEl, "Needs Review").click();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 175);
		await findByText(modal.contentEl, "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		modal.close();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
	});

	it("uses strong primary and neutral secondary confirmation actions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Cancel").click();
		const keepReviewing = findByText(modal.contentEl, "Keep reviewing");
		const discard = findByText(modal.contentEl, "Discard and exit");

		expect(keepReviewing.classes.has("kls-pill-button")).toBe(true);
		expect(keepReviewing.classes.has("kls-glass-strong")).toBe(true);
		expect(keepReviewing.classes.has("mod-cta")).toBe(true);
		expect(discard.classes.has("kls-pill-button")).toBe(true);
		expect(discard.classes.has("mod-warning")).toBe(false);
		expect(discard.classes.has("kls-glass-subtle")).toBe(true);
		expect(discard.classes.has("kls-glass-strong")).toBe(false);
	});
});

describe("FirstSyncPreviewModal control registry lifecycle", () => {
	it("keeps only current book decision controls across repeated search and filter renders", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const initialState = expectCurrentControlRegistries(modal, 7, 1);
		const initialFinish = initialState.finishButtons[0];
		const initialBulk = findByText(modal.contentEl, "Import All Books");

		await searchBooks(modal, "Lumen");
		expect(expectCurrentControlRegistries(modal, 4, 1).finishButtons).toEqual([initialFinish]);
		expect(findByText(modal.contentEl, "Import All Books")).toBe(initialBulk);
		await searchBooks(modal, "");
		expect(expectCurrentControlRegistries(modal, 7, 1).finishButtons).toEqual([initialFinish]);
		await findByText(modal.contentEl, "Reviewed").click();
		expect(expectCurrentControlRegistries(modal, 1, 1).finishButtons).toEqual([initialFinish]);
		await findByText(modal.contentEl, "Needs Review").click();
		expect(expectCurrentControlRegistries(modal, 7, 1).finishButtons).toEqual([initialFinish]);
		await findByText(modal.contentEl, "All Books").click();
		expect(expectCurrentControlRegistries(modal, 7, 1).finishButtons).toEqual([initialFinish]);
	});

	it("retains only the current controls after highlight decision renders", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		const firstDetailControls = expectCurrentControlRegistries(modal, 6, 0).decisionButtons;

		await buttonByTextAt(modal.contentEl, "Import", 0).click();
		const secondDetailControls = expectCurrentControlRegistries(modal, 6, 0).decisionButtons;

		expect(secondDetailControls).not.toContain(firstDetailControls[0]);
		await buttonByTextAt(modal.contentEl, "Skip This Sync", 1).click();
		const thirdDetailControls = expectCurrentControlRegistries(modal, 6, 0).decisionButtons;

		expect(thirdDetailControls).not.toContain(secondDetailControls[0]);
	});

	it("retains only the current Finish control across list, detail, and confirmation", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const listFinish = expectCurrentControlRegistries(modal, 4, 1).finishButtons[0];

		await findByText(modal.contentEl, "Review Highlights").click();
		expectCurrentControlRegistries(modal, 6, 0);
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		const returnedListFinish = expectCurrentControlRegistries(modal, 4, 1).finishButtons[0];

		expect(returnedListFinish).not.toBe(listFinish);
		await findByText(modal.contentEl, "Finish Sync").click();
		const confirmationFinish = expectCurrentControlRegistries(modal, 0, 1).finishButtons[0];

		expect(confirmationFinish).not.toBe(returnedListFinish);
		await findButtonByAriaLabel(modal.contentEl, "Back to Review").click();
		const finalListFinish = expectCurrentControlRegistries(modal, 4, 1).finishButtons[0];

		expect(finalListFinish).not.toBe(confirmationFinish);
	});
});

describe("FirstSyncPreviewModal completion failure", () => {
	it("keeps decisions, search, filter, and scroll after an ordinary rejection", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
			createBookGroup("Signals in the Rain"),
		]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const noticeCountBefore = Notice.messages.length;

		plugin.completeFirstSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 / 3 — The Clockwork Orchard"), "Import All").click();
		await chooseIgnoreAll(
			modal,
			findSectionByHeading(modal.contentEl, "2 / 3 — Night Trains to Lumen Bay")
		);
		await findByText(findSectionByHeading(modal.contentEl, "3 / 3 — Signals in the Rain"), "Skip This Sync").click();
		await searchBooks(modal, "Clockwork");
		await findByText(modal.contentEl, "Reviewed").click();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 220);
		setScrollTop(modal.contentEl, 220);

		await buttonByTextAt(modal.contentEl, "Finish Sync", -1).click();

		const failure = elementByClassAt(modal.contentEl, "kls-operation-failure", 0);

		expect(failure.attributes.get("role")).toBe("alert");
		expect(failure.attributes.get("tabindex")).toBe("-1");
		expect(failure.focusCalls).toBe(1);
		expect(readText(failure)).toContain("Sync not completed");
		expect(readText(failure)).toContain(
			"We couldn’t confirm the final sync result. Your selections are still available here."
		);
		expect(readText(failure)).toContain("Some note changes may have occurred.");
		expect(readText(failure)).not.toContain("Your Ignore choices were saved");
		expect(Notice.messages).toHaveLength(noticeCountBefore);
		expect(elementsByTag(modal.contentEl, "input")[0]?.value).toBe("Clockwork");
		expect(findByText(modal.contentEl, "Reviewed").attributes.get("aria-pressed")).toBe("true");
		expect(readText(modal.contentEl)).toContain("How choices work");
		expect(scrollTop(modal.contentEl)).toBe(220);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(220);

		await findByText(modal.contentEl, "Return to review").click();
		await searchBooks(modal, "");
		const clockworkOrchard = findSectionByHeading(modal.contentEl, "1 / 3 — The Clockwork Orchard");
		const lumenBay = findSectionByHeading(modal.contentEl, "2 / 3 — Night Trains to Lumen Bay");
		const signalsInRain = findSectionByHeading(modal.contentEl, "3 / 3 — Signals in the Rain");

		expect(readText(clockworkOrchard)).toContain("Import All");
		expect(buttonByTextAt(clockworkOrchard, "Import All", 0).classes.has("kls-decision-button-active-import")).toBe(true);
		expect(findByText(lumenBay, "Ignore All").classes.has("kls-decision-button-active-ignore")).toBe(true);
		expect(buttonByTextAt(signalsInRain, "Skip This Sync", 0).classes.has("kls-decision-button-active-skip")).toBe(true);
		expect(elementsByClass(modal.contentEl, "kls-operation-failure")).toHaveLength(0);
		consoleError.mockRestore();
	});

	it("states that Ignore choices were saved only for a typed invalid-contract failure", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();

		const failure = elementByClassAt(modal.contentEl, "kls-operation-failure", 0);

		expect(readText(failure)).toContain(
			"Your Ignore choices were saved, but we couldn’t complete the rest of the sync. Your other selections are still available here."
		);
		expect(readText(failure)).not.toContain("writer contract");
		consoleError.mockRestore();
	});

	it("uses ordinary uncertainty feedback for an invalid-contract error without retained Ignore results", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockRejectedValueOnce(new InvalidVaultWriteContractError("outcome-count"));
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();

		const failure = elementByClassAt(modal.contentEl, "kls-operation-failure", 0);

		expect(readText(failure)).toContain(
			"We couldn’t confirm the final sync result. Your selections are still available here."
		);
		expect(readText(failure)).not.toContain("Your Ignore choices were saved");
		consoleError.mockRestore();
	});

	it("retries successfully in place and closes only after completion", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(onClose).not.toHaveBeenCalled();
		await findByText(modal.contentEl, "Try again").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(2);
		expect(onClose).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	it("prevents repeated Finish requests while completion is pending", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const completion = createDeferred<SyncCompletionResult>();

		plugin.completeFirstSync.mockReturnValueOnce(completion.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const finish = findByText(modal.contentEl, "Finish Sync");
		const firstClick = finish.click();

		await Promise.resolve();
		expect(finish.disabled).toBe(true);
		expect(finish.attributes.get("aria-busy")).toBe("true");
		expect((modal.contentEl as unknown as TestElement).attributes.get("aria-busy")).toBe("true");
		await finish.click();
		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(1);

		completion.resolve({
			importedCount: 2,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		});
		await firstClick;
	});

	it("makes stale Finish handlers and direct completion calls inert after First Sync succeeds", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const staleFinish = findByText(modal.contentEl, "Finish Sync");

		await staleFinish.click();
		staleFinish.disabled = false;
		await staleFinish.click();
		await (modal as unknown as {
			completeFirstSync(button: unknown): Promise<void>;
		}).completeFirstSync(staleFinish);

		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(1);
	});

	it("makes a stale Finish handler inert after Review New Highlights succeeds", async () => {
		const plugin = createPlugin();
		const onComplete = vi.fn(async (): Promise<SyncCompletionResult> => ({
			importedCount: 2,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		}));
		const modal = createModal(plugin, [createBookGroup()], {
			title: "Review New Highlights",
			onComplete,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const staleFinish = findByText(modal.contentEl, "Finish Sync");

		await staleFinish.click();
		staleFinish.disabled = false;
		await staleFinish.click();

		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("locks book and highlight decisions across pending navigation and unlocks them after failure", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const completion = createDeferred<SyncCompletionResult>();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockReturnValueOnce(completion.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const staleIgnoreAll = findByText(modal.contentEl, "Ignore All");
		const finishRequest = findByText(modal.contentEl, "Finish Sync").click();

		await Promise.resolve();
		expect(staleIgnoreAll.disabled).toBe(true);
		staleIgnoreAll.disabled = false;
		await staleIgnoreAll.click();
		await findByText(modal.contentEl, "Review Highlights").click();
		const highlightIgnore = findByText(modal.contentEl, "Ignore");
		const highlightSkip = findByText(modal.contentEl, "Skip This Sync");

		expectCurrentControlRegistries(modal, 6, 0);
		expect(elementsByClass(modal.contentEl, "kls-decision-button").every((button) => button.disabled)).toBe(true);
		expect(highlightIgnore.disabled).toBe(true);
		expect(highlightSkip.disabled).toBe(true);
		highlightIgnore.disabled = false;
		highlightSkip.disabled = false;
		await highlightIgnore.click();
		await highlightSkip.click();
		const selectedImport = findByText(modal.contentEl, "Import");

		expect(selectedImport.classes.has("kls-decision-button-active-import")).toBe(true);
		expect(selectedImport.attributes.get("aria-pressed")).toBe("true");
		expect(readText(modal.contentEl)).not.toContain("Selected:");
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		const rerenderedFinish = findByText(modal.contentEl, "Finish Sync");

		expectCurrentControlRegistries(modal, 4, 1);
		expect(elementsByClass(modal.contentEl, "kls-decision-button").every((button) => button.disabled)).toBe(true);
		expect(rerenderedFinish.disabled).toBe(true);
		expect(rerenderedFinish.attributes.get("aria-busy")).toBe("true");
		rerenderedFinish.disabled = false;
		await rerenderedFinish.click();
		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(1);

		completion.reject(new Error("Disk write failed."));
		await finishRequest;
		const unlockedIgnoreAll = findByText(modal.contentEl, "Ignore All");

		expect(unlockedIgnoreAll.disabled).toBe(false);
		await unlockedIgnoreAll.click();
		const selectedIgnoreAll = findByText(modal.contentEl, "Ignore All");

		expect(selectedIgnoreAll.classes.has("kls-decision-button-active-ignore")).toBe(true);
		expect(selectedIgnoreAll.attributes.get("aria-pressed")).toBe("true");
		consoleError.mockRestore();
	});

	it("does not accept stale decision clicks after completion succeeds", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const completion = createDeferred<SyncCompletionResult>();

		plugin.completeFirstSync.mockReturnValueOnce(completion.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const staleIgnoreAll = findByText(modal.contentEl, "Ignore All");
		const finishRequest = findByText(modal.contentEl, "Finish Sync").click();

		await Promise.resolve();
		completion.resolve({
			importedCount: 2,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		});
		await finishRequest;
		staleIgnoreAll.disabled = false;
		await staleIgnoreAll.click();

		expect(readText(modal.contentEl)).toContain("Import All");
		expect(staleIgnoreAll.classes.has("kls-decision-button-active-ignore")).toBe(false);
	});

	it("returns a failed completion to the selected book detail with its scroll and choices intact", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const completion = createDeferred<SyncCompletionResult>();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockReturnValueOnce(completion.promise);
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const finishRequest = findByText(modal.contentEl, "Finish Sync").click();

		await Promise.resolve();
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(elementsByClass(modal.contentEl, "kls-book-detail-highlights")[0], 175);
		completion.reject(new Error("Disk write failed."));
		await finishRequest;

		expect(elementByClassAt(modal.contentEl, "kls-book-detail-count", 0).text()).toBe("2 highlights");
		expect(elementByClassAt(modal.contentEl, "kls-book-title", 0).text()).toBe("The Clockwork Orchard");
		const importButton = findByText(modal.contentEl, "Import");

		expect(importButton.classes.has("kls-decision-button-active-import")).toBe(true);
		expect(importButton.attributes.get("aria-pressed")).toBe("true");
		expect(readText(modal.contentEl)).not.toContain("Selected:");
		expect(readText(modal.contentEl)).toContain("Sync not completed");
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-book-detail-highlights")[0])).toBe(175);
		consoleError.mockRestore();
	});

	it("keeps dirty close confirmation coherent after failure", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(onClose).not.toHaveBeenCalled();
		expect(readText(modal.contentEl)).toContain("Discard your selections?");
		consoleError.mockRestore();
	});

	it.each([
		["Cancel", async (modal: InstanceType<typeof FirstSyncPreviewModal>) => {
			await findByText(modal.contentEl, "Cancel").click();
		}],
		["modal X", async (modal: InstanceType<typeof FirstSyncPreviewModal>) => {
			modal.close();
		}],
		["Escape", async (modal: InstanceType<typeof FirstSyncPreviewModal>) => {
			modal.close();
		}],
	] as const)("closes without an unsaved warning when only confirmed saved Ignore choices remain via %s", async (_label, closeModal) => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();
		await closeModal(modal);

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
		consoleError.mockRestore();
	});

	it("keeps confirmed saved Ignore choices clean after Return to review", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const onClose = vi.spyOn(modal, "onClose");
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Return to review").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(readText(modal.contentEl)).not.toContain("Discard your selections?");
		consoleError.mockRestore();
	});

	it("uses mixed saved-state copy when saved Ignore choices coexist with an unsaved Import", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [
			createBookGroup("Ignored Book"),
			createBookGroup("Imported Book"),
		]);
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(
			modal,
			findSectionByHeading(modal.contentEl, "1 / 2 — Ignored Book")
		);
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Imported Book"), "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Cancel").click();

		expect(readText(modal.contentEl)).toContain("Your remaining selections have not been saved.");
		expect(readText(modal.contentEl)).not.toContain(
			"Your Import, Skip, and Ignore choices have not been saved."
		);
		consoleError.mockRestore();
	});

	it("keeps additional Ignore changes dirty after returning to review", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [
			createBookGroup("Saved Ignore"),
			createBookGroup("Later Ignore"),
		]);
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(
			modal,
			findSectionByHeading(modal.contentEl, "1 / 2 — Saved Ignore")
		);
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Return to review").click();
		await chooseIgnoreAll(
			modal,
			findSectionByHeading(modal.contentEl, "2 / 2 — Later Ignore")
		);
		await findByText(modal.contentEl, "Cancel").click();

		expect(readText(modal.contentEl)).toContain("Your remaining selections have not been saved.");
		consoleError.mockRestore();
	});

	it("treats a confirmed saved Ignore changed again to Import as dirty", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const error = new InvalidVaultWriteContractError("outcome-count");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		error.retainIgnoreCleanupResult(createEmptyCleanupResult());
		plugin.completeFirstSync.mockRejectedValueOnce(error);
		modal.onOpen();
		await chooseIgnoreAll(modal);
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Return to review").click();
		await findByText(modal.contentEl, "Import All").click();
		modal.close();

		expect(readText(modal.contentEl)).toContain("Your remaining selections have not been saved.");
		consoleError.mockRestore();
	});

	it("moves failure focus only once across Return to review and detail navigation", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.completeFirstSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		expect(elementByClassAt(modal.contentEl, "kls-operation-failure", 0).focusCalls).toBe(1);

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(elementByClassAt(modal.contentEl, "kls-operation-failure", 0).focusCalls).toBe(0);
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
		expect(elementByClassAt(modal.contentEl, "kls-operation-failure", 0).focusCalls).toBe(0);
		consoleError.mockRestore();
	});
});

describe("FirstSyncPreviewModal finish confirmation", () => {
	it("shows a confirmation when finishing with highlights not reviewed yet", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(readText(modal.contentEl)).toContain("Some highlights have not been reviewed.");
		expect(readText(modal.contentEl)).toContain(
			"Highlights not reviewed yet will be skipped only for this sync and may appear again next time."
		);
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining(["Finish Sync", "Back"]));
		expect(findButtonByAriaLabel(modal.contentEl, "Back to Review")).toBeDefined();
	});

	it("does not show confirmation when all highlights are reviewed", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(readText(modal.contentEl)).not.toContain("Some highlights have not been reviewed.");
		expect(plugin.completeFirstSync).toHaveBeenCalledTimes(1);
	});

	it("Back to Review returns to the book list without completing sync", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		const backButton = findButtonByAriaLabel(modal.contentEl, "Back to Review");

		expect(backButton.classes.has("kls-review-back-button")).toBe(true);
		await backButton.click();

		expect(readText(modal.contentEl)).toContain("First Sync Preview");
		expect(elementsByClass(modal.contentEl, "kls-compact-review-progress")).toHaveLength(1);
		expect(readText(modal.contentEl)).not.toContain("Review Progress");
		expect(plugin.completeFirstSync).not.toHaveBeenCalled();
	});

	it("Finish Sync continues completion after confirmation", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith(
			[],
			[],
			expect.any(Array),
			expect.any(CurrentClippingIdentityIndex)
		);
	});

	it("does not persist not-reviewed highlights to data.json", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(JSON.stringify(plugin.settings)).not.toContain("skippedHighlights");
		expect(JSON.stringify(plugin.settings)).not.toContain("skippedThisSyncHighlights");
	});
});

describe("FirstSyncPreviewModal per-book review scroll", () => {
	it("resets scroll to top when entering per-book review", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		const lumenBaySection = findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay");
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 320);
		setScrollTop(modal.contentEl, 320);
		await findByText(lumenBaySection, "Review Highlights").click();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("Night Trains to Lumen Bay");
		expect(elementByClassAt(modal.contentEl, "kls-book-detail-count", 0).text()).toBe("2 highlights");
		expect(readText(modal.contentEl)).toContain("Location 154");
		expect(readText(modal.contentEl)).toContain("Clockwork apples chime at midnight.");
		expect(scrollTop(modal.contentEl)).toBe(0);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(0);
		expect(scrollIntoViewCalls(lumenBaySection)).toHaveLength(0);
	});

	it("does not break Back to Book List anchor restoration", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		setScrollTop(modal.contentEl, 320);
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 25);
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"))).toHaveLength(0);
	});

	it("preserves scroll after selecting a per-highlight decision", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(elementsByClass(modal.contentEl, "kls-book-detail-highlights")[0], 180);
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(scrollTop(elementsByClass(modal.contentEl, "kls-book-detail-highlights")[0])).toBe(180);
	});
});

describe("FirstSyncPreviewModal book list navigation", () => {
	it("renders the title as First Sync Preview", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("First Sync Preview");
		expect(readText(modal.contentEl)).not.toContain("First sync preview");
	});

	it("shows book numbering in the book list", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-book-index").map((element) => element.text())).toEqual([
			"1 / 2",
			"2 / 2",
		]);
		expect(bookHeadings(modal)).toEqual(["1 / 2 — The Clockwork Orchard", "2 / 2 — Night Trains to Lumen Bay"]);
		expect(readText(modal.contentEl)).not.toContain("Book 1 / 2");
	});

	it("shows the highlight count in per-book review", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Review Highlights").click();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("Night Trains to Lumen Bay");
		expect(elementByClassAt(modal.contentEl, "kls-book-detail-count", 0).text()).toBe("2 highlights");
	});

	it("stores the clicked book as a return anchor when Review Highlights is clicked", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Review Highlights").click();
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "1 / 2 — The Clockwork Orchard"))).toHaveLength(0);
	});

	it("scrolls the clicked book back into view when Back to Book List is clicked", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		setScrollTop(modal.contentEl, 240);
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 10);
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		const lumenBaySection = findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay");

		expect(readText(modal.contentEl)).toContain("First Sync Preview");
		expect(scrollIntoViewCalls(lumenBaySection)).toEqual([{ block: "center" }]);
	});

	it("falls back safely when the return anchor cannot be found", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 240);
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Review Highlights").click();
		(modal as unknown as { bookListReturnAnchorKey: string }).bookListReturnAnchorKey = "missing";
		setScrollTop(elementsByClass(modal.contentEl, "kls-book-detail-highlights")[0], 10);
		await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();

		expect(readText(modal.contentEl)).toContain("First Sync Preview");
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(240);
	});

	it("preserves book position after a book-level action", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("The Clockwork Orchard"),
			createBookGroup("Night Trains to Lumen Bay"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 275);
		setScrollTop(modal.contentEl, 275);
		await findByText(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"), "Skip This Sync").click();

		expect(scrollTop(modal.contentEl)).toBe(275);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(275);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 / 2 — Night Trains to Lumen Bay"))).toHaveLength(0);
	});
});

function createModal(
	plugin: ReturnType<typeof createPlugin>,
	bookGroups: KindleBookGroup[],
	options: ConstructorParameters<typeof FirstSyncPreviewModal>[3] = {}
) {
	return new FirstSyncPreviewModal(new App() as never, plugin as never, bookGroups, options);
}

function createPlugin() {
	return {
		settings: {},
		completeFirstSync: vi.fn(async (
			importHighlights: KindleHighlight[],
			_ignoreHighlights: KindleHighlight[],
			_skippedThisSyncHighlights: SyncSummaryHighlightItem[],
			_identityIndex: CurrentClippingIdentityIndex
		): Promise<SyncCompletionResult> => ({
			importedCount: importHighlights.length,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		})),
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

function createBookGroup(
	bookTitle = "The Clockwork Orchard",
	author = "Mira Vale"
): KindleBookGroup {
	const firstHighlight = createHighlight({
		bookTitle,
		author,
		location: "154",
		content: "Clockwork apples chime at midnight.",
	});
	const secondHighlight = createHighlight({
		bookTitle,
		author,
		location: "160",
		content: "Revisit the orchard map later.",
		type: "Note",
	});

	return {
		bookTitle,
		author,
		clippings: [firstHighlight, secondHighlight],
	};
}

function createSingleHighlightBookGroup(bookTitle = "The Clockwork Orchard", author = "Mira Vale"): KindleBookGroup {
	return {
		bookTitle,
		author,
		clippings: [
			createHighlight({
				bookTitle,
				author,
				location: "154",
				content: "Clockwork apples chime at midnight.",
			}),
		],
	};
}

function createCollisionBookGroup(bookTitle: string): KindleBookGroup {
	const highlight = createHighlight({
		bookTitle,
		author: "Author",
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});

	return {
		bookTitle,
		author: highlight.author,
		clippings: [highlight],
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

interface TestElement {
	tagName: string;
	children: TestElement[];
	classes: Set<string>;
	scrollTop: number;
	scrollIntoViewCalls: unknown[];
	type: string;
	placeholder: string;
	value: string;
	iconName: string;
	focusCalls: number;
	attributes: Map<string, string>;
	disabled: boolean;
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
	input: (value: string) => Promise<void>;
	keydown: (key: string) => Promise<void>;
}

function expectCurrentControlRegistries(
	modal: { contentEl: unknown },
	decisionCount: number,
	finishCount: number
): { decisionButtons: TestElement[]; finishButtons: TestElement[] } {
	const registries = modal as unknown as {
		decisionMutationButtons: Set<{ buttonEl: TestElement }>;
		finishSyncButtons: Set<{ buttonEl: TestElement }>;
	};
	const decisionButtons = [...registries.decisionMutationButtons]
		.map((button) => button.buttonEl);
	const finishButtons = [...registries.finishSyncButtons]
		.map((button) => button.buttonEl);

	expect(decisionButtons).toHaveLength(decisionCount);
	expect(finishButtons).toHaveLength(finishCount);
	expect(decisionButtons).toEqual(elementsByClass(modal.contentEl, "kls-decision-button"));
	expect(finishButtons).toEqual(buttonsByText(modal.contentEl, "Finish Sync"));
	return { decisionButtons, finishButtons };
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolver, rejecter) => {
		resolve = resolver;
		reject = rejecter;
	});

	return { promise, resolve, reject };
}

async function chooseImportAllConfirmationScenario(
	modal: InstanceType<typeof FirstSyncPreviewModal>,
	scenario: "skip" | "ignore" | "mixed"
): Promise<void> {
	if (scenario === "skip") {
		await findByText(modal.contentEl, "Skip This Sync").click();
		return;
	}

	if (scenario === "ignore") {
		await chooseIgnoreAll(modal);
		return;
	}

	await findByText(modal.contentEl, "Review Highlights").click();
	await buttonByTextAt(modal.contentEl, "Skip This Sync", 0).click();
	await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
	await findButtonByAriaLabel(modal.contentEl, "Back to Book List").click();
}

function currentChoiceEntries(modal: InstanceType<typeof FirstSyncPreviewModal>): Array<[string, string]> {
	const choices = (modal as unknown as { choices: Map<string, string> }).choices;

	return [...choices.entries()];
}

function currentChoiceValues(modal: InstanceType<typeof FirstSyncPreviewModal>): string[] {
	return currentChoiceEntries(modal).map(([, choice]) => choice);
}

function readText(element: unknown): string {
	return (element as TestElement).text();
}

function helpContentSnapshot(element: unknown): {
	terms: string[];
	descriptions: string[];
	opening: string;
	status: string;
} {
	return {
		terms: elementsByTag(element, "dt").map((item) => item.text()),
		descriptions: elementsByTag(element, "dd").map((item) => item.text()),
		opening: elementByClassAt(element, "kls-choice-help-opening", 0).text(),
		status: elementByClassAt(element, "kls-choice-help-status", 0).text(),
	};
}

function helpStructureSnapshot(panel: TestElement): {
	panelClasses: string[];
	panelChildren: string[];
	definitionChildren: string[];
} {
	const definitions = elementsByTag(panel, "dl")[0];

	if (!definitions) {
		throw new Error("Could not find help definitions.");
	}

	return {
		panelClasses: [...panel.classes].sort(),
		panelChildren: panel.children.map((child) => child.tagName),
		definitionChildren: definitions.children.map((child) => child.tagName),
	};
}

function findByText(element: unknown, text: string): TestElement {
	// Help definitions intentionally repeat action names, so action tests must resolve the interactive element.
	if ([
		"Finish Sync", "Ignore All", "Import All", "Import All Books", "Review Highlights", "Skip This Sync",
	].includes(text)) {
		const button = buttonsByText(element, text)[0];

		if (button) {
			return button;
		}
	}

	const match = (element as TestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find text: ${text}`);
	}

	return match;
}

function buttonsByAriaLabel(element: unknown, label: string): TestElement[] {
	return elementsByTag(element, "button").filter((button) =>
		button.attributes.get("aria-label") === label
	);
}

function findButtonByAriaLabel(element: unknown, label: string): TestElement {
	const match = buttonsByAriaLabel(element, label)[0];

	if (!match) {
		throw new Error(`Could not find button with aria-label: ${label}`);
	}

	return match;
}

async function chooseIgnoreAll(
	modal: { contentEl: unknown },
	buttonContainer: unknown = modal.contentEl
): Promise<void> {
	await findByText(buttonContainer, "Ignore All").click();
}

function buttonTexts(element: unknown): string[] {
	const texts: string[] = [];
	collectButtonTexts(element as TestElement, texts);

	return texts;
}

async function searchBooks(modal: { contentEl: unknown }, query: string): Promise<void> {
	const input = elementsByTag(modal.contentEl, "input")[0];

	if (!input) {
		throw new Error("Could not find book search input.");
	}

	await input.input(query);
}

function bookHeadings(modal: { contentEl: unknown }): string[] {
	return elementsByClass(modal.contentEl, "kls-book-section").map((section) => {
		const title = elementsByClass(section, "kls-book-title")[0]?.text() ?? "";
		const index = elementsByClass(section, "kls-book-index")[0]?.text();

		return index ? `${index} — ${title}` : title;
	});
}

function buttonsByText(element: unknown, text: string): TestElement[] {
	return elementsByTag(element, "button").filter((button) => button.text() === text);
}

function buttonByTextAt(element: unknown, text: string, index: number): TestElement {
	const buttons = buttonsByText(element, text);
	const button = index < 0 ? buttons[buttons.length + index] : buttons[index];

	if (!button) {
		throw new Error(`Could not find ${text} button at index ${index}.`);
	}

	return button;
}

function collectButtonTexts(element: TestElement, texts: string[]): void {
	if (element.tagName === "button") {
		texts.push(element.text());
	}

	for (const child of element.children) {
		collectButtonTexts(child, texts);
	}
}

function countText(text: string, search: string): number {
	return text.split(search).length - 1;
}

function getCompleteFirstSyncArgs(plugin: ReturnType<typeof createPlugin>): [KindleHighlight[], KindleHighlight[], Array<{ textPreview: string }>] {
	const call = plugin.completeFirstSync.mock.calls[0];

	if (!call) {
		throw new Error("completeFirstSync was not called.");
	}

	return call as unknown as [KindleHighlight[], KindleHighlight[], Array<{ textPreview: string }>];
}

function elementsByTag(element: unknown, tagName: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByTag(element as TestElement, tagName, matches);

	return matches;
}

function paragraphTexts(element: unknown): string[] {
	return elementsByTag(element, "p").map((child) => child.text());
}

function elementsByClass(element: unknown, className: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByClass(element as TestElement, className, matches);

	return matches;
}

function elementByClassAt(element: unknown, className: string, index: number): TestElement {
	const elements = elementsByClass(element, className);
	const match = elements[index];

	if (!match) {
		throw new Error(`Could not find ${className} element at index ${index}.`);
	}

	return match;
}

function directChildIndexByClass(element: unknown, className: string): number {
	return (element as TestElement).children.findIndex((child) => child.classes.has(className));
}

function collectElementsByTag(element: TestElement, tagName: string, matches: TestElement[]): void {
	if (element.tagName === tagName) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByTag(child, tagName, matches);
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
		(
			element.children.some((child) => child.tagName === "h3" && child.text() === heading) ||
			(element.classes.has("kls-book-section") && hasBookHeading(element, heading))
		)
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

function hasBookHeading(element: TestElement, heading: string): boolean {
	const title = elementsByClass(element, "kls-book-title")[0]?.text();
	const index = elementsByClass(element, "kls-book-index")[0]?.text();

	return title === heading || (index ? `${index} — ${title}` === heading : false);
}
