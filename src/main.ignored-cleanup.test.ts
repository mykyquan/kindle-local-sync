import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { FirstSyncPreviewModal } from "./FirstSyncPreviewModal";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { SyncSummaryModal } from "./SyncSummaryModal";
import { SyncClassification } from "./sync/SyncClassifier";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";
import { IgnoredHighlightCleanupSummary } from "./sync/IgnoredHighlightCleanup";
import { IgnoreResultsPresentation } from "./SyncOutcomePresentation";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

const mocks = vi.hoisted(() => ({
	removeIgnoredHighlightBlocksFromExistingNotes: vi.fn(),
	writeBookNotesToVault: vi.fn(),
	inspectDurabilityFoundation: vi.fn(),
}));

vi.mock("./durability/Foundation", () => ({
	inspectDurabilityFoundation: mocks.inspectDurabilityFoundation,
}));

vi.mock("./sync/IgnoredHighlightCleanup", () => ({
	removeIgnoredHighlightBlocksFromExistingNotes: mocks.removeIgnoredHighlightBlocksFromExistingNotes,
}));

vi.mock("./sync/VaultWriter", async () => {
	const actual = await vi.importActual<typeof import("./sync/VaultWriter")>("./sync/VaultWriter");

	return {
		...actual,
		writeBookNotesToVault: mocks.writeBookNotesToVault,
	};
});

let KindleLocalSyncPlugin: typeof import("./main").default;

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.inspectDurabilityFoundation.mockResolvedValue(createSafeFoundation());
	mocks.writeBookNotesToVault.mockResolvedValue({
		books: 0,
		filesCreated: 0,
		filesUpdated: 0,
		filesUnchanged: 0,
		filesProtected: 0,
		highlightsRendered: 0,
		duplicatesSkipped: 0,
		bookOutcomes: [],
	});
	mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValue({
		filesScanned: 1,
		filesUpdated: 1,
		blocksRemoved: 1,
		bookOutcomes: [],
	});
});

