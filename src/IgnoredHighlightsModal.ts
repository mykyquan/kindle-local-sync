import { App, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { IgnoredHighlight } from "./settings";
import { createStoredBookIdentityKey } from "./sync/HighlightIdentity";
import {
	createReviewActionButton,
	createReviewHighlightsButton,
} from "./ui/ReviewActionButton";
import { renderReviewBookMetadata } from "./ui/ReviewBookMetadata";
import { renderReviewHighlightDetail, renderReviewHighlightRow } from "./ui/ReviewHighlightDetail";

export class IgnoredHighlightsModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private ignoredHighlightsScrollTop = 0;
	private ignoredBookScrollTopByTitle = new Map<string, number>();

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.contentEl.addClass("kls-glass-scope");
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

		for (const [bookIdentity, highlights] of groupIgnoredHighlightsByBook(this.plugin.settings.ignoredHighlights)) {
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			const header = section.createDiv();
			header.addClass("kls-book-header");
			const headingContent = header.createDiv();

			headingContent.addClass("kls-book-heading-content");
			renderReviewBookMetadata(headingContent, {
				titles: highlights.map((highlight) => highlight.title),
				author: highlights[0]?.author,
			});
			createReviewHighlightsButton(header)
				.onClick(() => {
					this.saveIgnoredHighlightsScrollPosition();
					this.renderIgnoredBookHighlights(bookIdentity);
				});

			section.createEl("p", {
				text: `${highlights.length} ignored ${pluralize("highlight", highlights.length)}`,
			}).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			createReviewActionButton(actions, "Remove All From Ignore List")
				.onClick(async () => {
					this.saveIgnoredHighlightsScrollPosition();
					await this.unignoreHighlights(highlights);
					this.renderIgnoredHighlights();
				});
		}

		this.restoreScrollPosition(this.ignoredHighlightsScrollTop);
	}

	private renderIgnoredBookHighlights(bookIdentity: string): void {
		this.contentEl.empty();
		const bookHighlights = this.plugin.settings.ignoredHighlights
			.filter((highlight) => createStoredBookIdentityKey(highlight) === bookIdentity);
		const bookTitle = getIgnoredTitle(bookHighlights[0]);
		const detail = renderReviewHighlightDetail(this.contentEl, {
			titles: bookHighlights.length > 0
				? bookHighlights.map((highlight) => highlight.title)
				: [bookTitle],
			author: bookHighlights[0]?.author,
			countText: `${bookHighlights.length} ignored ${pluralize("highlight", bookHighlights.length)}`,
			backAccessibleLabel: "Back to Ignored Highlights",
			onBack: () => {
				this.saveIgnoredBookScrollPosition(bookIdentity);
				this.renderIgnoredHighlights();
			},
		});

		if (bookHighlights.length === 0) {
			detail.detailEl.createEl("p", { text: "No ignored highlights left in this book." }).addClass("kls-empty-state");
			this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookIdentity) ?? 0);
			return;
		}

		for (const highlight of bookHighlights) {
			const { actionsEl: actions } = renderReviewHighlightRow(
				detail.highlightsEl,
				highlight.textPreview,
				`Ignored ${new Date(highlight.ignoredAt).toLocaleDateString()}`
			);
			createReviewActionButton(actions, "Remove From Ignore List")
				.onClick(async () => {
					this.saveIgnoredBookScrollPosition(bookIdentity);
					await this.plugin.unignoreHighlight(highlight);
					this.renderIgnoredBookHighlights(bookIdentity);
				});
		}

		this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookIdentity) ?? 0);
	}

	private async unignoreHighlights(highlights: IgnoredHighlight[]): Promise<void> {
		for (const highlight of [...highlights]) {
			await this.plugin.unignoreHighlight(highlight);
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

}

function getIgnoredTitle(highlight: IgnoredHighlight | undefined): string {
	return highlight?.title || "Untitled Kindle Book";
}

function groupIgnoredHighlightsByBook(highlights: IgnoredHighlight[]): Map<string, IgnoredHighlight[]> {
	const groups = new Map<string, IgnoredHighlight[]>();

	for (const highlight of highlights) {
		const bookIdentity = createStoredBookIdentityKey(highlight);
		const group = groups.get(bookIdentity) ?? [];

		group.push(highlight);
		groups.set(bookIdentity, group);
	}

	return groups;
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}
