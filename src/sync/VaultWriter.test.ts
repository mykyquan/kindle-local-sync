import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import {
	createClippingId,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
	renderSyncRegion,
} from "../render/renderMarkdown";
import {
	allocateBookNotePaths,
	createVaultWritePlan,
	writeBookNotesToVault,
} from "./VaultWriter";
import type { Vault } from "obsidian";

class MockTFile {
	path: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		this.extension = path.split(".").pop() ?? "";
	}
}

interface MockFolder {
	path: string;
}

class MockVault {
	private readonly files = new Map<string, string>();
	private readonly folders = new Set<string>();
	private readonly createCalls = new Map<string, number>();
	private readonly lookupMisses = new Map<string, number>();
	private readonly adapterExistsMisses = new Map<string, number>();
	private modifyCalls = 0;
	private adapterWriteCalls = 0;
	private modifyError: Error | null = null;

	readonly adapter = {
		exists: async (path: string): Promise<boolean> => {
			const normalizedPath = normalizeMockPath(path);

			if (this.consumeMiss(this.adapterExistsMisses, normalizedPath)) {
				return false;
			}

			return this.files.has(normalizedPath) || this.folders.has(normalizedPath);
		},
		stat: async (path: string): Promise<{ type: "file" | "folder"; ctime: number; mtime: number; size: number } | null> => {
			const normalizedPath = normalizeMockPath(path);

			if (this.files.has(normalizedPath)) {
				return {
					type: "file",
					ctime: 0,
					mtime: 0,
					size: this.files.get(normalizedPath)?.length ?? 0,
				};
			}

			if (this.folders.has(normalizedPath)) {
				return {
					type: "folder",
					ctime: 0,
					mtime: 0,
					size: 0,
				};
			}

			return null;
		},
		read: async (path: string): Promise<string> => {
			const normalizedPath = normalizeMockPath(path);
			const content = this.files.get(normalizedPath);

			if (content === undefined) {
				throw new Error(`File not found: ${normalizedPath}`);
			}

			return content;
		},
		write: async (path: string, content: string): Promise<void> => {
			const normalizedPath = normalizeMockPath(path);

			if (this.folders.has(normalizedPath)) {
				throw new Error("Folder already exists.");
			}

			this.adapterWriteCalls++;
			this.files.set(normalizedPath, content);
		},
	};

	getAbstractFileByPath(path: string): MockFolder | MockTFile | null {
		const normalizedPath = normalizeMockPath(path);

		if (this.consumeMiss(this.lookupMisses, normalizedPath)) {
			return null;
		}

		if (this.files.has(normalizedPath)) {
			return new MockTFile(normalizedPath);
		}

		if (this.folders.has(normalizedPath)) {
			return { path: normalizedPath };
		}

		return null;
	}

	async createFolder(path: string): Promise<void> {
		const normalizedPath = normalizeMockPath(path);

		if (this.files.has(normalizedPath) || this.folders.has(normalizedPath)) {
			throw new Error("Folder already exists.");
		}

		this.folders.add(normalizedPath);
	}

	async create(path: string, content: string): Promise<MockTFile> {
		const normalizedPath = normalizeMockPath(path);

		this.createCalls.set(normalizedPath, (this.createCalls.get(normalizedPath) ?? 0) + 1);

		if (this.files.has(normalizedPath) || this.folders.has(normalizedPath)) {
			throw new Error("File already exists.");
		}

		this.files.set(normalizedPath, content);

		return new MockTFile(normalizedPath);
	}

	async read(file: MockTFile): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	async modify(file: MockTFile, content: string): Promise<void> {
		if (this.modifyError) {
			const error = this.modifyError;
			this.modifyError = null;
			throw error;
		}

		this.modifyCalls++;
		this.files.set(file.path, content);
	}

	hasFolder(path: string): boolean {
		return this.folders.has(normalizeMockPath(path));
	}

