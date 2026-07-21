import { createHash, randomUUID } from "crypto";

export const EVIDENCE_VERSION = 1 as const;
export const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
export const MAX_RECOVERY_STORE_BYTES = 256 * 1024 * 1024;
export const MAX_METADATA_EVIDENCE_BYTES = 1024 * 1024;
export const RECOVERY_FREE_SPACE_RESERVE_BYTES = 16 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const NOTE_PATH_SEGMENT_PATTERN = /(^|\/)\.\.?($|\/)/;
const STRONG_CLIPPING_ID_PATTERN = /^kls2-[0-9a-f]{64}$/;
const LEGACY_CLIPPING_ID_PATTERN = /^kls-[a-z0-9]+$/;

export type TransactionOperation =
	| "managed-note-sync"
	| "ignore-cleanup"
	| "settings-mutation"
	| "collision-recovery";

export interface ProfileIdentityEvidence {
	schema: "kindle-local-sync.profile";
	version: 1;
	profileId: string;
}

export interface OriginIdentityEvidence {
	schema: "kindle-local-sync.origin";
	version: 1;
	profileId: string;
	originInstanceId: string;
}

export interface VaultIdentityEvidence {
	schema: "kindle-local-sync.vault";
	version: 1;
	vaultId: string;
}

export interface PendingSentinelEvidence {
	schema: "kindle-local-sync.pending";
	version: 1;
	transactionId: string;
	originInstanceId: string;
	vaultId: string;
	journalSha256: string;
}

export interface CompletionReceiptEvidence {
	schema: "kindle-local-sync.completed";
	version: 1;
	transactionId: string;
	originInstanceId: string;
	vaultId: string;
	journalSha256: string;
	pendingSha256: string;
	noteTargetKey: string | null;
	notePostSha256: string | null;
	statePostSha256: string;
	completedAt: string;
}

export type RecoveryContentImage =
	| { kind: "absent"; sha256: string }
	| { kind: "present"; sha256: string; content: string };

export interface RecoveryJournalEvidence {
	schema: "kindle-local-sync.journal";
	version: 1;
	transactionId: string;
	profileId: string;
	originInstanceId: string;
	vaultId: string;
	operation: TransactionOperation;
	createdAt: string;
	note: null | {
		targetPath: string;
		targetKey: string;
		preimage: RecoveryContentImage;
		postimage: RecoveryContentImage;
	};
	state: {
		preimage: RecoveryContentImage;
		postimage: RecoveryContentImage;
		expectedMutationSha256: string;
	};
	strongIds: string[];
	legacyIds: string[];
}

export interface EncodedEvidence<T> {
	body: T;
	bytes: string;
	sha256: string;
}

export class InvalidEvidenceError extends Error {
	constructor(readonly code: string) {
		super(`Invalid Kindle Local Sync recovery evidence (${code}).`);
		this.name = "InvalidEvidenceError";
	}
}

export function createCanonicalUuid(): string {
	return randomUUID();
}

export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isLowercaseSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalizeJson(value: unknown): string {
	const serialized = JSON.stringify(sortJsonValue(value));
	if (typeof serialized !== "string") {
		throw new InvalidEvidenceError("non-serializable-json");
	}
	return serialized;
}

export function createNoteTargetKey(targetPath: string): string {
	validateNoteTargetPath(targetPath);
	return sha256(targetPath);
}

export function createProfileIdentity(profileId = createCanonicalUuid()): ProfileIdentityEvidence {
	assertUuid(profileId, "profile-id");
	return { schema: "kindle-local-sync.profile", version: EVIDENCE_VERSION, profileId };
}

export function createOriginIdentity(
	profileId: string,
	originInstanceId = createCanonicalUuid()
): OriginIdentityEvidence {
	assertUuid(profileId, "profile-id");
	assertUuid(originInstanceId, "origin-id");
	return {
		schema: "kindle-local-sync.origin",
		version: EVIDENCE_VERSION,
		profileId,
		originInstanceId,
	};
}

export function createVaultIdentity(vaultId = createCanonicalUuid()): VaultIdentityEvidence {
	assertUuid(vaultId, "vault-id");
	return { schema: "kindle-local-sync.vault", version: EVIDENCE_VERSION, vaultId };
}

