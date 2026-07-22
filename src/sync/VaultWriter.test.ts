import { describe, expect, it } from "vitest";
import { KindleHighlight } from "../parser/parseClippings";
import {
	createClippingId,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
	renderSyncRegion,
	renderLegacyClippingMarkdown,
} from "../render/renderMarkdown";
import { createSyntheticSameBookCollision } from "../testFixtures/syntheticSameBookCollision";
import { CurrentClippingIdentityIndex } from "./HighlightIdentity";
import {
	allocateBookNotePaths,
	createVaultWritePlan,
	writeBookNotesToVault,
} from "./VaultWriter";
import {
	InvalidVaultWriteContractError,
	validateAndPartitionVaultWriteSummary,
} from "./VaultWriteContract";
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

const orchardHighlight = createHighlight({
	bookTitle: "The Clockwork Orchard",
	author: "Mira Vale",
	location: "154",
	content: "Clockwork apples chime at midnight.",
	dateAdded: "Monday, October 5, 2099 9:41 AM",
	type: "Highlight",
});

const orchardNote = createHighlight({
	bookTitle: "The Clockwork Orchard",
	author: "Mira Vale",
	location: "160",
	content: "Revisit the orchard map later.",
	dateAdded: "Monday, October 5, 2099 9:42 AM",
	type: "Note",
});

