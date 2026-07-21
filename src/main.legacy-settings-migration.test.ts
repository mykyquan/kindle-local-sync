import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { parseClippings } from "./parser/parseClippings";
import {
	createClippingId,
	groupHighlightsByBook,
	type KindleBookGroup,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "./render/renderMarkdown";
import type { KindleSyncSettings } from "./settings";
import { allocateBookNotePaths } from "./sync/VaultWriter";

interface ReviewModalCapture {
	bookGroups: KindleBookGroup[];
	options?: { title?: string };
	open: ReturnType<typeof vi.fn>;
	modal: { contentEl: unknown };
}

interface ExistingNotesModalCapture {
	open: ReturnType<typeof vi.fn>;
	continueWithExistingNotes: () => Promise<boolean>;
}

type UnfinishedReviewAction = "Import" | "Skip This Sync" | "Ignore";

interface InteractiveTestElement {
	findByText(text: string): InteractiveTestElement | null;
	click(): Promise<void>;
}

const mocks = vi.hoisted(() => ({
	detectClippingsPath: vi.fn(),
	readClippingsFile: vi.fn(),
	existingNotesModalInstances: [] as ExistingNotesModalCapture[],
	reviewModalInstances: [] as ReviewModalCapture[],
	syncSummaryOpen: vi.fn(),
	inspectDurabilityFoundation: vi.fn(),
}));

vi.mock("./durability/Foundation", () => ({
	inspectDurabilityFoundation: mocks.inspectDurabilityFoundation,
}));

vi.mock("./sync/KindleDetector", () => ({
	detectClippingsPath: mocks.detectClippingsPath,
}));

vi.mock("./sync/ClippingsReader", () => ({
	readClippingsFile: mocks.readClippingsFile,
}));

vi.mock("./ExistingNotesWithoutDataModal", () => ({
	ExistingNotesWithoutDataModal: class {
		private readonly capture: ExistingNotesModalCapture;

		constructor(
			_app: unknown,
			plugin: { continueExistingNotesWithoutDataSync(): Promise<boolean> }
		) {
			this.capture = {
				open: vi.fn(),
				continueWithExistingNotes: () => plugin.continueExistingNotesWithoutDataSync(),
			};
			mocks.existingNotesModalInstances.push(this.capture);
		}

		open(): void {
			this.capture.open();
		}
	},
}));

vi.mock("./FirstSyncPreviewModal", async () => {
	const actual = await vi.importActual<typeof import("./FirstSyncPreviewModal")>(
		"./FirstSyncPreviewModal"
	);

	return {
		FirstSyncPreviewModal: class extends actual.FirstSyncPreviewModal {
		private readonly capture: ReviewModalCapture;

		constructor(
			app: unknown,
			plugin: unknown,
			bookGroups: KindleBookGroup[],
			options?: ReviewModalCapture["options"]
		) {
			super(app as never, plugin as never, bookGroups, options);
			this.capture = { bookGroups, options, open: vi.fn(), modal: this };
			mocks.reviewModalInstances.push(this.capture);
		}

		open(): void {
			this.capture.open();
			super.open();
		}
		},
	};
});

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
	mocks.inspectDurabilityFoundation.mockResolvedValue(createSafeFoundation());
	mocks.existingNotesModalInstances.length = 0;
	mocks.reviewModalInstances.length = 0;
	mocks.detectClippingsPath.mockResolvedValue("/Volumes/Kindle/documents/My Clippings.txt");
});

