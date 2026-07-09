import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import { IgnoredHighlight, ImportedHighlightRecord } from "../settings";

export interface SyncClassification {
	newHighlights: KindleHighlight[];
	duplicateHighlights: KindleHighlight[];
	ignoredHighlights: KindleHighlight[];
	possibleReappearedHighlights: KindleHighlight[];
}

export interface SyncClassificationOptions {
	ignoredHighlights: IgnoredHighlight[];
	importedHighlights: ImportedHighlightRecord[];
	highlightExistsInNote: (id: string, highlight: KindleHighlight) => Promise<boolean> | boolean;
}

export async function classifyHighlightsForSync(
	highlights: KindleHighlight[],
	options: SyncClassificationOptions
): Promise<SyncClassification> {
	const ignoredIds = new Set(options.ignoredHighlights.map((highlight) => highlight.id));
	const importedIds = new Set(options.importedHighlights.map((highlight) => highlight.id));
	const seenIds = new Set<string>();
	const classification: SyncClassification = {
		newHighlights: [],
		duplicateHighlights: [],
		ignoredHighlights: [],
		possibleReappearedHighlights: [],
	};

	for (const highlight of highlights) {
		const id = createClippingId(highlight);

		if (seenIds.has(id)) {
			classification.duplicateHighlights.push(highlight);
			continue;
		}

		seenIds.add(id);

		if (ignoredIds.has(id)) {
			classification.ignoredHighlights.push(highlight);
			continue;
		}

		if (!importedIds.has(id)) {
			classification.newHighlights.push(highlight);
			continue;
		}

		try {
			if (await options.highlightExistsInNote(id, highlight)) {
				classification.duplicateHighlights.push(highlight);
			} else {
				classification.possibleReappearedHighlights.push(highlight);
			}
		} catch {
			classification.duplicateHighlights.push(highlight);
		}
	}

	return classification;
}