export function encodeEvidence<T>(body: T): EncodedEvidence<T> {
	// Filename digests detect torn or mutated evidence; they do not authenticate against a vault rewriter.
	const bytes = canonicalizeJson(body);
	return { body, bytes, sha256: sha256(bytes) };
}

export function pendingSentinelFilename(body: PendingSentinelEvidence): string {
	validatePendingSentinel(body);
	return `kindle-local-sync.pending.v1.${encodeEvidence(body).sha256}.json`;
}

export function completionReceiptFilename(body: CompletionReceiptEvidence): string {
	validateCompletionReceipt(body);
	return `kindle-local-sync.completed.v1.${encodeEvidence(body).sha256}.json`;
}

export function journalFilename(body: RecoveryJournalEvidence): string {
	validateRecoveryJournal(body);
	return `kindle-local-sync.journal.v1.${encodeEvidence(body).sha256}.json`;
}

export function profileIdentityFilename(body: ProfileIdentityEvidence): string {
	validateProfileIdentity(body);
	return `kindle-local-sync.profile.v1.${encodeEvidence(body).sha256}.json`;
}

export function originIdentityFilename(body: OriginIdentityEvidence): string {
	validateOriginIdentity(body);
	return `kindle-local-sync.origin.v1.${encodeEvidence(body).sha256}.json`;
}

export function vaultIdentityFilename(body: VaultIdentityEvidence): string {
	validateVaultIdentity(body);
	return `kindle-local-sync.vault.v1.${encodeEvidence(body).sha256}.json`;
}

export function parsePendingSentinel(filename: string, bytes: string): PendingSentinelEvidence {
	const body = parseCanonicalObject(bytes);
	validatePendingSentinel(body);
	assertFilename(filename, pendingSentinelFilename(body), "pending-filename-hash");
	return body;
}

export function parseCompletionReceipt(filename: string, bytes: string): CompletionReceiptEvidence {
	const body = parseCanonicalObject(bytes);
	validateCompletionReceipt(body);
	assertFilename(filename, completionReceiptFilename(body), "completion-filename-hash");
	return body;
}

export function parseRecoveryJournal(filename: string, bytes: string): RecoveryJournalEvidence {
	const body = parseCanonicalObject(bytes);
	validateRecoveryJournal(body);
	assertFilename(filename, journalFilename(body), "journal-filename-hash");
	return body;
}

export function parseProfileIdentity(filename: string, bytes: string): ProfileIdentityEvidence {
	const body = parseCanonicalObject(bytes);
	validateProfileIdentity(body);
	assertFilename(filename, profileIdentityFilename(body), "profile-filename-hash");
	return body;
}

export function parseOriginIdentity(filename: string, bytes: string): OriginIdentityEvidence {
	const body = parseCanonicalObject(bytes);
	validateOriginIdentity(body);
	assertFilename(filename, originIdentityFilename(body), "origin-filename-hash");
	return body;
}

export function parseVaultIdentity(filename: string, bytes: string): VaultIdentityEvidence {
	const body = parseCanonicalObject(bytes);
	validateVaultIdentity(body);
	assertFilename(filename, vaultIdentityFilename(body), "vault-filename-hash");
	return body;
}

