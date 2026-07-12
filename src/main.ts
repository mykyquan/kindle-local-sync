import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { ExistingNotesWithoutDataModal } from "./ExistingNotesWithoutDataModal";
import { FirstSyncPreviewModal } from "./FirstSyncPreviewModal";
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
import { removeIgnoredHighlightBlocksFromExistingNotes } from "./sync/IgnoredHighlightCleanup";
import { classifyHighlightsForSync, SyncClassification } from "./sync/SyncClassifier";
import { createVaultHighlightLookup } from "./sync/VaultHighlightLookup";
import { writeBookNotesToVault } from "./sync/VaultWriter";
import { SyncSummaryModal } from "./SyncSummaryModal";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

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

			syncPhase = "render/group";
			const bookGroups = groupHighlightsByBook(highlights);

			if (!this.settings.hasCompletedFirstSync) {
				new FirstSyncPreviewModal(this.app, this, bookGroups).open();
				return;
			}

			await this.syncExistingHighlights(highlights, bookGroups);
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
		skippedThisSyncHighlights: SyncSummaryHighlightItem[] = []
	): Promise<void> {
		await this.importHighlights(importHighlights, false);
		this.addIgnoredHighlights(ignoreHighlights);
		this.settings.hasCompletedFirstSync = true;
		this.hasSavedPluginData = true;
		await this.saveSettings();
		await this.cleanupIgnoredHighlightBlocks(ignoreHighlights.map(createClippingId));

		new SyncSummaryModal(this.app, this, {
			classification: {
				newHighlights: importHighlights,
				duplicateHighlights: [],
				ignoredHighlights: ignoreHighlights,
				possibleReappearedHighlights: [],
			},
			automaticHighlights: importHighlights,
			importedCount: importHighlights.length,
			skippedThisSyncHighlights,
		}).open();
	}

	async completeReviewedSync(
		importHighlights: KindleHighlight[],
		ignoreHighlights: KindleHighlight[],
		skippedThisSyncHighlights: SyncSummaryHighlightItem[],
		automaticHighlights: KindleHighlight[],
		classification: SyncClassification
	): Promise<void> {
		const highlightsToWrite = combineHighlightsById(automaticHighlights, importHighlights);
		await this.importHighlights(highlightsToWrite, false);
		this.addIgnoredHighlights(ignoreHighlights);
		this.settings.hasCompletedFirstSync = true;
		this.hasSavedPluginData = true;
		await this.saveSettings();
		await this.cleanupIgnoredHighlightBlocks(ignoreHighlights.map(createClippingId));

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
			importedCount: importHighlights.length,
			skippedThisSyncHighlights,
		}).open();
	}

	async continueExistingNotesWithoutDataSync(): Promise<void> {
		const highlights = await this.readDetectedHighlights();

		if (!highlights) {
			return;
		}

		const bookGroups = groupHighlightsByBook(highlights);
		const trustedExistingHighlights = await this.findHighlightsAlreadyInVault(highlights, bookGroups);

		this.settings.hasCompletedFirstSync = true;
		this.settings.importedHighlights = [];
		this.settings.ignoredHighlights = [];
		this.addImportedHighlights(trustedExistingHighlights);
		this.hasSavedPluginData = true;
		await this.saveSettings();
		await this.syncExistingHighlights(highlights, bookGroups);
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

	async importHighlights(highlights: KindleHighlight[], persist = true): Promise<Awaited<ReturnType<typeof writeBookNotesToVault>>> {
		const bookGroups = groupHighlightsByBook(highlights);
		const summary = await writeBookNotesToVault(this.app.vault, this.settings.highlightsFolder, bookGroups);

		this.addImportedHighlights(highlights);

		if (persist) {
			await this.saveSettings();
		}

		return summary;
	}

	async ignoreHighlights(highlights: KindleHighlight[]): Promise<void> {
		this.addIgnoredHighlights(highlights);
		await this.saveSettings();
		await this.cleanupIgnoredHighlightBlocks(highlights.map(createClippingId));
	}

	async ignoreSummaryHighlight(highlight: SyncSummaryHighlightItem): Promise<void> {
		this.addIgnoredSummaryHighlights([highlight]);
		await this.saveSettings();
		await this.cleanupIgnoredHighlightBlocks([highlight.id]);
	}

	async unignoreHighlight(id: string): Promise<void> {
		this.settings.ignoredHighlights = this.settings.ignoredHighlights.filter((highlight) => highlight.id !== id);
		await this.saveSettings();
	}

	private addImportedHighlights(highlights: KindleHighlight[]): void {
		const existingIds = new Set(this.settings.importedHighlights.map((highlight) => highlight.id));
		const importedAt = new Date().toISOString();
		const records: ImportedHighlightRecord[] = [];

		for (const highlight of highlights) {
			const id = createClippingId(highlight);

			if (existingIds.has(id)) {
				continue;
			}

			existingIds.add(id);
			records.push({
				id,
				title: highlight.bookTitle,
				textPreview: createTextPreview(highlight),
				importedAt,
			});
		}

		this.settings.importedHighlights = [
			...this.settings.importedHighlights,
			...records,
		];
	}

	private addIgnoredHighlights(highlights: KindleHighlight[]): void {
		const existingIds = new Set(this.settings.ignoredHighlights.map((highlight) => highlight.id));
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			const id = createClippingId(highlight);

			if (existingIds.has(id)) {
				continue;
			}

			existingIds.add(id);
			records.push({
				id,
				title: highlight.bookTitle,
				textPreview: createTextPreview(highlight),
				ignoredAt,
			});
		}

		this.settings.ignoredHighlights = [
			...this.settings.ignoredHighlights,
			...records,
		];
	}

	private addIgnoredSummaryHighlights(highlights: SyncSummaryHighlightItem[]): void {
		const existingIds = new Set(this.settings.ignoredHighlights.map((highlight) => highlight.id));
		const ignoredAt = new Date().toISOString();
		const records: IgnoredHighlight[] = [];

		for (const highlight of highlights) {
			if (existingIds.has(highlight.id)) {
				continue;
			}

			existingIds.add(highlight.id);
			records.push({
				id: highlight.id,
				title: highlight.title,
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

	private async cleanupIgnoredHighlightBlocks(ignoredHighlightIds: string[]): Promise<void> {
		try {
			await removeIgnoredHighlightBlocksFromExistingNotes(
				this.app.vault,
				this.settings.highlightsFolder,
				ignoredHighlightIds
			);
		} catch (error) {
			console.error("Failed to remove ignored highlights from existing Kindle notes.", error);
		}
	}

	private async syncExistingHighlights(
		highlights: KindleHighlight[],
		bookGroups: KindleBookGroup[]
	): Promise<void> {
		const classification = await classifyHighlightsForSync(highlights, {
			ignoredHighlights: this.settings.ignoredHighlights,
			importedHighlights: this.settings.importedHighlights,
			highlightExistsInNote: createVaultHighlightLookup(this.app.vault, this.settings.highlightsFolder, bookGroups),
		});
		const automaticHighlights = this.getReviewedHighlightsForAutomaticSync(highlights, classification);

		if (classification.newHighlights.length > 0) {
			new FirstSyncPreviewModal(this.app, this, groupHighlightsByBook(classification.newHighlights), {
				title: "Review New Highlights",
				completionNotice: (importedCount) => `Sync complete: ${importedCount} highlights imported.`,
				onComplete: async ({ importHighlights, ignoreHighlights, skippedThisSyncHighlights }) => {
					await this.completeReviewedSync(
						importHighlights,
						ignoreHighlights,
						skippedThisSyncHighlights,
						automaticHighlights,
						classification
					);
				},
			}).open();
			return;
		}

		const summary = await this.importHighlights(automaticHighlights);

		new SyncSummaryModal(this.app, this, {
			classification,
			automaticHighlights,
			importedCount: classification.newHighlights.length,
		}).open();

		if (summary.highlightsRendered === 0 && classification.possibleReappearedHighlights.length === 0) {
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
		classification: SyncClassification
	): KindleHighlight[] {
		const importedIds = new Set(this.settings.importedHighlights.map((highlight) => highlight.id));
		const ignoredIds = new Set(this.settings.ignoredHighlights.map((highlight) => highlight.id));
		const suspiciousIds = new Set(classification.possibleReappearedHighlights.map(createClippingId));

		return highlights.filter((highlight) => {
			const id = createClippingId(highlight);

			return importedIds.has(id) && !ignoredIds.has(id) && !suspiciousIds.has(id);
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

function combineHighlightsById(
	firstHighlights: KindleHighlight[],
	secondHighlights: KindleHighlight[]
): KindleHighlight[] {
	const seenIds = new Set<string>();
	const combinedHighlights: KindleHighlight[] = [];

	for (const highlight of [...firstHighlights, ...secondHighlights]) {
		const id = createClippingId(highlight);

		if (seenIds.has(id)) {
			continue;
		}

		seenIds.add(id);
		combinedHighlights.push(highlight);
	}

	return combinedHighlights;
}
