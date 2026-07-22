import type { App, TFile } from "obsidian";
import { analyzeManagedRegion } from "./ManagedRegion";

export async function hasExistingHighlightNotes(app: App, folderPath: string): Promise<boolean> {
	try {
		const folder = app.vault.getAbstractFileByPath(folderPath);

		if (!isVaultFolder(folder)) {
			return false;
		}

		for (const file of collectMarkdownFiles(folder)) {
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

/**
 * Walk only descendants of the configured highlights folder. Files may be exposed more than once
 * by a vault tree during folder changes, so each object is inspected at most once.
 */
function collectMarkdownFiles(folder: VaultFolderLike): TFile[] {
	const files: TFile[] = [];
	const visitedFolders = new Set<VaultFolderLike>();
	const visitedFiles = new Set<TFile>();

	const visitFolder = (currentFolder: VaultFolderLike): void => {
		if (visitedFolders.has(currentFolder)) {
			return;
		}

		visitedFolders.add(currentFolder);
		for (const child of currentFolder.children) {
			if (isVaultFolder(child)) {
				visitFolder(child);
				continue;
			}

			if (isMarkdownFile(child) && !visitedFiles.has(child)) {
				visitedFiles.add(child);
				files.push(child);
			}
		}
	};

	visitFolder(folder);
	return files;
}

interface VaultFolderLike {
	children: unknown[];
}

function isVaultFolder(file: unknown): file is VaultFolderLike {
	return typeof file === "object" && file !== null && Array.isArray((file as { children?: unknown }).children);
}

function isMarkdownFile(file: unknown): file is TFile {
	return typeof file === "object"
		&& file !== null
		&& "extension" in file
		&& (file as { extension?: unknown }).extension === "md";
}
