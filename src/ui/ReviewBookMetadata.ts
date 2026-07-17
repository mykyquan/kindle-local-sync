export interface ReviewBookMetadata {
	titles: readonly string[];
	author?: string;
	position?: {
		current: number;
		total: number;
	};
}

interface RenderReviewBookMetadataOptions extends ReviewBookMetadata {
	headingLevel?: "h2" | "h3";
	includeAuthor?: boolean;
}

/** Renders structured book metadata without changing or inferring the underlying record. */
export function renderReviewBookMetadata(
	containerEl: HTMLElement,
	options: RenderReviewBookMetadataOptions
): void {
	const combinedTitle = createCombinedReviewBookTitle(options);

	if (options.position) {
		containerEl.createEl("p", {
			text: `${options.position.current} / ${options.position.total}`,
		}).addClass("kls-book-index");
	}

	const titleEl = containerEl.createEl(options.headingLevel ?? "h3", {
		text: combinedTitle,
	});

	titleEl.addClass("kls-book-title");
	titleEl.setAttribute("aria-label", combinedTitle);
	titleEl.setAttribute("title", combinedTitle);

	if (options.includeAuthor !== false) {
		renderReviewBookAuthor(containerEl, options.author);
	}

}

export function renderReviewBookAuthor(containerEl: HTMLElement, author?: string): void {
	if (hasVisibleAuthor(author)) {
		const authorEl = containerEl.createEl("p", { text: author });

		authorEl.addClass("kls-book-author");
		authorEl.addClass("kls-book-meta");
		authorEl.setAttribute("aria-label", author);
		authorEl.setAttribute("title", author);
	}
}

export function createCombinedReviewBookTitle(metadata: ReviewBookMetadata): string {
	const exactTitles: string[] = [];

	for (const title of metadata.titles) {
		if (title.length > 0 && !exactTitles.includes(title)) {
			exactTitles.push(title);
		}
	}

	return exactTitles.join(" · ") || "Untitled Kindle Book";
}

function hasVisibleAuthor(author?: string): author is string {
	return Boolean(author?.trim()) && author?.trim().toLowerCase() !== "unknown";
}
