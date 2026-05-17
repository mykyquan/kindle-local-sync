import { describe, expect, it } from "vitest";
import { sanitizeMarkdownFilename, sanitizeVaultFolderPath } from "./sanitizePath";

describe("sanitizeMarkdownFilename", () => {
	it("removes invalid filename characters and keeps readable titles", () => {
		expect(sanitizeMarkdownFilename("A/B\\C: D*E? \"F\" <G>|H")).toBe("A B C D E F G H.md");
	});

	it("prevents path traversal", () => {
		expect(sanitizeMarkdownFilename("../Secrets/Book")).toBe("Secrets Book.md");
	});

	it("uses a fallback filename when the title is empty", () => {
		expect(sanitizeMarkdownFilename("   ")).toBe("Untitled Kindle Book.md");
	});
});

describe("sanitizeVaultFolderPath", () => {
	it("sanitizes each folder segment", () => {
		expect(sanitizeVaultFolderPath("Kindle/Bad:Folder/Notes")).toBe("Kindle/Bad Folder/Notes");
	});

	it("prevents traversal and falls back when no safe segments remain", () => {
		expect(sanitizeVaultFolderPath("../..")).toBe("Kindle Highlights");
	});
});
