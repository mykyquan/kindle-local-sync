import { describe, expect, it } from "vitest";
import type { Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import {
	createClippingId,
	KindleBookGroup,
	renderLegacyClippingMarkdown,
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { createSyntheticSameBookCollision } from "../testFixtures/syntheticSameBookCollision";
import { createLegacyClippingId } from "./HighlightIdentity";
import {
	AmbiguousLegacyClippingIdentityError,
	createVaultHighlightLookup,
} from "./VaultHighlightLookup";
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
	it("finds an imported highlight only when its ID remains inside the managed region", async () => {
		const highlight = createHighlight();
		const groups = [createGroup(highlight)];
		const [notePath] = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, renderManagedMarkers([createClippingId(highlight)]));
		const lookup = createVaultHighlightLookup(vault as unknown as Vault, "Kindle Highlights", groups);

		expect(await lookup(createClippingId(highlight), highlight)).toBe(true);
	});

	it("reports one removed highlight as absent while another managed ID remains", async () => {
		const present = createHighlight();
		const removed = createHighlight({
			location: "160",
			content: "Removed managed highlight.",
		});
		const groups = [{
			bookTitle: present.bookTitle,
			author: present.author,
			clippings: [present, removed],
		}];
		const [notePath] = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, renderManagedMarkers([createClippingId(present)]));
		const lookup = createVaultHighlightLookup(vault as unknown as Vault, "Kindle Highlights", groups);

		expect(await lookup(createClippingId(present), present)).toBe(true);
		expect(await lookup(createClippingId(removed), removed)).toBe(false);
	});

	it("reports every highlight as absent when the entire managed region was removed", async () => {
		const first = createHighlight();
		const second = createHighlight({
			location: "160",
			content: "Second managed highlight.",
		});
		const groups = [{
			bookTitle: first.bookTitle,
			author: first.author,
			clippings: [first, second],
		}];
		const [notePath] = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, "Personal introduction.\n\nPersonal ending.\n");
		const lookup = createVaultHighlightLookup(vault as unknown as Vault, "Kindle Highlights", groups);

		expect(await lookup(createClippingId(first), first)).toBe(false);
		expect(await lookup(createClippingId(second), second)).toBe(false);
	});

	it("does not trust an ID-shaped user comment outside the managed region", async () => {
		const highlight = createHighlight();
		const groups = [createGroup(highlight)];
		const [notePath] = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, renderMarker(createClippingId(highlight)));
		const lookup = createVaultHighlightLookup(vault as unknown as Vault, "Kindle Highlights", groups);

		expect(await lookup(createClippingId(highlight), highlight)).toBe(false);
	});

	it("fails closed when managed-region ownership is unsafe", async () => {
		const highlight = createHighlight();
		const groups = [createGroup(highlight)];
		const [notePath] = allocateBookNotePaths("Kindle Highlights", groups);
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, `${SYNC_START_MARKER}\n${renderMarker(createClippingId(highlight))}\n`);
		const lookup = createVaultHighlightLookup(vault as unknown as Vault, "Kindle Highlights", groups);

		await expect(lookup(createClippingId(highlight), highlight)).rejects.toThrow(
			"Cannot reconcile an unsafe managed region"
		);
	});

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

		expect(createLegacyClippingId(bookA)).toBe(createLegacyClippingId(bookB));
		expect(createClippingId(bookA)).not.toBe(createClippingId(bookB));
		vault.addFile(bookAPath, renderManagedMarkers([createClippingId(bookA)]));
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

			vault.addFile(path, renderManagedMarkers([createClippingId(highlight)]));
		}

		const lookup = createVaultHighlightLookup(
			vault as unknown as Vault,
			"Kindle Highlights",
			groups
		);

		expect(await lookup(createClippingId(first), first)).toBe(true);
		expect(await lookup(createClippingId(second), second)).toBe(true);
	});

	it("trusts one exact released block but never reuses an ambiguous legacy marker for collision peers", async () => {
		const [first, second] = createSyntheticSameBookCollision();
		const notePath = allocateBookNotePaths("Kindle Highlights", [createGroup(first)])[0];
		const vault = new MockVault();

		if (!notePath) {
			throw new Error("Expected an allocated note path.");
		}

		vault.addFile(notePath, [
			SYNC_START_MARKER,
			"",
			renderLegacyClippingMarkdown(first),
			"",
			SYNC_END_MARKER,
		].join("\n"));

		const uniqueLookup = createVaultHighlightLookup(
			vault as unknown as Vault,
			"Kindle Highlights",
			[createGroup(first)]
		);
		const ambiguousLookup = createVaultHighlightLookup(
			vault as unknown as Vault,
			"Kindle Highlights",
			[{
				bookTitle: first.bookTitle,
				author: first.author,
				clippings: [first, second],
			}]
		);

		expect(await uniqueLookup(createClippingId(first), first)).toBe(true);
		await expect(ambiguousLookup(createClippingId(first), first))
			.rejects.toBeInstanceOf(AmbiguousLegacyClippingIdentityError);
		await expect(ambiguousLookup(createClippingId(second), second))
			.rejects.toBeInstanceOf(AmbiguousLegacyClippingIdentityError);
	});
});

function renderMarker(id: string): string {
	return `<!-- kindle-local-sync-id: ${id} -->`;
}

function renderManagedMarkers(ids: string[]): string {
	return [
		SYNC_START_MARKER,
		...ids.map(renderMarker),
		SYNC_END_MARKER,
	].join("\n");
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
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight",
		...overrides,
	};
}
