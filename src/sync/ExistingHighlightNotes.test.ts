import { describe, expect, it } from "vitest";
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

function renderManagedRegion(id: string): string {
	return [
		SYNC_START_MARKER,
		`<!-- kindle-local-sync-id: ${id} -->`,
		SYNC_END_MARKER,
	].join("\n");
}
