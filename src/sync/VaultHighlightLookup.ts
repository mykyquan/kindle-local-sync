import type { TFile, Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import {
	KindleBookGroup,
	renderLegacyClippingMarkdown,
} from "../render/renderMarkdown";
import {
	createBookIdentityKey,
	createClippingId,
	createKindleHighlightIdentityKey,
	createLegacyClippingId,
} from "./HighlightIdentity";
import { analyzeManagedRegion, hasExactManagedHighlightBlock } from "./ManagedRegion";
import { allocateBookNotePaths } from "./VaultWriter";

export class AmbiguousLegacyClippingIdentityError extends Error {
	constructor(readonly bookTitle: string, readonly author: string, readonly legacyId: string) {
		super("A legacy clipping ID maps to multiple current records in the same book.");
		this.name = "AmbiguousLegacyClippingIdentityError";
	}
}

export function createVaultHighlightLookup(
	vault: Vault,
	highlightsFolder: string,
	bookGroups: KindleBookGroup[]
): (id: string, highlight: KindleHighlight) => Promise<boolean> {
	const notePathsByHighlightIdentity = new Map<string, string>();
	const distinctStrongIdsByLegacyBookKey = new Map<string, Set<string>>();
	const notePaths = allocateBookNotePaths(highlightsFolder, bookGroups);
	const markdownByNotePath = new Map<string, Promise<string | null>>();

	for (const [groupIndex, group] of bookGroups.entries()) {
		const notePath = notePaths[groupIndex];

		if (!notePath) {
			continue;
		}

		for (const clipping of group.clippings) {
			notePathsByHighlightIdentity.set(createKindleHighlightIdentityKey(clipping), notePath);
			const legacyKey = createLegacyBookMarkerKey(clipping);
			const strongIds = distinctStrongIdsByLegacyBookKey.get(legacyKey) ?? new Set<string>();

			strongIds.add(createClippingId(clipping));
			distinctStrongIdsByLegacyBookKey.set(legacyKey, strongIds);
		}
	}

	return async (id: string, highlight: KindleHighlight): Promise<boolean> => {
		if (id !== createClippingId(highlight)) {
			return false;
		}

		const notePath = notePathsByHighlightIdentity.get(createKindleHighlightIdentityKey(highlight));

		if (!notePath) {
			return false;
		}

		let markdownPromise = markdownByNotePath.get(notePath);

		if (!markdownPromise) {
			markdownPromise = readVaultMarkdown(vault, notePath);
			markdownByNotePath.set(notePath, markdownPromise);
		}

		const markdown = await markdownPromise;

		if (markdown === null) {
			return false;
		}

		const managedRegion = analyzeManagedRegion(markdown);

		if (managedRegion.kind === "unsafe") {
			// An unreadable ownership boundary is not evidence that a reviewed highlight is missing.
			throw new Error(`Cannot reconcile an unsafe managed region: ${managedRegion.reason}.`);
		}

		if (managedRegion.kind !== "valid-with-ids") {
			return false;
		}

		if (managedRegion.highlightIds.includes(id)) {
			return true;
		}

		const legacyId = createLegacyClippingId(highlight);

		if (!managedRegion.highlightIds.includes(legacyId)) {
			return false;
		}

		if ((distinctStrongIdsByLegacyBookKey.get(createLegacyBookMarkerKey(highlight))?.size ?? 0) !== 1) {
			throw new AmbiguousLegacyClippingIdentityError(
				highlight.bookTitle,
				highlight.author,
				legacyId
			);
		}

		// A marker alone is insufficient for migration: the complete released block must match this record.
		return hasExactManagedHighlightBlock(markdown, renderLegacyClippingMarkdown(highlight));
	};
}

function createLegacyBookMarkerKey(highlight: KindleHighlight): string {
	return JSON.stringify([
		createBookIdentityKey(highlight.bookTitle, highlight.author),
		createLegacyClippingId(highlight),
	]);
}

async function readVaultMarkdown(vault: Vault, notePath: string): Promise<string | null> {
	const existingFile = vault.getAbstractFileByPath(notePath);

	if (existingFile) {
		if (!isVaultFile(existingFile)) {
			return null;
		}

		return vault.read(existingFile);
	}

	if (await vault.adapter.exists(notePath)) {
		const stat = await vault.adapter.stat(notePath);

		if (stat?.type !== "file") {
			return null;
		}

		return vault.adapter.read(notePath);
	}

	return null;
}

function isVaultFile(file: unknown): file is TFile {
	return typeof file === "object" && file !== null && "extension" in file;
}
