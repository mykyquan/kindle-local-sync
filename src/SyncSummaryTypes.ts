import { KindleHighlight } from "./parser/parseClippings";
import { createClippingId } from "./render/renderMarkdown";

export interface SyncSummaryHighlightItem {
	id: string;
	title: string;
	author: string;
	textPreview: string;
	location?: string;
	lang?: string;
}

export function createSyncSummaryHighlightItem(highlight: KindleHighlight): SyncSummaryHighlightItem {
	return {
		id: createClippingId(highlight),
		title: highlight.bookTitle,
		author: highlight.author,
		textPreview: highlight.content.replace(/\s+/g, " ").trim().slice(0, 120),
		location: highlight.location || undefined,
	};
}
