import { KindleHighlight } from "../parser/parseClippings";

export const SYNTHETIC_LEGACY_COLLISION_ID = "kls-v9fxc5";

export function createSyntheticSameBookCollision(): [KindleHighlight, KindleHighlight] {
	const shared = {
		bookTitle: "Synthetic Atlas of Quiet Machines",
		author: "Example Author",
		dateAdded: "Monday, January 1, 2099 12:00 AM",
		type: "Highlight" as const,
	};

	return [
		{
			...shared,
			location: "25466",
			content: "Synthetic observation number 15466: a fictional machine emits tone 511.",
		},
		{
			...shared,
			location: "79161",
			content: "Synthetic observation number 69161: a fictional machine emits tone 368.",
		},
	];
}

export function renderSyntheticSameBookCollisionClippings(): string {
	const [first, second] = createSyntheticSameBookCollision();

	return [first, second].map((highlight) => [
		`${highlight.bookTitle} (${highlight.author})`,
		`- Your Highlight at location ${highlight.location} | Added on ${highlight.dateAdded}`,
		"",
		highlight.content,
		"==========",
	].join("\n")).join("\n");
}
