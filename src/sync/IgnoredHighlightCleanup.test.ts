import { describe, expect, it, vi } from "vitest";
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
	private readonly readFailurePaths = new Set<string>();
	private readonly writeFailurePaths = new Set<string>();
	private readonly verificationReadFailurePaths = new Set<string>();
	private readonly writeAttemptedPaths = new Set<string>();
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
		if (
			this.readFailurePaths.has(file.path)
			|| (this.writeAttemptedPaths.has(file.path) && this.verificationReadFailurePaths.has(file.path))
		) {
			throw new Error(`Read failed for ${file.path}`);
		}

		return this.files.get(file.path) ?? "";
	}

	async modify(file: MockTFile, content: string): Promise<void> {
		this.modifyCount++;
		this.writeAttemptedPaths.add(file.path);

		if (this.writeFailurePaths.has(file.path)) {
			throw new Error(`Write failed for ${file.path}`);
		}

		this.files.set(file.path, content);
	}

	failRead(path: string): void {
		this.readFailurePaths.add(normalizeMockPath(path));
	}

	failWrite(path: string, verificationReadFails = false): void {
		const normalizedPath = normalizeMockPath(path);

		this.writeFailurePaths.add(normalizedPath);
		if (verificationReadFails) {
			this.verificationReadFailurePaths.add(normalizedPath);
		}
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
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", renderNote([ignoredHighlight, keptHighlight]));

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/The Clockwork Orchard.md");
		expect(markdown).not.toContain("Remove this highlight.");
		expect(markdown).toContain("Keep this highlight.");
		expect(markdown).toContain(SYNC_START_MARKER);
		expect(markdown).toContain(SYNC_END_MARKER);
	});

	it("preserves non-ignored highlight blocks", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep this highlight.", location: "160" });
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", renderNote([ignoredHighlight, keptHighlight]));

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/The Clockwork Orchard.md");
		expect(markdown).toContain(renderClippingMarkdown(keptHighlight));
		expect(markdown).toContain(`<!-- kindle-local-sync-id: ${createClippingId(keptHighlight)} -->`);
	});

	it("preserves content before and after sync markers", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight." });
		vault.addFile(
			"Kindle Highlights/The Clockwork Orchard.md",
			renderNote([ignoredHighlight], "User introduction.", "User outro.")
		);

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(ignoredHighlight)]
		);

		const markdown = vault.readFile("Kindle Highlights/The Clockwork Orchard.md");
		expect(markdown).toContain("User introduction.");
		expect(markdown).toContain("User outro.");
	});

	it("does not modify a note without sync markers", async () => {
		const vault = new MockVault();
		const originalMarkdown = "# The Clockwork Orchard\n\nRemove this highlight.\n\n<!-- kindle-local-sync-id: kls-example -->";
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", originalMarkdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[{ bookTitle: "The Clockwork Orchard", author: "Mira Vale", id: "kls-example" }]
		);

		expect(vault.readFile("Kindle Highlights/The Clockwork Orchard.md")).toBe(originalMarkdown);
		expect(summary.filesUpdated).toBe(0);
		expect(vault.modifies()).toBe(0);
	});

	it("does not modify a note when the ignored ID is not found", async () => {
		const vault = new MockVault();
		const highlight = createHighlight({ content: "Keep this highlight." });
		const originalMarkdown = renderNote([highlight]);
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", originalMarkdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[{ bookTitle: "The Clockwork Orchard", author: "Mira Vale", id: "kls-missing" }]
		);

		expect(vault.readFile("Kindle Highlights/The Clockwork Orchard.md")).toBe(originalMarkdown);
		expect(summary.filesUpdated).toBe(0);
	});

	it("handles multiple ignored highlights in one note", async () => {
		const vault = new MockVault();
		const firstIgnored = createHighlight({ content: "Remove first.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep middle.", location: "160" });
		const secondIgnored = createHighlight({ content: "Remove second.", location: "170" });
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", renderNote([firstIgnored, keptHighlight, secondIgnored]));

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(firstIgnored), createCleanupTarget(secondIgnored)]
		);

		const markdown = vault.readFile("Kindle Highlights/The Clockwork Orchard.md");
		expect(markdown).not.toContain("Remove first.");
		expect(markdown).not.toContain("Remove second.");
		expect(markdown).toContain("Keep middle.");
		expect(summary.blocksRemoved).toBe(2);
	});

	it("removes found targets and reports missing targets in order within one safe note", async () => {
		const vault = new MockVault();
		const removed = createHighlight({ content: "Remove this target.", location: "154" });
		const retained = createHighlight({ content: "Retain unrelated content.", location: "160" });
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";
		const originalMarkdown = renderNote([removed, retained], "Personal before.", "Personal after.");
		const missingTarget = {
			bookTitle: removed.bookTitle,
			author: removed.author,
			id: "kls-missing",
		};

		vault.addFile(notePath, originalMarkdown);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[missingTarget, createCleanupTarget(removed)]
		);

		expect(summary.bookOutcomes).toEqual([{
			bookTitle: removed.bookTitle,
			author: removed.author,
			targetOutcomes: [
				{ target: missingTarget, status: "no-matching-highlight-block" },
				{ target: createCleanupTarget(removed), status: "removed-safely", blocksRemoved: 1 },
			],
		}]);
		expect(summary).toMatchObject({ filesUpdated: 1, blocksRemoved: 1 });
		expect(vault.readFile(notePath)).not.toContain("Remove this target.");
		expect(vault.readFile(notePath)).toContain(renderClippingMarkdown(retained));
		expect(vault.readFile(notePath)).toContain("Personal before.");
		expect(vault.readFile(notePath)).toContain("Personal after.");
	});

	it("reports a safe note without managed blocks as no matching highlight block", async () => {
		const vault = new MockVault();
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";
		const markdown = [
			"---",
			`title: ${JSON.stringify(highlight.bookTitle)}`,
			`author: ${JSON.stringify(highlight.author)}`,
			"---",
			"",
			"Personal content only.",
		].join("\n");

		vault.addFile(notePath, markdown);
		const target = createCleanupTarget(highlight);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[target]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([
			{ target, status: "no-matching-highlight-block" },
		]);
		expect(vault.readFile(notePath)).toBe(markdown);
		expect(vault.modifies()).toBe(0);
	});

	it("is idempotent when run twice", async () => {
		const vault = new MockVault();
		const ignoredHighlight = createHighlight({ content: "Remove this highlight.", location: "154" });
		const keptHighlight = createHighlight({ content: "Keep this highlight.", location: "160" });
		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", renderNote([ignoredHighlight, keptHighlight]));
		const ignoredTargets = [createCleanupTarget(ignoredHighlight)];

		await removeIgnoredHighlightBlocksFromExistingNotes(vault as unknown as Vault, "Kindle Highlights", ignoredTargets);
		const afterFirstRun = vault.readFile("Kindle Highlights/The Clockwork Orchard.md");
		const secondSummary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			ignoredTargets
		);

		expect(vault.readFile("Kindle Highlights/The Clockwork Orchard.md")).toBe(afterFirstRun);
		expect(secondSummary.filesUpdated).toBe(0);
	});

	it("removes a colliding ID only from the exact selected book", async () => {
		const vault = new MockVault();
		const bookA = createHighlight({
			bookTitle: "Collision 1h0o65e 20hu",
			author: "Author",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const bookB = createHighlight({
			bookTitle: "Collision 1y0rlvz 2269",
			author: "Author",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const bookAMarkdown = renderNote([bookA]);
		const bookBMarkdown = renderNote([bookB]);

		expect(createClippingId(bookA)).toBe(createClippingId(bookB));
		vault.addFile("Kindle Highlights/Book A.md", bookAMarkdown);
		vault.addFile("Kindle Highlights/Book B.md", bookBMarkdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(bookA)]
		);

		expect(vault.readFile("Kindle Highlights/Book A.md")).not.toContain(renderClippingMarkdown(bookA));
		expect(vault.readFile("Kindle Highlights/Book B.md")).toBe(bookBMarkdown);
		expect(summary).toMatchObject({ filesUpdated: 1, blocksRemoved: 1 });
	});

	it("uses exact author when two notes have the same title and colliding ID", async () => {
		const vault = new MockVault();
		const first = createHighlight({
			bookTitle: "Same Title",
			author: "Author i5onjs phg65z",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const second = createHighlight({
			bookTitle: "Same Title",
			author: "Author 1lqf5c4 1t7ix5f",
			location: "1",
			dateAdded: "Date",
			content: "Content",
		});
		const secondMarkdown = renderNote([second]);

		expect(createClippingId(first)).toBe(createClippingId(second));
		vault.addFile("Kindle Highlights/First.md", renderNote([first]));
		vault.addFile("Kindle Highlights/Second.md", secondMarkdown);

		await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(first)]
		);

		expect(vault.readFile("Kindle Highlights/First.md")).not.toContain(renderClippingMarkdown(first));
		expect(vault.readFile("Kindle Highlights/Second.md")).toBe(secondMarkdown);
	});

	it("makes zero writes when exact book ownership is ambiguous", async () => {
		const vault = new MockVault();
		const highlight = createHighlight();
		const markdown = renderNote([highlight]);

		vault.addFile("Kindle Highlights/First.md", markdown);
		vault.addFile("Kindle Highlights/Second.md", markdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(highlight)]
		);

		expect(vault.readFile("Kindle Highlights/First.md")).toBe(markdown);
		expect(vault.readFile("Kindle Highlights/Second.md")).toBe(markdown);
		expect(summary.filesUpdated).toBe(0);
		expect(vault.modifies()).toBe(0);
		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target: createCleanupTarget(highlight),
			status: "ambiguous-note-ownership",
		}]);
	});

	it("makes zero writes when book frontmatter is missing", async () => {
		const vault = new MockVault();
		const highlight = createHighlight();
		const markdown = [
			"# The Clockwork Orchard",
			"",
			SYNC_START_MARKER,
			"",
			renderClippingMarkdown(highlight),
			"",
			SYNC_END_MARKER,
		].join("\n");

		vault.addFile("Kindle Highlights/The Clockwork Orchard.md", markdown);

		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(highlight)]
		);

		expect(vault.readFile("Kindle Highlights/The Clockwork Orchard.md")).toBe(markdown);
		expect(summary.filesUpdated).toBe(0);
		expect(vault.modifies()).toBe(0);
		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target: createCleanupTarget(highlight),
			status: "no-matching-note",
		}]);
	});

	it("reports an unsafe managed region and preserves the exact note", async () => {
		const vault = new MockVault();
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";
		const markdown = [
			"---",
			`title: ${JSON.stringify(highlight.bookTitle)}`,
			`author: ${JSON.stringify(highlight.author)}`,
			"---",
			"",
			SYNC_START_MARKER,
			"",
			renderClippingMarkdown(highlight),
		].join("\n");

		vault.addFile(notePath, markdown);
		const target = createCleanupTarget(highlight);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[target]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target,
			status: "unsafe-managed-region",
			reason: "start-without-end",
		}]);
		expect(summary.blocksRemoved).toBe(0);
		expect(vault.modifies()).toBe(0);
		expect(vault.readFile(notePath)).toBe(markdown);
	});

	it("reports read failures without attempting any cleanup write", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const vault = new MockVault();
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";

		vault.addFile(notePath, renderNote([highlight]));
		vault.failRead(notePath);
		const target = createCleanupTarget(highlight);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[target]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target,
			status: "cleanup-failed",
			stage: "read",
		}]);
		expect(summary.blocksRemoved).toBe(0);
		expect(vault.modifies()).toBe(0);
		expect(errorLog).toHaveBeenCalledTimes(1);
		errorLog.mockRestore();
	});

	it("does not report a block as removed when a rejected write leaves the note unchanged", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const vault = new MockVault();
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";
		const markdown = renderNote([highlight]);

		vault.addFile(notePath, markdown);
		vault.failWrite(notePath);
		const target = createCleanupTarget(highlight);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[target]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target,
			status: "cleanup-failed",
			stage: "write",
		}]);
		expect(summary.blocksRemoved).toBe(0);
		expect(vault.readFile(notePath)).toBe(markdown);
		expect(errorLog).toHaveBeenCalledTimes(1);
		errorLog.mockRestore();
	});

	it("continues an unrelated safe book after another book write fails", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const vault = new MockVault();
		const failedHighlight = createHighlight({ bookTitle: "Failed Book", author: "Author One" });
		const safeHighlight = createHighlight({ bookTitle: "Safe Book", author: "Author Two" });
		const failedPath = "Kindle Highlights/Failed.md";
		const safePath = "Kindle Highlights/Safe.md";
		const failedMarkdown = renderNote([failedHighlight]);

		vault.addFile(failedPath, failedMarkdown);
		vault.addFile(safePath, renderNote([safeHighlight]));
		vault.failWrite(failedPath);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createCleanupTarget(failedHighlight), createCleanupTarget(safeHighlight)]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes[0]).toMatchObject({
			status: "cleanup-failed",
			stage: "write",
		});
		expect(summary.bookOutcomes[1]?.targetOutcomes[0]).toMatchObject({
			status: "removed-safely",
			blocksRemoved: 1,
		});
		expect(vault.readFile(failedPath)).toBe(failedMarkdown);
		expect(vault.readFile(safePath)).not.toContain(renderClippingMarkdown(safeHighlight));
		expect(summary).toMatchObject({ filesUpdated: 1, blocksRemoved: 1 });
		expect(errorLog).toHaveBeenCalledTimes(1);
		errorLog.mockRestore();
	});

	it("reports unknown cleanup state when a rejected write cannot be verified", async () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const vault = new MockVault();
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";

		vault.addFile(notePath, renderNote([highlight]));
		vault.failWrite(notePath, true);
		const target = createCleanupTarget(highlight);
		const summary = await removeIgnoredHighlightBlocksFromExistingNotes(
			vault as unknown as Vault,
			"Kindle Highlights",
			[target]
		);

		expect(summary.bookOutcomes[0]?.targetOutcomes).toEqual([{
			target,
			status: "cleanup-state-unknown",
			stage: "write",
		}]);
		expect(summary.blocksRemoved).toBe(0);
		expect(errorLog).toHaveBeenCalledTimes(1);
		errorLog.mockRestore();
	});
});

function renderNote(highlights: KindleHighlight[], before = "", after = ""): string {
	const firstHighlight = highlights[0] ?? createHighlight();

	return [
		"---",
		`title: ${JSON.stringify(firstHighlight.bookTitle)}`,
		`author: ${JSON.stringify(firstHighlight.author)}`,
		"---",
		"",
		"# The Clockwork Orchard",
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

function createCleanupTarget(highlight: KindleHighlight) {
	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		id: createClippingId(highlight),
	};
}

function joinBlocks(blocks: string[]): string[] {
	return blocks.flatMap((block, index) => index === blocks.length - 1 ? [block, ""] : [block, "", ""]);
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
