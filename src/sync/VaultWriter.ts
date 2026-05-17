import { normalizePath, TFile, Vault } from "obsidian";
import {
	dedupeClippings,
	KindleBookGroup,
	renderBookMarkdown,
	renderSyncRegion,
	replaceOrAppendSyncRegion,
} from "../render/renderMarkdown";
import { sanitizeMarkdownFilename, sanitizeVaultFolderPath } from "../utils/sanitizePath";

export interface VaultWriteSummary {
	books: number;
	filesCreated: number;
	filesUpdated: number;
	filesUnchanged: number;
	highlightsRendered: number;
	duplicatesSkipped: number;
}

export async function writeBookNotesToVault(
	vault: Vault,
	highlightsFolder: string,
	bookGroups: KindleBookGroup[]
): Promise<VaultWriteSummary> {
	const folderPath = normalizePath(sanitizeVaultFolderPath(highlightsFolder));
	const summary: VaultWriteSummary = {
		books: bookGroups.length,
		filesCreated: 0,
		filesUpdated: 0,
		filesUnchanged: 0,
		highlightsRendered: 0,
		duplicatesSkipped: 0,
	};

	await ensureFolder(vault, folderPath);

	const usedNotePaths = new Set<string>();

	for (const group of bookGroups) {
		const deduped = dedupeClippings(group.clippings);
		const uniqueGroup = {
			...group,
			clippings: deduped.clippings,
		};
		const notePath = createUniqueBookNotePath(folderPath, uniqueGroup, usedNotePaths);

		summary.highlightsRendered += uniqueGroup.clippings.length;
		summary.duplicatesSkipped += deduped.duplicatesSkipped;

		const existingFile = vault.getAbstractFileByPath(notePath);

		if (!existingFile) {
			await vault.create(notePath, renderBookMarkdown(uniqueGroup));
			summary.filesCreated++;
			continue;
		}

		if (!(existingFile instanceof TFile)) {
			throw new Error(`Cannot sync Kindle highlights because "${notePath}" is not a file.`);
		}

		const existingMarkdown = await vault.read(existingFile);
		const updatedMarkdown = replaceOrAppendSyncRegion(existingMarkdown, renderSyncRegion(uniqueGroup));

		if (updatedMarkdown === existingMarkdown) {
			summary.filesUnchanged++;
			continue;
		}

		await vault.modify(existingFile, updatedMarkdown);
		summary.filesUpdated++;
	}

	return summary;
}

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
	const folderSegments = folderPath.split("/").filter((segment) => segment.length > 0);
	let currentPath = "";

	for (const segment of folderSegments) {
		currentPath = normalizePath(currentPath ? `${currentPath}/${segment}` : segment);

		const existingFile = vault.getAbstractFileByPath(currentPath);

		if (!existingFile) {
			await vault.createFolder(currentPath);
			continue;
		}

		if (existingFile instanceof TFile) {
			throw new Error(`Cannot create Kindle highlights folder because "${currentPath}" is a file.`);
		}
	}
}

function createUniqueBookNotePath(
	folderPath: string,
	group: KindleBookGroup,
	usedNotePaths: Set<string>
): string {
	let filename = sanitizeMarkdownFilename(group.bookTitle);
	let notePath = normalizePath(`${folderPath}/${filename}`);

	if (!usedNotePaths.has(notePath)) {
		usedNotePaths.add(notePath);
		return notePath;
	}

	filename = sanitizeMarkdownFilename(`${group.bookTitle} - ${group.author}`);
	notePath = normalizePath(`${folderPath}/${filename}`);

	let index = 2;
	while (usedNotePaths.has(notePath)) {
		filename = sanitizeMarkdownFilename(`${group.bookTitle} - ${group.author} ${index}`);
		notePath = normalizePath(`${folderPath}/${filename}`);
		index++;
	}

	usedNotePaths.add(notePath);
	return notePath;
}
