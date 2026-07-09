import type { TFile, Vault } from "obsidian";
import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId, KindleBookGroup } from "../render/renderMarkdown";
import { createBookNotePath } from "./VaultWriter";

const ID_MARKER_PREFIX = "<!-- kindle-local-sync-id:";

export function createVaultHighlightLookup(
	vault: Vault,
	highlightsFolder: string,
	bookGroups: KindleBookGroup[]
): (id: string, highlight: KindleHighlight) => Promise<boolean> {
	const notePathsByHighlightId = new Map<string, string>();
	const usedNotePaths = new Set<string>();

	for (const group of bookGroups) {
		const notePath = createBookNotePath(highlightsFolder, group, usedNotePaths);

		for (const clipping of group.clippings) {
			notePathsByHighlightId.set(createClippingId(clipping), notePath);
		}
	}

	return async (id: string): Promise<boolean> => {
		const notePath = notePathsByHighlightId.get(id);

		if (!notePath) {
			return false;
		}

		const markdown = await readVaultMarkdown(vault, notePath);

		if (markdown === null) {
			return false;
		}

		return markdown.includes(`${ID_MARKER_PREFIX} ${id} -->`);
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
