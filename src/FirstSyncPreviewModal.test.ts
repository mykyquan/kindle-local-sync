import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { KindleHighlight } from "./parser/parseClippings";
import { KindleBookGroup } from "./render/renderMarkdown";

let FirstSyncPreviewModal: typeof import("./FirstSyncPreviewModal").FirstSyncPreviewModal;

beforeAll(async () => {
	FirstSyncPreviewModal = (await import("./FirstSyncPreviewModal")).FirstSyncPreviewModal;
});

describe("FirstSyncPreviewModal skip and ignore behavior", () => {
	it("labels book skip as Skip this sync", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Skip this sync");
		expect(readText(modal.contentEl)).not.toContain("Skip book");
	});

	it("does not persist skipped book highlights to ignoredHighlights", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip this sync").click();
		await findByText(modal.contentEl, "Finish sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], [], expect.any(Array));
	});

	it("adds all book highlights to ignoredHighlights when Ignore all highlights is clicked", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore all highlights").click();
		await findByText(modal.contentEl, "Finish sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], group.clippings, []);
	});

	it("keeps per-highlight skip non-persistent", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review highlights").click();
		await findByText(modal.contentEl, "Skip this sync").click();
		await findByText(modal.contentEl, "Back to book list").click();
		await findByText(modal.contentEl, "Finish sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], [], expect.any(Array));
	});
});

describe("FirstSyncPreviewModal wording and layout", () => {
	it("shows Ignore all highlights instead of Ignore book", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Ignore all highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignore book");
	});

	it("shows Review highlights before Import all", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const buttons = buttonTexts(modal.contentEl);
		expect(buttons.indexOf("Review highlights")).toBeLessThan(buttons.indexOf("Import all"));
	});

	it("shows the choices explanation only once", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "How choices work:")).toBe(1);
		expect(countText(readText(modal.contentEl), "Ignore all highlights skips the currently found highlights")).toBe(1);
	});

	it("does not repeat the skip explanation under each book", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "Skip this sync only skips them now; they may appear again next time.")).toBe(1);
		expect(readText(modal.contentEl)).not.toContain(
			"Skipped highlights are only skipped for this sync. They may appear again next time unless ignored."
		);
	});

	it("keeps Ignore all highlights behavior unchanged", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore all highlights").click();
		await findByText(modal.contentEl, "Finish sync").click();

		expect(plugin.completeFirstSync).toHaveBeenCalledWith([], group.clippings, []);
	});

	it("does not style Ignore all highlights as mod-warning", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		expect(findByText(modal.contentEl, "Ignore all highlights").classes.has("mod-warning")).toBe(false);
	});
});

describe("FirstSyncPreviewModal UI polish", () => {
	it("renders the How choices work explanation as separate lines", () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();

		const paragraphs = elementsByTag(modal.contentEl, "p").map((element) => element.text());
		expect(paragraphs).toContain("How choices work:");
		expect(paragraphs).toContain("Review highlights lets you decide highlight by highlight.");
		expect(paragraphs).toContain("Import all imports all currently found highlights from a book.");
		expect(paragraphs).toContain("Ignore all highlights skips the currently found highlights from that book in future syncs.");
		expect(paragraphs).toContain("Skip this sync only skips them now; they may appear again next time.");
	});

	it("shows the top-level explanation only once", () => {
		const modal = createModal(createPlugin(), [createBookGroup(), createBookGroup("Deep Work")]);

		modal.onOpen();

		expect(countText(readText(modal.contentEl), "How choices work:")).toBe(1);
		expect(countText(readText(modal.contentEl), "Skip this sync only skips them now; they may appear again next time.")).toBe(1);
	});

	it("does not repeat the skip explanation inside per-book review", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review highlights").click();

		expect(readText(modal.contentEl)).not.toContain("Skipped highlights are only skipped for this sync.");
		expect(readText(modal.contentEl)).not.toContain("How choices work:");
	});

	it("orders per-highlight buttons as Import, Skip this sync, Ignore", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review highlights").click();

		const buttons = buttonTexts(modal.contentEl);
		const importIndex = buttons.indexOf("Import");
		const skipIndex = buttons.indexOf("Skip this sync");
		const ignoreIndex = buttons.indexOf("Ignore");

		expect(importIndex).toBeGreaterThan(-1);
		expect(importIndex).toBeLessThan(skipIndex);
		expect(skipIndex).toBeLessThan(ignoreIndex);
	});

	it("styles per-highlight Import as CTA", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review highlights").click();

		expect(findByText(modal.contentEl, "Import").classes.has("mod-cta")).toBe(true);
	});

	it("does not style per-highlight Ignore as mod-warning", async () => {
		const modal = createModal(createPlugin(), [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review highlights").click();

		expect(findByText(modal.contentEl, "Ignore").classes.has("mod-warning")).toBe(false);
	});
});

describe("FirstSyncPreviewModal skipped summary items", () => {
	it("includes explicitly skipped highlights in skippedThisSyncHighlights", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Skip this sync").click();
		await findByText(modal.contentEl, "Finish sync").click();

		const skippedHighlights = getCompleteFirstSyncArgs(plugin)[2];
		expect(skippedHighlights.map((highlight) => highlight.textPreview)).toEqual([
			"Small habits make a big difference.",
			"Review this idea later.",
		]);
	});

	it("treats unselected highlights as skippedThisSyncHighlights on Finish sync", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = createModal(plugin, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish sync").click();

		const skippedHighlights = getCompleteFirstSyncArgs(plugin)[2];
		expect(skippedHighlights).toHaveLength(group.clippings.length);
	});

	it("does not persist skippedThisSyncHighlights to settings", async () => {
		const plugin = createPlugin();
		const modal = createModal(plugin, [createBookGroup()]);

		modal.onOpen();
		await findByText(modal.contentEl, "Finish sync").click();

		expect(JSON.stringify(plugin.settings)).not.toContain("skippedThisSyncHighlights");
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

function collectElementsByTag(element: TestElement, tagName: string, matches: TestElement[]): void {
	if (element.tagName === tagName) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByTag(child, tagName, matches);
	}
}
