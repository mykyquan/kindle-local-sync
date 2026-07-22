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
	createKindleHighlightIdentityKey,
	createStoredBookIdentityKey,
	CurrentClippingIdentityIndex,
	hasSameBookIdentity,
	hasSameHighlightIdentity,
} from "./sync/HighlightIdentity";
import {
	createReviewActionButton,
	createReviewBackButton,
	createReviewHighlightsButton,
	ReviewButtonTreatment,
} from "./ui/ReviewActionButton";
import { renderReviewBookMetadata } from "./ui/ReviewBookMetadata";
import { renderReviewHighlightDetail, renderReviewHighlightRow } from "./ui/ReviewHighlightDetail";

export interface SyncSummaryModalOptions {
	classification: SyncClassification;
	automaticHighlights: KindleHighlight[];
	importedCount: number;
	skippedThisSyncHighlights?: SyncSummaryHighlightItem[];
	identityIndex: CurrentClippingIdentityIndex;
	protectedBooks?: ProtectedBooksPresentation;
	ignoreResults?: IgnoreResultsPresentation;
}

interface MissingRecoveryControl {
	button: ButtonComponent;
	identities: string[];
	showBusy: boolean;
}

interface RecoveryMutationControl {
	button: ButtonComponent;
}

export class SyncSummaryModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly automaticHighlights: KindleHighlight[];
	private readonly identityIndex: CurrentClippingIdentityIndex;
	private readonly protectedBooks: ProtectedBooksPresentation;
	private ignoreResults: IgnoreResultsPresentation;
	private importedCount: number;
	private suspiciousHighlights: KindleHighlight[];
	private readonly protectedSuspiciousHighlightIdentities = new Set<string>();
	private readonly failedMissingImportIdentities = new Set<string>();
	private readonly missingImportFailureFocusIdentities = new Set<string>();
	private readonly pendingMissingImportIdentities = new Set<string>();
	private readonly missingRecoveryControls = new Set<MissingRecoveryControl>();
	private readonly recoveryMutationControls = new Set<RecoveryMutationControl>();
	private isRecoveryMutationPending = false;
	private activeRecoveryMutationButton: ButtonComponent | null = null;
	private activeMissingReviewRenderer: (() => void) | null = null;
	private skippedThisSyncHighlights: SyncSummaryHighlightItem[];
	private summaryScrollTop = 0;
	private suspiciousBooksScrollTop = 0;
	private suspiciousBookScrollTopByIdentity = new Map<string, number>();
	private suspiciousBookSectionEls = new Map<string, HTMLElement>();
	private suspiciousBooksReturnAnchorKey: string | null = null;
	private shouldRestoreSuspiciousBooksAnchor = false;
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
		this.activeMissingReviewRenderer = () => this.renderSummary();
		this.contentEl.empty();
		this.contentEl.createEl("h2", {
			text: this.hasCurrentProtectedWork() ? "Sync finished" : "Sync complete",
		});
		this.renderSummaryCount(
			this.importedCount,
			`${pluralize("new highlight", this.importedCount)} imported`,
			false,
			this.importedCount > 0
		);
		this.renderSummaryCount(
			this.classification.ignoredHighlights.length,
			`${pluralize("persisted Ignore choice", this.classification.ignoredHighlights.length)} kept out of this sync`
		);
		const skippedCount = this.skippedThisSyncHighlights.filter((highlight) =>
			highlight.returnReason !== "unreviewed"
		).length;
		const unreviewedCount = this.skippedThisSyncHighlights.length - skippedCount;

		this.renderSummaryCount(
			skippedCount,
			`${pluralize("temporary Skip choice", skippedCount)} left for a later sync`
		);
		this.renderSummaryCount(
			unreviewedCount,
			`${pluralize("unreviewed highlight", unreviewedCount)} left for a later sync`
		);
		this.renderSummaryCount(
			this.classification.duplicateHighlights.length,
			`${pluralize("duplicate", this.classification.duplicateHighlights.length)} skipped`
		);
		this.renderSummaryCount(
			this.suspiciousHighlights.length,
			this.suspiciousHighlights.length === 1
				? "missing highlight needs review"
				: "missing highlights need review",
			this.suspiciousHighlights.length > 0
		);
		const returnNextSyncExplanation = formatReturnNextSyncExplanation(skippedCount, unreviewedCount);

		if (returnNextSyncExplanation) {
			this.contentEl.createEl("p", {
				text: returnNextSyncExplanation,
			});
		}

		if (this.protectedBooks.bookCount > 0) {
			this.renderProtectedBooksPanel();
		}

		if (this.hasPersistedIgnoreResults()) {
			this.renderIgnoreResultsPanel();
		}

		const actions = this.contentEl.createDiv();
		actions.addClass("kls-summary-actions");
		const navigationActions = actions.createDiv();

		navigationActions.addClass("kls-button-row");
		navigationActions.addClass("kls-summary-navigation-actions");

		if (this.suspiciousHighlights.length > 0) {
			this.createActionButton(navigationActions, "Review Missing Highlights", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderSuspiciousItems();
				});
		}

		if (this.protectedBooks.bookCount > 0) {
			this.createActionButton(navigationActions, "View Books Left Unchanged", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderProtectedBooks();
				});
		}

		if (this.hasActionableIgnoreResults()) {
			this.createActionButton(navigationActions, "Review Note Update Issues", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderIgnoreResults();
				});
		}

		if (this.hasPersistedIgnoredHighlights()) {
			this.createActionButton(navigationActions, "Manage Ignored Highlights", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.renderIgnoredHighlights();
				});
		}

		if (this.skippedThisSyncHighlights.length > 0) {
			this.createActionButton(navigationActions, "Review Skipped This Sync", "subtle")
				.onClick(() => {
					this.saveSummaryScrollPosition();
					this.clearSkippedBooksReturnAnchor();
					this.renderSkippedBooks();
				});
		}

		const closeActions = actions.createDiv();

		closeActions.addClass("kls-button-row");
		closeActions.addClass("kls-summary-close-actions");
		this.createActionButton(closeActions, "Close", "subtle")
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
		if (this.protectedBooks.books.some((book) => book.identityConflict)) {
			panel.createEl("p", {
				// Keep the product name and recovery steps recognizable in this multi-sentence warning.
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text: "Kindle Local Sync found conflicting older highlight information in one or more books. It protected those books and made no changes to their notes or saved choices. Back up the affected notes, then review each book below before syncing again.",
			});
		}

		if (this.protectedBooks.selectedHighlightCount > 0) {
			panel.createEl("p", {
				text: formatSelectedHighlightsReturning(this.protectedBooks.selectedHighlightCount),
			});
		} else {
			panel.createEl("p", { text: "Their existing imported history was kept." });
		}
	}

	private renderSummaryCount(
		count: number,
		label: string,
		needsAttention = false,
		isPrimary = false
	): void {
		// Zero rows add visual noise and must not compete with an actual imported result.
		if (count === 0) {
			return;
		}

		const row = this.contentEl.createEl("p");

		row.addClass("kls-summary-count-row");
		if (isPrimary) {
			row.addClass("kls-summary-count-row-primary");
		}
		if (needsAttention) {
			row.addClass("kls-summary-count-row-attention");
		}
		row.createEl("span", { text: count.toString() }).addClass("kls-summary-count-value");
		row.createEl("span", { text: label }).addClass("kls-summary-count-label");
	}

	private renderIgnoreResultsPanel(): void {
		const panel = this.contentEl.createDiv();

		panel.addClass("kls-outcome-panel");
		panel.addClass("kls-ignore-results-panel");
		panel.createEl("h3", { text: "Ignore results" });
		panel.createEl("p", {
			text: formatHighlightsIgnoredInFuture(this.currentIgnoreResultCount()),
		});
		if (this.ignoreResults.unconfirmedCount > 0) {
			panel.createEl("p", {
				text: "Some existing-note results could not be confirmed.",
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

	private hasPersistedIgnoredHighlights(): boolean {
		return this.plugin.settings.ignoredHighlights.length > 0;
	}

	private hasPersistedIgnoreResults(): boolean {
		return this.ignoreResults.highlightCount > 0
			|| this.classification.ignoredHighlights.length > 0;
	}

	private currentIgnoreResultCount(): number {
		return this.ignoreResults.highlightCount > 0
			? this.ignoreResults.highlightCount
			: this.classification.ignoredHighlights.length;
	}

	private renderProtectedBooks(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Books left unchanged" });
		this.renderOutcomeDetailActions("Back to Summary", () => {
			this.protectedBooksScrollTop = this.contentEl.scrollTop;
			this.renderSummary();
		});

		const bookList = this.contentEl.createDiv();

		bookList.addClass("kls-book-list");
		for (const book of this.protectedBooks.books) {
			const card = bookList.createDiv();

			card.addClass("kls-book-section");
			card.addClass("kls-book-card");
			renderReviewBookMetadata(card, {
				titles: [book.title],
				author: book.author,
			});
			card.createEl("p", {
				text: formatAffectedHighlights(book.affectedHighlightCount),
			}).addClass("kls-book-review-summary");
			if (book.selectedHighlightCount > 0) {
				card.createEl("p", {
					text: formatSelectedHighlightsReturningForBook(book.selectedHighlightCount),
				}).addClass("kls-book-review-summary");
			} else if (book.identityConflict) {
				card.createEl("p", {
					// Keep Import, Ignore, and My Clippings.txt consistent with the rest of the review UI.
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text: "This book was not changed, and no Import or Ignore choice was saved. Back up the note and compare these highlights with My Clippings.txt before trying again.",
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
		this.contentEl.createEl("h2", { text: "Note update issues" });
		this.renderOutcomeDetailActions("Back to Summary", () => {
			this.ignoreResultsScrollTop = this.contentEl.scrollTop;
			this.renderSummary();
		});

		const resultList = this.contentEl.createDiv();

		resultList.addClass("kls-book-list");
		for (const item of this.ignoreResults.items.filter((candidate) =>
			candidate.status === "not-removed" || candidate.status === "change-unconfirmed"
		)) {
			const card = resultList.createDiv();

			card.addClass("kls-book-section");
			card.addClass("kls-book-card");
			renderReviewBookMetadata(card, {
				titles: [item.bookTitle],
				author: item.author,
			});
			if (item.highlightPreview) {
				card.createEl("p", { text: item.highlightPreview }).addClass("kls-ignored-highlight-text");
			}
			card.createEl("p", {
				text: getIgnoreResultCopy(item.status),
			}).addClass("kls-book-review-summary");
		}

		this.restoreScrollPosition(this.ignoreResultsScrollTop);
	}

	private renderOutcomeDetailActions(accessibleLabel: string, onBack: () => void): void {
		const actions = this.contentEl.createDiv();

		actions.addClass("kls-button-row");
		actions.addClass("kls-summary-actions");
		createReviewBackButton(actions, accessibleLabel).onClick(onBack);
		this.createActionButton(actions, "Close", "subtle").onClick(() => this.close());
	}

	private createActionButton(
		containerEl: HTMLElement,
		text: string,
		treatment: ReviewButtonTreatment = "subtle"
	): ButtonComponent {
		return createReviewActionButton(containerEl, text, treatment);
	}

	private renderSuspiciousItems(): void {
		this.activeMissingReviewRenderer = () => this.renderSuspiciousItems();
		this.contentEl.empty();
		this.suspiciousBookSectionEls.clear();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Missing Highlights" }).addClass("kls-review-view-title");
		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-review-navigation");
		createReviewBackButton(backActions, "Back to Summary")
			.onClick(() => {
				this.saveSuspiciousBooksScrollPosition();
				this.renderSummary();
			});
		this.contentEl.createEl("p", {
			text: "These highlights were imported before, but they’re no longer in their Obsidian notes. Review them and choose whether to import them again, ignore them, or skip them for now.",
		}).addClass("kls-review-view-intro");
		this.contentEl.createEl("p", {
			text: "This may happen if a highlight, note, or synced section was deleted or edited.",
		}).addClass("kls-review-view-intro");

		if (this.suspiciousHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No missing highlights left to review." });
			this.restoreSuspiciousBooksPosition();
			return;
		}

		const bookListEl = this.contentEl.createDiv();

		bookListEl.addClass("kls-book-list");
		for (const [bookIdentity, highlights] of groupMissingHighlightsByBook(this.suspiciousHighlights)) {
			const bookKey = createMissingBookAnchorKey(bookIdentity);
			const section = bookListEl.createDiv();

			this.suspiciousBookSectionEls.set(bookKey, section);
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");
			const header = section.createDiv();
			const headingContent = header.createDiv();

			header.addClass("kls-book-header");
			headingContent.addClass("kls-book-heading-content");
			renderReviewBookMetadata(headingContent, {
				titles: highlights.map((highlight) => highlight.bookTitle),
				author: highlights[0]?.author,
			});
			createReviewHighlightsButton(header)
				.onClick(() => {
					this.saveSuspiciousBooksScrollPosition();
					this.suspiciousBooksReturnAnchorKey = bookKey;
					this.renderSuspiciousBookHighlights(bookIdentity);
				});

			section.createEl("p", { text: formatMissingHighlights(highlights.length) })
				.addClass("kls-book-review-summary");
			this.renderMissingImportFailure(section, highlights);

			const actions = section.createDiv();

			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");
			const importAllButton = this.registerMissingRecoveryControl(
				this.createActionButton(
					actions,
					highlights.some((highlight) =>
						this.failedMissingImportIdentities.has(createKindleHighlightIdentityKey(highlight))
					) ? "Try Import All Again" : "Import All Again",
					"strong"
				).setCta(),
				highlights,
				true
			);

			importAllButton.onClick(async () => {
				if (this.hasPendingMissingImport(highlights)) {
					return;
				}

				this.saveSuspiciousBooksScrollPosition();
				await this.attemptMissingHighlightImport(highlights, importAllButton);
			});
			const ignoreAllButton = this.registerMissingRecoveryControl(
				this.createActionButton(actions, "Ignore All Going Forward", "subtle"),
				highlights,
				false
			);

			ignoreAllButton
				.onClick(async () => {
					if (
						this.isRecoveryMutationPending
						|| this.hasPendingMissingImport(highlights)
						|| !this.areCurrentSuspiciousHighlights(highlights)
					) {
						return;
					}

					this.saveSuspiciousBooksScrollPosition();
					const completed = await this.runPersistedRecoveryMutation(
						ignoreAllButton,
						() => this.ignoreMissingHighlights(highlights)
					);

					if (completed) {
						this.renderSuspiciousItems();
					}
				});
			const skipAllButton = this.registerMissingRecoveryControl(
				this.createActionButton(actions, "Skip All This Time", "subtle"),
				highlights,
				false
			);

			skipAllButton.onClick(() => {
				if (
					this.isRecoveryMutationPending
					|| this.hasPendingMissingImport(highlights)
					|| !this.areCurrentSuspiciousHighlights(highlights)
				) {
					return;
				}

				this.saveSuspiciousBooksScrollPosition();
				this.removeSuspiciousHighlights(highlights);
				this.renderSuspiciousItems();
			});
		}

		this.restoreSuspiciousBooksPosition();
	}

	private renderSuspiciousBookHighlights(bookIdentity: string): void {
		this.activeMissingReviewRenderer = () => this.renderSuspiciousBookHighlights(bookIdentity);
		this.contentEl.empty();
		const highlights = this.suspiciousHighlights.filter((highlight) =>
			createBookIdentityKey(highlight.bookTitle, highlight.author) === bookIdentity
		);
		const originalBookHighlight = this.classification.possibleReappearedHighlights.find((highlight) =>
			createBookIdentityKey(highlight.bookTitle, highlight.author) === bookIdentity
		);
		const bookTitle = highlights[0]?.bookTitle
			?? originalBookHighlight?.bookTitle
			?? "Untitled Kindle Book";

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Missing Highlights" }).addClass("kls-review-view-title");
		const backActions = this.contentEl.createDiv();

		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-review-navigation");
		createReviewBackButton(backActions, "Back to Missing Highlights")
			.onClick(() => {
				this.saveSuspiciousBookScrollPosition(bookIdentity);
				this.shouldRestoreSuspiciousBooksAnchor = true;
				this.renderSuspiciousItems();
			});

		const detailCard = this.contentEl.createDiv();

		detailCard.addClass("kls-book-section");
		detailCard.addClass("kls-book-card");
		detailCard.addClass("kls-review-detail-card");
		renderReviewBookMetadata(detailCard, {
			titles: highlights.length > 0
				? highlights.map((highlight) => highlight.bookTitle)
				: [bookTitle],
			author: highlights[0]?.author ?? originalBookHighlight?.author,
		});
		if (highlights.length === 0) {
			detailCard.createEl("p", { text: "No missing highlights left in this book." })
				.addClass("kls-empty-state");
			this.restoreScrollPosition(this.suspiciousBookScrollTopByIdentity.get(bookIdentity) ?? 0);
			return;
		}

		detailCard.createEl("p", { text: formatMissingHighlights(highlights.length) })
			.addClass("kls-book-review-summary");
		const highlightListEl = detailCard.createDiv();

		highlightListEl.addClass("kls-ignored-highlight-list");
		for (const highlight of highlights) {
			const highlightIdentity = createKindleHighlightIdentityKey(highlight);
			const row = highlightListEl.createDiv();

			row.addClass("kls-ignored-highlight-item");
			if (highlight.location) {
				row.createEl("p", { text: `Location ${highlight.location}` }).addClass("kls-book-meta");
			}
			row.createEl("p", { text: highlight.content }).addClass("kls-ignored-highlight-text");

			if (
				this.protectedSuspiciousHighlightIdentities.has(highlightIdentity)
				&& !this.pendingMissingImportIdentities.has(highlightIdentity)
				&& !this.failedMissingImportIdentities.has(highlightIdentity)
			) {
				const feedback = row.createEl("p", {
					text: "This note was left unchanged. This highlight is still available to try again.",
				});

				feedback.addClass("kls-inline-status");
				feedback.setAttribute("role", "status");
				feedback.setAttribute("aria-live", "polite");
			}

			this.renderMissingImportFailure(row, [highlight]);

			const actions = row.createDiv();

			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");
			const importButton = this.registerMissingRecoveryControl(
				this.createActionButton(
					actions,
					this.failedMissingImportIdentities.has(highlightIdentity) ? "Try Import Again" : "Import Again",
					"strong"
				).setCta(),
				[highlight],
				true
			);

			importButton.onClick(async () => {
				if (this.hasPendingMissingImport([highlight])) {
					return;
				}

				this.saveSuspiciousBookScrollPosition(bookIdentity);
				await this.attemptMissingHighlightImport([highlight], importButton);
			});
			const ignoreButton = this.registerMissingRecoveryControl(
				this.createActionButton(actions, "Ignore Going Forward", "subtle"),
				[highlight],
				false
			);

			ignoreButton
				.onClick(async () => {
					if (
						this.isRecoveryMutationPending
						|| this.hasPendingMissingImport([highlight])
						|| !this.areCurrentSuspiciousHighlights([highlight])
					) {
						return;
					}

					this.saveSuspiciousBookScrollPosition(bookIdentity);
					const completed = await this.runPersistedRecoveryMutation(
						ignoreButton,
						() => this.ignoreMissingHighlights([highlight])
					);

					if (completed) {
						this.renderSuspiciousBookHighlights(bookIdentity);
					}
				});
			this.registerMissingRecoveryControl(
				this.createActionButton(actions, "Skip This Time", "subtle"),
				[highlight],
				false
			)
				.onClick(() => {
					if (
						this.isRecoveryMutationPending
						|| this.hasPendingMissingImport([highlight])
						|| !this.areCurrentSuspiciousHighlights([highlight])
					) {
						return;
					}

					this.saveSuspiciousBookScrollPosition(bookIdentity);
					this.removeSuspiciousHighlights([highlight]);
					this.renderSuspiciousBookHighlights(bookIdentity);
				});
		}

		this.restoreScrollPosition(this.suspiciousBookScrollTopByIdentity.get(bookIdentity) ?? 0);
	}

	private async attemptMissingHighlightImport(
		highlights: KindleHighlight[],
		button: ButtonComponent
	): Promise<void> {
		if (
			highlights.length === 0
			|| this.isRecoveryMutationPending
			|| this.hasPendingMissingImport(highlights)
			|| !this.areCurrentSuspiciousHighlights(highlights)
		) {
			return;
		}

		for (const highlight of highlights) {
			const identity = createKindleHighlightIdentityKey(highlight);

			// Feedback describes the most recent validated attempt only. A new attempt is uncertain
			// until the writer returns, so stale protected feedback must not remain visible.
			this.protectedSuspiciousHighlightIdentities.delete(identity);
			this.failedMissingImportIdentities.delete(identity);
			this.missingImportFailureFocusIdentities.delete(identity);
		}
		if (!this.beginRecoveryMutation(button)) {
			return;
		}
		this.setMissingImportPending(highlights, button, true);
		this.activeMissingReviewRenderer?.();
		try {
			await this.importMissingHighlights(highlights);
			for (const highlight of highlights) {
				this.failedMissingImportIdentities.delete(createKindleHighlightIdentityKey(highlight));
			}
			this.setMissingImportPending(highlights, button, false);
			this.endRecoveryMutation(button);
			this.activeMissingReviewRenderer?.();
		} catch (error) {
			console.error("Kindle highlight import was not completed.", error);
			this.setMissingImportPending(highlights, button, false);
			for (const highlight of highlights) {
				const identity = createKindleHighlightIdentityKey(highlight);

				this.failedMissingImportIdentities.add(identity);
				this.missingImportFailureFocusIdentities.add(identity);
			}
			this.endRecoveryMutation(button);
			this.activeMissingReviewRenderer?.();
		}
	}

	private setMissingImportPending(
		highlights: readonly KindleHighlight[],
		button: ButtonComponent,
		pending: boolean
	): void {
		const identities = highlights.map(createKindleHighlightIdentityKey);

		if (pending) {
			for (const identity of identities) {
				this.pendingMissingImportIdentities.add(identity);
			}
			button.buttonEl.setAttribute("aria-busy", "true");
		} else {
			for (const identity of identities) {
				this.pendingMissingImportIdentities.delete(identity);
			}
			button.buttonEl.removeAttribute("aria-busy");
		}

		this.updateMissingRecoveryControlStates();
	}

	private registerMissingRecoveryControl(
		button: ButtonComponent,
		highlights: readonly KindleHighlight[],
		showBusy: boolean
	): ButtonComponent {
		const control: MissingRecoveryControl = {
			button,
			identities: highlights.map(createKindleHighlightIdentityKey),
			showBusy,
		};

		this.registerRecoveryMutationControl(button);
		this.missingRecoveryControls.add(control);
		this.updateMissingRecoveryControlState(control);
		return button;
	}

	private updateMissingRecoveryControlStates(): void {
		for (const control of this.missingRecoveryControls) {
			this.updateMissingRecoveryControlState(control);
		}
	}

	private updateMissingRecoveryControlState(control: MissingRecoveryControl): void {
		const pending = control.identities.some((identity) => this.pendingMissingImportIdentities.has(identity));

		control.button.setDisabled(this.isRecoveryMutationPending || pending);
		if (
			(pending && control.showBusy)
			|| control.button === this.activeRecoveryMutationButton
		) {
			control.button.buttonEl.setAttribute("aria-busy", "true");
			return;
		}

		control.button.buttonEl.removeAttribute("aria-busy");
	}

	private registerRecoveryMutationControl(button: ButtonComponent): ButtonComponent {
		const control = { button };

		this.recoveryMutationControls.add(control);
		button.setDisabled(this.isRecoveryMutationPending);
		return button;
	}

	private updateRecoveryMutationControlStates(): void {
		for (const control of this.recoveryMutationControls) {
			control.button.setDisabled(this.isRecoveryMutationPending);
		}
		this.updateMissingRecoveryControlStates();
	}

	private beginRecoveryMutation(button: ButtonComponent): boolean {
		if (this.isRecoveryMutationPending) {
			return false;
		}

		this.isRecoveryMutationPending = true;
		this.activeRecoveryMutationButton = button;
		this.contentEl.setAttribute("aria-busy", "true");
		button.buttonEl.setAttribute("aria-busy", "true");
		this.updateRecoveryMutationControlStates();
		return true;
	}

	private endRecoveryMutation(button: ButtonComponent): void {
		button.buttonEl.removeAttribute("aria-busy");
		this.activeRecoveryMutationButton = null;
		this.isRecoveryMutationPending = false;
		this.contentEl.removeAttribute("aria-busy");
		this.updateRecoveryMutationControlStates();
	}

	private async runPersistedRecoveryMutation(
		button: ButtonComponent,
		mutation: () => Promise<void>
	): Promise<boolean> {
		if (!this.beginRecoveryMutation(button)) {
			return false;
		}

		try {
			await mutation();
			return true;
		} finally {
			this.endRecoveryMutation(button);
		}
	}

	private hasPendingMissingImport(highlights: readonly KindleHighlight[]): boolean {
		return highlights.some((highlight) =>
			this.pendingMissingImportIdentities.has(createKindleHighlightIdentityKey(highlight))
		);
	}

	private areCurrentSuspiciousHighlights(highlights: readonly KindleHighlight[]): boolean {
		const currentIdentities = new Set(
			this.suspiciousHighlights.map(createKindleHighlightIdentityKey)
		);

		return highlights.every((highlight) =>
			currentIdentities.has(createKindleHighlightIdentityKey(highlight))
		);
	}

	private renderMissingImportFailure(
		containerEl: HTMLElement,
		highlights: readonly KindleHighlight[]
	): void {
		const failedHighlights = highlights.filter((highlight) =>
			this.failedMissingImportIdentities.has(createKindleHighlightIdentityKey(highlight))
		);

		if (failedHighlights.length === 0) {
			return;
		}

		const failure = containerEl.createDiv();

		failure.addClass("kls-operation-failure");
		failure.setAttribute("role", "alert");
		failure.setAttribute("tabindex", "-1");
		failure.createEl("h3", { text: "Import not completed" });
		failure.createEl("p", { text: formatMissingImportFailure(failedHighlights.length) });
		const shouldFocus = failedHighlights.some((highlight) =>
			this.missingImportFailureFocusIdentities.has(createKindleHighlightIdentityKey(highlight))
		);

		if (shouldFocus) {
			// Consume only the identities represented by this alert so an older failure cannot
			// take focus from the request that just failed in another book.
			for (const highlight of failedHighlights) {
				this.missingImportFailureFocusIdentities.delete(createKindleHighlightIdentityKey(highlight));
			}
			this.afterRender(() => failure.focus({ preventScroll: true }));
		}
	}

	private async importMissingHighlights(highlights: KindleHighlight[]): Promise<void> {
		if (highlights.length === 0) {
			return;
		}

		const sameBookHighlights = this.automaticHighlights.filter((candidate) =>
			hasSameBookIdentity(candidate, highlights[0]!)
		);
		const result = await this.plugin.importHighlights(
			[...sameBookHighlights, ...highlights],
			this.identityIndex,
			true,
			highlights
		);
		const completedHighlights = highlights.filter((highlight) =>
			result.safelyCompletedHighlights.some((candidate) => hasSameHighlightIdentity(candidate, highlight))
		);

		// A protected recovery attempt must stay visible and retryable until the writer confirms it.
		for (const highlight of highlights) {
			const identity = createKindleHighlightIdentityKey(highlight);

			if (completedHighlights.includes(highlight)) {
				this.protectedSuspiciousHighlightIdentities.delete(identity);
			} else {
				this.protectedSuspiciousHighlightIdentities.add(identity);
			}
		}

		this.importedCount += completedHighlights.length;
		this.removeSuspiciousHighlights(completedHighlights);
	}

	private async ignoreMissingHighlights(highlights: KindleHighlight[]): Promise<void> {
		const result = await this.plugin.ignoreHighlights(highlights, this.identityIndex);

		this.ignoreResults = mergeIgnoreResultsPresentations(this.ignoreResults, result.outcomePresentation);
		this.removeSuspiciousHighlights(highlights);
	}

	private removeSuspiciousHighlights(highlights: readonly KindleHighlight[]): void {
		const removedHighlights = new Set(highlights);

		for (const highlight of highlights) {
			const identity = createKindleHighlightIdentityKey(highlight);

			this.protectedSuspiciousHighlightIdentities.delete(identity);
			this.failedMissingImportIdentities.delete(identity);
			this.missingImportFailureFocusIdentities.delete(identity);
		}
		this.suspiciousHighlights = this.suspiciousHighlights.filter((candidate) =>
			!removedHighlights.has(candidate)
		);
	}

	private hasCurrentProtectedWork(): boolean {
		return this.protectedBooks.bookCount > 0
			|| this.protectedSuspiciousHighlightIdentities.size > 0
			|| this.failedMissingImportIdentities.size > 0;
	}

	private hasActionableIgnoreResults(): boolean {
		return this.ignoreResults.failedCount > 0 || this.ignoreResults.unconfirmedCount > 0;
	}

	private renderIgnoredHighlights(): void {
		this.contentEl.empty();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Ignored Highlights" }).addClass("kls-review-view-title");
		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-review-navigation");
		createReviewBackButton(backActions, "Back to Summary")
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
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			const header = section.createDiv();
			const headingContent = header.createDiv();
			header.addClass("kls-book-header");

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

			const removeAllButton = this.registerRecoveryMutationControl(
				this.createActionButton(actions, "Remove All From Ignore List")
			);

			removeAllButton
				.onClick(async () => {
					if (this.isRecoveryMutationPending) {
						return;
					}

					this.saveIgnoredHighlightsScrollPosition();
					const completed = await this.runPersistedRecoveryMutation(
						removeAllButton,
						() => this.unignoreHighlights(highlights)
					);

					if (completed) {
						this.renderIgnoredHighlights();
					}
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
			const removeButton = this.registerRecoveryMutationControl(
				this.createActionButton(actions, "Remove From Ignore List")
			);

			removeButton
				.onClick(async () => {
					if (this.isRecoveryMutationPending) {
						return;
					}

					this.saveIgnoredBookScrollPosition(bookIdentity);
					const completed = await this.runPersistedRecoveryMutation(
						removeButton,
						() => this.plugin.unignoreHighlight(highlight)
					);

					if (completed) {
						this.renderIgnoredBookHighlights(bookIdentity);
					}
				});
		}

		this.restoreScrollPosition(this.ignoredBookScrollTopByTitle.get(bookIdentity) ?? 0);
	}

	private renderSkippedBooks(): void {
		this.contentEl.empty();
		this.skippedBookSectionEls.clear();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.contentEl.createEl("h2", { text: "Skipped This Sync" }).addClass("kls-review-view-title");
		const backActions = this.contentEl.createDiv();
		backActions.addClass("kls-button-row");
		backActions.addClass("kls-summary-actions");
		backActions.addClass("kls-review-navigation");
		createReviewBackButton(backActions, "Back to Summary")
			.onClick(() => {
				this.saveSkippedBooksScrollPosition();
					this.renderSummary();
				});
		this.contentEl.createEl("p", {
			text: "These highlights were skipped only for this sync. They may appear again next time unless ignored.",
		}).addClass("kls-review-view-intro");

		if (this.skippedThisSyncHighlights.length === 0) {
			this.contentEl.createEl("p", { text: "No skipped highlights left to review." });
			this.restoreSkippedBooksPosition();
			return;
		}

		const bookListEl = this.contentEl.createDiv();
		bookListEl.addClass("kls-book-list");

		for (const [bookIdentity, highlights] of groupSummaryHighlightsByBook(this.skippedThisSyncHighlights)) {
			const bookKey = createSkippedBookAnchorKey(bookIdentity);
			const section = bookListEl.createDiv();

			this.skippedBookSectionEls.set(bookKey, section);
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");
			const header = section.createDiv();
			const headingContent = header.createDiv();
			header.addClass("kls-book-header");

			headingContent.addClass("kls-book-heading-content");
			renderReviewBookMetadata(headingContent, {
				titles: highlights.map((highlight) => highlight.title),
				author: highlights[0]?.author,
			});

			section.createEl("p", {
				text: `${highlights.length} ${pluralize("highlight", highlights.length)} skipped this sync`,
			}).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createActionButton(actions, "Ignore All Highlights", "subtle")
				.onClick(() => {
					this.saveSkippedBooksScrollPosition();
					this.renderIgnoreAllSkippedHighlightsConfirmation(highlights);
				});

			createReviewHighlightsButton(actions)
				.onClick(() => {
					this.saveSkippedBooksScrollPosition();
					this.skippedBooksReturnAnchorKey = bookKey;
					this.renderSkippedBookHighlights(bookIdentity);
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

		createReviewBackButton(actions, "Back to Skipped Books")
			.onClick(() => this.renderSkippedBooks());

		const ignoreAllButton = this.registerRecoveryMutationControl(
			this.createActionButton(actions, "Ignore All Highlights", "subtle")
		);

		ignoreAllButton
			.onClick(async () => {
				if (this.isRecoveryMutationPending) {
					return;
				}

				const completed = await this.runPersistedRecoveryMutation(
					ignoreAllButton,
					() => this.ignoreSkippedHighlights(highlights)
				);

				if (completed) {
					this.renderSkippedBooks();
				}
			});
	}

	private renderSkippedBookHighlights(bookIdentity: string): void {
		this.contentEl.empty();
		const highlights = this.skippedThisSyncHighlights.filter((highlight) =>
			createBookIdentityKey(highlight.title, highlight.author) === bookIdentity
		);
		const bookTitle = getSummaryTitle(highlights[0]);
		const detail = renderReviewHighlightDetail(this.contentEl, {
			titles: highlights.length > 0
				? highlights.map((highlight) => highlight.title)
				: [bookTitle],
			author: highlights[0]?.author,
			countText: `${highlights.length} ${pluralize("highlight", highlights.length)} skipped this sync`,
			backAccessibleLabel: "Back to Skipped Books",
			onBack: () => {
				this.saveSkippedBookScrollPosition(bookIdentity);
				this.shouldRestoreSkippedBooksAnchor = true;
				this.renderSkippedBooks();
			},
		});

		if (highlights.length === 0) {
			detail.detailEl.createEl("p", { text: "No skipped highlights left in this book." });
			this.restoreScrollPosition(this.skippedBookScrollTopByTitle.get(bookIdentity) ?? 0);
			return;
		}

		for (const highlight of highlights) {
			const { actionsEl: actions } = renderReviewHighlightRow(
				detail.highlightsEl,
				highlight.textPreview,
				highlight.location ? `Location ${highlight.location}` : undefined
			);
			const ignoreButton = this.registerRecoveryMutationControl(
				this.createActionButton(actions, "Ignore Going Forward", "subtle")
			);

			ignoreButton
				.onClick(async () => {
					if (this.isRecoveryMutationPending) {
						return;
					}

					this.saveSkippedBookScrollPosition(bookIdentity);
					const completed = await this.runPersistedRecoveryMutation(
						ignoreButton,
						async () => {
							const result = await this.plugin.ignoreSummaryHighlight(highlight, this.identityIndex);

							this.ignoreResults = mergeIgnoreResultsPresentations(
								this.ignoreResults,
								result.outcomePresentation
							);
							const identity = createHighlightIdentityKey(
								highlight.title,
								highlight.author,
								highlight.id
							);

							this.skippedThisSyncHighlights = this.skippedThisSyncHighlights.filter((candidate) =>
								createHighlightIdentityKey(candidate.title, candidate.author, candidate.id) !== identity
							);
						}
					);

					if (completed) {
						this.renderSkippedBookHighlights(bookIdentity);
					}
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

	private saveSuspiciousBooksScrollPosition(): void {
		this.suspiciousBooksScrollTop = this.contentEl.scrollTop;
	}

	private saveSuspiciousBookScrollPosition(bookIdentity: string): void {
		this.suspiciousBookScrollTopByIdentity.set(bookIdentity, this.contentEl.scrollTop);
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

	private restoreSuspiciousBooksPosition(): void {
		const anchorKey = this.shouldRestoreSuspiciousBooksAnchor
			? this.suspiciousBooksReturnAnchorKey
			: null;

		this.shouldRestoreSuspiciousBooksAnchor = false;
		if (!anchorKey) {
			this.restoreScrollPosition(this.suspiciousBooksScrollTop);
			return;
		}

		this.afterRender(() => {
			const section = this.suspiciousBookSectionEls.get(anchorKey);

			if (section && typeof section.scrollIntoView === "function") {
				section.scrollIntoView({ block: "center" });
				return;
			}

			this.contentEl.scrollTop = this.suspiciousBooksScrollTop;
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

function groupMissingHighlightsByBook(highlights: KindleHighlight[]): Map<string, KindleHighlight[]> {
	const groups = new Map<string, KindleHighlight[]>();

	for (const highlight of highlights) {
		const bookIdentity = createBookIdentityKey(highlight.bookTitle, highlight.author);
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

function formatReturnNextSyncExplanation(skippedCount: number, unreviewedCount: number): string | null {
	// These branches describe the live decision mix; neither category should imply the other.
	if (skippedCount > 0 && unreviewedCount > 0) {
		return "Unreviewed and temporarily skipped highlights may appear again next time you sync.";
	}
	if (skippedCount > 0) {
		return "Temporarily skipped highlights may appear again next time you sync.";
	}
	if (unreviewedCount > 0) {
		return "Unreviewed highlights may appear again next time you sync.";
	}
	return null;
}

function createSkippedBookAnchorKey(bookIdentity: string): string {
	return bookIdentity;
}

function createMissingBookAnchorKey(bookIdentity: string): string {
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
		? "1 highlight was removed from an existing Obsidian note."
		: `${count} highlights were removed from existing Obsidian notes.`;
}

function formatNoMatchingNoteResults(count: number): string {
	return count === 1
		? "No matching notes were found for 1 highlight, so no note changes were needed."
		: `No matching notes were found for ${count} highlights, so no note changes were needed.`;
}

function formatAlreadyAbsentResults(count: number): string {
	return count === 1
		? "1 ignored highlight had already been removed from its Obsidian note."
		: `${count} ignored highlights had already been removed from their Obsidian notes.`;
}

function formatUnchangedResults(count: number): string {
	return count === 1
		? "No note change was made for 1 highlight because its existing note could not be updated safely or unambiguously."
		: `No note changes were made for ${count} highlights because their existing notes could not be updated safely or unambiguously.`;
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

function formatAffectedHighlights(count: number): string {
	return count === 1 ? "1 affected highlight" : `${count} affected highlights`;
}

function formatMissingHighlights(count: number): string {
	return count === 1 ? "1 missing highlight" : `${count} missing highlights`;
}

function formatMissingImportFailure(count: number): string {
	return count === 1
		? "We couldn’t confirm the final import result. This highlight is still available here. Some note changes may have occurred."
		: `We couldn’t confirm the final import result. These ${count} highlights are still available here. Some note changes may have occurred.`;
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
			return "This ignored highlight had already been removed from its Obsidian note. No note change was needed.";
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
