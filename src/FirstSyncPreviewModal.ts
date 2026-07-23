import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { KindleBookGroup } from "./render/renderMarkdown";
import { createReturningSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";
import {
	createBookIdentityKey,
	createKindleHighlightIdentityKey,
	CurrentClippingIdentityIndex,
} from "./sync/HighlightIdentity";
import { IgnoredHighlightCleanupSummary } from "./sync/IgnoredHighlightCleanup";
import { InvalidVaultWriteContractError } from "./sync/VaultWriteContract";
import {
	createReviewActionButton,
	createReviewBackButton,
	createReviewHighlightsButton,
	createReviewSkipButton,
	ReviewButtonTreatment,
	setReviewButtonTreatment,
} from "./ui/ReviewActionButton";
import {
	createCombinedReviewBookTitle,
	renderReviewBookMetadata,
} from "./ui/ReviewBookMetadata";
import { renderReviewHighlightDetail, renderReviewHighlightRow } from "./ui/ReviewHighlightDetail";

type FirstSyncChoice = "import" | "ignore" | "skip";
type BookStatusTone = FirstSyncChoice | "reviewed" | "needs-review";
type BookStatusFilter = "all" | "needs-review" | "checked";

export interface FirstSyncReviewCompletion {
	importHighlights: KindleHighlight[];
	ignoreHighlights: KindleHighlight[];
	skippedThisSyncHighlights: SyncSummaryHighlightItem[];
}

export interface SyncCompletionResult {
	importedCount: number;
	ignoreCleanupResult: IgnoredHighlightCleanupSummary;
	protectedSelectedHighlightCount: number;
}

export interface FirstSyncPreviewModalOptions {
	title?: string;
	completionNotice?: (importedCount: number, protectedSelectedHighlightCount: number) => string;
	onComplete?: (completion: FirstSyncReviewCompletion) => Promise<SyncCompletionResult>;
}

interface ReviewProgress {
	reviewedBooks: number;
	notReviewedBooks: number;
	ignoreHighlights: number;
	skipThisSyncHighlights: number;
	notReviewedHighlights: number;
}

interface BookStatus {
	text: string;
	tone: BookStatusTone;
	isChecked: boolean;
	counts: Map<FirstSyncChoice, number>;
	selectedCount: number;
	needsReviewCount: number;
	selectedChoice?: FirstSyncChoice;
}

interface VisibleBookEntry {
	group: KindleBookGroup;
	originalIndex: number;
	status: BookStatus;
}

interface CompletionFailure {
	ignoreChoicesSaved: boolean;
}

interface ChoiceHelpDisclosureOptions {
	panelId: string;
	triggerText: string;
	triggerAccessibleLabel?: string;
	isIcon?: boolean;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
}

export class FirstSyncPreviewModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly bookGroups: KindleBookGroup[];
	private readonly options: FirstSyncPreviewModalOptions;
	private readonly identityIndex: CurrentClippingIdentityIndex;
	private readonly choices = new Map<string, FirstSyncChoice>();
	private readonly bookSectionEls = new Map<string, HTMLElement>();
	private readonly filterButtons = new Map<BookStatusFilter, ButtonComponent>();
	private readonly decisionMutationButtons = new Set<ButtonComponent>();
	private readonly finishSyncButtons = new Set<ButtonComponent>();
	private readonly importAllBooksButtons = new Set<ButtonComponent>();
	private readonly savedIgnoreChoiceIdentities = new Set<string>();
	private scrollBodyEl: HTMLElement | null = null;
	private highlightListEl: HTMLElement | null = null;
	private bookListContentEl: HTMLElement | null = null;
	private bookListReturnAnchorKey: string | null = null;
	private bookListScrollTop = 0;
	private shouldRestoreBookListAnchor = false;
	private shouldRestoreBookListScroll = false;
	private bookSearchQuery = "";
	private bookStatusFilter: BookStatusFilter = "all";
	private readonly initialChoices = new Map<string, FirstSyncChoice>();
	private activeReviewRenderer: (() => void) | null = null;
	private resumeAfterDiscardConfirmation: (() => void) | null = null;
	private isDiscardConfirmationOpen = false;
	private isImportAllBooksConfirmationOpen = false;
	private hasCompletedSync = false;
	private isCompletionPending = false;
	private completionFailure: CompletionFailure | null = null;
	private shouldFocusCompletionFailure = false;
	private isBookListHelpOpen = false;
	private isHighlightHelpOpen = false;

	constructor(
		app: App,
		plugin: KindleLocalSyncPlugin,
		bookGroups: KindleBookGroup[],
		options: FirstSyncPreviewModalOptions = {}
	) {
		super(app);
		this.plugin = plugin;
		this.bookGroups = bookGroups;
		this.options = options;
		this.identityIndex = new CurrentClippingIdentityIndex(bookGroups.flatMap((group) => group.clippings));
	}

	onOpen(): void {
		this.contentEl.addClass("kls-glass-scope");
		this.renderBookList();
	}

	close(): void {
		if (this.isCompletionPending) {
			return;
		}

		if (this.isImportAllBooksConfirmationOpen) {
			this.keepCurrentImportChoices();
			return;
		}

		if (this.hasCompletedSync || !this.hasPendingDecisionChanges()) {
			super.close();
			return;
		}

		if (this.isDiscardConfirmationOpen) {
			this.keepReviewing();
			return;
		}

		this.renderDiscardConfirmation();
	}

	private renderBookList(): void {
		this.activeReviewRenderer = () => this.renderBookList();
		const bodyEl = this.createModalBody();

		const heading = bodyEl.createDiv();

		heading.addClass("kls-review-modal-heading");
		heading.createEl("h2", { text: this.getTitle() });
		bodyEl.createEl("p", {
			text: `Found ${this.totalHighlights()} ${pluralize("highlight", this.totalHighlights())} from ${this.bookGroups.length} ${pluralize("book", this.bookGroups.length)}.`,
		});
		this.renderKindleWarning(bodyEl);
		this.renderCompletionFailure(bodyEl);
		this.renderStickyReviewSummary(bodyEl);

		this.bookListContentEl = bodyEl.createDiv();
		this.bookListContentEl.addClass("kls-book-list");
		this.renderVisibleBookCards();

		const footer = this.createStickyActions();
		const bulkActions = footer.createDiv();
		const completionActions = footer.createDiv();

		footer.addClass("kls-first-sync-review-actions");
		bulkActions.addClass("kls-button-row");
		bulkActions.addClass("kls-first-sync-bulk-actions");
		completionActions.addClass("kls-button-row");
		completionActions.addClass("kls-first-sync-completion-actions");
		this.addImportAllBooksButton(bulkActions);
		this.addFinishSyncButton(completionActions);
		this.addCancelButton(completionActions);

		this.restoreBookListPosition();
	}

	private renderKindleWarning(bodyEl: HTMLElement): void {
		const warningEl = bodyEl.createDiv();

		warningEl.addClass("kls-review-warning-callout");
		const paragraph = warningEl.createEl("p");

		paragraph.createEl("span", {
			text: "Some highlights deleted on your Kindle may still remain in My Clippings.txt.",
		});
		paragraph.createEl("br");
		paragraph.createEl("span", {
			text: "Review them before importing so only the highlights you want are added to your notes.",
		});
	}

	private renderVisibleBookCards(): void {
		const bookListEl = this.bookListContentEl;

		if (!bookListEl) {
			return;
		}

		const importAllBooksButtons = [...this.importAllBooksButtons];

		this.decisionMutationButtons.clear();
		bookListEl.empty();
		this.bookSectionEls.clear();

		const visibleBooks = this.visibleBookEntries();

		if (visibleBooks.length === 0) {
			bookListEl.createEl("p", { text: "No matching books." }).addClass("kls-empty-state");
		}

		for (const { group, originalIndex, status } of visibleBooks) {
			const bookKey = createBookAnchorKey(group, originalIndex);
			const selectedBookChoice = status.selectedChoice;
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			this.bookSectionEls.set(bookKey, section);
			const header = section.createDiv();
			header.addClass("kls-book-header");
			const headingContent = header.createDiv();

			headingContent.addClass("kls-book-heading-content");
			renderReviewBookMetadata(headingContent, {
				titles: getBookTitleVariants(group),
				author: group.author,
				position: {
					current: originalIndex + 1,
					total: this.bookGroups.length,
				},
			});

			const cardControls = header.createDiv();

			cardControls.addClass("kls-book-card-controls");
			this.renderBookStatus(cardControls, status);

			section.createEl("p", { text: createBookReviewSummary(group, status) }).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createDecisionButton(actions, "Import All", selectedBookChoice, "import")
				.onClick(() => {
					if (!this.setGroupChoice(group, "import")) {
						return;
					}
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.renderBookList();
				});

			this.createDecisionButton(actions, "Skip This Sync", selectedBookChoice, "skip")
				.onClick(() => {
					if (!this.setGroupChoice(group, "skip")) {
						return;
					}
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.renderBookList();
				});

			this.createDecisionButton(actions, "Ignore All", selectedBookChoice, "ignore")
				.onClick(() => {
					if (!this.setGroupChoice(group, "ignore")) {
						return;
					}
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.renderBookList();
				});

			createReviewHighlightsButton(actions)
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.renderHighlightReview(group);
					this.scrollToTopAfterRender();
				});

		}

		// The footer survives search/filter-only renders, so keep its live mutation control registered.
		for (const button of importAllBooksButtons) {
			this.decisionMutationButtons.add(button);
			this.updateImportAllBooksButtonState(button);
		}
	}

	private renderBookListControls(bodyEl: HTMLElement): void {
		const controls = bodyEl.createDiv();
		controls.addClass("kls-book-list-controls");
		this.filterButtons.clear();

		const searchControl = controls.createDiv();
		searchControl.addClass("kls-book-search-control");

		const searchInput = searchControl.createEl("input");
		searchInput.type = "search";
		searchInput.placeholder = "Search books...";
		searchInput.value = this.bookSearchQuery;
		searchInput.addClass("kls-book-search-input");
		searchInput.addEventListener("input", () => {
			this.bookSearchQuery = searchInput.value;
			this.renderVisibleBookCards();
		});

		const filters = controls.createDiv();
		filters.addClass("kls-button-row");
		filters.addClass("kls-book-filter-row");

		this.createFilterButton(filters, "All Books", "all");
		this.createFilterButton(filters, "Needs Review", "needs-review");
		this.createFilterButton(filters, "Reviewed", "checked");
		this.updateBookFilterButtonStates();
	}

	private renderStickyReviewSummary(bodyEl: HTMLElement): void {
		const stickySummary = bodyEl.createDiv();
		const controlsPanel = stickySummary.createDiv();

		stickySummary.addClass("kls-review-sticky-summary");
		controlsPanel.addClass("kls-review-controls-panel");
		this.renderChoicesHelpDisclosure(controlsPanel, controlsPanel, {
			panelId: "kls-book-list-choice-help",
			triggerText: "How choices work",
			isOpen: this.isBookListHelpOpen,
			onOpenChange: (isOpen) => {
				this.isBookListHelpOpen = isOpen;
			},
		});
		this.renderBookListControls(controlsPanel);
		this.renderCompactReviewProgress(controlsPanel);
	}

	private renderCompactReviewProgress(containerEl: HTMLElement): void {
		const progress = this.reviewProgress();
		const progressEl = containerEl.createDiv();

		progressEl.addClass("kls-compact-review-progress");
		this.createProgressChip(progressEl, `Reviewed: ${progress.reviewedBooks}/${this.bookGroups.length} books`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Needs Review: ${progress.notReviewedBooks} ${pluralize("book", progress.notReviewedBooks)}`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Ignore: ${progress.ignoreHighlights} ${pluralize("highlight", progress.ignoreHighlights)}`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Skip: ${progress.skipThisSyncHighlights} ${pluralize("highlight", progress.skipThisSyncHighlights)}`);
	}

	private createProgressChip(containerEl: HTMLElement, text: string): void {
		const chip = containerEl.createEl("span", { text });

		chip.addClass("kls-progress-chip");
	}

	private createProgressSeparator(containerEl: HTMLElement): void {
		containerEl.createEl("span", { text: "·" }).addClass("kls-progress-separator");
	}

	private renderChoicesHelpDisclosure(
		triggerContainerEl: HTMLElement,
		panelContainerEl: HTMLElement,
		options: ChoiceHelpDisclosureOptions
	): void {
		const trigger = this.createActionButton(triggerContainerEl, options.triggerText);

		trigger.buttonEl.addClass("kls-choice-help-button");
		if (options.isIcon) {
			trigger.buttonEl.addClass("kls-choice-help-icon");
		}
		trigger.buttonEl.setAttribute("aria-controls", options.panelId);
		if (options.triggerAccessibleLabel) {
			trigger.buttonEl.setAttribute("aria-label", options.triggerAccessibleLabel);
		}

		const panelEl = this.renderChoicesHelpCard(panelContainerEl, options.panelId);
		const updateDisclosure = (isOpen: boolean): void => {
			options.onOpenChange(isOpen);
			trigger.buttonEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
			if (isOpen) {
				panelEl.removeAttribute("hidden");
			} else {
				panelEl.setAttribute("hidden", "");
			}
		};

		updateDisclosure(options.isOpen);
		trigger.onClick(() => {
			updateDisclosure(trigger.buttonEl.getAttribute("aria-expanded") !== "true");
		});
		trigger.buttonEl.addEventListener("keydown", (event) => {
			if (event.key !== "Escape" || trigger.buttonEl.getAttribute("aria-expanded") !== "true") {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			updateDisclosure(false);
			trigger.buttonEl.focus();
		});
	}

	/** Both disclosure locations use this renderer so their wording and semantic order stay identical. */
	private renderChoicesHelpCard(containerEl: HTMLElement, panelId: string): HTMLElement {
		const panelEl = containerEl.createDiv();

		panelEl.addClass("kls-choice-help-panel");
		panelEl.setAttribute("id", panelId);
		panelEl.setAttribute("role", "note");
		panelEl.setAttribute("aria-label", "How choices work");
		const opening = panelEl.createEl("p");

		opening.addClass("kls-choice-help-opening");
		opening.createEl("strong", { text: "How choices work:" });
		opening.createEl("span", {
			text: "Your choices are temporary until you select finish sync.",
		});
		const choices = panelEl.createEl("dl");

		choices.addClass("kls-choice-help");
		this.renderChoiceHelpItem(
			choices,
			"Import All Books",
			"Selects every book in this review. Choices made here change to Import."
		);
		this.renderChoiceHelpItem(choices, "Import All", "Choose Import for every highlight in this book.");
		this.renderChoiceHelpItem(
			choices,
			"Ignore All",
			"Keep every highlight out of future syncs until you remove it from Ignored Highlights."
		);
		this.renderChoiceHelpItem(
			choices,
			"Skip This Sync",
			"Skip this book once — its highlights may return next sync."
		);
		this.renderChoiceHelpItem(
			choices,
			"Review Highlights",
			"Choose Import, Skip, or Ignore one highlight at a time."
		);
		this.renderChoiceHelpItem(
			choices,
			"Finish Sync",
			"Save your choices and sync. Highlights still needing review are skipped this time."
		);
		const statusExplanation = panelEl.createEl("p");

		statusExplanation.addClass("kls-choice-help-status");
		statusExplanation.createEl("strong", { text: "Reviewed:" });
		statusExplanation.createEl("span", { text: "Every highlight has a choice." });
		statusExplanation.createEl("strong", { text: "Needs review:" });
		statusExplanation.createEl("span", { text: "At least one highlight still needs a choice." });
		return panelEl;
	}

	private renderChoiceHelpItem(containerEl: HTMLElement, label: string, description: string): void {
		containerEl.createEl("dt", { text: label });
		containerEl.createEl("dd", { text: description });
	}

	private createFilterButton(containerEl: HTMLElement, label: string, filter: BookStatusFilter): void {
		const button = this.createActionButton(containerEl, label);

		button.buttonEl.addClass("kls-book-filter-button");
		this.filterButtons.set(filter, button);

		button.onClick(() => {
			this.bookStatusFilter = filter;
			this.updateBookFilterButtonStates();
			this.renderVisibleBookCards();
		});
	}

	private updateBookFilterButtonStates(): void {
		for (const [filter, button] of this.filterButtons.entries()) {
			const buttonEl = button.buttonEl;
			const isActive = this.bookStatusFilter === filter;

			buttonEl.setAttribute("aria-pressed", isActive ? "true" : "false");
			if (isActive) {
				setReviewButtonTreatment(button, "strong");
				buttonEl.addClass("kls-book-filter-button-active");
			} else {
				setReviewButtonTreatment(button, "subtle");
				buttonEl.removeClass("kls-book-filter-button-active");
			}
		}
	}

	private renderHighlightReview(group: KindleBookGroup): void {
		this.activeReviewRenderer = () => this.renderHighlightReview(group);
		const bodyEl = this.createModalBody();

		bodyEl.addClass("kls-highlight-review-layout");
		const detail = renderReviewHighlightDetail(bodyEl, {
			titles: getBookTitleVariants(group),
			author: group.author,
			countText: `${group.clippings.length} ${pluralize("highlight", group.clippings.length)}`,
			backAccessibleLabel: "Back to Book List",
			onBack: () => {
				// Back is in-workflow navigation: it keeps every temporary choice and list context.
				this.shouldRestoreBookListAnchor = true;
				this.renderBookList();
			},
			renderHeaderActions: (headerEl, detailEl) => {
				this.renderChoicesHelpDisclosure(headerEl, detailEl, {
					panelId: "kls-highlight-choice-help",
					triggerText: "?",
					triggerAccessibleLabel: "Show how choices work",
					isIcon: true,
					isOpen: this.isHighlightHelpOpen,
					onOpenChange: (isOpen) => {
						this.isHighlightHelpOpen = isOpen;
					},
				});
			},
			renderBeforeHighlights: (detailEl) => {
				this.renderCompletionFailure(detailEl);
			},
		});
		this.highlightListEl = detail.highlightsEl;

		for (const highlight of group.clippings) {
			const identity = createKindleHighlightIdentityKey(highlight);
			const choice = this.choices.get(identity);
			const { actionsEl: actions } = renderReviewHighlightRow(
				detail.highlightsEl,
				highlight.content.replace(/\s+/g, " ").slice(0, 180),
				highlight.location ? `Location ${highlight.location}` : undefined
			);

			this.createDecisionButton(actions, "Import", choice, "import")
				.onClick(() => {
					if (!this.setHighlightChoice(identity, "import")) {
						return;
					}
					const scrollTop = this.getCurrentScrollTop();
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

			this.createDecisionButton(actions, "Skip This Sync", choice, "skip")
				.onClick(() => {
					if (!this.setHighlightChoice(identity, "skip")) {
						return;
					}
					const scrollTop = this.getCurrentScrollTop();
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

			this.createDecisionButton(actions, "Ignore", choice, "ignore")
				.onClick(() => {
					if (!this.setHighlightChoice(identity, "ignore")) {
						return;
					}
					const scrollTop = this.getCurrentScrollTop();
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

		}

		const stickyActions = this.createStickyActions();
		this.addCancelButton(stickyActions);
	}

	private renderFinishConfirmation(): void {
		this.activeReviewRenderer = () => this.renderFinishConfirmation();
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: this.getTitle() });
		bodyEl.createEl("p", { text: "Some highlights have not been reviewed." });
		bodyEl.createEl("p", {
			text: "Highlights not reviewed yet will be skipped only for this sync and may appear again next time.",
		});
		this.renderCompletionFailure(bodyEl);

		const actions = this.createStickyActions();

		this.addFinishSyncButton(actions, true);
		createReviewBackButton(actions, "Back to Review")
			.onClick(() => this.renderBookList());
	}

	private setGroupChoice(group: KindleBookGroup, choice: FirstSyncChoice): boolean {
		if (!this.canMutateDecisions()) {
			return false;
		}

		for (const highlight of group.clippings) {
			this.choices.set(createKindleHighlightIdentityKey(highlight), choice);
		}

		return true;
	}

	private addImportAllBooksButton(containerEl: HTMLElement): void {
		const button = this.createActionButton(containerEl, "Import All Books", "subtle");

		button.buttonEl.addClass("kls-decision-button");
		button.buttonEl.addClass("kls-import-all-books-button");
		this.importAllBooksButtons.add(button);
		this.registerDecisionMutationButton(button);
		this.updateImportAllBooksButtonState(button);
		button.onClick(() => this.handleImportAllBooks());
	}

	private handleImportAllBooks(): void {
		if (!this.canImportAllBooks()) {
			return;
		}

		this.saveBookListPosition();
		this.shouldRestoreBookListScroll = true;
		if (this.hasCurrentSkipOrIgnoreChoices()) {
			this.renderImportAllBooksConfirmation();
			return;
		}

		this.applyImportAllBooks();
	}

	private renderImportAllBooksConfirmation(): void {
		this.isImportAllBooksConfirmationOpen = true;
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: "Import all books?" });
		bodyEl.createEl("p", {
			text: "Your current skip and ignore choices will change to import. Highlights ignored in earlier syncs won’t be affected.",
		});
		bodyEl.createEl("p", {
			text: "Nothing will be imported until you select finish sync.",
		});

		const actions = this.createStickyActions();

		this.createActionButton(actions, "Import All Books", "subtle")
			.onClick(() => this.confirmImportAllBooks());
		const keepCurrentButton = this.createActionButton(actions, "Keep Current Choices", "strong").setCta();

		keepCurrentButton.onClick(() => this.keepCurrentImportChoices());
		this.afterRender(() => keepCurrentButton.buttonEl.focus({ preventScroll: true }));
	}

	private confirmImportAllBooks(): void {
		if (!this.isImportAllBooksConfirmationOpen || !this.canImportAllBooks()) {
			return;
		}

		this.isImportAllBooksConfirmationOpen = false;
		this.applyImportAllBooks();
	}

	private keepCurrentImportChoices(): void {
		if (!this.isImportAllBooksConfirmationOpen) {
			return;
		}

		this.isImportAllBooksConfirmationOpen = false;
		this.shouldRestoreBookListScroll = true;
		this.renderBookList();
		const trigger = [...this.importAllBooksButtons][0];

		if (trigger) {
			this.afterRender(() => trigger.buttonEl.focus({ preventScroll: true }));
		}
	}

	private applyImportAllBooks(): void {
		if (!this.canImportAllBooks()) {
			return;
		}

		// Work from the review model so books hidden by search or filters receive the same temporary choice.
		for (const group of this.bookGroups) {
			for (const highlight of group.clippings) {
				this.choices.set(createKindleHighlightIdentityKey(highlight), "import");
			}
		}

		this.shouldRestoreBookListScroll = true;
		this.renderBookList();
	}

	private hasCurrentSkipOrIgnoreChoices(): boolean {
		return [...this.choices.values()].some((choice) => choice === "skip" || choice === "ignore");
	}

	private canImportAllBooks(): boolean {
		if (!this.canMutateDecisions() || this.savedIgnoreChoiceIdentities.size > 0) {
			return false;
		}

		const highlights = this.bookGroups.flatMap((group) => group.clippings);

		return highlights.length > 0 && highlights.some((highlight) =>
			this.choices.get(createKindleHighlightIdentityKey(highlight)) !== "import"
		);
	}

	private setHighlightChoice(identity: string, choice: FirstSyncChoice): boolean {
		if (!this.canMutateDecisions()) {
			return false;
		}

		this.choices.set(identity, choice);
		return true;
	}

	private getHighlightsByChoice(choice: FirstSyncChoice): KindleHighlight[] {
		return this.bookGroups.flatMap((group) =>
			group.clippings.filter((highlight) => this.choices.get(createKindleHighlightIdentityKey(highlight)) === choice)
		);
	}

	private getSkippedThisSyncHighlights(): SyncSummaryHighlightItem[] {
		return this.bookGroups.flatMap((group) =>
			group.clippings.flatMap((highlight) => {
				const choice = this.choices.get(createKindleHighlightIdentityKey(highlight));

				if (choice === "import" || choice === "ignore") {
					return [];
				}

				return [createReturningSyncSummaryHighlightItem(
					highlight,
					choice === "skip" ? "skipped" : "unreviewed"
				)];
			})
		);
	}

	private renderBookStatus(section: HTMLElement, status: BookStatus): void {
		const statusEl = section.createDiv();

		statusEl.addClass("kls-book-status");
		statusEl.addClass(`kls-book-status-${status.tone}`);
		const valueEl = statusEl.createEl("span", { text: status.text });

		valueEl.addClass("kls-status-badge");
		valueEl.addClass("kls-book-status-value");
		valueEl.addClass(`kls-status-badge-${status.tone}`);
	}

	private groupStatus(group: KindleBookGroup): BookStatus {
		const counts = this.countGroupChoices(group);
		const reviewedCount = countSelectedChoices(counts);
		const needsReviewCount = group.clippings.length - reviewedCount;

		// Undecided work takes precedence; only a complete uniform set may select a bulk action.
		if (needsReviewCount > 0) {
			return {
				text: "Needs Review",
				tone: "needs-review",
				isChecked: false,
				counts,
				selectedCount: reviewedCount,
				needsReviewCount,
			};
		}

		const selectedChoice = getUniformChoiceFromCounts(counts, group.clippings.length);

		if (selectedChoice) {
			const aggregateStatus: Record<FirstSyncChoice, string> = {
				import: "Import All",
				ignore: "Ignore All",
				skip: "Skipped This Sync",
			};
			return {
				text: aggregateStatus[selectedChoice],
				tone: selectedChoice,
				isChecked: true,
				counts,
				selectedCount: reviewedCount,
				needsReviewCount,
				selectedChoice,
			};
		}

		return {
			text: "Reviewed",
			tone: "reviewed",
			isChecked: true,
			counts,
			selectedCount: reviewedCount,
			needsReviewCount,
		};
	}

	private visibleBookEntries(): VisibleBookEntry[] {
		const normalizedSearch = normalizeSearch(this.bookSearchQuery);
		return this.bookGroups
			.map((group, originalIndex) => ({
				group,
				originalIndex,
				status: this.groupStatus(group),
			}))
			.filter(({ group, status }) =>
				matchesBookSearch(group, normalizedSearch) && matchesBookStatusFilter(status, this.bookStatusFilter)
			);
	}

	private countGroupChoices(group: KindleBookGroup): Map<FirstSyncChoice, number> {
		const counts = new Map<FirstSyncChoice, number>();

		for (const highlight of group.clippings) {
			const choice = this.choices.get(createKindleHighlightIdentityKey(highlight));

			if (choice) {
				counts.set(choice, (counts.get(choice) ?? 0) + 1);
			}
		}

		return counts;
	}

	private totalHighlights(): number {
		return this.bookGroups.reduce((total, group) => total + group.clippings.length, 0);
	}

	private reviewProgress(): ReviewProgress {
		const progress: ReviewProgress = {
			reviewedBooks: 0,
			notReviewedBooks: 0,
			ignoreHighlights: 0,
			skipThisSyncHighlights: 0,
			notReviewedHighlights: 0,
		};

		for (const group of this.bookGroups) {
			const counts = this.countGroupChoices(group);
			const selectedCount = countSelectedChoices(counts);

			if (selectedCount === group.clippings.length) {
				progress.reviewedBooks += 1;
			} else {
				progress.notReviewedBooks += 1;
			}

			progress.ignoreHighlights += counts.get("ignore") ?? 0;
			progress.skipThisSyncHighlights += counts.get("skip") ?? 0;
			progress.notReviewedHighlights += group.clippings.length - selectedCount;
		}

		return progress;
	}

	private createStickyActions(): HTMLElement {
		const actions = this.contentEl.createDiv();

		actions.addClass("kls-sticky-actions");
		actions.addClass("kls-button-row");
		return actions;
	}

	private createModalBody(): HTMLElement {
		this.decisionMutationButtons.clear();
		this.finishSyncButtons.clear();
		this.importAllBooksButtons.clear();
		this.contentEl.empty();
		this.contentEl.addClass("kls-first-sync-modal");

		const bodyEl = this.contentEl.createDiv();

		bodyEl.addClass("kls-modal-scroll-body");
		this.scrollBodyEl = bodyEl;
		this.highlightListEl = null;
		return bodyEl;
	}

	private createActionButton(
		containerEl: HTMLElement,
		text: string,
		treatment: ReviewButtonTreatment = "subtle"
	): ButtonComponent {
		return createReviewActionButton(containerEl, text, treatment);
	}

	private createDecisionButton(
		containerEl: HTMLElement,
		text: string,
		selectedChoice: FirstSyncChoice | undefined,
		buttonChoice: FirstSyncChoice,
		treatment: ReviewButtonTreatment = "subtle"
	): ButtonComponent {
		const button = buttonChoice === "skip"
			? createReviewSkipButton(containerEl)
			: this.createActionButton(containerEl, text, treatment);
		const isSelected = selectedChoice === buttonChoice;

		button.buttonEl.addClass("kls-decision-button");
		button.buttonEl.setAttribute("aria-pressed", isSelected ? "true" : "false");
		if (isSelected) {
			button.buttonEl.addClass("kls-decision-button-active");
			button.buttonEl.addClass(`kls-decision-button-active-${buttonChoice}`);
		}

		return this.registerDecisionMutationButton(button);
	}

	private addFinishSyncButton(containerEl: HTMLElement, skipConfirmation = false): void {
		const button = this.createActionButton(containerEl, "Finish Sync", "strong").setCta();

		this.finishSyncButtons.add(button);
		this.updateFinishSyncButtonState(button);
		button.onClick(async () => {
			await this.handleFinishSync(button, skipConfirmation);
		});
	}

	private addCancelButton(containerEl: HTMLElement): void {
		// Cancel exits through close(), unlike Back, so unsaved choices still receive the guard.
		this.createActionButton(containerEl, "Cancel")
			.onClick(() => this.close());
	}

	private async handleFinishSync(button: ButtonComponent, skipConfirmation: boolean): Promise<void> {
		if (this.isCompletionPending || this.hasCompletedSync) {
			return;
		}

		if (!skipConfirmation && this.reviewProgress().notReviewedHighlights > 0) {
			this.saveBookListPosition();
			this.shouldRestoreBookListScroll = true;
			this.renderFinishConfirmation();
			return;
		}

		if (!skipConfirmation) {
			this.saveBookListPosition();
			this.shouldRestoreBookListScroll = true;
		}

		await this.completeFirstSync(button);
	}

	private async completeFirstSync(button: ButtonComponent): Promise<void> {
		if (this.isCompletionPending || this.hasCompletedSync) {
			return;
		}

		this.setCompletionPending(button, true);
		const importHighlights = this.getHighlightsByChoice("import");
		const ignoreHighlights = this.getHighlightsByChoice("ignore");
		const skippedThisSyncHighlights = this.getSkippedThisSyncHighlights();

		try {
			const result = this.options.onComplete
				? await this.options.onComplete({
					importHighlights,
					ignoreHighlights,
					skippedThisSyncHighlights,
				})
				: await this.plugin.completeFirstSync(
					importHighlights,
					ignoreHighlights,
					skippedThisSyncHighlights,
					this.identityIndex
				);

			this.hasCompletedSync = true;
			this.setCompletionPending(button, false);
			this.close();
			new Notice(this.createCompletionNotice(result));
		} catch (error) {
			console.error("Kindle sync was not completed.", error);
			this.setCompletionPending(button, false);
			const ignoreChoicesSaved = error instanceof InvalidVaultWriteContractError
				&& error.preservedIgnoreCleanupResults.length > 0;

			if (ignoreChoicesSaved) {
				for (const highlight of ignoreHighlights) {
					this.savedIgnoreChoiceIdentities.add(createKindleHighlightIdentityKey(highlight));
				}
			}
			this.completionFailure = {
				ignoreChoicesSaved,
			};
			this.shouldFocusCompletionFailure = true;
			const scrollTop = this.getCurrentScrollTop();

			this.activeReviewRenderer?.();
			this.restoreScrollTopAfterRender(scrollTop);
		}
	}

	private setCompletionPending(button: ButtonComponent, pending: boolean): void {
		this.isCompletionPending = pending;
		this.updateDecisionMutationButtonStates();
		this.updateFinishSyncButtonStates();
		button.setDisabled(pending || this.hasCompletedSync);
		if (pending) {
			button.buttonEl.setAttribute("aria-busy", "true");
			this.contentEl.setAttribute("aria-busy", "true");
			return;
		}

		button.buttonEl.removeAttribute("aria-busy");
		this.contentEl.removeAttribute("aria-busy");
	}

	private registerDecisionMutationButton(button: ButtonComponent): ButtonComponent {
		this.decisionMutationButtons.add(button);
		button.setDisabled(!this.canMutateDecisions());
		return button;
	}

	private canMutateDecisions(): boolean {
		return !this.isCompletionPending && !this.hasCompletedSync;
	}

	private updateDecisionMutationButtonStates(): void {
		for (const button of this.decisionMutationButtons) {
			button.setDisabled(!this.canMutateDecisions());
		}

		for (const button of this.importAllBooksButtons) {
			this.updateImportAllBooksButtonState(button);
		}
	}

	private updateImportAllBooksButtonState(button: ButtonComponent): void {
		button.setDisabled(!this.canImportAllBooks());
	}

	private updateFinishSyncButtonStates(): void {
		for (const button of this.finishSyncButtons) {
			this.updateFinishSyncButtonState(button);
		}
	}

	private updateFinishSyncButtonState(button: ButtonComponent): void {
		const disabled = this.isCompletionPending || this.hasCompletedSync;

		button.setDisabled(disabled);
		if (this.isCompletionPending) {
			button.buttonEl.setAttribute("aria-busy", "true");
			return;
		}

		button.buttonEl.removeAttribute("aria-busy");
	}

	private renderCompletionFailure(containerEl: HTMLElement): void {
		if (!this.completionFailure) {
			return;
		}

		const failureEl = containerEl.createDiv();

		failureEl.addClass("kls-operation-failure");
		failureEl.setAttribute("role", "alert");
		failureEl.setAttribute("tabindex", "-1");
		failureEl.createEl("h3", { text: "Sync not completed" });
		failureEl.createEl("p", {
			text: this.completionFailure.ignoreChoicesSaved
				? "Your Ignore choices were saved, but we couldn’t complete the rest of the sync. Your other selections are still available here."
				: "We couldn’t confirm the final sync result. Your selections are still available here.",
		});
		failureEl.createEl("p", {
			text: "Some note changes may have occurred. Review your selections and try again.",
		});
		const actions = failureEl.createDiv();

		actions.addClass("kls-button-row");
		const retryButton = this.createActionButton(actions, "Try again", "strong").setCta();

		retryButton.onClick(async () => {
			await this.completeFirstSync(retryButton);
		});
		this.createActionButton(actions, "Return to review", "subtle")
			.onClick(() => {
				this.completionFailure = null;
				this.shouldRestoreBookListScroll = true;
				this.renderBookList();
			});

		if (this.shouldFocusCompletionFailure) {
			this.shouldFocusCompletionFailure = false;
			this.afterRender(() => failureEl.focus({ preventScroll: true }));
		}
	}

	private hasPendingDecisionChanges(): boolean {
		const identities = new Set([...this.initialChoices.keys(), ...this.choices.keys()]);

		for (const identity of identities) {
			const choice = this.choices.get(identity);

			if (this.savedIgnoreChoiceIdentities.has(identity) && choice === "ignore") {
				continue;
			}

			if (this.initialChoices.get(identity) !== choice) {
				return true;
			}
		}

		return false;
	}

	private renderDiscardConfirmation(): void {
		const renderer = this.activeReviewRenderer;
		const scrollTop = this.getCurrentScrollTop();

		this.isDiscardConfirmationOpen = true;
		this.resumeAfterDiscardConfirmation = renderer
			? () => {
				renderer();
				this.restoreScrollTopAfterRender(scrollTop);
			}
			: null;

		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: "Discard your selections?" });
		bodyEl.createEl("p", {
			text: this.savedIgnoreChoiceIdentities.size > 0
				? "Your remaining selections have not been saved."
				: "Your Import, Skip, and Ignore choices have not been saved.",
		});
		bodyEl.createEl("p", {
			text: "If you leave now, you’ll need to review these highlights again next time.",
		});

		const actions = this.createStickyActions();

		createReviewActionButton(actions, "Keep reviewing", "strong")
			.setCta()
			.onClick(() => this.keepReviewing());
		createReviewActionButton(actions, "Discard and exit", "subtle")
			.onClick(() => this.discardAndExit());
	}

	private keepReviewing(): void {
		const resume = this.resumeAfterDiscardConfirmation;

		this.isDiscardConfirmationOpen = false;
		this.resumeAfterDiscardConfirmation = null;
		resume?.();
	}

	private discardAndExit(): void {
		this.isDiscardConfirmationOpen = false;
		this.resumeAfterDiscardConfirmation = null;
		super.close();
	}

	private getTitle(): string {
		return this.options.title ?? "First Sync Preview";
	}

	private createCompletionNotice(result: SyncCompletionResult): string {
		return this.options.completionNotice?.(
			result.importedCount,
			result.protectedSelectedHighlightCount
		)
			?? `First sync ${result.protectedSelectedHighlightCount > 0 ? "finished" : "complete"}: ${result.importedCount} highlights imported.`;
	}

	private saveBookListPosition(): void {
		this.bookListScrollTop = this.getCurrentScrollTop();
	}

	private restoreBookListPosition(): void {
		const anchorKey = this.shouldRestoreBookListAnchor ? this.bookListReturnAnchorKey : null;
		const shouldRestoreScroll = this.shouldRestoreBookListScroll;

		this.shouldRestoreBookListAnchor = false;
		this.shouldRestoreBookListScroll = false;

		if (!anchorKey && !shouldRestoreScroll) {
			return;
		}

		this.afterRender(() => {
			if (shouldRestoreScroll) {
				this.setScrollTop(this.bookListScrollTop);
				return;
			}

			if (!anchorKey) {
				return;
			}

			const section = this.bookSectionEls.get(anchorKey);

			if (section && typeof section.scrollIntoView === "function") {
				section.scrollIntoView({ block: "center" });
				return;
			}

			this.setScrollTop(this.bookListScrollTop);
		});
	}

	private restoreScrollTopAfterRender(scrollTop: number): void {
		this.setScrollTop(scrollTop);
		this.afterRender(() => {
			this.setScrollTop(scrollTop);
		});
	}

	private scrollToTopAfterRender(): void {
		this.scrollToTop();
		this.afterRender(() => {
			this.scrollToTop();
		});
	}

	private scrollToTop(): void {
		this.setScrollTop(0);
	}

	private getCurrentScrollTop(): number {
		return this.highlightListEl?.scrollTop
			?? this.scrollBodyEl?.scrollTop
			?? this.contentEl.scrollTop;
	}

	private setScrollTop(scrollTop: number): void {
		this.contentEl.scrollTop = scrollTop;

		if (this.scrollBodyEl) {
			this.scrollBodyEl.scrollTop = scrollTop;
		}

		if (this.highlightListEl) {
			this.highlightListEl.scrollTop = scrollTop;
		}
	}

	private afterRender(callback: () => void): void {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(callback);
			return;
		}

		callback();
	}

}

function createBookAnchorKey(group: KindleBookGroup, index: number): string {
	return JSON.stringify([index, createBookIdentityKey(group.bookTitle, group.author)]);
}

function createBookReviewSummary(group: KindleBookGroup, status: BookStatus): string {
	const ignoreCount = status.counts.get("ignore") ?? 0;
	const skipCount = status.counts.get("skip") ?? 0;

	return [
		`${status.needsReviewCount} ${pluralize("highlight", status.needsReviewCount)} ${status.needsReviewCount === 1 ? "needs" : "need"} review`,
		`${ignoreCount} marked to ignore`,
		`${skipCount} skipped this sync`,
	].join(" · ");
}

function getBookTitleVariants(group: KindleBookGroup): string[] {
	const variants: string[] = [];

	for (const clipping of group.clippings) {
		if (clipping.bookTitle && !variants.includes(clipping.bookTitle)) {
			variants.push(clipping.bookTitle);
		}
	}

	if (group.bookTitle && !variants.includes(group.bookTitle)) {
		variants.push(group.bookTitle);
	}

	return variants;
}

function pluralize(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}

function normalizeSearch(value: string): string {
	return value.trim().toLowerCase();
}

function matchesBookSearch(group: KindleBookGroup, normalizedSearch: string): boolean {
	if (!normalizedSearch) {
		return true;
	}

	return [createCombinedReviewBookTitle({
		titles: getBookTitleVariants(group),
		author: group.author,
	}), group.author]
		.some((value) => value.toLowerCase().includes(normalizedSearch));
}

function matchesBookStatusFilter(status: BookStatus, filter: BookStatusFilter): boolean {
	switch (filter) {
		case "all":
			return true;
		case "needs-review":
			return !status.isChecked;
		case "checked":
			return status.isChecked;
	}
}

function countSelectedChoices(counts: Map<FirstSyncChoice, number>): number {
	return (counts.get("import") ?? 0) + (counts.get("ignore") ?? 0) + (counts.get("skip") ?? 0);
}

function getUniformChoiceFromCounts(
	counts: Map<FirstSyncChoice, number>,
	totalHighlights: number
): FirstSyncChoice | undefined {
	if (totalHighlights === 0) {
		return undefined;
	}

	return (["import", "ignore", "skip"] as const)
		.find((choice) => (counts.get(choice) ?? 0) === totalHighlights);
}
