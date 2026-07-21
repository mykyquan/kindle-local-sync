import {
	EncodedEvidence,
	InvalidEvidenceError,
	OriginIdentityEvidence,
	ProfileIdentityEvidence,
	VaultIdentityEvidence,
	createOriginIdentity,
	createProfileIdentity,
	createVaultIdentity,
	encodeEvidence,
	originIdentityFilename,
	parseOriginIdentity,
	parseProfileIdentity,
	parseVaultIdentity,
	profileIdentityFilename,
	vaultIdentityFilename,
} from "./Evidence";

export type IdentityKind = "profile" | "origin" | "vault";

export interface RawIdentityFile {
	filename: string;
	bytes: string;
}

export type IdentityResolution<T> =
	| { status: "missing" }
	| { status: "valid"; evidence: T; encoded: EncodedEvidence<T>; filename: string }
	| { status: "corrupt"; filenames: string[] }
	| { status: "conflicting"; filenames: string[] };

export class IdentityEvidenceError extends Error {
	constructor(readonly code: "missing-with-unresolved-evidence" | "corrupt" | "conflicting") {
		super(`Kindle Local Sync recovery identity is unavailable (${code}).`);
		this.name = "IdentityEvidenceError";
	}
}

export function resolveProfileIdentity(files: RawIdentityFile[]): IdentityResolution<ProfileIdentityEvidence> {
	return resolveIdentity(files, "kindle-local-sync.profile.v1.", parseProfileIdentity);
}

export function resolveOriginIdentity(
	files: RawIdentityFile[],
	expectedProfileId?: string
): IdentityResolution<OriginIdentityEvidence> {
	const resolution = resolveIdentity(files, "kindle-local-sync.origin.v1.", parseOriginIdentity);
	if (resolution.status === "valid" && expectedProfileId !== undefined
		&& resolution.evidence.profileId !== expectedProfileId) {
		return { status: "conflicting", filenames: [resolution.filename] };
	}
	return resolution;
}

export function resolveVaultIdentity(files: RawIdentityFile[]): IdentityResolution<VaultIdentityEvidence> {
	return resolveIdentity(files, "kindle-local-sync.vault.v1.", parseVaultIdentity);
}

export function planProfileIdentity(
	resolution: IdentityResolution<ProfileIdentityEvidence>,
	hasUnresolvedEvidence: boolean,
	create = createProfileIdentity
): { action: "use" | "create"; evidence: ProfileIdentityEvidence; encoded: EncodedEvidence<ProfileIdentityEvidence>; filename: string } {
	return planIdentity(resolution, hasUnresolvedEvidence, create, profileIdentityFilename);
}

export function planOriginIdentity(
	resolution: IdentityResolution<OriginIdentityEvidence>,
	profileId: string,
	hasUnresolvedEvidence: boolean,
	create = () => createOriginIdentity(profileId)
): { action: "use" | "create"; evidence: OriginIdentityEvidence; encoded: EncodedEvidence<OriginIdentityEvidence>; filename: string } {
	return planIdentity(resolution, hasUnresolvedEvidence, create, originIdentityFilename);
}

export function planVaultIdentity(
	resolution: IdentityResolution<VaultIdentityEvidence>,
	hasUnresolvedEvidence: boolean,
	create = createVaultIdentity
): { action: "use" | "create"; evidence: VaultIdentityEvidence; encoded: EncodedEvidence<VaultIdentityEvidence>; filename: string } {
	return planIdentity(resolution, hasUnresolvedEvidence, create, vaultIdentityFilename);
}

function resolveIdentity<T>(
	files: RawIdentityFile[],
	prefix: string,
	parse: (filename: string, bytes: string) => T
): IdentityResolution<T> {
	const matching = files.filter((file) => file.filename.startsWith(prefix));
	if (matching.length === 0) {
		return { status: "missing" };
	}
	const valid: Array<{ filename: string; evidence: T; encoded: EncodedEvidence<T> }> = [];
	const corrupt: string[] = [];
	for (const file of matching) {
		try {
			const evidence = parse(file.filename, file.bytes);
			valid.push({ filename: file.filename, evidence, encoded: encodeEvidence(evidence) });
		} catch (error) {
			if (!(error instanceof InvalidEvidenceError)) {
				throw error;
			}
			corrupt.push(file.filename);
		}
	}
	if (corrupt.length > 0) {
		return { status: "corrupt", filenames: corrupt.sort() };
	}
	if (valid.length !== 1) {
		return { status: "conflicting", filenames: valid.map((entry) => entry.filename).sort() };
	}
	const identity = valid[0];
	if (!identity) {
		return { status: "missing" };
	}
	return { status: "valid", ...identity };
}

function planIdentity<T>(
	resolution: IdentityResolution<T>,
	hasUnresolvedEvidence: boolean,
	create: () => T,
	filenameFor: (evidence: T) => string
): { action: "use" | "create"; evidence: T; encoded: EncodedEvidence<T>; filename: string } {
	if (resolution.status === "valid") {
		return { action: "use", evidence: resolution.evidence, encoded: resolution.encoded, filename: resolution.filename };
	}
	if (resolution.status === "corrupt") {
		throw new IdentityEvidenceError("corrupt");
	}
	if (resolution.status === "conflicting") {
		throw new IdentityEvidenceError("conflicting");
	}
	if (hasUnresolvedEvidence) {
		throw new IdentityEvidenceError("missing-with-unresolved-evidence");
	}
	const evidence = create();
	return { action: "create", evidence, encoded: encodeEvidence(evidence), filename: filenameFor(evidence) };
}
