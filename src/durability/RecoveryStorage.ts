import {
	access,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	statfs,
} from "fs/promises";
import { constants } from "fs";
import { Buffer } from "buffer";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep, win32 } from "path";
import process from "process";
import {
	EncodedEvidence,
	MAX_JOURNAL_BYTES,
	MAX_RECOVERY_STORE_BYTES,
	RECOVERY_FREE_SPACE_RESERVE_BYTES,
} from "./Evidence";

export type SupportedDesktopPlatform = "darwin" | "win32" | "linux";

export interface RecoveryRootSelection {
	platform: SupportedDesktopPlatform;
	anchorPath: string;
	relativeSegments: string[];
	rootPath: string;
}

export interface RecoveryRootOptions {
	platform: string;
	homeDirectory: string;
	environment: Readonly<Record<string, string | undefined>>;
}

export interface StorageBudget {
	journalBytes: number;
	currentStoreBytes: number;
	projectedStoreBytes: number;
	availableBytes: number;
	requiredAvailableBytes: number;
}

export type StorageFailureCode =
	| "unsupported-platform"
	| "invalid-home-directory"
	| "missing-local-app-data"
	| "invalid-local-app-data"
	| "invalid-xdg-state-home"
	| "unusable-recovery-anchor"
	| "path-escape"
	| "invalid-path-segment"
	| "symlink-or-junction"
	| "non-regular-file"
	| "unsafe-posix-owner"
	| "unsafe-posix-mode"
	| "evidence-too-large"
	| "journal-too-large"
	| "recovery-store-too-large"
	| "statfs-unavailable"
	| "insufficient-free-space"
	| "exclusive-create-conflict"
	| "file-changed-during-read"
	| "readback-mismatch";

export class RecoveryStorageError extends Error {
	constructor(readonly code: StorageFailureCode, readonly cause?: unknown) {
		super(`Kindle Local Sync recovery storage is unavailable (${code}).`);
		this.name = "RecoveryStorageError";
	}
}

export function selectRecoveryRoot(options: RecoveryRootOptions): RecoveryRootSelection {
	if (options.platform === "darwin") {
		const home = assertNormalizedAbsolutePosix(options.homeDirectory, "invalid-home-directory");
		const anchorPath = join(home, "Library", "Application Support");
		return createSelection("darwin", anchorPath, ["Kindle Local Sync", "recovery-v1"]);
	}

	if (options.platform === "win32") {
		const localAppData = options.environment.LOCALAPPDATA;
		if (!localAppData) {
			throw new RecoveryStorageError("missing-local-app-data");
		}
		if (!win32.isAbsolute(localAppData) || win32.normalize(localAppData) !== localAppData) {
			throw new RecoveryStorageError("invalid-local-app-data");
		}
		return createWindowsSelection(localAppData, ["Kindle Local Sync", "recovery-v1"]);
	}

	if (options.platform === "linux") {
		const xdgStateHome = options.environment.XDG_STATE_HOME;
		if (xdgStateHome !== undefined && xdgStateHome !== "") {
			const anchor = assertNormalizedAbsolutePosix(xdgStateHome, "invalid-xdg-state-home");
			return createSelection("linux", anchor, ["kindle-local-sync", "recovery-v1"]);
		}
		const home = assertNormalizedAbsolutePosix(options.homeDirectory, "invalid-home-directory");
		const anchorPath = join(home, ".local", "state");
		return createSelection("linux", anchorPath, ["kindle-local-sync", "recovery-v1"]);
	}

	throw new RecoveryStorageError("unsupported-platform");
}

export function validateUuidPathSegment(value: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
		throw new RecoveryStorageError("invalid-path-segment");
	}
	return value;
}

export function validateSha256PathSegment(value: string): string {
	if (!/^[0-9a-f]{64}$/.test(value)) {
		throw new RecoveryStorageError("invalid-path-segment");
	}
	return value;
}

