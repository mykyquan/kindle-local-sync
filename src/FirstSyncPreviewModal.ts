/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { createSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";

type FirstSyncChoice = "import" | "ignore" | "skip";
type BookStatusTone = "ready-to-import" | "ignored" | "skipped-this-sync" | "mixed-decisions" | "needs-review";
type BookStatusFilter = "all" | "needs-review" | "checked";

export interface FirstSyncReviewCompletion {
	importHighlights: KindleHighlight[];
	ignoreHighlights: KindleHighlight[];
	skippedThisSyncHighlights: SyncSummaryHighlightItem[];
}

export interface FirstSyncPreviewModalOptions {
	title?: string;
	completionNotice?: (importedCount: number) => string;
	onComplete?: (completion: FirstSyncReviewCompletion) => Promise<void>;
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
}

interface VisibleBookEntry {
	group: KindleBookGroup;
	originalIndex: number;
	status: BookStatus;
}

export class FirstSyncPreviewModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly bookGroups: KindleBookGroup[];
	private readonly options: FirstSyncPreviewModalOptions;
	private readonly choices = new Map<string, FirstSyncChoice>();
	private readonly bookSectionEls = new Map<string, HTMLElement>();
	private readonly filterButtonEls = new Map<BookStatusFilter, HTMLElement>();
	private scrollBodyEl: HTMLElement | null = null;
	private bookListContentEl: HTMLElement | null = null;
	private choicesHelpPanelEl: HTMLElement | null = null;
	private bookListReturnAnchorKey: string | null = null;
	private bookListScrollTop = 0;
	private shouldRestoreBookListAnchor = false;
	private shouldRestoreBookListScroll = false;
	private isChoicesHelpOpen = false;
	private bookSearchQuery = "";
	private bookStatusFilter: BookStatusFilter = "all";

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
	}

	onOpen(): void {
		this.renderBookList();
	}

	private renderBookList(): void {
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: this.getTitle() });
		bodyEl.createEl("p", {
			text: `Found ${this.totalHighlights()} ${pluralize("highlight", this.totalHighlights())} from ${this.bookGroups.length} ${pluralize("book", this.bookGroups.length)}.`,
		});
		this.renderKindleWarning(bodyEl);
		this.renderStickyReviewSummary(bodyEl);

		this.bookListContentEl = bodyEl.createDiv();
		this.bookListContentEl.addClass("kls-book-list");
		this.renderVisibleBookCards();

		const footer = this.createStickyActions();

		this.addFinishSyncButton(footer);
		this.addCancelButton(footer);

		this.restoreBookListPosition();
	}

	private renderKindleWarning(bodyEl: HTMLElement): void {
		const warningEl = bodyEl.createDiv();

		warningEl.addClass("kls-review-warning-callout");
		warningEl.createEl("p", {
			text: "Kindle may keep deleted highlights in My Clippings.txt.",
		});
		warningEl.createEl("p", {
			text: "Review before importing to avoid bringing old deleted highlights into Obsidian.",
		});
	}

	private renderVisibleBookCards(): void {
		const bookListEl = this.bookListContentEl;

		if (!bookListEl) {
			return;
		}

		bookListEl.empty();
		this.bookSectionEls.clear();

		const visibleBooks = this.visibleBookEntries();

		if (visibleBooks.length === 0) {
			bookListEl.createEl("p", { text: "No matching books." }).addClass("kls-empty-state");
		}

		for (const { group, originalIndex, status } of visibleBooks) {
			const bookKey = createBookAnchorKey(group, originalIndex);
			const section = bookListEl.createDiv();
			section.addClass("kls-book-section");
			section.addClass("kls-book-card");

			this.bookSectionEls.set(bookKey, section);
			const header = section.createDiv();
			header.addClass("kls-book-header");

			const titleEl = header.createEl("h3", { text: this.createBookLabel(group, originalIndex) });
			titleEl.addClass("kls-book-title");

			this.createActionButton(header, "Review Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.renderHighlightReview(group);
					this.scrollToTopAfterRender();
				});

			if (group.author && group.author.toLowerCase() !== "unknown") {
				section.createEl("p", { text: group.author }).addClass("kls-book-meta");
			}

			this.renderBookStatus(section, status);
			section.createEl("p", { text: createBookReviewSummary(group, status) }).addClass("kls-book-review-summary");

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createActionButton(actions, "Import All")
				.setCta()
				.onClick(() => {
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.setGroupChoice(group, "import");
					this.renderBookList();
				});

			this.createActionButton(actions, "Ignore All Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.setGroupChoice(group, "ignore");
					this.renderBookList();
				});

			this.createActionButton(actions, "Skip This Sync")
				.onClick(() => {
					this.saveBookListPosition();
					this.shouldRestoreBookListScroll = true;
					this.setGroupChoice(group, "skip");
					this.renderBookList();
				});
		}
	}

	private renderBookListControls(bodyEl: HTMLElement): void {
		const controls = bodyEl.createDiv();
		controls.addClass("kls-book-list-controls");
		this.filterButtonEls.clear();

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

		this.createFilterButton(filters, "All", "all");
		this.createFilterButton(filters, "Needs Review", "needs-review");
		this.createFilterButton(filters, "Checked", "checked");
		this.updateBookFilterButtonStates();
	}

	private renderStickyReviewSummary(bodyEl: HTMLElement): void {
		const stickySummary = bodyEl.createDiv();
		const controlsPanel = stickySummary.createDiv();

		stickySummary.addClass("kls-review-sticky-summary");
		controlsPanel.addClass("kls-review-controls-panel");
		this.renderBookListControls(controlsPanel);
		this.renderChoicesHelpToggle(controlsPanel);
		this.renderCompactReviewProgress(controlsPanel);
	}

	private renderCompactReviewProgress(containerEl: HTMLElement): void {
		const progress = this.reviewProgress();
		const progressEl = containerEl.createDiv();

		progressEl.addClass("kls-compact-review-progress");
		this.createProgressChip(progressEl, `Checked: ${progress.reviewedBooks}/${this.bookGroups.length} books`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Need Review: ${progress.notReviewedBooks} books`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Ignore: ${progress.ignoreHighlights} ${pluralize("highlight", progress.ignoreHighlights)}`);
		this.createProgressSeparator(progressEl);
		this.createProgressChip(progressEl, `Skip: ${progress.skipThisSyncHighlights} ${pluralize("highlight", progress.skipThisSyncHighlights)}`);
	}

	private createProgressChip(containerEl: HTMLElement, text: string): void {
		containerEl.createEl("span", { text }).addClass("kls-progress-chip");
	}

	private createProgressSeparator(containerEl: HTMLElement): void {
		containerEl.createEl("span", { text: "·" }).addClass("kls-progress-separator");
	}

	private renderChoicesHelpToggle(containerEl: HTMLElement): void {
		const helpActions = containerEl.createDiv();

		helpActions.addClass("kls-choice-help-actions");
		helpActions.addClass("kls-button-row");
		this.addChoicesHelpButton(helpActions);

		this.createChoicesHelpPanel(containerEl);
	}

	private createChoicesHelpPanel(containerEl: HTMLElement): void {
		this.choicesHelpPanelEl = containerEl.createDiv();
		this.choicesHelpPanelEl.addClass("kls-choice-help-panel");
		this.renderChoicesHelpPanel();
	}

	private renderChoicesHelpPanel(): void {
		const panelEl = this.choicesHelpPanelEl;

		if (!panelEl) {
			return;
		}

		panelEl.empty();
		if (!this.isChoicesHelpOpen) {
			panelEl.addClass("kls-choice-help-panel-closed");
			return;
		}

		panelEl.removeClass("kls-choice-help-panel-closed");
		panelEl.createEl("h3", { text: "Counts" });
		const countsList = panelEl.createEl("ul");

		countsList.addClass("kls-choice-help");
		countsList.createEl("li", { text: "Checked / Need Review = books." });
		countsList.createEl("li", { text: "Ignore / Skip = individual highlights." });

		panelEl.createEl("h3", { text: "Actions" });
		const actionsList = panelEl.createEl("ul");

		actionsList.addClass("kls-choice-help");
		actionsList.createEl("li", { text: "Review Highlights: choose item by item for one book." });
		actionsList.createEl("li", { text: "Import All: import this book's current highlights." });
		actionsList.createEl("li", {
			text: "Ignore All Highlights: ignore this book's current highlights in future syncs.",
		});
		actionsList.createEl("li", {
			text: "Skip This Sync: skip this run only. Skipped highlights may return next sync.",
		});

		panelEl.createEl("h3", { text: "Finish Sync" });
		const finishSyncList = panelEl.createEl("ul");

		finishSyncList.addClass("kls-choice-help");
		finishSyncList.createEl("li", {
			text: "Unreviewed highlights are skipped for this sync and may return next time.",
		});
	}

	private toggleChoicesHelp(): void {
		const scrollTop = this.getCurrentScrollTop();

		this.isChoicesHelpOpen = !this.isChoicesHelpOpen;
		this.renderChoicesHelpPanel();
		this.restoreScrollTopAfterRender(scrollTop);
	}

	private createFilterButton(containerEl: HTMLElement, label: string, filter: BookStatusFilter): void {
		const button = this.createActionButton(containerEl, label);

		button.buttonEl.addClass("kls-book-filter-button");
		this.filterButtonEls.set(filter, button.buttonEl);

		button.onClick(() => {
			this.bookStatusFilter = filter;
			this.updateBookFilterButtonStates();
			this.renderVisibleBookCards();
		});
	}

	private updateBookFilterButtonStates(): void {
		for (const [filter, buttonEl] of this.filterButtonEls.entries()) {
			if (this.bookStatusFilter === filter) {
				buttonEl.addClass("mod-cta");
				buttonEl.addClass("kls-book-filter-button-active");
			} else {
				buttonEl.removeClass("mod-cta");
				buttonEl.removeClass("kls-book-filter-button-active");
			}
		}
	}

	private renderHighlightReview(group: KindleBookGroup): void {
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: this.createBookLabel(group, this.getBookGroupIndex(group)) });
		this.renderChoicesHelpToggle(bodyEl);

		for (const highlight of group.clippings) {
			const id = createClippingId(highlight);
			const choice = this.choices.get(id);
			const row = bodyEl.createDiv();
			row.addClass("kls-highlight-row");

			row.createEl("p", { text: createHighlightPreview(highlight) });

			const actions = row.createDiv();
			actions.addClass("kls-button-row");

			this.createDecisionButton(actions, "Import", choice, "import")
				.onClick(() => {
					const scrollTop = this.getCurrentScrollTop();
					this.choices.set(id, "import");
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

			this.createDecisionButton(actions, "Skip This Sync", choice, "skip")
				.onClick(() => {
					const scrollTop = this.getCurrentScrollTop();
					this.choices.set(id, "skip");
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

			this.createDecisionButton(actions, "Ignore", choice, "ignore")
				.onClick(() => {
					const scrollTop = this.getCurrentScrollTop();
					this.choices.set(id, "ignore");
					this.renderHighlightReview(group);
					this.restoreScrollTopAfterRender(scrollTop);
				});

			if (choice) {
				this.renderSelectedDecision(row, choice);
			}
		}

		const stickyActions = this.createStickyActions();
		this.addBackToBookListButton(stickyActions);
		this.addCancelButton(stickyActions);
	}

	private renderFinishConfirmation(): void {
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: this.getTitle() });
		bodyEl.createEl("p", { text: "Some highlights have not been reviewed." });
		bodyEl.createEl("p", {
			text: "Highlights not reviewed yet will be skipped only for this sync and may appear again next time.",
		});

		this.renderChoicesHelpToggle(bodyEl);
		const actions = this.createStickyActions();

		this.addFinishSyncButton(actions, true);
		this.createActionButton(actions, "Go Back")
			.onClick(() => this.renderBookList());
	}

	private setGroupChoice(group: KindleBookGroup, choice: FirstSyncChoice): void {
		for (const highlight of group.clippings) {
			this.choices.set(createClippingId(highlight), choice);
		}
	}

	private getHighlightsByChoice(choice: FirstSyncChoice): KindleHighlight[] {
		return this.bookGroups.flatMap((group) =>
			group.clippings.filter((highlight) => this.choices.get(createClippingId(highlight)) === choice)
		);
	}

	private getSkippedThisSyncHighlights(): SyncSummaryHighlightItem[] {
		return this.bookGroups.flatMap((group) =>
			group.clippings
				.filter((highlight) => {
					const choice = this.choices.get(createClippingId(highlight));

					return choice !== "import" && choice !== "ignore";
				})
				.map(createSyncSummaryHighlightItem)
		);
	}

	private renderBookStatus(section: HTMLElement, status: BookStatus): void {
		const statusEl = section.createDiv();

		statusEl.addClass("kls-book-status");
		statusEl.addClass(`kls-book-status-${status.tone}`);
		statusEl.createEl("span", { text: "Status:" }).addClass("kls-book-status-label");
		const valueEl = statusEl.createEl("span", { text: status.text });

		valueEl.addClass("kls-status-badge");
		valueEl.addClass("kls-book-status-value");
		valueEl.addClass(`kls-status-badge-${status.tone}`);
	}

	private renderSelectedDecision(row: HTMLElement, choice: FirstSyncChoice): void {
		const selectedEl = row.createDiv();

		selectedEl.addClass("kls-selected-decision");
		selectedEl.createEl("span", { text: "Selected:" }).addClass("kls-selected-decision-label");
		const valueEl = selectedEl.createEl("span", { text: getChoiceLabel(choice) });

		valueEl.addClass("kls-status-badge");
		valueEl.addClass("kls-selected-decision-value");
		valueEl.addClass(`kls-selected-decision-value-${choice}`);
	}

	private groupStatus(group: KindleBookGroup): BookStatus {
		const counts = this.countGroupChoices(group);
		const reviewedCount = countSelectedChoices(counts);
		const needsReviewCount = group.clippings.length - reviewedCount;

		if (reviewedCount === 0) {
			return {
				text: "Needs Review",
				tone: "needs-review",
				isChecked: false,
				counts,
				selectedCount: reviewedCount,
				needsReviewCount,
			};
		}

		if (reviewedCount === group.clippings.length) {
			if ((counts.get("import") ?? 0) === group.clippings.length) {
				return {
					text: "Ready to Import",
					tone: "ready-to-import",
					isChecked: true,
					counts,
					selectedCount: reviewedCount,
					needsReviewCount,
				};
			}

			if ((counts.get("ignore") ?? 0) === group.clippings.length) {
				return {
					text: "Ignored",
					tone: "ignored",
					isChecked: true,
					counts,
					selectedCount: reviewedCount,
					needsReviewCount,
				};
			}

			if ((counts.get("skip") ?? 0) === group.clippings.length) {
				return {
					text: "Skipped This Sync",
					tone: "skipped-this-sync",
					isChecked: true,
					counts,
					selectedCount: reviewedCount,
					needsReviewCount,
				};
			}

			return {
				text: "Mixed Decisions",
				tone: "mixed-decisions",
				isChecked: true,
				counts,
				selectedCount: reviewedCount,
				needsReviewCount,
			};
		}

		return {
			text: "Needs Review",
			tone: "needs-review",
			isChecked: false,
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
			const choice = this.choices.get(createClippingId(highlight));

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
		this.contentEl.empty();
		this.contentEl.addClass("kls-first-sync-modal");
		this.choicesHelpPanelEl = null;

		const bodyEl = this.contentEl.createDiv();

		bodyEl.addClass("kls-modal-scroll-body");
		this.scrollBodyEl = bodyEl;
		return bodyEl;
	}

	private createActionButton(containerEl: HTMLElement, text: string): ButtonComponent {
		const button = new ButtonComponent(containerEl).setButtonText(text);

		button.buttonEl.addClass("kls-action-button");
		return button;
	}

	private createDecisionButton(
		containerEl: HTMLElement,
		text: string,
		selectedChoice: FirstSyncChoice | undefined,
		buttonChoice: FirstSyncChoice
	): ButtonComponent {
		const button = this.createActionButton(containerEl, text);

		button.buttonEl.addClass("kls-decision-button");
		if (selectedChoice === buttonChoice) {
			button.setCta();
			button.buttonEl.addClass("kls-decision-button-active");
			button.buttonEl.addClass(`kls-decision-button-active-${buttonChoice}`);
		}

		return button;
	}

	private addFinishSyncButton(containerEl: HTMLElement, skipConfirmation = false): void {
		this.createActionButton(containerEl, "Finish Sync")
			.setCta()
			.onClick(async () => {
				await this.handleFinishSync(skipConfirmation);
			});
	}

	private addBackToBookListButton(containerEl: HTMLElement): void {
		this.createActionButton(containerEl, "Back To Book List")
			.onClick(() => {
				this.shouldRestoreBookListAnchor = true;
				this.renderBookList();
			});
	}

	private addChoicesHelpButton(containerEl: HTMLElement): void {
		const button = this.createActionButton(containerEl, "How choices work");

		button.buttonEl.addClass("kls-help-button");
		button
			.onClick(() => this.toggleChoicesHelp());
	}

	private addCancelButton(containerEl: HTMLElement): void {
		this.createActionButton(containerEl, "Cancel")
			.onClick(() => this.close());
	}

	private async handleFinishSync(skipConfirmation: boolean): Promise<void> {
		if (!skipConfirmation && this.reviewProgress().notReviewedHighlights > 0) {
			this.renderFinishConfirmation();
			return;
		}

		await this.completeFirstSync();
	}

	private async completeFirstSync(): Promise<void> {
		const importHighlights = this.getHighlightsByChoice("import");
		const ignoreHighlights = this.getHighlightsByChoice("ignore");
		const skippedThisSyncHighlights = this.getSkippedThisSyncHighlights();

		if (this.options.onComplete) {
			await this.options.onComplete({
				importHighlights,
				ignoreHighlights,
				skippedThisSyncHighlights,
			});
		} else {
			await this.plugin.completeFirstSync(importHighlights, ignoreHighlights, skippedThisSyncHighlights);
		}

		this.close();
		new Notice(this.createCompletionNotice(importHighlights.length));
	}

	private getTitle(): string {
		return this.options.title ?? "First Sync Preview";
	}

	private createCompletionNotice(importedCount: number): string {
		return this.options.completionNotice?.(importedCount)
			?? `First sync complete: ${importedCount} highlights imported.`;
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
		return this.scrollBodyEl?.scrollTop || this.contentEl.scrollTop;
	}

	private setScrollTop(scrollTop: number): void {
		this.contentEl.scrollTop = scrollTop;

		if (this.scrollBodyEl) {
			this.scrollBodyEl.scrollTop = scrollTop;
		}
	}

	private afterRender(callback: () => void): void {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(callback);
			return;
		}

		callback();
	}

	private createBookLabel(group: KindleBookGroup, index: number): string {
		return `${index + 1} of ${this.bookGroups.length} — ${group.bookTitle}`;
	}

	private getBookGroupIndex(group: KindleBookGroup): number {
		const index = this.bookGroups.indexOf(group);

		return index === -1 ? 0 : index;
	}
}

function createHighlightPreview(highlight: KindleHighlight): string {
	const location = highlight.location ? `Location ${highlight.location}: ` : "";

	return `${location}${highlight.content.replace(/\s+/g, " ").slice(0, 180)}`;
}

function createBookAnchorKey(group: KindleBookGroup, index: number): string {
	return `${index}:${group.bookTitle}:${group.author}`;
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

	return [group.bookTitle, group.author]
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

function getChoiceLabel(choice: FirstSyncChoice): string {
	switch (choice) {
		case "import":
			return "Import";
		case "ignore":
			return "Ignore";
		case "skip":
			return "Skip This Sync";
	}
}
