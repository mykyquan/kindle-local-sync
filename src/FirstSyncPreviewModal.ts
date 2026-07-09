import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId, KindleBookGroup } from "./render/renderMarkdown";
import { createSyncSummaryHighlightItem, SyncSummaryHighlightItem } from "./SyncSummaryTypes";

type FirstSyncChoice = "import" | "ignore" | "skip";

export class FirstSyncPreviewModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;
	private readonly bookGroups: KindleBookGroup[];
	private readonly choices = new Map<string, FirstSyncChoice>();

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
		this.contentEl.createEl("h2", { text: "First sync preview" });
		this.contentEl.createEl("p", {
			text: `Found ${this.totalHighlights()} highlights from ${this.bookGroups.length} books.`,
		});
			this.contentEl.createEl("p", {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text: "Kindle may keep deleted highlights in My Clippings.txt. Review before importing if you want to avoid bringing old deleted highlights into Obsidian.",
			});
			const choicesHelp = this.contentEl.createDiv();
			choicesHelp.createEl("p", { text: "How choices work:" });
			choicesHelp.createEl("p", { text: "Review highlights lets you decide highlight by highlight." });
			choicesHelp.createEl("p", { text: "Import all imports all currently found highlights from a book." });
			choicesHelp.createEl("p", { text: "Ignore all highlights skips the currently found highlights from that book in future syncs." });
			choicesHelp.createEl("p", { text: "Skip this sync only skips them now; they may appear again next time." });

			for (const group of this.bookGroups) {
				const section = this.contentEl.createDiv();
				section.createEl("h3", { text: group.bookTitle });
				section.createEl("p", { text: `${group.clippings.length} highlights found` });

				const actions = section.createDiv();

				new ButtonComponent(actions)
					.setButtonText("Review highlights")
					.onClick(() => this.renderHighlightReview(group));

				new ButtonComponent(actions)
					.setButtonText("Import all")
					.setCta()
					.onClick(() => {
						this.setGroupChoice(group, "import");
						this.renderBookList();
					});

				new ButtonComponent(actions)
					.setButtonText("Ignore all highlights")
					.onClick(() => {
						this.setGroupChoice(group, "ignore");
						this.renderBookList();
					});

				new ButtonComponent(actions)
					.setButtonText("Skip this sync")
				.onClick(() => {
					this.setGroupChoice(group, "skip");
						this.renderBookList();
					});

				const status = this.groupStatus(group);

			if (status) {
				section.createEl("p", { text: status });
			}
		}

		const footer = this.contentEl.createDiv();

		new ButtonComponent(footer)
			.setButtonText("Finish sync")
			.setCta()
				.onClick(async () => {
					const importHighlights = this.getHighlightsByChoice("import");
					const ignoreHighlights = this.getHighlightsByChoice("ignore");
					const skippedThisSyncHighlights = this.getSkippedThisSyncHighlights();

					await this.plugin.completeFirstSync(importHighlights, ignoreHighlights, skippedThisSyncHighlights);
					this.close();
					new Notice(`First sync complete: ${importHighlights.length} highlights imported.`);
				});
	}

	private renderHighlightReview(group: KindleBookGroup): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: group.bookTitle });

		new ButtonComponent(this.contentEl)
			.setButtonText("Back to book list")
			.onClick(() => this.renderBookList());

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
					.setButtonText("Skip this sync")
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
		const counts = new Map<FirstSyncChoice, number>();

		for (const highlight of group.clippings) {
			const choice = this.choices.get(createClippingId(highlight));

			if (choice) {
				counts.set(choice, (counts.get(choice) ?? 0) + 1);
			}
		}

		return [
			["import", "import"],
			["ignore", "ignore"],
			["skip", "skip"],
		]
			.map(([choice, label]) => `${counts.get(choice as FirstSyncChoice) ?? 0} ${label}`)
			.join(", ");
	}

	private totalHighlights(): number {
		return this.bookGroups.reduce((total, group) => total + group.clippings.length, 0);
	}
}

function createHighlightPreview(highlight: KindleHighlight): string {
	const location = highlight.location ? `Location ${highlight.location}: ` : "";

	return `${location}${highlight.content.replace(/\s+/g, " ").slice(0, 180)}`;
}
