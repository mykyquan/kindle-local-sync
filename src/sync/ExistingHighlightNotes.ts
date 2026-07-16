import type { App, TFile } from "obsidian";
import { analyzeManagedRegion } from "./ManagedRegion";

export async function hasExistingHighlightNotes(app: App, folderPath: string): Promise<boolean> {
	try {
		const folder = app.vault.getAbstractFileByPath(folderPath);

		if (!isVaultFolder(folder)) {
			return false;
		}

		for (const file of folder.children) {
			if (!isMarkdownFile(file)) {
				continue;
			}

			try {
				const markdown = await app.vault.read(file);
				const managedRegion = analyzeManagedRegion(markdown);

				// Only IDs inside an unambiguous managed region can prove prior plugin ownership.
				if (managedRegion.kind === "valid-with-ids") {
					return true;
				}
			} catch {
				// One unreadable note is not evidence of trusted sync state.
			}
		}

		return false;
	} catch {
		return false;
	}
}

function isVaultFolder(file: unknown): file is { children: unknown[] } {
	return typeof file === "object" && file !== null && Array.isArray((file as { children?: unknown }).children);
}

function isMarkdownFile(file: unknown): file is TFile {
	return typeof file === "object"
		&& file !== null
		&& "extension" in file
		&& (file as { extension?: unknown }).extension === "md";
}
