import { KindleHighlight } from "../parser/parseClippings";
import { createBookIdentityKey, createClippingId } from "../sync/HighlightIdentity";

export { createClippingId } from "../sync/HighlightIdentity";

export const SYNC_START_MARKER = "<!-- kindle-local-sync:start -->";
export const SYNC_END_MARKER = "<!-- kindle-local-sync:end -->";

export interface KindleBookGroup {
	bookTitle: string;
	author: string;
	clippings: KindleHighlight[];
}

export interface DedupedClippings {
	clippings: KindleHighlight[];
	duplicatesSkipped: number;
}

export function groupHighlightsByBook(highlights: KindleHighlight[]): KindleBookGroup[] {
	const groups = new Map<string, KindleBookGroup>();

	for (const highlight of highlights) {
		const key = createBookIdentityKey(highlight.bookTitle, highlight.author);
		const existingGroup = groups.get(key);

		if (existingGroup) {
			existingGroup.clippings.push(highlight);
			continue;
		}

		groups.set(key, {
			bookTitle: highlight.bookTitle,
			author: highlight.author,
			clippings: [highlight],
		});
	}

	return Array.from(groups.values());
}

export function dedupeClippings(clippings: KindleHighlight[]): DedupedClippings {
	const seenIds = new Set<string>();
	const uniqueClippings: KindleHighlight[] = [];
	let duplicatesSkipped = 0;

	for (const clipping of clippings) {
		const clippingId = createClippingId(clipping);

		if (seenIds.has(clippingId)) {
			duplicatesSkipped++;
			continue;
		}

		seenIds.add(clippingId);
		uniqueClippings.push(clipping);
	}

	return {
		clippings: uniqueClippings,
		duplicatesSkipped,
	};
}

export function renderBookMarkdown(group: KindleBookGroup): string {
	const deduped = dedupeClippings(group.clippings);
	const uniqueGroup = {
		...group,
		clippings: deduped.clippings,
	};

	return [
		"---",
		`title: "${escapeFrontmatterValue(group.bookTitle)}"`,
		`author: "${escapeFrontmatterValue(group.author)}"`,
		"source: \"kindle\"",
		"sync: \"kindle-local-sync\"",
		"---",
		"",
		`# ${group.bookTitle}`,
		"",
		`Author: ${group.author}`,
		"",
		"## Kindle Highlights & Notes",
		"",
		renderSyncRegion(uniqueGroup),
		"",
	].join("\n");
}

export function renderSyncRegion(group: KindleBookGroup): string {
	const deduped = dedupeClippings(group.clippings);
	const renderedClippings = deduped.clippings.map(renderClippingMarkdown);

	return [
		SYNC_START_MARKER,
		"",
		...joinBlocks(renderedClippings),
		SYNC_END_MARKER,
	].join("\n");
}

export function renderClippingMarkdown(clipping: KindleHighlight): string {
	const locationSuffix = clipping.location ? ` - Location ${clipping.location}` : "";
	const addedLine = clipping.dateAdded ? [`Added: ${clipping.dateAdded}`, ""] : [];

	return [
		`### ${clipping.type}${locationSuffix}`,
		"",
		renderClippingContent(clipping),
		"",
		...addedLine,
		`<!-- kindle-local-sync-id: ${createClippingId(clipping)} -->`,
	].join("\n");
}

export function replaceOrAppendSyncRegion(existingMarkdown: string, syncRegion: string): string {
	const startIndex = existingMarkdown.indexOf(SYNC_START_MARKER);
	const endIndex = existingMarkdown.indexOf(SYNC_END_MARKER, startIndex);

	if (startIndex !== -1 && endIndex !== -1) {
		const afterEndIndex = endIndex + SYNC_END_MARKER.length;

		return `${existingMarkdown.slice(0, startIndex)}${syncRegion}${existingMarkdown.slice(afterEndIndex)}`;
	}

	if (existingMarkdown.length === 0) {
		return `${syncRegion}\n`;
	}

	// With no managed markers, every existing byte is user-authored and must remain untouched.
	const lineBreak = existingMarkdown.includes("\r\n") ? "\r\n" : "\n";
	const appendSeparator = existingMarkdown.endsWith(`${lineBreak}${lineBreak}`)
		? ""
		: existingMarkdown.endsWith(lineBreak)
			? lineBreak
			: `${lineBreak}${lineBreak}`;

	return `${existingMarkdown}${appendSeparator}## Kindle Highlights & Notes\n\n${syncRegion}\n`;
}

function renderClippingContent(clipping: KindleHighlight): string {
	if (clipping.type === "Highlight") {
		return clipping.content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.map((line) => line ? `> ${line}` : ">")
			.join("\n");
	}

	return clipping.content;
}

function joinBlocks(blocks: string[]): string[] {
	return blocks.flatMap((block, index) => {
		if (index === blocks.length - 1) {
			return [block, ""];
		}

		return [block, "", ""];
	});
}

function escapeFrontmatterValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, "\\\"")
		.replace(/\r?\n/g, " ");
}