	readFile(path: string): string | undefined {
		return this.files.get(normalizeMockPath(path));
	}

	filePaths(): string[] {
		return Array.from(this.files.keys()).sort();
	}

	createCount(path: string): number {
		return this.createCalls.get(normalizeMockPath(path)) ?? 0;
	}

	modifies(): number {
		return this.modifyCalls;
	}

	adapterWrites(): number {
		return this.adapterWriteCalls;
	}

	failNextModify(error: Error): void {
		this.modifyError = error;
	}

	missGetAbstractFileByPath(path: string, count = 1): void {
		this.lookupMisses.set(normalizeMockPath(path), count);
	}

	missAdapterExists(path: string, count = 1): void {
		this.adapterExistsMisses.set(normalizeMockPath(path), count);
	}

	private consumeMiss(misses: Map<string, number>, path: string): boolean {
		const count = misses.get(path) ?? 0;

		if (count <= 0) {
			return false;
		}

		if (count === 1) {
			misses.delete(path);
		} else {
			misses.set(path, count - 1);
		}

		return true;
	}
}

function normalizeMockPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

const atomicHighlight = createHighlight({
	bookTitle: "Atomic Habits",
	author: "James Clear",
	location: "154",
	content: "Small habits make a big difference.",
	dateAdded: "Thursday, May 14, 2026 2:44 PM",
	type: "Highlight",
});

const atomicNote = createHighlight({
	bookTitle: "Atomic Habits",
	author: "James Clear",
	location: "160",
	content: "Review this idea later.",
	dateAdded: "Thursday, May 14, 2026 2:45 PM",
	type: "Note",
});

