import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Vault } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	MAX_JOURNAL_BYTES,
	MAX_RECOVERY_STORE_BYTES,
	createContentImage,
	createExpectedStateMutationSha256,
	createOriginIdentity,
	createProfileIdentity,
	createVaultIdentity,
	encodeEvidence,
	originIdentityFilename,
	pendingSentinelFilename,
	profileIdentityFilename,
	vaultIdentityFilename,
} from "./Evidence";
import { writeRecoveryJournal } from "./EvidenceStore";
import { inspectDurabilityFoundation } from "./Foundation";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN_ID = "22222222-2222-4222-8222-222222222222";
const VAULT_ID = "33333333-3333-4333-8333-333333333333";
const TRANSACTION_ID = "44444444-4444-4444-8444-444444444444";
const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("startup foundation scanner", () => {
	it("allows the current writer only when capabilities are complete and no evidence exists", async () => {
		const fixture = await createFixture();
		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: true,
			classification: { kind: "no-evidence", status: "clear" },
		});
	});

	it("blocks malformed KLS-shaped config evidence without modifying it", async () => {
		const fixture = await createFixture();
		const corruptPath = join(fixture.configRoot, `kindle-local-sync.pending.v1.${"0".repeat(64)}.json`);
		await writeFile(corruptPath, "{\"truncated\":", { mode: 0o600 });

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "corrupt-evidence", status: "blocked" },
		});
		expect(await readFile(corruptPath, "utf8")).toBe("{\"truncated\":");
	});

	it("finds a matching local journal and pending sentinel and requires reconciliation", async () => {
		const fixture = await createFixture();
		await writeIdentityFixture(fixture);
		const journal = createJournal();
		await writeRecoveryJournal({ recoveryRoot: fixture.recoveryRoot, journal });
		const journalDigest = encodeEvidence(journal).sha256;
		const pending: PendingSentinelEvidence = {
			schema: "kindle-local-sync.pending",
			version: 1,
			transactionId: TRANSACTION_ID,
			originInstanceId: ORIGIN_ID,
			vaultId: VAULT_ID,
			journalSha256: journalDigest,
		};
		await writeFile(
			join(fixture.configRoot, pendingSentinelFilename(pending)),
			encodeEvidence(pending).bytes,
			{ mode: 0o600 }
		);

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "matching-journal-pending", status: "reconciliation-required" },
		});
	});

	it("fails closed instead of regenerating missing identity evidence around a transaction", async () => {
		const fixture = await createFixture();
		const journal = createJournal();
		const journalDigest = encodeEvidence(journal).sha256;
		const pending: PendingSentinelEvidence = {
			schema: "kindle-local-sync.pending",
			version: 1,
			transactionId: TRANSACTION_ID,
			originInstanceId: ORIGIN_ID,
			vaultId: VAULT_ID,
			journalSha256: journalDigest,
		};
		await writeFile(
			join(fixture.configRoot, pendingSentinelFilename(pending)),
			encodeEvidence(pending).bytes,
			{ mode: 0o600 }
		);

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "identity-conflict", status: "blocked" },
		});
	});

	it("does not broaden a missing profile identity scan into unrelated profiles", async () => {
		const fixture = await createFixture();
		const unrelatedRoot = join(
			fixture.recoveryRoot,
			"profiles",
			"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			"origins",
			"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			"vaults",
			"cccccccc-cccc-4ccc-8ccc-cccccccccccc"
		);
		await mkdir(unrelatedRoot, { recursive: true, mode: 0o700 });
		await writeFile(
			join(unrelatedRoot, `kindle-local-sync.journal.v1.${"0".repeat(64)}.json`),
			"not-json",
			{ mode: 0o600 }
		);

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "identity-conflict", status: "blocked" },
		});
		expect(result.classification?.issues).not.toContainEqual(
			expect.objectContaining({ kind: "corrupt-evidence" })
		);
	});

	it("does not let an unrelated vault journal collide with the current vault", async () => {
		const fixture = await createFixture();
		await writeIdentityFixture(fixture);
		const unrelatedJournal = createJournal({ vaultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
		await writeRecoveryJournal({ recoveryRoot: fixture.recoveryRoot, journal: unrelatedJournal });

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: true,
			classification: { kind: "no-evidence", status: "clear" },
		});
	});

	it("fails closed for unsafe identity directory and file permissions", async () => {
		for (const unsafeTarget of ["directory", "file"] as const) {
			const fixture = await createFixture();
			await writeIdentityFixture(fixture);
			const profile = createProfileIdentity(PROFILE_ID);
			const profileRoot = join(fixture.userDataPath, "kindle-local-sync");
			await chmod(
				unsafeTarget === "directory"
					? profileRoot
					: join(profileRoot, profileIdentityFilename(profile)),
				0o755
			);

			const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);
			expect(result).toMatchObject({
				writeAllowed: false,
				classification: { kind: "corrupt-evidence", status: "blocked" },
			});
		}
	});

	it("rejects a symlinked identity directory during startup", async () => {
		const fixture = await createFixture();
		const outside = await createTempDirectory();
		await symlink(outside, join(fixture.userDataPath, "kindle-local-sync"), "dir");

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "corrupt-evidence", status: "blocked" },
		});
	});

	it("rejects adapter evidence paths that escape the vault root", async () => {
		const fixture = await createFixture();
		const outside = await createTempDirectory();
		const filename = `kindle-local-sync.pending.v1.${"0".repeat(64)}.json`;
		await writeFile(join(fixture.configRoot, filename), "{}", { mode: 0o600 });
		const outsidePath = join(outside, filename);
		await writeFile(outsidePath, "{}", { mode: 0o600 });
		const adapter = fixture.vault.adapter as unknown as { getFullPath(path: string): string };
		const originalGetFullPath = adapter.getFullPath.bind(adapter);
		adapter.getFullPath = (path: string) => path.endsWith(filename) ? outsidePath : originalGetFullPath(path);

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "corrupt-evidence", status: "blocked" },
		});
	});

	it("rejects oversized individual journal evidence before reading it", async () => {
		const fixture = await createFixture();
		await writeIdentityFixture(fixture);
		const journalRoot = currentJournalRoot(fixture);
		await mkdir(journalRoot, { recursive: true, mode: 0o700 });
		const path = join(journalRoot, `kindle-local-sync.journal.v1.${"a".repeat(64)}.json`);
		await writeFile(path, "", { mode: 0o600 });
		await truncate(path, MAX_JOURNAL_BYTES + 1);

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "corrupt-evidence", status: "blocked" },
		});
	});

	it("enforces the aggregate evidence limit before loading journal contents", async () => {
		const fixture = await createFixture();
		await writeIdentityFixture(fixture);
		const journalRoot = currentJournalRoot(fixture);
		await mkdir(journalRoot, { recursive: true, mode: 0o700 });
		for (let index = 0; index < 5; index += 1) {
			const path = join(
				journalRoot,
				`kindle-local-sync.journal.v1.${index.toString(16).padStart(64, "0")}.json`
			);
			await writeFile(path, "", { mode: 0o600 });
			await truncate(path, index < 4 ? MAX_JOURNAL_BYTES : 1);
		}

		const result = await inspectDurabilityFoundation(fixture.vault, fixture.options);

		expect(MAX_RECOVERY_STORE_BYTES).toBe(4 * MAX_JOURNAL_BYTES);
		expect(result).toMatchObject({
			writeAllowed: false,
			classification: { kind: "corrupt-evidence", status: "blocked" },
		});
	});
});

