import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import {
	createClippingId,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "./render/renderMarkdown";

const mocks = vi.hoisted(() => {
	const highlight = {
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight" as const,
	};

	return {
		highlight,
		detectClippingsPath: vi.fn(),
		readClippingsFile: vi.fn(),
		parseClippings: vi.fn(),
		firstSyncPreviewOpen: vi.fn(),
		firstSyncPreviewOptions: [] as Array<{ title?: string } | undefined>,
		writeBookNotesToVault: vi.fn(),
		highlightExistsInNote: vi.fn(),
	};
});

vi.mock("./sync/KindleDetector", () => ({
	detectClippingsPath: mocks.detectClippingsPath,
}));

vi.mock("./sync/ClippingsReader", () => ({
	readClippingsFile: mocks.readClippingsFile,
}));

vi.mock("./parser/parseClippings", () => ({
	parseClippings: mocks.parseClippings,
}));

vi.mock("./FirstSyncPreviewModal", () => ({
	FirstSyncPreviewModal: class {
		constructor(_app: unknown, _plugin: unknown, _bookGroups: unknown, options?: { title?: string }) {
			mocks.firstSyncPreviewOptions.push(options);
		}

		open(): void {
			mocks.firstSyncPreviewOpen();
		}
	},
}));

vi.mock("./sync/VaultWriter", async () => {
	const actual = await vi.importActual<typeof import("./sync/VaultWriter")>("./sync/VaultWriter");

	return {
		...actual,
		writeBookNotesToVault: mocks.writeBookNotesToVault,
	};
});

vi.mock("./sync/VaultHighlightLookup", () => ({
	createVaultHighlightLookup: () => mocks.highlightExistsInNote,
}));

let KindleLocalSyncPlugin: typeof import("./main").default;
let ExistingNotesWithoutDataModal: typeof import("./ExistingNotesWithoutDataModal").ExistingNotesWithoutDataModal;

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
	ExistingNotesWithoutDataModal = (await import("./ExistingNotesWithoutDataModal")).ExistingNotesWithoutDataModal;
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectClippingsPath.mockResolvedValue("/Volumes/Kindle/documents/My Clippings.txt");
	mocks.readClippingsFile.mockResolvedValue("raw clippings");
	mocks.parseClippings.mockReturnValue([mocks.highlight]);
	mocks.firstSyncPreviewOpen.mockClear();
	mocks.firstSyncPreviewOptions.length = 0;
	mocks.writeBookNotesToVault.mockResolvedValue({
		books: 1,
		filesCreated: 0,
		filesUpdated: 1,
		filesUnchanged: 0,
		filesProtected: 0,
		highlightsRendered: 1,
		duplicatesSkipped: 0,
		bookOutcomes: [{
			bookTitle: mocks.highlight.bookTitle,
			author: mocks.highlight.author,
			notePath: "Kindle Highlights/The Clockwork Orchard - Mira Vale.md",
			highlightIds: [createClippingId(mocks.highlight)],
			status: "updated",
		}],
	});
	mocks.highlightExistsInNote.mockResolvedValue(true);
});

describe("existing notes without data.json", () => {
	it("still opens reconnect after the real settings-save path creates config-only data", async () => {
		const plugin = createPlugin(createVaultWithExistingNotes());

		plugin.settings.clippingsPath = "/Users/test/QA Input/My Clippings.txt";
		await plugin.saveSettings();
		await plugin.syncHighlights();

		expect(mocks.firstSyncPreviewOpen).not.toHaveBeenCalled();
		expect(mocks.detectClippingsPath).not.toHaveBeenCalled();
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});

	it("Continue as existing vault saves hasCompletedFirstSync true", async () => {
		const plugin = createPlugin(createVaultWithExistingNotes());
		const saveCalls = captureSaveCalls(plugin);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(saveCalls[0]).toMatchObject({
			hasCompletedFirstSync: true,
		});
	});

	it("Continue as existing vault records matched existing highlights as trusted imports", async () => {
		const plugin = createPlugin(createVaultWithExistingNotes());
		const saveCalls = captureSaveCalls(plugin);

		await plugin.continueExistingNotesWithoutDataSync();

		expect(saveCalls[0]).toMatchObject({
			ignoredHighlights: [],
		});
		expect((saveCalls[0] as { importedHighlights: Array<{ id: string }> }).importedHighlights.map((highlight) => highlight.id)).toEqual([
			createClippingId(mocks.highlight),
		]);
	});

	it("internal review-all method keeps hasCompletedFirstSync false and opens full review", async () => {
		const plugin = createPlugin(createVaultWithExistingNotes());
		const saveCalls = captureSaveCalls(plugin);

		await plugin.reviewExistingNotesWithoutDataAsFirstSync();

		expect(saveCalls[0]).toMatchObject({
			hasCompletedFirstSync: false,
		});
		expect(mocks.firstSyncPreviewOpen).toHaveBeenCalledTimes(1);
		expect(mocks.firstSyncPreviewOptions[0]?.title).toBe("Review All Detected Highlights");
	});

	it("Cancel does not save settings or sync", async () => {
		const plugin = {
			continueExistingNotesWithoutDataSync: vi.fn(),
			reviewExistingNotesWithoutDataAsFirstSync: vi.fn(),
		};
		const modal = new ExistingNotesWithoutDataModal(
			new App(createVaultWithExistingNotes()) as never,
			plugin as never
		);

		modal.onOpen();
		await findByText(modal.contentEl, "Cancel").click();

		expect(plugin.continueExistingNotesWithoutDataSync).not.toHaveBeenCalled();
		expect(plugin.reviewExistingNotesWithoutDataAsFirstSync).not.toHaveBeenCalled();
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
	});
});

