import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { createClippingId } from "./render/renderMarkdown";

const mocks = vi.hoisted(() => {
	const highlight = {
		bookTitle: "Atomic Habits",
		author: "James Clear",
		location: "154",
		content: "Small habits make a big difference.",
		dateAdded: "Thursday, May 14, 2026 2:44 PM",
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

vi.mock("./sync/VaultWriter", () => ({
	writeBookNotesToVault: mocks.writeBookNotesToVault,
}));

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
		highlightsRendered: 1,
		duplicatesSkipped: 0,
	});
	mocks.highlightExistsInNote.mockResolvedValue(true);
});

describe("existing notes without data.json", () => {
	it("does not show first sync preview immediately when existing notes are found", async () => {
		const plugin = createPlugin(createVaultWithExistingNotes());

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
			"Reconnect existing notes",
			"Cancel",
		]);
	});

	it("shows the improved option titles", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Reconnect existing notes");
		expect(readText(modal.contentEl)).toContain("Cancel");
	});

	it("shows descriptions for each option", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"This vault already has Kindle notes. Kindle Local Sync can reconnect to them and continue from there."
		);
		expect(readText(modal.contentEl)).toContain(
			"We'll keep your existing notes, recognize the highlights we can match, and only ask you to review anything new or missing from those notes."
		);
		expect(readText(modal.contentEl)).toContain(
			"Your existing notes will not be deleted. If a highlight is still in your Kindle file but no longer in your notes, you can review it and ignore it so it does not come back."
		);
		expect(readText(modal.contentEl)).toContain(
			"Close without changing your notes or sync settings."
		);
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
	});

	it("visually nests option descriptions under their titles", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(elementsByClass(modal.contentEl, "kls-option-description")).toHaveLength(2);
	});

	it("shows the Reconnect existing notes explanation", () => {
		const modal = createModal(createTransitionPlugin());

		modal.onOpen();

		expect(paragraphTexts(modal.contentEl)).toEqual(expect.arrayContaining([
			"We'll keep your existing notes, recognize the highlights we can match, and only ask you to review anything new or missing from those notes.",
			"Your existing notes will not be deleted. If a highlight is still in your Kindle file but no longer in your notes, you can review it and ignore it so it does not come back.",
		]));
	});

	it("keeps Reconnect existing notes behavior unchanged", async () => {
		const plugin = createTransitionPlugin();
		const modal = createModal(plugin);

		modal.onOpen();
		await findButtonByText(modal.contentEl, "Reconnect existing notes").click();

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
		continueExistingNotesWithoutDataSync: vi.fn(async () => {}),
		reviewExistingNotesWithoutDataAsFirstSync: vi.fn(async () => {}),
	};
}

function captureSaveCalls(plugin: InstanceType<typeof KindleLocalSyncPlugin>): unknown[] {
	const saveCalls: unknown[] = [];
	const pluginWithSaveData = plugin as unknown as { saveData: (data: unknown) => Promise<void> };

	pluginWithSaveData.saveData = vi.fn(async (data: unknown) => {
		saveCalls.push(JSON.parse(JSON.stringify(data)) as unknown);
	});

	return saveCalls;
}

function createVaultWithExistingNotes() {
	return {
		getAbstractFileByPath: (path: string) => {
			if (path !== "Kindle Highlights") {
				return null;
			}

			return {
				children: [{ extension: "md" }],
			};
		},
	};
}

interface TestElement {
	tagName: string;
	children: TestElement[];
	classes: Set<string>;
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
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
