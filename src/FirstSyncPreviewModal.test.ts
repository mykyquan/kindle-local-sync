import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { KindleHighlight } from "./parser/parseClippings";
import { KindleBookGroup } from "./render/renderMarkdown";

let FirstSyncPreviewModal: typeof import("./FirstSyncPreviewModal").FirstSyncPreviewModal;

beforeAll(async () => {
	FirstSyncPreviewModal = (await import("./FirstSyncPreviewModal")).FirstSyncPreviewModal;
});

describe("FirstSyncPreviewModal skip and ignore behavior", () => {
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

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], [], expect.any(Array));
	});

	it("adds all book highlights to ignoredHighlights when Ignore All Highlights is clicked", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], group.clippings, []);
	});

	it("keeps per-highlight skip non-persistent", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await findByText(modal.contentEl, "Back To Book List").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], [], expect.any(Array));
	});
});

describe("FirstSyncPreviewModal wording and layout", () => {
	it("uses Title Case button labels in First Sync Preview", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Review Highlights",
			"Import All",
			"Ignore All Highlights",
			"Skip This Sync",
			"Finish Sync",
		]));

		await findByText(modal.contentEl, "Review Highlights").click();
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Back To Book List",
			"Import",
			"Skip This Sync",
			"Ignore",
		]));
	});

	it("shows Ignore All Highlights instead of Ignore book", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Ignore All Highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignore book");
	});

	it("shows Review Highlights before Import All", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const buttons = buttonTexts(modal.contentEl);
		expect(buttons.indexOf("Review Highlights")).toBeLessThan(buttons.indexOf("Import All"));
	});

	it("shows the choices explanation only once", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "How choices work")).toBe(1);
		expect(countText(readText(modal.contentEl), "Ignore all highlights: Ignore current highlights from this book")).toBe(0);
	});

	it("does not repeat the skip explanation under each book", async () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();
		await findByText(modal.contentEl, "How choices work").click();

		expect(countText(readText(modal.contentEl), "Skip This Sync: skip this run only. Skipped highlights may return next sync.")).toBe(1);
		expect(readText(modal.contentEl)).not.toContain(
			"Skipped highlights are only skipped for this sync. They may appear again next time unless ignored."
		);
	});

	it("keeps Ignore All Highlights behavior unchanged", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], group.clippings, []);
	});

	it("does not style Ignore All Highlights as mod-warning", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(findByText(modal.contentEl, "Ignore All Highlights").classes.has("mod-warning")).toBe(false);
	});
});

