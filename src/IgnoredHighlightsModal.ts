import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { IgnoredHighlight } from "./settings";

export class IgnoredHighlightsModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private ignoredHighlightsScrollTop = 0;
	private ignoredBookScrollTopByTitle = new Map<string, number>();

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.renderIgnoredHighlights();
	}

	private renderIgnoredHighlights(): void {
		this.contentEl.empty();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Ignored Highlights" });

		if (this.plugin.settings.ignoredHighlights.length === 0) {
			this.contentEl.createEl("p", {
				text: "No ignored highlights. Highlights you ignore during sync will appear here.",
			});
			this.restoreScrollPosition(this.ignoredHighlightsScrollTop);
			return;
		}

		const bookListEl = this.contentEl.createDiv();
		bookListEl.addClass("kls-book-list");

		for (const [title, highlights] of groupIgnoredHighlightsByTitle(this.plugin.settings.ignoredHighlights)) {
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			const header = section.createDiv();
			header.addClass("kls-book-header");

			const titleEl = header.createEl("h3", { text: title });
			titleEl.addClass("kls-book-title");

			this.createActionButton(header, "Review Highlights")
				.onClick(() => {
					this.saveIgnoredHighlightsScrollPosition();
					this.renderIgnoredBookHighlights(title);
				});

			section.createEl("p", {
				text: `${highlights.length} ignored ${pluralize("highlight", highlights.length)}`,
			}).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createActionButton(actions, "Remove All From Ignore List")
				.onClick(async () => {
					this.saveIgnoredHighlightsScrollPosition();
					await this.unignoreHighlights(highlights);
					this.renderIgnoredHighlights();
				});
		}

		this.restoreScrollPosition(this.ignoredHighlightsScrollTop);
	}

	private renderIgnoredBookHighlights(bookTitle: string): void {
		this.contentEl.empty();

		const header = this.contentEl.createDiv();
		header.addClass("kls-ignored-detail-header");

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		const modalTitle = header.createEl("h2", { text: "Ignored Highlights" });
		modalTitle.addClass("kls-ignored-detail-title");

		const backActions = header.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-ignored-detail-actions");
		this.createActionButton(backActions, "Back to Ignored Highlights")
			.onClick(() => {
				this.saveIgnoredBookScrollPosition(bookTitle);
				this.renderIgnoredHighlights();
			});

		const bookHighlights = this.plugin.settings.ignoredHighlights
			.filter((highlight) => getIgnoredTitle(highlight) === bookTitle);

		const detailCard = this.contentEl.createDiv();
		detailCard.addClass("kls-book-section");
		detailCard.addClass("kls-book-card");
		detailCard.addClass("kls-ignored-detail-card");

		const titleEl = detailCard.createEl("h3", { text: bookTitle });
		titleEl.addClass("kls-book-title");

		if (bookHighlights.length === 0) {
			detailCard.createEl("p", { text: "No ignored highlights left in this book." }).addClass("kls-empty-state");
			this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookTitle) ?? 0);
			return;
		}

		detailCard.createEl("p", {
			text: `${bookHighlights.length} ignored ${pluralize("highlight", bookHighlights.length)}`,
		}).addClass("kls-book-review-summary");

		const highlightsEl = detailCard.createDiv();
		highlightsEl.addClass("kls-ignored-highlight-list");

		for (const highlight of bookHighlights) {
			const row = highlightsEl.createDiv();
			row.addClass("kls-ignored-highlight-item");
			row.createEl("p", { text: `Ignored ${new Date(highlight.ignoredAt).toLocaleDateString()}` })
				.addClass("kls-book-meta");
			row.createEl("p", { text: highlight.textPreview })
				.addClass("kls-ignored-highlight-text");

			const actions = row.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");
			this.createActionButton(actions, "Remove From Ignore List")
				.onClick(async () => {
					this.saveIgnoredBookScrollPosition(bookTitle);
					await this.plugin.unignoreHighlight(highlight.id);
					this.renderIgnoredBookHighlights(bookTitle);
				});
		}

		this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookTitle) ?? 0);
	}

	private async unignoreHighlights(highlights: IgnoredHighlight[]): Promise<void> {
		for (const highlight of [...highlights]) {
			await this.plugin.unignoreHighlight(highlight.id);
		}
	}

	private saveIgnoredHighlightsScrollPosition(): void {
		this.ignoredHighlightsScrollTop = this.contentEl.scrollTop;
	}

	private saveIgnoredBookScrollPosition(bookTitle: string): void {
		this.ignoredBookScrollTopByTitle.set(bookTitle, this.contentEl.scrollTop);
	}

	private restoreScrollPosition(scrollTop: number): void {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => {
				this.contentEl.scrollTop = scrollTop;
			});
			return;
		}

		this.contentEl.scrollTop = scrollTop;
	}

	private createActionButton(containerEl: HTMLElement, text: string): ButtonComponent {
		const button = new ButtonComponent(containerEl).setButtonText(text);

		button.buttonEl.addClass("kls-action-button");
		return button;
	}
}

function getIgnoredTitle(highlight: IgnoredHighlight): string {
	return highlight.title || "Untitled Kindle Book";
}

function groupIgnoredHighlightsByTitle(highlights: IgnoredHighlight[]): Map<string, IgnoredHighlight[]> {
	const groups = new Map<string, IgnoredHighlight[]>();

	for (const highlight of highlights) {
		const title = getIgnoredTitle(highlight);
		const group = groups.get(title) ?? [];

		group.push(highlight);
		groups.set(title, group);
	}

	return groups;
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}
