/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";

export class ExistingNotesWithoutDataModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Existing Kindle highlight notes found" });
		this.contentEl.createEl("p", {
			text: "This vault already contains Kindle highlight notes, but Kindle Local Sync does not have saved plugin data for this vault.",
		});
		this.contentEl.createEl("p", {
			text: "Choose how you want to continue:",
		});

		const continueOption = this.createOptionSection(
			"Continue with existing notes",
			[
				"Choose this if these notes were already created by Kindle Local Sync.",
				"We'll keep your existing notes and continue syncing from here.",
			]
		);

		new ButtonComponent(continueOption)
			.setButtonText("Continue With Existing Notes")
			.setCta()
			.onClick(async () => {
				this.close();
				await this.plugin.continueExistingNotesWithoutDataSync();
			});

		const reviewOption = this.createOptionSection(
			"Review everything before syncing",
			"Choose this if you want to review books and highlights before importing again."
		);

		new ButtonComponent(reviewOption)
			.setButtonText("Review As First Sync")
			.onClick(async () => {
				this.close();
				await this.plugin.reviewExistingNotesWithoutDataAsFirstSync();
			});

		const cancelOption = this.createOptionSection(
			"Cancel",
			"Do nothing for now. No settings or notes will be changed."
		);

		new ButtonComponent(cancelOption)
			.setButtonText("Cancel")
			.onClick(() => this.close());
	}

	private createOptionSection(title: string, description: string | string[]): HTMLElement {
		const section = this.contentEl.createDiv();
		section.createEl("h3", { text: title });

		for (const paragraph of Array.isArray(description) ? description : [description]) {
			section.createEl("p", { text: paragraph });
		}

		return section;
	}
}
