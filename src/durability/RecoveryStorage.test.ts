import { chmod, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MAX_JOURNAL_BYTES,
	MAX_RECOVERY_STORE_BYTES,
	createProfileIdentity,
	encodeEvidence,
	parseProfileIdentity,
	profileIdentityFilename,
} from "./Evidence";
import {
	RecoveryStorageError,
	assertSecureDirectory,
	assertSecureDescendantPath,
	assertSecurePrivateDescendantPath,
	checkJournalStorageBudget,
	prepareSecureRecoveryRoot,
	readSecureBoundedFile,
	resolveContainedPath,
	selectRecoveryRoot,
	validatePosixOwnershipAndMode,
	validateSha256PathSegment,
	validateUuidPathSegment,
	writeImmutableFile,
} from "./RecoveryStorage";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("recovery root selection", () => {
	it("selects the approved macOS Application Support root", () => {
		expect(selectRecoveryRoot({ platform: "darwin", homeDirectory: "/Users/reader", environment: {} }).rootPath)
			.toBe("/Users/reader/Library/Application Support/Kindle Local Sync/recovery-v1");
	});

	it("selects Windows LocalAppData and never roaming AppData", () => {
		const selected = selectRecoveryRoot({
			platform: "win32",
			homeDirectory: "C:\\Users\\reader",
			environment: {
				LOCALAPPDATA: "C:\\Users\\reader\\AppData\\Local",
				APPDATA: "C:\\Users\\reader\\AppData\\Roaming",
			},
		});

		expect(selected.rootPath).toBe("C:\\Users\\reader\\AppData\\Local\\Kindle Local Sync\\recovery-v1");
		expect(selected.rootPath).not.toContain("Roaming");
	});

	it("selects Linux XDG state and the approved home fallback", () => {
		expect(selectRecoveryRoot({
			platform: "linux",
			homeDirectory: "/home/reader",
			environment: { XDG_STATE_HOME: "/state/reader" },
		}).rootPath).toBe("/state/reader/kindle-local-sync/recovery-v1");
		expect(selectRecoveryRoot({
			platform: "linux",
			homeDirectory: "/home/reader",
			environment: {},
		}).rootPath).toBe("/home/reader/.local/state/kindle-local-sync/recovery-v1");
	});

	it("rejects missing, relative, and escaping roots", () => {
		expectStorageFailure(
			() => selectRecoveryRoot({ platform: "win32", homeDirectory: "C:\\Users\\reader", environment: {} }),
			"missing-local-app-data"
		);
		expectStorageFailure(() => selectRecoveryRoot({
			platform: "win32",
			homeDirectory: "C:\\Users\\reader",
			environment: { LOCALAPPDATA: "..\\Roaming" },
		}), "invalid-local-app-data");
		expectStorageFailure(() => selectRecoveryRoot({
			platform: "linux",
			homeDirectory: "/home/reader",
			environment: { XDG_STATE_HOME: "../state" },
		}), "invalid-xdg-state-home");
		expectStorageFailure(() => selectRecoveryRoot({
			platform: "darwin",
			homeDirectory: "/Users/reader/../other",
			environment: {},
		}), "invalid-home-directory");
	});
});