describe("ignored highlight cleanup triggers", () => {
	it("persists an explicit Ignore and returns a blocked non-removal outcome", async () => {
		const plugin = await createPlugin();
		const highlight = createHighlight();
		const target = {
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			id: createClippingId(highlight),
		};
		const blockedResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [{
				bookTitle: highlight.bookTitle,
				author: highlight.author,
				targetOutcomes: [{
					target,
					status: "unsafe-managed-region",
					reason: "start-without-end",
				}],
			}],
		};

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(blockedResult);
		const result = await plugin.ignoreHighlights(
			[highlight],
			new CurrentClippingIdentityIndex([highlight])
		);

		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: target.id,
			title: target.bookTitle,
			author: target.author,
		}]);
		expect(result.cleanupResult).toEqual(blockedResult);
		expect(result.cleanupResult.blocksRemoved).toBe(0);
		expect(result.cleanupResult.bookOutcomes[0]?.targetOutcomes).not.toContainEqual(
			expect.objectContaining({ status: "removed-safely" })
		);
		expect(result.outcomePresentation.items).toEqual([{
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			highlightPreview: highlight.content,
			status: "note-unchanged",
		}]);
	});

	it("keeps the first-sync summary available when cleanup rejects after Ignore persistence", async () => {
		const plugin = await createPlugin();
		const ignoredHighlight = createHighlight();
		const secondIgnoredHighlight = createHighlight({
			bookTitle: "The Paper Constellation",
			author: "Rowan Ellis",
			content: "Keep this ignored too.",
		});
		const skippedHighlight = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			content: "Keep this for the next review.",
		});
		const cleanupError = new Error("unexpected cleanup rejection");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const summaryOpen = vi.spyOn(SyncSummaryModal.prototype, "open");

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockRejectedValueOnce(cleanupError);
		const completion = await plugin.completeFirstSync(
			[],
			[ignoredHighlight, secondIgnoredHighlight],
			[createSummaryItem({
				id: createClippingId(skippedHighlight),
				title: skippedHighlight.bookTitle,
				author: skippedHighlight.author,
				textPreview: skippedHighlight.content,
			})],
			new CurrentClippingIdentityIndex([
				ignoredHighlight,
				secondIgnoredHighlight,
				skippedHighlight,
			])
		);
		const summary = summaryOpen.mock.instances.at(-1) as SyncSummaryModal | undefined;

		expect(plugin.settings.ignoredHighlights).toMatchObject([
			{ title: ignoredHighlight.bookTitle, author: ignoredHighlight.author },
			{ title: secondIgnoredHighlight.bookTitle, author: secondIgnoredHighlight.author },
		]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(true);
		expect(completion.ignoreCleanupResult.bookOutcomes.flatMap((outcome) => outcome.targetOutcomes))
			.toEqual([
				expect.objectContaining({ status: "cleanup-state-unknown" }),
				expect.objectContaining({ status: "cleanup-state-unknown" }),
			]);
		expect(completion.protectedSelectedHighlightCount).toBe(0);
		expect(summaryOpen).toHaveBeenCalledTimes(1);
		expect(summary).toBeDefined();
		expect(readText(summary!.contentEl)).toContain("Review Skipped This Sync");
		expect(readText(summary!.contentEl)).toContain(
			"Some existing-note results could not be confirmed."
		);
		expect(readText(summary!.contentEl)).not.toContain("left unchanged");
		expect(readText(summary!.contentEl)).not.toContain("removed from");
		expect((summary as unknown as { ignoreResults: IgnoreResultsPresentation }).ignoreResults.items)
			.toEqual([
				expect.objectContaining({ status: "change-unconfirmed" }),
				expect.objectContaining({ status: "change-unconfirmed" }),
			]);
		await findByText(summary!.contentEl, "Review Note Update Issues").click();
		const detailText = readText(summary!.contentEl);

		expect(detailText.match(/couldn’t confirm whether the existing note changed/g)).toHaveLength(2);
		expect(detailText).not.toContain(createClippingId(ignoredHighlight));
		expect(detailText).not.toMatch(/cleanup-state-unknown|kindle-local-sync|marker|stage|Kindle Highlights\//i);
		expect(detailText).not.toContain("removed from");
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to confirm existing-note cleanup after saving Ignore choices.",
			cleanupError
		);

		summaryOpen.mockRestore();
		consoleError.mockRestore();
	});

	it("keeps the reviewed-sync summary available when cleanup rejects after Ignore persistence", async () => {
		const plugin = await createPlugin();
		const ignoredHighlight = createHighlight();
		const validDuplicate = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			content: "Previously imported result.",
		});
		const cleanupError = new Error("unexpected reviewed cleanup rejection");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const summaryOpen = vi.spyOn(SyncSummaryModal.prototype, "open");

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockRejectedValueOnce(cleanupError);
		const completion = await plugin.completeReviewedSync(
			[],
			[ignoredHighlight],
			[],
			[],
			{
				newHighlights: [ignoredHighlight],
				duplicateHighlights: [validDuplicate],
				ignoredHighlights: [],
				possibleReappearedHighlights: [],
			},
			new CurrentClippingIdentityIndex([ignoredHighlight, validDuplicate])
		);
		const summary = summaryOpen.mock.instances.at(-1) as SyncSummaryModal | undefined;

		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			title: ignoredHighlight.bookTitle,
			author: ignoredHighlight.author,
		}]);
		expect(plugin.settings.hasCompletedFirstSync).toBe(true);
		expect(completion.importedCount).toBe(0);
		expect(completion.ignoreCleanupResult.blocksRemoved).toBe(0);
		expect(completion.ignoreCleanupResult.bookOutcomes[0]?.targetOutcomes).toEqual([
			expect.objectContaining({ status: "cleanup-state-unknown" }),
		]);
		expect(summaryOpen).toHaveBeenCalledTimes(1);
		expect(summary).toBeDefined();
		expect(readText(summary!.contentEl)).toContain("1 duplicate skipped");
		expect(readText(summary!.contentEl)).toContain(
			"The final note state could not be confirmed for 1 highlight."
		);
		expect(readText(summary!.contentEl)).not.toContain("left unchanged");
		expect(readText(summary!.contentEl)).not.toContain("removed from");
		expect((summary as unknown as { ignoreResults: IgnoreResultsPresentation }).ignoreResults.items)
			.toEqual([expect.objectContaining({ status: "change-unconfirmed" })]);
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to confirm existing-note cleanup after saving Ignore choices.",
			cleanupError
		);

		summaryOpen.mockRestore();
		consoleError.mockRestore();
	});

	it("First Sync Preview per-highlight Ignore triggers cleanup", async () => {
		const plugin = await createPlugin();
		const group = createBookGroup();
		const modal = new FirstSyncPreviewModal(new App() as never, plugin as never, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore").click();
		await findByText(modal.contentEl, "Back").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		const firstHighlight = group.clippings[0];
		if (!firstHighlight) {
			throw new Error("Expected a first highlight in the test group.");
		}

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{
				bookTitle: firstHighlight.bookTitle,
				author: firstHighlight.author,
				id: createClippingId(firstHighlight),
			}]
		);
	});

	it("First Sync Preview Ignore All triggers cleanup", async () => {
		const plugin = await createPlugin();
		const group = createBookGroup();
		const modal = new FirstSyncPreviewModal(new App() as never, plugin as never, [group]);

		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			group.clippings.map((highlight) => ({
				bookTitle: highlight.bookTitle,
				author: highlight.author,
				id: createClippingId(highlight),
			}))
		);
	});

	it("Ignore All persists and cleans up only the selected book when real clipping IDs collide", async () => {
		const plugin = await createPlugin();
		const bookA = createCollisionBookGroup("Collision 1h0o65e 20hu");
		const bookB = createCollisionBookGroup("Collision 1y0rlvz 2269");
		const modal = new FirstSyncPreviewModal(new App() as never, plugin as never, [bookA, bookB]);

		expect(createClippingId(bookA.clippings[0]!)).toBe(createClippingId(bookB.clippings[0]!));
		modal.onOpen();
		await findByText(modal.contentEl, "Ignore All").click();
		await findByText(modal.contentEl, "Finish Sync").click();
		await findByText(modal.contentEl, "Finish Sync").click();

		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: createClippingId(bookA.clippings[0]!),
			title: bookA.bookTitle,
			author: bookA.author,
		}]);
		expect(plugin.settings.ignoredHighlights).not.toContainEqual(expect.objectContaining({
			title: bookB.bookTitle,
		}));
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{
				bookTitle: bookA.bookTitle,
				author: bookA.author,
				id: createClippingId(bookA.clippings[0]!),
			}]
		);
	});

	it("Sync Summary Ignore Going Forward triggers cleanup", async () => {
		const plugin = await createPlugin();
		const sourceHighlight = createHighlight();
		const highlight = createSummaryItem({
			id: createClippingId(sourceHighlight),
			title: sourceHighlight.bookTitle,
			author: sourceHighlight.author,
		});
		const legacyRecord = {
			id: highlight.id,
			title: highlight.title,
			textPreview: "Legacy ignored preview",
			ignoredAt: "2025-01-01T00:00:00.000Z",
		};

		plugin.settings.ignoredHighlights = [legacyRecord];
		const modal = createSyncSummaryModal(plugin, {
			skippedThisSyncHighlights: [highlight],
			identityHighlights: [sourceHighlight],
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Skipped This Sync").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{ bookTitle: highlight.title, author: highlight.author, id: highlight.id }]
		);
		expect(plugin.settings.ignoredHighlights).toHaveLength(2);
		expect(plugin.settings.ignoredHighlights[0]).toEqual(legacyRecord);
		expect(plugin.settings.ignoredHighlights[1]).toMatchObject({
			id: highlight.id,
			title: highlight.title,
			author: highlight.author,
		});
	});

	it("Sync Summary Ignore All Highlights triggers cleanup", async () => {
		const plugin = await createPlugin();
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
		await findByText(modal.contentEl, "Ignore All Highlights").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{ bookTitle: highlights[0]!.title, author: highlights[0]!.author, id: "kls-one" }]
		);
		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{ bookTitle: highlights[1]!.title, author: highlights[1]!.author, id: "kls-two" }]
		);
	});

	it("Sync Summary Ignore Going Forward triggers cleanup if applicable", async () => {
		const plugin = await createPlugin();
		const highlight = createHighlight();
		const legacyRecord = {
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			textPreview: "Legacy ignored preview",
			ignoredAt: "2025-01-01T00:00:00.000Z",
		};

		plugin.settings.ignoredHighlights = [legacyRecord];
		const modal = createSyncSummaryModal(plugin, {
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect(mocks.removeIgnoredHighlightBlocksFromExistingNotes).toHaveBeenCalledWith(
			plugin.app.vault,
			"Kindle Highlights",
			[{
				bookTitle: highlight.bookTitle,
				author: highlight.author,
				id: createClippingId(highlight),
			}]
		);
		expect(plugin.settings.ignoredHighlights).toHaveLength(2);
		expect(plugin.settings.ignoredHighlights[0]).toEqual(legacyRecord);
		expect(plugin.settings.ignoredHighlights[1]).toMatchObject({
			id: createClippingId(highlight),
			title: highlight.bookTitle,
			author: highlight.author,
		});
	});

	it("retains a UI-safe blocked Missing Managed Ignore result for Phase 3A", async () => {
		const plugin = await createPlugin();
		const highlight = createHighlight();
		const target = {
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			id: createClippingId(highlight),
		};
		const blockedResult: IgnoredHighlightCleanupSummary = {
			filesScanned: 1,
			filesUpdated: 0,
			blocksRemoved: 0,
			bookOutcomes: [{
				bookTitle: highlight.bookTitle,
				author: highlight.author,
				targetOutcomes: [{ target, status: "ambiguous-note-ownership" }],
			}],
		};

		mocks.removeIgnoredHighlightBlocksFromExistingNotes.mockResolvedValueOnce(blockedResult);
		const modal = createSyncSummaryModal(plugin, {
			classification: createClassification({
				possibleReappearedHighlights: [highlight],
			}),
		});

		modal.onOpen();
		await findByText(modal.contentEl, "Review Missing Highlights").click();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Ignore Going Forward").click();

		expect((modal as unknown as {
			ignoreResults: IgnoreResultsPresentation;
		}).ignoreResults.items).toEqual([{
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			highlightPreview: highlight.content,
			status: "multiple-notes-unchanged",
		}]);
		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			id: target.id,
			title: target.bookTitle,
			author: target.author,
		}]);
	});
});

