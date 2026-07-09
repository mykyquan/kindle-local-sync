/* eslint-disable obsidianmd/ui/sentence-case */
import { App, ButtonComponent, Modal } from "obsidian";
import type KindleLocalSyncPlugin from "./main";
import { IgnoredHighlight } from "./settings";

export class IgnoredHighlightsModal extends Modal {
	private readonly plugin: KindleLocalSyncPlugin;

	constructor(app: App, plugin: KindleLocalSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Ignored highlights" });

		if (this.plugin.settings.ignoredHighlights.length === 0) {
			this.contentEl.createEl("p", {
				text: "No ignored highlights. Highlights you ignore during sync will appear here.",
			});
			return;
		}

		for (const [title, highlights] of groupIgnoredHighlightsByTitle(this.plugin.settings.ignoredHighlights)) {
			this.contentEl.createEl("h3", { text: title });

			for (const highlight of highlights) {
				const row = this.contentEl.createDiv();
				row.createEl("p", { text: highlight.textPreview });
				row.createEl("p", { text: `Ignored ${new Date(highlight.ignoredAt).toLocaleDateString()}` });

				new ButtonComponent(row)
					.setButtonText("Remove From Ignore List")
					.onClick(async () => {
						await this.plugin.unignoreHighlight(highlight.id);
						this.onOpen();
					})
					.buttonEl.addClass("mod-warning");
			}
		}
	}
}

function groupIgnoredHighlightsByTitle(highlights: IgnoredHighlight[]): Map<string, IgnoredHighlight[]> {
	const groups = new Map<string, IgnoredHighlight[]>();

	for (const highlight of highlights) {
		const title = highlight.title || "Untitled Kindle Book";
		const group = groups.get(title) ?? [];

		group.push(highlight);
		groups.set(title, group);
	}

	return groups;
}
