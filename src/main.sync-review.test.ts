import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "../__mocks__/obsidian";
import type { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import type { IgnoredHighlight, ImportedHighlightRecord, KindleSyncSettings } from "./settings";
import type { SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";
import type { IgnoredHighlightCleanupSummary } from "./sync/IgnoredHighlightCleanup";
import type { SyncClassification } from "./sync/SyncClassifier";
import { createVaultWritePlan, type VaultWriteSummary } from "./sync/VaultWriter";
import { InvalidVaultWriteContractError } from "./sync/VaultWriteContract";
import type {
	IgnoreResultsPresentation,
	ProtectedBooksPresentation,
} from "./SyncOutcomePresentation";

interface ReviewCompletion {
	importHighlights: KindleHighlight[];
	ignoreHighlights: KindleHighlight[];
	skippedThisSyncHighlights: SyncSummaryHighlightItem[];
}

interface ReviewModalCapture {
	bookGroups: KindleBookGroup[];
	options?: {
		title?: string;
		completionNotice?: (importedCount: number, protectedSelectedHighlightCount: number) => string;
		onComplete?: (completion: ReviewCompletion) => Promise<{
			importedCount: number;
			protectedSelectedHighlightCount: number;
		}>;
	};
	open: ReturnType<typeof vi.fn>;
}

interface ExistingNotesWithoutDataCapture {
	open: ReturnType<typeof vi.fn>;
}

interface SyncSummaryCapture {
	classification: SyncClassification;
	automaticHighlights: KindleHighlight[];
	importedCount: number;
	protectedBooks?: ProtectedBooksPresentation;
	ignoreResults?: IgnoreResultsPresentation;
}

const mocks = vi.hoisted(() => ({
	detectClippingsPath: vi.fn(),
	readClippingsFile: vi.fn(),
	parseClippings: vi.fn(),
	hasExistingHighlightNotes: vi.fn(),
	writeBookNotesToVault: vi.fn(),
	removeIgnoredHighlightBlocksFromExistingNotes: vi.fn(),
	highlightExistsInNote: vi.fn(),
	existingNotesWithoutDataInstances: [] as ExistingNotesWithoutDataCapture[],
	firstSyncPreviewInstances: [] as ReviewModalCapture[],
	syncSummaryInstances: [] as SyncSummaryCapture[],
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

vi.mock("./sync/VaultWriter", async () => {
	const actual = await vi.importActual<typeof import("./sync/VaultWriter")>("./sync/VaultWriter");

	return {
		...actual,
		writeBookNotesToVault: mocks.writeBookNotesToVault,
	};
});

vi.mock("./sync/IgnoredHighlightCleanup", () => ({
	removeIgnoredHighlightBlocksFromExistingNotes: mocks.removeIgnoredHighlightBlocksFromExistingNotes,
}));

vi.mock("./sync/VaultHighlightLookup", () => ({
	createVaultHighlightLookup: () => mocks.highlightExistsInNote,
}));

vi.mock("./ExistingNotesWithoutDataModal", () => ({
	ExistingNotesWithoutDataModal: class {
		private readonly capture: ExistingNotesWithoutDataCapture;

		constructor() {
			this.capture = { open: vi.fn() };
			mocks.existingNotesWithoutDataInstances.push(this.capture);
		}

		open(): void {
			this.capture.open();
		}
	},
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
		constructor(_app: unknown, _plugin: unknown, options: SyncSummaryCapture) {
			mocks.syncSummaryInstances.push(options);
		}

		open(): void {
			mocks.syncSummaryOpen();
		}
	},
}));

let KindleLocalSyncPlugin: typeof import("./main").default;
let SettingsPersistenceVerificationError: typeof import("./main").SettingsPersistenceVerificationError;

beforeAll(async () => {
	const mainModule = await import("./main");

	KindleLocalSyncPlugin = mainModule.default;
	SettingsPersistenceVerificationError = mainModule.SettingsPersistenceVerificationError;
});

beforeEach(() => {
	vi.clearAllMocks();
	Notice.messages.length = 0;
	mocks.existingNotesWithoutDataInstances.length = 0;
	mocks.firstSyncPreviewInstances.length = 0;
	mocks.syncSummaryInstances.length = 0;
	mocks.detectClippingsPath.mockResolvedValue("/Volumes/Kindle/documents/My Clippings.txt");
	mocks.readClippingsFile.mockResolvedValue("raw clippings");
	mocks.parseClippings.mockReturnValue([]);
	mocks.hasExistingHighlightNotes.mockResolvedValue(false);
	mocks.highlightExistsInNote.mockResolvedValue(true);
	mocks.writeBookNotesToVault.mockImplementation(
		async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
			createWriterSummary(bookGroups)
	);
	mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValue({
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes: [],
	});
});

describe("automatic sync failure presentation", () => {
	const failureNotice = "Kindle sync wasn’t completed. Please try again.";

	it("shows only the failure notice when the writer rejects", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.writeBookNotesToVault.mockRejectedValueOnce(new Error("Disk write failed."));
		await plugin.syncHighlights();

		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(mocks.syncSummaryOpen).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual([failureNotice]);
		expect(Notice.messages.join(" ")).not.toContain("sync complete");
		consoleError.mockRestore();
	});

	it("shows only the failure notice when automatic writer validation rejects", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.writeBookNotesToVault.mockImplementationOnce(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
				createMissingOutcomeSummary(bookGroups)
		);
		await plugin.syncHighlights();

		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(mocks.syncSummaryOpen).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual([failureNotice]);
		consoleError.mockRestore();
	});

	it("shows only the failure notice when automatic settings persistence rejects", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		const importedBefore = JSON.stringify(plugin.settings.importedHighlights);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mocks.parseClippings.mockReturnValue([highlight]);
		vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("Settings save failed."));
		await plugin.syncHighlights();

		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(mocks.syncSummaryOpen).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings.importedHighlights)).toBe(importedBefore);
		expect(Notice.messages).toEqual([failureNotice]);
		consoleError.mockRestore();
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

		const completion = await plugin.completeFirstSync([highlight], [], [], createIdentityIndex([highlight]));

		expect(mocks.writeBookNotesToVault).toHaveBeenCalledTimes(1);
		expect(writtenHighlightIds()).toEqual([createClippingId(highlight)]);
		expect(completion).toEqual({
			importedCount: 1,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		});
		expect(mocks.syncSummaryInstances.at(-1)?.importedCount).toBe(1);
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
		expect(mocks.syncSummaryInstances.at(-1)?.importedCount).toBe(0);
		expect(mocks.syncSummaryInstances.at(-1)?.classification.duplicateHighlights).toEqual([highlight]);
		expect(mocks.syncSummaryInstances.at(-1)?.classification.possibleReappearedHighlights).toEqual([]);
	});

	it("surfaces one removed managed highlight without automatically restoring it", async () => {
		const present = createHighlight();
		const removed = createHighlight({
			location: "160",
			content: "Removed managed highlight.",
		});
		const presentId = createClippingId(present);
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(present), createImportedRecord(removed)],
		}));

		mocks.parseClippings.mockReturnValue([present, removed]);
		mocks.highlightExistsInNote.mockImplementation(async (id: string) => id === presentId);
		await plugin.syncHighlights();

		const summary = mocks.syncSummaryInstances.at(-1);

		expect(summary?.classification.duplicateHighlights).toEqual([present]);
		expect(summary?.classification.possibleReappearedHighlights).toEqual([removed]);
		expect(summary?.automaticHighlights).toEqual([present]);
		expect(writtenHighlightIds()).toEqual([presentId]);
	});

	it("surfaces every imported source highlight when the entire managed region is absent", async () => {
		const first = createHighlight();
		const second = createHighlight({
			location: "160",
			content: "Second managed highlight.",
		});
		const highlights = [first, second];
		const plugin = await createPlugin(createSettings({
			importedHighlights: highlights.map(createImportedRecord),
		}));

		mocks.parseClippings.mockReturnValue(highlights);
		mocks.highlightExistsInNote.mockResolvedValue(false);
		await plugin.syncHighlights();

		const summary = mocks.syncSummaryInstances.at(-1);

		expect(summary?.classification.possibleReappearedHighlights).toEqual(highlights);
		expect(summary?.automaticHighlights).toEqual([]);
		expect(writtenHighlightIds()).toEqual([]);
	});

	it("keeps a skipped missing managed highlight eligible on the next sync", async () => {
		const highlight = createHighlight();
		const importedRecord = createImportedRecord(highlight);
		const plugin = await createPlugin(createSettings({ importedHighlights: [importedRecord] }));

		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.highlightExistsInNote.mockResolvedValue(false);
		await plugin.syncHighlights();
		// Skip This Time is intentionally modal-local and does not mutate persisted state.
		await plugin.syncHighlights();

		expect(mocks.syncSummaryInstances).toHaveLength(2);
		expect(mocks.syncSummaryInstances[0]?.classification.possibleReappearedHighlights).toEqual([highlight]);
		expect(mocks.syncSummaryInstances[1]?.classification.possibleReappearedHighlights).toEqual([highlight]);
		expect(plugin.settings.importedHighlights).toEqual([importedRecord]);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(writtenHighlightIds()).toEqual([]);
	});

	it("restores a missing managed highlight only after explicit Import Again approval", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		const identityIndex = createIdentityIndex([highlight]);

		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.highlightExistsInNote.mockResolvedValue(false);
		await plugin.syncHighlights();

		expect(mocks.syncSummaryInstances.at(-1)?.classification.possibleReappearedHighlights).toEqual([highlight]);
		expect(writtenHighlightIds()).toEqual([]);

		await plugin.importHighlights([highlight], identityIndex, true, [highlight]);

		expect(writtenHighlightIds()).toEqual([createClippingId(highlight)]);
	});

	it("persists Ignore for a missing managed highlight and suppresses it on future syncs", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
		}));
		const identityIndex = createIdentityIndex([highlight]);

		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.highlightExistsInNote.mockResolvedValue(false);
		await plugin.syncHighlights();
		expect(mocks.syncSummaryInstances.at(-1)?.classification.possibleReappearedHighlights).toEqual([highlight]);

		await plugin.ignoreHighlights([highlight], identityIndex);
		mocks.syncSummaryInstances.length = 0;
		mocks.writeBookNotesToVault.mockClear();
		await plugin.syncHighlights();

		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: highlight.author,
		}]);
		expect(mocks.syncSummaryInstances.at(-1)?.classification.ignoredHighlights).toEqual([highlight]);
		expect(mocks.syncSummaryInstances.at(-1)?.classification.possibleReappearedHighlights).toEqual([]);
		expect(writtenHighlightIds()).toEqual([]);
	});

	it("uses unique legacy trust for automatic sync without backfilling an authored record", async () => {
		const highlight = createHighlight();
		const legacyRecord: ImportedHighlightRecord = {
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			textPreview: "Legacy preview",
			importedAt: "2025-01-01T00:00:00.000Z",
		};
		const plugin = await createPlugin(createSettings({ importedHighlights: [legacyRecord] }));
		const before = JSON.stringify(plugin.settings.importedHighlights);

		mocks.parseClippings.mockReturnValue([highlight]);
		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(writtenHighlightIds()).toEqual([createClippingId(highlight)]);
		expect(JSON.stringify(plugin.settings.importedHighlights)).toBe(before);
		expect(plugin.settings.importedHighlights[0]?.author).toBeUndefined();
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

describe("protected writer result propagation", () => {
	it("uses finished wording for reviewed selected protection and completion wording for success", async () => {
		const existingHighlight = createHighlight({ bookTitle: "Existing", author: "Author One" });
		const protectedHighlight = createHighlight({ bookTitle: "Protected", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(existingHighlight)],
		}));

		mocks.parseClippings.mockReturnValue([existingHighlight, protectedHighlight]);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedHighlight.bookTitle, author: protectedHighlight.author },
			])
		);
		await plugin.syncHighlights();
		const options = mocks.firstSyncPreviewInstances.at(-1)?.options;
		const completion = await options?.onComplete?.({
			importHighlights: [protectedHighlight],
			ignoreHighlights: [],
			skippedThisSyncHighlights: [],
		});

		expect(completion?.protectedSelectedHighlightCount).toBe(1);
		expect(options?.completionNotice?.(
			completion?.importedCount ?? -1,
			completion?.protectedSelectedHighlightCount ?? -1
		)).toBe("Sync finished: 0 highlights imported.");
		expect(options?.completionNotice?.(2, 0)).toBe("Sync complete: 2 highlights imported.");
	});

	it("persists only safely completed books and preserves original order without duplicate counts", async () => {
		const safeFirst = createHighlight({ bookTitle: "Safe One", author: "Author One", content: "First safe." });
		const protectedHighlight = createHighlight({ bookTitle: "Protected", author: "Author Two", content: "Retry later." });
		const safeLast = createHighlight({ bookTitle: "Safe Two", author: "Author Three", content: "Last safe." });
		const plugin = await createPlugin(createSettings());
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedHighlight.bookTitle, author: protectedHighlight.author },
			])
		);

		const input = [
			safeFirst,
			protectedHighlight,
			{ ...safeFirst },
			safeLast,
		];
		const result = await plugin.importHighlights(input, createIdentityIndex(input));

		expect(result.safelyCompletedHighlights).toEqual([safeFirst, safeLast]);
		expect(result.protectedHighlights).toEqual([protectedHighlight]);
		expect(plugin.settings.importedHighlights.map((record) => record.title)).toEqual(["Safe One", "Safe Two"]);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
	});

	it("does not confuse books whose 32-bit clipping IDs collide", async () => {
		const protectedCollision = createHighlight({
			bookTitle: "Collision 1h0o65e 20hu",
			author: "Author",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const safeCollision = createHighlight({
			bookTitle: "Collision 1y0rlvz 2269",
			author: "Author",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const plugin = await createPlugin(createSettings());
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedCollision.bookTitle, author: protectedCollision.author },
			])
		);

		expect(createClippingId(protectedCollision)).toBe(createClippingId(safeCollision));
		const collisionInput = [protectedCollision, safeCollision];
		const result = await plugin.importHighlights(collisionInput, createIdentityIndex(collisionInput));

		expect(result.protectedHighlights).toEqual([protectedCollision]);
		expect(result.safelyCompletedHighlights).toEqual([safeCollision]);
		expect(plugin.settings.importedHighlights).toMatchObject([{ title: safeCollision.bookTitle }]);
	});

	it("keeps a protected colliding book reviewable after persisted state is reloaded", async () => {
		const protectedCollision = createCollisionHighlight("Collision 1h0o65e 20hu");
		const safeCollision = createCollisionHighlight("Collision 1y0rlvz 2269");
		const completeInput = [protectedCollision, safeCollision];
		const firstPlugin = await createPlugin(createSettings());

		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedCollision.bookTitle, author: protectedCollision.author },
			])
		);
		await firstPlugin.importHighlights(completeInput, createIdentityIndex(completeInput));

		expect(firstPlugin.settings.importedHighlights).toMatchObject([{
			title: safeCollision.bookTitle,
			author: safeCollision.author,
		}]);

		const reloadedPlugin = await createPlugin(JSON.parse(JSON.stringify(firstPlugin.settings)) as KindleSyncSettings);
		mocks.firstSyncPreviewInstances.length = 0;
		mocks.writeBookNotesToVault.mockClear();
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups)
		);
		mocks.parseClippings.mockReturnValue(completeInput);
		mocks.highlightExistsInNote.mockImplementation(
			async (_id: string, highlight: KindleHighlight) => highlight.bookTitle === safeCollision.bookTitle
		);

		await reloadedPlugin.syncHighlights();

		expect(reviewedHighlightIds()).toEqual([createClippingId(protectedCollision)]);
		await finishIncrementalReview({
			importHighlights: [],
			ignoreHighlights: [],
			skippedThisSyncHighlights: [createSummaryItem(protectedCollision)],
		});
		expect(writtenHighlightIds()).toEqual([createClippingId(safeCollision)]);
		expect(reloadedPlugin.settings.importedHighlights).toHaveLength(1);
	});

	it("does not infer legacy uniqueness from a one-highlight Import Again or Ignore subset", async () => {
		const first = createSameTitleAuthorCollision("Author i5onjs phg65z");
		const second = createSameTitleAuthorCollision("Author 1lqf5c4 1t7ix5f");
		const completeInput = [first, second];
		const legacyImported: ImportedHighlightRecord = {
			id: createClippingId(first),
			title: first.bookTitle,
			textPreview: "Legacy imported preview",
			importedAt: "2025-01-01T00:00:00.000Z",
		};
		const legacyIgnored: IgnoredHighlight = {
			id: createClippingId(first),
			title: first.bookTitle,
			textPreview: "Legacy ignored preview",
			ignoredAt: "2025-01-02T00:00:00.000Z",
		};
		const plugin = await createPlugin(createSettings({
			importedHighlights: [legacyImported],
			ignoredHighlights: [legacyIgnored],
		}));
		const importedBefore = JSON.stringify(legacyImported);
		const ignoredBefore = JSON.stringify(legacyIgnored);
		const identityIndex = createIdentityIndex(completeInput);

		expect(createClippingId(first)).toBe(createClippingId(second));
		expect(identityIndex.resolveStoredIdentity(legacyImported)).toBeNull();
		expect(identityIndex.resolveStoredIdentity(legacyIgnored)).toBeNull();
		await plugin.importHighlights([first], identityIndex);
		await plugin.ignoreHighlights([second], identityIndex);

		expect(JSON.stringify(plugin.settings.importedHighlights[0])).toBe(importedBefore);
		expect(JSON.stringify(plugin.settings.ignoredHighlights[0])).toBe(ignoredBefore);
		expect(plugin.settings.importedHighlights[1]).toMatchObject({ author: first.author });
		expect(plugin.settings.ignoredHighlights[1]).toMatchObject({ author: second.author });
	});

	it("appends one authored import after unique legacy trust without changing the legacy record", async () => {
		const highlight = createHighlight();
		const legacyRecord: ImportedHighlightRecord = {
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			textPreview: "Legacy preview",
			importedAt: "2025-01-01T00:00:00.000Z",
		};
		const plugin = await createPlugin(createSettings({ importedHighlights: [legacyRecord] }));
		const before = JSON.stringify(legacyRecord);

		await plugin.importHighlights(
			[highlight, { ...highlight }],
			createIdentityIndex([highlight, { ...highlight }])
		);

		expect(JSON.stringify(plugin.settings.importedHighlights[0])).toBe(before);
		expect(plugin.settings.importedHighlights).toHaveLength(2);
		expect(plugin.settings.importedHighlights[1]).toMatchObject({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: highlight.author,
		});
	});

	it("appends one authored Ignore after unique legacy trust without changing the legacy record", async () => {
		const highlight = createHighlight();
		const legacyRecord: IgnoredHighlight = {
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			textPreview: "Legacy ignored preview",
			ignoredAt: "2025-01-01T00:00:00.000Z",
		};
		const plugin = await createPlugin(createSettings({ ignoredHighlights: [legacyRecord] }));
		const before = JSON.stringify(legacyRecord);

		await plugin.ignoreHighlights(
			[highlight, { ...highlight }],
			createIdentityIndex([highlight, { ...highlight }])
		);

		expect(JSON.stringify(plugin.settings.ignoredHighlights[0])).toBe(before);
		expect(plugin.settings.ignoredHighlights).toHaveLength(2);
		expect(plugin.settings.ignoredHighlights[1]).toMatchObject({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: highlight.author,
		});
	});

	it("does not replace or duplicate exact authored records for repeated explicit decisions", async () => {
		const highlight = createHighlight();
		const importedRecord = createImportedRecord(highlight);
		const ignoredRecord = createIgnoredRecord(highlight);
		const plugin = await createPlugin(createSettings({
			importedHighlights: [importedRecord],
			ignoredHighlights: [ignoredRecord],
		}));
		const importedBefore = JSON.stringify(importedRecord);
		const ignoredBefore = JSON.stringify(ignoredRecord);
		const duplicateInput = [highlight, { ...highlight }];
		const identityIndex = createIdentityIndex(duplicateInput);

		await plugin.importHighlights(duplicateInput, identityIndex);
		await plugin.ignoreHighlights(duplicateInput, identityIndex);

		expect(plugin.settings.importedHighlights).toHaveLength(1);
		expect(plugin.settings.ignoredHighlights).toHaveLength(1);
		expect(JSON.stringify(plugin.settings.importedHighlights[0])).toBe(importedBefore);
		expect(JSON.stringify(plugin.settings.ignoredHighlights[0])).toBe(ignoredBefore);
	});

	it("uses the actual safe count for first sync and does not inflate duplicate selections", async () => {
		const safeHighlight = createHighlight({ bookTitle: "Safe", author: "Author One" });
		const protectedHighlight = createHighlight({ bookTitle: "Protected", author: "Author Two" });
		const plugin = await createPlugin(null);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedHighlight.bookTitle, author: protectedHighlight.author },
			])
		);

		const completion = await plugin.completeFirstSync(
			[safeHighlight, { ...safeHighlight }, protectedHighlight],
			[],
			[],
			createIdentityIndex([safeHighlight, protectedHighlight])
		);

		expect(completion).toEqual({
			importedCount: 1,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 1,
		});
		expect(mocks.syncSummaryInstances.at(-1)?.importedCount).toBe(1);
		expect(mocks.syncSummaryInstances.at(-1)?.protectedBooks).toEqual({
			bookCount: 1,
			affectedHighlightCount: 1,
			selectedHighlightCount: 1,
			books: [{
				title: protectedHighlight.bookTitle,
				author: protectedHighlight.author,
				affectedHighlightCount: 1,
				selectedHighlightCount: 1,
			}],
		});
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(safeHighlight),
		]);
	});

	it("counts a selected highlight confirmed safe without a physical write", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(null);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => {
				const summary = createWriterSummary(bookGroups);
				return {
					...summary,
					filesUpdated: 0,
					filesUnchanged: 1,
					bookOutcomes: summary.bookOutcomes.map((outcome) => ({
						...outcome,
						status: "confirmed" as const,
					})),
				};
			}
		);

		const completion = await plugin.completeFirstSync([highlight], [], [], createIdentityIndex([highlight]));

		expect(completion).toEqual({
			importedCount: 1,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 0,
		});
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([createClippingId(highlight)]);
	});

	it("counts only safely completed newly reviewed highlights, excluding automatic highlights", async () => {
		const automaticHighlight = createHighlight({ bookTitle: "Automatic", author: "Author One" });
		const safeNewHighlight = createHighlight({
			bookTitle: "Automatic",
			author: "Author One",
			location: "160",
			content: "Safe new highlight.",
		});
		const protectedNewHighlight = createHighlight({ bookTitle: "Protected", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(automaticHighlight)],
		}));
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedNewHighlight.bookTitle, author: protectedNewHighlight.author },
			])
		);

		const completion = await plugin.completeReviewedSync(
			[safeNewHighlight, protectedNewHighlight],
			[],
			[],
			[automaticHighlight],
			{
				newHighlights: [safeNewHighlight, protectedNewHighlight],
				duplicateHighlights: [automaticHighlight],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([automaticHighlight, safeNewHighlight, protectedNewHighlight])
		);

		expect(completion).toEqual({
			importedCount: 1,
			ignoreCleanupResult: createEmptyCleanupResult(),
			protectedSelectedHighlightCount: 1,
		});
		expect(mocks.syncSummaryInstances.at(-1)?.importedCount).toBe(1);
		expect(mocks.syncSummaryInstances.at(-1)?.protectedBooks?.selectedHighlightCount).toBe(1);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(automaticHighlight),
			createClippingId(safeNewHighlight),
		]);
	});

	it("keeps protected new highlights eligible for a later review", async () => {
		const protectedHighlight = createHighlight({ bookTitle: "Protected", author: "Author" });
		const plugin = await createPlugin(null);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedHighlight.bookTitle, author: protectedHighlight.author },
			])
		);

		await plugin.completeFirstSync(
			[protectedHighlight],
			[],
			[],
			createIdentityIndex([protectedHighlight])
		);
		expect(plugin.settings.importedHighlights).toEqual([]);

		mocks.firstSyncPreviewInstances.length = 0;
		mocks.parseClippings.mockReturnValue([protectedHighlight]);
		await plugin.syncHighlights();

		expect(reviewedHighlightIds()).toEqual([createClippingId(protectedHighlight)]);
	});

	it("preserves historical imported records exactly when Import Again is protected", async () => {
		const protectedHighlight = createHighlight({ bookTitle: "Protected", author: "Author" });
		const historicalRecords: ImportedHighlightRecord[] = [
			{
				id: "kls-before",
				title: "Before",
				author: "Earlier Author",
				textPreview: "Earlier preview",
				importedAt: "2025-01-01T00:00:00.000Z",
			},
			{
				id: createClippingId(protectedHighlight),
				title: protectedHighlight.bookTitle,
				author: protectedHighlight.author,
				textPreview: "Historical protected preview",
				importedAt: "2025-02-02T00:00:00.000Z",
			},
		];
		const plugin = await createPlugin(createSettings({ importedHighlights: historicalRecords }));
		const before = JSON.stringify(plugin.settings.importedHighlights);

		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedHighlight.bookTitle, author: protectedHighlight.author },
			])
		);
		const result = await plugin.importHighlights(
			[protectedHighlight],
			createIdentityIndex([protectedHighlight])
		);

		expect(result.protectedHighlights).toEqual([protectedHighlight]);
		expect(JSON.stringify(plugin.settings.importedHighlights)).toBe(before);
	});

	it("performs one final persist=false save with safe imports and explicit ignores", async () => {
		const safeHighlight = createHighlight({ bookTitle: "Safe", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignored", author: "Author Two" });
		const plugin = await createPlugin(createSettings());
		const saveData = vi.spyOn(plugin, "saveData");

		await plugin.completeReviewedSync(
			[safeHighlight],
			[ignoredHighlight],
			[],
			[],
			{
				newHighlights: [safeHighlight, ignoredHighlight],
				duplicateHighlights: [],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([safeHighlight, ignoredHighlight])
		);

		expect(saveData).toHaveBeenCalledTimes(1);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([createClippingId(safeHighlight)]);
		expect(plugin.settings.ignoredHighlights.map((record) => record.id)).toEqual([createClippingId(ignoredHighlight)]);
	});

	it("keeps First Sync settings staged while persistence is pending and commits once after success", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore", author: "Author Two" });
		const plugin = await createPlugin(null);
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);
		const persistence = createDeferred<void>();
		const saveData = vi.spyOn(plugin, "saveData").mockReturnValueOnce(persistence.promise);

		const completion = plugin.completeFirstSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			createIdentityIndex([importedHighlight, ignoredHighlight])
		);

		await waitForMockCall(saveData);
		const stagedSettings = saveData.mock.calls[0]?.[0] as KindleSyncSettings;

		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(stagedSettings.importedHighlights).not.toBe(liveSettings.importedHighlights);
		expect(stagedSettings.ignoredHighlights).not.toBe(liveSettings.ignoredHighlights);
		expect(stagedSettings.hasCompletedFirstSync).toBe(true);
		expect(stagedSettings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(importedHighlight),
		]);
		expect(stagedSettings.ignoredHighlights.map((record) => record.id)).toEqual([
			createClippingId(ignoredHighlight),
		]);

		(plugin as unknown as { setDurableData(data: unknown): void }).setDurableData(stagedSettings);
		(plugin as unknown as { setLoadDataResult(data: unknown): void }).setLoadDataResult(stagedSettings);
		persistence.resolve(undefined);
		await completion;
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(plugin.settings).toBe(stagedSettings);
	});

	it("keeps Review New Highlights settings staged while persistence is pending and commits once", async () => {
		const automaticHighlight = createHighlight({ bookTitle: "Existing", author: "Author Zero" });
		const importedHighlight = createHighlight({ bookTitle: "Import", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(automaticHighlight)],
		}));
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);
		const persistence = createDeferred<void>();
		const saveData = vi.spyOn(plugin, "saveData").mockReturnValueOnce(persistence.promise);

		const completion = plugin.completeReviewedSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			[automaticHighlight],
			{
				newHighlights: [importedHighlight, ignoredHighlight],
				duplicateHighlights: [automaticHighlight],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([automaticHighlight, importedHighlight, ignoredHighlight])
		);

		await waitForMockCall(saveData);
		const stagedSettings = saveData.mock.calls[0]?.[0] as KindleSyncSettings;

		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(stagedSettings.importedHighlights).not.toBe(liveSettings.importedHighlights);
		expect(stagedSettings.ignoredHighlights).not.toBe(liveSettings.ignoredHighlights);
		expect(stagedSettings.importedHighlights[0]).not.toBe(liveSettings.importedHighlights[0]);
		expect(stagedSettings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(automaticHighlight),
			createClippingId(importedHighlight),
		]);
		expect(stagedSettings.ignoredHighlights.map((record) => record.id)).toEqual([
			createClippingId(ignoredHighlight),
		]);

		(plugin as unknown as { setDurableData(data: unknown): void }).setDurableData(stagedSettings);
		(plugin as unknown as { setLoadDataResult(data: unknown): void }).setLoadDataResult(stagedSettings);
		persistence.resolve(undefined);
		await completion;
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(plugin.settings).toBe(stagedSettings);
	});

	it("keeps First Sync review eligibility after settings persistence rejects and the review is discarded", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore", author: "Author Two" });
		const highlights = [importedHighlight, ignoredHighlight];
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);

		vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("Settings save failed."));
		await expect(plugin.completeFirstSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			createIdentityIndex(highlights)
		)).rejects.toThrow("Settings save failed.");

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);

		mocks.firstSyncPreviewInstances.length = 0;
		mocks.parseClippings.mockReturnValue(highlights);
		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBeUndefined();
		expect(reviewedHighlightIds()).toEqual(highlights.map(createClippingId));
	});

	it("keeps rejected Review New Highlight decisions eligible for the next review", async () => {
		const automaticHighlight = createHighlight({ bookTitle: "Existing", author: "Author Zero" });
		const importedHighlight = createHighlight({ bookTitle: "Import", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(automaticHighlight)],
		}));
		const settingsBefore = JSON.stringify(plugin.settings);

		vi.spyOn(plugin, "saveData").mockRejectedValueOnce(new Error("Settings save failed."));
		await expect(plugin.completeReviewedSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			[automaticHighlight],
			{
				newHighlights: [importedHighlight, ignoredHighlight],
				duplicateHighlights: [automaticHighlight],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([automaticHighlight, importedHighlight, ignoredHighlight])
		)).rejects.toThrow("Settings save failed.");

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(automaticHighlight),
		]);
		expect(plugin.settings.ignoredHighlights).toEqual([]);

		mocks.firstSyncPreviewInstances.length = 0;
		mocks.parseClippings.mockReturnValue([automaticHighlight, importedHighlight, ignoredHighlight]);
		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedHighlightIds()).toEqual([
			createClippingId(importedHighlight),
			createClippingId(ignoredHighlight),
		]);
	});

	it("does not expose Import Again persistence changes when settings save rejects", async () => {
		const highlight = createHighlight();
		const importedRecord = createImportedRecord(highlight);
		const plugin = await createPlugin(createSettings({ importedHighlights: [importedRecord] }));
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);
		const persistence = createDeferred<void>();
		const saveData = vi.spyOn(plugin, "saveData").mockReturnValueOnce(persistence.promise);
		const importRequest = plugin.importHighlights(
			[highlight],
			createIdentityIndex([highlight]),
			true,
			[highlight]
		);

		await waitForMockCall(saveData);
		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);

		persistence.reject(new Error("Settings save failed."));
		await expect(importRequest).rejects.toThrow("Settings save failed.");
		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
	});

	it("does not expose Import Again persistence changes when save resolves without persistence", async () => {
		const existingHighlight = createHighlight({ bookTitle: "Existing", author: "Author One" });
		const recoveredHighlight = createHighlight({ bookTitle: "Recovered", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(existingHighlight)],
		}));
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);

		persistenceControl(plugin).setSaveDataPersists(false);

		await expect(plugin.importHighlights(
			[recoveredHighlight],
			createIdentityIndex([existingHighlight, recoveredHighlight]),
			true,
			[recoveredHighlight]
		)).rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(existingHighlight),
		]);
	});

	it("creates fully isolated snapshot arrays and records even when Import Again adds no record", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Imported", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignored", author: "Author Two" });
		const importedRecord = createImportedRecord(importedHighlight);
		const ignoredRecord = createIgnoredRecord(ignoredHighlight);
		const plugin = await createPlugin(createSettings({
			importedHighlights: [importedRecord],
			ignoredHighlights: [ignoredRecord],
		}));
		const liveSettings = plugin.settings;
		const persistence = createDeferred<void>();
		const saveData = vi.spyOn(plugin, "saveData").mockReturnValueOnce(persistence.promise);
		const importRequest = plugin.importHighlights(
			[importedHighlight],
			createIdentityIndex([importedHighlight]),
			true,
			[importedHighlight]
		);

		await waitForMockCall(saveData);
		const stagedSettings = saveData.mock.calls[0]?.[0] as KindleSyncSettings;

		expect(stagedSettings.importedHighlights).not.toBe(liveSettings.importedHighlights);
		expect(stagedSettings.ignoredHighlights).not.toBe(liveSettings.ignoredHighlights);
		expect(stagedSettings.importedHighlights[0]).not.toBe(liveSettings.importedHighlights[0]);
		expect(stagedSettings.ignoredHighlights[0]).not.toBe(liveSettings.ignoredHighlights[0]);
		expect(stagedSettings.importedHighlights).toEqual(liveSettings.importedHighlights);
		expect(stagedSettings.ignoredHighlights).toEqual(liveSettings.ignoredHighlights);
		expect(plugin.settings).toBe(liveSettings);
		stagedSettings.importedHighlights[0]!.textPreview = "Changed while persistence is pending";
		stagedSettings.ignoredHighlights[0]!.textPreview = "Changed while persistence is pending";
		expect(liveSettings.importedHighlights[0]!.textPreview).toBe(importedHighlight.content);
		expect(liveSettings.ignoredHighlights[0]!.textPreview).toBe(ignoredHighlight.content);
		stagedSettings.importedHighlights[0]!.textPreview = importedHighlight.content;
		stagedSettings.ignoredHighlights[0]!.textPreview = ignoredHighlight.content;

		persistence.resolve(undefined);
		await importRequest;
		expect(plugin.settings).toBe(stagedSettings);
	});

	it("keeps live settings isolated when persistence mutates its snapshot and rejects", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Imported", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignored", author: "Author Two" });
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(importedHighlight)],
			ignoredHighlights: [createIgnoredRecord(ignoredHighlight)],
		}));
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);

		vi.spyOn(plugin, "saveData").mockImplementationOnce(async (data) => {
			const snapshot = data as KindleSyncSettings;

			snapshot.importedHighlights[0]!.textPreview = "Mutated during persistence";
			snapshot.ignoredHighlights[0]!.textPreview = "Mutated during persistence";
			snapshot.importedHighlights.push(createImportedRecord(createHighlight({ location: "999" })));
			throw new Error("Settings save failed.");
		});

		await expect(plugin.importHighlights(
			[importedHighlight],
			createIdentityIndex([importedHighlight]),
			true,
			[importedHighlight]
		)).rejects.toThrow("Settings save failed.");

		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
	});

	it("does not share records with the old settings object after a successful snapshot commit", async () => {
		const historicalImport = createHighlight({ bookTitle: "Historical", author: "Author One" });
		const historicalIgnore = createHighlight({ bookTitle: "Ignored", author: "Author Two" });
		const newImport = createHighlight({ bookTitle: "New", author: "Author Three" });
		const oldSettings = createSettings({
			importedHighlights: [createImportedRecord(historicalImport)],
			ignoredHighlights: [createIgnoredRecord(historicalIgnore)],
		});
		const plugin = await createPlugin(oldSettings);
		const oldLiveSettings = plugin.settings;
		const oldImportedRecord = oldLiveSettings.importedHighlights[0]!;
		const oldIgnoredRecord = oldLiveSettings.ignoredHighlights[0]!;

		await plugin.importHighlights(
			[newImport],
			createIdentityIndex([newImport]),
			true,
			[newImport]
		);
		const committedSettings = plugin.settings;

		expect(committedSettings).not.toBe(oldLiveSettings);
		expect(committedSettings.importedHighlights[0]).not.toBe(oldImportedRecord);
		expect(committedSettings.ignoredHighlights[0]).not.toBe(oldIgnoredRecord);
		oldImportedRecord.textPreview = "Changed after success";
		oldIgnoredRecord.textPreview = "Changed after success";
		oldLiveSettings.importedHighlights.length = 0;
		oldLiveSettings.ignoredHighlights.length = 0;

		expect(committedSettings.importedHighlights.map((record) => record.textPreview)).toEqual([
			historicalImport.content,
			newImport.content,
		]);
		expect(committedSettings.ignoredHighlights.map((record) => record.textPreview)).toEqual([
			historicalIgnore.content,
		]);
	});

	it("retains imported and ignored records across serialized recovery mutations", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Imported", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignored", author: "Author Two" });
		const plugin = await createPlugin(createSettings());

		await plugin.importHighlights(
			[importedHighlight],
			createIdentityIndex([importedHighlight, ignoredHighlight]),
			true,
			[importedHighlight]
		);
		await plugin.ignoreHighlights(
			[ignoredHighlight],
			createIdentityIndex([importedHighlight, ignoredHighlight])
		);

		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([
			createClippingId(importedHighlight),
		]);
		expect(plugin.settings.ignoredHighlights.map((record) => record.id)).toEqual([
			createClippingId(ignoredHighlight),
		]);
	});

	it("propagates blocked first-sync Ignore cleanup into completion and summary state", async () => {
		const ignoredHighlight = createHighlight();
		const target = {
			bookTitle: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
			id: createClippingId(ignoredHighlight),
		};
		const blockedResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [{
				bookTitle: ignoredHighlight.bookTitle,
				author: ignoredHighlight.author,
				targetOutcomes: [{ target, status: "no-matching-note" }],
			}],
		};
		const plugin = await createPlugin(null);

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(blockedResult);
		const completion = await plugin.completeFirstSync(
			[],
			[ignoredHighlight],
			[],
			createIdentityIndex([ignoredHighlight])
		);

		expect(completion).toEqual({
			importedCount: 0,
			ignoreCleanupResult: blockedResult,
			protectedSelectedHighlightCount: 0,
		});
		expect(mocks.syncSummaryInstances.at(-1)?.ignoreResults).toMatchObject({
			highlightCount: 1,
			removedCount: 0,
			items: [{ status: "note-not-found" }],
		});
		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: target.id,
			title: target.bookTitle,
			author: target.author,
		}]);
	});

	it("propagates reviewed-sync Ignore cleanup into completion and summary state", async () => {
		const ignoredHighlight = createHighlight();
		const target = {
			bookTitle: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
			id: createClippingId(ignoredHighlight),
		};
		const cleanupResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [{
				bookTitle: ignoredHighlight.bookTitle,
				author: ignoredHighlight.author,
				targetOutcomes: [{ target, status: "no-matching-highlight-block" }],
			}],
		};
		const plugin = await createPlugin(createSettings());

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(cleanupResult);
		const completion = await plugin.completeReviewedSync(
			[],
			[ignoredHighlight],
			[],
			[],
			{
				newHighlights: [ignoredHighlight],
				duplicateHighlights: [],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([ignoredHighlight])
		);

		expect(completion).toEqual({
			importedCount: 0,
			ignoreCleanupResult: cleanupResult,
			protectedSelectedHighlightCount: 0,
		});
		expect(mocks.syncSummaryInstances.at(-1)?.ignoreResults).toMatchObject({
			highlightCount: 1,
			removedCount: 0,
			alreadyAbsentCount: 1,
			items: [{ status: "already-absent" }],
		});
	});

	it("does not persist or report completion when the writer rejects", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(null);
		mocks.writeBookNotesToVault.mockRejectedValue(new Error("Disk write failed."));

		await expect(plugin.completeFirstSync(
			[highlight],
			[],
			[],
			createIdentityIndex([highlight])
		)).rejects.toThrow("Disk write failed.");

		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("preserves an explicit first-sync Ignore when the writer contract is invalid", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import A", author: "Author A" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore B", author: "Author B" });
		const plugin = await createPlugin(null);
		const saveData = vi.spyOn(plugin, "saveData");
		const cleanupResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [{
				bookTitle: ignoredHighlight.bookTitle,
				author: ignoredHighlight.author,
				targetOutcomes: [{
					target: {
						bookTitle: ignoredHighlight.bookTitle,
						author: ignoredHighlight.author,
						id: createClippingId(ignoredHighlight),
					},
					status: "no-matching-highlight-block",
				}],
			}],
		};

		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
				createMissingOutcomeSummary(bookGroups)
		);
		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(cleanupResult);

		let rejectedError: unknown;
		try {
			await plugin.completeFirstSync(
				[importedHighlight],
				[ignoredHighlight],
				[],
				createIdentityIndex([importedHighlight, ignoredHighlight])
			);
		} catch (error) {
			rejectedError = error;
		}

		expect(rejectedError).toBeInstanceOf(InvalidVaultWriteContractError);
		expect(rejectedError).not.toBeInstanceOf(SettingsPersistenceVerificationError);
		expect((rejectedError as InvalidVaultWriteContractError).preservedIgnoreCleanupResults)
			.toEqual([cleanupResult]);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: createClippingId(ignoredHighlight),
			title: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
		}]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			expect.anything(),
			"Kindle Highlights",
			[{
				bookTitle: ignoredHighlight.bookTitle,
				author: ignoredHighlight.author,
				id: createClippingId(ignoredHighlight),
			}]
		);
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not retain saved-Ignore results when invalid-contract Ignore persistence is unverified", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import A", author: "Author A" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore B", author: "Author B" });
		const plugin = await createPlugin(null);

		persistenceControl(plugin).setSaveDataPersists(false);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
				createMissingOutcomeSummary(bookGroups)
		);

		let failure: unknown;
		try {
			await plugin.completeFirstSync(
				[importedHighlight],
				[ignoredHighlight],
				[],
				createIdentityIndex([importedHighlight, ignoredHighlight])
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(SettingsPersistenceVerificationError);
		expect(failure).not.toBeInstanceOf(InvalidVaultWriteContractError);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["malformed", {}],
	] as const)("preserves an explicit first-sync Ignore for a %s top-level summary", async (_label, summary) => {
		const importedHighlight = createHighlight({ bookTitle: "Import A", author: "Author A" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore B", author: "Author B" });
		const plugin = await createPlugin(null);
		const cleanupResult = createEmptyCleanupResult();

		mocks.writeBookNotesToVault.mockResolvedValueOnce(summary);
		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(cleanupResult);

		let rejectedError: unknown;
		try {
			await plugin.completeFirstSync(
				[importedHighlight],
				[ignoredHighlight],
				[],
				createIdentityIndex([importedHighlight, ignoredHighlight])
			);
		} catch (error) {
			rejectedError = error;
		}

		expect(rejectedError).toBeInstanceOf(InvalidVaultWriteContractError);
		expect((rejectedError as InvalidVaultWriteContractError).code).toBe("summary-shape");
		expect((rejectedError as InvalidVaultWriteContractError).preservedIgnoreCleanupResults)
			.toEqual([cleanupResult]);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			title: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
		}]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("preserves an explicit reviewed-sync Ignore when the writer contract is invalid", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import A", author: "Author A" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore B", author: "Author B" });
		const legacyIgnored: IgnoredHighlight = {
			id: createClippingId(ignoredHighlight),
			title: ignoredHighlight.bookTitle,
			textPreview: "Legacy ignored preview",
			ignoredAt: "2025-01-01T00:00:00.000Z",
		};
		const plugin = await createPlugin(createSettings({ ignoredHighlights: [legacyIgnored] }));
		const importedBefore = JSON.stringify(plugin.settings.importedHighlights);
		const legacyIgnoredBefore = JSON.stringify(legacyIgnored);

		mocks.writeBookNotesToVault.mockResolvedValueOnce(undefined);

		await expect(plugin.completeReviewedSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			[],
			{
				newHighlights: [importedHighlight],
				duplicateHighlights: [],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			createIdentityIndex([importedHighlight, ignoredHighlight])
		)).rejects.toBeInstanceOf(InvalidVaultWriteContractError);

		expect(JSON.stringify(plugin.settings.importedHighlights)).toBe(importedBefore);
		expect(JSON.stringify(plugin.settings.ignoredHighlights[0])).toBe(legacyIgnoredBefore);
		expect(plugin.settings.ignoredHighlights).toHaveLength(2);
		expect(plugin.settings.ignoredHighlights[1]).toMatchObject({
			title: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
		});
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("makes no settings mutation or save when an invalid contract has no explicit Ignore", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);
		const saveData = vi.spyOn(plugin, "saveData");

		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
				createMissingOutcomeSummary(bookGroups)
		);

		await expect(plugin.completeFirstSync(
			[highlight],
			[],
			[],
			createIdentityIndex([highlight])
		)).rejects.toBeInstanceOf(InvalidVaultWriteContractError);

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(saveData).not.toHaveBeenCalled();
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not preserve explicit Ignore selections when the writer rejects with an I/O error", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import A", author: "Author A" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore B", author: "Author B" });
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);
		const saveData = vi.spyOn(plugin, "saveData");
		const ioError = new Error("Disk write failed.");

		mocks.writeBookNotesToVault.mockRejectedValueOnce(ioError);

		let rejectedError: unknown;
		try {
			await plugin.completeFirstSync(
				[importedHighlight],
				[ignoredHighlight],
				[],
				createIdentityIndex([importedHighlight, ignoredHighlight])
			);
		} catch (error) {
			rejectedError = error;
		}

		expect(rejectedError).toBe(ioError);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(saveData).not.toHaveBeenCalled();
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});
});

