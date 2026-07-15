import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import type { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import type { IgnoredHighlight, ImportedHighlightRecord, KindleSyncSettings } from "./settings";
import type { SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";
import type { IgnoredHighlightCleanupSummary } from "./sync/IgnoredHighlightCleanup";
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

interface SyncSummaryCapture {
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

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
});

beforeEach(() => {
	vi.clearAllMocks();
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