describe("ExistingNotesWithoutDataModal improved layout", () => {
	it("uses concise button labels in Existing Notes Without Data modal", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(buttonTexts(modal.contentEl)).toEqual([
			"Continue with existing notes",
			"Cancel",
		]);
	});

	it("shows the approved title, intro, and explanation copy", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Existing Kindle notes found");
		expect(readText(modal.contentEl)).toContain(
			"You can continue with these notes instead of starting over."
		);
		expect(readText(modal.contentEl)).toContain(
			"Your notes will stay in place. Kindle Local Sync will recognize the highlights already there and only ask you to review the ones it doesn’t find."
		);
		expect(readText(modal.contentEl)).toContain(
			"If you removed a highlight from a note but it is still in your Kindle file, choose Ignore during review to keep it from returning."
		);
	});

	it("uses one heading-free Liquid Glass card with one compact action row", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		const content = modal.contentEl as unknown as TestElement;
		const cards = elementsByClass(content, "kls-glass-card");
		const actions = elementsByClass(content, "kls-reconnect-actions");
		const reconnectButton = findButtonByText(content, "Continue with existing notes");
		const cancelButton = findButtonByText(content, "Cancel");

		expect(content.classes.has("kls-glass-scope")).toBe(true);
		expect(content.classes.has("kls-reconnect-modal")).toBe(true);
		expect(cards).toHaveLength(1);
		expect(cards[0]?.classes.has("kls-reconnect-card")).toBe(true);
		expect(cards[0]?.children.some((child) => child.tagName === "h3")).toBe(false);
		expect(actions).toHaveLength(1);
		expect(actions[0]?.classes.has("kls-button-row")).toBe(true);
		expect(buttonTexts(actions[0])).toEqual(["Continue with existing notes", "Cancel"]);
		expect(reconnectButton.classes.has("kls-action-button")).toBe(true);
		expect(reconnectButton.classes.has("kls-pill-button")).toBe(true);
		expect(reconnectButton.classes.has("kls-glass-strong")).toBe(true);
		expect(cancelButton.classes.has("kls-action-button")).toBe(true);
		expect(cancelButton.classes.has("kls-pill-button")).toBe(true);
		expect(cancelButton.classes.has("kls-glass-subtle")).toBe(true);
	});

	it("does not show old first-sync-only or confusing wording", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(readText(modal.contentEl)).not.toContain("Review As First Sync");
		expect(readText(modal.contentEl)).not.toContain("before importing again");
		expect(readText(modal.contentEl)).not.toContain("managed markers");
		expect(readText(modal.contentEl)).not.toContain("saved data");
		expect(readText(modal.contentEl)).not.toContain("Review everything before syncing");
		expect(readText(modal.contentEl)).not.toContain("Review everything");
		expect(readText(modal.contentEl)).not.toContain("Review all detected highlights");
		expect(readText(modal.contentEl).toLowerCase()).not.toContain("reconnect");
	});

	it("keeps both explanations together inside the content card", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-reconnect-description")).toHaveLength(1);
		expect(paragraphTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"Your notes will stay in place. Kindle Local Sync will recognize the highlights already there and only ask you to review the ones it doesn’t find.",
			"If you removed a highlight from a note but it is still in your Kindle file, choose Ignore during review to keep it from returning.",
		]));
	});

	it("keeps the internal reconnect callback unchanged", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);

		modal.onOpen();
		await findButtonByText(modal.contentEl, "Continue with existing notes").click();

		expect(plugin.continueExistingNotesWithoutDataSync).toHaveBeenCalledTimes(1);
		expect(plugin.reviewExistingNotesWithoutDataAsFirstSync).not.toHaveBeenCalled();
	});

	it("keeps Cancel behavior unchanged", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);

		modal.onOpen();
		await findButtonByText(modal.contentEl, "Cancel").click();

		expect(plugin.continueExistingNotesWithoutDataSync).not.toHaveBeenCalled();
		expect(plugin.reviewExistingNotesWithoutDataAsFirstSync).not.toHaveBeenCalled();
	});

	it("keeps native close and Escape-style close requests available while idle", () => {
		const modal = createModal(createTransitionPlugin());
		const onClose = vi.spyOn(modal, "onClose");

		modal.onOpen();
		modal.close();

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("stays open, exposes busy state, and prevents duplicate reconnect requests while pending", async () => {
		const plugin = createTransitionPlugin();
		const reconnect = createDeferred<boolean>();
		const modal = createModal(plugin);
		const onClose = vi.spyOn(modal, "onClose");

		plugin.continueExistingNotesWithoutDataSync.mockReturnValueOnce(reconnect.promise);
		modal.onOpen();
		const reconnectButton = findButtonByText(modal.contentEl, "Continue with existing notes");
		const cancelButton = findButtonByText(modal.contentEl, "Cancel");
		const firstClick = reconnectButton.click();

		await Promise.resolve();
		expect(onClose).not.toHaveBeenCalled();
		modal.close();
		expect(onClose).not.toHaveBeenCalled();
		expect(reconnectButton.disabled).toBe(true);
		expect(cancelButton.disabled).toBe(true);
		expect(reconnectButton.attributes.get("aria-busy")).toBe("true");
		expect((modal.contentEl as unknown as TestElement).attributes.get("aria-busy")).toBe("true");
		await reconnectButton.click();
		expect(plugin.continueExistingNotesWithoutDataSync).toHaveBeenCalledTimes(1);

		reconnect.resolve(true);
		await firstClick;
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("stays open when reconnect does not reach a completed transition", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);
		const onClose = vi.spyOn(modal, "onClose");

		plugin.continueExistingNotesWithoutDataSync.mockResolvedValueOnce(false);
		modal.onOpen();
		await findButtonByText(modal.contentEl, "Continue with existing notes").click();

		expect(onClose).not.toHaveBeenCalled();
		expect(findButtonByText(modal.contentEl, "Continue with existing notes").disabled).toBe(false);
		expect((modal.contentEl as unknown as TestElement).attributes.has("aria-busy")).toBe(false);
	});

	it("shows an accessible failure in place and retries without reopening", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);
		const onClose = vi.spyOn(modal, "onClose");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.continueExistingNotesWithoutDataSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findButtonByText(modal.contentEl, "Continue with existing notes").click();

		const failure = elementByClass(modal.contentEl, "kls-operation-failure");
		const content = modal.contentEl as unknown as TestElement;
		const card = elementByClass(content, "kls-reconnect-card");
		const retryButton = findButtonByText(modal.contentEl, "Try again");
		const cancelButton = findButtonByText(modal.contentEl, "Cancel");

		expect(onClose).not.toHaveBeenCalled();
		expect(content.children.indexOf(failure)).toBeLessThan(content.children.indexOf(card));
		expect(elementsByClass(content, "kls-glass-card")).toHaveLength(1);
		expect(buttonTexts(card)).toEqual(["Try again", "Cancel"]);
		expect(failure.classes.has("kls-reconnect-failure")).toBe(true);
		expect(failure.attributes.get("role")).toBe("alert");
		expect(failure.attributes.get("tabindex")).toBe("-1");
		expect(failure.focusCalls).toBe(1);
		expect(readText(failure)).toContain("Couldn’t continue with these notes");
		expect(readText(failure)).toContain(
			"We couldn’t save this step. Some note changes may already have been made, so try again to finish."
		);
		expect(readText(failure)).not.toContain("unchanged");
		expect(readText(content).toLowerCase()).not.toContain("reconnect");
		expect(retryButton.classes.has("kls-action-button")).toBe(true);
		expect(retryButton.classes.has("kls-pill-button")).toBe(true);
		expect(retryButton.classes.has("kls-glass-strong")).toBe(true);
		expect(cancelButton.classes.has("kls-glass-subtle")).toBe(true);

		await retryButton.click();
		expect(plugin.continueExistingNotesWithoutDataSync).toHaveBeenCalledTimes(2);
		expect(onClose).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	it("keeps Cancel available after failure without starting another reconnect", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);
		const onClose = vi.spyOn(modal, "onClose");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.continueExistingNotesWithoutDataSync.mockRejectedValueOnce(new Error("Disk write failed."));
		modal.onOpen();
		await findButtonByText(modal.contentEl, "Continue with existing notes").click();
		await findButtonByText(modal.contentEl, "Cancel").click();

		expect(plugin.continueExistingNotesWithoutDataSync).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});

	it("prevents repeated retry requests while the reconnect retry is pending", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);
		const retry = createDeferred<boolean>();
		const onClose = vi.spyOn(modal, "onClose");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.continueExistingNotesWithoutDataSync
			.mockRejectedValueOnce(new Error("Disk write failed."))
			.mockReturnValueOnce(retry.promise);
		modal.onOpen();
		await findButtonByText(modal.contentEl, "Continue with existing notes").click();
		const retryButton = findButtonByText(modal.contentEl, "Try again");
		const retryClick = retryButton.click();

		await Promise.resolve();
		expect(retryButton.disabled).toBe(true);
		await retryButton.click();
		expect(plugin.continueExistingNotesWithoutDataSync).toHaveBeenCalledTimes(2);
		expect(onClose).not.toHaveBeenCalled();

		retry.resolve(true);
		await retryClick;
		expect(onClose).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});
});

