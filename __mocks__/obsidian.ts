type ClickHandler = () => void | Promise<void>;

export class MockElement {
	tagName: string;
	textContent = "";
	children: MockElement[] = [];
	classes = new Set<string>();
	private clickHandler: ClickHandler | null = null;

	constructor(tagName = "div", text = "") {
		this.tagName = tagName;
		this.textContent = text;
	}

	createEl(tagName: string, options: { text?: string } = {}): MockElement {
		const child = new MockElement(tagName, options.text ?? "");
		this.children.push(child);

		return child;
	}

	createDiv(): MockElement {
		return this.createEl("div");
	}

	empty(): void {
		this.textContent = "";
		this.children = [];
	}

	addClass(className: string): void {
		this.classes.add(className);
	}

	setText(text: string): void {
		this.textContent = text;
	}

	onClick(handler: ClickHandler): void {
		this.clickHandler = handler;
	}

	async click(): Promise<void> {
		await this.clickHandler?.();
	}

	text(): string {
		return [
			this.textContent,
			...this.children.map((child) => child.text()),
		].filter(Boolean).join(" ");
	}

	findByText(text: string): MockElement | null {
		if (this.textContent === text) {
			return this;
		}

		for (const child of this.children) {
			const match = child.findByText(text);

			if (match) {
				return match;
			}
		}

		return null;
	}
}

export class App {
	vault: unknown;

	constructor(vault: unknown = {}) {
		this.vault = vault;
	}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export class Modal {
	app: App;
	contentEl = new MockElement();

	constructor(app: App) {
		this.app = app;
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {
	}

	onClose(): void {
	}
}

export class ButtonComponent {
	buttonEl: MockElement;

	constructor(containerEl: MockElement) {
		this.buttonEl = containerEl.createEl("button");
	}

	setButtonText(text: string): this {
		this.buttonEl.setText(text);
		return this;
	}

	setCta(): this {
		this.buttonEl.addClass("mod-cta");
		return this;
	}

	onClick(handler: ClickHandler): this {
		this.buttonEl.onClick(handler);
		return this;
	}
}

export class Plugin {
	app: App;
	private loadedData: unknown = null;
	savedData: unknown = null;
	commands: unknown[] = [];

	constructor(app = new App()) {
		this.app = app;
	}

	async loadData(): Promise<unknown> {
		return this.loadedData;
	}

	async saveData(data: unknown): Promise<void> {
		this.savedData = data;
	}

	setLoadedData(data: unknown): void {
		this.loadedData = data;
	}

	addRibbonIcon(): void {
	}

	addCommand(command: unknown): void {
		this.commands.push(command);
	}

	addSettingTab(): void {
	}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = new MockElement();

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor(public containerEl: MockElement) {
	}

	setName(): this {
		return this;
	}

	setDesc(): this {
		return this;
	}

	setHeading(): this {
		return this;
	}

	addText(): this {
		return this;
	}

	addToggle(): this {
		return this;
	}
}
