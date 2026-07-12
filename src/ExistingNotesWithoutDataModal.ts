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
		this.contentEl.createEl("h2", { text: "Existing Kindle notes found" });
		this.contentEl.createEl("p", {
			text: "This vault already has Kindle notes. Kindle Local Sync can reconnect to them and continue from there.",
		});

		const continueOption = this.createOptionSection(
			"Reconnect existing notes",
			[
				"We'll keep your existing notes, recognize the highlights we can match, and only ask you to review anything new or missing from those notes.",
				"Your existing notes will not be deleted. If a highlight is still in your Kindle file but no longer in your notes, you can review it and ignore it so it does not come back.",
			]
		);

		new ButtonComponent(continueOption)
			.setButtonText("Reconnect existing notes")
			.setCta()
			.onClick(async () => {
				this.close();
				await this.plugin.continueExistingNotesWithoutDataSync();
			});

		const cancelOption = this.createOptionSection(
			"Cancel",
			"Close without changing your notes or sync settings."
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
