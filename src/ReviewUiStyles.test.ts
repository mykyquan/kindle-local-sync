import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const firstSyncSource = readFileSync(new URL("./FirstSyncPreviewModal.ts", import.meta.url), "utf8");
const summarySource = readFileSync(new URL("./SyncSummaryModal.ts", import.meta.url), "utf8");
const ignoredSource = readFileSync(new URL("./IgnoredHighlightsModal.ts", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./ui/ReviewActionButton.ts", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./ui/ReviewHighlightDetail.ts", import.meta.url), "utf8");

describe("review action styling", () => {
	it("keeps capsule sizing and glass treatments inside the review scope", () => {
		expect(styles).toContain(".kls-glass-scope .kls-pill-button {");
		expect(styles).not.toMatch(/(^|\n)\s*\.kls-pill-button\s*\{/);
		for (const selector of styles.match(/^.*\.kls-glass-(?:subtle|strong).*\{/gm) ?? []) {
			expect(selector).toContain(".kls-glass-scope");
		}
	});

	it("keeps filter and summary hierarchy on Kindle Local Sync classes", () => {
		expect(firstSyncSource).toContain('button.buttonEl.addClass("kls-book-filter-button")');
		expect(styles).toContain(".kls-summary-count-value {");
		expect(styles).toContain(".kls-summary-count-row-attention .kls-summary-count-value {");
		expect(styles).not.toMatch(/(^|\n)\s*button(?:\s|,|\{|:)/);
		expect(styles).not.toMatch(/(^|\n)\s*\.modal(?:\s|>|\.)[^\n{]*button/);
	});

	it("keeps Needs Review filters neutral while giving only book status orange glass", () => {
		expect(styles).not.toContain("kls-needs-review-attention");
		expect(styles).not.toContain(".kls-status-badge-needs-review {");
		expect(firstSyncSource).toContain('buttonEl.addClass("kls-book-filter-button-active")');
		expect(styles).toContain(".kls-book-status-needs-review .kls-status-badge {");
		expect(styles).toContain("var(--color-orange, var(--text-warning))");
		expect(styles).toContain("backdrop-filter: blur(8px) saturate(1.04);");
	});

	it("shares distinct decision colors between selected buttons and aggregate badges", () => {
		expect(styles).toContain(".kls-glass-scope .kls-decision-button-active-import,");
		expect(styles).toContain(".kls-glass-scope .kls-decision-button-active-ignore,");
		expect(styles).toContain(".kls-glass-scope .kls-decision-button-active-skip,");
		expect(styles).toContain(".kls-book-status-import .kls-status-badge {");
		expect(styles).toContain(".kls-book-status-ignore .kls-status-badge {");
		expect(styles).toContain(".kls-book-status-skip .kls-status-badge {");
		expect(styles).toContain("var(--kls-decision-import-surface)");
		expect(styles).toContain("var(--kls-decision-ignore-surface)");
		expect(styles).toContain("var(--kls-decision-skip-surface)");
		expect(styles).toContain("var(--color-blue) 16%");
		expect(styles).not.toContain("kls-book-status-mixed-decisions");
		expect(styles).not.toContain("kls-book-status-skipped-this-sync");
		expect(styles).not.toContain("kls-selected-decision");
	});

	it("uses one shared compact disclosure card with distinct list and detail triggers", () => {
		expect(styles).toMatch(/\.kls-choice-help-panel \{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?font-size: var\(--font-ui-smaller\);/);
		expect(styles.match(/^\.kls-choice-help-panel \{/gm)).toHaveLength(1);
		expect(styles).not.toMatch(/\.kls-choice-help-panel\s*\{[^}]*(?:fit-content|40rem|margin-inline:\s*auto)/);
		expect(styles).toContain(".kls-choice-help-panel[hidden] {");
		expect(firstSyncSource).toContain('panelEl.setAttribute("role", "note")');
		expect(firstSyncSource).toContain('panelEl.setAttribute("aria-label", "How choices work")');
		expect(firstSyncSource.match(/this\.renderChoicesHelpDisclosure\(/g)).toHaveLength(2);
		expect(firstSyncSource.match(/this\.renderChoicesHelpCard\(/g)).toHaveLength(1);
		expect(firstSyncSource).toContain('triggerAccessibleLabel: "Show how choices work"');
		expect(firstSyncSource).toContain('trigger.buttonEl.setAttribute("aria-controls", options.panelId)');
		expect(styles).toContain(".kls-glass-scope .kls-choice-help-icon {");
	});

	it("keeps filter pills content-sized and touch-sized while allowing narrow wrapping", () => {
		expect(firstSyncSource).toMatch(/private createFilterButton\([\s\S]*?this\.createActionButton\(containerEl, label\)/);
		expect(firstSyncSource).toContain('this.createFilterButton(filters, "All Books", "all")');
		expect(firstSyncSource).toContain('filters.addClass("kls-button-row")');
		expect(firstSyncSource).toContain('filters.addClass("kls-book-filter-row")');
		expect(styles).toMatch(/\.kls-button-row \{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 0\.5em;/);
		expect(styles).toMatch(/\.kls-glass-scope \.kls-pill-button \{[\s\S]*?min-height: 2\.75rem;[\s\S]*?padding: 0\.45em 0\.8em;[\s\S]*?border-radius: 999px;[\s\S]*?font-size: var\(--font-ui-small\);/);
		expect(styles).not.toContain(".kls-glass-scope .kls-book-filter-button {");
		expect(styles).not.toMatch(/\.kls-book-filter-row\s*\{[^}]*(?:width|min-width|flex|gap|padding|border-radius):/);
		expect(styles).not.toMatch(/\.kls-book-filter-button-active\s*\{[^}]*?(?:width|min-width|min-height|padding|border-radius|font-weight):/);
	});

	it("gives the First Sync search field a compact accessible glass treatment", () => {
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-book-search-input \{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*min-height: 44px;[^}]*border: 1px solid var\(--kls-glass-border\);[^}]*border-radius: 15px;[^}]*background: var\(--kls-glass-surface\);[^}]*color: var\(--text-normal\);[^}]*0 2px 6px rgba\(0, 0, 0, 0\.1\);/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-book-search-input::placeholder \{[^}]*color: var\(--text-muted\);[^}]*opacity: 1;/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-book-search-input:focus \{[^}]*border-color: var\(--kls-glass-border\);[^}]*outline: none;[^}]*box-shadow: var\(--kls-book-search-shadow\);/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-book-search-input:focus-visible \{[^}]*border-color: var\(--interactive-accent\);[^}]*outline: 2px solid var\(--interactive-accent\);[^}]*outline-offset: -2px;/);
		expect(styles).toMatch(/@supports \(\(backdrop-filter:[\s\S]*?\.kls-first-sync-modal \.kls-book-search-input \{[^}]*backdrop-filter: blur\(8px\) saturate\(1\.03\);/);
		expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kls-first-sync-modal \.kls-book-search-input \{[^}]*background: var\(--background-secondary\);[^}]*color: var\(--text-normal\);[^}]*backdrop-filter: none;/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-first-sync-modal \.kls-book-search-input \{[^}]*border-color: CanvasText;[^}]*background: Canvas;[^}]*color: CanvasText;[^}]*box-shadow: none;/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-first-sync-modal \.kls-book-search-input::placeholder \{[^}]*color: GrayText;/);
		expect(styles).not.toMatch(/(^|\n)\.kls-book-search-input/);
	});

	it("keeps the First Sync information panel lighter than review cards and alerts", () => {
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-review-warning-callout \{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*padding: 0\.6em 0\.75em;[^}]*border: 1px solid[^}]*border-radius: 16px;[^}]*background: linear-gradient\([^}]*color: var\(--text-muted\);[^}]*0 1px 4px rgba\(0, 0, 0, 0\.08\);[^}]*overflow-x: hidden;[^}]*overflow-wrap: anywhere;/);
		expect(styles).not.toMatch(/\.kls-first-sync-modal \.kls-review-warning-callout \{[^}]*border-left:/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-review-warning-callout p \{[^}]*margin: 0;/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-review-warning-callout p \+ p \{[^}]*margin-top: 0\.3em;/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-review-warning-callout \+ \.kls-review-sticky-summary \{[^}]*margin-top: 0\.55em;/);
		expect(styles).toMatch(/@supports \(\(backdrop-filter:[\s\S]*?\.kls-first-sync-modal \.kls-review-warning-callout \{[^}]*backdrop-filter: blur\(6px\) saturate\(1\.01\);/);
		expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kls-first-sync-modal \.kls-review-warning-callout \{[^}]*background: var\(--background-primary-alt, var\(--background-secondary\)\);[^}]*color: var\(--text-muted\);[^}]*box-shadow: none;[^}]*backdrop-filter: none;/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-first-sync-modal \.kls-review-warning-callout \{[^}]*border-color: CanvasText;[^}]*background: Canvas;[^}]*color: CanvasText;[^}]*box-shadow: none;/);
		expect(styles).not.toMatch(/(^|\n)\.kls-review-warning-callout/);
	});

	it("uses a rounded-rectangle glass surface for book cards without changing pills", () => {
		expect(styles).toMatch(/\.kls-book-card \{[^}]*border-radius: 22px;[^}]*box-shadow: inset 0 1px 0/);
		expect(styles).toMatch(/@supports \(\(backdrop-filter:[\s\S]*?\.kls-glass-scope \.kls-book-card \{[^}]*backdrop-filter: blur\(8px\) saturate\(1\.02\);/);
		expect(styles).not.toMatch(/\.kls-book-card\s*\{[^}]*border-radius:\s*999px/);
		expect(styles).toContain(".kls-glass-scope .kls-pill-button {");
		expect(styles).toContain("border-radius: 999px;");
	});

	it("keeps combined card titles to one ellipsized line with a top-right status area", () => {
		expect(styles).toContain(".kls-book-title {");
		expect(styles).toContain("text-overflow: ellipsis;");
		expect(styles).toContain("white-space: nowrap;");
		expect(styles).toContain(".kls-book-author {");
		expect(styles).toContain(".kls-book-index {");
		expect(styles).toContain(".kls-book-card-controls {");
		expect(styles).toContain("align-items: flex-end;");
		expect(styles).toContain(".kls-book-card-controls .kls-book-status {");
	});

	it("renders Review Highlights as a no-wrap glass button and wraps its action row coherently", () => {
		expect(styles).toContain(".kls-glass-scope .kls-review-action-button,");
		expect(styles).toMatch(/\.kls-glass-scope \.kls-review-action-button,[\s\S]*?min-width: max-content;[\s\S]*?text-decoration: none;[\s\S]*?white-space: nowrap;/);
		expect(styles).toContain("margin-inline-start: auto;");
		expect(styles).toContain(".kls-book-actions {");
		expect(styles).toMatch(/\.kls-book-actions \{[\s\S]*?flex-wrap: wrap;/);
		expect(styles).not.toContain("kls-review-text-link");
		expect(styles).not.toMatch(/\.kls-review-action-button[^}]*text-decoration:\s*underline/);
	});

	it("uses the shared Review Highlights renderer in every existing review path", () => {
		for (const source of [firstSyncSource, summarySource, ignoredSource]) {
			expect(source).toContain("createReviewHighlightsButton(");
		}
		expect(buttonSource).toContain('createReviewActionButton(containerEl, "Review Highlights", "subtle")');
		expect(firstSyncSource.match(/createReviewHighlightsButton\(/g)).toHaveLength(1);
		expect(summarySource.match(/createReviewHighlightsButton\(/g)).toHaveLength(3);
		expect(ignoredSource.match(/createReviewHighlightsButton\(/g)).toHaveLength(1);
	});

	it("keeps desktop help definitions on shared label-and-description rows with a narrow stacked fallback", () => {
		expect(styles).toMatch(/\.kls-choice-help-panel \.kls-choice-help \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\);[\s\S]*?column-gap: 0\.9em;[\s\S]*?max-width: 100%;/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.kls-choice-help-panel \.kls-choice-help \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
		expect(styles).toContain(".kls-choice-help-status {");
		expect(styles).toContain("white-space: pre-line;");
	});

	it("keeps the detail header and help fixed while only highlights scroll", () => {
		expect(styles).toMatch(/\.kls-modal-scroll-body\.kls-highlight-review-layout \{[\s\S]*?overflow-y: hidden;/);
		expect(styles).toMatch(/\.kls-highlight-review-layout \.kls-book-detail-highlights \{[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?scroll-padding-bottom:/);
		expect(styles).not.toMatch(/\.kls-highlight-review-layout \.kls-book-detail-highlights \{[^}]*padding-(?:left|right|inline)/);
		expect(styles).toMatch(/\.kls-highlight-review-layout \.kls-book-detail-header \{[\s\S]*?padding-inline-end: 3\.25rem;/);
		expect(detailSource).toContain("options.renderHeaderActions?.(headerEl, detailEl)");
		expect(detailSource).toContain("options.renderBeforeHighlights?.(detailEl)");
	});

	it("shares Skip This Sync and Back treatments through the review button helper", () => {
		expect(buttonSource).toContain("createReviewSkipButton");
		expect(buttonSource).toContain('button.buttonEl.addClass("kls-skip-this-sync-button")');
		expect(buttonSource).toContain("createReviewBackButton");
		expect(buttonSource).toContain('button.buttonEl.addClass("kls-review-back-button")');
		expect(buttonSource).toContain('createReviewActionButton(containerEl, "Back", "subtle")');
		expect(buttonSource).toContain('button.buttonEl.setAttribute("aria-label", accessibleLabel)');
		expect(firstSyncSource.match(/createReviewSkipButton\(/g)).toHaveLength(1);
	});

	it("shares one direct book-detail layout across regular, skipped, and ignored views", () => {
		expect(styles).toMatch(/\.kls-book-detail-view \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?min-width: 0;/);
		expect(styles).toMatch(/\.kls-book-detail-header \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?min-width: 0;/);
		expect(styles).toMatch(/\.kls-book-detail-highlights \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?min-width: 0;/);
		expect(styles).not.toMatch(/\.kls-book-detail-view \{[^}]*(?:fit-content|margin-inline|padding):/);
		expect(styles).not.toContain("max-width: 42rem;");
		expect(styles).toContain(".kls-book-detail-highlight {");
		expect(styles).toContain(".kls-book-detail-highlight-text {");
		expect(styles).toContain(".kls-book-detail-highlight-meta {");
		expect(styles).toContain(".kls-book-detail-highlight-actions {");
		expect(styles).toMatch(/\.kls-book-detail-header \.kls-review-navigation \{[\s\S]*?margin: 0 0 0\.55em;/);
		expect(detailSource).toContain("export function renderReviewHighlightDetail(");
		expect(detailSource).toContain("export function renderReviewHighlightRow(");
		for (const source of [firstSyncSource, summarySource, ignoredSource]) {
			expect(source).toContain("renderReviewHighlightDetail(");
			expect(source).toContain("renderReviewHighlightRow(");
		}
		expect(styles).not.toContain("kls-ignored-detail-card");
		expect(styles).not.toContain("kls-ignored-detail-header");
	});

	it("aligns list and detail help to their full shared content containers", () => {
		expect(styles).toMatch(/\.kls-review-controls-panel \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?padding: 0;/);
		expect(styles).not.toMatch(/\.kls-review-controls-panel \{[^}]*(?:margin-inline:\s*auto|border:|border-radius:)/);
		expect(styles).toMatch(/\.kls-book-search-control \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
		expect(styles).toMatch(/\.kls-book-list \{[\s\S]*?width: 100%;/);
		expect(styles).toMatch(/\.kls-choice-help-panel \{[\s\S]*?overflow-x: hidden;/);
		expect(styles).not.toMatch(/\.kls-highlight-review-layout \.kls-choice-help-panel \{[^}]*(?:width|max-width|margin-inline)/);
	});

	it("separates responsive summary navigation and aligns result counts with wrapping labels", () => {
		expect(styles).toMatch(/\.kls-summary-actions \{[\s\S]*?display: flex;[\s\S]*?justify-content: space-between;[\s\S]*?width: 100%;/);
		expect(styles).toContain(".kls-summary-navigation-actions {");
		expect(styles).toContain(".kls-summary-close-actions {");
		expect(styles).toMatch(/\.kls-summary-actions \.kls-action-button \{[\s\S]*?min-height: 2\.75rem;[\s\S]*?overflow-wrap: normal;[\s\S]*?word-break: normal;/);
		expect(styles).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.kls-summary-actions \{[\s\S]*?flex-direction: column;[\s\S]*?\.kls-summary-actions \.kls-action-button \{[\s\S]*?width: 100%;/);
		expect(styles).toMatch(/\.kls-summary-count-row \{[^}]*display: grid;[^}]*grid-template-columns: 4ch minmax\(0, 1fr\);[^}]*align-items: start;[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*margin: 0\.4em 0;[^}]*column-gap: 0\.5em;[^}]*row-gap: 0;/);
		expect(styles).toMatch(/\.kls-summary-count-value \{[^}]*font-size: 1\.08em;[^}]*font-weight: 700;[^}]*line-height: 1\.35;[^}]*font-variant-numeric: tabular-nums;[^}]*text-align: right;[^}]*white-space: nowrap;/);
		expect(styles).toMatch(/\.kls-summary-count-label \{[^}]*min-width: 0;[^}]*font-size: 1em;[^}]*font-weight: 400;[^}]*line-height: 1\.35;[^}]*overflow-wrap: anywhere;[^}]*word-break: normal;/);
		expect(styles).toContain(".kls-summary-count-row-primary {");
		expect(styles).not.toMatch(/\.kls-summary-count-row-primary \{[^}]*(?:margin|font-size|font-weight|line-height):/);
		expect(styles).not.toMatch(/\.kls-summary-count-row-primary \.kls-summary-count-value \{[^}]*(?:font-size|font-weight|line-height):/);
		expect(styles).toContain(".kls-ignore-results-panel {");
	});

	it("keeps shared modal content scrollable, touch-sized, and overflow-safe", () => {
		expect(styles).toMatch(/\.kls-glass-scope:not\(\.kls-first-sync-modal\) \{[\s\S]*?max-height:[\s\S]*?overflow-y: auto;/);
		expect(styles).toMatch(/\.kls-glass-scope \{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?safe-area-inset-bottom/);
		expect(styles).toMatch(/\.kls-glass-scope \.kls-pill-button \{[\s\S]*?min-height: 2\.75rem;/);
		expect(styles).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.kls-book-actions \.kls-action-button,[\s\S]*?width: 100%;/);
		expect(styles).toContain("word-break: normal;");
		expect(styles).toContain("hyphens: none;");
	});

	it("keeps the First Sync bulk footer grouped on desktop and full-width only in its narrow scope", () => {
		expect(firstSyncSource).toContain('footer.addClass("kls-first-sync-review-actions")');
		expect(firstSyncSource).toContain('bulkActions.addClass("kls-first-sync-bulk-actions")');
		expect(firstSyncSource).toContain('completionActions.addClass("kls-first-sync-completion-actions")');
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-first-sync-review-actions \{[^}]*flex-direction: row;[^}]*flex-wrap: nowrap;[^}]*justify-content: space-between;/);
		expect(styles).toMatch(/\.kls-first-sync-modal \.kls-first-sync-completion-actions \{[^}]*justify-content: flex-end;[^}]*margin-inline-start: auto;/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.kls-first-sync-modal \.kls-first-sync-review-actions,[\s\S]*?flex-direction: column;[\s\S]*?width: 100%;/);
		expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.kls-first-sync-modal \.kls-first-sync-review-actions \.kls-action-button \{[^}]*width: 100%;[^}]*max-width: 100%;/);
		expect(styles).toMatch(/\.kls-sticky-actions \{[^}]*justify-content: flex-end;/);
		expect(styles).not.toMatch(/(^|\n)\.kls-first-sync-review-actions\s*\{/);
	});

	it("keeps Needs Review glass legible in fallback modes", () => {
		expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kls-book-status-needs-review/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-book-status-needs-review/);
	});

	it("keeps book-card reduced-transparency and forced-color fallbacks", () => {
		expect(styles).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.kls-glass-scope \.kls-book-card/);
		expect(styles).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.kls-glass-scope \.kls-book-card/);
		expect(styles).toContain("background: Canvas;");
	});

	it("keeps operation failure styling on a Kindle Local Sync class", () => {
		expect(styles).toContain(".kls-operation-failure {");
		expect(styles).toContain(".kls-operation-failure h3,");
		expect(styles).not.toMatch(/(^|\n)\s*\.(?:error|failure|operation-failure)\s*\{/);
	});

	it("gives strong and subtle glass visibly different non-blur surfaces", () => {
		expect(styles).toContain("--kls-glass-shadow-subtle:");
		expect(styles).toContain("--kls-glass-shadow-strong:");
		expect(styles).toContain("background: var(--kls-glass-surface);");
		expect(styles).toContain(
			"background: linear-gradient(135deg, var(--interactive-accent) 0%, var(--interactive-accent-hover) 100%);"
		);
	});

	it("retains focus, disabled, reduced-motion, reduced-transparency, and forced-color fallbacks", () => {
		expect(styles).toContain(":focus-visible");
		expect(styles).toContain(".kls-glass-scope .kls-pill-button:disabled");
		expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
		expect(styles).toContain("@media (prefers-reduced-transparency: reduce)");
		expect(styles).toContain("@media (forced-colors: active)");
	});
});
