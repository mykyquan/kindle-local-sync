import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settings";

describe("settings migration", () => {
	it("sets hasCompletedFirstSync to false for new installs", async () => {
		const settings = migrateSettings(null);

		expect(settings.hasCompletedFirstSync).toBe(false);
	});

	it("recognizes authentic 0.1.2 settings-only data as incomplete while preserving every setting", () => {
		const settings = migrateSettings({
			clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt",
			highlightsFolder: "Legacy Kindle Notes",
			strictLocalOnly: true,
		});

		expect(settings).toMatchObject({
			clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt",
			highlightsFolder: "Legacy Kindle Notes",
			strictLocalOnly: true,
			hasCompletedFirstSync: false,
		});
	});

	it("initializes missing importedHighlights as an empty array", async () => {
		const settings = migrateSettings({
			clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt",
		});

		expect(settings.importedHighlights).toEqual([]);
	});

	it("preserves existing ignoredHighlights", async () => {
		const ignoredHighlights = [
			{
				id: "kls-existing",
				title: "The Clockwork Orchard",
				textPreview: "Old highlight.",
				ignoredAt: "2099-07-07T00:00:00.000Z",
			},
		];
		const settings = migrateSettings({ ignoredHighlights });

		expect(settings.ignoredHighlights).toEqual(ignoredHighlights);
	});

	it("does not confuse explicit current incomplete state with settings-only legacy data", () => {
		const settings = migrateSettings({
			hasCompletedFirstSync: false,
			importedHighlights: [],
			ignoredHighlights: [],
		});

		expect(settings.hasCompletedFirstSync).toBe(false);
	});

	it("keeps a current completed state trusted when both history arrays are empty", () => {
		const settings = migrateSettings({
			hasCompletedFirstSync: true,
			importedHighlights: [],
			ignoredHighlights: [],
		});

		expect(settings.hasCompletedFirstSync).toBe(true);
	});

	it("preserves backward compatibility for saved identity fields that predate the completion flag", () => {
		const settings = migrateSettings({
			importedHighlights: [],
			ignoredHighlights: [],
		});

		expect(settings.hasCompletedFirstSync).toBe(true);
	});

	it.each([
		[{ clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt" }],
		[{ highlightsFolder: "Older Kindle Notes" }],
		[{ strictLocalOnly: false }],
		[{ skipIgnoredHighlights: false }],
	])("handles a partial historical settings-only object safely", (loadedData) => {
		const settings = migrateSettings(loadedData);

		expect(settings).toMatchObject(loadedData);
		expect(settings.hasCompletedFirstSync).toBe(false);
		expect(settings.importedHighlights).toEqual([]);
		expect(settings.ignoredHighlights).toEqual([]);
	});

	it("preserves legacy authorless imported and ignored records byte-for-byte and in order", () => {
		const loadedData = {
			importedHighlights: [
				{ id: "kls-one", title: "One", textPreview: "First", importedAt: "2099-01-01" },
				{ id: "kls-two", title: "Two", textPreview: "Second", importedAt: "2099-01-02" },
			],
			ignoredHighlights: [
				{ id: "kls-three", title: "Three", textPreview: "Third", ignoredAt: "2099-01-03" },
			],
		};
		const before = JSON.stringify(loadedData);
		const settings = migrateSettings(loadedData);

		expect(JSON.stringify({
			importedHighlights: settings.importedHighlights,
			ignoredHighlights: settings.ignoredHighlights,
		})).toBe(before);
	});
});