async function createPlugin(): Promise<InstanceType<typeof KindleLocalSyncPlugin>> {
	const plugin = new KindleLocalSyncPlugin(new App() as never, {} as never);
	await plugin.onload();
	return plugin;
}

function createSafeFoundation() {
	return {
		writeAllowed: true,
		message: "Kindle Local Sync recovery evidence is clear.",
		capabilities: { supported: true, failures: [], platform: "darwin" },
		classification: {
			kind: "no-evidence",
			status: "clear",
			issues: [],
			originInstanceIds: [],
			completedTransactionIds: [],
		},
	};
}

function createSyncSummaryModal(
	plugin: InstanceType<typeof KindleLocalSyncPlugin>,
	options: {
		classification?: SyncClassification;
		skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
		identityHighlights?: KindleHighlight[];
	}
): SyncSummaryModal {
	return new SyncSummaryModal(new App() as never, plugin as never, {
		classification: options.classification ?? createClassification(),
		automaticHighlights: [],
		importedCount: 0,
		skippedThisSyncHighlights: options.skippedThisSyncHighlights ?? [],
		identityIndex: new CurrentClippingIdentityIndex([
			...(options.identityHighlights ?? []),
			...(options.classification?.possibleReappearedHighlights ?? []),
		]),
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
		content: "Clockwork apples chime at midnight.",
	});
	const secondHighlight = createHighlight({
		location: "160",
		content: "Revisit the orchard map later.",
		type: "Note",
	});

	return {
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		clippings: [firstHighlight, secondHighlight],
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

function createSummaryItem(overrides: Partial<SyncSummaryHighlightItem> = {}): SyncSummaryHighlightItem {
	return {
		id: "kls-skipped",
		title: "The Clockwork Orchard",
		author: "Mira Vale",
		textPreview: "Clockwork apples chime at midnight.",
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

function readText(element: unknown): string {
	return (element as TestElement).text();
}
