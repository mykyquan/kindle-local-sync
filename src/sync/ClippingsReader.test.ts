import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readClippingsFile } from "./ClippingsReader";

let temporaryDirectory: string | null = null;

afterEach(async () => {
	if (temporaryDirectory) {
		await rm(temporaryDirectory, { force: true, recursive: true });
		temporaryDirectory = null;
	}
});

describe("readClippingsFile", () => {
	it("reads a UTF-8 clippings file as raw text", async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), "kindle-local-sync-"));
		const filePath = join(temporaryDirectory, "My Clippings.txt");
		const rawText = "The Clockwork Orchard (Mira Vale)\n==========";

		await writeFile(filePath, rawText, "utf8");

		await expect(readClippingsFile(filePath)).resolves.toBe(rawText);
	});

	it("throws a clear error when the file cannot be read", async () => {
		await expect(readClippingsFile("/missing/My Clippings.txt")).rejects.toThrow(
			"Could not read My Clippings.txt"
		);
	});
});