describe("writeBookNotesToVault", () => {
	it("creates the configured highlights folder when missing", async () => {
		const vault = new MockVault();

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);

		expect(vault.hasFolder("Kindle Highlights")).toBe(true);
	});

	it("creates one new Markdown file per book and returns accurate create counts", async () => {
		const vault = new MockVault();
		const deepWorkHighlight = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			location: "220",
			content: "Schedule focus time.",
		});

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				clippings: [deepWorkHighlight],
			},
		]);

		expect(vault.filePaths()).toEqual([
			"Kindle Highlights/Atomic Habits - James Clear.md",
			"Kindle Highlights/Deep Work - Cal Newport.md",
		]);
		expect(summary).toEqual({
			books: 2,
			filesCreated: 2,
			filesUpdated: 0,
			filesUnchanged: 0,
			filesProtected: 0,
			highlightsRendered: 2,
			duplicatesSkipped: 0,
			bookOutcomes: [
				{
					bookTitle: "Atomic Habits",
					author: "James Clear",
					notePath: "Kindle Highlights/Atomic Habits - James Clear.md",
					highlightIds: [createClippingId(atomicHighlight)],
					status: "created",
				},
				{
					bookTitle: "Deep Work",
					author: "Cal Newport",
					notePath: "Kindle Highlights/Deep Work - Cal Newport.md",
					highlightIds: [createClippingId(deepWorkHighlight)],
					status: "created",
				},
			],
		});
	});

	it("creates the book note on first sync", async () => {
		const vault = new MockVault();

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const fileContent = vault.readFile(notePath) ?? "";

		expect(vault.filePaths()).toEqual([notePath]);
		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toContain("> Small habits make a big difference.");
		expect(summary).toMatchObject({
			filesCreated: 1,
			filesUpdated: 0,
			filesUnchanged: 0,
		});
	});

	it("does not call create again when the book note already exists", async () => {
		const vault = new MockVault();
		const bookGroups = [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		];
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);
		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);

		expect(vault.createCount(notePath)).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 1,
			filesProtected: 0,
			bookOutcomes: [{ status: "confirmed" }],
		});
	});

	it("adds a new highlight while preserving adjacent personal content outside the managed region", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const before = "# Atomic Habits\n\nPersonal content immediately before.";
		const after = "Personal content immediately after.";
		const existingMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight],
			before,
			after
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, atomicNote],
			before,
			after
		);

		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent.match(new RegExp(createClippingId(atomicHighlight), "g"))).toHaveLength(1);
		expect(fileContent).toContain("Personal content immediately before.");
		expect(fileContent).toContain("Personal content immediately after.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
			filesProtected: 0,
			bookOutcomes: [{ status: "updated" }],
		});
	});

	it("restores a deleted managed region without changing any existing user-authored byte", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingMarkdown = "# Atomic Habits\r\n\r\nPersonal introduction.\r\n\r\nPersonal ending.  \r\n \t";

		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [{
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight],
		}]);
		const updatedMarkdown = vault.readFile(notePath) ?? "";

		expect(updatedMarkdown.slice(0, existingMarkdown.length)).toBe(existingMarkdown);
		expect(updatedMarkdown).toContain(createClippingId(atomicHighlight));
		expect(summary).toMatchObject({
			filesUpdated: 1,
			filesProtected: 0,
			bookOutcomes: [{ status: "updated" }],
		});
	});

	it("protects an existing managed highlight that is absent from the incoming group", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
			dateAdded: "Friday, May 15, 2026 9:10 AM",
		});
		const existingMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, existingHighlightC],
			"# Atomic Habits\n\n",
			"\n"
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.readFile(notePath)).toContain("Existing highlight C must remain.");
		expect(vault.readFile(notePath)).not.toContain("Review this idea later.");
		expect(vault.modifies()).toBe(0);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{
				status: "protected",
				reason: "existing-highlights-not-retained",
				highlightIds: [createClippingId(atomicHighlight), createClippingId(atomicNote)],
			}],
		});
	});

	it("creates a new book with every incoming highlight", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		const fileContent = vault.readFile(notePath) ?? "";
		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toContain("Small habits make a big difference.");
		expect(fileContent).toContain("Review this idea later.");
		expect(fileContent.match(/kindle-local-sync-id:/g)).toHaveLength(2);
	});

	it("leaves an existing book unchanged when no outgoing group targets it", async () => {
		const vault = new MockVault();
		const atomicPath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, existingHighlightC]
		);
		const deepWorkHighlight = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			location: "220",
			content: "Schedule focus time.",
		});
		await vault.createFolder("Kindle Highlights");
		await vault.create(atomicPath, existingMarkdown);

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				clippings: [deepWorkHighlight],
			},
		]);

		expect(vault.readFile(atomicPath)).toBe(existingMarkdown);
		expect(vault.modifies()).toBe(0);
		expect(vault.readFile("Kindle Highlights/Deep Work - Cal Newport.md")).toContain("Schedule focus time.");
	});

	it("updates an empty managed region with incoming highlights", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const before = "# Atomic Habits\n\nPersonal content before the managed region.\n";
		const after = "\nPersonal content after the managed region.";
		const existingMarkdown = `${before}${SYNC_START_MARKER}\n\n\n${SYNC_END_MARKER}${after}`;
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);
		const expectedMarkdown = `${before}${renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight, atomicNote],
		})}${after}`;
		const fileContent = vault.readFile(notePath) ?? "";

		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent.match(/kindle-local-sync-id:/g)).toHaveLength(2);
		expect(fileContent).toContain("Personal content before the managed region.");
		expect(fileContent).toContain("Personal content after the managed region.");
		expect(vault.modifies()).toBe(1);
		expect(vault.adapterWrites()).toBe(0);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("protects nonempty managed content without valid highlight IDs", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingMarkdown = [
			"# Atomic Habits",
			"",
			"Personal content before the managed region.",
			SYNC_START_MARKER,
			"",
			"### Corrupted legacy highlight",
			"",
			"> This generated-looking content has no highlight ID marker.",
			"",
			SYNC_END_MARKER,
			"Personal content after the managed region.",
		].join("\n");
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.modifies()).toBe(0);
		expect(vault.adapterWrites()).toBe(0);
		expect(summary).toMatchObject({
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{
				status: "protected",
				reason: "unsafe-existing-managed-region",
			}],
		});
	});

	it("protects a note containing multiple complete managed regions", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const firstRegion = renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicHighlight],
		});
		const secondRegion = renderSyncRegion({
			bookTitle: "Atomic Habits",
			author: "James Clear",
			clippings: [atomicNote],
		});
		const existingMarkdown = [
			"# Atomic Habits",
			"",
			"Personal content before the managed regions.",
			firstRegion,
			"Content between managed regions.",
			secondRegion,
			"Personal content after the managed regions.",
		].join("\n");
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.modifies()).toBe(0);
		expect(vault.adapterWrites()).toBe(0);
		expect(summary).toMatchObject({
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{ status: "protected", reason: "unsafe-existing-managed-region" }],
		});
	});

	it.each([
		[
			"start marker without an end marker",
			`# Atomic Habits\n\n${SYNC_START_MARKER}\n\nExisting managed content.`,
		],
		[
			"end marker without a preceding start marker",
			`# Atomic Habits\n\nExisting managed content.\n\n${SYNC_END_MARKER}`,
		],
		[
			"reversed end and start markers",
			`# Atomic Habits\n\n${SYNC_END_MARKER}\n\nExisting managed content.\n\n${SYNC_START_MARKER}`,
		],
		[
			"nested managed markers",
			[
				"# Atomic Habits",
				SYNC_START_MARKER,
				SYNC_START_MARKER,
				"Existing managed content.",
				SYNC_END_MARKER,
				SYNC_END_MARKER,
			].join("\n"),
		],
	])("protects malformed managed Markdown with a %s", async (_caseName, existingMarkdown) => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.modifies()).toBe(0);
		expect(vault.readFile(notePath)?.match(/kindle-local-sync:start/g) ?? []).toHaveLength(
			existingMarkdown.match(/kindle-local-sync:start/g)?.length ?? 0
		);
		expect(summary).toMatchObject({
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{ status: "protected", reason: "unsafe-existing-managed-region" }],
		});
	});

	it("protects one unsafe book while allowing another book to update", async () => {
		const vault = new MockVault();
		const atomicPath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const deepWorkPath = "Kindle Highlights/Deep Work - Cal Newport.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const deepWorkD = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			location: "220",
			content: "Existing highlight D.",
		});
		const deepWorkE = createHighlight({
			bookTitle: "Deep Work",
			author: "Cal Newport",
			location: "225",
			content: "New highlight E.",
		});
		const atomicMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, existingHighlightC]
		);
		const deepWorkMarkdown = renderManagedNote("Deep Work", "Cal Newport", [deepWorkD]);
		await vault.createFolder("Kindle Highlights");
		await vault.create(atomicPath, atomicMarkdown);
		await vault.create(deepWorkPath, deepWorkMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				clippings: [deepWorkD, deepWorkE],
			},
		]);

		expect(vault.readFile(deepWorkPath)).toContain("Existing highlight D.");
		expect(vault.readFile(deepWorkPath)).toContain("New highlight E.");
		expect(vault.readFile(deepWorkPath)?.match(/kindle-local-sync-id:/g)).toHaveLength(2);
		expect(vault.readFile(atomicPath)).toBe(atomicMarkdown);
		expect(vault.readFile(atomicPath)).toContain("Existing highlight C must remain.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [
				{ bookTitle: "Atomic Habits", status: "protected" },
				{ bookTitle: "Deep Work", status: "updated" },
			],
		});
	});

	it("protects missing existing highlights through the adapter fallback path", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, existingHighlightC]
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.missGetAbstractFileByPath(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.adapterWrites()).toBe(0);
		expect(summary).toMatchObject({
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{
				status: "protected",
				reason: "existing-highlights-not-retained",
			}],
		});
	});

	it("appends a sync region when an existing file has no sync markers", async () => {
		const vault = new MockVault();
		await vault.createFolder("Kindle Highlights");
		await vault.create("Kindle Highlights/Atomic Habits - James Clear.md", "# Atomic Habits\n\nUser notes.");

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/Atomic Habits - James Clear.md") ?? "";

		expect(fileContent).toContain("# Atomic Habits\n\nUser notes.");
		expect(fileContent).toContain("## Kindle Highlights & Notes");
		expect(fileContent).toContain(SYNC_START_MARKER);
		expect(fileContent).toContain(SYNC_END_MARKER);
		expect(summary.filesUpdated).toBe(1);
	});

	it("does not duplicate highlights when sync is run repeatedly", async () => {
		const vault = new MockVault();
		const bookGroups = [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		];

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);
		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const fileContent = vault.readFile("Kindle Highlights/Atomic Habits - James Clear.md") ?? "";

		expect(fileContent.match(/kindle-local-sync-id:/g)).toHaveLength(2);
		expect(vault.createCount(notePath)).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 1,
			filesProtected: 0,
			bookOutcomes: [{ status: "confirmed" }],
			highlightsRendered: 2,
			duplicatesSkipped: 0,
		});
	});

	it("updates an existing adapter file when the Obsidian file lookup is stale", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const before = "# Atomic Habits\n\nUser introduction.\n\n";
		const after = "\n\nUser outro.";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, renderManagedNote("Atomic Habits", "James Clear", [atomicHighlight], before, after));
		vault.missGetAbstractFileByPath(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, atomicNote],
			before,
			after
		);

		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("User outro.");
		expect(fileContent).toContain("Review this idea later.");
		expect(vault.adapterWrites()).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("recovers if create reports that the note file already exists", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const before = "# Atomic Habits\n\nUser introduction.\n\n";
		const after = "\n\nUser outro.";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, renderManagedNote("Atomic Habits", "James Clear", [atomicHighlight], before, after));
		vault.missGetAbstractFileByPath(notePath);
		vault.missAdapterExists(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, atomicNote],
			before,
			after
		);

		expect(vault.createCount(notePath)).toBe(2);
		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("User outro.");
		expect(fileContent).toContain("Review this idea later.");
		expect(vault.modifies()).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("protects missing existing highlights after a create conflict", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"Atomic Habits",
			"James Clear",
			[atomicHighlight, existingHighlightC]
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.missGetAbstractFileByPath(notePath);
		vault.missAdapterExists(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		]);

		expect(vault.createCount(notePath)).toBe(2);
		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.readFile(notePath)).toContain("Existing highlight C must remain.");
		expect(vault.readFile(notePath)).not.toContain("Review this idea later.");
		expect(vault.modifies()).toBe(0);
		expect(vault.adapterWrites()).toBe(0);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{
				status: "protected",
				reason: "existing-highlights-not-retained",
			}],
		});
	});

	it("handles duplicate clipping IDs safely and reports skipped duplicates", async () => {
		const vault = new MockVault();

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, { ...atomicHighlight }],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/Atomic Habits - James Clear.md") ?? "";

		expect(fileContent.match(/kindle-local-sync-id:/g)).toHaveLength(1);
		expect(summary).toMatchObject({
			books: 1,
			filesCreated: 1,
			filesUpdated: 0,
			filesUnchanged: 0,
			highlightsRendered: 1,
			duplicatesSkipped: 1,
			bookOutcomes: [{
				status: "created",
				highlightIds: [createClippingId(atomicHighlight)],
			}],
		});
	});

	it("uses sanitized filenames and author names for stable same-title books", async () => {
		const vault = new MockVault();

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Shared/Title",
				author: "Author: One",
				clippings: [
					createHighlight({
						bookTitle: "Shared/Title",
						author: "Author: One",
						content: "First book.",
					}),
				],
			},
			{
				bookTitle: "Shared/Title",
				author: "Author: Two",
				clippings: [
					createHighlight({
						bookTitle: "Shared/Title",
						author: "Author: Two",
						content: "Second book.",
					}),
				],
			},
			{
				bookTitle: "",
				author: "Unknown",
				clippings: [
					createHighlight({
						bookTitle: "",
						author: "Unknown",
						content: "Untitled book.",
					}),
				],
			},
		]);

		expect(vault.filePaths()).toEqual([
			"Kindle Highlights/Shared Title - Author One.md",
			"Kindle Highlights/Shared Title - Author Two.md",
			"Kindle Highlights/Untitled Kindle Book.md",
		]);
	});

	it("allocates deterministic suffixes when different books sanitize to the same path", async () => {
		const vault = new MockVault();
		const bookGroups = [
			{
				bookTitle: "Shared/Title",
				author: "Author",
				clippings: [createHighlight({ bookTitle: "Shared/Title", author: "Author" })],
			},
			{
				bookTitle: "Shared:Title",
				author: "Author",
				clippings: [createHighlight({ bookTitle: "Shared:Title", author: "Author" })],
			},
		];
		const allocatedPaths = allocateBookNotePaths("Kindle Highlights", bookGroups);
		const writePlan = createVaultWritePlan("Kindle Highlights", bookGroups);

		expect(allocatedPaths).toEqual([
			"Kindle Highlights/Shared Title - Author.md",
			"Kindle Highlights/Shared Title - Author 2.md",
		]);
		expect(writePlan.bookPlans.map((plan) => plan.notePath)).toEqual(allocatedPaths);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);

		expect(summary.bookOutcomes.map((outcome) => outcome.notePath)).toEqual(allocatedPaths);
	});

	it("sanitizes unsafe folder paths and prevents traversal outside the vault", async () => {
		const vault = new MockVault();

		await writeBookNotesToVault(vault as unknown as Vault, "../Kindle:Bad/../Highlights", [
			{
				bookTitle: "../Secrets",
				author: "Unknown",
				clippings: [
					createHighlight({
						bookTitle: "../Secrets",
						author: "Unknown",
						content: "Safe output.",
					}),
				],
			},
		]);

		expect(vault.hasFolder("Kindle Bad")).toBe(true);
		expect(vault.hasFolder("Kindle Bad/Highlights")).toBe(true);
		expect(vault.filePaths()).toEqual(["Kindle Bad/Highlights/Secrets.md"]);
	});

	it("throws a clear error when the target note path is a folder", async () => {
		const vault = new MockVault();
		await vault.createFolder("Kindle Highlights");
		await vault.createFolder("Kindle Highlights/Atomic Habits - James Clear.md");

		await expect(
			writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
				{
					bookTitle: "Atomic Habits",
					author: "James Clear",
					clippings: [atomicHighlight],
				},
			])
		).rejects.toThrow('Cannot sync Kindle highlights because "Kindle Highlights/Atomic Habits - James Clear.md" is a folder.');
	});

	it("keeps genuine write failures separate from protected outcomes", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		const existingMarkdown = renderManagedNote("Atomic Habits", "James Clear", [atomicHighlight]);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.failNextModify(new Error("Disk write failed."));

		await expect(writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight, atomicNote],
			},
		])).rejects.toThrow("Disk write failed.");

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
	});
});

function renderManagedNote(
	bookTitle: string,
	author: string,
	highlights: KindleHighlight[],
	before = "",
	after = ""
): string {
	return `${before}${renderSyncRegion({
		bookTitle,
		author,
		clippings: highlights,
	})}${after}`;
}

function createHighlight(overrides: Partial<KindleHighlight> = {}): KindleHighlight {
	return {
		bookTitle: "Atomic Habits",
		author: "James Clear",
		location: "154",
		content: "Small habits make a big difference.",
		dateAdded: "Thursday, May 14, 2026 2:44 PM",
		type: "Highlight",
		...overrides,
	};
}
