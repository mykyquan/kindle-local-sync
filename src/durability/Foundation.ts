import { lstat, readdir } from "fs/promises";
import { basename, join } from "path";
import process from "process";
import type { Vault } from "obsidian";
import {
	CompletionReceiptEvidence,
	InvalidEvidenceError,
	MAX_JOURNAL_BYTES,
	MAX_METADATA_EVIDENCE_BYTES,
	MAX_RECOVERY_STORE_BYTES,
	PendingSentinelEvidence,
	RecoveryJournalEvidence,
	encodeEvidence,
	parseCompletionReceipt,
	parsePendingSentinel,
	parseRecoveryJournal,
} from "./Evidence";
import {
	RawIdentityFile,
	resolveOriginIdentity,
	resolveProfileIdentity,
	resolveVaultIdentity,
} from "./Identity";
import {
	CapabilityDependencies,
	DurabilityCapabilityResult,
	createCapabilityMessage,
	detectDurabilityCapabilities,
} from "./RuntimeCapabilities";
import {
	ScannedEvidence,
	StartupEvidenceClassification,
	classifyStartupEvidence,
	planReceiptRetention,
} from "./StartupEvidence";
import {
	RecoveryStorageError,
	assertSecurePrivateDescendantPath,
	readSecureBoundedFile,
	resolveContainedPath,
	validatePosixOwnershipAndMode,
} from "./RecoveryStorage";

const KLS_EVIDENCE_PREFIX = "kindle-local-sync.";

export interface DurabilityFoundationResult {
	writeAllowed: boolean;
	message: string;
	capabilities: DurabilityCapabilityResult;
	classification?: StartupEvidenceClassification;
}

export interface FoundationOptions {
	capabilityOverrides?: Partial<CapabilityDependencies>;
	artifactStatusByTransactionId?: Readonly<Record<string, "matched" | "not-arrived" | "conflicting" | "unknown" | undefined>>;
}

export async function inspectDurabilityFoundation(
	vault: Vault,
	options: FoundationOptions = {}
): Promise<DurabilityFoundationResult> {
	const capabilities = await detectDurabilityCapabilities(vault, options.capabilityOverrides);
	if (!capabilities.supported || !capabilities.canonicalRecoveryRoot) {
		return { writeAllowed: false, message: createCapabilityMessage(capabilities), capabilities };
	}

	try {
		const scanned = await scanStartupEvidence(
			vault,
			capabilities.canonicalRecoveryRoot,
			capabilities.userDataPath,
			capabilities.platform
		);
		const profileIdentity = resolveProfileIdentity(scanned.profileIdentityFiles);
		const originIdentity = profileIdentity.status === "valid"
			? resolveOriginIdentity(scanned.originIdentityFiles, profileIdentity.evidence.profileId)
			: resolveOriginIdentity(scanned.originIdentityFiles);
		const vaultIdentity = resolveVaultIdentity(scanned.vaultIdentityFiles);
		const hasTransactionEvidence = scanned.pending.length > 0 || scanned.receipts.length > 0 || scanned.journals.length > 0;
		const identityConflict = [profileIdentity, originIdentity, vaultIdentity].some((identity) =>
			identity.status === "conflicting" || identity.status === "corrupt"
		) || scanned.identityDiscoveryUnsafe || hasTransactionEvidence && [profileIdentity, originIdentity, vaultIdentity].some((identity) =>
			identity.status === "missing"
		);
		const vaultId = vaultIdentity.status === "valid" ? vaultIdentity.evidence.vaultId : undefined;
		const originInstanceId = originIdentity.status === "valid"
			? originIdentity.evidence.originInstanceId
			: undefined;
		const retention = planReceiptRetention({
			receipts: scanned.receipts.map((receipt) => ({
				filename: receipt.filename,
				transactionId: receipt.body.transactionId,
				completedAt: receipt.body.completedAt,
			})),
			pendingTransactionIds: new Set(scanned.pending.map((entry) => entry.body.transactionId)),
			now: new Date(),
		});
		const classification = classifyStartupEvidence({
			vaultId,
			originInstanceId,
			identityConflict,
			corruptEvidenceFilenames: scanned.corruptEvidenceFilenames,
			journals: scanned.journals,
			pending: scanned.pending,
			receipts: scanned.receipts,
			artifactStatusByTransactionId: options.artifactStatusByTransactionId ?? {},
			receiptCapacityReached: !retention.canStartNewTransaction,
		});
		return {
			writeAllowed: classification.status === "clear",
			message: createClassificationMessage(classification),
			capabilities,
			classification,
		};
	} catch (error) {
		console.error("Failed to inspect Kindle Local Sync recovery evidence.", error);
		return {
			writeAllowed: false,
			message: "Kindle Local Sync found recovery evidence it could not safely verify. No notes or settings were changed.",
			capabilities,
			classification: {
				kind: "corrupt-evidence",
				status: "blocked",
				issues: [{ kind: "corrupt-evidence", filenames: [] }],
				originInstanceIds: [],
				completedTransactionIds: [],
			},
		};
	}
}