export function resolveContainedPath(rootPath: string, ...segments: string[]): string {
	for (const segment of segments) {
		if (segment.length === 0 || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
			throw new RecoveryStorageError("invalid-path-segment");
		}
	}
	const candidate = resolve(rootPath, ...segments);
	assertContained(rootPath, candidate);
	return candidate;
}

export async function resolveUsableRecoveryRoot(selection: RecoveryRootSelection): Promise<string> {
	if (selection.platform !== process.platform) {
		throw new RecoveryStorageError("unusable-recovery-anchor");
	}

	let canonicalAnchor: string;
	try {
		const existingAnchor = await findNearestExistingAncestor(selection.anchorPath);
		await access(existingAnchor, constants.R_OK | constants.W_OK);
		const realExistingAnchor = await realpath(existingAnchor);
		const missingTail = relative(existingAnchor, selection.anchorPath);
		canonicalAnchor = resolve(realExistingAnchor, missingTail);
	} catch (error) {
		throw new RecoveryStorageError("unusable-recovery-anchor", error);
	}

	const canonicalRoot = resolve(canonicalAnchor, ...selection.relativeSegments);
	assertContained(canonicalAnchor, canonicalRoot);
	let ownedPath = canonicalAnchor;
	for (const segment of selection.relativeSegments) {
		ownedPath = join(ownedPath, segment);
		try {
			const info = await lstat(ownedPath);
			if (info.isSymbolicLink() || !info.isDirectory()) {
				throw new RecoveryStorageError("symlink-or-junction");
			}
		} catch (error) {
			if (isMissingPathError(error)) {
				break;
			}
			throw error;
		}
	}
	return canonicalRoot;
}

export async function prepareSecureRecoveryRoot(rootPath: string, platform: string = process.platform): Promise<void> {
	await mkdir(rootPath, { recursive: true, mode: 0o700 });
	const ownedParent = dirname(rootPath);
	await assertSecureDescendantPath(dirname(ownedParent), rootPath);
	await assertSecurePrivateDescendantPath(ownedParent, rootPath, platform);
}

export async function assertSecureDirectory(path: string, platform: string = process.platform): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new RecoveryStorageError("symlink-or-junction");
	}
	if (platform !== "win32") {
		verifyPosixOwnershipAndMode(info.uid, info.mode, true);
	}
}

export async function assertNonSymlinkDirectory(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new RecoveryStorageError("symlink-or-junction");
	}
}

export async function assertSecureDescendantPath(rootPath: string, candidatePath: string): Promise<void> {
	assertContained(rootPath, candidatePath);
	const relativePath = relative(rootPath, candidatePath);
	let currentPath = rootPath;
	for (const segment of relativePath.split(sep).filter(Boolean)) {
		currentPath = join(currentPath, segment);
		try {
			const info = await lstat(currentPath);
			if (info.isSymbolicLink()) {
				throw new RecoveryStorageError("symlink-or-junction");
			}
		} catch (error) {
			if (isMissingPathError(error)) {
				break;
			}
			throw error;
		}
	}
}

export async function assertSecurePrivateDescendantPath(
	privateRootPath: string,
	candidateDirectory: string,
	platform: string = process.platform
): Promise<void> {
	assertContained(privateRootPath, candidateDirectory);
	await assertSecureDirectory(privateRootPath, platform);
	const relativePath = relative(privateRootPath, candidateDirectory);
	let currentPath = privateRootPath;
	for (const segment of relativePath.split(sep).filter(Boolean)) {
		currentPath = join(currentPath, segment);
		await assertSecureDirectory(currentPath, platform);
	}
}

export async function measureRecoveryStoreBytes(rootPath: string): Promise<number> {
	try {
		return await measureDirectory(rootPath, rootPath);
	} catch (error) {
		if (isMissingPathError(error)) {
			return 0;
		}
		throw error;
	}
}

