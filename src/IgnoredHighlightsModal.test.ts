import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../__mocks__/obsidian";
import { IgnoredHighlight } from "./settings";

let IgnoredHighlightsModal: typeof import("./IgnoredHighlightsModal").IgnoredHighlightsModal;

beforeAll(async () => {
	IgnoredHighlightsModal = (await import("./IgnoredHighlightsModal")).IgnoredHighlightsModal;
});

describe("IgnoredHighlightsModal", () => {
	it("shows empty state when ignoredHighlights is empty", () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([]) as never);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain(
			"No ignored highlights. Highlights you ignore during sync will appear here."
		);
	});

	it("groups highlights by book title", () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([
			createIgnoredHighlight("one", "Atomic Habits"),
			createIgnoredHighlight("two", "Atomic Habits"),
			createIgnoredHighlight("three", "Deep Work"),
		]) as never);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("Deep Work");
		expect(readText(modal.contentEl).match(/Atomic Habits/g)).toHaveLength(1);
	});

	it("removes row from DOM on unignore click", async () => {
		const plugin = createPlugin([createIgnoredHighlight("one", "Atomic Habits")]);
		const modal = new IgnoredHighlightsModal(new App() as never, plugin as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Remove from ignore list").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith("one");
		expect(readText(modal.contentEl)).toContain("No ignored highlights");
		expect(readText(modal.contentEl)).not.toContain("one preview");
	});
});

function createPlugin(ignoredHighlights: IgnoredHighlight[]) {
	const plugin = {
		settings: {
			ignoredHighlights: [...ignoredHighlights],
		},
		unignoreHighlight: vi.fn(async (id: string) => {
			plugin.settings.ignoredHighlights = plugin.settings.ignoredHighlights.filter((highlight) => highlight.id !== id);
		}),
	};

	return plugin;
}

function createIgnoredHighlight(id: string, title: string): IgnoredHighlight {
	return {
		id,
		title,
		textPreview: `${id} preview`,
		ignoredAt: "2026-07-07T00:00:00.000Z",
	};
}

interface TestElement {
	text: () => string;
	findByText: (text: string) => TestElement | null;
	click: () => Promise<void>;
}

function readText(element: unknown): string {
	return (element as TestElement).text();
}

function findByText(element: unknown, text: string): TestElement {
	const match = (element as TestElement).findByText(text);

	if (!match) {
		throw new Error(`Could not find text: ${text}`);
	}

	return match;
}
