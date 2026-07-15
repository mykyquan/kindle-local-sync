import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settings";

describe("settings migration", () => {
	it("sets hasCompletedFirstSync to false for new installs", async () => {
		const settings = migrateSettings(null);

		expect(settings.hasCompletedFirstSync).toBe(false);
	});

	it("migrates existing saved data without hasCompletedFirstSync to true", async () => {
		const settings = migrateSettings({
			clippingsPath: "/Volumes/Kindle/documents/My Clippings.txt",
		});

		expect(settings.hasCompletedFirstSync).toBe(true);
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
				title: "Atomic Habits",
				textPreview: "Old highlight.",
				ignoredAt: "2026-07-07T00:00:00.000Z",
			},
		];
		const settings = migrateSettings({ ignoredHighlights });

		expect(settings.ignoredHighlights).toEqual(ignoredHighlights);
	});

	it("preserves legacy authorless imported and ignored records byte-for-byte and in order", () => {
		const loadedData = {
			importedHighlights: [
				{ id: "kls-one", title: "One", textPreview: "First", importedAt: "2026-01-01" },
				{ id: "kls-two", title: "Two", textPreview: "Second", importedAt: "2026-01-02" },
			],
			ignoredHighlights: [
				{ id: "kls-three", title: "Three", textPreview: "Third", ignoredAt: "2026-01-03" },
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