describe("legacy 0.1.2 settings-only migration", () => {
	it("offers to reconnect a valid existing managed note instead of reviewing its old highlight as new", async () => {
		const rawClippings = renderLegacyClippings();
		const { vault } = createLegacyVault(rawClippings);
		const plugin = await createPlugin(vault, LEGACY_0_1_2_SETTINGS);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		await plugin.syncHighlights();

		expect(plugin.settings).toMatchObject(LEGACY_0_1_2_SETTINGS);
		expect(plugin.settings.hasCompletedFirstSync).toBe(false);
		expect(mocks.existingNotesModalInstances).toHaveLength(1);
		expect(mocks.existingNotesModalInstances[0]?.open).toHaveBeenCalledTimes(1);
		expect(mocks.reviewModalInstances).toHaveLength(0);
	});

	it("uses First Sync Preview when settings-only data has no valid existing notes", async () => {
		const rawClippings = renderLegacyClippings();
		const vault = new MemoryVault();
		const plugin = await createPlugin(vault, LEGACY_0_1_2_SETTINGS);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		await plugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(0);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBeUndefined();
	});

	it("keeps the no-data routes unchanged with and without valid existing notes", async () => {
		const rawClippings = renderLegacyClippings();
		const { vault: existingVault } = createLegacyVault(
			rawClippings,
			parseClippings(rawClippings),
			"Kindle Highlights"
		);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		const existingNotesPlugin = await createPlugin(existingVault, null);
		await existingNotesPlugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances).toHaveLength(0);

		mocks.existingNotesModalInstances.length = 0;
		const emptyVaultPlugin = await createPlugin(new MemoryVault(), null);
		await emptyVaultPlugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(0);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBeUndefined();
	});

	it("keeps explicit current completed and incomplete states on their existing routes", async () => {
		const rawClippings = renderLegacyClippings();
		const { vault } = createLegacyVault(rawClippings);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		const completedPlugin = await createPlugin(vault, createCurrentSettings({
			hasCompletedFirstSync: true,
			importedHighlights: [],
			ignoredHighlights: [],
		}));
		await completedPlugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(0);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBe("Review New Highlights");

		mocks.existingNotesModalInstances.length = 0;
		mocks.reviewModalInstances.length = 0;
		const incompletePlugin = await createPlugin(vault, createCurrentSettings({
			hasCompletedFirstSync: false,
		}));
		await incompletePlugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances).toHaveLength(0);
	});

	it("uses First Sync Preview for explicit current incomplete state without managed notes", async () => {
		const rawClippings = renderLegacyClippings();
		const plugin = await createPlugin(new MemoryVault(), createCurrentSettings({
			hasCompletedFirstSync: false,
		}));
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		await plugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(0);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBeUndefined();
	});

	it("reconnects only exact managed IDs, persists full current state, and does not reconnect after restart", async () => {
		const rawClippings = `${renderLegacyClippings()}\n${renderUnmatchedClipping()}`;
		const highlights = parseClippings(rawClippings);
		const [existingHighlight, unmatchedHighlight] = highlights;

		if (!existingHighlight || !unmatchedHighlight) {
			throw new Error("Expected both legacy clipping fixtures to parse.");
		}

		const { vault, notePath, originalMarkdown } = createLegacyVault(
			rawClippings,
			[existingHighlight]
		);
		const plugin = await createPlugin(vault, LEGACY_0_1_2_SETTINGS);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(plugin.settings).toMatchObject({
			...LEGACY_0_1_2_SETTINGS,
			hasCompletedFirstSync: true,
			ignoredHighlights: [],
		});
		expect(plugin.settings.importedHighlights).toMatchObject([{
			id: createClippingId(existingHighlight),
			title: existingHighlight.bookTitle,
			author: existingHighlight.author,
		}]);
		expect(plugin.settings.importedHighlights).toHaveLength(1);
		expect(vault.getMarkdown(notePath)).toBe(originalMarkdown);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedIds()).toEqual([createClippingId(unmatchedHighlight)]);

		const durableState = readDurableState(plugin);
		expect(durableState).toEqual(plugin.settings);
		expect(durableState).toMatchObject({
			skipIgnoredHighlights: true,
			hasCompletedFirstSync: true,
			importedHighlights: [{ id: createClippingId(existingHighlight) }],
			ignoredHighlights: [],
		});

		mocks.existingNotesModalInstances.length = 0;
		mocks.reviewModalInstances.length = 0;
		const restartedPlugin = await createPlugin(vault, durableState);
		await restartedPlugin.syncHighlights();

		expect(mocks.existingNotesModalInstances).toHaveLength(0);
		expect(mocks.reviewModalInstances).toHaveLength(1);
		expect(mocks.reviewModalInstances[0]?.options?.title).toBe("Review New Highlights");
		expect(reviewedIds()).toEqual([createClippingId(unmatchedHighlight)]);
	});

	it.each(["Import", "Skip This Sync", "Ignore"] as const)(
		"keeps verified reconnect state after discarding unfinished %s",
		async (action: UnfinishedReviewAction) => {
			expect(Object.keys(LEGACY_0_1_2_SETTINGS).sort()).toEqual([
				"clippingsPath",
				"highlightsFolder",
				"strictLocalOnly",
			]);
			const matchedRawClippings = renderMatchedLegacyClippings(15);
			const rawClippings = `${matchedRawClippings}\n${renderUnmatchedClipping()}`;
			const highlights = parseClippings(rawClippings);
			const matchedHighlights = highlights.slice(0, 15);
			const unmatchedHighlight = highlights[15];

			expect(matchedHighlights).toHaveLength(15);
			if (!unmatchedHighlight) {
				throw new Error("Expected one unmatched clipping after the 15 legacy clippings.");
			}

			const unmatchedId = createClippingId(unmatchedHighlight);
			const { vault, notePath, originalMarkdown } = createLegacyVault(
				rawClippings,
				matchedHighlights
			);
			const notesBeforeSync = vault.getMarkdownSnapshot();
			const plugin = await createPlugin(vault, LEGACY_0_1_2_SETTINGS);
			mocks.readClippingsFile.mockResolvedValue(rawClippings);

			await plugin.syncHighlights();

			expect(mocks.existingNotesModalInstances).toHaveLength(1);
			expect(mocks.existingNotesModalInstances[0]?.open).toHaveBeenCalledTimes(1);
			expect(mocks.reviewModalInstances).toHaveLength(0);

			await mocks.existingNotesModalInstances[0]?.continueWithExistingNotes();

			const durableReconnectState = readDurableState(plugin);
			const matchedIds = matchedHighlights.map(createClippingId);

			expect(durableReconnectState.hasCompletedFirstSync).toBe(true);
			expect(durableReconnectState.importedHighlights.map((record) => record.id)).toEqual(matchedIds);
			expect(new Set(durableReconnectState.importedHighlights.map((record) => record.id)).size).toBe(15);
			expect(durableReconnectState.ignoredHighlights).toEqual([]);
			expect(mocks.reviewModalInstances).toHaveLength(1);
			expect(mocks.reviewModalInstances[0]?.options?.title).toBe("Review New Highlights");
			expect(reviewedIds()).toEqual([unmatchedId]);

			const review = mocks.reviewModalInstances[0];

			if (!review) {
				throw new Error("Expected the unmatched highlight review to open.");
			}

			await chooseAndDiscardReviewAction(review, action);

			const durableStateAfterDiscard = readDurableState(plugin);

			expect(durableStateAfterDiscard).toEqual(durableReconnectState);
			expect(durableStateAfterDiscard.hasCompletedFirstSync).toBe(true);
			expect(durableStateAfterDiscard.importedHighlights.map((record) => record.id)).toEqual(matchedIds);
			expect(durableStateAfterDiscard.importedHighlights.some((record) => record.id === unmatchedId)).toBe(false);
			expect(durableStateAfterDiscard.ignoredHighlights.some((record) => record.id === unmatchedId)).toBe(false);
			expect(durableStateAfterDiscard).not.toHaveProperty("skippedHighlights");
			expect(durableStateAfterDiscard).not.toHaveProperty("skippedThisSyncHighlights");
			expect(vault.getMarkdown(notePath)).toBe(originalMarkdown);
			expect(vault.getMarkdownSnapshot()).toEqual(notesBeforeSync);

			mocks.existingNotesModalInstances.length = 0;
			mocks.reviewModalInstances.length = 0;
			const restartedPlugin = await createPlugin(vault, durableStateAfterDiscard);

			await restartedPlugin.syncHighlights();

			expect(mocks.existingNotesModalInstances).toHaveLength(0);
			expect(mocks.reviewModalInstances).toHaveLength(1);
			expect(mocks.reviewModalInstances[0]?.options?.title).toBe("Review New Highlights");
			expect(reviewedIds()).toEqual([unmatchedId]);
			expect(readDurableState(restartedPlugin)).toEqual(durableStateAfterDiscard);
			expect(vault.getMarkdown(notePath)).toBe(originalMarkdown);
			expect(vault.getMarkdownSnapshot()).toEqual(notesBeforeSync);
		}
	);

	it("does not duplicate matched highlights and preserves personal bytes outside the managed region", async () => {
		const rawClippings = renderLegacyClippings();
		const [highlight] = parseClippings(rawClippings);

		if (!highlight) {
			throw new Error("Expected the legacy clipping fixture to parse.");
		}

		const { vault, notePath, personalBefore, personalAfter } = createLegacyVault(rawClippings);
		const plugin = await createPlugin(vault, LEGACY_0_1_2_SETTINGS);
		mocks.readClippingsFile.mockResolvedValue(rawClippings);

		await plugin.continueExistingNotesWithoutDataSync();

		const migratedMarkdown = vault.getMarkdown(notePath);
		const idMarker = `<!-- kindle-local-sync-id: ${createClippingId(highlight)} -->`;
		const migratedStartIndex = migratedMarkdown.indexOf(SYNC_START_MARKER);
		const migratedAfterEndIndex = migratedMarkdown.indexOf(SYNC_END_MARKER)
			+ SYNC_END_MARKER.length;
		expect(migratedMarkdown.slice(0, migratedStartIndex)).toBe(personalBefore);
		expect(migratedMarkdown.slice(migratedAfterEndIndex)).toBe(personalAfter);
		expect(migratedMarkdown.split(idMarker)).toHaveLength(2);
		expect(plugin.settings.importedHighlights).toHaveLength(1);
		expect(mocks.reviewModalInstances).toHaveLength(0);
		expect(mocks.syncSummaryOpen).toHaveBeenCalledTimes(1);
	});
});