export function createClassificationMessage(classification: StartupEvidenceClassification): string {
	if (classification.status === "clear") {
		return "Kindle Local Sync recovery evidence is clear.";
	}
	const origin = classification.originInstanceIds[0];
	const originText = origin ? ` Origin: ${origin}.` : "";
	if (classification.kind === "pending-without-local-journal") {
		return `Kindle Local Sync recovery is pending on another device or profile.${originText} Finish recovery there before syncing here.`;
	}
	if (classification.kind === "matching-journal-pending") {
		return `Kindle Local Sync must finish a local recovery before it can write.${originText}`;
	}
	if (classification.kind === "receipt-retention-exhausted") {
		return "Kindle Local Sync retained the maximum safe number of completion receipts. No new transaction can start until an eligible receipt is cleaned up.";
	}
	return `Kindle Local Sync found unresolved or conflicting recovery evidence.${originText} No notes or settings were changed.`;
}

async function scanStartupEvidence(
	vault: Vault,
	recoveryRoot: string,
	userDataPath: string | undefined,
	platform: string
): Promise<{
	pending: ScannedEvidence<PendingSentinelEvidence>[];
	receipts: ScannedEvidence<CompletionReceiptEvidence>[];
	journals: ScannedEvidence<RecoveryJournalEvidence>[];
	vaultIdentityFiles: RawIdentityFile[];
	profileIdentityFiles: RawIdentityFile[];
	originIdentityFiles: RawIdentityFile[];
	corruptEvidenceFilenames: string[];
	identityDiscoveryUnsafe: boolean;
}> {
	const pending: ScannedEvidence<PendingSentinelEvidence>[] = [];
	const receipts: ScannedEvidence<CompletionReceiptEvidence>[] = [];
	const journals: ScannedEvidence<RecoveryJournalEvidence>[] = [];
	const vaultIdentityFiles: RawIdentityFile[] = [];
	const corruptEvidenceFilenames: string[] = [];
	let aggregateBytes = 0;
	const readEvidence = async (options: {
		rootPath: string;
		filePath: string;
		maxBytes: number;
		verifyPrivateParentMode: boolean;
		privateRootPath?: string;
	}): Promise<string> => {
		const result = await readSecureBoundedFile({
			...options,
			platform,
			remainingAggregateBytes: MAX_RECOVERY_STORE_BYTES - aggregateBytes,
		});
		aggregateBytes += result.size;
		return result.bytes;
	};

	const profileDirectory = join(userDataPath ?? "", "kindle-local-sync");
	const profileScan = userDataPath
		? await readIdentityFiles({
			directory: profileDirectory,
			prefix: "kindle-local-sync.profile.v1.",
			platform,
			privateRootPath: profileDirectory,
			readEvidence,
		})
		: { files: [], exists: false };
	const profileIdentityFiles = profileScan.files;
	let originIdentityFiles: RawIdentityFile[] = [];
	const profileIdentity = resolveProfileIdentity(profileIdentityFiles);
	let originDirectoryExists = false;
	if (profileIdentity.status === "valid") {
		const originDirectory = resolveContainedPath(
			recoveryRoot,
			"profiles",
			profileIdentity.evidence.profileId
		);
		const originScan = await readIdentityFiles({
			directory: originDirectory,
			prefix: "kindle-local-sync.origin.v1.",
			platform,
			privateRootPath: recoveryRoot,
			readEvidence,
		});
		originIdentityFiles = originScan.files;
		originDirectoryExists = originScan.exists;
	}

	const configDir = vault.configDir;
	const adapter = vault.adapter as unknown as {
		getFullPath(path: string): string;
		list(path: string): Promise<{ files: string[]; folders: string[] }>;
	};
	const configListing = await adapter.list(configDir);
	const vaultRootPath = adapter.getFullPath("");
	for (const path of configListing.folders) {
		const filename = basename(path);
		if (filename.startsWith(KLS_EVIDENCE_PREFIX)) {
			corruptEvidenceFilenames.push(filename);
		}
	}

	for (const path of configListing.files) {
		const filename = basename(path);
		if (!filename.startsWith(KLS_EVIDENCE_PREFIX)) {
			continue;
		}
		let bytes: string;
		try {
			bytes = await readEvidence({
				rootPath: vaultRootPath,
				filePath: adapter.getFullPath(path),
				maxBytes: MAX_METADATA_EVIDENCE_BYTES,
				verifyPrivateParentMode: false,
			});
		} catch {
			corruptEvidenceFilenames.push(filename);
			continue;
		}
		try {
			if (filename.startsWith("kindle-local-sync.pending.v1.")) {
				const body = parsePendingSentinel(filename, bytes);
				pending.push({ filename, sha256: encodeEvidence(body).sha256, body });
			} else if (filename.startsWith("kindle-local-sync.completed.v1.")) {
				const body = parseCompletionReceipt(filename, bytes);
				receipts.push({ filename, sha256: encodeEvidence(body).sha256, body });
			} else if (filename.startsWith("kindle-local-sync.vault.v1.")) {
				vaultIdentityFiles.push({ filename, bytes });
			} else {
				corruptEvidenceFilenames.push(filename);
			}
		} catch (error) {
			if (!(error instanceof InvalidEvidenceError)) {
				throw error;
			}
			corruptEvidenceFilenames.push(filename);
		}
	}

	const originIdentity = profileIdentity.status === "valid"
		? resolveOriginIdentity(originIdentityFiles, profileIdentity.evidence.profileId)
		: resolveOriginIdentity(originIdentityFiles);
	const vaultIdentity = resolveVaultIdentity(vaultIdentityFiles);
	const recoveryRootExists = await inspectDirectoryIfPresent(recoveryRoot, platform);
	const hasConfigEvidence = pending.length > 0
		|| receipts.length > 0
		|| vaultIdentityFiles.length > 0
		|| corruptEvidenceFilenames.length > 0;
	const hasMissingIdentity = [profileIdentity, originIdentity, vaultIdentity]
		.some((identity) => identity.status === "missing");
	// A completely absent store is the only missing-identity state that proves there is no evidence to target.
	const identityDiscoveryUnsafe = hasMissingIdentity && (
		recoveryRootExists
		|| profileScan.exists
		|| originDirectoryExists
		|| hasConfigEvidence
	);

	if (profileIdentity.status === "valid"
		&& originIdentity.status === "valid"
		&& vaultIdentity.status === "valid") {
		const journalSearchRoot = resolveContainedPath(
			recoveryRoot,
			"profiles",
			profileIdentity.evidence.profileId,
			"origins",
			originIdentity.evidence.originInstanceId,
			"vaults",
			vaultIdentity.evidence.vaultId
		);
		for (const path of await listFilesRecursively({
			recoveryRoot,
			directory: journalSearchRoot,
			platform,
			remainingAggregateBytes: MAX_RECOVERY_STORE_BYTES - aggregateBytes,
		})) {
			const filename = basename(path);
			if (!filename.startsWith("kindle-local-sync.journal.")) {
				if (filename.startsWith(KLS_EVIDENCE_PREFIX)) {
					corruptEvidenceFilenames.push(filename);
				}
				continue;
			}
			try {
				const bytes = await readEvidence({
					rootPath: recoveryRoot,
					filePath: path,
					maxBytes: MAX_JOURNAL_BYTES,
					verifyPrivateParentMode: true,
					privateRootPath: recoveryRoot,
				});
				const body = parseRecoveryJournal(filename, bytes);
				journals.push({ filename, sha256: encodeEvidence(body).sha256, body });
			} catch (error) {
				if (!(error instanceof InvalidEvidenceError)) {
					throw error;
				}
				corruptEvidenceFilenames.push(filename);
			}
		}
	}

	return {
		pending: pending.sort(compareEvidence),
		receipts: receipts.sort(compareEvidence),
		journals: journals.sort(compareEvidence),
		vaultIdentityFiles,
		profileIdentityFiles,
		originIdentityFiles,
		corruptEvidenceFilenames: corruptEvidenceFilenames.sort(),
		identityDiscoveryUnsafe,
	};
}

