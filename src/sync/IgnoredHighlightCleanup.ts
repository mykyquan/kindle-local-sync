import type { TFile, Vault } from "obsidian";
import {
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { sanitizeVaultFolderPath } from "../utils/sanitizePath";

const ID_MARKER_PATTERN = /(?:^|\r?\n)<!-- kindle-local-sync-id: ([^>\r\n]+) -->(?=\r?\n|$)/g;

export interface IgnoredHighlightCleanupSummary {
	filesScanned: number;
	filesUpdated: number;
	blocksRemoved: number;
}

export async function removeIgnoredHighlightBlocksFromExistingNotes(
	vault: Vault,
	highlightsFolder: string,
	ignoredHighlightIds: Iterable<string>
): Promise<IgnoredHighlightCleanupSummary> {
	const ignoredIds = new Set(Array.from(ignoredHighlightIds).filter(Boolean));
	const summary: IgnoredHighlightCleanupSummary = {
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
	};

	if (ignoredIds.size === 0) {
		return summary;
	}

	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));
	const folder = vault.getAbstractFileByPath(folderPath);

	if (!isVaultFolder(folder)) {
		return summary;
	}

	for (const file of collectMarkdownFiles(folder)) {
		summary.filesScanned++;

		const markdown = await vault.read(file);
		const result = removeIgnoredHighlightBlocksFromMarkdown(markdown, ignoredIds);

		if (result.markdown === markdown) {
			continue;
		}

		await vault.modify(file, result.markdown);
		summary.filesUpdated++;
		summary.blocksRemoved += result.blocksRemoved;
	}

	return summary;
}

export function removeIgnoredHighlightBlocksFromMarkdown(
	markdown: string,
	ignoredIds: Set<string>
): { markdown: string; blocksRemoved: number } {
	let cursor = 0;
	let updatedMarkdown = "";
	let blocksRemoved = 0;

	while (cursor < markdown.length) {
		const startIndex = markdown.indexOf(SYNC_START_MARKER, cursor);

		if (startIndex === -1) {
			updatedMarkdown += markdown.slice(cursor);
			break;
		}

		const innerStartIndex = startIndex + SYNC_START_MARKER.length;
		const endIndex = markdown.indexOf(SYNC_END_MARKER, innerStartIndex);

		if (endIndex === -1) {
			updatedMarkdown += markdown.slice(cursor);
			break;
		}

		const inner = markdown.slice(innerStartIndex, endIndex);
		const result = removeIgnoredHighlightBlocksFromRegion(inner, ignoredIds);

		updatedMarkdown += markdown.slice(cursor, innerStartIndex);
		updatedMarkdown += result.region;
		blocksRemoved += result.blocksRemoved;
		cursor = endIndex;
	}

	return {
		markdown: blocksRemoved > 0 ? updatedMarkdown : markdown,
		blocksRemoved,
	};
}

function removeIgnoredHighlightBlocksFromRegion(
	region: string,
	ignoredIds: Set<string>
): { region: string; blocksRemoved: number } {
	let copyCursor = 0;
	let blockStart = 0;
	let updatedRegion = "";
	let blocksRemoved = 0;

	ID_MARKER_PATTERN.lastIndex = 0;

	for (let match = ID_MARKER_PATTERN.exec(region); match; match = ID_MARKER_PATTERN.exec(region)) {
		const markerStart = match.index + match[0].indexOf("<!--");
		const markerLineEnd = findLineEnd(region, markerStart);
		const id = match[1]?.trim();

		if (id && ignoredIds.has(id)) {
			updatedRegion += region.slice(copyCursor, blockStart);
			copyCursor = markerLineEnd;
			blocksRemoved++;
		}

		blockStart = markerLineEnd;
	}

	if (blocksRemoved === 0) {
		return {
			region,
			blocksRemoved,
		};
	}

	updatedRegion += region.slice(copyCursor);

	return {
		region: tidyGeneratedRegionSpacing(updatedRegion),
		blocksRemoved,
	};
}

function findLineEnd(text: string, lineStart: number): number {
	const nextNewline = text.indexOf("\n", lineStart);

	return nextNewline === -1 ? text.length : nextNewline + 1;
}

function tidyGeneratedRegionSpacing(region: string): string {
	if (region.trim().length === 0) {
		return "\n\n";
	}

	return region.replace(/\n{4,}/g, "\n\n\n");
}

function collectMarkdownFiles(folder: VaultFolderLike): TFile[] {
	const files: TFile[] = [];

	for (const child of folder.children) {
		if (isVaultFile(child)) {
			if (child.extension.toLowerCase() === "md") {
				files.push(child);
			}

			continue;
		}

		if (isVaultFolder(child)) {
			files.push(...collectMarkdownFiles(child));
		}
	}

	return files;
}

interface VaultFolderLike {
	children: unknown[];
}

function isVaultFolder(file: unknown): file is VaultFolderLike {
	return typeof file === "object" && file !== null && Array.isArray((file as { children?: unknown }).children);
}

function isVaultFile(file: unknown): file is TFile {
	return typeof file === "object" && file !== null && "extension" in file && "path" in file;
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}