async function createFixture() {
	const vaultRoot = await createTempDirectory();
	const recoveryContainer = await createTempDirectory();
	const recoveryRoot = join(recoveryContainer, "Kindle Local Sync", "recovery-v1");
	const userDataPath = await createTempDirectory();
	const configDir = ".vault-config";
	const configRoot = join(vaultRoot, configDir);
	await mkdir(configRoot, { mode: 0o700 });
	const adapter = {
		exists: vi.fn(async () => true),
		getFullPath: (path: string) => join(vaultRoot, path),
		list: vi.fn(async (path: string) => {
			const entries = await readdir(join(vaultRoot, path), { withFileTypes: true });
			return {
				files: entries.filter((entry) => entry.isFile()).map((entry) => `${path}/${entry.name}`),
				folders: entries.filter((entry) => entry.isDirectory()).map((entry) => `${path}/${entry.name}`),
			};
		}),
		mkdir: vi.fn(),
		read: vi.fn(async (path: string) => readFile(join(vaultRoot, path), "utf8")),
		remove: vi.fn(),
		write: vi.fn(),
	};
	const vault = { configDir, adapter, process: vi.fn() } as unknown as Vault;
	const noop = vi.fn();
	return {
		vault,
		configRoot,
		recoveryRoot,
		userDataPath,
		options: {
			capabilityOverrides: {
				platform: "darwin",
				homeDirectory: "/Users/reader",
				environment: {},
				open: noop,
				readFile: noop,
				readdir: noop,
				lstat: noop,
				realpath: noop,
				mkdir: noop,
				statfs: noop,
				discoverUserDataPath: () => userDataPath,
				resolveRecoveryRoot: async () => recoveryRoot,
			},
		},
	};
}

async function writeIdentityFixture(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<void> {
	const profile = createProfileIdentity(PROFILE_ID);
	const origin = createOriginIdentity(PROFILE_ID, ORIGIN_ID);
	const vault = createVaultIdentity(VAULT_ID);
	const profileRoot = join(fixture.userDataPath, "kindle-local-sync");
	const originRoot = join(fixture.recoveryRoot, "profiles", PROFILE_ID);
	await mkdir(profileRoot, { recursive: true, mode: 0o700 });
	await mkdir(originRoot, { recursive: true, mode: 0o700 });
	await writeFile(join(profileRoot, profileIdentityFilename(profile)), encodeEvidence(profile).bytes, { mode: 0o600 });
	await writeFile(join(originRoot, originIdentityFilename(origin)), encodeEvidence(origin).bytes, { mode: 0o600 });
	await writeFile(join(fixture.configRoot, vaultIdentityFilename(vault)), encodeEvidence(vault).bytes, { mode: 0o600 });
}

function currentJournalRoot(fixture: Awaited<ReturnType<typeof createFixture>>): string {
	return join(
		fixture.recoveryRoot,
		"profiles",
		PROFILE_ID,
		"origins",
		ORIGIN_ID,
		"vaults",
		VAULT_ID
	);
}

function createJournal(overrides: Partial<RecoveryJournalEvidence> = {}): RecoveryJournalEvidence {
	const preimage = createContentImage("{\"old\":true}");
	const postimage = createContentImage("{\"new\":true}");
	return {
		schema: "kindle-local-sync.journal",
		version: 1,
		transactionId: TRANSACTION_ID,
		profileId: PROFILE_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		operation: "settings-mutation",
		createdAt: "2099-01-01T00:00:00.000Z",
		note: null,
		state: {
			preimage,
			postimage,
			expectedMutationSha256: createExpectedStateMutationSha256(preimage, postimage),
		},
		strongIds: [],
		legacyIds: [],
		...overrides,
	};
}

async function createTempDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "kls-foundation-"));
	temporaryDirectories.push(directory);
	await chmod(directory, 0o700);
	return directory;
}
