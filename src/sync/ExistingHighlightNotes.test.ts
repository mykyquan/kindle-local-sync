import { describe, expect, it } from "vitest";
import { App } from "../../__mocks__/obsidian";
import { hasExistingHighlightNotes } from "./ExistingHighlightNotes";

describe("existing notes without data.json", () => {
	it("detects existing markdown notes in the highlights folder", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [{ extension: "md" }],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(true);
	});

	it("returns false when the highlights folder does not exist", async () => {
		const app = new App(createVault({}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});

	it("returns false when the highlights folder has no markdown files", async () => {
		const app = new App(createVault({
			"Kindle Highlights": {
				children: [{ extension: "txt" }],
			},
		}));

		await expect(hasExistingHighlightNotes(app as never, "Kindle Highlights")).resolves.toBe(false);
	});
});

function createVault(files: Record<string, unknown>) {
	return {
		getAbstractFileByPath: (path: string) => files[path] ?? null,
	};
}