describe("FirstSyncPreviewModal UI polish", () => {
	it("opens How choices work near the top controls with count and action help", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const helpActions = elementByClassAt(modal.contentEl, "kls-choice-help-actions", 0);
		expect(buttonTexts(helpActions)).toEqual(["How choices work"]);
		expect(elementsByClass(modal.contentEl, "kls-choice-help")).toHaveLength(0);

		await findByText(helpActions, "How choices work").click();

		const items = elementsByTag(modal.contentEl, "li").map((element) => element.text());

		expect(items).toEqual([
			"Checked / Need Review = books.",
			"Ignore / Skip = individual highlights.",
			"Review Highlights: choose item by item for one book.",
			"Import All: import this book's current highlights.",
			"Ignore All Highlights: ignore this book's current highlights in future syncs.",
			"Skip This Sync: skip this run only. Skipped highlights may return next sync.",
			"Unreviewed highlights are skipped for this sync and may return next time.",
		]);
	});

	it("opens help without resetting decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		await findByText(modal.contentEl, "How choices work").click();

		expect(readText(findSectionByHeading(modal.contentEl, "1 of 1 — Atomic Habits"))).toContain("Status: Ready to Import");
		expect(readText(modal.contentEl)).toContain("Review Highlights: choose item by item for one book.");
	});

	it("opens help without resetting search text", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await searchBooks(modal, "Deep");
		await findByText(modal.contentEl, "How choices work").click();

		expect(elementsByTag(modal.contentEl, "input")[0]?.value).toBe("Deep");
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);
	});

	it("opens help without changing scroll position", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 180);
		setScrollTop(modal.contentEl, 180);
		await findByText(modal.contentEl, "How choices work").click();

		expect(scrollTop(modal.contentEl)).toBe(180);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(180);
	});

	it("explains count meanings, actions, and Finish Sync clearly", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "How choices work").click();

		const items = elementsByTag(modal.contentEl, "li").map((element) => element.text());
		expect(readText(modal.contentEl)).toContain("Counts");
		expect(readText(modal.contentEl)).toContain("Actions");
		expect(readText(modal.contentEl)).toContain("Finish Sync");
		expect(items).toContain("Checked / Need Review = books.");
		expect(items).toContain("Ignore / Skip = individual highlights.");
		expect(items.some((text) => text.startsWith("Review Highlights:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Import All:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Ignore All Highlights:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Skip This Sync:"))).toBe(true);
		expect(items).toContain(
			"Unreviewed highlights are skipped for this sync and may return next time."
		);
		expect(readText(modal.contentEl)).not.toContain("unselected highlights");
	});

	it("puts sticky search, filters, help, compact progress, and book cards in order", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const body = elementByClassAt(modal.contentEl, "kls-modal-scroll-body", 0);
		const stickyIndex = directChildIndexByClass(body, "kls-review-sticky-summary");
		const bookListIndex = directChildIndexByClass(body, "kls-book-list");
		const stickySummary = elementByClassAt(body, "kls-review-sticky-summary", 0);
		const controlsPanel = elementByClassAt(stickySummary, "kls-review-controls-panel", 0);
		const controlsIndex = directChildIndexByClass(controlsPanel, "kls-book-list-controls");
		const helpIndex = directChildIndexByClass(controlsPanel, "kls-choice-help-actions");
		const compactProgressIndex = directChildIndexByClass(controlsPanel, "kls-compact-review-progress");

		expect(stickyIndex).toBeGreaterThan(-1);
		expect(elementsByClass(body, "kls-review-controls-panel")).toHaveLength(1);
		expect(elementsByClass(body, "kls-book-list-controls")).toHaveLength(1);
		expect(elementsByClass(body, "kls-choice-help-actions")).toHaveLength(1);
		expect(elementsByClass(body, "kls-compact-review-progress")).toHaveLength(1);
		expect(elementsByClass(body, "kls-review-progress")).toHaveLength(0);
		expect(controlsIndex).toBeLessThan(helpIndex);
		expect(helpIndex).toBeLessThan(compactProgressIndex);
		expect(bookListIndex).toBeGreaterThan(stickyIndex);
		expect(elementsByClass(body, "kls-choice-help-details")).toHaveLength(0);
	});

	it("styles How choices work as a subtle help control", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const helpButton = findByText(elementByClassAt(modal.contentEl, "kls-choice-help-actions", 0), "How choices work");

		expect(helpButton.classes.has("kls-action-button")).toBe(true);
		expect(helpButton.classes.has("kls-help-button")).toBe(true);
		expect(helpButton.classes.has("mod-cta")).toBe(false);
	});

	it("shows the top-level help content only once", async () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();
		await findByText(modal.contentEl, "How choices work").click();

		expect(countText(readText(modal.contentEl), "Skip This Sync: skip this run only. Skipped highlights may return next sync.")).toBe(1);
	});

	it("does not repeat the skip explanation inside per-book review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(readText(modal.contentEl)).not.toContain("Skipped highlights are only skipped for this sync.");
		expect(buttonTexts(elementByClassAt(modal.contentEl, "kls-choice-help-actions", 0))).toContain("How choices work");
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
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await searchBooks(modal, "Deep");

		expect(readText(modal.contentEl)).toContain("Deep Work");
		expect(readText(modal.contentEl)).not.toContain("Atomic Habits");
	});

	it("filters books by title case-insensitively", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await searchBooks(modal, "atomic");

		expect(readText(modal.contentEl)).toContain("Atomic Habits");
		expect(readText(modal.contentEl)).not.toContain("Deep Work");
	});

	it("filters books by author search", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits", "James Clear"),
			createBookGroup("The Left Hand of Darkness", "Ursula K. Le Guin"),
		]);

		modal.onOpen();
		await searchBooks(modal, "le guin");

		expect(readText(modal.contentEl)).toContain("The Left Hand of Darkness");
		expect(readText(modal.contentEl)).not.toContain("Atomic Habits");
	});

	it("keeps the search input mounted and typed value intact while filtering", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		const input = elementsByTag(modal.contentEl, "input")[0];

		if (!input) {
			throw new Error("Could not find book search input.");
		}

		await input.input("De");

		expect(elementsByTag(modal.contentEl, "input")[0]).toBe(input);
		expect(input.value).toBe("De");
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);
	});

	it("renders the search input without a search icon button", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
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
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		const controls = elementByClassAt(modal.contentEl, "kls-book-list-controls", 0);
		const searchControl = elementByClassAt(controls, "kls-book-search-control", 0);
		const filters = elementByClassAt(controls, "kls-book-filter-row", 0);

		expect(elementsByTag(searchControl, "input")).toHaveLength(1);
		expect(elementsByClass(searchControl, "kls-book-search-button")).toHaveLength(0);
		expect(buttonTexts(filters)).toEqual(["All", "Needs Review", "Checked"]);
	});

	it("keeps search text and visible filtering while typing", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		const input = elementsByTag(modal.contentEl, "input")[0];

		if (!input) {
			throw new Error("Could not find book search input.");
		}

		await input.input("Deep");
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 160);
		setScrollTop(modal.contentEl, 160);

		expect(input.value).toBe("Deep");
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);
		expect(scrollTop(modal.contentEl)).toBe(160);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(160);
	});

	it("does not reset selected decisions when search text changes", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();
		await searchBooks(modal, "Deep");
		await searchBooks(modal, "");

		expect(readText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"))).toContain("Status: Ready to Import");
	});

	it("does not change scroll position while searching", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 210);
		setScrollTop(modal.contentEl, 210);
		await searchBooks(modal, "Deep");

		expect(scrollTop(modal.contentEl)).toBe(210);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(210);
	});

	it("shows an empty state when no books match search", async () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits")]);

		modal.onOpen();
		await searchBooks(modal, "missing");

		expect(readText(modal.contentEl)).toContain("No matching books.");
		expect(elementsByClass(modal.contentEl, "kls-book-section")).toHaveLength(0);
	});

	it("filters All, Needs Review, and Checked books", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();

		await findByText(modal.contentEl, "Needs Review").click();
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);

		await findByText(modal.contentEl, "Checked").click();
		expect(bookHeadings(modal)).toEqual(["1 of 2 — Atomic Habits"]);

		await findByText(modal.contentEl, "All").click();
		expect(bookHeadings(modal)).toEqual([
			"1 of 2 — Atomic Habits",
			"2 of 2 — Deep Work",
		]);
	});

	it("preserves the original My Clippings book order instead of sorting alphabetically", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Zebra Notes"),
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		expect(bookHeadings(modal)).toEqual([
			"1 of 3 — Zebra Notes",
			"2 of 3 — Atomic Habits",
			"3 of 3 — Deep Work",
		]);

		await findByText(findSectionByHeading(modal.contentEl, "2 of 3 — Atomic Habits"), "Import All").click();
		expect(bookHeadings(modal)).toEqual([
			"1 of 3 — Zebra Notes",
			"2 of 3 — Atomic Habits",
			"3 of 3 — Deep Work",
		]);
	});

	it("preserves original relative order while search hides non-matching books", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Zebra Notes", "Morgan Field"),
			createBookGroup("Atomic Habits", "James Clear"),
			createBookGroup("Deep Work", "Morgan Newport"),
		]);

		modal.onOpen();
		await searchBooks(modal, "morgan");

		expect(bookHeadings(modal)).toEqual([
			"1 of 3 — Zebra Notes",
			"3 of 3 — Deep Work",
		]);
	});

	it("combines search and status filter", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();
		await searchBooks(modal, "Deep");
		await findByText(modal.contentEl, "Checked").click();

		expect(readText(modal.contentEl)).toContain("No matching books.");

		await findByText(modal.contentEl, "Needs Review").click();
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);
	});

	it("does not reset selected decisions while filtering and searching", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();
		await searchBooks(modal, "Deep");
		await searchBooks(modal, "");

		expect(readText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"))).toContain("Status: Ready to Import");
	});

	it("keeps review progress global while search is active", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();
		await searchBooks(modal, "Deep");

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 1/2 books · Need Review: 1 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
	});

	it("renders Review Highlights in the book header row", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const header = elementByClassAt(modal.contentEl, "kls-book-header", 0);

		expect(readText(header)).toContain("1 of 1 — Atomic Habits");
		expect(buttonTexts(header)).toEqual(["Review Highlights"]);
	});

	it("renders each book as a shared card container", () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
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

		expect(title.text()).toBe(`1 of 1 — ${longTitle}`);
		expect(buttonTexts(header)).toEqual(["Review Highlights"]);
		expect(buttonTexts(card)).toEqual([
			"Review Highlights",
			"Import All",
			"Ignore All Highlights",
			"Skip This Sync",
		]);
	});

	it("keeps Review Highlights and per-book action buttons inside the same card", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const card = elementByClassAt(modal.contentEl, "kls-book-card", 0);
		const header = elementByClassAt(card, "kls-book-header", 0);
		const actions = elementByClassAt(card, "kls-book-actions", 0);

		expect(buttonTexts(header)).toEqual(["Review Highlights"]);
		expect(buttonTexts(actions)).toEqual(["Import All", "Ignore All Highlights", "Skip This Sync"]);
		expect(buttonTexts(card)).toEqual([
			"Review Highlights",
			"Import All",
			"Ignore All Highlights",
			"Skip This Sync",
		]);
	});

	it("renders incremental review copy without first-sync-only title text", () => {
		const modal = createModal(createPlugin(), [createBookGroup()], { title: "Review New Highlights" });

		modal.onOpen();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("Review New Highlights");
		expect(readText(modal.contentEl)).not.toContain("First Sync Preview");
	});

	it("renders the Kindle warning as a compact callout", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		const callout = elementByClassAt(modal.contentEl, "kls-review-warning-callout", 0);

		expect(paragraphTexts(callout)).toEqual([
			"Kindle may keep deleted highlights in My Clippings.txt.",
			"Review before importing to avoid bringing old deleted highlights into Obsidian.",
		]);
		expect(readText(modal.contentEl)).not.toContain(
			"Kindle may keep deleted highlights in My Clippings.txt. Review before importing if you want to avoid bringing old deleted highlights into Obsidian."
		);
	});
});

