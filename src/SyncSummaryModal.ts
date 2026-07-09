/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { IgnoredHighlight } from "./settings";
import { SyncClassification } from "./sync/SyncClassifier";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";

export interface SyncSummaryModalOptions {
	classification: SyncClassification;
	automaticHighlights: KindleHighlight[];
	importedCount: number;
	skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
}

export class SyncSummaryModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly automaticHighlights: KindleHighlight[];
	private importedCount: number;
	private suspiciousHighlights: KindleHighlight[];
	private skippedThisSyncHighlights: SyncSummaryHighlightItem[];
	private summaryScrollTop = 0;
	private ignoredHighlightsScrollTop = 0;
	private skippedBooksScrollTop = 0;
	private skippedBookScrollTopByTitle = new Map<string, number>();
	private skippedBookSectionEls = new Map<string, HTMLElement>();
	private skippedBooksReturnAnchorKey: string | null = null;
	private shouldRestoreSkippedBooksAnchor = false;

	constructor(app: App, plugin: KindleLocalSyncPlugin, options: SyncSummaryModalOptions) {
		super(app);
		this.plugin = plugin;
		this.automaticHighlights = options.automaticHighlights;
		this.importedCount = options.importedCount;
		this.suspiciousHighlights = [...options.classification.possibleReappearedHighlights];
		this.skippedThisSyncHighlights = options.skippedThisSyncHighlights ?? [];
		this.classification = options.classification;
	}

	private readonly classification: SyncClassification;

	onOpen(): void {
		this.renderSummary();
	}

	private renderSummary(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Sync complete" });
		this.contentEl.createEl("p", { text: `${this.importedCount} new highlights imported` });
		this.contentEl.createEl("p", {
			text: `${this.classification.ignoredHighlights.length} ignored highlights skipped`,
		});
		this.contentEl.createEl("p", {
			text: `${this.classification.duplicateHighlights.length} duplicates skipped`,
		});
		this.contentEl.createEl("p", {
			text: `${this.suspiciousHighlights.length} possible reappeared highlights need review`,
		});

		const actions = this.contentEl.createDiv();
		actions.addClass("kls-button-row");
		actions.addClass("kls-summary-actions");

		if (this.suspiciousHighlights.length > 0) {
			this.createActionButton(actions, "Review Suspicious Items")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderSuspiciousItems();
				});
		}

		if (this.classification.ignoredHighlights.length > 0) {
			this.createActionButton(actions, "View Ignored Highlights")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderIgnoredHighlights();
				});
		}

		if (this.skippedThisSyncHighlights.length > 0) {
			this.createActionButton(actions, "Review Skipped This Sync")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.clearSkippedBooksReturnAnchor();
					this.renderSkippedBooks();
			});
		}

		this.createActionButton(actions, "Close")
			.onClick(() => this.close());

		this.restoreScrollPosition(this.summaryScrollTop);
	}

	private createActionButton(containerEl: HTMLElement, text: string): ButtonComponent {
		const button = new ButtonComponent(containerEl).setButtonText(text);

		button.buttonEl.addClass("kls-action-button");
		return button;
	}

	private renderSuspiciousItems(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Possible reappeared highlights" });

		new ButtonComponent(this.contentEl)
			.setButtonText("Back To Summary")
			.onClick(() => this.renderSummary());

		for (const highlight of this.suspiciousHighlights) {
			const row = this.contentEl.createDiv();
			row.createEl("p", { text: createHighlightPreview(highlight) });

			const actions = row.createDiv();

			new ButtonComponent(actions)
				.setButtonText("Import Again")
				.onClick(async () => {
					const sameBookHighlights = this.automaticHighlights.filter((candidate) => isSameBook(candidate, highlight));
					await this.plugin.importHighlights([...sameBookHighlights, highlight]);
					this.importedCount++;
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				});

			new ButtonComponent(actions)
				.setButtonText("Ignore Forever")
				.onClick(async () => {
					await this.plugin.ignoreHighlights([highlight]);
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				})
				.buttonEl.addClass("mod-warning");

			new ButtonComponent(actions)
				.setButtonText("Skip This Time")
				.onClick(() => {
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				});
		}

		if (this.suspiciousHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No suspicious highlights left to review." });
		}
	}

	private removeSuspiciousHighlight(highlight: KindleHighlight): void {
		this.suspiciousHighlights = this.suspiciousHighlights.filter((candidate) => candidate !== highlight);
	}

	private renderIgnoredHighlights(): void {
		this.contentEl.empty();
		new ButtonComponent(this.contentEl)
			.setButtonText("Back To Summary")
			.onClick(() => {
				this.saveIgnoredHighlightsScrollPosition();
				this.renderSummary();
			});
		this.contentEl.createEl("h2", { text: "Ignored highlights" });

		if (this.plugin.settings.ignoredHighlights.length === 0) {
			this.contentEl.createEl("p", {
				text: "No ignored highlights. Highlights you ignore during sync will appear here.",
			});
			this.restoreScrollPosition(this.ignoredHighlightsScrollTop);
			return;
		}

		for (const [title, highlights] of groupIgnoredHighlightsByTitle(this.plugin.settings.ignoredHighlights)) {
			this.contentEl.createEl("h3", { text: title });

			for (const highlight of highlights) {
				const row = this.contentEl.createDiv();
				row.createEl("p", { text: highlight.textPreview });
				row.createEl("p", { text: `Ignored ${new Date(highlight.ignoredAt).toLocaleDateString()}` });

				new ButtonComponent(row)
					.setButtonText("Remove From Ignore List")
					.onClick(async () => {
						this.saveIgnoredHighlightsScrollPosition();
						await this.plugin.unignoreHighlight(highlight.id);
						this.renderIgnoredHighlights();
					});
			}
		}

		this.restoreScrollPosition(this.ignoredHighlightsScrollTop);
	}

	private renderSkippedBooks(): void {
		this.contentEl.empty();
		this.skippedBookSectionEls.clear();
		this.contentEl.createEl("h2", { text: "Skipped this sync" });
		this.contentEl.createEl("p", {
			text: "These highlights were skipped only for this sync. They may appear again next time unless ignored.",
		});

		new ButtonComponent(this.contentEl)
			.setButtonText("Back To Summary")
			.onClick(() => {
				this.saveSkippedBooksScrollPosition();
				this.renderSummary();
			});

		if (this.skippedThisSyncHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No skipped highlights left to review." });
			this.restoreSkippedBooksPosition();
			return;
		}

		for (const [title, highlights] of groupSummaryHighlightsByTitle(this.skippedThisSyncHighlights)) {
			const bookKey = createSkippedBookAnchorKey(title);
			const section = this.contentEl.createDiv();

			this.skippedBookSectionEls.set(bookKey, section);
			section.createEl("h3", { text: title });
			section.createEl("p", { text: `${highlights.length} highlights skipped this sync` });

			new ButtonComponent(section)
				.setButtonText("Review Highlights")
				.onClick(() => {
					this.saveSkippedBooksScrollPosition();
					this.skippedBooksReturnAnchorKey = bookKey;
					this.renderSkippedBookHighlights(title);
				});

			new ButtonComponent(section)
				.setButtonText("Ignore All Highlights")
				.onClick(async () => {
					this.saveSkippedBooksScrollPosition();
					for (const highlight of highlights) {
						await this.plugin.ignoreSummaryHighlight(highlight);
					}

					const ignoredIds = new Set(highlights.map((highlight) => highlight.id));
					this.skippedThisSyncHighlights = this.skippedThisSyncHighlights.filter((highlight) => !ignoredIds.has(highlight.id));
					this.renderSkippedBooks();
				});
		}

		this.restoreSkippedBooksPosition();
	}

	private renderSkippedBookHighlights(bookTitle: string): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: bookTitle });

		new ButtonComponent(this.contentEl)
			.setButtonText("Back To Skipped Books")
			.onClick(() => {
				this.saveSkippedBookScrollPosition(bookTitle);
				this.shouldRestoreSkippedBooksAnchor = true;
				this.renderSkippedBooks();
			});

		const highlights = this.skippedThisSyncHighlights.filter((highlight) => getSummaryTitle(highlight) === bookTitle);

		if (highlights.length === 0) {
			this.contentEl.createEl("p", { text: "No skipped highlights left in this book." });
			this.restoreScrollPosition(this.skippedBookScrollTopByTitle.get(bookTitle) ?? 0);
			return;
		}

		for (const highlight of highlights) {
			const row = this.contentEl.createDiv();
			row.createEl("p", { text: highlight.textPreview });

			if (highlight.location) {
				row.createEl("p", { text: `Location ${highlight.location}` });
			}

			new ButtonComponent(row)
				.setButtonText("Ignore Going Forward")
				.onClick(async () => {
					this.saveSkippedBookScrollPosition(bookTitle);
					await this.plugin.ignoreSummaryHighlight(highlight);
					this.skippedThisSyncHighlights = this.skippedThisSyncHighlights.filter((candidate) => candidate.id !== highlight.id);
					this.renderSkippedBookHighlights(bookTitle);
				});
		}

		this.restoreScrollPosition(this.skippedBookScrollTopByTitle.get(bookTitle) ?? 0);
	}

	private saveSummaryScrollPosition(): void {
		this.summaryScrollTop = this.contentEl.scrollTop;
	}

	private saveIgnoredHighlightsScrollPosition(): void {
		this.ignoredHighlightsScrollTop = this.contentEl.scrollTop;
	}

	private saveSkippedBooksScrollPosition(): void {
		this.skippedBooksScrollTop = this.contentEl.scrollTop;
	}

	private saveSkippedBookScrollPosition(bookTitle: string): void {
		this.skippedBookScrollTopByTitle.set(bookTitle, this.contentEl.scrollTop);
	}

	private clearSkippedBooksReturnAnchor(): void {
		this.skippedBooksReturnAnchorKey = null;
		this.shouldRestoreSkippedBooksAnchor = false;
	}

	private restoreSkippedBooksPosition(): void {
		const anchorKey = this.shouldRestoreSkippedBooksAnchor ? this.skippedBooksReturnAnchorKey : null;

		this.shouldRestoreSkippedBooksAnchor = false;

		if (!anchorKey) {
			this.restoreScrollPosition(this.skippedBooksScrollTop);
			return;
		}

		this.afterRender(() => {
			const section = this.skippedBookSectionEls.get(anchorKey);

			if (section && typeof section.scrollIntoView === "function") {
				section.scrollIntoView({ block: "center" });
				return;
			}

			this.contentEl.scrollTop = this.skippedBooksScrollTop;
		});
	}

	private restoreScrollPosition(scrollTop: number): void {
		this.afterRender(() => {
			this.contentEl.scrollTop = scrollTop;
		});
	}

	private afterRender(callback: () => void): void {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(callback);
			return;
		}

		callback();
	}
}

