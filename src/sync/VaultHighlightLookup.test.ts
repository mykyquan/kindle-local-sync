import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId, KindleBookGroup } from "../render/renderMarkdown";
import { createVaultHighlightLookup } from "./VaultHighlightLookup";
import { allocateBookNotePaths, createVaultWritePlan } from "./VaultWriter";

class MockFile {
	extension = "md";

	constructor(public path: string) {
	}
}

class MockVault {
	private readonly files = new Map<string, { file: MockFile; markdown: string }>();
	adapter = {
		exists: async () => false,
		stat: async () => null,
		read: async () => "",
	};

	addFile(path: string, markdown: string): void {
		this.files.set(path, { file: new MockFile(path), markdown });
	}

	getAbstractFileByPath(path: string): MockFile | null {
		return this.files.get(path)?.file ?? null;
	}

	async read(file: MockFile): Promise<string> {
		return this.files.get(file.path)?.markdown ?? "";
	}
}

describe("createVaultHighlightLookup", () => {
	it("looks up real colliding IDs in their exact book notes", async () => {
		const bookA = createCollisionHighlight("Collision 1h0o65e 20hu");
		const bookB = createCollisionHighlight("Collision 1y0rlvz 2269");
		const groups = [createGroup(bookA), createGroup(bookB)];
		const paths = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();
		const bookAPath = paths[0];

		if (!bookAPath) {
			throw new Error("Expected a path for Book A.");
		}

		expect(createClippingId(bookA)).toBe(createClippingId(bookB));
		vault.addFile(bookAPath, renderMarker(createClippingId(bookA)));
		const lookup = createVaultHighlightLookup(
			vault as unknown as Vault,
			"Kindle Highlights",
			groups
		);

		expect(await lookup(createClippingId(bookA), bookA)).toBe(true);
		expect(await lookup(createClippingId(bookB), bookB)).toBe(false);
	});

	it("uses the shared ordered allocator for sanitized path collisions", async () => {
		const first = createHighlight({ bookTitle: "Shared/Title", author: "Author", content: "First" });
		const second = createHighlight({ bookTitle: "Shared:Title", author: "Author", content: "Second" });
		const groups = [createGroup(first), createGroup(second)];
		const paths = allocateBookNotePaths("Kindle Highlights", groups);
		const writePlan = createVaultWritePlan("Kindle Highlights", groups);
		const vault = new MockVault();

		expect(writePlan.bookPlans.map((plan) => plan.notePath)).toEqual(paths);

		for (const [index, highlight] of [first, second].entries()) {
			const path = paths[index];

			if (!path) {
				throw new Error("Expected an allocated book path.");
			}

			vault.addFile(path, renderMarker(createClippingId(highlight)));
		}

		const lookup = createVaultHighlightLookup(
			vault as unknown as Vault,
			"Kindle Highlights",
			groups
		);

		expect(await lookup(createClippingId(first), first)).toBe(true);
		expect(await lookup(createClippingId(second), second)).toBe(true);
	});
});

function renderMarker(id: string): string {
	return `<!-- kindle-local-sync-id: ${id} -->`;
}

function createGroup(highlight: KindleHighlight): KindleBookGroup {
	return {
		bookTitle: highlight.bookTitle,
		author: highlight.author,
		clippings: [highlight],
	};
}

function createCollisionHighlight(bookTitle: string): KindleHighlight {
	return createHighlight({
		bookTitle,
		author: "Author",
		location: "1",
		dateAdded: "Date",
		content: "Content",
	});
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