export function validateProfileIdentity(value: unknown): asserts value is ProfileIdentityEvidence {
	assertRecordWithKeys(value, ["profileId", "schema", "version"], "profile-shape");
	assertLiteral(value.schema, "kindle-local-sync.profile", "profile-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "profile-version");
	assertUuid(value.profileId, "profile-id");
}

export function validateOriginIdentity(value: unknown): asserts value is OriginIdentityEvidence {
	assertRecordWithKeys(value, ["originInstanceId", "profileId", "schema", "version"], "origin-shape");
	assertLiteral(value.schema, "kindle-local-sync.origin", "origin-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "origin-version");
	assertUuid(value.profileId, "origin-profile-id");
	assertUuid(value.originInstanceId, "origin-id");
}

export function validateVaultIdentity(value: unknown): asserts value is VaultIdentityEvidence {
	assertRecordWithKeys(value, ["schema", "vaultId", "version"], "vault-shape");
	assertLiteral(value.schema, "kindle-local-sync.vault", "vault-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "vault-version");
	assertUuid(value.vaultId, "vault-id");
}

export function validatePendingSentinel(value: unknown): asserts value is PendingSentinelEvidence {
	assertRecordWithKeys(value, [
		"journalSha256",
		"originInstanceId",
		"schema",
		"transactionId",
		"vaultId",
		"version",
	], "pending-shape");
	assertLiteral(value.schema, "kindle-local-sync.pending", "pending-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "pending-version");
	assertUuid(value.transactionId, "pending-transaction-id");
	assertUuid(value.originInstanceId, "pending-origin-id");
	assertUuid(value.vaultId, "pending-vault-id");
	assertSha(value.journalSha256, "pending-journal-digest");
}

export function validateCompletionReceipt(value: unknown): asserts value is CompletionReceiptEvidence {
	assertRecordWithKeys(value, [
		"completedAt",
		"journalSha256",
		"notePostSha256",
		"noteTargetKey",
		"originInstanceId",
		"pendingSha256",
		"schema",
		"statePostSha256",
		"transactionId",
		"vaultId",
		"version",
	], "completion-shape");
	assertLiteral(value.schema, "kindle-local-sync.completed", "completion-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "completion-version");
	assertUuid(value.transactionId, "completion-transaction-id");
	assertUuid(value.originInstanceId, "completion-origin-id");
	assertUuid(value.vaultId, "completion-vault-id");
	assertSha(value.journalSha256, "completion-journal-digest");
	assertSha(value.pendingSha256, "completion-pending-digest");
	assertNullableSha(value.noteTargetKey, "completion-note-target");
	assertNullableSha(value.notePostSha256, "completion-note-postimage");
	if ((value.noteTargetKey === null) !== (value.notePostSha256 === null)) {
		throw new InvalidEvidenceError("completion-note-pair");
	}
	assertSha(value.statePostSha256, "completion-state-postimage");
	assertTimestamp(value.completedAt, "completion-timestamp");
}

export function validateRecoveryJournal(value: unknown): asserts value is RecoveryJournalEvidence {
	assertRecordWithKeys(value, [
		"createdAt",
		"legacyIds",
		"note",
		"operation",
		"originInstanceId",
		"profileId",
		"schema",
		"state",
		"strongIds",
		"transactionId",
		"vaultId",
		"version",
	], "journal-shape");
	assertLiteral(value.schema, "kindle-local-sync.journal", "journal-schema");
	assertLiteral(value.version, EVIDENCE_VERSION, "journal-version");
	assertUuid(value.transactionId, "journal-transaction-id");
	assertUuid(value.profileId, "journal-profile-id");
	assertUuid(value.originInstanceId, "journal-origin-id");
	assertUuid(value.vaultId, "journal-vault-id");
	if (!isTransactionOperation(value.operation)) {
		throw new InvalidEvidenceError("journal-operation");
	}
	assertTimestamp(value.createdAt, "journal-timestamp");
	validateJournalNote(value.note);
	validateJournalState(value.state);
	assertCanonicalIdArray(value.strongIds, "journal-strong-ids", STRONG_CLIPPING_ID_PATTERN);
	assertCanonicalIdArray(value.legacyIds, "journal-legacy-ids", LEGACY_CLIPPING_ID_PATTERN);
}

export function createContentImage(content: string | null): RecoveryContentImage {
	return content === null
		? { kind: "absent", sha256: sha256("") }
		: { kind: "present", sha256: sha256(content), content };
}

export function createExpectedStateMutationSha256(
	preimage: RecoveryContentImage,
	postimage: RecoveryContentImage
): string {
	return sha256(canonicalizeJson({
		preimageSha256: preimage.sha256,
		postimageSha256: postimage.sha256,
	}));
}

function validateJournalNote(value: unknown): void {
	if (value === null) {
		return;
	}
	assertRecordWithKeys(value, ["postimage", "preimage", "targetKey", "targetPath"], "journal-note-shape");
	validateNoteTargetPath(value.targetPath);
	assertSha(value.targetKey, "journal-note-target");
	if (value.targetKey !== createNoteTargetKey(value.targetPath)) {
		throw new InvalidEvidenceError("journal-note-target-mismatch");
	}
	validateContentImage(value.preimage, "journal-note-preimage");
	validateContentImage(value.postimage, "journal-note-postimage");
	if (value.postimage.kind !== "present") {
		throw new InvalidEvidenceError("journal-note-postimage-absent");
	}
}

function validateNoteTargetPath(value: unknown): asserts value is string {
	if (typeof value !== "string"
		|| value.length === 0
		|| value.startsWith("/")
		|| value.endsWith("/")
		|| /^[a-zA-Z]:\//.test(value)
		|| value.includes("\\")
		|| value.includes("//")
		|| [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
		|| NOTE_PATH_SEGMENT_PATTERN.test(value)) {
		throw new InvalidEvidenceError("journal-note-path");
	}
}

function validateJournalState(value: unknown): void {
	assertRecordWithKeys(value, ["expectedMutationSha256", "postimage", "preimage"], "journal-state-shape");
	validateContentImage(value.preimage, "journal-state-preimage");
	validateContentImage(value.postimage, "journal-state-postimage");
	assertSha(value.expectedMutationSha256, "journal-state-mutation");
	const expected = createExpectedStateMutationSha256(value.preimage, value.postimage);
	if (value.expectedMutationSha256 !== expected) {
		throw new InvalidEvidenceError("journal-state-mutation-mismatch");
	}
}

function validateContentImage(value: unknown, code: string): asserts value is RecoveryContentImage {
	if (!isRecord(value)) {
		throw new InvalidEvidenceError(code);
	}
	if (value.kind === "absent") {
		assertRecordWithKeys(value, ["kind", "sha256"], code);
		assertSha(value.sha256, code);
		if (value.sha256 !== sha256("")) {
			throw new InvalidEvidenceError(`${code}-digest`);
		}
		return;
	}
	if (value.kind === "present") {
		assertRecordWithKeys(value, ["content", "kind", "sha256"], code);
		if (typeof value.content !== "string") {
			throw new InvalidEvidenceError(code);
		}
		assertSha(value.sha256, code);
		if (value.sha256 !== sha256(value.content)) {
			throw new InvalidEvidenceError(`${code}-digest`);
		}
		return;
	}
	throw new InvalidEvidenceError(code);
}

function parseCanonicalObject(bytes: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes) as unknown;
	} catch {
		throw new InvalidEvidenceError("invalid-json");
	}
	if (!isRecord(parsed)) {
		throw new InvalidEvidenceError("non-object");
	}
	if (canonicalizeJson(parsed) !== bytes) {
		throw new InvalidEvidenceError("non-canonical-json");
	}
	return parsed;
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	if (!isRecord(value)) {
		return value;
	}
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		sorted[key] = sortJsonValue(value[key]);
	}
	return sorted;
}

function assertRecordWithKeys(value: unknown, keys: string[], code: string): asserts value is Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
		throw new InvalidEvidenceError(code);
	}
}

function assertUuid(value: unknown, code: string): asserts value is string {
	if (!isCanonicalUuid(value)) {
		throw new InvalidEvidenceError(code);
	}
}

function assertSha(value: unknown, code: string): asserts value is string {
	if (!isLowercaseSha256(value)) {
		throw new InvalidEvidenceError(code);
	}
}

function assertNullableSha(value: unknown, code: string): asserts value is string | null {
	if (value !== null) {
		assertSha(value, code);
	}
}

function assertLiteral<T extends string | number>(value: unknown, expected: T, code: string): asserts value is T {
	if (value !== expected) {
		throw new InvalidEvidenceError(code);
	}
}

function assertTimestamp(value: unknown, code: string): asserts value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
		|| Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
		throw new InvalidEvidenceError(code);
	}
}

function assertCanonicalIdArray(
	value: unknown,
	code: string,
	pattern: RegExp
): asserts value is string[] {
	if (!Array.isArray(value)
		|| value.some((entry) => typeof entry !== "string" || !pattern.test(entry))
		|| new Set(value).size !== value.length
		|| Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string")))
			.sort()
			.some((entry, index) => entry !== value[index])) {
		throw new InvalidEvidenceError(code);
	}
}

function assertFilename(actual: string, expected: string, code: string): void {
	if (actual !== expected) {
		throw new InvalidEvidenceError(code);
	}
}

function isTransactionOperation(value: unknown): value is TransactionOperation {
	return value === "managed-note-sync"
		|| value === "ignore-cleanup"
		|| value === "settings-mutation"
		|| value === "collision-recovery";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