describe("reconnect discovery after config-only settings persistence", () => {
	it("opens reconnect after the user saves a custom clippings path in the same process", async () => {
		const plugin = await createPlugin(null);

		await saveCustomClippingsPath(plugin);
		mocks.hasExistingHighlightNotes.mockResolvedValue(true);
		await plugin.syncHighlights();

		expect(persistenceControl(plugin).getDurableData()).toMatchObject({
			clippingsPath: "/Users/test/QA Input/My Clippings.txt",
			importedHighlights: [],
			ignoredHighlights: [],
			hasCompletedFirstSync: false,
		});
		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(1);
		expect(mocks.existingNotesWithoutDataInstances[0]?.open).toHaveBeenCalledTimes(1);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(mocks.detectClippingsPath).not.toHaveBeenCalled();
	});

	it("opens reconnect after config-only data is loaded by a restarted plugin instance", async () => {
		const firstPlugin = await createPlugin(null);

		await saveCustomClippingsPath(firstPlugin);
		const configOnlyData = persistenceControl(firstPlugin).getDurableData() as KindleSyncSettings;
		const reloadedPlugin = await createPlugin(configOnlyData);

		mocks.hasExistingHighlightNotes.mockResolvedValue(true);
		await reloadedPlugin.syncHighlights();

		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(readHasTrustedSyncState(reloadedPlugin)).toBe(false);
	});

	it("keeps a genuine new user without managed notes in First Sync", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(null);

		await saveCustomClippingsPath(plugin);
		mocks.hasExistingHighlightNotes.mockResolvedValue(false);
		mocks.parseClippings.mockReturnValue([highlight]);
		await plugin.syncHighlights();

		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(0);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBeUndefined();
		expect(reviewedHighlightIds()).toEqual([createClippingId(highlight)]);
	});

	it("keeps completed trusted data on the ordinary sync path", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({
			importedHighlights: [createImportedRecord(highlight)],
			hasCompletedFirstSync: true,
		}));

		mocks.hasExistingHighlightNotes.mockResolvedValue(true);
		mocks.parseClippings.mockReturnValue([highlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);
		await plugin.syncHighlights();

		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(0);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
		expect(mocks.syncSummaryInstances).toHaveLength(1);
	});

	it("reconnects only physically confirmed A1 and B1 without recreating unavailable Ignore state", async () => {
		const a1 = createHighlight({ bookTitle: "Atomic Habits", author: "James Clear" });
		const b1 = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			location: "160",
			content: "Deep work is valuable.",
		});
		const c1 = createHighlight({
			bookTitle: "Digital Minimalism",
			author: "Cal Newport",
			location: "170",
			content: "Attention is a resource worth protecting.",
		});
		const confirmedIds = new Set([createClippingId(a1), createClippingId(b1)]);
		const plugin = await createPlugin(null);

		await saveCustomClippingsPath(plugin);
		mocks.parseClippings.mockReturnValue([a1, b1, c1]);
		mocks.highlightExistsInNote.mockImplementation(async (id: string) => confirmedIds.has(id));
		await plugin.continueExistingNotesWithoutDataSync();

		const importedIds = plugin.settings.importedHighlights.map((record) => record.id);

		expect(importedIds).toEqual([createClippingId(a1), createClippingId(b1)]);
		expect(new Set(importedIds).size).toBe(2);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(true);
		expect(persistenceControl(plugin).getDurableData()).toEqual(plugin.settings);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedHighlightIds()).toEqual([createClippingId(c1)]);
		// Existing managed notes are classified and trusted without being rewritten or duplicated.
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});

	it("keeps reconnect retryable when save resolves without durable persistence", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);

		await saveCustomClippingsPath(plugin);
		const configOnlyData = persistenceControl(plugin).getDurableData();
		persistenceControl(plugin).setSaveDataPersists(false);
		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(readHasSavedPluginData(plugin)).toBe(true);
		expect(readHasTrustedSyncState(plugin)).toBe(false);
		expect(persistenceControl(plugin).getDurableData()).toEqual(configOnlyData);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(Notice.messages).toEqual([]);

		mocks.hasExistingHighlightNotes.mockResolvedValue(true);
		await plugin.syncHighlights();

		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
	});

	it("keeps reconnect retryable when the writer rejects", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);

		await saveCustomClippingsPath(plugin);
		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);
		mocks.writeBookNotesToVault.mockRejectedValueOnce(new Error("Disk write failed."));

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toThrow("Disk write failed.");

		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(readHasTrustedSyncState(plugin)).toBe(false);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(Notice.messages).toEqual([]);
		mocks.hasExistingHighlightNotes.mockResolvedValue(true);
		await plugin.syncHighlights();
		expect(mocks.existingNotesWithoutDataInstances).toHaveLength(1);
	});
});

