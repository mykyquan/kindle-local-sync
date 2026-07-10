import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import type { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import type { IgnoredHighlight, ImportedHighlightRecord, KindleSyncSettings } from "./settings";
import type { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

interface ReviewCompletion {
	importHighlights: KindleHighlight[];
	ignoreHighlights: KindleHighlight[];
	skippedThisSyncHighlights: SyncSummaryHighlightItem[];
}

interface ReviewModalCapture {
	bookGroups: KindleBookGroup[];
	options?: {
		title?: string;
		onComplete?: (completion: ReviewCompletion) => Promise<void>;
	};
	open: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
	detectClippingsPath: vi.fn(),
	readClippingsFile: vi.fn(),
	parseClippings: vi.fn(),
	hasExistingHighlightNotes: vi.fn(),
	writeBookNotesToVault: vi.fn(),
	removeIgnoredHighlightBlocksFromExistingNotes: vi.fn(),
	highlightExistsInNote: vi.fn(),
	firstSyncPreviewInstances: [] as ReviewModalCapture[],
	syncSummaryOpen: vi.fn(),
}));

vi.mock("./sync/KindleDetector", () => ({
	detectClippingsPath: mocks.detectClippingsPath,
}));

vi.mock("./sync/ClippingsReader", () => ({
	readClippingsFile: mocks.readClippingsFile,
}));

vi.mock("./parser/parseClippings", () => ({
	parseClippings: mocks.parseClippings,
}));

vi.mock("./sync/ExistingHighlightNotes", () => ({
	hasExistingHighlightNotes: mocks.hasExistingHighlightNotes,
}));

vi.mock("./sync/VaultWriter", () => ({
	writeBookNotesToVault: mocks.writeBookNotesToVault,
}));

vi.mock("./sync/IgnoredHighlightCleanup", () => ({
	removeIgnoredHighlightBlocksFromExistingNotes: mocks.removeIgnoredHighlightBlocksFromExistingNotes,
}));

vi.mock("./sync/VaultHighlightLookup", () => ({
	createVaultHighlightLookup: () => mocks.highlightExistsInNote,
}));

vi.mock("./FirstSyncPreviewModal", () => ({
	FirstSyncPreviewModal: class {
		private readonly capture: ReviewModalCapture;

		constructor(_app: unknown, _plugin: unknown, bookGroups: KindleBookGroup[], options?: ReviewModalCapture["options"]) {
			this.capture = {
				bookGroups,
				options,
				open: vi.fn(),
			};
			mocks.firstSyncPreviewInstances.push(this.capture);
		}

		open(): void {
			this.capture.open();
		}
	},
}));

vi.mock("./SyncSummaryModal", () => ({
	SyncSummaryModal: class {
		open(): void {
			mocks.syncSummaryOpen();
		}
	},
}));

let KindleLocalSyncPlugin: typeof import("./main").default;

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.firstSyncPreviewInstances.length = 0;
	mocks.detectClippingsPath.mockResolvedValue("/Volumes/Kindle/documents/My Clippings.txt");
	mocks.readClippingsFile.mockResolvedValue("raw clippings");
	mocks.parseClippings.mockReturnValue([]);
	mocks.hasExistingHighlightNotes.mockResolvedValue(false);
	mocks.highlightExistsInNote.mockResolvedValue(true);
	mocks.writeBookNotesToVault.mockResolvedValue({
		books: 1,
		filesCreated: 0,
		filesUpdated: 1,
		filesUnchanged: 0,
		highlightsRendered: 1,
		duplicatesSkipped: 0,
	});
	mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValue({
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
	});
});

describe("sync review gate", () => {
	it("opens review before importing on first sync", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(null);
		mocks.parseClippings.mockReturnValue([highlight]);

		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(reviewedHighlightIds()).toEqual([createClippingId(highlight)]);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();

		await plugin.completeFirstSync([highlight], [], []);

		expect(mocks.writeBookNotesToVault).toHaveBeenCalledTimes(1);
		expect(writtenHighlightIds()).toEqual([createClippingId(highlight)]);
	});

	it("does not force review or duplicate state when a later sync has no new highlights", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		mocks.parseClippings.mockReturnValue([highlight]);

		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(writtenHighlightIds()).toEqual([createClippingId(highlight)]);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([createClippingId(highlight)]);
	});

	it("opens review only for newly detected later-sync highlights and waits for Finish Sync before importing them", async () => {
		const existingHighlight = createHighlight();
		const newHighlight = createHighlight({
			location: "160",
			content: "Newly captured idea.",
			dateAdded: "Friday, May 15, 2026 9:10 AM",
		});
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(existingHighlight)],
		}));
		mocks.parseClippings.mockReturnValue([existingHighlight, newHighlight]);

		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedHighlightIds()).toEqual([createClippingId(newHighlight)]);
		expect(reviewedHighlightIds()).not.toContain(createClippingId(existingHighlight));
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();

		await finishIncrementalReview({
			importHighlights: [newHighlight],
			ignoreHighlights: [],
			skippedThisSyncHighlights: [],
		});

		expect(writtenHighlightIds()).toEqual([
			createClippingId(existingHighlight),
			createClippingId(newHighlight),
		]);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(existingHighlight),
			createClippingId(newHighlight),
		]);
	});

	it("keeps ignored highlights out of later-sync review and automatic import", async () => {
		const importedHighlight = createHighlight();
		const ignoredHighlight = createHighlight({
			location: "165",
			content: "Do not import this deleted highlight.",
			dateAdded: "Saturday, May 16, 2026 11:30 AM",
		});
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(importedHighlight)],
			ignoredHighlights: [createIgnoredRecord(ignoredHighlight)],
		}));
		mocks.parseClippings.mockReturnValue([importedHighlight, ignoredHighlight]);

		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(writtenHighlightIds()).toEqual([createClippingId(importedHighlight)]);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).not.toContain(createClippingId(ignoredHighlight));
		expect(plugin.settings.ignoredHighlights.map((record) => record.id)).toContain(createClippingId(ignoredHighlight));
	});

	it("treats Skip This Sync as temporary so skipped highlights reappear in future review", async () => {
		const existingHighlight = createHighlight();
		const skippedHighlight = createHighlight({
			location: "170",
			content: "Maybe later.",
			dateAdded: "Sunday, May 17, 2026 7:45 PM",
		});
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(existingHighlight)],
		}));
		mocks.parseClippings.mockReturnValue([existingHighlight, skippedHighlight]);

		await plugin.syncHighlights();
		await finishIncrementalReview({
			importHighlights: [],
			ignoreHighlights: [],
			skippedThisSyncHighlights: [createSummaryItem(skippedHighlight)],
		});

		expect(writtenHighlightIds()).toEqual([createClippingId(existingHighlight)]);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).not.toContain(createClippingId(skippedHighlight));
		expect(plugin.settings.ignoredHighlights.map((record) => record.id)).not.toContain(createClippingId(skippedHighlight));

		mocks.firstSyncPreviewInstances.length = 0;
		mocks.writeBookNotesToVault.mockClear();

		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(reviewedHighlightIds()).toEqual([createClippingId(skippedHighlight)]);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});
});