describe("FirstSyncPreviewModal selected decision states", () => {
	it("renders per-highlight selected decision as a user-facing badge", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		const selected = elementsByClass(modal.contentEl, "kls-selected-decision")[0];
		const selectedBadge = elementsByClass(selected, "kls-selected-decision-value")[0];

		expect(selected?.text()).toContain("Selected: Skip This Sync");
		expect(selectedBadge?.classes.has("kls-status-badge")).toBe(true);
		expect(selectedBadge?.classes.has("kls-selected-decision-value-skip")).toBe(true);
		expect(readText(modal.contentEl)).not.toContain("Selected: skip");
	});

	it("marks only the selected per-highlight decision button active", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("mod-cta")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(false);

		await buttonByTextAt(modal.contentEl, "Ignore", 0).click();

		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("mod-cta")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(false);

		await buttonByTextAt(modal.contentEl, "Import", 0).click();

		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("kls-decision-button-active")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Import", 0).classes.has("mod-cta")).toBe(true);
		expect(buttonByTextAt(modal.contentEl, "Skip This Sync", 0).classes.has("kls-decision-button-active")).toBe(false);
		expect(buttonByTextAt(modal.contentEl, "Ignore", 0).classes.has("kls-decision-button-active")).toBe(false);
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
			"Small habits make a big difference.",
			"Review this idea later.",
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
		expect(buttonTexts(stickyActions[0])).toEqual(["Finish Sync", "Cancel"]);
	});

	it("shows sticky Back To Book List and Cancel actions in per-book review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		const stickyActions = elementsByClass(modal.contentEl, "kls-sticky-actions");

		expect(stickyActions).toHaveLength(1);
		expect(buttonTexts(stickyActions[0])).toEqual(["Back To Book List", "Cancel"]);
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

		expect(stickyPlugin.completeFirstSync).toHaveBeenCalledWith(createBookGroup().clippings, [], []);

		const bottomPlugin = createPlugin();
		const bottomModal = createModal(bottomPlugin, [createBookGroup()]);

		bottomModal.onOpen();
		await findByText(bottomModal.contentEl, "Import All").click();
		await buttonByTextAt(bottomModal.contentEl, "Finish Sync", -1).click();

		expect(bottomPlugin.completeFirstSync).toHaveBeenCalledWith(createBookGroup().clippings, [], []);
	});
});

