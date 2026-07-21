import { basename, dirname, join } from "path";
import { Buffer } from "buffer";
import type { Vault } from "obsidian";
import {
	CompletionReceiptEvidence,
	OriginIdentityEvidence,
	PendingSentinelEvidence,
	ProfileIdentityEvidence,
	RecoveryJournalEvidence,
	VaultIdentityEvidence,
	completionReceiptFilename,
	encodeEvidence,
	journalFilename,
	originIdentityFilename,
	parseCompletionReceipt,
	parseOriginIdentity,
	parsePendingSentinel,
	parseProfileIdentity,
	parseRecoveryJournal,
	parseVaultIdentity,
	pendingSentinelFilename,
	profileIdentityFilename,
	validateRecoveryJournal,
	vaultIdentityFilename,
} from "./Evidence";
import {
	checkJournalStorageBudget,
	prepareSecureRecoveryRoot,
	resolveContainedPath,
	validateUuidPathSegment,
	writeImmutableFile,
} from "./RecoveryStorage";

export async function writeRecoveryJournal(options: {
	recoveryRoot: string;
	journal: RecoveryJournalEvidence;
}): Promise<RecoveryJournalEvidence> {
	validateRecoveryJournal(options.journal);
	const encoded = encodeEvidence(options.journal);
	await prepareSecureRecoveryRoot(options.recoveryRoot);
	await checkJournalStorageBudget(options.recoveryRoot, Buffer.byteLength(encoded.bytes, "utf8"));
	const profileId = validateUuidPathSegment(options.journal.profileId);
	const originId = validateUuidPathSegment(options.journal.originInstanceId);
	const vaultId = validateUuidPathSegment(options.journal.vaultId);
	const transactionId = validateUuidPathSegment(options.journal.transactionId);
	const directory = resolveContainedPath(
		options.recoveryRoot,
		"profiles",
		profileId,
		"origins",
		originId,
		"vaults",
		vaultId,
		"transactions",
		transactionId
	);
	const filename = journalFilename(options.journal);
	return writeImmutableFile({
		rootPath: options.recoveryRoot,
		filePath: join(directory, filename),
		evidence: encoded,
		validateReadback: parseRecoveryJournal,
	});
}

export async function writeProfileIdentity(options: {
	userDataPath: string;
	evidence: ProfileIdentityEvidence;
}): Promise<ProfileIdentityEvidence> {
	const filename = profileIdentityFilename(options.evidence);
	const privateRootPath = join(options.userDataPath, "kindle-local-sync");
	return writeImmutableFile({
		rootPath: options.userDataPath,
		privateRootPath,
		filePath: join(privateRootPath, filename),
		evidence: encodeEvidence(options.evidence),
		validateReadback: parseProfileIdentity,
	});
}

export async function writeOriginIdentity(options: {
	recoveryRoot: string;
	evidence: OriginIdentityEvidence;
}): Promise<OriginIdentityEvidence> {
	await prepareSecureRecoveryRoot(options.recoveryRoot);
	const filename = originIdentityFilename(options.evidence);
	return writeImmutableFile({
		rootPath: options.recoveryRoot,
		filePath: resolveContainedPath(
			options.recoveryRoot,
			"profiles",
			validateUuidPathSegment(options.evidence.profileId),
			filename
		),
		evidence: encodeEvidence(options.evidence),
		validateReadback: parseOriginIdentity,
	});
}

export async function writeVaultIdentity(vault: Vault, evidence: VaultIdentityEvidence): Promise<VaultIdentityEvidence> {
	return writeVaultEvidence(vault, vaultIdentityFilename(evidence), encodeEvidence(evidence), parseVaultIdentity);
}

export async function writePendingSentinel(
	vault: Vault,
	evidence: PendingSentinelEvidence
): Promise<PendingSentinelEvidence> {
	return writeVaultEvidence(vault, pendingSentinelFilename(evidence), encodeEvidence(evidence), parsePendingSentinel);
}

export async function writeCompletionReceipt(
	vault: Vault,
	evidence: CompletionReceiptEvidence
): Promise<CompletionReceiptEvidence> {
	return writeVaultEvidence(vault, completionReceiptFilename(evidence), encodeEvidence(evidence), parseCompletionReceipt);
}

async function writeVaultEvidence<T>(
	vault: Vault,
	filename: string,
	encoded: ReturnType<typeof encodeEvidence<T>>,
	parse: (filename: string, bytes: string) => T
): Promise<T> {
	const adapter = vault.adapter as unknown as {
		getFullPath(normalizedPath: string): string;
		read(normalizedPath: string): Promise<string>;
	};
	const configRoot = adapter.getFullPath(vault.configDir);
	const vaultPath = `${vault.configDir}/${filename}`;
	const filePath = adapter.getFullPath(vaultPath);
	const result = await writeImmutableFile({
		rootPath: dirname(configRoot),
		filePath,
		evidence: encoded,
		validateReadback: parse,
		verifyPrivateParentMode: false,
	});
	const adapterReadback = await adapter.read(vaultPath);
	if (adapterReadback !== encoded.bytes) {
		throw new Error(`Vault evidence read-back mismatch for ${basename(filePath)}.`);
	}
	parse(filename, adapterReadback);
	return result;
}
