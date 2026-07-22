import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("./ExistingNotesWithoutDataModal.ts", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./ui/ReviewActionButton.ts", import.meta.url), "utf8");

describe("Existing Notes Liquid Glass styling", () => {
	it("keeps the card and compact action row inside the reconnect scope", () => {
		expect(modalSource).toContain('this.contentEl.addClass("kls-glass-scope")');
		expect(modalSource).toContain('card.addClass("kls-glass-card")');
		expect(modalSource).toContain('actions.addClass("kls-reconnect-actions")');
		expect(buttonSource).toContain('button.buttonEl.addClass("kls-pill-button")');
		expect(styles).toMatch(/\.modal:has\(\.kls-reconnect-modal\) \{[\s\S]*?width: min\(720px,/);
		expect(styles).toMatch(/\.kls-reconnect-modal \{[\s\S]*?display: grid;[\s\S]*?gap: 0\.85em;/);
		expect(styles).toMatch(/\.kls-reconnect-card \{[\s\S]*?border-radius: 22px;/);
		expect(styles).toMatch(/\.kls-reconnect-actions \{[\s\S]*?justify-content: flex-start;[\s\S]*?margin-top: 0\.75em;/);
		expect(styles).toMatch(/\.kls-reconnect-actions \.kls-action-button \{[\s\S]*?width: fit-content;/);
	});

	it("stacks touch-sized actions on narrow screens", () => {
		expect(styles).toMatch(/\.kls-reconnect-modal \.kls-pill-button \{[\s\S]*?min-height: 2\.75rem;[\s\S]*?border-radius: 999px;/);
		expect(styles).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.kls-reconnect-actions \{[\s\S]*?flex-direction: column;[\s\S]*?align-items: stretch;/);
		expect(styles).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.kls-reconnect-actions \.kls-action-button \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
	});

	it("keeps the failure state accessible in fallback presentation modes", () => {
		expect(styles).toContain(".kls-operation-failure {");
		expect(styles).toMatch(/\.kls-reconnect-failure \{[\s\S]*?border-radius: 22px;/);
		expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kls-reconnect-card/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-reconnect-failure/);
		expect(styles).not.toMatch(/(^|\n)\s*\.(?:error|failure|operation-failure)\s*\{/);
	});
});
