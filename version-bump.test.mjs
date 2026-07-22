import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./version-bump.mjs", import.meta.url));
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories) {
		rmSync(directory, { recursive: true, force: true });
	}
	temporaryDirectories.length = 0;
});

function createVersionFixture(versions) {
	const directory = mkdtempSync(path.join(tmpdir(), "kindle-local-sync-version-bump-"));
	temporaryDirectories.push(directory);
	writeFileSync(
		path.join(directory, "manifest.json"),
		JSON.stringify({ version: "0.1.2", minAppVersion: "0.15.0" }, null, "\t"),
	);
	writeFileSync(path.join(directory, "versions.json"), JSON.stringify(versions, null, "\t"));
	return directory;
}

function runVersionBump(directory, targetVersion) {
	execFileSync(process.execPath, [scriptPath], {
		cwd: directory,
		env: { ...process.env, npm_package_version: targetVersion },
	});
	return JSON.parse(readFileSync(path.join(directory, "versions.json"), "utf8"));
}

describe("version-bump", () => {
	it("adds a new version when its minimum app version is already used", () => {
		const directory = createVersionFixture({ "0.1.2": "0.15.0" });

		expect(runVersionBump(directory, "0.1.3")).toEqual({
			"0.1.2": "0.15.0",
			"0.1.3": "0.15.0",
		});
	});

	it("leaves the version mapping unchanged when rerun for the same version", () => {
		const directory = createVersionFixture({ "0.1.2": "0.15.0" });
		runVersionBump(directory, "0.1.3");
		const firstRun = readFileSync(path.join(directory, "versions.json"), "utf8");

		expect(runVersionBump(directory, "0.1.3")).toEqual({
			"0.1.2": "0.15.0",
			"0.1.3": "0.15.0",
		});
		expect(readFileSync(path.join(directory, "versions.json"), "utf8")).toBe(firstRun);
	});
});