export async function checkJournalStorageBudget(
	rootPath: string,
	journalBytes: number,
	statfsFn: typeof statfs | null = statfs
): Promise<StorageBudget> {
	if (!Number.isSafeInteger(journalBytes) || journalBytes < 0 || journalBytes > MAX_JOURNAL_BYTES) {
		throw new RecoveryStorageError("journal-too-large");
	}
	const currentStoreBytes = await measureRecoveryStoreBytes(rootPath);
	const projectedStoreBytes = currentStoreBytes + journalBytes;
	if (projectedStoreBytes > MAX_RECOVERY_STORE_BYTES) {
		throw new RecoveryStorageError("recovery-store-too-large");
	}
	if (typeof statfsFn !== "function") {
		throw new RecoveryStorageError("statfs-unavailable");
	}

	let availableBytes: number;
	try {
		const stats = await statfsFn(rootPath);
		availableBytes = Number(stats.bavail) * Number(stats.bsize);
	} catch (error) {
		throw new RecoveryStorageError("statfs-unavailable", error);
	}
	if (!Number.isSafeInteger(availableBytes) || availableBytes < 0) {
		throw new RecoveryStorageError("statfs-unavailable");
	}
	const requiredAvailableBytes = journalBytes + RECOVERY_FREE_SPACE_RESERVE_BYTES;
	if (availableBytes < requiredAvailableBytes) {
		throw new RecoveryStorageError("insufficient-free-space");
	}
	return { journalBytes, currentStoreBytes, projectedStoreBytes, availableBytes, requiredAvailableBytes };
}

export async function writeImmutableFile<T>(options: {
	rootPath: string;
	filePath: string;
	evidence: EncodedEvidence<T>;
	validateReadback: (filename: string, bytes: string) => T;
	platform?: string;
	verifyPrivateParentMode?: boolean;
	privateRootPath?: string;
}): Promise<T> {
	await assertSecureDescendantPath(options.rootPath, options.filePath);
	await mkdir(dirname(options.filePath), { recursive: true, mode: 0o700 });
	if (options.verifyPrivateParentMode ?? true) {
		await assertSecurePrivateDescendantPath(
			options.privateRootPath ?? options.rootPath,
			dirname(options.filePath),
			options.platform
		);
	} else {
		await assertNonSymlinkDirectory(dirname(options.filePath));
	}

	let handle;
	try {
		// A killed process may leave this unique path partial; startup rejects it and no writer overwrites it.
		handle = await open(options.filePath, "wx", 0o600);
	} catch (error) {
		if (isAlreadyExistsError(error)) {
			throw new RecoveryStorageError("exclusive-create-conflict", error);
		}
		throw error;
	}

	try {
		await handle.writeFile(options.evidence.bytes, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}

	const info = await lstat(options.filePath);
	if (info.isSymbolicLink() || !info.isFile()) {
		throw new RecoveryStorageError("non-regular-file");
	}
	if ((options.platform ?? process.platform) !== "win32") {
		verifyPosixOwnershipAndMode(info.uid, info.mode, false);
	}
	const readback = await readFile(options.filePath, "utf8");
	if (readback !== options.evidence.bytes) {
		throw new RecoveryStorageError("readback-mismatch");
	}
	return options.validateReadback(options.filePath.slice(options.filePath.lastIndexOf(sep) + 1), readback);
}

export async function readSecureBoundedFile(options: {
	rootPath: string;
	filePath: string;
	maxBytes: number;
	remainingAggregateBytes?: number;
	platform?: string;
	verifyPrivateParentMode?: boolean;
	privateRootPath?: string;
	readFileFn?: typeof readFile;
	lstatFn?: typeof lstat;
}): Promise<{ bytes: string; size: number }> {
	const lstatFn = options.lstatFn ?? lstat;
	await assertSecureDescendantPath(options.rootPath, options.filePath);
	if (options.verifyPrivateParentMode ?? true) {
		await assertSecurePrivateDescendantPath(
			options.privateRootPath ?? options.rootPath,
			dirname(options.filePath),
			options.platform
		);
	} else {
		await assertNonSymlinkDirectory(dirname(options.filePath));
	}

	const before = await lstatFn(options.filePath);
	if (before.isSymbolicLink() || !before.isFile()) {
		throw new RecoveryStorageError("non-regular-file");
	}
	if ((options.platform ?? process.platform) !== "win32") {
		verifyPosixOwnershipAndMode(before.uid, before.mode, false);
	}
	if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > options.maxBytes) {
		throw new RecoveryStorageError("evidence-too-large");
	}
	if (before.size > (options.remainingAggregateBytes ?? Number.MAX_SAFE_INTEGER)) {
		throw new RecoveryStorageError("recovery-store-too-large");
	}

	const bytes = await (options.readFileFn ?? readFile)(options.filePath, "utf8");
	const after = await lstatFn(options.filePath);
	if (after.isSymbolicLink() || !after.isFile()) {
		throw new RecoveryStorageError("non-regular-file");
	}
	if (before.dev !== after.dev
		|| before.ino !== after.ino
		|| before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs
		|| before.ctimeMs !== after.ctimeMs
		|| Buffer.byteLength(bytes, "utf8") !== before.size) {
		throw new RecoveryStorageError("file-changed-during-read");
	}
	return { bytes, size: before.size };
}