describe("FirstSyncPreviewModal book status", () => {
	it("shows Needs Review for untouched books", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Status: Needs Review");
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
		expect(status?.text()).toContain("Status: Needs Review");
	});

	it("shows import status after Import All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		expect(readText(modal.contentEl)).toContain("Status: Ready to Import");
	});

	it("renders import book status as a ready-to-import badge", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();
		const status = elementsByClass(modal.contentEl, "kls-book-status")[0];
		const statusBadge = elementsByClass(status, "kls-status-badge")[0];

		expect(status?.classes.has("kls-book-status-ready-to-import")).toBe(true);
		expect(statusBadge?.classes.has("kls-book-status-value")).toBe(true);
		expect(statusBadge?.classes.has("kls-status-badge-ready-to-import")).toBe(true);
		expect(statusBadge?.text()).toBe("Ready to Import");
		expect(status?.text()).toContain("Status: Ready to Import");
	});

	it("shows ignore status after Ignore All Highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-ignored")).toBe(true);
		expect(statusBadge?.text()).toBe("Ignored");
		expect(readText(modal.contentEl)).toContain("Status: Ignored");
	});

	it("shows skip status after Skip This Sync", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-skipped-this-sync")).toBe(true);
		expect(statusBadge?.text()).toBe("Skipped This Sync");
		expect(readText(modal.contentEl)).toContain("Status: Skipped This Sync");
	});

	it("shows Needs Review while a book still has undecided highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-needs-review")).toBe(true);
		expect(statusBadge?.text()).toBe("Needs Review");
	});

	it("shows Mixed Decisions for import and ignore decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-mixed-decisions")).toBe(true);
		expect(statusBadge?.text()).toBe("Mixed Decisions");
		expect(statusBadge?.text()).not.toBe("");
		expect(readText(modal.contentEl)).toContain("Status: Mixed Decisions");
		expect(readText(modal.contentEl)).not.toContain("Status: Reviewed");
	});

	it("shows Mixed Decisions for import and skip decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await buttonByTextAt(modal.contentEl, "Skip This Sync", 1).click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-mixed-decisions")).toBe(true);
		expect(statusBadge?.text()).toBe("Mixed Decisions");
	});

	it("shows Mixed Decisions for skip and ignore decisions", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Skip This Sync").click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const statusBadge = elementsByClass(modal.contentEl, "kls-status-badge")[0];
		expect(statusBadge?.classes.has("kls-status-badge-mixed-decisions")).toBe(true);
		expect(statusBadge?.classes.has("kls-status-badge-ready-to-import")).toBe(false);
		expect(statusBadge?.text()).toBe("Mixed Decisions");
		expect(statusBadge?.text().trim()).not.toBe("");
	});
});

