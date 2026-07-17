import { ButtonComponent } from "obsidian";

export type ReviewButtonTreatment = "native" | "subtle" | "strong";

/** Creates a consistently sized review action without styling unrelated Obsidian controls. */
export function createReviewActionButton(
	containerEl: HTMLElement,
	text: string,
	treatment: ReviewButtonTreatment = "subtle"
): ButtonComponent {
	const button = new ButtonComponent(containerEl).setButtonText(text);

	button.buttonEl.addClass("kls-action-button");
	button.buttonEl.addClass("kls-pill-button");
	if (treatment !== "native") {
		button.buttonEl.addClass(`kls-glass-${treatment}`);
	}

	return button;
}

/** Keeps every Review Highlights entry point neutral because it navigates rather than choosing. */
export function createReviewHighlightsButton(containerEl: HTMLElement): ButtonComponent {
	const button = createReviewActionButton(containerEl, "Review Highlights", "subtle");

	button.buttonEl.addClass("kls-review-action-button");
	return button;
}

/** Keeps equivalent temporary Skip decisions geometrically and visually consistent. */
export function createReviewSkipButton(containerEl: HTMLElement): ButtonComponent {
	const button = createReviewActionButton(containerEl, "Skip This Sync", "subtle");

	button.buttonEl.addClass("kls-skip-this-sync-button");
	return button;
}

/** Keeps visible Back copy stable while naming its destination for assistive technology. */
export function createReviewBackButton(containerEl: HTMLElement, accessibleLabel: string): ButtonComponent {
	const button = createReviewActionButton(containerEl, "Back", "subtle");

	button.buttonEl.addClass("kls-review-back-button");
	button.buttonEl.setAttribute("aria-label", accessibleLabel);
	return button;
}

export function setReviewButtonTreatment(
	button: ButtonComponent,
	treatment: ReviewButtonTreatment
): void {
	button.buttonEl.removeClass("kls-glass-subtle");
	button.buttonEl.removeClass("kls-glass-strong");
	if (treatment !== "native") {
		button.buttonEl.addClass(`kls-glass-${treatment}`);
	}
}