const LEGACY_0_1_2_SETTINGS = {
	clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt",
	highlightsFolder: "Legacy Kindle Notes",
	strictLocalOnly: true,
};

class MemoryFile {
	extension = "md";

	constructor(readonly path: string) {
	}
}

class MemoryFolder {
	children: MemoryFile[] = [];

	constructor(readonly path: string) {
	}
}

class MemoryVault {
	private readonly entries = new Map<string, MemoryFile | MemoryFolder>();
	private readonly markdown = new Map<string, string>();
	adapter = {
		exists: async (path: string) => this.entries.has(path),
		stat: async (path: string) => {
			const entry = this.entries.get(path);

			if (!entry) {
				return null;
			}

			return { type: entry instanceof MemoryFile ? "file" : "folder" };
		},
		read: async (path: string) => this.markdown.get(path) ?? "",
		write: async (path: string, content: string) => {
			this.markdown.set(path, content);
		},
	};

	addFolder(path: string): void {
		this.entries.set(path, new MemoryFolder(path));
	}

	async createFolder(path: string): Promise<void> {
		this.addFolder(path);
	}

	addMarkdownFile(path: string, content: string): void {
		const file = new MemoryFile(path);
		this.entries.set(path, file);
		this.markdown.set(path, content);

		const folderPath = path.slice(0, path.lastIndexOf("/"));
		const folder = this.entries.get(folderPath);

		if (folder instanceof MemoryFolder) {
			folder.children.push(file);
		}
	}

