/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { createSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";

type FirstSyncChoice = "import" | "ignore" | "skip";
type BookStatusTone = "ready-to-import" | "ignored" | "skipped-this-sync" | "mixed-decisions" | "needs-review";

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
}

export class FirstSyncPreviewModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly bookGroups: KindleBookGroup[];
	private readonly choices = new Map<string, FirstSyncChoice>();
	private readonly bookSectionEls = new Map<string, HTMLElement>();
	private scrollBodyEl: HTMLElement | null = null;
	private bookListReturnAnchorKey: string | null = null;
	private bookListScrollTop = 0;
	private shouldRestoreBookListAnchor = false;

	constructor(app: App, plugin: KindleLocalSyncPlugin, bookGroups: KindleBookGroup[]) {
		super(app);
		this.plugin = plugin;
		this.bookGroups = bookGroups;
	}

	onOpen(): void {
		this.renderBookList();
	}

	private renderBookList(): void {
		const bodyEl = this.createModalBody();

		this.bookSectionEls.clear();
		bodyEl.createEl("h2", { text: "First Sync Preview" });
		bodyEl.createEl("p", {
			text: `Found ${this.totalHighlights()} highlights from ${this.bookGroups.length} books.`,
		});
		bodyEl.createEl("p", {
			text: "Kindle may keep deleted highlights in My Clippings.txt. Review before importing if you want to avoid bringing old deleted highlights into Obsidian.",
		});
		this.renderReviewProgress(bodyEl);

		const choicesHelp = bodyEl.createDiv();
		choicesHelp.addClass("kls-section");
		choicesHelp.createEl("p", { text: "How choices work:" });
		const choicesList = choicesHelp.createEl("ul");
		choicesList.addClass("kls-choice-help");

		choicesList.createEl("li", { text: "Review highlights: Choose item by item." });
		choicesList.createEl("li", { text: "Import all: Import all current highlights from this book." });
		choicesList.createEl("li", {
			text: "Ignore all highlights: Ignore current highlights from this book in future syncs and remove existing generated blocks when safe.",
		});
		choicesList.createEl("li", {
			text: "Skip this sync: Skip only this run. They may appear again next time.",
		});

		for (const [index, group] of this.bookGroups.entries()) {
			const bookKey = createBookAnchorKey(group, index);
			const section = bodyEl.createDiv();
			section.addClass("kls-book-section");

			this.bookSectionEls.set(bookKey, section);
			section.createEl("h3", { text: this.createBookLabel(group, index) });
			section.createEl("p", { text: `${group.clippings.length} highlights found` });

			const actions = section.createDiv();
			actions.addClass("kls-button-row");
			actions.addClass("kls-book-actions");

			this.createActionButton(actions, "Review Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.renderHighlightReview(group);
					this.scrollToTopAfterRender();
				});

			this.createActionButton(actions, "Import All")
				.setCta()
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "import");
					this.renderBookList();
				});

			this.createActionButton(actions, "Ignore All Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "ignore");
					this.renderBookList();
				});

			this.createActionButton(actions, "Skip This Sync")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "skip");
					this.renderBookList();
				});

			this.renderBookStatus(section, group);
		}

		const footer = this.createStickyActions();

		this.addFinishSyncButton(footer);
		this.addCancelButton(footer);

		this.restoreBookListPosition();
	}

	private renderHighlightReview(group: KindleBookGroup): void {
		const bodyEl = this.createModalBody();

		bodyEl.createEl("h2", { text: this.createBookLabel(group, this.getBookGroupIndex(group)) });

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
					this.choices.set(id, "import");
					this.renderHighlightReview(group);
				});

			this.createDecisionButton(actions, "Skip This Sync", choice, "skip")
				.onClick(() => {
					this.choices.set(id, "skip");
					this.renderHighlightReview(group);
				});

			this.createDecisionButton(actions, "Ignore", choice, "ignore")
				.onClick(() => {
					this.choices.set(id, "ignore");
					this.renderHighlightReview(group);
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

		bodyEl.createEl("h2", { text: "First Sync Preview" });
		bodyEl.createEl("p", { text: "Some highlights have not been reviewed." });
		bodyEl.createEl("p", {
			text: "Highlights not reviewed yet will be skipped only for this sync and may appear again next time.",
		});

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

	private renderBookStatus(section: HTMLElement, group: KindleBookGroup): void {
		const status = this.groupStatus(group);
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

		if (reviewedCount === 0) {
			return { text: "Needs Review", tone: "needs-review" };
		}

		if (reviewedCount === group.clippings.length) {
			if ((counts.get("import") ?? 0) === group.clippings.length) {
				return { text: "Ready to Import", tone: "ready-to-import" };
			}

			if ((counts.get("ignore") ?? 0) === group.clippings.length) {
				return { text: "Ignored", tone: "ignored" };
			}

			if ((counts.get("skip") ?? 0) === group.clippings.length) {
				return { text: "Skipped This Sync", tone: "skipped-this-sync" };
			}

			return { text: "Mixed Decisions", tone: "mixed-decisions" };
		}

		return { text: "Needs Review", tone: "needs-review" };
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

	private renderReviewProgress(containerEl: HTMLElement): void {
		const progress = this.reviewProgress();
		const progressEl = containerEl.createDiv();

		progressEl.addClass("kls-section");
		progressEl.addClass("kls-review-progress");

		progressEl.createEl("h3", { text: "Review Progress" });
		const groupsEl = progressEl.createDiv();
		groupsEl.addClass("kls-review-progress-groups");

		const booksEl = groupsEl.createDiv();
		booksEl.addClass("kls-review-progress-group");
		booksEl.createEl("h4", { text: "Books" });
		const booksList = booksEl.createEl("ul");
		booksList.createEl("li", { text: `Checked: ${progress.reviewedBooks} of ${this.bookGroups.length} books` });
		booksList.createEl("li", { text: `Still Need Review: ${progress.notReviewedBooks} books` });

		const decisionsEl = groupsEl.createDiv();
		decisionsEl.addClass("kls-review-progress-group");
		decisionsEl.createEl("h4", { text: "Highlight Decisions" });
		const decisionsList = decisionsEl.createEl("ul");
		decisionsList.createEl("li", { text: `Marked to Ignore: ${progress.ignoreHighlights} highlights` });
		decisionsList.createEl("li", { text: `Skipped This Sync: ${progress.skipThisSyncHighlights} highlights` });
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

		await this.plugin.completeFirstSync(importHighlights, ignoreHighlights, skippedThisSyncHighlights);
		this.close();
		new Notice(`First sync complete: ${importHighlights.length} highlights imported.`);
	}

	private saveBookListPosition(): void {
		this.bookListScrollTop = this.getCurrentScrollTop();
	}

	private restoreBookListPosition(): void {
		const anchorKey = this.shouldRestoreBookListAnchor ? this.bookListReturnAnchorKey : null;

		this.shouldRestoreBookListAnchor = false;

		if (!anchorKey) {
			return;
		}

		this.afterRender(() => {
			const section = this.bookSectionEls.get(anchorKey);

			if (section && typeof section.scrollIntoView === "function") {
				section.scrollIntoView({ block: "center" });
				return;
			}

			this.setScrollTop(this.bookListScrollTop);
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