function isSameBook(left: KindleHighlight, right: KindleHighlight): boolean {
	return left.bookTitle === right.bookTitle && left.author === right.author;
}

function createHighlightPreview(highlight: KindleHighlight): string {
	const location = highlight.location ? `Location ${highlight.location}: ` : "";

	return `${highlight.bookTitle}\n${location}${highlight.content.replace(/\s+/g, " ").slice(0, 180)}`;
}

function groupIgnoredHighlightsByTitle(highlights: IgnoredHighlight[]): Map<string, IgnoredHighlight[]> {
	const groups = new Map<string, IgnoredHighlight[]>();

	for (const highlight of highlights) {
		const title = highlight.title || "Untitled Kindle Book";
		const group = groups.get(title) ?? [];

		group.push(highlight);
		groups.set(title, group);
	}

	return groups;
}

function groupSummaryHighlightsByTitle(highlights: SyncSummaryHighlightItem[]): Map<string, SyncSummaryHighlightItem[]> {
	const groups = new Map<string, SyncSummaryHighlightItem[]>();

	for (const highlight of highlights) {
		const title = getSummaryTitle(highlight);
		const group = groups.get(title) ?? [];

		group.push(highlight);
		groups.set(title, group);
	}

	return groups;
}

function getSummaryTitle(highlight: SyncSummaryHighlightItem): string {
	return highlight.title || "Untitled Kindle Book";
}

function createSkippedBookAnchorKey(bookTitle: string): string {
	return bookTitle;
}
