import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

interface KindleSyncSettings {
	clippingsPath: string;
	highlightsFolder: string;
	strictLocalOnly: boolean;
}

const DEFAULT_SETTINGS: KindleSyncSettings = {
	clippingsPath: "",
	highlightsFolder: "Kindle Highlights",
	strictLocalOnly: true,
};

export default class KindleSyncPlugin extends Plugin {
	settings: KindleSyncSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon("book-open", "Sync Local Kindle Highlights", () => {
			void this.syncHighlights();
		});

		this.addCommand({
			id: "sync-local-kindle-highlights",
			name: "Sync Local Kindle Highlights",
			callback: () => {
				void this.syncHighlights();
			},
		});

		this.addSettingTab(new KindleSettingTab(this.app, this));
	}

	onunload(): void {
		console.log("Kindle Local Sync unloaded");
	}

	async syncHighlights(): Promise<void> {
		new Notice("Sync process started...");
	}

	async loadSettings(): Promise<void> {
		const loadedData = (await this.loadData()) as Partial<KindleSyncSettings> | null;

		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedData,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class KindleSettingTab extends PluginSettingTab {
	plugin: KindleSyncPlugin;

	constructor(app: App, plugin: KindleSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Kindle Local Sync" });

		new Setting(containerEl)
			.setName("My Clippings.txt Path")
			.setDesc(
				"Input the absolute path to your Kindle's text file. Examples: Windows: E:\\documents\\My Clippings.txt, macOS: /Volumes/Kindle/documents/My Clippings.txt, Linux: /media/username/Kindle/documents/My Clippings.txt"
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.clippingsPath)
					.onChange(async (value) => {
						this.plugin.settings.clippingsPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Highlights Folder")
			.setDesc("The Obsidian folder where synced Kindle highlights will be stored.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.highlightsFolder)
					.onChange(async (value) => {
						this.plugin.settings.highlightsFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strict Local Only")
			.setDesc("Keep all sync behavior local-only, with no external APIs or network requests.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.strictLocalOnly)
					.onChange(async (value) => {
						this.plugin.settings.strictLocalOnly = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
