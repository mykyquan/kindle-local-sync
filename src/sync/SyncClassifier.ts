import { KindleHighlight } from "../parser/parseClippings";
import { createClippingId } from "../render/renderMarkdown";
import { IgnoredHighlight, ImportedHighlightRecord } from "../settings";
import {
	createKindleHighlightIdentityKey,
	createStoredHighlightIdentityKeySet,
	CurrentClippingIdentityIndex,
} from "./HighlightIdentity";

export interface SyncClassification {
	newHighlights: KindleHighlight[];
	duplicateHighlights: KindleHighlight[];
	ignoredHighlights: KindleHighlight[];
	possibleReappearedHighlights: KindleHighlight[];
}

export interface SyncClassificationOptions {
	ignoredHighlights: IgnoredHighlight[];
	importedHighlights: ImportedHighlightRecord[];
	identityIndex: CurrentClippingIdentityIndex;
	highlightExistsInNote: (id: string, highlight: KindleHighlight) => Promise<boolean> | boolean;
}

export async function classifyHighlightsForSync(
	highlights: KindleHighlight[],
	options: SyncClassificationOptions
): Promise<SyncClassification> {
	const ignoredIdentities = createStoredHighlightIdentityKeySet(options.ignoredHighlights, options.identityIndex);
	const importedIdentities = createStoredHighlightIdentityKeySet(options.importedHighlights, options.identityIndex);
	const seenIdentities = new Set<string>();
	const classification: SyncClassification = {
		newHighlights: [],
		duplicateHighlights: [],
		ignoredHighlights: [],
		possibleReappearedHighlights: [],
	};

	for (const highlight of highlights) {
		const identity = createKindleHighlightIdentityKey(highlight);

		if (seenIdentities.has(identity)) {
			classification.duplicateHighlights.push(highlight);
			continue;
		}

		seenIdentities.add(identity);

		if (ignoredIdentities.has(identity)) {
			classification.ignoredHighlights.push(highlight);
			continue;
		}

		if (!importedIdentities.has(identity)) {
			classification.newHighlights.push(highlight);
			continue;
		}

		try {
			if (await options.highlightExistsInNote(createClippingId(highlight), highlight)) {
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