describe("writeBookNotesToVault", () => {
	it("creates the configured highlights folder when missing", async () => {
		const vault = new MockVault();

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
			},
		]);

		expect(vault.hasFolder("Kindle Highlights")).toBe(true);
	});

	it("creates one new Markdown file per book and returns accurate create counts", async () => {
		const vault = new MockVault();
		const lumenBayHighlight = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			location: "220",
			content: "Reserve a window seat before moonrise.",
		});

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
			},
			{
				bookTitle: "Night Trains to Lumen Bay",
				author: "Owen Hart",
				clippings: [lumenBayHighlight],
			},
		]);

		expect(vault.filePaths()).toEqual([
			"Kindle Highlights/Night Trains to Lumen Bay - Owen Hart.md",
			"Kindle Highlights/The Clockwork Orchard - Mira Vale.md",
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
					bookTitle: "The Clockwork Orchard",
					author: "Mira Vale",
					notePath: "Kindle Highlights/The Clockwork Orchard - Mira Vale.md",
					highlightIds: [createClippingId(orchardHighlight)],
					status: "created",
				},
				{
					bookTitle: "Night Trains to Lumen Bay",
					author: "Owen Hart",
					notePath: "Kindle Highlights/Night Trains to Lumen Bay - Owen Hart.md",
					highlightIds: [createClippingId(lumenBayHighlight)],
					status: "created",
				},
			],
		});
	});

	it("creates the book note on first sync", async () => {
		const vault = new MockVault();

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
			},
		]);
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const fileContent = vault.readFile(notePath) ?? "";

		expect(vault.filePaths()).toEqual([notePath]);
		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toContain("> Clockwork apples chime at midnight.");
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
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
			},
		];
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";

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
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const before = "# The Clockwork Orchard\n\nPersonal content immediately before.";
		const after = "Personal content immediately after.";
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight],
			before,
			after
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, orchardNote],
			before,
			after
		);

		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent.match(new RegExp(createClippingId(orchardHighlight), "g"))).toHaveLength(1);
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
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingMarkdown = "# The Clockwork Orchard\r\n\r\nPersonal introduction.\r\n\r\nPersonal ending.  \r\n \t";

		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [{
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight],
		}]);
		const updatedMarkdown = vault.readFile(notePath) ?? "";

		expect(updatedMarkdown.slice(0, existingMarkdown.length)).toBe(existingMarkdown);
		expect(updatedMarkdown).toContain(createClippingId(orchardHighlight));
		expect(summary).toMatchObject({
			filesUpdated: 1,
			filesProtected: 0,
			bookOutcomes: [{ status: "updated" }],
		});
	});

	it("protects an existing managed highlight that is absent from the incoming group", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
			dateAdded: "Tuesday, October 6, 2099 10:10 AM",
		});
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, existingHighlightC],
			"# The Clockwork Orchard\n\n",
			"\n"
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);

		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.readFile(notePath)).toContain("Existing highlight C must remain.");
		expect(vault.readFile(notePath)).not.toContain("Revisit the orchard map later.");
		expect(vault.modifies()).toBe(0);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 0,
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [{
				status: "protected",
				reason: "existing-highlights-not-retained",
				highlightIds: [createClippingId(orchardHighlight), createClippingId(orchardNote)],
			}],
		});
	});

	it("creates a new book with every incoming highlight", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);

		const fileContent = vault.readFile(notePath) ?? "";
		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toContain("Clockwork apples chime at midnight.");
		expect(fileContent).toContain("Revisit the orchard map later.");
		expect(fileContent.match(/kindle-local-sync-id:/g)).toHaveLength(2);
	});

	it("leaves an existing book unchanged when no outgoing group targets it", async () => {
		const vault = new MockVault();
		const orchardPath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, existingHighlightC]
		);
		const lumenBayHighlight = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			location: "220",
			content: "Reserve a window seat before moonrise.",
		});
		await vault.createFolder("Kindle Highlights");
		await vault.create(orchardPath, existingMarkdown);

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "Night Trains to Lumen Bay",
				author: "Owen Hart",
				clippings: [lumenBayHighlight],
			},
		]);

		expect(vault.readFile(orchardPath)).toBe(existingMarkdown);
		expect(vault.modifies()).toBe(0);
		expect(vault.readFile("Kindle Highlights/Night Trains to Lumen Bay - Owen Hart.md")).toContain("Reserve a window seat before moonrise.");
	});

	it("updates an empty managed region with incoming highlights", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const before = "# The Clockwork Orchard\n\nPersonal content before the managed region.\n";
		const after = "\nPersonal content after the managed region.";
		const existingMarkdown = `${before}${SYNC_START_MARKER}\n\n\n${SYNC_END_MARKER}${after}`;
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);
		const expectedMarkdown = `${before}${renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight, orchardNote],
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
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingMarkdown = [
			"# The Clockwork Orchard",
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
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
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
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const firstRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardHighlight],
		});
		const secondRegion = renderSyncRegion({
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: [orchardNote],
		});
		const existingMarkdown = [
			"# The Clockwork Orchard",
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
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
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
			`# The Clockwork Orchard\n\n${SYNC_START_MARKER}\n\nExisting managed content.`,
		],
		[
			"end marker without a preceding start marker",
			`# The Clockwork Orchard\n\nExisting managed content.\n\n${SYNC_END_MARKER}`,
		],
		[
			"reversed end and start markers",
			`# The Clockwork Orchard\n\n${SYNC_END_MARKER}\n\nExisting managed content.\n\n${SYNC_START_MARKER}`,
		],
		[
			"nested managed markers",
			[
				"# The Clockwork Orchard",
				SYNC_START_MARKER,
				SYNC_START_MARKER,
				"Existing managed content.",
				SYNC_END_MARKER,
				SYNC_END_MARKER,
			].join("\n"),
		],
	])("protects malformed managed Markdown with a %s", async (_caseName, existingMarkdown) => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
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
		const orchardPath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const lumenBayPath = "Kindle Highlights/Night Trains to Lumen Bay - Owen Hart.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const lumenBayD = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			location: "220",
			content: "Existing highlight D.",
		});
		const lumenBayE = createHighlight({
			bookTitle: "Night Trains to Lumen Bay",
			author: "Owen Hart",
			location: "225",
			content: "New highlight E.",
		});
		const orchardMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, existingHighlightC]
		);
		const lumenBayMarkdown = renderManagedNote("Night Trains to Lumen Bay", "Owen Hart", [lumenBayD]);
		await vault.createFolder("Kindle Highlights");
		await vault.create(orchardPath, orchardMarkdown);
		await vault.create(lumenBayPath, lumenBayMarkdown);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
			{
				bookTitle: "Night Trains to Lumen Bay",
				author: "Owen Hart",
				clippings: [lumenBayD, lumenBayE],
			},
		]);

		expect(vault.readFile(lumenBayPath)).toContain("Existing highlight D.");
		expect(vault.readFile(lumenBayPath)).toContain("New highlight E.");
		expect(vault.readFile(lumenBayPath)?.match(/kindle-local-sync-id:/g)).toHaveLength(2);
		expect(vault.readFile(orchardPath)).toBe(orchardMarkdown);
		expect(vault.readFile(orchardPath)).toContain("Existing highlight C must remain.");
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
			filesProtected: 1,
			bookOutcomes: [
				{ bookTitle: "The Clockwork Orchard", status: "protected" },
				{ bookTitle: "Night Trains to Lumen Bay", status: "updated" },
			],
		});
	});

	it("protects missing existing highlights through the adapter fallback path", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, existingHighlightC]
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.missGetAbstractFileByPath(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
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
		await vault.create("Kindle Highlights/The Clockwork Orchard - Mira Vale.md", "# The Clockwork Orchard\n\nUser notes.");

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/The Clockwork Orchard - Mira Vale.md") ?? "";

		expect(fileContent).toContain("# The Clockwork Orchard\n\nUser notes.");
		expect(fileContent).toContain("## Kindle Highlights & Notes");
		expect(fileContent).toContain(SYNC_START_MARKER);
		expect(fileContent).toContain(SYNC_END_MARKER);
		expect(summary.filesUpdated).toBe(1);
	});

	it("does not duplicate highlights when sync is run repeatedly", async () => {
		const vault = new MockVault();
		const bookGroups = [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		];

		await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);
		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", bookGroups);
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const fileContent = vault.readFile("Kindle Highlights/The Clockwork Orchard - Mira Vale.md") ?? "";

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

	it("retries a completed but unverifiable recovery write without changing preserved content or duplicating highlights", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const before = "# The Clockwork Orchard\n\nPersonal introduction.\n\n";
		const after = "\n\nPersonal follow-up notes.";
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight],
			before,
			after
		);
		const recoveryHighlights = [orchardHighlight, orchardNote];
		const bookGroups = [{
			bookTitle: "The Clockwork Orchard",
			author: "Mira Vale",
			clippings: recoveryHighlights,
		}];

		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);

		const completedWrite = await writeBookNotesToVault(
			vault as unknown as Vault,
			"Kindle Highlights",
			bookGroups
		);
		const partialReport = {
			...completedWrite,
			bookOutcomes: completedWrite.bookOutcomes.map((outcome) => ({
				...outcome,
				highlightIds: outcome.highlightIds.slice(0, 1),
			})),
		};
		const markdownAfterUnconfirmedWrite = vault.readFile(notePath) ?? "";

		expect(() => validateAndPartitionVaultWriteSummary(
			"Kindle Highlights",
			recoveryHighlights,
			partialReport
		)).toThrow(InvalidVaultWriteContractError);
		expect(markdownAfterUnconfirmedWrite).toContain(before);
		expect(markdownAfterUnconfirmedWrite).toContain(after);
		expect(markdownAfterUnconfirmedWrite).toContain(orchardHighlight.content);
		expect(markdownAfterUnconfirmedWrite).toContain(orchardNote.content);
		expect(markdownAfterUnconfirmedWrite.match(
			new RegExp(createClippingId(orchardHighlight), "g")
		)).toHaveLength(1);
		expect(markdownAfterUnconfirmedWrite.match(
			new RegExp(createClippingId(orchardNote), "g")
		)).toHaveLength(1);

		const retrySummary = await writeBookNotesToVault(
			vault as unknown as Vault,
			"Kindle Highlights",
			bookGroups
		);
		const retryResult = validateAndPartitionVaultWriteSummary(
			"Kindle Highlights",
			recoveryHighlights,
			retrySummary
		);
		const markdownAfterRetry = vault.readFile(notePath) ?? "";

		expect(retrySummary).toMatchObject({
			filesUpdated: 0,
			filesUnchanged: 1,
			bookOutcomes: [{ status: "confirmed" }],
		});
		expect(retryResult.safelyCompletedHighlights).toEqual(recoveryHighlights);
		expect(retryResult.protectedHighlights).toEqual([]);
		expect(markdownAfterRetry).toBe(markdownAfterUnconfirmedWrite);
		expect(vault.modifies()).toBe(1);
		expect(vault.createCount(notePath)).toBe(1);
		expect(markdownAfterRetry.match(/kindle-local-sync-id:/g)).toHaveLength(2);
	});

	it("updates an existing adapter file when the Obsidian file lookup is stale", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const before = "# The Clockwork Orchard\n\nUser introduction.\n\n";
		const after = "\n\nUser outro.";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, renderManagedNote("The Clockwork Orchard", "Mira Vale", [orchardHighlight], before, after));
		vault.missGetAbstractFileByPath(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, orchardNote],
			before,
			after
		);

		expect(vault.createCount(notePath)).toBe(1);
		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("User outro.");
		expect(fileContent).toContain("Revisit the orchard map later.");
		expect(vault.adapterWrites()).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("recovers if create reports that the note file already exists", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const before = "# The Clockwork Orchard\n\nUser introduction.\n\n";
		const after = "\n\nUser outro.";
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, renderManagedNote("The Clockwork Orchard", "Mira Vale", [orchardHighlight], before, after));
		vault.missGetAbstractFileByPath(notePath);
		vault.missAdapterExists(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);
		const fileContent = vault.readFile(notePath) ?? "";
		const expectedMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, orchardNote],
			before,
			after
		);

		expect(vault.createCount(notePath)).toBe(2);
		expect(fileContent).toBe(expectedMarkdown);
		expect(fileContent).toContain("User introduction.");
		expect(fileContent).toContain("User outro.");
		expect(fileContent).toContain("Revisit the orchard map later.");
		expect(vault.modifies()).toBe(1);
		expect(summary).toMatchObject({
			filesCreated: 0,
			filesUpdated: 1,
			filesUnchanged: 0,
		});
	});

	it("protects missing existing highlights after a create conflict", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingHighlightC = createHighlight({
			location: "170",
			content: "Existing highlight C must remain.",
		});
		const existingMarkdown = renderManagedNote(
			"The Clockwork Orchard",
			"Mira Vale",
			[orchardHighlight, existingHighlightC]
		);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.missGetAbstractFileByPath(notePath);
		vault.missAdapterExists(notePath);

		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
			},
		]);

		expect(vault.createCount(notePath)).toBe(2);
		expect(vault.readFile(notePath)).toBe(existingMarkdown);
		expect(vault.readFile(notePath)).toContain("Existing highlight C must remain.");
		expect(vault.readFile(notePath)).not.toContain("Revisit the orchard map later.");
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
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, { ...orchardHighlight }],
			},
		]);
		const fileContent = vault.readFile("Kindle Highlights/The Clockwork Orchard - Mira Vale.md") ?? "";

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
				highlightIds: [createClippingId(orchardHighlight)],
			}],
		});
	});

	it("writes both true same-book collision blocks and preserves personal text byte-for-byte", async () => {
		const vault = new MockVault();
		const [first, second] = createSyntheticSameBookCollision();
		const notePath = "Kindle Highlights/Synthetic Atlas of Quiet Machines - Example Author.md";
		const personalMarkdown = "# Personal heading\r\n\r\nPrivate notes stay exactly here.\r\n";

		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, personalMarkdown);
		const summary = await writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [{
			bookTitle: first.bookTitle,
			author: first.author,
			clippings: [first, second],
		}]);
		const markdown = vault.readFile(notePath) ?? "";

		expect(markdown.slice(0, personalMarkdown.length)).toBe(personalMarkdown);
		expect(markdown).toContain(first.content);
		expect(markdown).toContain(second.content);
		expect(markdown.match(/kindle-local-sync-id: kls2-/g)).toHaveLength(2);
		expect(summary.highlightsRendered).toBe(2);
		expect(summary.duplicatesSkipped).toBe(0);
	});

	it("upgrades one exact legacy block lazily but protects an ambiguous same-book legacy marker", async () => {
		const [first, second] = createSyntheticSameBookCollision();
		const notePath = "Kindle Highlights/Synthetic Atlas of Quiet Machines - Example Author.md";
		const before = "Personal before.\n\n";
		const after = "\n\nPersonal after.";
		const createLegacyNote = (block: string) => [
			before,
			SYNC_START_MARKER,
			"",
			block,
			"",
			SYNC_END_MARKER,
			after,
		].join("\n");
		const uniqueVault = new MockVault();

		await uniqueVault.createFolder("Kindle Highlights");
		await uniqueVault.create(notePath, createLegacyNote(renderLegacyClippingMarkdown(first)));
		const uniqueSummary = await writeBookNotesToVault(uniqueVault as unknown as Vault, "Kindle Highlights", [{
			bookTitle: first.bookTitle,
			author: first.author,
			clippings: [first],
		}]);
		const migrated = uniqueVault.readFile(notePath) ?? "";

		expect(uniqueSummary.filesUpdated).toBe(1);
		expect(migrated.startsWith(before)).toBe(true);
		expect(migrated.endsWith(after)).toBe(true);
		expect(migrated).toContain(`kindle-local-sync-id: ${createClippingId(first)}`);

		const ambiguousVault = new MockVault();
		const ambiguousMarkdown = createLegacyNote(renderLegacyClippingMarkdown(first));

		await ambiguousVault.createFolder("Kindle Highlights");
		await ambiguousVault.create(notePath, ambiguousMarkdown);
		const ambiguousSummary = await writeBookNotesToVault(
			ambiguousVault as unknown as Vault,
			"Kindle Highlights",
			[{
				bookTitle: first.bookTitle,
				author: first.author,
				clippings: [first, second],
			}]
		);

		expect(ambiguousVault.readFile(notePath)).toBe(ambiguousMarkdown);
		expect(ambiguousSummary.bookOutcomes).toMatchObject([{
			status: "protected",
			reason: "existing-highlights-not-retained",
		}]);

		const subsetVault = new MockVault();

		await subsetVault.createFolder("Kindle Highlights");
		await subsetVault.create(notePath, ambiguousMarkdown);
		const subsetSummary = await writeBookNotesToVault(
			subsetVault as unknown as Vault,
			"Kindle Highlights",
			[{
				bookTitle: first.bookTitle,
				author: first.author,
				clippings: [first],
			}],
			new CurrentClippingIdentityIndex([first, second])
		);

		expect(subsetVault.readFile(notePath)).toBe(ambiguousMarkdown);
		expect(subsetSummary.bookOutcomes).toMatchObject([{
			status: "protected",
			reason: "existing-highlights-not-retained",
		}]);
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
		await vault.createFolder("Kindle Highlights/The Clockwork Orchard - Mira Vale.md");

		await expect(
			writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
				{
					bookTitle: "The Clockwork Orchard",
					author: "Mira Vale",
					clippings: [orchardHighlight],
				},
			])
		).rejects.toThrow('Cannot sync Kindle highlights because "Kindle Highlights/The Clockwork Orchard - Mira Vale.md" is a folder.');
	});

	it("keeps genuine write failures separate from protected outcomes", async () => {
		const vault = new MockVault();
		const notePath = "Kindle Highlights/The Clockwork Orchard - Mira Vale.md";
		const existingMarkdown = renderManagedNote("The Clockwork Orchard", "Mira Vale", [orchardHighlight]);
		await vault.createFolder("Kindle Highlights");
		await vault.create(notePath, existingMarkdown);
		vault.failNextModify(new Error("Disk write failed."));

		await expect(writeBookNotesToVault(vault as unknown as Vault, "Kindle Highlights", [
			{
				bookTitle: "The Clockwork Orchard",
				author: "Mira Vale",
				clippings: [orchardHighlight, orchardNote],
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
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight",
		...overrides,
	};
}