describe("existing notes without data review choices", () => {
	it("Reconnect existing notes does not force review when current clippings match existing managed notes", async () => {
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

	it("Reconnect existing notes reviews only unmatched highlights", async () => {
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

	it("Reconnect keeps trusted existing records while a protected unmatched book remains unimported", async () => {
		const trustedHighlight = createHighlight({ bookTitle: "Trusted", author: "Author One" });
		const protectedNewHighlight = createHighlight({ bookTitle: "Protected", author: "Author Two" });
		const trustedId = createClippingId(trustedHighlight);
		const plugin = await createPlugin(null);
		mocks.parseClippings.mockReturnValue([trustedHighlight, protectedNewHighlight]);
		mocks.highlightExistsInNote.mockImplementation(async (id: string) => id === trustedId);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => createWriterSummary(bookGroups, [
				{ bookTitle: protectedNewHighlight.bookTitle, author: protectedNewHighlight.author },
			])
		);

		await plugin.continueExistingNotesWithoutDataSync();
		await finishIncrementalReview({
			importHighlights: [protectedNewHighlight],
			ignoreHighlights: [],
			skippedThisSyncHighlights: [],
		});

		expect(plugin.settings.importedHighlights.map((record) => record.id)).toEqual([trustedId]);
		expect(mocks.syncSummaryInstances.at(-1)?.importedCount).toBe(0);
	});

	it("Reconnect trusts only the exact book when clipping IDs collide", async () => {
		const trusted = createCollisionHighlight("Collision 1y0rlvz 2269");
		const unmatched = createCollisionHighlight("Collision 1h0o65e 20hu");
		const plugin = await createPlugin(null);

		mocks.parseClippings.mockReturnValue([trusted, unmatched]);
		mocks.highlightExistsInNote.mockImplementation(
			async (_id: string, highlight: KindleHighlight) => highlight.bookTitle === trusted.bookTitle
		);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(createClippingId(trusted)).toBe(createClippingId(unmatched));
		expect(plugin.settings.importedHighlights).toMatchObject([{
			title: trusted.bookTitle,
			author: trusted.author,
		}]);
		expect(reviewedHighlightIds()).toEqual([createClippingId(unmatched)]);
	});

	it("does not persist staged reconnect trust when the automatic writer contract is invalid", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);
		const saveData = vi.spyOn(plugin, "saveData");

		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);
		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) =>
				createMissingOutcomeSummary(bookGroups)
		);

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toBeInstanceOf(InvalidVaultWriteContractError);

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(saveData).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not persist staged reconnect trust when the automatic writer rejects", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);
		const saveData = vi.spyOn(plugin, "saveData");

		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);
		mocks.writeBookNotesToVault.mockRejectedValueOnce(new Error("Disk write failed."));

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toThrow("Disk write failed.");

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(saveData).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not commit staged reconnect trust when settings persistence rejects", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);
		const settingsBefore = JSON.stringify(plugin.settings);
		const saveData = vi.spyOn(plugin, "saveData").mockRejectedValueOnce(
			new Error("Settings save failed.")
		);

		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toThrow("Settings save failed.");

		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not commit staged reconnect trust when save resolves without persistence", async () => {
		const existingHighlight = createHighlight();
		const plugin = await createPlugin(null);
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);

		persistenceControl(plugin).setSaveDataPersists(false);
		mocks.parseClippings.mockReturnValue([existingHighlight]);
		mocks.highlightExistsInNote.mockResolvedValue(true);

		await expect(plugin.continueExistingNotesWithoutDataSync())
			.rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual([]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(readHasSavedPluginData(plugin)).toBe(false);
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("does not expose review-as-first-sync state until persistence is verified", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({ hasCompletedFirstSync: true }));
		const liveSettings = plugin.settings;

		persistenceControl(plugin).setSaveDataPersists(false);
		mocks.parseClippings.mockReturnValue([highlight]);

		await expect(plugin.reviewExistingNotesWithoutDataAsFirstSync())
			.rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings).toBe(liveSettings);
		expect(plugin.settings.hasCompletedFirstSync).toBe(true);
		expect(mocks.firstSyncPreviewInstances).toHaveLength(0);
	});

	it("internal review-all method forces full review even when notes can be matched", async () => {
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
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBe("Review All Detected Highlights");
		expect(reviewedHighlightIds()).toEqual([
			createClippingId(existingHighlight),
			createClippingId(newHighlight),
		]);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});
});

