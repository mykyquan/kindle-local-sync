import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";

let KindleLocalSyncPlugin: typeof import("./main").default;

beforeAll(async () => {
	KindleLocalSyncPlugin = (await import("./main")).default;
});

function createPlugin(): InstanceType<typeof KindleLocalSyncPlugin> {
	return new KindleLocalSyncPlugin(new App() as never, {} as never);
}

describe("unignoreHighlight", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("removes the highlight with matching id from ignoredHighlights", async () => {
		const plugin = createPlugin();
		plugin.settings.ignoredHighlights = [
			createIgnoredHighlight("one"),
			createIgnoredHighlight("two"),
		];

		await plugin.unignoreHighlight("one");

		expect(plugin.settings.ignoredHighlights).toEqual([createIgnoredHighlight("two")]);
	});

	it("does nothing if id is not in the list", async () => {
		const plugin = createPlugin();
		const ignoredHighlights = [createIgnoredHighlight("one")];
		plugin.settings.ignoredHighlights = ignoredHighlights;

		await plugin.unignoreHighlight("missing");

		expect(plugin.settings.ignoredHighlights).toEqual(ignoredHighlights);
	});

	it("persists the updated list after unignore", async () => {
		const plugin = createPlugin();
		plugin.settings.ignoredHighlights = [createIgnoredHighlight("one")];

		await plugin.unignoreHighlight("one");

		expect((plugin as unknown as { savedData: unknown }).savedData).toMatchObject({
			ignoredHighlights: [],
		});
	});
});

function createIgnoredHighlight(id: string) {
	return {
		id,
		title: "Atomic Habits",
		textPreview: `${id} preview`,
		ignoredAt: "2026-07-07T00:00:00.000Z",
	};
}
