import type { App, TFile } from "obsidian";

export async function hasExistingHighlightNotes(app: App, folderPath: string): Promise<boolean> {
	try {
		const folder = app.vault.getAbstractFileByPath(folderPath);

		if (!isVaultFolder(folder)) {
			return false;
		}

		return folder.children.some(isMarkdownFile);
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
