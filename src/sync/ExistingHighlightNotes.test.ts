import { describe, expect, it, vi } from "vitest";
import { App } from "../../__mocks__/obsidian";
import { SYNC_END_MARKER, SYNC_START_MARKER } from "../render/renderMarkdown";
import { hasExistingHighlightNotes } from "./ExistingHighlightNotes";

describe("existing notes without data.json", () => {
	it("detects a valid managed highlight ID in the highlights folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [createMarkdownFile(renderManagedRegion("kls-managed1"))],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
	});

	it("detects a valid managed highlight ID one folder below the configured highlights folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([
				createFolder([createMarkdownFile(renderManagedRegion("kls-nested1"))]),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
	});

	it("detects a valid managed highlight ID multiple folders below the configured highlights folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([
				createFolder([
					createFolder([createMarkdownFile(renderManagedRegion("kls-deep1"))]),
				]),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
	});

	it("keeps legacy managed marker compatibility for a nested note", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([
				createFolder([createMarkdownFile(renderManagedRegion("kls-legacy1"))]),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
	});

	it("does not trust an ID-shaped comment outside the managed region", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [createMarkdownFile([
					"<!-- kindle-local-sync-id: kls-outside1 -->",
					SYNC_START_MARKER,
					SYNC_END_MARKER,
				].join("\n"))],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("does not trust unmatched managed markers", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [createMarkdownFile([
					SYNC_START_MARKER,
					"<!-- kindle-local-sync-id: kls-unmatched1 -->",
				].join("\n"))],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("does not treat marker-free markdown as managed-note evidence", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [createMarkdownFile("# Personal Kindle notes\n")],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("does not trust unrelated Markdown inside a nested folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([
				createFolder([createMarkdownFile("# Personal archived notes\n")]),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("returns false when the highlights folder does not exist", async () => {
		const app = new App(createVault({}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("returns false when the highlights folder has no markdown files", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [{ extension: "txt", content: renderManagedRegion("kls-text1") }],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("ignores non-Markdown files inside nested folders", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([
				createFolder([{ extension: "txt", content: renderManagedRegion("kls-text-nested1") }]),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("does not scan a similarly named sibling folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": createFolder([]),
			"Kindle Highlights Archive": createFolder([
				createMarkdownFile(renderManagedRegion("kls-sibling1")),
			]),
			"Kindle Highlights Backup": createFolder([
				createMarkdownFile(renderManagedRegion("kls-sibling2")),
			]),
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("finds existing notes across direct and nested locations without reprocessing a shared file", async () => {
		const directFile = createMarkdownFile(renderManagedRegion("kls-direct1"));
		const nestedFile = createMarkdownFile(renderManagedRegion("kls-nested2"));
		const vault = createVault({
			"Kindle Highlights": createFolder([
				directFile,
				createFolder([directFile, nestedFile]),
			]),
		});
		const read = vi.fn(async (file: unknown) => (file as { content: string }).content);
		const app = new App({ ...vault, read });

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(directFile);
	});

	it("does not read a file twice when vault children expose it directly and through a nested folder", async () => {
		const repeatedUnmanagedFile = createMarkdownFile("# Personal duplicate reference\n");
		const managedFile = createMarkdownFile(renderManagedRegion("kls-managedonce"));
		const vault = createVault({
			"Kindle Highlights": createFolder([
				repeatedUnmanagedFile,
				createFolder([repeatedUnmanagedFile, managedFile]),
			]),
		});
		const read = vi.fn(async (file: unknown) => (file as { content: string }).content);
		const app = new App({ ...vault, read });

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
		expect(read).toHaveBeenCalledTimes(2);
		expect(read).toHaveBeenNthCalledWith(1, repeatedUnmanagedFile);
		expect(read).toHaveBeenNthCalledWith(2, managedFile);
	});
});

function createVault(files: Record<string, unknown>) {
	return {
		getAbstractFileByPath: (path: string) => files[path] ?? null,
		read: async (file: unknown) => (file as { content: string }).content,
	};
}

function createMarkdownFile(content: string) {
	return { extension: "md", content };
}

function createFolder(children: unknown[]) {
	return { children };
}

function renderManagedRegion(id: string): string {
	return [
		SYNC_START_MARKER,
		`<!-- kindle-local-sync-id: ${id} -->`,
		SYNC_END_MARKER,
	].join("\n");
}
