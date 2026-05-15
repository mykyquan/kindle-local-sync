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

		this.addRibbonIcon("book-open", "Sync local kindle highlights", () => {
			void this.syncHighlights();
		});

		this.addCommand({
			id: "sync-local-kindle-highlights",
			name: "Sync local kindle highlights",
			callback: () => {
				void this.syncHighlights();
			},
		});

		this.addSettingTab(new KindleSettingTab(this.app, this));
	}

	onunload(): void {
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

		new Setting(containerEl).setName("Sync").setHeading();

		new Setting(containerEl)
			.setName("My clippings.txt path")
			.setDesc(
				"Input the absolute path to your kindle's text file. Examples: windows: E:\\documents\\My clippings.txt, macOS: /Volumes/Kindle/documents/My Clippings.txt, linux: /media/username/Kindle/documents/My Clippings.txt"
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
			.setName("Highlights folder")
			.setDesc("The folder where synced kindle highlights will be stored.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.highlightsFolder)
					.onChange(async (value) => {
						this.plugin.settings.highlightsFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strict local only")
			.setDesc("Keep all sync behavior local-only, with no external services or network requests.")
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
