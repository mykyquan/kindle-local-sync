import type { TFile, Vault } from "obsidian";
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
	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));
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

		if (!isVaultFile(existingFile)) {
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
		currentPath = normalizeVaultPath(currentPath ? `${currentPath}/${segment}` : segment);

		const existingFile = vault.getAbstractFileByPath(currentPath);

		if (!existingFile) {
			await vault.createFolder(currentPath);
			continue;
		}

		if (isVaultFile(existingFile)) {
			throw new Error(`Cannot create Kindle highlights folder because "${currentPath}" is a file.`);
		}
	}
}

function createUniqueBookNotePath(
	folderPath: string,
	group: KindleBookGroup,
	usedNotePaths: Set<string>
): string {
	const baseFilename = createBookNoteFilenameBase(group);
	let filename = sanitizeMarkdownFilename(baseFilename);
	let notePath = normalizeVaultPath(`${folderPath}/${filename}`);

	if (!usedNotePaths.has(notePath)) {
		usedNotePaths.add(notePath);
		return notePath;
	}

	let index = 2;
	while (usedNotePaths.has(notePath)) {
		filename = sanitizeMarkdownFilename(`${baseFilename} ${index}`);
		notePath = normalizeVaultPath(`${folderPath}/${filename}`);
		index++;
	}

	usedNotePaths.add(notePath);
	return notePath;
}

function createBookNoteFilenameBase(group: KindleBookGroup): string {
	const title = group.bookTitle.trim() || "Untitled Kindle Book";
	const author = group.author.trim();

	if (author && author.toLowerCase() !== "unknown") {
		return `${title} - ${author}`;
	}

	return title;
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

function isVaultFile(file: unknown): file is TFile {
	return typeof file === "object" && file !== null && "extension" in file;
}
