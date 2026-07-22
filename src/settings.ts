export interface IgnoredHighlight {
	id: string;
	/** Present on version 2 records so released 0.1.x identity can be verified without remaining authoritative. */
	legacyId?: string;
	identityVersion?: 2;
	title: string;
	/** Absent only on records saved by plugin versions that predate composite identity. */
	author?: string;
	textPreview: string;
	ignoredAt: string;
	lang?: string;
}

export interface ImportedHighlightRecord {
	id: string;
	/** Present on version 2 records so released 0.1.x identity can be verified without remaining authoritative. */
	legacyId?: string;
	identityVersion?: 2;
	title: string;
	/** Absent only on records saved by plugin versions that predate composite identity. */
	author?: string;
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
		: hasSavedData && containsPersistedSyncHistoryFields(loadedData);

	return {
		...DEFAULT_SETTINGS,
		...loadedData,
		hasCompletedFirstSync,
		ignoredHighlights: loadedData?.ignoredHighlights ?? [],
		importedHighlights: loadedData?.importedHighlights ?? [],
	};
}

function containsPersistedSyncHistoryFields(loadedData: Partial<KindleSyncSettings>): boolean {
	// Releases through 0.1.2 could save ordinary settings without any sync history.
	// Field presence distinguishes that shape from later state even when valid history arrays are empty.
	return "importedHighlights" in loadedData || "ignoredHighlights" in loadedData;
}
