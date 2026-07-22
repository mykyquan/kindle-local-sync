import { KindleHighlight } from "./parser/parseClippings";
import { createClippingIdentity } from "./sync/HighlightIdentity";

export interface SyncSummaryHighlightItem {
	id: string;
	legacyId?: string;
	identityVersion?: 2;
	title: string;
	author: string;
	textPreview: string;
	location?: string;
	lang?: string;
	returnReason?: "skipped" | "unreviewed";
}

export function createSyncSummaryHighlightItem(highlight: KindleHighlight): SyncSummaryHighlightItem {
	const identity = createClippingIdentity(highlight);

	return {
		id: identity.id,
		legacyId: identity.legacyId,
		identityVersion: identity.identityVersion,
		title: highlight.bookTitle,
		author: highlight.author,
		textPreview: highlight.content.replace(/\s+/g, " ").trim().slice(0, 120),
		location: highlight.location || undefined,
	};
}

export function createReturningSyncSummaryHighlightItem(
	highlight: KindleHighlight,
	returnReason: NonNullable<SyncSummaryHighlightItem["returnReason"]>
): SyncSummaryHighlightItem {
	return {
		...createSyncSummaryHighlightItem(highlight),
		returnReason,
	};
}
