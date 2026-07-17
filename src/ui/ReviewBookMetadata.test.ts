import { describe, expect, it } from "vitest";
import { createCombinedReviewBookTitle } from "./ReviewBookMetadata";

describe("review book metadata presentation", () => {
	it("keeps exact title variants together in their existing order", () => {
		expect(createCombinedReviewBookTitle({
			titles: ["Muôn Kiếp Nhân Sinh", "Many Lives – Many Times", "Muôn Kiếp Nhân Sinh"],
			author: "Nguyên Phong",
		})).toBe("Muôn Kiếp Nhân Sinh · Many Lives – Many Times");
	});

});
