type ClickHandler = () => void | Promise<void>;
type InputHandler = () => void | Promise<void>;

export class MockElement {
	tagName: string;
	textContent = "";
	children: MockElement[] = [];
	classes = new Set<string>();
	scrollTop = 0;
	scrollIntoViewCalls: unknown[] = [];
	type = "";
	placeholder = "";
	value = "";
	iconName = "";
	focusCalls = 0;
	attributes = new Map<string, string>();
	private clickHandler: ClickHandler | null = null;
	private inputHandler: InputHandler | null = null;

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

	removeClass(className: string): void {
		this.classes.delete(className);
	}

	setText(text: string): void {
		this.textContent = text;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	onClick(handler: ClickHandler): void {
		this.clickHandler = handler;
	}

	addEventListener(eventName: string, handler: InputHandler): void {
		if (eventName === "input") {
			this.inputHandler = handler;
		}
	}

	async click(): Promise<void> {
		await this.clickHandler?.();
	}

	async input(value: string): Promise<void> {
		this.value = value;
		await this.inputHandler?.();
	}

	focus(): void {
		this.focusCalls += 1;
	}

	scrollIntoView(options?: unknown): void {
		this.scrollIntoViewCalls.push(options);
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

export function getFrontMatterInfo(content: string): {
	exists: boolean;
	frontmatter: string;
	from: number;
	to: number;
	contentStart: number;
} {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

	if (!match || match[1] === undefined) {
		return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
	}

	return {
		exists: true,
		frontmatter: match[1],
		from: 4,
		to: 4 + match[1].length,
		contentStart: match[0].length,
	};
}

export function parseYaml(yaml: string): unknown {
	const parsed: Record<string, unknown> = {};

	for (const line of yaml.split(/\r?\n/)) {
		const separatorIndex = line.indexOf(":");

		if (separatorIndex === -1) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const rawValue = line.slice(separatorIndex + 1).trim();

		if (!key) {
			continue;
		}

		if (rawValue.startsWith("\"") && rawValue.endsWith("\"")) {
			parsed[key] = JSON.parse(rawValue);
		} else {
			parsed[key] = rawValue;
		}
	}

	return parsed;
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

export function setIcon(element: MockElement, iconName: string): void {
	element.iconName = iconName;
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