describe("FirstSyncPreviewModal review progress", () => {
	it("removes the full review progress section from the book list", () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits"), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(readText(modal.contentEl)).not.toContain("Review Progress");
		expect(elementsByClass(modal.contentEl, "kls-review-progress")).toHaveLength(0);
		expect(elementsByClass(modal.contentEl, "kls-review-progress-group")).toHaveLength(0);
	});

	it("shows compact sticky global progress while the book list renders", () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits"), createBookGroup("Deep Work")]);

		modal.onOpen();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 0/2 books · Need Review: 2 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(elementsByClass(compactProgress, "kls-progress-chip").map((chip) => chip.text())).toEqual([
			"Checked: 0/2 books",
			"Need Review: 2 books",
			"Ignore: 0 highlights",
			"Skip: 0 highlights",
		]);
		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
	});

	it("keeps compact progress global while search is active", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Import All").click();
		await searchBooks(modal, "Deep");

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 1/2 books · Need Review: 1 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(bookHeadings(modal)).toEqual(["2 of 2 — Deep Work"]);
	});

	it("updates progress after Import All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 1/1 books · Need Review: 0 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
		expect(readText(modal.contentEl)).not.toContain("Imported");
	});

	it("updates progress after Ignore All Highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 1/1 books · Need Review: 0 books · Ignore: 2 highlights · Skip: 0 highlights"
		);
	});

	it("updates progress after Skip This Sync", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 1/1 books · Need Review: 0 books · Ignore: 0 highlights · Skip: 2 highlights"
		);
	});

	it("updates progress after item-by-item review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 0/1 books · Need Review: 1 books · Ignore: 0 highlights · Skip: 0 highlights"
		);
	});

	it("counts partially reviewed books as not reviewed", async () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits"), createBookGroup("Deep Work")]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"), "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		const compactProgress = elementByClassAt(modal.contentEl, "kls-compact-review-progress", 0);
		expect(readText(compactProgress)).toBe(
			"Checked: 0/2 books · Need Review: 2 books · Ignore: 0 highlights · Skip: 0 highlights"
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

describe("FirstSyncPreviewModal finish confirmation", () => {
	it("shows a confirmation when finishing with highlights not reviewed yet", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(readText(modal.contentEl)).toContain("Some highlights have not been reviewed.");
		expect(readText(modal.contentEl)).toContain(
			"Highlights not reviewed yet will be skipped only for this sync and may appear again next time."
		);
		expect(buttonTexts(modal.contentEl)).toEqual(expect.arrayContaining(["Finish Sync", "Go Back"]));
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

	it("Go Back returns to the book list without completing sync", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Go Back").click();

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

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], [], expect.any(Array));
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
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		const deepWorkSection = findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work");
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 320);
		setScrollTop(modal.contentEl, 320);
		await findByText(deepWorkSection, "Review Highlights").click();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("2 of 2 — Deep Work");
		expect(readText(modal.contentEl)).toContain("Location 154: Small habits make a big difference.");
		expect(scrollTop(modal.contentEl)).toBe(0);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(0);
		expect(scrollIntoViewCalls(deepWorkSection)).toHaveLength(0);
	});

	it("does not break Back To Book List anchor restoration", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(modal.contentEl, 320);
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 25);
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"))).toHaveLength(0);
	});

	it("preserves scroll after selecting a per-highlight decision", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 180);
		setScrollTop(modal.contentEl, 180);
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(scrollTop(modal.contentEl)).toBe(180);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(180);
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
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("1 of 2 — Atomic Habits");
		expect(readText(modal.contentEl)).toContain("2 of 2 — Deep Work");
	});

	it("shows the current book number in per-book review", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Review Highlights").click();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("2 of 2 — Deep Work");
	});

	it("stores the clicked book as a return anchor when Review Highlights is clicked", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Review Highlights").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"))).toEqual([
			{ block: "center" },
		]);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "1 of 2 — Atomic Habits"))).toHaveLength(0);
	});

	it("scrolls the clicked book back into view when Back To Book List is clicked", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(modal.contentEl, 240);
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Review Highlights").click();
		setScrollTop(modal.contentEl, 10);
		await findByText(modal.contentEl, "Back To Book List").click();

		const deepWorkSection = findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work");

		expect(readText(modal.contentEl)).toContain("First Sync Preview");
		expect(scrollIntoViewCalls(deepWorkSection)).toEqual([{ block: "center" }]);
	});

	it("falls back safely when the return anchor cannot be found", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(modal.contentEl, 240);
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Review Highlights").click();
		(modal as unknown as { bookListReturnAnchorKey: string }).bookListReturnAnchorKey = "missing";
		setScrollTop(modal.contentEl, 10);
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(readText(modal.contentEl)).toContain("First Sync Preview");
		expect(scrollTop(modal.contentEl)).toBe(240);
	});

	it("preserves book position after a book-level action", async () => {
		const modal = createModal(createPlugin(), [
			createBookGroup("Atomic Habits"),
			createBookGroup("Deep Work"),
		]);

		modal.onOpen();
		setScrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0], 275);
		setScrollTop(modal.contentEl, 275);
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Skip This Sync").click();

		expect(scrollTop(modal.contentEl)).toBe(275);
		expect(scrollTop(elementsByClass(modal.contentEl, "kls-modal-scroll-body")[0])).toBe(275);
		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"))).toHaveLength(0);
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
		completeFirstSync: vi.fn(async () => {}),
	};
}