describe("path and filesystem security", () => {
	it("accepts only canonical UUID and lowercase digest path segments", () => {
		expect(validateUuidPathSegment(PROFILE_ID)).toBe(PROFILE_ID);
		expect(validateSha256PathSegment("a".repeat(64))).toBe("a".repeat(64));
		expect(() => validateUuidPathSegment(`../${PROFILE_ID}`)).toThrow(RecoveryStorageError);
		expect(() => validateSha256PathSegment("A".repeat(64))).toThrow(RecoveryStorageError);
		expectStorageFailure(() => resolveContainedPath("/safe/root", "..", "escape"), "invalid-path-segment");
	});

	it("rejects symlinks or junction-like descendants", async () => {
		const root = await createSecureTempDirectory();
		const outside = await createSecureTempDirectory();
		await symlink(outside, join(root, "linked"), "dir");

		await expect(assertSecureDescendantPath(root, join(root, "linked", "journal.json")))
			.rejects.toMatchObject({ code: "symlink-or-junction" });
	});

	it("validates POSIX owner and mode independently", () => {
		expect(() => validatePosixOwnershipAndMode(501, 0o100600, false, 501)).not.toThrow();
		expectStorageFailure(() => validatePosixOwnershipAndMode(502, 0o100600, false, 501), "unsafe-posix-owner");
		expectStorageFailure(() => validatePosixOwnershipAndMode(501, 0o100644, false, 501), "unsafe-posix-mode");
		expectStorageFailure(() => validatePosixOwnershipAndMode(501, 0o40755, true, 501), "unsafe-posix-mode");
	});

	it("rejects permissive KLS-owned ancestor directories on POSIX", async () => {
		const anchor = await createSecureTempDirectory();
		const ownedRoot = join(anchor, "owned");
		const nested = join(ownedRoot, "nested");
		await mkdir(nested, { recursive: true, mode: 0o700 });
		await chmod(ownedRoot, 0o755);

		await expect(assertSecurePrivateDescendantPath(ownedRoot, nested))
			.rejects.toMatchObject({ code: "unsafe-posix-mode" });
		await expect(assertSecureDirectory(ownedRoot, "win32")).resolves.toBeUndefined();
	});

	it("creates, flushes, verifies, and never overwrites immutable evidence", async () => {
		const root = await createSecureTempDirectory();
		const evidence = createProfileIdentity(PROFILE_ID);
		const encoded = encodeEvidence(evidence);
		const filename = profileIdentityFilename(evidence);
		const filePath = join(root, filename);

		await expect(writeImmutableFile({
			rootPath: root,
			filePath,
			evidence: encoded,
			validateReadback: parseProfileIdentity,
		})).resolves.toEqual(evidence);
		await expect(writeImmutableFile({
			rootPath: root,
			filePath,
			evidence: encoded,
			validateReadback: parseProfileIdentity,
		})).rejects.toMatchObject({ code: "exclusive-create-conflict" });
	});

	it("fails closed when an evidence file changes size during its read", async () => {
		const root = await createSecureTempDirectory();
		const filePath = join(root, "evidence.json");
		await writeFile(filePath, "safe", { mode: 0o600 });
		const changingRead = (async () => {
			const bytes = await readFile(filePath, "utf8");
			await writeFile(filePath, "!", { flag: "a" });
			return bytes;
		}) as unknown as typeof readFile;

		await expect(readSecureBoundedFile({
			rootPath: root,
			filePath,
			maxBytes: 1024,
			readFileFn: changingRead,
		})).rejects.toMatchObject({ code: "file-changed-during-read" });
	});
});

describe("storage limits", () => {
	it("rejects journals over 64 MiB before inspecting storage", async () => {
		await expect(checkJournalStorageBudget("/not-used", MAX_JOURNAL_BYTES + 1))
			.rejects.toMatchObject({ code: "journal-too-large" });
	});

	it("counts every file and rejects a projected total above 256 MiB", async () => {
		const root = await createSecureTempDirectory();
		const sparseFile = join(root, "existing.bin");
		await writeFile(sparseFile, "", { mode: 0o600 });
		await truncate(sparseFile, MAX_RECOVERY_STORE_BYTES);

		await expect(checkJournalStorageBudget(root, 1))
			.rejects.toMatchObject({ code: "recovery-store-too-large" });
	});

	it("blocks when statfs is missing, inconclusive, or reports insufficient space", async () => {
		const root = await createSecureTempDirectory();

		await expect(checkJournalStorageBudget(root, 1, null))
			.rejects.toMatchObject({ code: "statfs-unavailable" });
		await expect(checkJournalStorageBudget(root, 1, async () => ({ bavail: Number.NaN, bsize: 1 }) as never))
			.rejects.toMatchObject({ code: "statfs-unavailable" });
		await expect(checkJournalStorageBudget(root, 1, async () => ({ bavail: 1, bsize: 1 }) as never))
			.rejects.toMatchObject({ code: "insufficient-free-space" });
	});
});

async function createSecureTempDirectory(): Promise<string> {
	const container = await mkdtemp(join(tmpdir(), "kls-durability-"));
	temporaryDirectories.push(container);
	await chmod(container, 0o700);
	const recoveryRoot = join(container, "Kindle Local Sync", "recovery-v1");
	await prepareSecureRecoveryRoot(recoveryRoot);
	return recoveryRoot;
}

function expectStorageFailure(action: () => unknown, code: RecoveryStorageError["code"]): void {
	try {
		action();
		throw new Error("Expected recovery storage validation to fail.");
	} catch (error) {
		expect(error).toBeInstanceOf(RecoveryStorageError);
		expect((error as RecoveryStorageError).code).toBe(code);
	}
}
