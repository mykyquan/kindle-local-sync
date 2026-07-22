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
	createClippingIdentity,
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

export type SettingsPersistenceVerificationFailure =
	| "invalid-proposed-snapshot"
	| "read-failed"
	| "missing-readback"
	| "malformed-readback"
	| "mismatched-readback";

export class SettingsPersistenceVerificationError extends Error {
	constructor(
		readonly code: SettingsPersistenceVerificationFailure,
		readonly readError?: unknown
	) {
		super(`Kindle sync settings persistence could not be verified (${code}).`);
		this.name = "SettingsPersistenceVerificationError";
	}
}

export default class KindleLocalSyncPlugin extends Plugin {
	settings: KindleSyncSettings = migrateSettings(null);
	private hasSavedPluginData = false;
	private hasTrustedSyncState = false;
	private settingsMutationQueue: Promise<void> = Promise.resolve();

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
			if (!this.hasTrustedSyncState && await hasExistingHighlightNotes(this.app, this.settings.highlightsFolder)) {
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
			new Notice("Kindle sync wasn’t completed. Please try again.");
		}
	}

	async loadSettings(): Promise<void> {
		const loadedData = (await this.loadData()) as Partial<KindleSyncSettings> | null | undefined;

		this.hasSavedPluginData = loadedData != null;
		this.settings = migrateSettings(loadedData ?? null);
		this.hasTrustedSyncState = containsTrustedSyncState(this.settings);
	}

	async saveSettings(): Promise<void> {
		const requestedSettings = this.cloneSettingsSnapshot(this.settings);

		await this.persistSettingsMutation((currentSettings) => ({
			...this.cloneSettingsSnapshot(currentSettings),
			clippingsPath: requestedSettings.clippingsPath,
			highlightsFolder: requestedSettings.highlightsFolder,
			strictLocalOnly: requestedSettings.strictLocalOnly,
			skipIgnoredHighlights: requestedSettings.skipIgnoredHighlights,
		}));
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
		await this.persistSettingsMutation((currentSettings) =>
			this.createCompletedSyncSettingsSnapshot(
				currentSettings,
				importResult.safelyCompletedHighlights,
				importHighlights,
				ignoreHighlights,
				identityIndex
			)
		);
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
		await this.persistSettingsMutation((currentSettings) =>
			this.createCompletedSyncSettingsSnapshot(
				currentSettings,
				importResult.safelyCompletedHighlights,
				importHighlights,
				ignoreHighlights,
				identityIndex
			)
		);
		const ignoreCleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks(
			ignoreHighlights.map(createCleanupTarget)
		);
		const protectedBooks = createProtectedBooksPresentation(
			importResult.protectedHighlights,
			importHighlights,
			classification.identityConflictHighlights ?? []
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

	async continueExistingNotesWithoutDataSync(): Promise<boolean> {
		const highlights = await this.readDetectedHighlights();

		if (!highlights) {
			return false;
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
				await this.persistSettingsMutation((currentSettings) => ({
					...this.cloneSettingsSnapshot(currentSettings),
					hasCompletedFirstSync: true,
					importedHighlights: stagedState.importedHighlights.map((record) => ({ ...record })),
					ignoredHighlights: stagedState.ignoredHighlights.map((record) => ({ ...record })),
				}));
			},
		});

		return true;
	}

	async reviewExistingNotesWithoutDataAsFirstSync(): Promise<void> {
		const highlights = await this.readDetectedHighlights();

		if (!highlights) {
			return;
		}

		await this.persistSettingsMutation((currentSettings) => ({
			...this.cloneSettingsSnapshot(currentSettings),
			hasCompletedFirstSync: false,
		}));
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
			bookGroups,
			identityIndex
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

		if (persist) {
			// A confirmed physical write may lazily append a strong record without rewriting legacy history.
			await this.persistSettingsMutation((currentSettings) =>
				this.createImportedSettingsSnapshot(
					currentSettings,
					safelyCompletedHighlights,
					identityIndex
				)
			);
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
		await this.persistSettingsMutation((currentSettings) =>
			this.createIgnoredSettingsSnapshot(currentSettings, highlights, identityIndex)
		);
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
		await this.persistSettingsMutation((currentSettings) =>
			this.createIgnoredSummarySettingsSnapshot(currentSettings, [highlight], identityIndex)
		);
		const cleanupResult = await this.cleanupPersistedIgnoredHighlightBlocks([
			createSummaryCleanupTarget(highlight, identityIndex),
		]);

		return {
			cleanupResult,
			outcomePresentation: createIgnoreResultsPresentation([cleanupResult], [highlight]),
		};
	}

	async unignoreHighlight(highlight: IgnoredHighlight): Promise<void> {
		await this.persistSettingsMutation((currentSettings) =>
			this.createUnignoredSettingsSnapshot(currentSettings, highlight)
		);
	}

	private createCompletedSyncSettingsSnapshot(
		settings: KindleSyncSettings,
		safelyCompletedHighlights: KindleHighlight[],
		explicitImportHighlights: KindleHighlight[],
		ignoreHighlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): KindleSyncSettings {
		const importedSettings = this.createImportedSettingsSnapshot(
			settings,
			safelyCompletedHighlights,
			identityIndex
		);

		return {
			...this.createIgnoredSettingsSnapshot(importedSettings, ignoreHighlights, identityIndex),
			hasCompletedFirstSync: true,
		};
	}

	private createImportedSettingsSnapshot(
		settings: KindleSyncSettings,
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): KindleSyncSettings {
		const snapshot = this.cloneSettingsSnapshot(settings);

		return {
			...snapshot,
			importedHighlights: appendImportedHighlightRecords(
				snapshot.importedHighlights,
				highlights,
				identityIndex
			),
		};
	}

	private createIgnoredSettingsSnapshot(
		settings: KindleSyncSettings,
		highlights: KindleHighlight[],
		identityIndex: CurrentClippingIdentityIndex
	): KindleSyncSettings {
		const snapshot = this.cloneSettingsSnapshot(settings);
		const existingIdentities = createAuthoredStoredHighlightIdentityKeySet(
			snapshot.ignoredHighlights,
			identityIndex
		);
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			const clippingIdentity = createClippingIdentity(highlight);
			const identity = createKindleHighlightIdentityKey(highlight);

			if (existingIdentities.has(identity)) {
				continue;
			}

			existingIdentities.add(identity);
			records.push({
				id: clippingIdentity.id,
				legacyId: clippingIdentity.legacyId,
				identityVersion: clippingIdentity.identityVersion,
				title: highlight.bookTitle,
				author: highlight.author,
				textPreview: createTextPreview(highlight),
				ignoredAt,
			});
		}

		return {
			...snapshot,
			ignoredHighlights: [
				...snapshot.ignoredHighlights,
				...records,
			],
		};
	}

	private cloneSettingsSnapshot(settings: KindleSyncSettings): KindleSyncSettings {
		return {
			...settings,
			importedHighlights: settings.importedHighlights.map((record) => ({ ...record })),
			ignoredHighlights: settings.ignoredHighlights.map((record) => ({ ...record })),
		};
	}

	private async persistSettingsMutation(
		createProposedSettings: (currentSettings: KindleSyncSettings) => KindleSyncSettings
	): Promise<KindleSyncSettings> {
		const operation = this.settingsMutationQueue.then(async () => {
			const proposedSettings = normalizeProposedSettings(
				createProposedSettings(this.settings)
			);

			await this.saveData(proposedSettings);

			let persistedData: unknown;

			try {
				persistedData = await this.loadData();
			} catch (error) {
				throw new SettingsPersistenceVerificationError("read-failed", error);
			}

			const persistedSettings = normalizePersistedSettingsReadback(persistedData);

			if (canonicalizeJson(persistedSettings) !== canonicalizeJson(proposedSettings)) {
				throw new SettingsPersistenceVerificationError("mismatched-readback");
			}

			// Live trust changes only after a fresh durable read confirms the complete proposed snapshot.
			this.settings = proposedSettings;
			this.hasSavedPluginData = true;
			this.hasTrustedSyncState = containsTrustedSyncState(proposedSettings);
			return proposedSettings;
		});

		this.settingsMutationQueue = operation.then(() => undefined, () => undefined);
		return operation;
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

		error.retainIgnoreCleanupResult(result.cleanupResult);
	}

	private createIgnoredSummarySettingsSnapshot(
		settings: KindleSyncSettings,
		highlights: SyncSummaryHighlightItem[],
		identityIndex: CurrentClippingIdentityIndex
	): KindleSyncSettings {
		const snapshot = this.cloneSettingsSnapshot(settings);
		const existingIdentities = createAuthoredStoredHighlightIdentityKeySet(
			snapshot.ignoredHighlights,
			identityIndex
		);
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			const identity = createHighlightIdentityKey(highlight.title, highlight.author, highlight.id);
			const identityMetadata = identityIndex.getStrongIdentityMetadata(
				highlight.title,
				highlight.author,
				highlight.id
			);

			if (!identityMetadata) {
				throw new Error("Cannot persist an Ignore choice without a verified strong clipping identity.");
			}

			if (existingIdentities.has(identity)) {
				continue;
			}

			existingIdentities.add(identity);
			records.push({
				id: highlight.id,
				legacyId: identityMetadata.legacyId,
				identityVersion: identityMetadata.identityVersion,
				title: highlight.title,
				author: highlight.author,
				textPreview: highlight.textPreview,
				ignoredAt,
				lang: highlight.lang,
			});
		}

		return {
			...snapshot,
			ignoredHighlights: [
				...snapshot.ignoredHighlights,
				...records,
			],
		};
	}

	private createUnignoredSettingsSnapshot(
		settings: KindleSyncSettings,
		highlight: IgnoredHighlight
	): KindleSyncSettings {
		const snapshot = this.cloneSettingsSnapshot(settings);
		let removed = false;

		return {
			...snapshot,
			ignoredHighlights: snapshot.ignoredHighlights.filter((candidate) => {
				if (!removed && haveSameIgnoredRecord(candidate, highlight)) {
					removed = true;
					return false;
				}

				return true;
			}),
		};
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
				[],
				classification.identityConflictHighlights ?? []
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
		const identityConflictIdentities = new Set(
			(classification.identityConflictHighlights ?? []).map(createKindleHighlightIdentityKey)
		);

		return highlights.filter((highlight) => {
			const identity = createKindleHighlightIdentityKey(highlight);

			return importedIdentities.has(identity)
				&& !ignoredIdentities.has(identity)
				&& !suspiciousIdentities.has(identity)
				&& !identityConflictIdentities.has(identity);
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
		const clippingIdentity = createClippingIdentity(highlight);
		const identity = createKindleHighlightIdentityKey(highlight);

		if (existingIdentities.has(identity)) {
			continue;
		}

		existingIdentities.add(identity);
		records.push({
			id: clippingIdentity.id,
			legacyId: clippingIdentity.legacyId,
			identityVersion: clippingIdentity.identityVersion,
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
	const identity = createClippingIdentity(highlight);

	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		id: identity.id,
		legacyId: identity.legacyId,
	};
}


function createSummaryCleanupTarget(
	highlight: SyncSummaryHighlightItem,
	identityIndex: CurrentClippingIdentityIndex
): IgnoredHighlightCleanupTarget {
	const identityMetadata = identityIndex.getStrongIdentityMetadata(
		highlight.title,
		highlight.author,
		highlight.id
	);

	if (!identityMetadata) {
		throw new Error("Cannot clean up a note without a verified strong clipping identity.");
	}

	return {
		bookTitle: highlight.title,
		author: highlight.author,
		id: highlight.id,
		legacyId: identityMetadata.legacyId,
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

function containsTrustedSyncState(settings: KindleSyncSettings): boolean {
	// A verified config-only file can restore the custom path without proving prior sync decisions.
	return settings.hasCompletedFirstSync
		|| settings.importedHighlights.length > 0
		|| settings.ignoredHighlights.length > 0;
}

function normalizeProposedSettings(settings: unknown): KindleSyncSettings {
	let normalizedSettings: unknown;

	try {
		normalizedSettings = normalizeJsonRoundTrip(settings);
	} catch (error) {
		throw new SettingsPersistenceVerificationError("invalid-proposed-snapshot", error);
	}

	if (!isKindleSyncSettings(normalizedSettings)) {
		throw new SettingsPersistenceVerificationError("invalid-proposed-snapshot");
	}

	return normalizedSettings;
}

function normalizePersistedSettingsReadback(data: unknown): KindleSyncSettings {
	if (data == null) {
		throw new SettingsPersistenceVerificationError("missing-readback");
	}

	let normalizedSettings: unknown;

	try {
		normalizedSettings = normalizeJsonRoundTrip(data);
	} catch (error) {
		throw new SettingsPersistenceVerificationError("malformed-readback", error);
	}

	if (!isKindleSyncSettings(normalizedSettings)) {
		throw new SettingsPersistenceVerificationError("malformed-readback");
	}

	return normalizedSettings;
}

function normalizeJsonRoundTrip(value: unknown): unknown {
	const serialized = JSON.stringify(value);

	if (serialized === undefined) {
		throw new TypeError("Settings cannot be represented as JSON.");
	}

	return JSON.parse(serialized) as unknown;
}

function canonicalizeJson(value: unknown): string {
	return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}

	if (!isRecord(value)) {
		return value;
	}

	const sorted: Record<string, unknown> = {};

	for (const key of Object.keys(value).sort()) {
		sorted[key] = sortJsonValue(value[key]);
	}

	return sorted;
}

function isKindleSyncSettings(value: unknown): value is KindleSyncSettings {
	return isRecord(value)
		&& typeof value.clippingsPath === "string"
		&& typeof value.highlightsFolder === "string"
		&& typeof value.strictLocalOnly === "boolean"
		&& typeof value.skipIgnoredHighlights === "boolean"
		&& typeof value.hasCompletedFirstSync === "boolean"
		&& Array.isArray(value.importedHighlights)
		&& value.importedHighlights.every(isImportedHighlightRecord)
		&& Array.isArray(value.ignoredHighlights)
		&& value.ignoredHighlights.every(isIgnoredHighlightRecord);
}

function isImportedHighlightRecord(value: unknown): value is ImportedHighlightRecord {
	return isStoredHighlightRecord(value)
		&& typeof value.importedAt === "string";
}

function isIgnoredHighlightRecord(value: unknown): value is IgnoredHighlight {
	return isStoredHighlightRecord(value)
		&& typeof value.ignoredAt === "string"
		&& isOptionalString(value.lang);
}

function isStoredHighlightRecord(value: unknown): value is Record<string, unknown> & {
	id: string;
	title: string;
	author?: string;
	textPreview: string;
} {
	return isRecord(value)
		&& typeof value.id === "string"
		&& isOptionalString(value.legacyId)
		&& (value.identityVersion === undefined || value.identityVersion === 2)
		&& typeof value.title === "string"
		&& isOptionalString(value.author)
		&& typeof value.textPreview === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function haveSameIgnoredRecord(first: IgnoredHighlight, second: IgnoredHighlight): boolean {
	try {
		return canonicalizeJson(normalizeJsonRoundTrip(first))
			=== canonicalizeJson(normalizeJsonRoundTrip(second));
	} catch {
		return false;
	}
}
