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

	it("uses shared book cards for ignored highlight groups with review and remove-all actions", () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([
			createIgnoredHighlight("one", "Atomic Habits"),
		]) as never);

		modal.onOpen();

		const card = elementByClass(modal.contentEl, "kls-book-card");
		const header = elementByClass(card, "kls-book-header");
		const actions = optionalElementByClass(card, "kls-book-actions");

		expect(elementsByClass(modal.contentEl, "kls-book-list")).toHaveLength(1);
		expect(card.classes.has("kls-book-section")).toBe(true);
		expect(elementByClass(header, "kls-book-title").text()).toBe("Atomic Habits");
		expect(elementByClass(card, "kls-book-review-summary").text()).toBe("1 ignored highlight");
		expect(elementsByClass(card, "kls-ignored-highlight-text")).toHaveLength(0);
		expect(elementsByClass(modal.contentEl, "kls-ignored-highlight-item")).toHaveLength(0);
		expect(elementsByClass(header, "kls-action-button").map((button) => button.text())).toEqual([
			"Review Highlights",
		]);
		expect(actions?.classes.has("kls-button-row")).toBe(true);
		expect(elementsByClass(actions, "kls-action-button").map((button) => button.text())).toEqual([
			"Remove All From Ignore List",
		]);
		expect(findByText(actions, "Remove All From Ignore List").classes.has("mod-cta")).toBe(false);
		expect(findByText(actions, "Remove All From Ignore List").classes.has("mod-warning")).toBe(false);
	});

	it("removes all ignored highlights for a book from the summary card", async () => {
		const plugin = createPlugin([
			createIgnoredHighlight("one", "Atomic Habits"),
			createIgnoredHighlight("two", "Atomic Habits"),
			createIgnoredHighlight("three", "Deep Work"),
		]);
		const modal = new IgnoredHighlightsModal(new App() as never, plugin as never);

		modal.onOpen();
		await findByText(bookCardByTitle(modal.contentEl, "Atomic Habits"), "Remove All From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
		expect(plugin.unignoreHighlight).not.toHaveBeenCalledWith(expect.objectContaining({ id: "three" }));
		expect(readText(modal.contentEl)).not.toContain("Atomic Habits");
		expect(readText(modal.contentEl)).toContain("Deep Work");
	});

	it("shows the empty state after removing all ignored highlights from the last book", async () => {
		const plugin = createPlugin([createIgnoredHighlight("one", "Atomic Habits")]);
		const modal = new IgnoredHighlightsModal(new App() as never, plugin as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Remove All From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
		expect(readText(modal.contentEl)).toContain(
			"No ignored highlights. Highlights you ignore during sync will appear here."
		);
	});

	it("opens ignored highlight details for a book", async () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([
			createIgnoredHighlight("one", "Atomic Habits"),
		]) as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		const detailHeader = elementByClass(modal.contentEl, "kls-ignored-detail-header");
		const detailCard = elementByClass(modal.contentEl, "kls-ignored-detail-card");

		expect(elementByClass(detailHeader, "kls-ignored-detail-title").text()).toBe("Ignored Highlights");
		expect(buttonTexts(detailHeader)).toContain("Back to Ignored Highlights");
		expect(readText(modal.contentEl)).toContain("Back to Ignored Highlights");
		expect(elementByClass(detailCard, "kls-book-title").text()).toBe("Atomic Habits");
		expect(elementByClass(detailCard, "kls-book-review-summary").text()).toBe("1 ignored highlight");
		expect(elementByClass(detailCard, "kls-book-meta").text()).toBe("Ignored 7/7/2026");
		expect(elementByClass(detailCard, "kls-ignored-highlight-text").text()).toBe("one preview");
		expect(buttonTexts(modal.contentEl)).toContain("Remove From Ignore List");
	});

	it("keeps the ignored detail book title inside the detail card", async () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([
			createIgnoredHighlight("one", "A Very Long Atomic Habits Title That Should Wrap Cleanly In The Detail Card"),
		]) as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();

		const detailHeader = elementByClass(modal.contentEl, "kls-ignored-detail-header");
		const detailCard = elementByClass(modal.contentEl, "kls-ignored-detail-card");

		expect(elementsByClass(detailHeader, "kls-book-title")).toHaveLength(0);
		expect(elementByClass(detailCard, "kls-book-title").text()).toBe(
			"A Very Long Atomic Habits Title That Should Wrap Cleanly In The Detail Card"
		);
	});

	it("returns from ignored detail view to ignored summary view", async () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([
			createIgnoredHighlight("one", "Atomic Habits"),
		]) as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Back to Ignored Highlights").click();

		expect(readText(modal.contentEl)).toContain("1 ignored highlight");
		expect(readText(modal.contentEl)).not.toContain("one preview");
		expect(buttonTexts(modal.contentEl)).toContain("Review Highlights");
	});

	it("removes row from DOM on unignore click", async () => {
		const plugin = createPlugin([createIgnoredHighlight("one", "Atomic Habits")]);
		const modal = new IgnoredHighlightsModal(new App() as never, plugin as never);

		modal.onOpen();
		await findByText(modal.contentEl, "Review Highlights").click();
		await findByText(modal.contentEl, "Remove From Ignore List").click();

		expect(plugin.unignoreHighlight).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
		expect(readText(modal.contentEl)).toContain("No ignored highlights left in this book.");
		expect(readText(modal.contentEl)).not.toContain("one preview");
	});

	it("uses Title Case for the Ignored Highlights title", () => {
		const modal = new IgnoredHighlightsModal(new App() as never, createPlugin([]) as never);

		modal.onOpen();

		expect(readText(modal.contentEl)).toContain("Ignored Highlights");
		expect(readText(modal.contentEl)).not.toContain("Ignored highlights");
	});
});