async function readIdentityFiles(options: {
	directory: string;
	prefix: string;
	platform: string;
	privateRootPath: string;
	readEvidence: (options: {
		rootPath: string;
		filePath: string;
		maxBytes: number;
		verifyPrivateParentMode: boolean;
		privateRootPath?: string;
	}) => Promise<string>;
}): Promise<{ files: RawIdentityFile[]; exists: boolean }> {
	try {
		await assertSecurePrivateDescendantPath(
			options.privateRootPath,
			options.directory,
			options.platform
		);
		const files: RawIdentityFile[] = [];
		for (const entry of await readdir(options.directory, { withFileTypes: true })) {
			if (!entry.name.startsWith(KLS_EVIDENCE_PREFIX)) {
				continue;
			}
			if (!entry.isFile() || !entry.name.startsWith(options.prefix)) {
				throw new RecoveryStorageError("non-regular-file");
			}
			const filePath = join(options.directory, entry.name);
			files.push({
				filename: entry.name,
				bytes: await options.readEvidence({
					rootPath: options.privateRootPath,
					filePath,
					maxBytes: MAX_METADATA_EVIDENCE_BYTES,
					verifyPrivateParentMode: true,
					privateRootPath: options.privateRootPath,
				}),
			});
		}
		return {
			files: files.sort((first, second) => first.filename.localeCompare(second.filename)),
			exists: true,
		};
	} catch (error) {
		if (isMissingPathError(error)) {
			return { files: [], exists: false };
		}
		throw error;
	}
}

