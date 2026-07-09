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
	it("shows View ignored highlights when ignored highlights were skipped", () => {
		const modal = createModal({
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("View ignored highlights");
	});

	it("renders ignored highlights view when clicked", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View ignored highlights").click();

		expect(readText(modal.contentEl)).toContain("Ignored highlights");
		expect(readText(modal.contentEl)).toContain("Small habits make a big difference.");
	});

	it("shows Back to summary in ignored highlights view", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View ignored highlights").click();

		expect(readText(modal.contentEl)).toContain("Back to summary");
	});

	it("returns to summary when Back to summary is clicked", async () => {
		const modal = createModal({
			plugin: createPlugin({
				ignoredHighlights: [createIgnoredHighlight()],
			}),
			classification: createClassification({
				ignoredHighlights: [createHighlight()],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "View ignored highlights").click();
		await findByText(modal.contentEl, "Back to summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
	});

	it("removes an ignored highlight when Remove from ignore list is clicked", async () => {
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
		await findByText(modal.contentEl, "View ignored highlights").click();
		await findByText(modal.contentEl, "Remove from ignore list").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("kls-ignored");
		expect(readText(modal.contentEl)).toContain("No ignored highlights");
	});
});

describe("SyncSummaryModal skipped-this-sync navigation", () => {
	it("shows Review skipped this sync when skippedThisSyncHighlights exist", () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Review skipped this sync");
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
		await findByText(modal.contentEl, "Review skipped this sync").click();

		expect(readText(modal.contentEl)).toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("2 highlights skipped this sync");
		expect(readText(modal.contentEl)).toContain("Deep Work");
	});

	it("shows Back to summary in skipped books view", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();

		expect(readText(modal.contentEl)).toContain("Back to summary");
	});

	it("returns to summary when Back to summary is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Back to summary").click();

		expect(readText(modal.contentEl)).toContain("Sync complete");
	});

	it("renders per-book skipped highlight review when Review highlights is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Review highlights").click();

		expect(readText(modal.contentEl)).toContain("Small habits make a big difference.");
		expect(readText(modal.contentEl)).toContain("Ignore going forward");
	});

	it("shows Back to skipped books in per-book review", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Review highlights").click();

		expect(readText(modal.contentEl)).toContain("Back to skipped books");
	});

	it("returns to skipped books when Back to skipped books is clicked", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Review highlights").click();
		await findByText(modal.contentEl, "Back to skipped books").click();

		expect(readText(modal.contentEl)).toContain("Skipped this sync");
		expect(readText(modal.contentEl)).toContain("1 highlights skipped this sync");
	});

	it("adds a skipped highlight to ignoredHighlights when Ignore going forward is clicked", async () => {
		const plugin = createPlugin();
		const highlight = createSummaryItem();
		const modal = createModal({
			plugin,
			skippedThisSyncHighlights: [highlight],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Review highlights").click();
		await findByText(modal.contentEl, "Ignore going forward").click();

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlight);
	});

	it("removes the highlight row after Ignore going forward", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Review highlights").click();
		await findByText(modal.contentEl, "Ignore going forward").click();

		expect(readText(modal.contentEl)).not.toContain("Small habits make a big difference.");
		expect(readText(modal.contentEl)).toContain("No skipped highlights left in this book.");
	});

	it("adds all skipped highlights from a book to ignoredHighlights when Ignore all highlights is clicked", async () => {
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
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Ignore all highlights").click();

		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlights[0]);
		expect(plugin.ignoreSummaryHighlight).toHaveBeenCalledWith(highlights[1]);
	});

	it("shows empty state when all skipped highlights are handled", async () => {
		const modal = createModal({
			skippedThisSyncHighlights: [createSummaryItem()],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review skipped this sync").click();
		await findByText(modal.contentEl, "Ignore all highlights").click();

		expect(readText(modal.contentEl)).toContain("No skipped highlights left to review.");
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

function createIgnoredHighlight(): IgnoredHighlight {
	return {
		id: "kls-ignored",
		title: "Atomic Habits",
		textPreview: "Small habits make a big difference.",
		ignoredAt: "2026-07-09T00:00:00.000Z",
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