function createPlugin(vault: unknown): InstanceType<typeof KindleLocalSyncPlugin> {
	return new KindleLocalSyncPlugin(new App(vault) as never, {} as never);
}

function createModal(plugin: ReturnType<typeof createTransitionPlugin>) {
	return new ExistingNotesWithoutDataModal(
		new App(createVaultWithExistingNotes()) as never,
		plugin as never
	);
}

function createTransitionPlugin() {
	return {
		continueExistingNotesWithoutDataSync: vi.fn(async (): Promise<boolean> => true),
		reviewExistingNotesWithoutDataAsFirstSync: vi.fn(async () => {}),
	};
}

function captureSaveCalls(plugin: InstanceType<typeof KindleLocalSyncPlugin>): unknown[] {
	const saveCalls: unknown[] = [];
	const pluginWithSaveData = plugin as unknown as { saveData: (data: unknown) => Promise<void> };
	const saveData = pluginWithSaveData.saveData.bind(plugin);

	pluginWithSaveData.saveData = vi.fn(async (data: unknown) => {
		saveCalls.push(JSON.parse(JSON.stringify(data)) as unknown);
		await saveData(data);
	});

	return saveCalls;
}

function createVaultWithExistingNotes() {
	const file = {
		extension: "md",
		content: [
			SYNC_START_MARKER,
			`<!-- kindle-local-sync-id: ${createClippingId(mocks.highlight)} -->`,
			SYNC_END_MARKER,
		].join("\n"),
	};

	return {
		getAbstractFileByPath: (path: string) => {
			if (path !== "Kindle Highlights") {
				return null;
			}

			return {
				children: [file],
			};
		},
		read: async () => file.content,
	};
}

