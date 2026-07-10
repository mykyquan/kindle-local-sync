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
			text: "This vault already has Kindle highlight notes, but Kindle Local Sync has no saved data for this vault.",
		});
		this.contentEl.createEl("p", {
			text: "Choose how to continue:",
		});

		const continueOption = this.createOptionSection(
			"Continue with existing notes",
			[
				"Use this if these notes were already created by Kindle Local Sync.",
				"Existing notes stay as-is. New highlights will still require review before import.",
			]
		);

		new ButtonComponent(continueOption)
			.setButtonText("Continue with existing notes")
			.setCta()
			.onClick(async () => {
				this.close();
				await this.plugin.continueExistingNotesWithoutDataSync();
			});

		const reviewOption = this.createOptionSection(
			"Review everything before syncing",
			[
				"Use this if you want to check all detected books and highlights first.",
				"Nothing new will be imported until you finish review.",
			]
		);

		new ButtonComponent(reviewOption)
			.setButtonText("Review everything")
			.onClick(async () => {
				this.close();
				await this.plugin.reviewExistingNotesWithoutDataAsFirstSync();
			});

		const cancelOption = this.createOptionSection(
			"Cancel",
			"No settings or notes will be changed."
		);

		new ButtonComponent(cancelOption)
			.setButtonText("Cancel")
			.onClick(() => this.close());
	}

	private createOptionSection(title: string, description: string | string[]): HTMLElement {
		const section = this.contentEl.createDiv();
		section.createEl("h3", { text: title });
		const descriptionEl = section.createDiv();

		descriptionEl.addClass("kls-option-description");

		for (const paragraph of Array.isArray(description) ? description : [description]) {
			descriptionEl.createEl("p", { text: paragraph });
		}

		return section;
	}
}
