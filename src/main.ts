import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { ExistingNotesWithoutDataModal } from "./ExistingNotesWithoutDataModal";
import { FirstSyncPreviewModal, SyncCompletionResult } from "./FirstSyncPreviewModal";
import { IgnoredHighlightsModal } from "./IgnoredHighlightsModal";
import { KindleHighlight, parseClippings } from "./parser/parseClippings";
import { createClippingId, groupHighlightsByBook, KindleBookGroup } from "./render/renderMarkdown";
import {
	ImportedHighlightRecord,
	IgnoredHighlight,
	KindleSyncSettings,
	migrateSettings,
} from "./settings";
import { readClippingsFile } from "./sync/ClippingsReader";
import { hasExistingHighlightNotes } from "./sync/ExistingHighlightNotes";
import { detectClippingsPath } from "./sync/KindleDetector";
import {
	IgnoredHighlightCleanupSummary,
	IgnoredHighlightCleanupTarget,
	removeIgnoredHighlightBlocksFromExistingNotes,
} from "./sync/IgnoredHighlightCleanup";
import {
	createAuthoredStoredHighlightIdentityKeySet,
	createBookIdentityKey,
	createHighlightIdentityKey,
	createKindleHighlightIdentityKey,
	createStoredHighlightIdentityKeySet,
	CurrentClippingIdentityIndex,
	hasSameHighlightIdentity,
} from "./sync/HighlightIdentity";
import { classifyHighlightsForSync, SyncClassification } from "./sync/SyncClassifier";
import { createVaultHighlightLookup } from "./sync/VaultHighlightLookup";
import { VaultWriteSummary, writeBookNotesToVault } from "./sync/VaultWriter";
import {
	InvalidVaultWriteContractError,
	validateAndPartitionVaultWriteSummary,
} from "./sync/VaultWriteContract";
import { SyncSummaryModal } from "./SyncSummaryModal";
import {
	createIgnoreResultsPresentation,
	createProtectedBooksPresentation,
	IgnoreResultsPresentation,
} from "./SyncOutcomePresentation";
import { createSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";

export interface HighlightImportResult {
	writeSummary: VaultWriteSummary;
	safelyCompletedHighlights: KindleHighlight[];
	protectedHighlights: KindleHighlight[];
}

export interface IgnoreOperationResult {
	cleanupResult: IgnoredHighlightCleanupSummary;
	outcomePresentation: IgnoreResultsPresentation;
}

interface ExistingSyncState {
	importedHighlights: ImportedHighlightRecord[];
	ignoredHighlights: IgnoredHighlight[];
}

interface ExistingSyncOptions {
	state: ExistingSyncState;
	commitState: () => Promise<void>;
}

export default class KindleLocalSyncPlugin extends Plugin {
	settings: KindleSyncSettings = migrateSettings(null);
	private hasSavedPluginData = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("book-open", "Sync local kindle highlights", () => {
			void this.syncHighlights();
		});

		this.addCommand({
			id: "sync-local-kindle-highlights",
			name: "Sync local kindle highlights",
			callback: () => {
				void this.syncHighlights();
			},
		});

		this.addCommand({
			id: "show-ignored-highlights",
			name: "Show ignored highlights",
			callback: () => new IgnoredHighlightsModal(this.app, this).open(),
		});

		this.addSettingTab(new KindleSettingTab(this.app, this));
	}

	onunload(): void {
	}

	async syncHighlights(): Promise<void> {
		let syncPhase = "detect";

		try {
			if (!this.hasSavedPluginData && await hasExistingHighlightNotes(this.app, this.settings.highlightsFolder)) {
				new ExistingNotesWithoutDataModal(this.app, this).open();
				return;
			}

			syncPhase = "read/parse";
			const highlights = await this.readDetectedHighlights();

			if (!highlights) {
				return;
			}

			const identityIndex = new CurrentClippingIdentityIndex(highlights);
			syncPhase = "render/group";
			const bookGroups = groupHighlightsByBook(highlights);

			if (!this.settings.hasCompletedFirstSync) {
				new FirstSyncPreviewModal(this.app, this, bookGroups, {
					onComplete: ({ importHighlights, ignoreHighlights, skippedThisSyncHighlights }) =>
						this.completeFirstSync(
							importHighlights,
							ignoreHighlights,
							skippedThisSyncHighlights,
							identityIndex
						),
				}).open();
				return;
			}

			await this.syncExistingHighlights(highlights, bookGroups, identityIndex);
		} catch (error) {
			console.error(`Kindle sync failed during ${syncPhase}.`, error);
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("Failed to sync My Clippings.txt. Check the file path, format, and target folder.");
		}
	}

	async loadSettings(): Promise<void> {
		const loadedData = (await this.loadData()) as Partial<KindleSyncSettings> | null | undefined;

		this.hasSavedPluginData = loadedData != null;
		this.settings = migrateSettings(loadedData ?? null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async completeFirstSync(
		importHighlights: KindleHighlight[],
		ignoreHighlights: KindleHighlight[],
		skippedThisSyncHighlights: SyncSummaryHighlightItem[],
		identityIndex: CurrentClippingIdentityIndex
	): Promise<SyncCompletionResult> {
		let importResult: HighlightImportResult;

		try {
			importResult = await this.importHighlights(
				importHighlights,
				identityIndex,
				false,
				importHighlights
			);
		} catch (error) {
			await this.preserveExplicitIgnoresAfterInvalidContract(error, ignoreHighlights, identityIndex);
			throw error;
		}

		const importedCount = countMatchingHighlights(importHighlights, importResult.safelyCompletedHighlights);

		this.addIgnoredHighlights(ignoreHighlights, identityIndex);
		this.settings.hasCompletedFirstSync = true;
		this.hasSavedPluginData = true;
		await this.saveSettings();
		const ignoreCleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks(
			ignoreHighlights.map(createCleanupTarget)
		);
		const protectedBooks = createProtectedBooksPresentation(
			importResult.protectedHighlights,
			importHighlights
		);

		new SyncSummaryModal(this.app, this, {
			classification: {
				newHighlights: importHighlights,
				duplicateHighlights: [],
				ignoredHighlights: ignoreHighlights,
				possibleReappearedHighlights: [],
			},
			automaticHighlights: importHighlights,
			importedCount,
			skippedThisSyncHighlights,
			identityIndex,
			protectedBooks,
			ignoreResults: createIgnoreResultsPresentation(
				[ignoreCleanupResult],
				ignoreHighlights.map(createSyncSummaryHighlightItem)
			),
		}).open();

		return {
			importedCount,
			ignoreCleanupResult,
			protectedSelectedHighlightCount: protectedBooks.selectedHighlightCount,
		};
	}

	async completeReviewedSync(
		importHighlights: KindleHighlight[],
		ignoreHighlights: KindleHighlight[],
		skippedThisSyncHighlights: SyncSummaryHighlightItem[],
		automaticHighlights: KindleHighlight[],
		classification: SyncClassification,
		identityIndex: CurrentClippingIdentityIndex
	): Promise<SyncCompletionResult> {
		const highlightsToWrite = combineHighlightsByIdentity(automaticHighlights, importHighlights);
		let importResult: HighlightImportResult;

		try {
			importResult = await this.importHighlights(
				highlightsToWrite,
				identityIndex,
				false,
				importHighlights
			);
		} catch (error) {
			await this.preserveExplicitIgnoresAfterInvalidContract(error, ignoreHighlights, identityIndex);
			throw error;
		}

		const importedCount = countMatchingHighlights(importHighlights, importResult.safelyCompletedHighlights);

		this.addIgnoredHighlights(ignoreHighlights, identityIndex);
		this.settings.hasCompletedFirstSync = true;
		this.hasSavedPluginData = true;
		await this.saveSettings();
		const ignoreCleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks(
			ignoreHighlights.map(createCleanupTarget)
		);
		const protectedBooks = createProtectedBooksPresentation(
			importResult.protectedHighlights,
			importHighlights
		);

		new SyncSummaryModal(this.app, this, {
			classification: {
				...classification,
				newHighlights: importHighlights,
				ignoredHighlights: [
					...classification.ignoredHighlights,
					...ignoreHighlights,
				],
			},
			automaticHighlights: highlightsToWrite,
			importedCount,
			skippedThisSyncHighlights,
			identityIndex,
			protectedBooks,
			ignoreResults: createIgnoreResultsPresentation(
				[ignoreCleanupResult],
				ignoreHighlights.map(createSyncSummaryHighlightItem)
			),
		}).open();

		return {
			importedCount,
			ignoreCleanupResult,
			protectedSelectedHighlightCount: protectedBooks.selectedHighlightCount,
		};
	}

	async continueExistingNotesWithoutDataSync(): Promise<void> {
		const highlights = await this.readDetectedHighlights();

		if (!highlights) {
			return;
		}

		const identityIndex = new CurrentClippingIdentityIndex(highlights);
		const bookGroups = groupHighlightsByBook(highlights);
		const trustedExistingHighlights = await this.findHighlightsAlreadyInVault(highlights, bookGroups);
		const stagedState: ExistingSyncState = {
			importedHighlights: appendImportedHighlightRecords([], trustedExistingHighlights, identityIndex),
			ignoredHighlights: [],
		};

		await this.syncExistingHighlights(highlights, bookGroups, identityIndex, {
			state: stagedState,
			commitState: async () => {
				this.settings.hasCompletedFirstSync = true;
				this.settings.importedHighlights = stagedState.importedHighlights;
				this.settings.ignoredHighlights = stagedState.ignoredHighlights;
				this.hasSavedPluginData = true;
				await this.saveSettings();
			},
		});
	}

	async reviewExistingNotesWithoutDataAsFirstSync(): Promise<void> {
		const highlights = await this.readDetectedHighlights();

		if (!highlights) {
			return;
		}

		this.settings.hasCompletedFirstSync = false;
		this.hasSavedPluginData = true;
		await this.saveSettings();
		new FirstSyncPreviewModal(this.app, this, groupHighlightsByBook(highlights), {
			title: "Review All Detected Highlights",
		}).open();
	}

	async importHighlights(
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex,
		persist = true,
		explicitHighlights: KindleHighlight[] = highlights
	): Promise<HighlightImportResult> {
		const bookGroups = groupHighlightsByBook(highlights);
		const writerResult: unknown = await writeBookNotesToVault(
			this.app.vault,
			this.settings.highlightsFolder,
			bookGroups
		);
		const {
			writeSummary,
			safelyCompletedHighlights,
			protectedHighlights,
		} = validateAndPartitionVaultWriteSummary(
			this.settings.highlightsFolder,
			highlights,
			writerResult
		);

		const safelyCompletedExplicitHighlights = explicitHighlights.filter((highlight) =>
			safelyCompletedHighlights.some((candidate) => hasSameHighlightIdentity(candidate, highlight))
		);

		// Automatic legacy trust must not backfill records; only a safely completed explicit Import persists authorship.
		if (safelyCompletedExplicitHighlights.length > 0) {
			this.addImportedHighlights(safelyCompletedExplicitHighlights, identityIndex);
		}

		if (persist) {
			await this.saveSettings();
		}

		return {
			writeSummary,
			safelyCompletedHighlights,
			protectedHighlights,
		};
	}

	async ignoreHighlights(
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): Promise<IgnoreOperationResult> {
		this.addIgnoredHighlights(highlights, identityIndex);
		await this.saveSettings();
		const cleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks(
			highlights.map(createCleanupTarget)
		);

		return {
			cleanupResult,
			outcomePresentation: createIgnoreResultsPresentation(
				[cleanupResult],
				highlights.map(createSyncSummaryHighlightItem)
			),
		};
	}

	async ignoreSummaryHighlight(
		highlight: SyncSummaryHighlightItem,
		identityIndex: CurrentClippingIdentityIndex
	): Promise<IgnoreOperationResult> {
		this.addIgnoredSummaryHighlights([highlight], identityIndex);
		await this.saveSettings();
		const cleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks([
			createSummaryCleanupTarget(highlight),
		]);

		return {
			cleanupResult,
			outcomePresentation: createIgnoreResultsPresentation([cleanupResult], [highlight]),
		};
	}

	async unignoreHighlight(highlight: IgnoredHighlight): Promise<void> {
		this.settings.ignoredHighlights = this.settings.ignoredHighlights.filter((candidate) => candidate !== highlight);
		await this.saveSettings();
	}

	private addImportedHighlights(
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): void {
		this.settings.importedHighlights = appendImportedHighlightRecords(
			this.settings.importedHighlights,
			highlights,
			identityIndex
		);
	}

	private async preserveExplicitIgnoresAfterInvalidContract(
		error: unknown,
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): Promise<void> {
		if (!(error instanceof InvalidVaultWriteContractError) || highlights.length === 0) {
			return;
		}

		// Import authorization failed, but the user's independent exact-book Ignore decision remains valid.
		const result = await this.ignoreHighlights(highlights, identityIndex);

		this.hasSavedPluginData = true;
		error.retainIgnoreCleanupResult(result.cleanupResult);
	}

	private addIgnoredHighlights(
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): void {
		const existingIdentities = createAuthoredStoredHighlightIdentityKeySet(
			this.settings.ignoredHighlights,
			identityIndex
		);
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			const id = createClippingId(highlight);
			const identity = createKindleHighlightIdentityKey(highlight);

			if (existingIdentities.has(identity)) {
				continue;
			}

			existingIdentities.add(identity);
			records.push({
				id,
				title: highlight.bookTitle,
				author: highlight.author,
				textPreview: createTextPreview(highlight),
				ignoredAt,
			});
		}

		this.settings.ignoredHighlights = [
			...this.settings.ignoredHighlights,
			...records,
		];
	}

	private addIgnoredSummaryHighlights(
		highlights: SyncSummaryHighlightItem[],
		identityIndex: CurrentClippingIdentityIndex
	): void {
		const existingIdentities = createAuthoredStoredHighlightIdentityKeySet(
			this.settings.ignoredHighlights,
			identityIndex
		);
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			const identity = createHighlightIdentityKey(highlight.title, highlight.author, highlight.id);

			if (existingIdentities.has(identity)) {
				continue;
			}

			existingIdentities.add(identity);
			records.push({
				id: highlight.id,
				title: highlight.title,
				author: highlight.author,
				textPreview: highlight.textPreview,
				ignoredAt,
				lang: highlight.lang,
			});
		}

		this.settings.ignoredHighlights = [
			...this.settings.ignoredHighlights,
			...records,
		];
	}

	private async cleanupIgnoredHighlightBlocks(
		targets: IgnoredHighlightCleanupTarget[]
	): Promise<IgnoredHighlightCleanupSummary> {
		return removeIgnoredHighlightBlocksFromExistingNotes(
			this.app.vault,
			this.settings.highlightsFolder,
			targets
		);
	}

	private async cleanupPersistedIgnoredHighlightBlocks(
		targets: IgnoredHighlightCleanupTarget[]
	): Promise<IgnoredHighlightCleanupSummary> {
		try {
			return await this.cleanupIgnoredHighlightBlocks(targets);
		} catch (error) {
			// The Ignore decision is already durable. An unexpected cleanup rejection must not hide its summary.
			console.error("Failed to confirm existing-note cleanup after saving Ignore choices.", error);
			return createUnconfirmedIgnoredHighlightCleanupSummary(targets);
		}
	}

	private async syncExistingHighlights(
		highlights: KindleHighlight[],
		bookGroups: KindleBookGroup[],
		identityIndex: CurrentClippingIdentityIndex,
		options?: ExistingSyncOptions
	): Promise<void> {
		const state = options?.state ?? this.settings;
		const classification = await classifyHighlightsForSync(highlights, {
			ignoredHighlights: state.ignoredHighlights,
			importedHighlights: state.importedHighlights,
			identityIndex,
			highlightExistsInNote: createVaultHighlightLookup(this.app.vault, this.settings.highlightsFolder, bookGroups),
		});
		const automaticHighlights = this.getReviewedHighlightsForAutomaticSync(
			highlights,
			classification,
			identityIndex,
			state
		);

		if (classification.newHighlights.length > 0) {
			await options?.commitState();
			new FirstSyncPreviewModal(this.app, this, groupHighlightsByBook(classification.newHighlights), {
				title: "Review New Highlights",
				completionNotice: (importedCount, protectedSelectedHighlightCount) =>
					`${protectedSelectedHighlightCount > 0 ? "Sync finished" : "Sync complete"}: ${importedCount} highlights imported.`,
				onComplete: async ({ importHighlights, ignoreHighlights, skippedThisSyncHighlights }) => {
					return this.completeReviewedSync(
						importHighlights,
						ignoreHighlights,
						skippedThisSyncHighlights,
						automaticHighlights,
						classification,
						identityIndex
					);
				},
			}).open();
			return;
		}

		const importResult = await this.importHighlights(
			automaticHighlights,
			identityIndex,
			options === undefined,
			[]
		);

		await options?.commitState();

		new SyncSummaryModal(this.app, this, {
			classification,
			automaticHighlights,
			importedCount: classification.newHighlights.length,
			identityIndex,
			protectedBooks: createProtectedBooksPresentation(
				importResult.protectedHighlights,
				[]
			),
		}).open();

		if (importResult.writeSummary.highlightsRendered === 0 && classification.possibleReappearedHighlights.length === 0) {
			new Notice("Kindle sync complete: no new highlights to import.");
		}
	}

	private async readDetectedHighlights(): Promise<KindleHighlight[] | null> {
		const clippingsPath = await detectClippingsPath(this.settings.clippingsPath);

		if (!clippingsPath) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("Could not find My Clippings.txt. Please set the path manually.");
			return null;
		}

		const rawText = await readClippingsFile(clippingsPath);
		const highlights = parseClippings(rawText);

		if (highlights.length === 0) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("No Kindle highlights or notes found to sync.");
			return null;
		}

		return highlights;
	}

	private async findHighlightsAlreadyInVault(
		highlights: KindleHighlight[],
		bookGroups: KindleBookGroup[]
	): Promise<KindleHighlight[]> {
		const highlightExistsInNote = createVaultHighlightLookup(this.app.vault, this.settings.highlightsFolder, bookGroups);
		const trustedHighlights: KindleHighlight[] = [];

		for (const highlight of highlights) {
			const id = createClippingId(highlight);

			try {
				if (await highlightExistsInNote(id, highlight)) {
					trustedHighlights.push(highlight);
				}
			} catch {
				// If an existing note cannot be safely matched, keep that clipping untrusted so the review gate handles it.
			}
		}

		return trustedHighlights;
	}

	private getReviewedHighlightsForAutomaticSync(
		highlights: KindleHighlight[],
		classification: SyncClassification,
		identityIndex: CurrentClippingIdentityIndex,
		state: ExistingSyncState = this.settings
	): KindleHighlight[] {
		const importedIdentities = createStoredHighlightIdentityKeySet(
			state.importedHighlights,
			identityIndex
		);
		const ignoredIdentities = createStoredHighlightIdentityKeySet(
			state.ignoredHighlights,
			identityIndex
		);
		const suspiciousIdentities = new Set(
			classification.possibleReappearedHighlights.map(createKindleHighlightIdentityKey)
		);

		return highlights.filter((highlight) => {
			const identity = createKindleHighlightIdentityKey(highlight);

			return importedIdentities.has(identity)
				&& !ignoredIdentities.has(identity)
				&& !suspiciousIdentities.has(identity);
		});
	}
}

