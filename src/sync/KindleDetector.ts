/* eslint-disable import/no-nodejs-modules */
import { access } from "fs/promises";
import { homedir, userInfo } from "os";

const CLIPPINGS_FILE_NAME = "My Clippings.txt";

export async function detectClippingsPath(manualPath?: string): Promise<string | null> {
	const trimmedManualPath = manualPath?.trim();

	if (trimmedManualPath && await fileExists(trimmedManualPath)) {
		return trimmedManualPath;
	}

	for (const candidatePath of getCandidatePaths()) {
		if (await fileExists(candidatePath)) {
			return candidatePath;
		}
	}

	return null;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function getCandidatePaths(): string[] {
	const userName = getUserName();
	const candidatePaths = [
		`/Volumes/Kindle/documents/${CLIPPINGS_FILE_NAME}`,
		`/Volumes/Kindle/Documents/${CLIPPINGS_FILE_NAME}`,
	];

	for (let charCode = "D".charCodeAt(0); charCode <= "Z".charCodeAt(0); charCode++) {
		const driveLetter = String.fromCharCode(charCode);

		candidatePaths.push(
			`${driveLetter}:\\documents\\${CLIPPINGS_FILE_NAME}`,
			`${driveLetter}:\\Documents\\${CLIPPINGS_FILE_NAME}`
		);
	}

	if (userName) {
		candidatePaths.push(
			`/media/${userName}/Kindle/documents/${CLIPPINGS_FILE_NAME}`,
			`/media/${userName}/Kindle/Documents/${CLIPPINGS_FILE_NAME}`,
			`/run/media/${userName}/Kindle/documents/${CLIPPINGS_FILE_NAME}`,
			`/run/media/${userName}/Kindle/Documents/${CLIPPINGS_FILE_NAME}`
		);
	}

	return candidatePaths;
}

function getUserName(): string | null {
	try {
		const userName = userInfo().username;

		if (userName) {
			return userName;
		}
	} catch {
		// Continue with the home directory fallback below.
	}

	try {
		return homedir().split(/[\\/]/).pop() ?? null;
	} catch {
		return null;
	}
}
