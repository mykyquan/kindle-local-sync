import { describe, expect, it } from "vitest";
import { createCombinedReviewBookTitle } from "./ReviewBookMetadata";

describe("review book metadata presentation", () => {
	it("keeps exact title variants together in their existing order", () => {
		expect(createCombinedReviewBookTitle({
			titles: ["Café at Dawn", "Dawn Café – Illustrated Edition", "Café at Dawn"],
			author: "Mira Vale",
		})).toBe("Café at Dawn · Dawn Café – Illustrated Edition");
	});

});
