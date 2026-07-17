import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "obsidian";
import { App } from "../__mocks__/obsidian";
import { KindleHighlight } from "./parser/parseClippings";
import { renderClippingMarkdown, SYNC_START_MARKER } from "./render/renderMarkdown";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";

let KindleLocalSyncPlugin: typeof import("./main").default;
let SettingsPersistenceVerificationError: typeof import("./main").SettingsPersistenceVerificationError;

beforeAll(async () => {
	const mainModule = await import("./main");

	KindleLocalSyncPlugin = mainModule.default;
	SettingsPersistenceVerificationError = mainModule.SettingsPersistenceVerificationError;
});

function createPlugin(vault?: Vault): InstanceType<typeof KindleLocalSyncPlugin> {
	return new KindleLocalSyncPlugin(new App(vault) as never, {} as never);
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

		await plugin.unignoreHighlight(plugin.settings.ignoredHighlights[0]!);

		expect(plugin.settings.ignoredHighlights).toEqual([createIgnoredHighlight("two")]);
	});

	it("does nothing if id is not in the list", async () => {
		const plugin = createPlugin();
		const ignoredHighlights = [createIgnoredHighlight("one")];
		plugin.settings.ignoredHighlights = ignoredHighlights;

		await plugin.unignoreHighlight(createIgnoredHighlight("missing"));

		expect(plugin.settings.ignoredHighlights).toEqual(ignoredHighlights);
	});

	it("persists the updated list after unignore", async () => {
		const plugin = createPlugin();
		plugin.settings.ignoredHighlights = [createIgnoredHighlight("one")];

		await plugin.unignoreHighlight(plugin.settings.ignoredHighlights[0]!);

		expect((plugin as unknown as { savedData: unknown }).savedData).toMatchObject({
			ignoredHighlights: [],
		});
	});

	it("keeps live ignored state unchanged when unignore is not durable", async () => {
		const plugin = createPlugin();
		const originalHighlight = createIgnoredHighlight("one");
		const liveSettings = plugin.settings;

		plugin.settings.ignoredHighlights = [originalHighlight];
		setLoadedData(plugin, plugin.settings);
		setSaveDataPersists(plugin, false);

		await expect(plugin.unignoreHighlight(originalHighlight))
			.rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings).toBe(liveSettings);
		expect(plugin.settings.ignoredHighlights).toEqual([originalHighlight]);
		expect(getDurableData(plugin)).toMatchObject({
			ignoredHighlights: [originalHighlight],
		});
	});

	it("keeps live ignored state unchanged when summary Ignore is not durable", async () => {
		const highlight = createHighlight();
		const plugin = createPlugin();
		const liveSettings = plugin.settings;

		setLoadedData(plugin, plugin.settings);
		setSaveDataPersists(plugin, false);

		await expect(plugin.ignoreSummaryHighlight({
			id: "summary-id",
			title: highlight.bookTitle,
			author: highlight.author,
			textPreview: highlight.content,
		}, new CurrentClippingIdentityIndex([highlight])))
			.rejects.toBeInstanceOf(SettingsPersistenceVerificationError);

		expect(plugin.settings).toBe(liveSettings);
		expect(plugin.settings.ignoredHighlights).toEqual([]);
		expect(getDurableData(plugin)).toMatchObject({ ignoredHighlights: [] });
	});
});

describe("blocked explicit Ignore cleanup", () => {
	it("persists the composite Ignore while preserving unsafe Markdown and reporting non-removal", async () => {
		const highlight = createHighlight();
		const notePath = "Kindle Highlights/The Clockwork Orchard.md";
		const markdown = [
			"---",
			`title: ${JSON.stringify(highlight.bookTitle)}`,
			`author: ${JSON.stringify(highlight.author)}`,
			"---",
			"",
			SYNC_START_MARKER,
			"",
			renderClippingMarkdown(highlight),
		].join("\n");
		const file = { path: notePath, extension: "md" };
		const folder = { path: "Kindle Highlights", children: [file] };
		let storedMarkdown = markdown;
		const modify = vi.fn(async (_file: unknown, updatedMarkdown: string) => {
			storedMarkdown = updatedMarkdown;
		});
		const vault = {
			getAbstractFileByPath: vi.fn((path: string) => path === "Kindle Highlights" ? folder : null),
			read: vi.fn(async () => storedMarkdown),
			modify,
		} as unknown as Vault;
		const plugin = createPlugin(vault);

		const result = await plugin.ignoreHighlights(
			[highlight],
			new CurrentClippingIdentityIndex([highlight])
		);

		expect(plugin.settings.ignoredHighlights).toMatchObject([{
			title: highlight.bookTitle,
			author: highlight.author,
		}]);
		expect((plugin as unknown as { savedData: unknown }).savedData).toMatchObject({
			ignoredHighlights: [{ title: highlight.bookTitle, author: highlight.author }],
		});
		expect(storedMarkdown).toBe(markdown);
		expect(modify).not.toHaveBeenCalled();
		expect(result.cleanupResult.blocksRemoved).toBe(0);
		expect(result.cleanupResult.bookOutcomes[0]?.targetOutcomes).toEqual([
			expect.objectContaining({
				status: "unsafe-managed-region",
				reason: "start-without-end",
			}),
		]);
		expect(result.cleanupResult.bookOutcomes[0]?.targetOutcomes).not.toContainEqual(
			expect.objectContaining({ status: "removed-safely" })
		);
	});
});

function createIgnoredHighlight(id: string) {
	return {
		id,
		title: "The Clockwork Orchard",
		textPreview: `${id} preview`,
		ignoredAt: "2099-07-07T00:00:00.000Z",
	};
}

function createHighlight(): KindleHighlight {
	return {
		bookTitle: "The Clockwork Orchard",
		author: "Mira Vale",
		location: "154",
		content: "Clockwork apples chime at midnight.",
		dateAdded: "Monday, October 5, 2099 9:41 AM",
		type: "Highlight",
	};
}

function setLoadedData(plugin: InstanceType<typeof KindleLocalSyncPlugin>, data: unknown): void {
	(plugin as unknown as { setLoadedData(value: unknown): void }).setLoadedData(data);
}

function setSaveDataPersists(plugin: InstanceType<typeof KindleLocalSyncPlugin>, persist: boolean): void {
	(plugin as unknown as { setSaveDataPersists(value: boolean): void }).setSaveDataPersists(persist);
}

function getDurableData(plugin: InstanceType<typeof KindleLocalSyncPlugin>): unknown {
	return (plugin as unknown as { getDurableData(): unknown }).getDurableData();
}
