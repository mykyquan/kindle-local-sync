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

		expect(countText(readText(modal.contentEl), "How choices work:")).toBe(1);
		expect(countText(readText(modal.contentEl), "Ignore all highlights: Ignore current highlights from this book")).toBe(1);
	});

	it("does not repeat the skip explanation under each book", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "Skip this sync: Skip only this run. They may appear again next time.")).toBe(1);
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
	it("renders How choices work as a bullet list", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const lists = elementsByTag(modal.contentEl, "ul");
		const items = elementsByTag(modal.contentEl, "li").map((element) => element.text());

		expect(lists).toHaveLength(1);
		expect(items).toEqual([
			"Review highlights: Choose item by item.",
			"Import all: Import all current highlights from this book.",
			"Ignore all highlights: Ignore current highlights from this book in future syncs and remove existing generated blocks when safe.",
			"Skip this sync: Skip only this run. They may appear again next time.",
		]);
	});

	it("explains Import All, Ignore All Highlights, and Skip This Sync clearly", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const items = elementsByTag(modal.contentEl, "li").map((element) => element.text());
		expect(items.some((text) => text.startsWith("Review highlights:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Import all:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Ignore all highlights:"))).toBe(true);
		expect(items.some((text) => text.startsWith("Skip this sync:"))).toBe(true);
		expect(readText(modal.contentEl)).not.toContain("unselected highlights");
	});

	it("shows the top-level explanation only once", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "How choices work:")).toBe(1);
		expect(countText(readText(modal.contentEl), "Skip this sync: Skip only this run. They may appear again next time.")).toBe(1);
	});

	it("does not repeat the skip explanation inside per-book review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(readText(modal.contentEl)).not.toContain("Skipped highlights are only skipped for this sync.");
		expect(readText(modal.contentEl)).not.toContain("How choices work:");
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

	it("styles per-highlight Import as CTA", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(findByText(modal.contentEl, "Import").classes.has("mod-cta")).toBe(true);
	});

	it("does not style per-highlight Ignore as mod-warning", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		expect(findByText(modal.contentEl, "Ignore").classes.has("mod-warning")).toBe(false);
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
	it("shows Not Reviewed Yet for untouched books", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Status: Not Reviewed Yet");
	});

	it("shows import status after Import All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		expect(readText(modal.contentEl)).toContain("Status: All Current Highlights Selected To Import");
	});

	it("shows ignore status after Ignore All Highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(readText(modal.contentEl)).toContain("Status: All Current Highlights Selected To Ignore");
	});

	it("shows skip status after Skip This Sync", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(readText(modal.contentEl)).toContain("Status: All Current Highlights Selected To Skip This Sync");
	});

	it("shows partial review status for books reviewed item by item", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(readText(modal.contentEl)).toContain("Status: Partially Reviewed · 1 Import");
	});

	it("shows reviewed status when all highlights in a book have explicit choices", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await buttonByTextAt(modal.contentEl, "Ignore", 1).click();
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(readText(modal.contentEl)).toContain("Status: Reviewed · 1 Import · 1 Ignore");
	});
});

describe("FirstSyncPreviewModal review progress", () => {
	it("shows review progress summary in the book list", () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits"), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Review Progress");
		expect(readText(modal.contentEl)).toContain("Reviewed: 0 of 2 books");
		expect(readText(modal.contentEl)).toContain("Partially Reviewed: 0 books");
		expect(readText(modal.contentEl)).toContain("Not Reviewed: 2 books");
		expect(readText(modal.contentEl)).toContain("To Import: 0 highlights");
		expect(readText(modal.contentEl)).toContain("To Ignore: 0 highlights");
		expect(readText(modal.contentEl)).toContain("To Skip This Sync: 0 highlights");
		expect(readText(modal.contentEl)).toContain("Not Reviewed Yet: 4 highlights");
	});

	it("updates progress after Import All", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Import All").click();

		expect(readText(modal.contentEl)).toContain("Reviewed: 1 of 1 books");
		expect(readText(modal.contentEl)).toContain("To Import: 2 highlights");
		expect(readText(modal.contentEl)).toContain("Not Reviewed Yet: 0 highlights");
	});

	it("updates progress after Ignore All Highlights", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(readText(modal.contentEl)).toContain("Reviewed: 1 of 1 books");
		expect(readText(modal.contentEl)).toContain("To Ignore: 2 highlights");
	});

	it("updates progress after Skip This Sync", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip This Sync").click();

		expect(readText(modal.contentEl)).toContain("Reviewed: 1 of 1 books");
		expect(readText(modal.contentEl)).toContain("To Skip This Sync: 2 highlights");
	});

	it("updates progress after item-by-item review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Import").click();
		await findByText(modal.contentEl, "Back To Book List").click();

		expect(readText(modal.contentEl)).toContain("Reviewed: 0 of 1 books");
		expect(readText(modal.contentEl)).toContain("Partially Reviewed: 1 books");
		expect(readText(modal.contentEl)).toContain("To Import: 1 highlights");
		expect(readText(modal.contentEl)).toContain("Not Reviewed Yet: 1 highlights");
	});

	it("counts not reviewed highlights correctly", () => {
		const modal = createModal(createPlugin(), [createBookGroup("Atomic Habits"), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Not Reviewed Yet: 4 highlights");
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
		expect(readText(modal.contentEl)).toContain("Review Progress");
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
		setScrollTop(modal.contentEl, 320);
		await findByText(deepWorkSection, "Review Highlights").click();

		expect(elementsByTag(modal.contentEl, "h2").map((element) => element.text())).toContain("2 of 2 — Deep Work");
		expect(readText(modal.contentEl)).toContain("Location 154: Small habits make a big difference.");
		expect(scrollTop(modal.contentEl)).toBe(0);
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
		await findByText(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"), "Skip This Sync").click();

		expect(scrollIntoViewCalls(findSectionByHeading(modal.contentEl, "2 of 2 — Deep Work"))).toEqual([
			{ block: "center" },
		]);
	});
});

function createModal(plugin: ReturnType<typeof createPlugin>, bookGroups: KindleBookGroup[]) {
	return new FirstSyncPreviewModal(new App() as never, plugin as never, bookGroups);
}

function createPlugin() {
	return {
		settings: {},
		completeFirstSync: vi.fn(async () => {}),
	};
}

function createBookGroup(bookTitle = "Atomic Habits"): KindleBookGroup {
	const firstHighlight = createHighlight({
		bookTitle,
		location: "154",
		content: "Small habits make a big difference.",
	});
	const secondHighlight = createHighlight({
		bookTitle,
		location: "160",
		content: "Review this idea later.",
		type: "Note",
	});

	return {
		bookTitle,
		author: "James Clear",
		clippings: [firstHighlight, secondHighlight],
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
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
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

function elementsByClass(element: unknown, className: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByClass(element as TestElement, className, matches);

	return matches;
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