describe("existing notes without data review choices", () => {
	it("Continue with existing notes does not force review when current clippings match existing managed notes", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);
		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(writtenHighlightIds()).toEqual([createClippingId(existingHighlight)]);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(existingHighlight),
		]);
	});

	it("Continue with existing notes reviews only unmatched highlights", async () => {
		const existingHighlight = createHighlight();
		const newHighlight = createHighlight({
			location: "160",
			content: "Newly captured idea.",
			dateAdded: "Friday, May 15, 2026 9:10 AM",
		});
		const existingId = createClippingId(existingHighlight);
		const plugin = await createPlugin(null);
		mocks.parseClippings.mockReturnValue([existingHighlight, newHighlight]);
		mocks.highlightExistsInNote.mockImplementation(async (id: string) => id === existingId);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedHighlightIds()).toEqual([createClippingId(newHighlight)]);
		expect(reviewedHighlightIds()).not.toContain(existingId);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});

	it("Review everything forces full review of detected highlights even when notes can be matched", async () => {
		const existingHighlight = createHighlight();
		const newHighlight = createHighlight({
			location: "160",
			content: "Newly captured idea.",
			dateAdded: "Friday, May 15, 2026 9:10 AM",
		});
		const plugin = await createPlugin(null);
		mocks.parseClippings.mockReturnValue([existingHighlight, newHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);

		await plugin.reviewExistingNotesWithoutDataAsFirstSync();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review Everything Before Syncing");
		expect(reviewedHighlightIds()).toEqual([
			createClippingId(existingHighlight),
			createClippingId(newHighlight),
		]);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});
});

async function createPlugin(
	loadedData: Partial<KindleSyncSettings> | null
): Promise<InstanceType<typeof KindleLocalSyncPlugin>> {
	const plugin = new KindleLocalSyncPlugin(new App() as never, {} as never);

	(plugin as unknown as { setLoadedData(data: unknown): void }).setLoadedData(loadedData);
	await plugin.loadSettings();
	return plugin;
}

function createSettings(overrides: Partial<KindleSyncSettings> = {}): KindleSyncSettings {
	return {
		clippingsPath: "",
		highlightsFolder: "Kindle Highlights",
		strictLocalOnly: true,
		skipIgnoredHighlights: true,
		ignoredHighlights: [],
		importedHighlights: [],
		hasCompletedFirstSync: true,
		...overrides,
	};
}

function createImportedRecord(highlight: KindleHighlight): ImportedHighlightRecord {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		textPreview: highlight.content,
		importedAt: "2026-07-09T00:00:00.000Z",
	};
}

function createIgnoredRecord(highlight: KindleHighlight): IgnoredHighlight {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		textPreview: highlight.content,
		ignoredAt: "2026-07-09T00:00:00.000Z",
	};
}

function createSummaryItem(highlight: KindleHighlight): SyncSummaryHighlightItem {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		textPreview: highlight.content,
		location: highlight.location || undefined,
	};
}

async function finishIncrementalReview(completion: ReviewCompletion): Promise<void> {
	const onComplete = mocks.firstSyncPreviewInstances.at(-1)?.options?.onComplete;

	if (!onComplete) {
		throw new Error("Expected incremental review completion handler.");
	}

	await onComplete(completion);
}

function reviewedHighlightIds(): string[] {
	return (mocks.firstSyncPreviewInstances.at(-1)?.bookGroups ?? [])
		.flatMap((group) => group.clippings)
		.map(createClippingId);
}

function writtenHighlightIds(): string[] {
	const writeCalls = mocks.writeBookNotesToVault.mock.calls as Array<[unknown, unknown, KindleBookGroup[]]>;
	const lastCall = writeCalls.at(-1);

	if (!lastCall) {
		return [];
	}

	const bookGroups = lastCall[2];

	return bookGroups.flatMap((group) => group.clippings).map(createClippingId);
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