function createPlugin(ignoredHighlights: IgnoredHighlight[]) {
	const plugin = {
		settings: {
			ignoredHighlights: [...ignoredHighlights],
		},
		unignoreHighlight: vi.fn(async (target: IgnoredHighlight) => {
			plugin.settings.ignoredHighlights = plugin.settings.ignoredHighlights.filter((highlight) => highlight !== target);
		}),
	};

	return plugin;
}

function createIgnoredHighlight(id: string, title: string): IgnoredHighlight {
	return {
		id,
		title,
		textPreview: `${id} preview`,
		ignoredAt: "2026-07-07T12:00:00.000Z",
	};
}

interface TestElement {
	tagName: string;
	children: TestElement[];
	classes: Set<string>;
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

function buttonTexts(element: unknown): string[] {
	const texts: string[] = [];
	collectButtonTexts(element as TestElement, texts);

	return texts;
}

function elementsByClass(element: unknown, className: string): TestElement[] {
	const matches: TestElement[] = [];
	collectElementsByClass(element as TestElement, className, matches);

	return matches;
}

function elementByClass(element: unknown, className: string): TestElement {
	const match = elementsByClass(element, className)[0];

	if (!match) {
		throw new Error(`Could not find class: ${className}`);
	}

	return match;
}

function optionalElementByClass(element: unknown, className: string): TestElement | undefined {
	return elementsByClass(element, className)[0];
}

function bookCardByTitle(element: unknown, title: string): TestElement {
	const match = elementsByClass(element, "kls-book-card")
		.find((card) => elementByClass(card, "kls-book-title").text() === title);

	if (!match) {
		throw new Error(`Could not find book card: ${title}`);
	}

	return match;
}

function collectButtonTexts(element: TestElement, texts: string[]): void {
	if (element.tagName === "button") {
		texts.push(element.text());
	}

	for (const child of element.children) {
		collectButtonTexts(child, texts);
	}
}

function collectElementsByClass(element: TestElement, className: string, matches: TestElement[]): void {
	if (element.classes.has(className)) {
		matches.push(element);
	}

	for (const child of element.children) {
		collectElementsByClass(child, className, matches);
	}
}