function createSelection(
	platform: "darwin" | "linux",
	anchorPath: string,
	relativeSegments: string[]
): RecoveryRootSelection {
	return {
		platform,
		anchorPath,
		relativeSegments,
		rootPath: join(anchorPath, ...relativeSegments),
	};
}

function createWindowsSelection(anchorPath: string, relativeSegments: string[]): RecoveryRootSelection {
	return {
		platform: "win32",
		anchorPath,
		relativeSegments,
		rootPath: win32.join(anchorPath, ...relativeSegments),
	};
}

function assertNormalizedAbsolutePosix(value: string, code: StorageFailureCode): string {
	if (!isAbsolute(value) || normalize(value) !== value) {
		throw new RecoveryStorageError(code);
	}
	return value;
}

function assertContained(rootPath: string, candidatePath: string): void {
	const relativePath = relative(resolve(rootPath), resolve(candidatePath));
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new RecoveryStorageError("path-escape");
	}
}

async function findNearestExistingAncestor(path: string): Promise<string> {
	let candidate = path;
	for (;;) {
		try {
			await lstat(candidate);
			return candidate;
		} catch (error) {
			if (!isMissingPathError(error)) {
				throw error;
			}
			const parent = dirname(candidate);
			if (parent === candidate) {
				throw error;
			}
			candidate = parent;
		}
	}
}

async function measureDirectory(rootPath: string, currentPath: string): Promise<number> {
	assertContained(rootPath, currentPath);
	const currentInfo = await lstat(currentPath);
	if (currentInfo.isSymbolicLink()) {
		throw new RecoveryStorageError("symlink-or-junction");
	}
	if (currentInfo.isFile()) {
		return currentInfo.size;
	}
	if (!currentInfo.isDirectory()) {
		throw new RecoveryStorageError("non-regular-file");
	}
	let total = 0;
	for (const entry of await readdir(currentPath)) {
		total += await measureDirectory(rootPath, join(currentPath, entry));
	}
	return total;
}

function verifyPosixOwnershipAndMode(uid: number, mode: number, directory: boolean): void {
	validatePosixOwnershipAndMode(uid, mode, directory, process.getuid?.());
}

export function validatePosixOwnershipAndMode(
	uid: number,
	mode: number,
	directory: boolean,
	currentUid: number | undefined
): void {
	if (currentUid !== undefined && uid !== currentUid) {
		throw new RecoveryStorageError("unsafe-posix-owner");
	}
	if ((mode & 0o077) !== 0 || (directory && (mode & 0o700) !== 0o700) || (!directory && (mode & 0o600) !== 0o600)) {
		throw new RecoveryStorageError("unsafe-posix-mode");
	}
}

function isMissingPathError(error: unknown): boolean {
	return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
	return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is Error & { code?: string } {
	return error instanceof Error && "code" in error;
}