describe("durable settings persistence verification", () => {
	it("keeps a resolved but non-durable First Sync untrusted and retries with fresh timestamps", async () => {
		vi.useFakeTimers();
		const failedAttemptTime = new Date("2026-07-16T07:11:12.000Z");
		const successfulAttemptTime = new Date("2026-07-16T08:22:30.000Z");
		const importedHighlight = createHighlight({ bookTitle: "Atomic Habits", author: "James Clear" });
		const ignoredHighlight = createHighlight({ bookTitle: "Digital Minimalism", author: "Cal Newport" });
		const historicalImport = createHighlight({ bookTitle: "Historical Import", author: "Existing Author" });
		const historicalIgnore = createHighlight({ bookTitle: "Historical Ignore", author: "Existing Author" });
		const initialSettings = createSettings({
			hasCompletedFirstSync: false,
			importedHighlights: [createImportedRecord(historicalImport)],
			ignoredHighlights: [createIgnoredRecord(historicalIgnore)],
		});
		const plugin = await createPlugin(initialSettings);
		const persistence = persistenceControl(plugin);
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);
		const hasSavedPluginDataBefore = readHasSavedPluginData(plugin);
		const saveData = vi.spyOn(plugin, "saveData");
		const loadData = vi.spyOn(plugin, "loadData");
		let physicalNoteWriteCompleted = false;

		mocks.writeBookNotesToVault.mockImplementation(
			async (_vault: unknown, _folder: string, bookGroups: KindleBookGroup[]) => {
				physicalNoteWriteCompleted = true;
				return createWriterSummary(bookGroups);
			}
		);
		persistence.setSaveDataPersists(false);
		vi.setSystemTime(failedAttemptTime);

		let failure: unknown;
		try {
			await plugin.completeFirstSync(
				[importedHighlight],
				[ignoredHighlight],
				[],
				createIdentityIndex([importedHighlight, ignoredHighlight])
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(SettingsPersistenceVerificationError);
		expect((failure as InstanceType<typeof SettingsPersistenceVerificationError>).code)
			.toBe("mismatched-readback");
		expect(physicalNoteWriteCompleted).toBe(true);
		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(plugin.settings.importedHighlights).toEqual(initialSettings.importedHighlights);
		expect(plugin.settings.ignoredHighlights).toEqual(initialSettings.ignoredHighlights);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(readHasSavedPluginData(plugin)).toBe(hasSavedPluginDataBefore);
		expect(persistence.getDurableData()).toEqual(initialSettings);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
		expect(mocks.syncSummaryOpen).not.toHaveBeenCalled();
		expect(Notice.messages).toEqual([]);

		mocks.firstSyncPreviewInstances.length = 0;
		mocks.parseClippings.mockReturnValue([importedHighlight, ignoredHighlight]);
		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewInstances).toHaveLength(1);
		expect(mocks.firstSyncPreviewInstances[0]?.options?.title).toBeUndefined();
		expect(reviewedHighlightIds()).toEqual([
			createClippingId(importedHighlight),
			createClippingId(ignoredHighlight),
		]);

		persistence.setSaveDataPersists(true);
		vi.setSystemTime(successfulAttemptTime);
		await finishIncrementalReview({
			importHighlights: [importedHighlight],
			ignoreHighlights: [ignoredHighlight],
			skippedThisSyncHighlights: [],
		});

		const durableSettings = persistence.getDurableData() as KindleSyncSettings;
		const importedRecord = durableSettings.importedHighlights.find((record) =>
			record.id === createClippingId(importedHighlight)
		);
		const ignoredRecord = durableSettings.ignoredHighlights.find((record) =>
			record.id === createClippingId(ignoredHighlight)
		);

		expect(durableSettings.importedHighlights[0]).toEqual(initialSettings.importedHighlights[0]);
		expect(durableSettings.ignoredHighlights[0]).toEqual(initialSettings.ignoredHighlights[0]);
		expect(importedRecord?.importedAt).toBe(successfulAttemptTime.toISOString());
		expect(ignoredRecord?.ignoredAt).toBe(successfulAttemptTime.toISOString());
		expect(importedRecord?.importedAt).not.toBe(failedAttemptTime.toISOString());
		expect(ignoredRecord?.ignoredAt).not.toBe(failedAttemptTime.toISOString());
		expect(durableSettings.hasCompletedFirstSync).toBe(true);
		expect(saveData).toHaveBeenCalledTimes(2);
		expect(loadData).toHaveBeenCalledTimes(2);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(1);
		expect(mocks.syncSummaryOpen).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("performs one save, one read-back, one commit, one cleanup, and one summary on ordinary success", async () => {
		const importedHighlight = createHighlight({ bookTitle: "Import", author: "Author One" });
		const ignoredHighlight = createHighlight({ bookTitle: "Ignore", author: "Author Two" });
		const plugin = await createPlugin(createSettings({ hasCompletedFirstSync: false }));
		const liveSettings = plugin.settings;
		const saveData = vi.spyOn(plugin, "saveData");
		const loadData = vi.spyOn(plugin, "loadData");

		await plugin.completeFirstSync(
			[importedHighlight],
			[ignoredHighlight],
			[],
			createIdentityIndex([importedHighlight, ignoredHighlight])
		);

		expect(saveData).toHaveBeenCalledTimes(1);
		expect(loadData).toHaveBeenCalledTimes(1);
		expect(plugin.settings).not.toBe(liveSettings);
		expect(persistenceControl(plugin).getDurableData()).toEqual(plugin.settings);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledTimes(1);
		expect(mocks.syncSummaryInstances).toHaveLength(1);
		expect(mocks.syncSummaryOpen).toHaveBeenCalledTimes(1);
	});

	it("uses JSON normalization and ignores object key ordering during verification", async () => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({ hasCompletedFirstSync: false }));
		const originalSaveData = plugin.saveData.bind(plugin);
		const control = persistenceControl(plugin);

		(plugin.settings as KindleSyncSettings & { unsupported?: undefined }).unsupported = undefined;
		vi.spyOn(plugin, "saveData").mockImplementationOnce(async (data) => {
			await originalSaveData(data);
			const snapshot = data as KindleSyncSettings;

			control.setLoadDataResult({
				hasCompletedFirstSync: snapshot.hasCompletedFirstSync,
				importedHighlights: snapshot.importedHighlights.map((record) => ({
					importedAt: record.importedAt,
					textPreview: record.textPreview,
					author: record.author,
					title: record.title,
					id: record.id,
				})),
				ignoredHighlights: snapshot.ignoredHighlights,
				skipIgnoredHighlights: snapshot.skipIgnoredHighlights,
				strictLocalOnly: snapshot.strictLocalOnly,
				highlightsFolder: snapshot.highlightsFolder,
				clippingsPath: snapshot.clippingsPath,
			});
		});

		await plugin.completeFirstSync(
			[highlight],
			[],
			[],
			createIdentityIndex([highlight])
		);

		expect((plugin.settings as KindleSyncSettings & { unsupported?: unknown }).unsupported).toBeUndefined();
		expect(plugin.settings.importedHighlights).toHaveLength(1);
		expect(mocks.syncSummaryInstances).toHaveLength(1);
	});

	it.each([
		["null read-back", "missing-readback", (plugin: InstanceType<typeof KindleLocalSyncPlugin>) => {
			persistenceControl(plugin).setLoadDataResult(null);
		}],
		["malformed read-back", "malformed-readback", (plugin: InstanceType<typeof KindleLocalSyncPlugin>) => {
			persistenceControl(plugin).setLoadDataResult({ importedHighlights: "not-an-array" });
		}],
		["read failure", "read-failed", (plugin: InstanceType<typeof KindleLocalSyncPlugin>) => {
			persistenceControl(plugin).setLoadDataError(new Error("Settings read failed."));
		}],
	] as const)("fails safely for %s", async (_label, expectedCode, configure) => {
		const highlight = createHighlight();
		const plugin = await createPlugin(createSettings({ hasCompletedFirstSync: false }));
		const liveSettings = plugin.settings;
		const settingsBefore = JSON.stringify(liveSettings);

		configure(plugin);

		let failure: unknown;
		try {
			await plugin.completeFirstSync(
				[highlight],
				[],
				[],
				createIdentityIndex([highlight])
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(SettingsPersistenceVerificationError);
		expect((failure as InstanceType<typeof SettingsPersistenceVerificationError>).code).toBe(expectedCode);
		expect(plugin.settings).toBe(liveSettings);
		expect(JSON.stringify(plugin.settings)).toBe(settingsBefore);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).not.toHaveBeenCalled();
		expect(mocks.syncSummaryInstances).toHaveLength(0);
	});

	it("serializes snapshot creation through durable verification", async () => {
		const firstHighlight = createHighlight({ bookTitle: "First", author: "Author One" });
		const secondHighlight = createHighlight({ bookTitle: "Second", author: "Author Two" });
		const plugin = await createPlugin(createSettings());
		const firstSave = createDeferred<void>();
		const originalSaveData = plugin.saveData.bind(plugin);
		const saveData = vi.spyOn(plugin, "saveData")
			.mockImplementationOnce(async (data) => {
				await firstSave.promise;
				await originalSaveData(data);
			})
			.mockImplementation(async (data) => originalSaveData(data));

		const firstRequest = plugin.ignoreHighlights(
			[firstHighlight],
			createIdentityIndex([firstHighlight, secondHighlight])
		);
		await waitForMockCall(saveData);
		const secondRequest = plugin.ignoreHighlights(
			[secondHighlight],
			createIdentityIndex([firstHighlight, secondHighlight])
		);
		await Promise.resolve();

		expect(saveData).toHaveBeenCalledTimes(1);
		firstSave.resolve(undefined);
		await firstRequest;
		await secondRequest;

		expect(saveData).toHaveBeenCalledTimes(2);
		expect(plugin.settings.ignoredHighlights.map((record) => record.title)).toEqual([
			firstHighlight.bookTitle,
			secondHighlight.bookTitle,
		]);
		expect(persistenceControl(plugin).getDurableData()).toEqual(plugin.settings);
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

interface PersistenceControl {
	setSaveDataPersists(persist: boolean): void;
	setLoadDataResult(data: unknown): void;
	setLoadDataError(error: unknown): void;
	getDurableData(): unknown;
}

function persistenceControl(plugin: InstanceType<typeof KindleLocalSyncPlugin>): PersistenceControl {
	return plugin as unknown as PersistenceControl;
}

function readHasSavedPluginData(plugin: InstanceType<typeof KindleLocalSyncPlugin>): boolean {
	return (plugin as unknown as { hasSavedPluginData: boolean }).hasSavedPluginData;
}

function readHasTrustedSyncState(plugin: InstanceType<typeof KindleLocalSyncPlugin>): boolean {
	return (plugin as unknown as { hasTrustedSyncState: boolean }).hasTrustedSyncState;
}

async function saveCustomClippingsPath(
	plugin: InstanceType<typeof KindleLocalSyncPlugin>
): Promise<void> {
	plugin.settings.clippingsPath = "/Users/test/QA Input/My Clippings.txt";
	await plugin.saveSettings();
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
		author: highlight.author,
		textPreview: highlight.content,
		importedAt: "2026-07-09T00:00:00.000Z",
	};
}

function createIgnoredRecord(highlight: KindleHighlight): IgnoredHighlight {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		author: highlight.author,
		textPreview: highlight.content,
		ignoredAt: "2026-07-09T00:00:00.000Z",
	};
}

function createSummaryItem(highlight: KindleHighlight): SyncSummaryHighlightItem {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		author: highlight.author,
		textPreview: highlight.content,
		location: highlight.location || undefined,
	};
}

function createIdentityIndex(highlights: KindleHighlight[]): CurrentClippingIdentityIndex {
	return new CurrentClippingIdentityIndex(highlights);
}

function createEmptyCleanupResult() {
	return {
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes: [],
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

function createWriterSummary(
	bookGroups: KindleBookGroup[],
	protectedBooks: Array<{ bookTitle: string; author: string }> = []
): VaultWriteSummary {
	const plan = createVaultWritePlan("Kindle Highlights", bookGroups);
	const bookOutcomes = plan.bookPlans.map((bookPlan) => {
		const group = bookPlan.group;
		const isProtected = protectedBooks.some((book) =>
			book.bookTitle === group.bookTitle && book.author === group.author
		);

		return isProtected
			? {
				bookTitle: group.bookTitle,
				author: group.author,
				notePath: bookPlan.notePath,
				highlightIds: [...bookPlan.highlightIds],
				status: "protected" as const,
				reason: "existing-highlights-not-retained" as const,
			}
			: {
				bookTitle: group.bookTitle,
				author: group.author,
				notePath: bookPlan.notePath,
				highlightIds: [...bookPlan.highlightIds],
				status: "updated" as const,
			};
	});

	return {
		books: plan.bookPlans.length,
		filesCreated: 0,
		filesUpdated: bookOutcomes.filter((outcome) => outcome.status === "updated").length,
		filesUnchanged: 0,
		filesProtected: bookOutcomes.filter((outcome) => outcome.status === "protected").length,
		highlightsRendered: plan.highlightsRendered,
		duplicatesSkipped: plan.duplicatesSkipped,
		bookOutcomes,
	};
}

function createMissingOutcomeSummary(bookGroups: KindleBookGroup[]): VaultWriteSummary {
	const summary = createWriterSummary(bookGroups);

	summary.bookOutcomes = [];
	return summary;
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

async function waitForMockCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (mock.mock.calls.length > 0) {
			return;
		}

		await Promise.resolve();
	}

	throw new Error("Expected mock to be called.");
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

function createSameTitleAuthorCollision(author: string): KindleHighlight {
	return createHighlight({
		bookTitle: "Same Title",
		author,
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});
}
