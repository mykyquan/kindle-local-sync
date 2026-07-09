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
});
