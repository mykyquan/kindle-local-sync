import type { TFile, Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId, KindleBookGroup } from "../render/renderMarkdown";
import { createKindleHighlightIdentityKey } from "./HighlightIdentity";
import { analyzeManagedRegion } from "./ManagedRegion";
import { allocateBookNotePaths } from "./VaultWriter";

export function createVaultHighlightLookup(
	vault: Vault,
	highlightsFolder: string,
	bookGroups: KindleBookGroup[]
): (id: string, highlight: KindleHighlight) => Promise<boolean> {
	const notePathsByHighlightIdentity = new Map<string, string>();
	const notePaths = allocateBookNotePaths(highlightsFolder, bookGroups);

	for (const [groupIndex, group] of bookGroups.entries()) {
		const notePath = notePaths[groupIndex];

		if (!notePath) {
			continue;
		}

		for (const clipping of group.clippings) {
			notePathsByHighlightIdentity.set(createKindleHighlightIdentityKey(clipping), notePath);
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

		const markdown = await readVaultMarkdown(vault, notePath);

		if (markdown === null) {
			return false;
		}

		const managedRegion = analyzeManagedRegion(markdown);

		if (managedRegion.kind === "unsafe") {
			// An unreadable ownership boundary is not evidence that a reviewed highlight is missing.
			throw new Error(`Cannot reconcile an unsafe managed region: ${managedRegion.reason}.`);
		}

		return managedRegion.kind === "valid-with-ids"
			&& managedRegion.highlightIds.includes(id);
	};
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
