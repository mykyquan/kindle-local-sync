import { chmod, mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Vault } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	createContentImage,
	createExpectedStateMutationSha256,
	journalFilename,
	pendingSentinelFilename,
} from "./Evidence";
import { writePendingSentinel, writeRecoveryJournal } from "./EvidenceStore";

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

describe("immutable evidence stores", () => {
	it("writes and verifies a full journal under identity-only path segments", async () => {
		const recoveryRoot = await createRecoveryRoot();
		const journal = createJournal();

		await expect(writeRecoveryJournal({ recoveryRoot, journal })).resolves.toEqual(journal);
		const transactionDirectory = join(
			recoveryRoot,
			"profiles",
			PROFILE_ID,
			"origins",
			ORIGIN_ID,
			"vaults",
			VAULT_ID,
			"transactions",
			TRANSACTION_ID
		);
		expect(await readdir(transactionDirectory)).toEqual([journalFilename(journal)]);
		expect(await readFile(join(transactionDirectory, journalFilename(journal)), "utf8"))
			.toContain("Complete private recovery copy");
	});

	it("leaves an existing immutable journal untouched on exclusive-create conflict", async () => {
		const recoveryRoot = await createRecoveryRoot();
		const journal = createJournal();

		await writeRecoveryJournal({ recoveryRoot, journal });
		await expect(writeRecoveryJournal({ recoveryRoot, journal }))
			.rejects.toMatchObject({ code: "exclusive-create-conflict" });
	});

	it("creates only the approved non-content config sentinel and verifies through the adapter", async () => {
		const vaultRoot = await createTempDirectory();
		const configDir = ".vault-config";
		const configRoot = join(vaultRoot, configDir);
		await chmod(vaultRoot, 0o700);
		const read = vi.fn(async (vaultPath: string) => readFile(join(vaultRoot, vaultPath), "utf8"));
		const vault = {
			configDir,
			adapter: {
				getFullPath: (vaultPath: string) => join(vaultRoot, vaultPath),
				read,
			},
		} as unknown as Vault;
		const pending = createPending();

		await expect(writePendingSentinel(vault, pending)).resolves.toEqual(pending);
		expect(await readdir(configRoot)).toEqual([pendingSentinelFilename(pending)]);
		expect(read).toHaveBeenCalledWith(`${vault.configDir}/${pendingSentinelFilename(pending)}`);
		expect((await readdir(vaultRoot, { recursive: true })).map(String)).not.toContain("data.json");
		expect((await readdir(vaultRoot, { recursive: true })).map(String).some((path) => path.endsWith(".md"))).toBe(false);
	});
});

function createPending(): PendingSentinelEvidence {
	return {
		schema: "kindle-local-sync.pending",
		version: 1,
		transactionId: TRANSACTION_ID,
		originInstanceId: ORIGIN_ID,
		vaultId: VAULT_ID,
		journalSha256: "a".repeat(64),
	};
}

function createJournal(): RecoveryJournalEvidence {
	const preimage = createContentImage("{\"old\":true}");
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
			postimage: createContentImage("Complete private recovery copy"),
			expectedMutationSha256: createExpectedStateMutationSha256(
				preimage,
				createContentImage("Complete private recovery copy")
			),
		},
		strongIds: [],
		legacyIds: [],
	};
}

async function createTempDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "kls-evidence-store-"));
	temporaryDirectories.push(directory);
	await chmod(directory, 0o700);
	return directory;
}

async function createRecoveryRoot(): Promise<string> {
	return join(await createTempDirectory(), "Kindle Local Sync", "recovery-v1");
}