interface TestElement {
	tagName: string;
	children: TestElement[];
	classes: Set<string>;
	attributes: Map<string, string>;
	disabled: boolean;
	focusCalls: number;
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});

	return { promise, resolve };
}

function readText(element: unknown): string {
	return (element as TestElement).text();
}

function findByText(element: unknown, text: string): TestElement {
	const match = (element as TestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find text: ${text}`);
	}

	return match;
}

function findButtonByText(element: unknown, text: string): TestElement {
	const match = findButton((element as TestElement), text);

	if (!match) {
		throw new Error(`Could not find button text: ${text}`);
	}

	return match;
}

function findButton(element: TestElement, text: string): TestElement | null {
	if (element.tagName === "button" && element.text() === text) {
		return element;
	}

	for (const child of element.children) {
		const match = findButton(child, text);

		if (match) {
			return match;
		}
	}

	return null;
}

function buttonTexts(element: unknown): string[] {
	const texts: string[] = [];
	collectButtonTexts(element as TestElement, texts);

	return texts;
}

function collectButtonTexts(element: TestElement, texts: string[]): void {
	if (element.tagName === "button") {
		texts.push(element.text());
	}

	for (const child of element.children) {
		collectButtonTexts(child, texts);
	}
}

function paragraphTexts(element: unknown): string[] {
	const paragraphs: string[] = [];
	collectParagraphTexts(element as TestElement, paragraphs);

	return paragraphs;
}

function elementsByClass(element: unknown, className: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByClass(element as TestElement, className, matches);

	return matches;
}

function elementByClass(element: unknown, className: string): TestElement {
	const match = elementsByClass(element, className)[0];

	if (!match) {
		throw new Error(`Could not find class: ${className}`);
	}

	return match;
}

function collectParagraphTexts(element: TestElement, paragraphs: string[]): void {
	if (element.tagName === "p") {
		paragraphs.push(element.text());
	}

	for (const child of element.children) {
		collectParagraphTexts(child, paragraphs);
	}
}

function collectElementsByClass(element: TestElement, className: string, matches: TestElement[]): void {
	if (element.classes.has(className)) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByClass(child, className, matches);
	}
}
