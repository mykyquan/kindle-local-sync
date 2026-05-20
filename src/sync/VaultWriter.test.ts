import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import {
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { writeBookNotesToVault } from "./VaultWriter";
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

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
			{
				bookTitle: "Deep Work",
				author: "Cal Newport",
				clippings: [
					createHighlight({
						bookTitle: "Deep Work",
						author: "Cal Newport",
						location: "220",
						content: "Schedule focus time.",
					}),
				],
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
			highlightsRendered: 2,
			duplicatesSkipped: 0,
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
		});
	});

	it("updates an existing file with sync markers while preserving user content outside the region", async () => {
		const vault = new MockVault();
		await vault.createFolder("Kindle Highlights");
		await vault.create(
			"Kindle Highlights/Atomic Habits - James Clear.md",
			[
				"# Atomic Habits",
				"",
				"User introduction.",
				"",
				SYNC_START_MARKER,
				"",
				"old generated content",
				"",
				SYNC_END_MARKER,
				"",
				"User outro.",
			].join("\n")
		);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/Atomic Habits - James Clear.md") ?? "";

		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("User outro.");
		expect(fileContent).not.toContain("old generated content");
		expect(fileContent).toContain("> Small habits make a big difference.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
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

	it("preserves a broken start marker as user content and appends a new complete sync region", async () => {
		const vault = new MockVault();
		await vault.createFolder("Kindle Highlights");
		await vault.create(
			"Kindle Highlights/Atomic Habits - James Clear.md",
			`# Atomic Habits\n\nUser notes.\n\n${SYNC_START_MARKER}\n\npartial generated content`
		);

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/Atomic Habits - James Clear.md") ?? "";

		expect(fileContent).toContain("partial generated content");
		expect(fileContent.match(/kindle-local-sync:start/g)).toHaveLength(2);
		expect(fileContent).toContain(SYNC_END_MARKER);
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
			highlightsRendered: 2,
			duplicatesSkipped: 0,
		});
	});

	it("updates an existing adapter file when the Obsidian file lookup is stale", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		await vault.createFolder("Kindle Highlights");
		await vault.create(
			notePath,
			[
				"# Atomic Habits",
				"",
				"User introduction.",
				"",
				SYNC_START_MARKER,
				"",
				"old generated content",
				"",
				SYNC_END_MARKER,
			].join("\n")
		);
		vault.missGetAbstractFileByPath(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";

		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).not.toContain("old generated content");
		expect(fileContent).toContain("> Small habits make a big difference.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("recovers if create reports that the note file already exists", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/Atomic Habits - James Clear.md";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, renderExistingMarkdownWithUserContent());
		vault.missGetAbstractFileByPath(notePath);
		vault.missAdapterExists(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Atomic Habits",
				author: "James Clear",
				clippings: [atomicHighlight],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";

		expect(vault.createCount(notePath)).toBe(2);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("> Small habits make a big difference.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
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
});

function renderExistingMarkdownWithUserContent(): string {
	return [
		"# Atomic Habits",
		"",
		"User introduction.",
		"",
		SYNC_START_MARKER,
		"",
		"old generated content",
		"",
		SYNC_END_MARKER,
		"",
		"User outro.",
	].join("\n");
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
