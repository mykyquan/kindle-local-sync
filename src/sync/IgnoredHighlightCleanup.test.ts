import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import {
	createClippingId,
	renderClippingMarkdown,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { removeIgnoredHighlightBlocksFromExistingNotes } from "./IgnoredHighlightCleanup";

class MockTFile {
	path: string;
	extension: string;

	constructor(path: string) {
		this.path = normalizeMockPath(path);
		this.extension = this.path.split(".").pop() ?? "";
	}
}

class MockFolder {
	path: string;
	children: Array<MockFolder | MockTFile> = [];

	constructor(path: string) {
		this.path = normalizeMockPath(path);
	}
}

class MockVault {
	private readonly files = new Map<string, string>();
	private readonly folders = new Map<string, MockFolder>();
	private readonly fileObjects = new Map<string, MockTFile>();
	private modifyCount = 0;

	constructor() {
		this.addFolder("Kindle Highlights");
	}

	addFolder(path: string): MockFolder {
		const normalizedPath = normalizeMockPath(path);
		const existing = this.folders.get(normalizedPath);

		if (existing) {
			return existing;
		}

		const folder = new MockFolder(normalizedPath);
		this.folders.set(normalizedPath, folder);

		const parent = this.folders.get(parentPath(normalizedPath));

		if (parent && !parent.children.includes(folder)) {
			parent.children.push(folder);
		}

		return folder;
	}

	addFile(path: string, content: string): MockTFile {
		const normalizedPath = normalizeMockPath(path);
		const folder = this.addFolder(parentPath(normalizedPath));
		const file = new MockTFile(normalizedPath);

		this.files.set(normalizedPath, content);
		this.fileObjects.set(normalizedPath, file);
		folder.children.push(file);

		return file;
	}

	getAbstractFileByPath(path: string): MockFolder | MockTFile | null {
		const normalizedPath = normalizeMockPath(path);

		return this.fileObjects.get(normalizedPath) ?? this.folders.get(normalizedPath) ?? null;
	}

	async read(file: MockTFile): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	async modify(file: MockTFile, content: string): Promise<void> {
		this.modifyCount++;
		this.files.set(file.path, content);
	}

	readFile(path: string): string {
		return this.files.get(normalizeMockPath(path)) ?? "";
	}

	modifies(): number {
		return this.modifyCount;
	}
}

describe("ignored highlight cleanup", () => {
	it("removes one ignored highlight block from a generated region", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep this highlight.", location: "160" });
		vault.addFile("Kindle Highlights/Atomic Habits.md", renderNote([ignoredHighlight, keptHighlight]));

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createClippingId(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/Atomic Habits.md");
		expect(markdown).not.toContain("Remove this highlight.");
		expect(markdown).toContain("Keep this highlight.");
		expect(markdown).toContain(SYNC_START_MARKER);
		expect(markdown).toContain(SYNC_END_MARKER);
	});

	it("preserves non-ignored highlight blocks", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep this highlight.", location: "160" });
		vault.addFile("Kindle Highlights/Atomic Habits.md", renderNote([ignoredHighlight, keptHighlight]));

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createClippingId(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/Atomic Habits.md");
		expect(markdown).toContain(renderClippingMarkdown(keptHighlight));
		expect(markdown).toContain(`<!-- kindle-local-sync-id: ${createClippingId(keptHighlight)} -->`);
	});

	it("preserves content before and after sync markers", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight." });
		vault.addFile(
			"Kindle Highlights/Atomic Habits.md",
			renderNote([ignoredHighlight], "User introduction.", "User outro.")
		);

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createClippingId(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/Atomic Habits.md");
		expect(markdown).toContain("User introduction.");
		expect(markdown).toContain("User outro.");
	});

	it("does not modify a note without sync markers", async () => {
		const vault = new MockVault();
		const originalMarkdown = "# Atomic Habits\n\nRemove this highlight.\n\n<!-- kindle-local-sync-id: kls-example -->";
		vault.addFile("Kindle Highlights/Atomic Habits.md", originalMarkdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			["kls-example"]
		);

		expect(vault.readFile("Kindle Highlights/Atomic Habits.md")).toBe(originalMarkdown);
		expect(summary.filesUpdated).toBe(0);
		expect(vault.modifies()).toBe(0);
	});

	it("does not modify a note when the ignored ID is not found", async () => {
		const vault = new MockVault();
		const highlight = createHighlight({ content: "Keep this highlight." });
		const originalMarkdown = renderNote([highlight]);
		vault.addFile("Kindle Highlights/Atomic Habits.md", originalMarkdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			["kls-missing"]
		);

		expect(vault.readFile("Kindle Highlights/Atomic Habits.md")).toBe(originalMarkdown);
		expect(summary.filesUpdated).toBe(0);
	});

	it("handles multiple ignored highlights in one note", async () => {
		const vault = new MockVault();
		const firstIgnored = createHighlight({ content: "Remove first.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep middle.", location: "160" });
		const secondIgnored = createHighlight({ content: "Remove second.", location: "170" });
		vault.addFile("Kindle Highlights/Atomic Habits.md", renderNote([firstIgnored, keptHighlight, secondIgnored]));

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createClippingId(firstIgnored), createClippingId(secondIgnored)]
		);

		const markdown = vault.readFile("Kindle Highlights/Atomic Habits.md");
		expect(markdown).not.toContain("Remove first.");
		expect(markdown).not.toContain("Remove second.");
		expect(markdown).toContain("Keep middle.");
		expect(summary.blocksRemoved).toBe(2);
	});

	it("is idempotent when run twice", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep this highlight.", location: "160" });
		vault.addFile("Kindle Highlights/Atomic Habits.md", renderNote([ignoredHighlight, keptHighlight]));
		const ignoredIds = [createClippingId(ignoredHighlight)];

		await removeIgnoredHighlightBlocksFromExistingNotes(vault as unknown as Vault, "Kindle Highlights", ignoredIds);
		const afterFirstRun = vault.readFile("Kindle Highlights/Atomic Habits.md");
		const secondSummary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			ignoredIds
		);

		expect(vault.readFile("Kindle Highlights/Atomic Habits.md")).toBe(afterFirstRun);
		expect(secondSummary.filesUpdated).toBe(0);
	});
});

function renderNote(highlights: KindleHighlight[], before = "", after = ""): string {
	return [
		"# Atomic Habits",
		"",
		before,
		"",
		SYNC_START_MARKER,
		"",
		...joinBlocks(highlights.map(renderClippingMarkdown)),
		SYNC_END_MARKER,
		"",
		after,
	].join("\n");
}

function joinBlocks(blocks: string[]): string[] {
	return blocks.flatMap((block, index) => index === blocks.length - 1 ? [block, ""] : [block, "", ""]);
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

function parentPath(path: string): string {
	const index = path.lastIndexOf("/");

	return index === -1 ? "" : path.slice(0, index);
}

function normalizeMockPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}
