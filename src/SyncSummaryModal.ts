import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { IgnoredHighlight } from "./settings";
import { SyncClassification } from "./sync/SyncClassifier";
import { SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import {
	createEmptyIgnoreResultsPresentation,
	IgnoreResultPresentationStatus,
	IgnoreResultsPresentation,
	mergeIgnoreResultsPresentations,
	ProtectedBooksPresentation,
} from "./SyncOutcomePresentation";
import {
	createBookIdentityKey,
	createHighlightIdentityKey,
	createStoredBookIdentityKey,
	CurrentClippingIdentityIndex,
	hasSameBookIdentity,
	hasSameHighlightIdentity,
} from "./sync/HighlightIdentity";

export interface SyncSummaryModalOptions {
	classification: SyncClassification;
	automaticHighlights: KindleHighlight[];
	importedCount: number;
	skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
	identityIndex: CurrentClippingIdentityIndex;
	protectedBooks?: ProtectedBooksPresentation;
	ignoreResults?: IgnoreResultsPresentation;
}

type SummaryButtonTreatment = "native" | "subtle" | "strong";

export class SyncSummaryModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly automaticHighlights: KindleHighlight[];
	private readonly identityIndex: CurrentClippingIdentityIndex;
	private readonly protectedBooks: ProtectedBooksPresentation;
	private ignoreResults: IgnoreResultsPresentation;
	private importedCount: number;
	private suspiciousHighlights: KindleHighlight[];
	private readonly protectedSuspiciousHighlights = new Set<KindleHighlight>();
	private skippedThisSyncHighlights: SyncSummaryHighlightItem[];
	private summaryScrollTop = 0;
	private suspiciousItemsScrollTop = 0;
	private protectedBooksScrollTop = 0;
	private ignoreResultsScrollTop = 0;
	private ignoredHighlightsScrollTop = 0;
	private ignoredBookScrollTopByTitle = new Map<string, number>();
	private skippedBooksScrollTop = 0;
	private skippedBookScrollTopByTitle = new Map<string, number>();
	private skippedBookSectionEls = new Map<string, HTMLElement>();
	private skippedBooksReturnAnchorKey: string | null = null;
	private shouldRestoreSkippedBooksAnchor = false;

	constructor(app: App, plugin: KindleLocalSyncPlugin, options: SyncSummaryModalOptions) {
		super(app);
		this.plugin = plugin;
		this.automaticHighlights = options.automaticHighlights;
		this.identityIndex = options.identityIndex;
		this.protectedBooks = options.protectedBooks ?? {
			bookCount: 0,
			affectedHighlightCount: 0,
			selectedHighlightCount: 0,
			books: [],
		};
		this.ignoreResults = options.ignoreResults ?? createEmptyIgnoreResultsPresentation();
		this.importedCount = options.importedCount;
		this.suspiciousHighlights = [...options.classification.possibleReappearedHighlights];
		this.skippedThisSyncHighlights = options.skippedThisSyncHighlights ?? [];
		this.classification = options.classification;
	}

	private readonly classification: SyncClassification;

	onOpen(): void {
		this.contentEl.addClass("kls-glass-scope");
		this.renderSummary();
	}

	private renderSummary(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", {
			text: this.hasCurrentProtectedWork() ? "Sync finished" : "Sync complete",
		});
		this.contentEl.createEl("p", { text: `${this.importedCount} new highlights imported` });
		this.contentEl.createEl("p", {
			text: `${this.classification.ignoredHighlights.length} ignored highlights skipped`,
		});
		this.contentEl.createEl("p", {
			text: `${this.classification.duplicateHighlights.length} duplicates skipped`,
		});
		this.contentEl.createEl("p", {
			text: `Missing managed highlights to review: ${this.suspiciousHighlights.length}`,
		});
		this.contentEl.createEl("p", {
			text: "Unreviewed or skipped highlights will appear again next time you sync.",
		});

		if (this.protectedBooks.bookCount > 0) {
			this.renderProtectedBooksPanel();
		}

		if (this.ignoreResults.highlightCount > 0) {
			this.renderIgnoreResultsPanel();
		}

		const actions = this.contentEl.createDiv();
		actions.addClass("kls-button-row");
		actions.addClass("kls-summary-actions");

		if (this.suspiciousHighlights.length > 0) {
			this.createActionButton(actions, "Review Missing Managed Highlights", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderSuspiciousItems();
				});
		}

		if (this.protectedBooks.bookCount > 0) {
			this.createActionButton(actions, "View Books Left Unchanged", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderProtectedBooks();
				});
		}

		if (this.ignoreResults.highlightCount > 0) {
			this.createActionButton(actions, "Review Ignore Results", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderIgnoreResults();
				});
		}

		if (this.classification.ignoredHighlights.length > 0) {
			this.createActionButton(actions, "View Ignored Highlights", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderIgnoredHighlights();
				});
		}

		if (this.skippedThisSyncHighlights.length > 0) {
			this.createActionButton(actions, "Review Skipped This Sync", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.clearSkippedBooksReturnAnchor();
					this.renderSkippedBooks();
				});
		}

		this.createActionButton(actions, "Close", "subtle")
			.onClick(() => this.close());

		this.restoreScrollPosition(this.summaryScrollTop);
	}

	private renderProtectedBooksPanel(): void {
		const panel = this.contentEl.createDiv();

		panel.addClass("kls-outcome-panel");
		panel.createEl("h3", { text: "Some books were left unchanged" });
		panel.createEl("p", {
			text: formatExistingBookNotesLeftUnchanged(this.protectedBooks.bookCount),
		});

		if (this.protectedBooks.selectedHighlightCount > 0) {
			panel.createEl("p", {
				text: formatSelectedHighlightsReturning(this.protectedBooks.selectedHighlightCount),
			});
		} else {
			panel.createEl("p", { text: "Their existing imported history was kept." });
		}
	}

	private renderIgnoreResultsPanel(): void {
		const panel = this.contentEl.createDiv();

		panel.addClass("kls-outcome-panel");
		panel.createEl("h3", { text: "Ignore results" });
		panel.createEl("p", {
			text: formatHighlightsIgnoredInFuture(this.ignoreResults.highlightCount),
		});

		if (this.ignoreResults.noMatchingNoteCount > 0) {
			panel.createEl("p", {
				text: "Your ignore choices were saved for future syncs. No existing-note change was made for highlights without a matching note.",
			});
		} else if (this.ignoreResults.failedCount > 0 || this.ignoreResults.unconfirmedCount > 0) {
			panel.createEl("p", {
				text: "Your ignore choices were saved for future syncs. Some existing-note results could not be confirmed.",
			});
		} else if (this.ignoreResults.nonRemovalCount > 0) {
			panel.createEl("p", {
				text: "Your ignore choices were saved for future syncs. Some existing notes were left unchanged.",
			});
		}

		if (this.ignoreResults.noMatchingNoteCount > 0) {
			panel.createEl("p", {
				text: formatNoMatchingNoteResults(this.ignoreResults.noMatchingNoteCount),
			});
		}

		if (this.ignoreResults.alreadyAbsentCount > 0) {
			panel.createEl("p", {
				text: formatAlreadyAbsentResults(this.ignoreResults.alreadyAbsentCount),
			});
		}

		if (this.ignoreResults.unchangedCount > 0) {
			panel.createEl("p", {
				text: formatUnchangedResults(this.ignoreResults.unchangedCount),
			});
		}

		if (this.ignoreResults.failedCount > 0) {
			panel.createEl("p", {
				text: formatFailedCleanupResults(this.ignoreResults.failedCount),
			});
		}

		if (this.ignoreResults.unconfirmedCount > 0) {
			panel.createEl("p", {
				text: formatUnconfirmedCleanupResults(this.ignoreResults.unconfirmedCount),
			});
		}

		if (this.ignoreResults.removedCount > 0) {
			panel.createEl("p", {
				text: formatHighlightsRemoved(this.ignoreResults.removedCount),
			});
		}
	}

	private renderProtectedBooks(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Books left unchanged" });
		this.renderOutcomeDetailActions(() => {
			this.protectedBooksScrollTop = this.contentEl.scrollTop;
			this.renderSummary();
		});

		const bookList = this.contentEl.createDiv();

		bookList.addClass("kls-book-list");
		for (const book of this.protectedBooks.books) {
			const card = bookList.createDiv();

			card.addClass("kls-book-section");
			card.addClass("kls-book-card");
			card.createEl("h3", { text: book.title }).addClass("kls-book-title");
			card.createEl("p", { text: formatAuthor(book.author) }).addClass("kls-book-meta");
			card.createEl("p", {
				text: formatAffectedHighlights(book.affectedHighlightCount),
			}).addClass("kls-book-review-summary");
			if (book.selectedHighlightCount > 0) {
				card.createEl("p", {
					text: formatSelectedHighlightsReturningForBook(book.selectedHighlightCount),
				}).addClass("kls-book-review-summary");
			} else {
				card.createEl("p", {
					text: "Existing imported history was kept for this book.",
				}).addClass("kls-book-review-summary");
			}
		}

		this.restoreScrollPosition(this.protectedBooksScrollTop);
	}

	private renderIgnoreResults(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Ignore results" });
		this.renderOutcomeDetailActions(() => {
			this.ignoreResultsScrollTop = this.contentEl.scrollTop;
			this.renderSummary();
		});

		const resultList = this.contentEl.createDiv();

		resultList.addClass("kls-book-list");
		for (const item of this.ignoreResults.items) {
			const card = resultList.createDiv();

			card.addClass("kls-book-section");
			card.addClass("kls-book-card");
			card.createEl("h3", { text: item.bookTitle }).addClass("kls-book-title");
			card.createEl("p", { text: formatAuthor(item.author) }).addClass("kls-book-meta");
			if (item.highlightPreview) {
				card.createEl("p", { text: item.highlightPreview }).addClass("kls-ignored-highlight-text");
			}
			card.createEl("p", {
				text: getIgnoreResultCopy(item.status),
			}).addClass("kls-book-review-summary");
		}

		this.restoreScrollPosition(this.ignoreResultsScrollTop);
	}

	private renderOutcomeDetailActions(onBack: () => void): void {
		const actions = this.contentEl.createDiv();

		actions.addClass("kls-button-row");
		actions.addClass("kls-summary-actions");
		this.createActionButton(actions, "Back", "subtle").onClick(onBack);
		this.createActionButton(actions, "Close", "subtle").onClick(() => this.close());
	}

	private createActionButton(
		containerEl: HTMLElement,
		text: string,
		treatment: SummaryButtonTreatment = "native"
	): ButtonComponent {
		const button = new ButtonComponent(containerEl).setButtonText(text);

		button.buttonEl.addClass("kls-action-button");
		if (treatment !== "native") {
			button.buttonEl.addClass(`kls-glass-${treatment}`);
		}

		return button;
	}

	private renderSuspiciousItems(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Missing managed highlights" });
		this.contentEl.createEl("p", {
			text: "These highlights were previously imported, but their generated marker was not found in your notes. Review them before importing again, ignoring, or skipping.",
		});
		this.contentEl.createEl("p", {
			text: "This can happen if a generated note or sync block was deleted, moved, or edited.",
		});

		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		this.createActionButton(backActions, "Back to Summary", "subtle")
			.onClick(() => this.renderSummary());

		for (const highlight of this.suspiciousHighlights) {
			const row = this.contentEl.createDiv();
			row.addClass("kls-highlight-row");
			row.createEl("p", { text: createHighlightPreview(highlight) });

			if (this.protectedSuspiciousHighlights.has(highlight)) {
				const feedback = row.createEl("p", {
					text: "This note was left unchanged. This highlight is still available to try again.",
				});

				feedback.addClass("kls-inline-status");
				feedback.setAttribute("role", "status");
				feedback.setAttribute("aria-live", "polite");
			}

			const actions = row.createDiv();
			actions.addClass("kls-button-row");

			this.createActionButton(actions, "Import Again", "subtle")
				.onClick(async () => {
					const sameBookHighlights = this.automaticHighlights.filter((candidate) =>
						hasSameBookIdentity(candidate, highlight)
					);
					const result = await this.plugin.importHighlights(
						[...sameBookHighlights, highlight],
						this.identityIndex,
						true,
						[highlight]
					);
					const targetCompleted = result.safelyCompletedHighlights.some((candidate) =>
						hasSameHighlightIdentity(candidate, highlight)
					);

					// Keep protected recovery items visible and retryable instead of implying success.
					if (!targetCompleted) {
						this.suspiciousItemsScrollTop = this.contentEl.scrollTop;
						this.protectedSuspiciousHighlights.add(highlight);
						this.renderSuspiciousItems();
						return;
					}

					this.importedCount++;
					this.protectedSuspiciousHighlights.delete(highlight);
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				});

			this.createActionButton(actions, "Ignore Going Forward")
				.onClick(async () => {
					const result = await this.plugin.ignoreHighlights([highlight], this.identityIndex);

					this.ignoreResults = mergeIgnoreResultsPresentations(
						this.ignoreResults,
						result.outcomePresentation
					);
					this.protectedSuspiciousHighlights.delete(highlight);
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				})
				.buttonEl.addClass("mod-warning");

			this.createActionButton(actions, "Skip This Time")
				.onClick(() => {
					this.protectedSuspiciousHighlights.delete(highlight);
					this.removeSuspiciousHighlight(highlight);
					this.renderSuspiciousItems();
				});
		}

		if (this.suspiciousHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No missing managed highlights left to review." });
		}

		this.restoreScrollPosition(this.suspiciousItemsScrollTop);
	}

	private removeSuspiciousHighlight(highlight: KindleHighlight): void {
		this.suspiciousHighlights = this.suspiciousHighlights.filter((candidate) => candidate !== highlight);
	}

	private hasCurrentProtectedWork(): boolean {
		return this.protectedBooks.bookCount > 0 || this.protectedSuspiciousHighlights.size > 0;
	}

	private renderIgnoredHighlights(): void {
		this.contentEl.empty();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Ignored Highlights" });
		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		this.createActionButton(backActions, "Back to Summary", "subtle")
			.onClick(() => {
				this.saveIgnoredHighlightsScrollPosition();
				this.renderSummary();
			});

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
			const title = getIgnoredTitle(highlights[0]);
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			const header = section.createDiv();
			header.addClass("kls-book-header");

			const titleEl = header.createEl("h3", { text: title });
			titleEl.addClass("kls-book-title");

			this.createActionButton(header, "Review Highlights", "subtle")
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

			this.createActionButton(actions, "Remove All From Ignore List")
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
		const header = this.contentEl.createDiv();
		header.addClass("kls-ignored-detail-header");

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		const modalTitle = header.createEl("h2", { text: "Ignored Highlights" });
		modalTitle.addClass("kls-ignored-detail-title");

		const backActions = header.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-ignored-detail-actions");
		this.createActionButton(backActions, "Back to Ignored Highlights", "subtle")
			.onClick(() => {
				this.saveIgnoredBookScrollPosition(bookIdentity);
				this.renderIgnoredHighlights();
			});

		const bookHighlights = this.plugin.settings.ignoredHighlights
			.filter((highlight) => createStoredBookIdentityKey(highlight) === bookIdentity);
		const bookTitle = getIgnoredTitle(bookHighlights[0]);

		const detailCard = this.contentEl.createDiv();
		detailCard.addClass("kls-book-section");
		detailCard.addClass("kls-book-card");
		detailCard.addClass("kls-ignored-detail-card");

		const titleEl = detailCard.createEl("h3", { text: bookTitle });
		titleEl.addClass("kls-book-title");

		if (bookHighlights.length === 0) {
			detailCard.createEl("p", { text: "No ignored highlights left in this book." }).addClass("kls-empty-state");
			this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookIdentity) ?? 0);
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
					this.saveIgnoredBookScrollPosition(bookIdentity);
					await this.plugin.unignoreHighlight(highlight);
					this.renderIgnoredBookHighlights(bookIdentity);
				});
		}

		this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookIdentity) ?? 0);
	}

	private renderSkippedBooks(): void {
		this.contentEl.empty();
		this.skippedBookSectionEls.clear();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Skipped This Sync" });
		this.contentEl.createEl("p", {
			text: "These highlights were skipped only for this sync. They may appear again next time unless ignored.",
		});

		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		this.createActionButton(backActions, "Back to Summary", "subtle")
			.onClick(() => {
				this.saveSkippedBooksScrollPosition();
				this.renderSummary();
			});

		if (this.skippedThisSyncHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No skipped highlights left to review." });
			this.restoreSkippedBooksPosition();
			return;
		}

		const bookListEl = this.contentEl.createDiv();
		bookListEl.addClass("kls-book-list");

		for (const [bookIdentity, highlights] of groupSummaryHighlightsByBook(this.skippedThisSyncHighlights)) {
			const title = getSummaryTitle(highlights[0]);
			const bookKey = createSkippedBookAnchorKey(bookIdentity);
			const section = bookListEl.createDiv();

			this.skippedBookSectionEls.set(bookKey, section);
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");
			const header = section.createDiv();
			header.addClass("kls-book-header");

			const titleEl = header.createEl("h3", { text: title });
			titleEl.addClass("kls-book-title");

			this.createActionButton(header, "Review Highlights", "subtle")
				.onClick(() => {
					this.saveSkippedBooksScrollPosition();
					this.skippedBooksReturnAnchorKey = bookKey;
					this.renderSkippedBookHighlights(bookIdentity);
				});

			section.createEl("p", {
				text: `${highlights.length} ${pluralize("highlight", highlights.length)} skipped this sync`,
			}).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createActionButton(actions, "Ignore All Highlights")
				.onClick(() => {
					this.saveSkippedBooksScrollPosition();
					this.renderIgnoreAllSkippedHighlightsConfirmation(highlights);
				});
		}

		this.restoreSkippedBooksPosition();
	}

	private renderIgnoreAllSkippedHighlightsConfirmation(highlights: SyncSummaryHighlightItem[]): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Ignore all skipped highlights from this book?" });
		this.contentEl.createEl("p", {
			text: "These highlights will be ignored in future syncs. You can restore them later from the ignored highlights view.",
		});

		const actions = this.contentEl.createDiv();
		actions.addClass("kls-button-row");
		actions.addClass("kls-summary-actions");

		this.createActionButton(actions, "Cancel", "subtle")
			.onClick(() => this.renderSkippedBooks());

		this.createActionButton(actions, "Ignore All Highlights")
			.onClick(async () => {
				await this.ignoreSkippedHighlights(highlights);
				this.renderSkippedBooks();
			})
			.buttonEl.addClass("mod-warning");
	}

	private renderSkippedBookHighlights(bookIdentity: string): void {
		this.contentEl.empty();
		const highlights = this.skippedThisSyncHighlights.filter((highlight) =>
			createBookIdentityKey(highlight.title, highlight.author) === bookIdentity
		);
		const bookTitle = getSummaryTitle(highlights[0]);

		this.contentEl.createEl("h2", { text: bookTitle });

		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		this.createActionButton(backActions, "Back to Skipped Books", "subtle")
			.onClick(() => {
				this.saveSkippedBookScrollPosition(bookIdentity);
				this.shouldRestoreSkippedBooksAnchor = true;
				this.renderSkippedBooks();
			});

		if (highlights.length === 0) {
			this.contentEl.createEl("p", { text: "No skipped highlights left in this book." });
			this.restoreScrollPosition(this.skippedBookScrollTopByTitle.get(bookIdentity) ?? 0);
			return;
		}

		for (const highlight of highlights) {
			const row = this.contentEl.createDiv();
			row.addClass("kls-highlight-row");
			row.createEl("p", { text: highlight.textPreview });

			if (highlight.location) {
				row.createEl("p", { text: `Location ${highlight.location}` });
			}

			const actions = row.createDiv();
			actions.addClass("kls-button-row");
			this.createActionButton(actions, "Ignore Going Forward")
				.onClick(async () => {
					this.saveSkippedBookScrollPosition(bookIdentity);
					const result = await this.plugin.ignoreSummaryHighlight(highlight, this.identityIndex);

					this.ignoreResults = mergeIgnoreResultsPresentations(
						this.ignoreResults,
						result.outcomePresentation
					);
					const identity = createHighlightIdentityKey(highlight.title, highlight.author, highlight.id);

					this.skippedThisSyncHighlights = this.skippedThisSyncHighlights.filter((candidate) =>
						createHighlightIdentityKey(candidate.title, candidate.author, candidate.id) !== identity
					);
					this.renderSkippedBookHighlights(bookIdentity);
				});
		}

		this.restoreScrollPosition(this.skippedBookScrollTopByTitle.get(bookIdentity) ?? 0);
	}

	private async ignoreSkippedHighlights(highlights: SyncSummaryHighlightItem[]): Promise<void> {
		for (const highlight of highlights) {
			const result = await this.plugin.ignoreSummaryHighlight(highlight, this.identityIndex);

			this.ignoreResults = mergeIgnoreResultsPresentations(
				this.ignoreResults,
				result.outcomePresentation
			);
		}

		const ignoredIdentities = new Set(highlights.map((highlight) =>
			createHighlightIdentityKey(highlight.title, highlight.author, highlight.id)
		));
		this.skippedThisSyncHighlights = this.skippedThisSyncHighlights.filter((highlight) =>
			!ignoredIdentities.has(createHighlightIdentityKey(highlight.title, highlight.author, highlight.id))
		);
	}

	private async unignoreHighlights(highlights: IgnoredHighlight[]): Promise<void> {
		for (const highlight of [...highlights]) {
			await this.plugin.unignoreHighlight(highlight);
		}
	}

	private saveSummaryScrollPosition(): void {
		this.summaryScrollTop = this.contentEl.scrollTop;
	}

	private saveIgnoredHighlightsScrollPosition(): void {
		this.ignoredHighlightsScrollTop = this.contentEl.scrollTop;
	}

	private saveIgnoredBookScrollPosition(bookTitle: string): void {
		this.ignoredBookScrollTopByTitle.set(bookTitle, this.contentEl.scrollTop);
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

function createHighlightPreview(highlight: KindleHighlight): string {
	const location = highlight.location ? `Location ${highlight.location}: ` : "";

	return `${highlight.bookTitle}\n${location}${highlight.content.replace(/\s+/g, " ").slice(0, 180)}`;
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

function getIgnoredTitle(highlight: IgnoredHighlight | undefined): string {
	return highlight?.title || "Untitled Kindle Book";
}

function groupSummaryHighlightsByBook(highlights: SyncSummaryHighlightItem[]): Map<string, SyncSummaryHighlightItem[]> {
	const groups = new Map<string, SyncSummaryHighlightItem[]>();

	for (const highlight of highlights) {
		const bookIdentity = createBookIdentityKey(highlight.title, highlight.author);
		const group = groups.get(bookIdentity) ?? [];

		group.push(highlight);
		groups.set(bookIdentity, group);
	}

	return groups;
}

function getSummaryTitle(highlight: SyncSummaryHighlightItem | undefined): string {
	return highlight?.title || "Untitled Kindle Book";
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}

function createSkippedBookAnchorKey(bookIdentity: string): string {
	return bookIdentity;
}

function formatExistingBookNotesLeftUnchanged(count: number): string {
	return count === 1
		? "1 existing book note was left unchanged because it could not be updated safely."
		: `${count} existing book notes were left unchanged because they could not be updated safely.`;
}

function formatSelectedHighlightsReturning(count: number): string {
	return count === 1
		? "1 selected highlight was not imported and will be available for review next time."
		: `${count} selected highlights were not imported and will be available for review next time.`;
}

function formatHighlightsIgnoredInFuture(count: number): string {
	return count === 1
		? "1 highlight will be ignored in future syncs."
		: `${count} highlights will be ignored in future syncs.`;
}

function formatHighlightsRemoved(count: number): string {
	return count === 1
		? "1 highlight was removed from an existing note."
		: `${count} highlights were removed from existing notes.`;
}

function formatNoMatchingNoteResults(count: number): string {
	return count === 1
		? "No matching note was found for 1 highlight."
		: `No matching notes were found for ${count} highlights.`;
}

function formatAlreadyAbsentResults(count: number): string {
	return count === 1
		? "1 highlight was already absent from its matching note."
		: `${count} highlights were already absent from their matching notes.`;
}

function formatUnchangedResults(count: number): string {
	return count === 1
		? "An existing note was left unchanged for 1 highlight."
		: `Existing notes were left unchanged for ${count} highlights.`;
}

function formatFailedCleanupResults(count: number): string {
	return count === 1
		? "The existing-note update could not be completed for 1 highlight."
		: `Existing-note updates could not be completed for ${count} highlights.`;
}

function formatUnconfirmedCleanupResults(count: number): string {
	return count === 1
		? "The final note state could not be confirmed for 1 highlight."
		: `The final note state could not be confirmed for ${count} highlights.`;
}

function formatAuthor(author: string): string {
	return `Author: ${author || "Unknown author"}`;
}

function formatAffectedHighlights(count: number): string {
	return count === 1 ? "1 affected highlight" : `${count} affected highlights`;
}

function formatSelectedHighlightsReturningForBook(count: number): string {
	return count === 1
		? "1 selected highlight returning for review"
		: `${count} selected highlights returning for review`;
}

function getIgnoreResultCopy(status: IgnoreResultPresentationStatus): string {
	switch (status) {
		case "removed":
			return "This highlight was removed from the matching note.";
		case "note-not-found":
			return "No matching note was found. No existing note was changed.";
		case "already-absent":
			return "This highlight was already absent from the matching note. No note change was needed.";
		case "multiple-notes-unchanged":
			return "More than one note matched this book, so the existing notes were left unchanged.";
		case "note-unchanged":
			return "The existing note could not be updated safely, so it was left unchanged.";
		case "not-removed":
			return "The existing note could not be updated. It may still contain this highlight.";
		case "change-unconfirmed":
			return "We couldn’t confirm whether the existing note changed. Check the note before trying again.";
		default:
			return assertNever(status);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unhandled presentation status: ${String(value)}`);
}
