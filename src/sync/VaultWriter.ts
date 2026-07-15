import type { TFile, Vault } from "obsidian";
import {
	dedupeClippings,
	KindleBookGroup,
	createClippingId,
	renderBookMarkdown,
	renderSyncRegion,
	replaceOrAppendSyncRegion,
} from "../render/renderMarkdown";
import { sanitizeMarkdownFilename, sanitizeVaultFolderPath } from "../utils/sanitizePath";
import { analyzeManagedRegion } from "./ManagedRegion";

export interface VaultWriteSummary {
	books: number;
	filesCreated: number;
	filesUpdated: number;
	filesUnchanged: number;
	filesProtected: number;
	highlightsRendered: number;
	duplicatesSkipped: number;
	bookOutcomes: VaultBookWriteOutcome[];
}

export const VAULT_BOOK_PROTECTION_REASONS = [
	"unsafe-existing-managed-region",
	"existing-highlights-not-retained",
] as const;

export type VaultBookProtectionReason = typeof VAULT_BOOK_PROTECTION_REASONS[number];

interface VaultBookWriteOutcomeBase {
	bookTitle: string;
	author: string;
	notePath: string;
	highlightIds: string[];
}

export type VaultBookWriteOutcome =
	| (VaultBookWriteOutcomeBase & {
		status: "created" | "updated" | "confirmed";
	})
	| (VaultBookWriteOutcomeBase & {
		status: "protected";
		reason: VaultBookProtectionReason;
	});

export interface VaultBookWritePlan {
	group: KindleBookGroup;
	notePath: string;
	highlightIds: string[];
	duplicatesSkipped: number;
}

export interface VaultWritePlan {
	bookPlans: VaultBookWritePlan[];
	highlightsRendered: number;
	duplicatesSkipped: number;
}

type FileWriteResult =
	| { status: "created" | "updated" | "confirmed" }
	| { status: "protected"; reason: VaultBookProtectionReason };

type ExistingMarkdownUpdate =
	| { kind: "update"; markdown: string }
	| { kind: "protected"; reason: VaultBookProtectionReason };

export async function writeBookNotesToVault(
	vault: Vault,
	highlightsFolder: string,
	bookGroups: KindleBookGroup[]
): Promise<VaultWriteSummary> {
	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));

	await ensureFolder(vault, folderPath);

	const writePlan = createVaultWritePlan(highlightsFolder, bookGroups);
	const summary: VaultWriteSummary = {
		books: writePlan.bookPlans.length,
		filesCreated: 0,
		filesUpdated: 0,
		filesUnchanged: 0,
		filesProtected: 0,
		highlightsRendered: writePlan.highlightsRendered,
		duplicatesSkipped: writePlan.duplicatesSkipped,
		bookOutcomes: [],
	};

	for (const bookPlan of writePlan.bookPlans) {
		const writeResult = await writeBookNote(vault, bookPlan.notePath, bookPlan.group);
		const outcome: VaultBookWriteOutcome = {
			bookTitle: bookPlan.group.bookTitle,
			author: bookPlan.group.author,
			notePath: bookPlan.notePath,
			highlightIds: [...bookPlan.highlightIds],
			...writeResult,
		};

		summary.bookOutcomes.push(outcome);

		if (writeResult.status === "created") {
			summary.filesCreated++;
		} else if (writeResult.status === "updated") {
			summary.filesUpdated++;
		} else if (writeResult.status === "confirmed") {
			summary.filesUnchanged++;
		} else {
			summary.filesProtected++;
		}
	}

	return summary;
}

/** Builds the exact ordered request contract shared by the writer and its result validator. */
export function createVaultWritePlan(
	highlightsFolder: string,
	bookGroups: readonly KindleBookGroup[]
): VaultWritePlan {
	const notePaths = allocateBookNotePaths(highlightsFolder, bookGroups);
	const bookPlans = bookGroups.map((group, groupIndex): VaultBookWritePlan => {
		const notePath = notePaths[groupIndex];

		if (!notePath) {
			throw new Error("Cannot sync Kindle highlights because a book note path could not be allocated.");
		}

		const deduped = dedupeClippings(group.clippings);
		const uniqueGroup = {
			...group,
			clippings: deduped.clippings,
		};

		return {
			group: uniqueGroup,
			notePath,
			highlightIds: uniqueGroup.clippings.map(createClippingId),
			duplicatesSkipped: deduped.duplicatesSkipped,
		};
	});

	return {
		bookPlans,
		highlightsRendered: bookPlans.reduce((count, plan) => count + plan.highlightIds.length, 0),
		duplicatesSkipped: bookPlans.reduce((count, plan) => count + plan.duplicatesSkipped, 0),
	};
}

export function createBookNotePath(
	highlightsFolder: string,
	group: KindleBookGroup,
	usedNotePaths: Set<string>
): string {
	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));

	return createUniqueBookNotePath(folderPath, group, usedNotePaths);
}

/** Allocates all book paths in order so every sync component shares collision suffixes. */
export function allocateBookNotePaths(
	highlightsFolder: string,
	bookGroups: readonly KindleBookGroup[]
): string[] {
	const usedNotePaths = new Set<string>();

	return bookGroups.map((group) => createBookNotePath(highlightsFolder, group, usedNotePaths));
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
		return { status: "created" };
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
	const update = prepareSafeManagedRegionUpdate(existingMarkdown, group);

	if (update.kind === "protected" || update.markdown === existingMarkdown) {
		return update.kind === "protected"
			? { status: "protected", reason: update.reason }
			: { status: "confirmed" };
	}

	await vault.modify(existingFile, update.markdown);
	return { status: "updated" };
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
	const update = prepareSafeManagedRegionUpdate(existingMarkdown, group);

	if (update.kind === "protected" || update.markdown === existingMarkdown) {
		return update.kind === "protected"
			? { status: "protected", reason: update.reason }
			: { status: "confirmed" };
	}

	await vault.adapter.write(notePath, update.markdown);
	return { status: "updated" };
}

function prepareSafeManagedRegionUpdate(
	existingMarkdown: string,
	group: KindleBookGroup
): ExistingMarkdownUpdate {
	const analysis = analyzeManagedRegion(existingMarkdown);

	if (analysis.kind === "unsafe") {
		return {
			kind: "protected",
			reason: "unsafe-existing-managed-region",
		};
	}

	if (analysis.kind === "valid-with-ids") {
		const proposedIds = new Set(group.clippings.map(createClippingId));

		// Ordinary sync is not deletion authority. If the proposed group is incomplete,
		// preserve the entire note instead of guessing which managed blocks may be removed.
		if (analysis.highlightIds.some((id) => !proposedIds.has(id))) {
			return {
				kind: "protected",
				reason: "existing-highlights-not-retained",
			};
		}
	}

	return {
		kind: "update",
		markdown: replaceOrAppendSyncRegion(existingMarkdown, renderSyncRegion(group)),
	};
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