class KindleSettingTab extends PluginSettingTab {
	plugin: KindleLocalSyncPlugin;

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName("Sync").setHeading();

		new Setting(containerEl)
			.setName("My clippings.txt path")
			.setDesc(
				"Input the absolute path to your kindle's text file. Examples: windows: E:\\documents\\My clippings.txt, macOS: /Volumes/Kindle/documents/My Clippings.txt, linux: /media/username/Kindle/documents/My Clippings.txt"
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.clippingsPath)
					.onChange(async (value) => {
						this.plugin.settings.clippingsPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Highlights folder")
			.setDesc("The folder where synced kindle highlights will be stored.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.highlightsFolder)
					.onChange(async (value) => {
						this.plugin.settings.highlightsFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strict local only")
			.setDesc("Keep all sync behavior local-only, with no external services or network requests.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.strictLocalOnly)
					.onChange(async (value) => {
						this.plugin.settings.strictLocalOnly = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

function createTextPreview(highlight: KindleHighlight): string {
	return highlight.content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function appendImportedHighlightRecords(
	existingRecords: ImportedHighlightRecord[],
	highlights: KindleHighlight[],
	identityIndex: CurrentClippingIdentityIndex
): ImportedHighlightRecord[] {
	const existingIdentities = createAuthoredStoredHighlightIdentityKeySet(
		existingRecords,
		identityIndex
	);
	const importedAt = new Date().toISOString();
	const records: ImportedHighlightRecord[] = [];

	for (const highlight of highlights) {
		const id = createClippingId(highlight);
		const identity = createKindleHighlightIdentityKey(highlight);

		if (existingIdentities.has(identity)) {
			continue;
		}

		existingIdentities.add(identity);
		records.push({
			id,
			title: highlight.bookTitle,
			author: highlight.author,
			textPreview: createTextPreview(highlight),
			importedAt,
		});
	}

	return records.length === 0
		? existingRecords
		: [...existingRecords, ...records];
}

function createCleanupTarget(highlight: KindleHighlight): IgnoredHighlightCleanupTarget {
	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		id: createClippingId(highlight),
	};
}

function createSummaryCleanupTarget(highlight: SyncSummaryHighlightItem): IgnoredHighlightCleanupTarget {
	return {
		bookTitle: highlight.title,
		author: highlight.author,
		id: highlight.id,
	};
}

function createUnconfirmedIgnoredHighlightCleanupSummary(
	targets: IgnoredHighlightCleanupTarget[]
): IgnoredHighlightCleanupSummary {
	const bookOutcomes: IgnoredHighlightCleanupSummary["bookOutcomes"] = [];
	const bookOutcomesByIdentity = new Map<string, IgnoredHighlightCleanupSummary["bookOutcomes"][number]>();
	const seenTargetIdentities = new Set<string>();

	for (const target of targets) {
		const targetIdentity = createHighlightIdentityKey(target.bookTitle, target.author, target.id);

		if (seenTargetIdentities.has(targetIdentity)) {
			continue;
		}

		seenTargetIdentities.add(targetIdentity);
		const bookIdentity = createBookIdentityKey(target.bookTitle, target.author);
		let bookOutcome = bookOutcomesByIdentity.get(bookIdentity);

		if (!bookOutcome) {
			bookOutcome = {
				bookTitle: target.bookTitle,
				author: target.author,
				targetOutcomes: [],
			};
			bookOutcomesByIdentity.set(bookIdentity, bookOutcome);
			bookOutcomes.push(bookOutcome);
		}

		bookOutcome.targetOutcomes.push({
			target,
			status: "cleanup-state-unknown",
			stage: "write",
		});
	}

	return {
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes,
	};
}

function combineHighlightsByIdentity(
	firstHighlights: KindleHighlight[],
	secondHighlights: KindleHighlight[]
): KindleHighlight[] {
	const combinedHighlights: KindleHighlight[] = [];

	for (const highlight of [...firstHighlights, ...secondHighlights]) {
		if (combinedHighlights.some((candidate) => hasSameHighlightIdentity(candidate, highlight))) {
			continue;
		}

		combinedHighlights.push(highlight);
	}

	return combinedHighlights;
}

function countMatchingHighlights(
	highlights: KindleHighlight[],
	matchingHighlights: KindleHighlight[]
): number {
	const uniqueHighlights: KindleHighlight[] = [];

	for (const highlight of highlights) {
		if (uniqueHighlights.some((candidate) => hasSameHighlightIdentity(candidate, highlight))) {
			continue;
		}

		uniqueHighlights.push(highlight);
	}

	return uniqueHighlights.filter((highlight) =>
		matchingHighlights.some((candidate) => hasSameHighlightIdentity(candidate, highlight))
	).length;
}