function createBookGroup(bookTitle = "Atomic Habits", author = "James Clear"): KindleBookGroup {
	const firstHighlight = createHighlight({
		bookTitle,
		author,
		location: "154",
		content: "Small habits make a big difference.",
	});
	const secondHighlight = createHighlight({
		bookTitle,
		author,
		location: "160",
		content: "Review this idea later.",
		type: "Note",
	});

	return {
		bookTitle,
		author,
		clippings: [firstHighlight, secondHighlight],
	};
}

function createSingleHighlightBookGroup(bookTitle = "Atomic Habits", author = "James Clear"): KindleBookGroup {
	return {
		bookTitle,
		author,
		clippings: [
			createHighlight({
				bookTitle,
				author,
				location: "154",
				content: "Small habits make a big difference.",
			}),
		],
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
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
	input: (value: string) => Promise<void>;
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

async function searchBooks(modal: { contentEl: unknown }, query: string): Promise<void> {
	const input = elementsByTag(modal.contentEl, "input")[0];

	if (!input) {
		throw new Error("Could not find book search input.");
	}

	await input.input(query);
}

function bookHeadings(modal: { contentEl: unknown }): string[] {
	return elementsByClass(modal.contentEl, "kls-book-title").map((element) => element.text());
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
			(element.classes.has("kls-book-section") && hasHeadingDescendant(element, heading))
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

function hasHeadingDescendant(element: TestElement, heading: string): boolean {
	if (element.tagName === "h3" && element.text() === heading) {
		return true;
	}

	return element.children.some((child) => hasHeadingDescendant(child, heading));
}
