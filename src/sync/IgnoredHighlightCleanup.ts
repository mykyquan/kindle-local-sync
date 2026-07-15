import { getFrontMatterInfo, parseYaml } from "obsidian";
import type { TFile, Vault } from "obsidian";
import {
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";
import { sanitizeVaultFolderPath } from "../utils/sanitizePath";
import { createBookIdentityKey, createHighlightIdentityKey } from "./HighlightIdentity";
import { analyzeManagedRegion, UnsafeManagedRegionReason } from "./ManagedRegion";

const ID_MARKER_PATTERN = /(?:^|\r?\n)<!-- kindle-local-sync-id: ([^>\r\n]+) -->(?=\r?\n|$)/g;

export interface IgnoredHighlightCleanupSummary {
	filesScanned: number;
	filesUpdated: number;
	blocksRemoved: number;
	bookOutcomes: IgnoredHighlightCleanupBookOutcome[];
}

export interface IgnoredHighlightCleanupTarget {
	bookTitle: string;
	author: string;
	id: string;
}

export type IgnoredHighlightCleanupTargetOutcome =
	| {
		target: IgnoredHighlightCleanupTarget;
		status: "removed-safely";
		blocksRemoved: number;
	}
	| {
		target: IgnoredHighlightCleanupTarget;
		status: "no-matching-note" | "ambiguous-note-ownership" | "no-matching-highlight-block";
	}
	| {
		target: IgnoredHighlightCleanupTarget;
		status: "unsafe-managed-region";
		reason: UnsafeManagedRegionReason;
	}
	| {
		target: IgnoredHighlightCleanupTarget;
		status: "cleanup-failed";
		stage: "discovery" | "read" | "write";
	}
	| {
		target: IgnoredHighlightCleanupTarget;
		status: "cleanup-state-unknown";
		stage: "write";
	};

export interface IgnoredHighlightCleanupBookOutcome {
	bookTitle: string;
	author: string;
	targetOutcomes: IgnoredHighlightCleanupTargetOutcome[];
	writeReportedFailure?: boolean;
}

interface CleanupTargetGroup {
	bookTitle: string;
	author: string;
	bookIdentity: string;
	targets: IgnoredHighlightCleanupTarget[];
}

interface NoteSnapshot {
	file: TFile;
	markdown: string;
	bookIdentity: string | null;
}

export async function removeIgnoredHighlightBlocksFromExistingNotes(
	vault: Vault,
	highlightsFolder: string,
	targets: Iterable<IgnoredHighlightCleanupTarget>
): Promise<IgnoredHighlightCleanupSummary> {
	const targetGroups = groupCleanupTargets(targets);
	const summary: IgnoredHighlightCleanupSummary = {
		filesScanned: 0,
		filesUpdated: 0,
		blocksRemoved: 0,
		bookOutcomes: [],
	};

	if (targetGroups.length === 0) {
		return summary;
	}

	const folderPath = normalizeVaultPath(sanitizeVaultFolderPath(highlightsFolder));
	let folder: unknown;

	try {
		folder = vault.getAbstractFileByPath(folderPath);
	} catch (error) {
		console.error("Failed to inspect the Kindle highlights folder during ignored-highlight cleanup.", error);
		summary.bookOutcomes = createFailedBookOutcomes(targetGroups, "discovery");
		return summary;
	}

	if (!isVaultFolder(folder)) {
		summary.bookOutcomes = targetGroups.map((group) => createUniformBookOutcome(group, "no-matching-note"));
		return summary;
	}

	const snapshots: NoteSnapshot[] = [];

	try {
		for (const file of collectMarkdownFiles(folder)) {
			summary.filesScanned++;
			const markdown = await vault.read(file);

			snapshots.push({
				file,
				markdown,
				bookIdentity: parseNoteBookIdentity(markdown),
			});
		}
	} catch (error) {
		// Discovery completes before any write so an unreadable note cannot hide duplicate ownership.
		console.error("Failed to read Kindle notes during ignored-highlight cleanup.", error);
		summary.bookOutcomes = createFailedBookOutcomes(targetGroups, "read");
		return summary;
	}

	for (const group of targetGroups) {
		const matchingNotes = snapshots.filter((snapshot) => snapshot.bookIdentity === group.bookIdentity);

		// Exact-ID deletion is safe only after one note is attributable to the selected book.
		if (matchingNotes.length === 0) {
			summary.bookOutcomes.push(createUniformBookOutcome(group, "no-matching-note"));
			continue;
		}

		if (matchingNotes.length > 1) {
			summary.bookOutcomes.push(createUniformBookOutcome(group, "ambiguous-note-ownership"));
			continue;
		}

		const snapshot = matchingNotes[0];

		if (!snapshot) {
			summary.bookOutcomes.push(createUniformBookOutcome(group, "no-matching-note"));
			continue;
		}

		const analysis = analyzeManagedRegion(snapshot.markdown);

		if (analysis.kind === "unsafe") {
			summary.bookOutcomes.push({
				bookTitle: group.bookTitle,
				author: group.author,
				targetOutcomes: group.targets.map((target) => ({
					target,
					status: "unsafe-managed-region",
					reason: analysis.reason,
				})),
			});
			continue;
		}

		if (analysis.kind === "no-markers" || analysis.kind === "valid-empty") {
			summary.bookOutcomes.push(createUniformBookOutcome(group, "no-matching-highlight-block"));
			continue;
		}

		const ignoredIds = new Set(group.targets.map((target) => target.id));
		const result = removeIgnoredHighlightBlocksFromMarkdown(snapshot.markdown, ignoredIds);

		if (result.markdown === snapshot.markdown) {
			summary.bookOutcomes.push(createUniformBookOutcome(group, "no-matching-highlight-block"));
			continue;
		}

		try {
			await vault.modify(snapshot.file, result.markdown);
			recordSuccessfulCleanup(summary, group, result);
		} catch (error) {
			console.error("Failed to write a Kindle note during ignored-highlight cleanup.", error);
			await recordRejectedWriteOutcome(vault, summary, snapshot, group, result);
		}
	}

	return summary;
}

function groupCleanupTargets(
	targets: Iterable<IgnoredHighlightCleanupTarget>
): CleanupTargetGroup[] {
	const groupsByBook = new Map<string, CleanupTargetGroup>();
	const seenTargets = new Set<string>();

	for (const target of targets) {
		const targetIdentity = createHighlightIdentityKey(target.bookTitle, target.author, target.id);

		if (seenTargets.has(targetIdentity)) {
			continue;
		}

		seenTargets.add(targetIdentity);
		const bookIdentity = createBookIdentityKey(target.bookTitle, target.author);
		const group = groupsByBook.get(bookIdentity) ?? {
			bookTitle: target.bookTitle,
			author: target.author,
			bookIdentity,
			targets: [],
		};

		group.targets.push(target);
		groupsByBook.set(bookIdentity, group);
	}

	return Array.from(groupsByBook.values());
}

function createUniformBookOutcome(
	group: CleanupTargetGroup,
	status: "no-matching-note" | "ambiguous-note-ownership" | "no-matching-highlight-block"
): IgnoredHighlightCleanupBookOutcome {
	return {
		bookTitle: group.bookTitle,
		author: group.author,
		targetOutcomes: group.targets.map((target) => ({ target, status })),
	};
}

function createFailedBookOutcomes(
	groups: CleanupTargetGroup[],
	stage: "discovery" | "read"
): IgnoredHighlightCleanupBookOutcome[] {
	return groups.map((group) => ({
		bookTitle: group.bookTitle,
		author: group.author,
		targetOutcomes: group.targets.map((target) => ({
			target,
			status: "cleanup-failed",
			stage,
		})),
	}));
}

interface MarkdownCleanupResult {
	markdown: string;
	blocksRemoved: number;
	matchedBlockCounts: Map<string, number>;
}

function recordSuccessfulCleanup(
	summary: IgnoredHighlightCleanupSummary,
	group: CleanupTargetGroup,
	result: MarkdownCleanupResult,
	writeReportedFailure = false
): void {
	summary.filesUpdated++;
	summary.blocksRemoved += result.blocksRemoved;
	const bookOutcome: IgnoredHighlightCleanupBookOutcome = {
		bookTitle: group.bookTitle,
		author: group.author,
		targetOutcomes: createCompletedTargetOutcomes(group, result.matchedBlockCounts),
	};

	if (writeReportedFailure) {
		bookOutcome.writeReportedFailure = true;
	}

	summary.bookOutcomes.push(bookOutcome);
}

async function recordRejectedWriteOutcome(
	vault: Vault,
	summary: IgnoredHighlightCleanupSummary,
	snapshot: NoteSnapshot,
	group: CleanupTargetGroup,
	result: MarkdownCleanupResult
): Promise<void> {
	let persistedMarkdown: string | null = null;

	try {
		persistedMarkdown = await vault.read(snapshot.file);
	} catch {
		// A failed verification read leaves the physical write state unknown.
	}

	if (persistedMarkdown === result.markdown) {
		recordSuccessfulCleanup(summary, group, result, true);
		return;
	}

	const matchedIds = new Set(result.matchedBlockCounts.keys());
	const writeFailedButUnchanged = persistedMarkdown === snapshot.markdown;

	summary.bookOutcomes.push({
		bookTitle: group.bookTitle,
		author: group.author,
		targetOutcomes: group.targets.map((target): IgnoredHighlightCleanupTargetOutcome => {
			if (!matchedIds.has(target.id)) {
				return { target, status: "no-matching-highlight-block" };
			}

			return writeFailedButUnchanged
				? { target, status: "cleanup-failed", stage: "write" }
				: { target, status: "cleanup-state-unknown", stage: "write" };
		}),
	});
}

function createCompletedTargetOutcomes(
	group: CleanupTargetGroup,
	matchedBlockCounts: ReadonlyMap<string, number>
): IgnoredHighlightCleanupTargetOutcome[] {
	return group.targets.map((target) => {
		const blocksRemoved = matchedBlockCounts.get(target.id);

		return blocksRemoved === undefined
			? { target, status: "no-matching-highlight-block" }
			: { target, status: "removed-safely", blocksRemoved };
	});
}

function parseNoteBookIdentity(markdown: string): string | null {
	const frontmatterInfo = getFrontMatterInfo(markdown);

	if (!frontmatterInfo.exists) {
		return null;
	}

	try {
		const parsed = parseYaml(frontmatterInfo.frontmatter) as unknown;

		if (!isStringRecord(parsed)) {
			return null;
		}

		const title = parsed.title;
		const author = parsed.author;

		if (typeof title !== "string" || typeof author !== "string") {
			return null;
		}

		return createBookIdentityKey(title, author);
	} catch {
		return null;
	}
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function removeIgnoredHighlightBlocksFromMarkdown(
	markdown: string,
	ignoredIds: Set<string>
): MarkdownCleanupResult {
	let cursor = 0;
	let updatedMarkdown = "";
	let blocksRemoved = 0;
	const matchedBlockCounts = new Map<string, number>();

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
		for (const [id, count] of result.matchedBlockCounts) {
			matchedBlockCounts.set(id, (matchedBlockCounts.get(id) ?? 0) + count);
		}
		cursor = endIndex;
	}

	return {
		markdown: blocksRemoved > 0 ? updatedMarkdown : markdown,
		blocksRemoved,
		matchedBlockCounts,
	};
}

function removeIgnoredHighlightBlocksFromRegion(
	region: string,
	ignoredIds: Set<string>
): { region: string; blocksRemoved: number; matchedBlockCounts: Map<string, number> } {
	let copyCursor = 0;
	let blockStart = 0;
	let updatedRegion = "";
	let blocksRemoved = 0;
	const matchedBlockCounts = new Map<string, number>();

	ID_MARKER_PATTERN.lastIndex = 0;

	for (let match = ID_MARKER_PATTERN.exec(region); match; match = ID_MARKER_PATTERN.exec(region)) {
		const markerStart = match.index + match[0].indexOf("<!--");
		const markerLineEnd = findLineEnd(region, markerStart);
		const id = match[1]?.trim();

		if (id && ignoredIds.has(id)) {
			updatedRegion += region.slice(copyCursor, blockStart);
			copyCursor = markerLineEnd;
			blocksRemoved++;
			matchedBlockCounts.set(id, (matchedBlockCounts.get(id) ?? 0) + 1);
		}

		blockStart = markerLineEnd;
	}

	if (blocksRemoved === 0) {
		return {
			region,
			blocksRemoved,
			matchedBlockCounts,
		};
	}

	updatedRegion += region.slice(copyCursor);

	return {
		region: tidyGeneratedRegionSpacing(updatedRegion),
		blocksRemoved,
		matchedBlockCounts,
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
