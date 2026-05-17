import { readFile } from "fs/promises";

export async function readClippingsFile(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";

		throw new Error(`Could not read My Clippings.txt at "${filePath}": ${message}`);
	}
}