async function listFilesRecursively(options: {
	recoveryRoot: string;
	directory: string;
	platform: string;
	remainingAggregateBytes: number;
	state?: { evidenceBytes: number };
}): Promise<string[]> {
	const state = options.state ?? { evidenceBytes: 0 };
	try {
		await assertSecurePrivateDescendantPath(
			options.recoveryRoot,
			options.directory,
			options.platform
		);
	} catch (error) {
		if (isMissingPathError(error)) {
			return [];
		}
		throw error;
	}
	const files: string[] = [];
	for (const entry of await readdir(options.directory, { withFileTypes: true })) {
		const path = join(options.directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new RecoveryStorageError("symlink-or-junction");
		}
		if (entry.isDirectory()) {
			files.push(...await listFilesRecursively({ ...options, directory: path, state }));
		} else if (entry.isFile()) {
			const info = await lstat(path);
			if (info.isSymbolicLink() || !info.isFile()) {
				throw new RecoveryStorageError("non-regular-file");
			}
			if (options.platform !== "win32") {
				validatePosixOwnershipAndMode(info.uid, info.mode, false, process.getuid?.());
			}
			if (entry.name.startsWith(KLS_EVIDENCE_PREFIX)) {
				const individualLimit = entry.name.startsWith("kindle-local-sync.journal.")
					? MAX_JOURNAL_BYTES
					: MAX_METADATA_EVIDENCE_BYTES;
				if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > individualLimit) {
					throw new RecoveryStorageError("evidence-too-large");
				}
				state.evidenceBytes += info.size;
				if (state.evidenceBytes > options.remainingAggregateBytes) {
					throw new RecoveryStorageError("recovery-store-too-large");
				}
			}
			files.push(path);
		} else {
			throw new RecoveryStorageError("non-regular-file");
		}
	}
	return files;
}

async function inspectDirectoryIfPresent(path: string, platform: string): Promise<boolean> {
	try {
		await assertSecurePrivateDescendantPath(path, path, platform);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function compareEvidence<T>(first: ScannedEvidence<T>, second: ScannedEvidence<T>): number {
	return first.filename.localeCompare(second.filename);
}

function isMissingPathError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
