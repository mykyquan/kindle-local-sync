import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { FirstSyncPreviewModal } from "./FirstSyncPreviewModal";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { SyncSummaryModal } from "./SyncSummaryModal";
import { SyncClassification } from "./sync/SyncClassifier";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

const mocks = vi.hoisted(() => ({
	removeIgnoredHighlightBlocksFromExistingNotes: vi.fn(),
	writeBookNotesToVault: vi.fn(),
}));

vi.mock("./sync/IgnoredHighlightCleanup", () => ({
	removeIgnoredHighlightBlocksFromExistingNotes: mocks.removeIgnoredHighlightBlocksFromExistingNotes,
}));

vi.mock("./sync/VaultWriter", () => ({
	writeBookNotesToVault: mocks.writeBookNotesToVault,
}));

let KindleLocalSyncPlugin: typeof import("./main").default;

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.writeBookNotesToVault.mockResolvedValue({
		books: 0,
		filesCreated: 0,
		filesUpdated: 0,
		filesUnchanged: 0,
		highlightsRendered: 0,
		duplicatesSkipped: 0,
	});
	mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValue({
		filesScanned: 1,
		filesUpdated: 1,
		blocksRemoved: 1,
	});
});

describe("ignored highlight cleanup triggers", () => {
	it("First Sync Preview per-highlight Ignore triggers cleanup", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = new FirstSyncPreviewModal(new App() as never, plugin as never, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore").click();
		await findByText(modal.contentEl, "Back To Book List").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const firstHighlight = group.clippings[0];
		if (!firstHighlight) {
			throw new Error("Expected a first highlight in the test group.");
		}

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[createClippingId(firstHighlight)]
		);
	});

	it("First Sync Preview Ignore All Highlights triggers cleanup", async () => {
		const plugin = createPlugin();
		const group = createBookGroup();
		const modal = new FirstSyncPreviewModal(new App() as never, plugin as never, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All Highlights").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			group.clippings.map(createClippingId)
		);
	});

	it("Sync Summary Ignore Going Forward triggers cleanup", async () => {
		const plugin = createPlugin();
		const highlight = createSummaryItem({ id: "kls-skipped" });
		const modal = createSyncSummaryModal(plugin, {
			skippedThisSyncHighlights: [highlight],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			["kls-skipped"]
		);
	});

	it("Sync Summary Ignore All Highlights triggers cleanup", async () => {
		const plugin = createPlugin();
		const highlights = [
			createSummaryItem({ id: "kls-one" }),
			createSummaryItem({ id: "kls-two", textPreview: "Second highlight." }),
		];
		const modal = createSyncSummaryModal(plugin, {
			skippedThisSyncHighlights: highlights,
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			["kls-one"]
		);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			["kls-two"]
		);
	});

	it("Sync Summary Ignore Forever triggers cleanup if applicable", async () => {
		const plugin = createPlugin();
		const highlight = createHighlight();
		const modal = createSyncSummaryModal(plugin, {
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Suspicious Items").click();
		await findByText(modal.contentEl, "Ignore Forever").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[createClippingId(highlight)]
		);
	});
});

function createPlugin(): InstanceType<typeof KindleLocalSyncPlugin> {
	return new KindleLocalSyncPlugin(new App() as never, {} as never);
}

function createSyncSummaryModal(
	plugin: InstanceType<typeof KindleLocalSyncPlugin>,
	options: {
		classification?: SyncClassification;
		skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
	}
): SyncSummaryModal {
	return new SyncSummaryModal(new App() as never, plugin as never, {
		classification: options.classification ?? createClassification(),
		automaticHighlights: [],
		importedCount: 0,
		skippedThisSyncHighlights: options.skippedThisSyncHighlights ?? [],
	});
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

function createBookGroup(): KindleBookGroup {
	const firstHighlight = createHighlight({
		location: "154",
		content: "Small habits make a big difference.",
	});
	const secondHighlight = createHighlight({
		location: "160",
		content: "Review this idea later.",
		type: "Note",
	});

	return {
		bookTitle: "Atomic Habits",
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

function findByText(element: unknown, text: string): TestElement {
	const match = (element as TestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find text: ${text}`);
	}

	return match;
}
