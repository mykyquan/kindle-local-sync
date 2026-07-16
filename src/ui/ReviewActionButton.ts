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