	getAbstractFileByPath(path: string): MemoryFile | MemoryFolder | null {
		return this.entries.get(path) ?? null;
	}

	async read(file: MemoryFile): Promise<string> {
		return this.markdown.get(file.path) ?? "";
	}

	async modify(file: MemoryFile, content: string): Promise<void> {
		this.markdown.set(file.path, content);
	}

	async create(path: string, content: string): Promise<MemoryFile> {
		this.addMarkdownFile(path, content);
		const file = this.entries.get(path);

		if (!(file instanceof MemoryFile)) {
			throw new Error(`Expected ${path} to be a Markdown file.`);
		}

		return file;
	}

	getMarkdown(path: string): string {
		return this.markdown.get(path) ?? "";
	}

	getMarkdownSnapshot(): Record<string, string> {
		return Object.fromEntries([...this.markdown.entries()].sort(([left], [right]) =>
			left.localeCompare(right)
		));
	}
}

async function createPlugin(
	vault: MemoryVault,
	loadedData: Partial<KindleSyncSettings> | null
): Promise<InstanceType<typeof KindleLocalSyncPlugin>> {
	const plugin = new KindleLocalSyncPlugin(new App(vault) as never, {} as never);

	(plugin as unknown as { setLoadedData(data: unknown): void }).setLoadedData(loadedData);
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

function createLegacyVault(
	rawClippings: string,
	managedHighlights = parseClippings(rawClippings),
	highlightsFolder = LEGACY_0_1_2_SETTINGS.highlightsFolder
): {
	vault: MemoryVault;
	notePath: string;
	originalMarkdown: string;
	personalBefore: string;
	personalAfter: string;
} {
	const allHighlights = parseClippings(rawClippings);
	const [notePath] = allocateBookNotePaths(
		highlightsFolder,
		groupHighlightsByBook(allHighlights)
	);

	if (!notePath) {
		throw new Error("Expected the legacy clipping fixture to allocate a note path.");
	}

	const personalBeforeText = "Personal text before the managed region.\r\n\r\n";
	const personalAfterText = "\r\n\r\nPersonal text after the managed region.";
	const managedIds = managedHighlights.map(createClippingId);
	const originalMarkdown = [
		personalBeforeText,
		SYNC_START_MARKER,
		...managedIds.map((id) => `<!-- kindle-local-sync-id: ${id} -->`),
		SYNC_END_MARKER,
		personalAfterText,
	].join("\r\n");
	const startIndex = originalMarkdown.indexOf(SYNC_START_MARKER);
	const afterEndIndex = originalMarkdown.indexOf(SYNC_END_MARKER) + SYNC_END_MARKER.length;
	const personalBefore = originalMarkdown.slice(0, startIndex);
	const personalAfter = originalMarkdown.slice(afterEndIndex);
	const vault = new MemoryVault();
	vault.addFolder(highlightsFolder);
	vault.addMarkdownFile(notePath, originalMarkdown);

	return { vault, notePath, originalMarkdown, personalBefore, personalAfter };
}

function createCurrentSettings(overrides: Partial<KindleSyncSettings>): KindleSyncSettings {
	return {
		clippingsPath: LEGACY_0_1_2_SETTINGS.clippingsPath,
		highlightsFolder: LEGACY_0_1_2_SETTINGS.highlightsFolder,
		strictLocalOnly: LEGACY_0_1_2_SETTINGS.strictLocalOnly,
		skipIgnoredHighlights: true,
		ignoredHighlights: [],
		importedHighlights: [],
		hasCompletedFirstSync: false,
		...overrides,
	};
}

function reviewedIds(): string[] {
	return mocks.reviewModalInstances[0]?.bookGroups.flatMap((group) =>
		group.clippings.map(createClippingId)
	) ?? [];
}

function readDurableState(
	plugin: InstanceType<typeof KindleLocalSyncPlugin>
): KindleSyncSettings {
	return (plugin as unknown as { getDurableData(): KindleSyncSettings }).getDurableData();
}

function renderLegacyClippings(): string {
	return `The Clockwork Orchard (Mira Vale)
- Your Highlight on page 12 | Location 154 | Added on Monday, October 5, 2099 9:41 AM

Clockwork apples chime at midnight.
==========`;
}

function renderMatchedLegacyClippings(count: number): string {
	return Array.from({ length: count }, (_, index) => `The Clockwork Orchard (Mira Vale)
- Your Highlight on page ${index + 1} | Location ${154 + index} | Added on Monday, October 5, 2099 9:41 AM

Clockwork orchard memory ${index + 1}.
==========`).join("\n");
}

function renderUnmatchedClipping(): string {
	return `Night Trains to Lumen Bay (Owen Hart)
- Your Note on page 20 | Location 220 | Added on Tuesday, October 6, 2099 10:15 AM

Reserve a window seat before moonrise.
==========`;
}

async function chooseAndDiscardReviewAction(
	review: ReviewModalCapture,
	action: UnfinishedReviewAction
): Promise<void> {
	await findInteractiveElement(review.modal.contentEl, "Review Highlights").click();
	await findInteractiveElement(review.modal.contentEl, action).click();
	await findInteractiveElement(review.modal.contentEl, "Cancel").click();
	await findInteractiveElement(review.modal.contentEl, "Discard and exit").click();
}

function findInteractiveElement(root: unknown, text: string): InteractiveTestElement {
	const match = (root as InteractiveTestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find interactive review element: ${text}`);
	}

	return match;
}
