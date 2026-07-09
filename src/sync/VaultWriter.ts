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

type FileWriteResult = "created" | "updated" | "unchanged";

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

		const writeResult = await writeBookNote(vault, notePath, uniqueGroup);

		if (writeResult === "created") {
			summary.filesCreated++;
		} else if (writeResult === "updated") {
			summary.filesUpdated++;
		} else {
			summary.filesUnchanged++;
		}
	}

	return summary;
}

export function createBookNotePath(
	highlightsFolder: string,
	group: KindleBookGroup,
	usedNotePaths: Set<string>
): string {
	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));

	return createUniqueBookNotePath(folderPath, group, usedNotePaths);
}

async function writeBookNote(vault: Vault, notePath: string, group: KindleBookGroup): Promise<FileWriteResult> {
	const newMarkdown = renderBookMarkdown(group);
	const existingFile = vault.getAbstractFileByPath(notePath);

	if (existingFile) {
		if (!isVaultFile(existingFile)) {
			throw new Error(`Cannot sync Kindle highlights because "${notePath}" is a folder.`);
		}

		return updateExistingVaultFile(vault, existingFile, group);
	}

	if (await adapterPathExists(vault, notePath)) {
		return updateExistingAdapterFile(vault, notePath, group);
	}

	try {
		await vault.create(notePath, newMarkdown);
		return "created";
	} catch (error) {
		if (!isFileAlreadyExistsError(error)) {
			throw error;
		}

		return updateExistingFileAfterCreateConflict(vault, notePath, group);
	}
}

async function updateExistingFileAfterCreateConflict(
	vault: Vault,
	notePath: string,
	group: KindleBookGroup
): Promise<FileWriteResult> {
	const existingFile = vault.getAbstractFileByPath(notePath);

	if (existingFile) {
		if (!isVaultFile(existingFile)) {
			throw new Error(`Cannot sync Kindle highlights because "${notePath}" is a folder.`);
		}

		return updateExistingVaultFile(vault, existingFile, group);
	}

	if (await adapterPathExists(vault, notePath)) {
		return updateExistingAdapterFile(vault, notePath, group);
	}

	throw new Error(`Cannot sync Kindle highlights because "${notePath}" already exists but could not be resolved.`);
}

async function updateExistingVaultFile(
	vault: Vault,
	existingFile: TFile,
	group: KindleBookGroup
): Promise<FileWriteResult> {
	const existingMarkdown = await vault.read(existingFile);
	const updatedMarkdown = replaceOrAppendSyncRegion(existingMarkdown, renderSyncRegion(group));

	if (updatedMarkdown === existingMarkdown) {
		return "unchanged";
	}

	await vault.modify(existingFile, updatedMarkdown);
	return "updated";
}

async function updateExistingAdapterFile(
	vault: Vault,
	notePath: string,
	group: KindleBookGroup
): Promise<FileWriteResult> {
	const stat = await vault.adapter.stat(notePath);

	if (!stat) {
		throw new Error(`Cannot sync Kindle highlights because "${notePath}" exists but could not be inspected.`);
	}

	if (stat.type !== "file") {
		throw new Error(`Cannot sync Kindle highlights because "${notePath}" is a folder.`);
	}

	const existingMarkdown = await vault.adapter.read(notePath);
	const updatedMarkdown = replaceOrAppendSyncRegion(existingMarkdown, renderSyncRegion(group));

	if (updatedMarkdown === existingMarkdown) {
		return "unchanged";
	}

	await vault.adapter.write(notePath, updatedMarkdown);
	return "updated";
}

async function adapterPathExists(vault: Vault, path: string): Promise<boolean> {
	return vault.adapter.exists(path);
}

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
	const folderSegments = folderPath.split("/").filter((segment) => segment.length > 0);
	let currentPath = "";

	for (const segment of folderSegments) {
		currentPath = normalizeVaultPath(currentPath ? `${currentPath}/${segment}` : segment);

		const existingFile = vault.getAbstractFileByPath(currentPath);

		if (!existingFile) {
			if (await adapterPathExists(vault, currentPath)) {
				const stat = await vault.adapter.stat(currentPath);

				if (stat?.type === "file") {
					throw new Error(`Cannot create Kindle highlights folder because "${currentPath}" is a file.`);
				}

				continue;
			}

			try {
				await vault.createFolder(currentPath);
			} catch (error) {
				if (!isFileAlreadyExistsError(error) || !(await adapterPathExists(vault, currentPath))) {
					throw error;
				}

				const stat = await vault.adapter.stat(currentPath);

				if (stat?.type === "file") {
					throw new Error(`Cannot create Kindle highlights folder because "${currentPath}" is a file.`);
				}
			}

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

function isFileAlreadyExistsError(error: unknown): boolean {
	return error instanceof Error && /already exists/i.test(error.message);
}
