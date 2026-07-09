export interface IgnoredHighlight {
	id: string;
	title: string;
	textPreview: string;
	ignoredAt: string;
	lang?: string;
}

export interface ImportedHighlightRecord {
	id: string;
	title: string;
	textPreview: string;
	importedAt: string;
}

export interface KindleSyncSettings {
	clippingsPath: string;
	highlightsFolder: string;
	strictLocalOnly: boolean;
	skipIgnoredHighlights: boolean;
	ignoredHighlights: IgnoredHighlight[];
	importedHighlights: ImportedHighlightRecord[];
	hasCompletedFirstSync: boolean;
}

export const DEFAULT_SETTINGS: KindleSyncSettings = {
	clippingsPath: "",
	highlightsFolder: "Kindle Highlights",
	strictLocalOnly: true,
	skipIgnoredHighlights: true,
	ignoredHighlights: [],
	importedHighlights: [],
	hasCompletedFirstSync: false,
};

export function migrateSettings(loadedData: Partial<KindleSyncSettings> | null): KindleSyncSettings {
	const hasSavedData = loadedData !== null;
	const hasCompletedFirstSync = hasSavedData && "hasCompletedFirstSync" in loadedData
		? loadedData.hasCompletedFirstSync ?? false
		: hasSavedData;

	return {
		...DEFAULT_SETTINGS,
		...loadedData,
		hasCompletedFirstSync,
		ignoredHighlights: loadedData?.ignoredHighlights ?? [],
		importedHighlights: loadedData?.importedHighlights ?? [],
	};
}
