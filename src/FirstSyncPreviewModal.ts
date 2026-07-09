/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { createSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";

type FirstSyncChoice = "import" | "ignore" | "skip";

interface ReviewProgress {
	reviewedBooks: number;
	partiallyReviewedBooks: number;
	notReviewedBooks: number;
	importHighlights: number;
	ignoreHighlights: number;
	skipThisSyncHighlights: number;
	notReviewedHighlights: number;
}

export class FirstSyncPreviewModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly bookGroups: KindleBookGroup[];
	private readonly choices = new Map<string, FirstSyncChoice>();
	private readonly bookSectionEls = new Map<string, HTMLElement>();
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
		this.contentEl.empty();
		this.bookSectionEls.clear();
		this.contentEl.createEl("h2", { text: "First Sync Preview" });
		this.contentEl.createEl("p", {
			text: `Found ${this.totalHighlights()} highlights from ${this.bookGroups.length} books.`,
		});
		this.contentEl.createEl("p", {
			text: "Kindle may keep deleted highlights in My Clippings.txt. Review before importing if you want to avoid bringing old deleted highlights into Obsidian.",
		});
		const stickyActions = this.createStickyActions();
		this.addFinishSyncButton(stickyActions);
		this.addCancelButton(stickyActions);
		this.renderReviewProgress();

		const choicesHelp = this.contentEl.createDiv();
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
			const section = this.contentEl.createDiv();

			this.bookSectionEls.set(bookKey, section);
			section.createEl("h3", { text: this.createBookLabel(group, index) });
			section.createEl("p", { text: `${group.clippings.length} highlights found` });

			const actions = section.createDiv();

			new ButtonComponent(actions)
				.setButtonText("Review Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.renderHighlightReview(group);
					this.scrollToTopAfterRender();
				});

			new ButtonComponent(actions)
				.setButtonText("Import All")
				.setCta()
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "import");
					this.renderBookList();
				});

			new ButtonComponent(actions)
				.setButtonText("Ignore All Highlights")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "ignore");
					this.renderBookList();
				});

			new ButtonComponent(actions)
				.setButtonText("Skip This Sync")
				.onClick(() => {
					this.saveBookListPosition();
					this.bookListReturnAnchorKey = bookKey;
					this.shouldRestoreBookListAnchor = true;
					this.setGroupChoice(group, "skip");
					this.renderBookList();
				});

			section.createEl("p", { text: this.groupStatus(group) });
		}

		const footer = this.contentEl.createDiv();

		this.addFinishSyncButton(footer);

		this.restoreBookListPosition();
	}

	private renderHighlightReview(group: KindleBookGroup): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: this.createBookLabel(group, this.getBookGroupIndex(group)) });

		const stickyActions = this.createStickyActions();
		this.addBackToBookListButton(stickyActions);
		this.addCancelButton(stickyActions);

		for (const highlight of group.clippings) {
			const id = createClippingId(highlight);
			const row = this.contentEl.createDiv();

			row.createEl("p", { text: createHighlightPreview(highlight) });

			const actions = row.createDiv();

			new ButtonComponent(actions)
				.setButtonText("Import")
				.setCta()
				.onClick(() => {
					this.choices.set(id, "import");
					this.renderHighlightReview(group);
				});

			new ButtonComponent(actions)
				.setButtonText("Skip This Sync")
				.onClick(() => {
					this.choices.set(id, "skip");
					this.renderHighlightReview(group);
				});

			new ButtonComponent(actions)
				.setButtonText("Ignore")
				.onClick(() => {
					this.choices.set(id, "ignore");
					this.renderHighlightReview(group);
				});

			const choice = this.choices.get(id);

			if (choice) {
				row.createEl("p", { text: `Selected: ${choice}` });
			}
		}
	}

	private renderFinishConfirmation(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "First Sync Preview" });
		this.contentEl.createEl("p", { text: "Some highlights have not been reviewed." });
		this.contentEl.createEl("p", {
			text: "Highlights not reviewed yet will be skipped only for this sync and may appear again next time.",
		});

		const actions = this.createStickyActions();

		this.addFinishSyncButton(actions, true);
		new ButtonComponent(actions)
			.setButtonText("Go Back")
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

	private groupStatus(group: KindleBookGroup): string {
		const counts = this.countGroupChoices(group);
		const reviewedCount = countSelectedChoices(counts);

		if (reviewedCount === 0) {
			return "Status: Not Reviewed Yet";
		}

		if (reviewedCount === group.clippings.length) {
			if ((counts.get("import") ?? 0) === group.clippings.length) {
				return "Status: All Current Highlights Selected To Import";
			}

			if ((counts.get("ignore") ?? 0) === group.clippings.length) {
				return "Status: All Current Highlights Selected To Ignore";
			}

			if ((counts.get("skip") ?? 0) === group.clippings.length) {
				return "Status: All Current Highlights Selected To Skip This Sync";
			}

			return `Status: Reviewed${formatChoiceCountSegments(counts)}`;
		}

		return `Status: Partially Reviewed${formatChoiceCountSegments(counts)}`;
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

	private renderReviewProgress(): void {
		const progress = this.reviewProgress();
		const progressEl = this.contentEl.createDiv();

		progressEl.createEl("h3", { text: "Review Progress" });
		progressEl.createEl("p", { text: `Reviewed: ${progress.reviewedBooks} of ${this.bookGroups.length} books` });
		progressEl.createEl("p", { text: `Partially Reviewed: ${progress.partiallyReviewedBooks} books` });
		progressEl.createEl("p", { text: `Not Reviewed: ${progress.notReviewedBooks} books` });
		progressEl.createEl("p", { text: `To Import: ${progress.importHighlights} highlights` });
		progressEl.createEl("p", { text: `To Ignore: ${progress.ignoreHighlights} highlights` });
		progressEl.createEl("p", { text: `To Skip This Sync: ${progress.skipThisSyncHighlights} highlights` });
		progressEl.createEl("p", { text: `Not Reviewed Yet: ${progress.notReviewedHighlights} highlights` });
	}

	private reviewProgress(): ReviewProgress {
		const progress: ReviewProgress = {
			reviewedBooks: 0,
			partiallyReviewedBooks: 0,
			notReviewedBooks: 0,
			importHighlights: 0,
			ignoreHighlights: 0,
			skipThisSyncHighlights: 0,
			notReviewedHighlights: 0,
		};

		for (const group of this.bookGroups) {
			const counts = this.countGroupChoices(group);
			const selectedCount = countSelectedChoices(counts);

			if (selectedCount === group.clippings.length) {
				progress.reviewedBooks += 1;
			} else if (selectedCount > 0) {
				progress.partiallyReviewedBooks += 1;
			} else {
				progress.notReviewedBooks += 1;
			}

			progress.importHighlights += counts.get("import") ?? 0;
			progress.ignoreHighlights += counts.get("ignore") ?? 0;
			progress.skipThisSyncHighlights += counts.get("skip") ?? 0;
			progress.notReviewedHighlights += group.clippings.length - selectedCount;
		}

		return progress;
	}

	private createStickyActions(): HTMLElement {
		const actions = this.contentEl.createDiv();

		actions.addClass("kls-sticky-actions");
		return actions;
	}

	private addFinishSyncButton(containerEl: HTMLElement, skipConfirmation = false): void {
		new ButtonComponent(containerEl)
			.setButtonText("Finish Sync")
			.setCta()
			.onClick(async () => {
				await this.handleFinishSync(skipConfirmation);
			});
	}

	private addBackToBookListButton(containerEl: HTMLElement): void {
		new ButtonComponent(containerEl)
			.setButtonText("Back To Book List")
			.onClick(() => {
				this.shouldRestoreBookListAnchor = true;
				this.renderBookList();
			});
	}

	private addCancelButton(containerEl: HTMLElement): void {
		new ButtonComponent(containerEl)
			.setButtonText("Cancel")
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
		this.bookListScrollTop = this.contentEl.scrollTop;
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

			this.contentEl.scrollTop = this.bookListScrollTop;
		});
	}

	private scrollToTopAfterRender(): void {
		this.afterRender(() => {
			this.contentEl.scrollTop = 0;
		});
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

function formatChoiceCountSegments(counts: Map<FirstSyncChoice, number>): string {
	const segments = [
		["import", "Import"],
		["ignore", "Ignore"],
		["skip", "Skip This Sync"],
	]
		.map(([choice, label]) => {
			const count = counts.get(choice as FirstSyncChoice) ?? 0;

			return count > 0 ? `${count} ${label}` : "";
		})
		.filter(Boolean);

	return segments.length > 0 ? ` · ${segments.join(" · ")}` : "";
}
