import {
	SYNC_END_MARKER,
	SYNC_START_MARKER,
} from "../render/renderMarkdown";

export type UnsafeManagedRegionReason =
	| "start-without-end"
	| "end-without-start"
	| "reversed-markers"
	| "nested-markers"
	| "duplicate-regions"
	| "ambiguous-markers"
	| "nonempty-unparseable-content";

export type ManagedRegionAnalysis =
	| { kind: "no-markers" }
	| {
		kind: "valid-empty";
		startIndex: number;
		endIndex: number;
	}
	| {
		kind: "valid-with-ids";
		startIndex: number;
		endIndex: number;
		highlightIds: string[];
	}
	| {
		kind: "unsafe";
		reason: UnsafeManagedRegionReason;
	};

interface MarkerToken {
	type: "start" | "end";
	index: number;
}

const HIGHLIGHT_ID_PATTERN = /(?:^|\r?\n)<!-- kindle-local-sync-id: (kls-[a-z0-9]+) -->(?=\r?\n|$)/g;

/**
 * Classifies the managed marker structure before any existing note is rewritten.
 * Ambiguous structures are unsafe because choosing a region could discard content.
 */
export function analyzeManagedRegion(markdown: string): ManagedRegionAnalysis {
	const startIndices = findMarkerIndices(markdown, SYNC_START_MARKER);
	const endIndices = findMarkerIndices(markdown, SYNC_END_MARKER);

	if (startIndices.length === 0 && endIndices.length === 0) {
		return { kind: "no-markers" };
	}

	if (endIndices.length === 0) {
		return unsafe("start-without-end");
	}

	if (startIndices.length === 0) {
		return unsafe("end-without-start");
	}

	if (startIndices.length === 1 && endIndices.length === 1) {
		const startIndex = startIndices[0];
		const endIndex = endIndices[0];

		if (startIndex === undefined || endIndex === undefined) {
			return unsafe("ambiguous-markers");
		}

		if (endIndex < startIndex) {
			return unsafe("reversed-markers");
		}

		return analyzeValidRegion(markdown, startIndex, endIndex);
	}

	return analyzeAmbiguousMarkerStructure(startIndices, endIndices);
}

function analyzeValidRegion(markdown: string, startIndex: number, endIndex: number): ManagedRegionAnalysis {
	const innerStartIndex = startIndex + SYNC_START_MARKER.length;
	const inner = markdown.slice(innerStartIndex, endIndex);

	if (inner.trim().length === 0) {
		return {
			kind: "valid-empty",
			startIndex,
			endIndex,
		};
	}

	const highlightIds = extractHighlightIds(inner);

	if (highlightIds.length === 0) {
		return unsafe("nonempty-unparseable-content");
	}

	return {
		kind: "valid-with-ids",
		startIndex,
		endIndex,
		highlightIds,
	};
}

function analyzeAmbiguousMarkerStructure(
	startIndices: number[],
	endIndices: number[]
): ManagedRegionAnalysis {
	const tokens: MarkerToken[] = [
		...startIndices.map((index) => ({ type: "start" as const, index })),
		...endIndices.map((index) => ({ type: "end" as const, index })),
	].sort((left, right) => left.index - right.index);
	let depth = 0;
	let completedRegions = 0;
	let hasNestedMarkers = false;
	let hasEndWithoutStart = false;

	for (const token of tokens) {
		if (token.type === "start") {
			if (depth > 0) {
				hasNestedMarkers = true;
			}

			depth++;
			continue;
		}

		if (depth === 0) {
			hasEndWithoutStart = true;
			continue;
		}

		depth--;
		if (depth === 0) {
			completedRegions++;
		}
	}

	if (hasNestedMarkers) {
		return unsafe("nested-markers");
	}

	if (completedRegions > 1) {
		return unsafe("duplicate-regions");
	}

	if (depth > 0) {
		return unsafe("start-without-end");
	}

	if (hasEndWithoutStart) {
		return unsafe("end-without-start");
	}

	return unsafe("ambiguous-markers");
}

function extractHighlightIds(inner: string): string[] {
	const ids = new Set<string>();

	HIGHLIGHT_ID_PATTERN.lastIndex = 0;
	for (let match = HIGHLIGHT_ID_PATTERN.exec(inner); match; match = HIGHLIGHT_ID_PATTERN.exec(inner)) {
		const id = match[1];

		if (id) {
			ids.add(id);
		}
	}

	return Array.from(ids);
}

function findMarkerIndices(markdown: string, marker: string): number[] {
	const indices: number[] = [];
	let searchFrom = 0;

	while (searchFrom < markdown.length) {
		const index = markdown.indexOf(marker, searchFrom);

		if (index === -1) {
			break;
		}

		indices.push(index);
		searchFrom = index + marker.length;
	}

	return indices;
}

function unsafe(reason: UnsafeManagedRegionReason): ManagedRegionAnalysis {
	return {
		kind: "unsafe",
		reason,
	};
}
