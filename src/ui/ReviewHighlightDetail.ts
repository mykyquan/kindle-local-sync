import { ButtonComponent } from "obsidian";
import { createReviewBackButton } from "./ReviewActionButton";
import { renderReviewBookAuthor, renderReviewBookMetadata } from "./ReviewBookMetadata";

interface ReviewHighlightDetailOptions {
	titles: readonly string[];
	author?: string;
	countText: string;
	backAccessibleLabel: string;
	onBack: () => void;
	renderHeaderActions?: (headerEl: HTMLElement, detailEl: HTMLElement) => void;
	renderBeforeHighlights?: (detailEl: HTMLElement) => void;
}

interface ReviewHighlightDetailElements {
	detailEl: HTMLElement;
	headerEl: HTMLElement;
	highlightsEl: HTMLElement;
	backButton: ButtonComponent;
}

interface ReviewHighlightRowElements {
	rowEl: HTMLElement;
	actionsEl: HTMLElement;
}

/**
 * Defines the shared detail boundary so review, skipped, and ignored highlights cannot
 * drift into separate header orders or responsive containers.
 */
export function renderReviewHighlightDetail(
	containerEl: HTMLElement,
	options: ReviewHighlightDetailOptions
): ReviewHighlightDetailElements {
	const detailEl = containerEl.createDiv();
	const headerEl = detailEl.createDiv();
	const navigationEl = headerEl.createDiv();

	detailEl.addClass("kls-book-detail-view");
	headerEl.addClass("kls-book-detail-header");
	navigationEl.addClass("kls-button-row");
	navigationEl.addClass("kls-review-navigation");
	navigationEl.addClass("kls-book-detail-back");
	const backButton = createReviewBackButton(navigationEl, options.backAccessibleLabel)
		.onClick(options.onBack);

	renderReviewBookMetadata(headerEl, {
		titles: options.titles,
		author: options.author,
		headingLevel: "h2",
		includeAuthor: false,
	});
	renderReviewBookAuthor(headerEl, options.author);
	headerEl.createEl("p", { text: options.countText }).addClass("kls-book-detail-count");
	options.renderHeaderActions?.(headerEl, detailEl);
	options.renderBeforeHighlights?.(detailEl);

	const highlightsEl = detailEl.createDiv();

	highlightsEl.addClass("kls-book-detail-highlights");
	return { detailEl, headerEl, highlightsEl, backButton };
}

/** Renders the common text, metadata, divider, and action positions for one highlight. */
export function renderReviewHighlightRow(
	containerEl: HTMLElement,
	text: string,
	metadata?: string
): ReviewHighlightRowElements {
	const rowEl = containerEl.createDiv();

	rowEl.addClass("kls-book-detail-highlight");
	rowEl.createEl("p", { text }).addClass("kls-book-detail-highlight-text");
	if (metadata) {
		rowEl.createEl("p", { text: metadata }).addClass("kls-book-detail-highlight-meta");
	}

	const actionsEl = rowEl.createDiv();

	actionsEl.addClass("kls-button-row");
	actionsEl.addClass("kls-book-detail-highlight-actions");
	return { rowEl, actionsEl };
}
