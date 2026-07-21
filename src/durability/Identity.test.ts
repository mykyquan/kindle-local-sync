import { describe, expect, it } from "vitest";
import {
	createOriginIdentity,
	createProfileIdentity,
	createVaultIdentity,
	encodeEvidence,
	originIdentityFilename,
	profileIdentityFilename,
	vaultIdentityFilename,
} from "./Evidence";
import {
	IdentityEvidenceError,
	planOriginIdentity,
	planProfileIdentity,
	planVaultIdentity,
	resolveOriginIdentity,
	resolveProfileIdentity,
	resolveVaultIdentity,
} from "./Identity";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGIN_ID = "22222222-2222-4222-8222-222222222222";
const VAULT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VAULT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("recovery identity lifecycle", () => {
	it("creates a missing identity only when no unresolved evidence exists", () => {
		const resolution = resolveProfileIdentity([]);
		const planned = planProfileIdentity(resolution, false, () => createProfileIdentity(PROFILE_ID));

		expect(planned.action).toBe("create");
		expect(planned.evidence.profileId).toBe(PROFILE_ID);
		expectIdentityFailure(
			() => planProfileIdentity(resolution, true, () => createProfileIdentity(PROFILE_ID)),
			"missing-with-unresolved-evidence"
		);
	});

	it("reuses one valid profile, origin, and vault identity", () => {
		const profile = createProfileIdentity(PROFILE_ID);
		const origin = createOriginIdentity(PROFILE_ID, ORIGIN_ID);
		const vault = createVaultIdentity(VAULT_ID);

		expect(planProfileIdentity(resolveProfileIdentity([raw(profileIdentityFilename(profile), profile)]), false).action)
			.toBe("use");
		expect(planOriginIdentity(resolveOriginIdentity([raw(originIdentityFilename(origin), origin)], PROFILE_ID), PROFILE_ID, false).action)
			.toBe("use");
		expect(planVaultIdentity(resolveVaultIdentity([raw(vaultIdentityFilename(vault), vault)]), false).action)
			.toBe("use");
	});

	it("fails closed for multiple, conflicting, corrupt, or wrong-profile evidence", () => {
		const firstVault = createVaultIdentity(VAULT_ID);
		const secondVault = createVaultIdentity(OTHER_VAULT_ID);
		const conflicting = resolveVaultIdentity([
			raw(vaultIdentityFilename(firstVault), firstVault),
			raw(vaultIdentityFilename(secondVault), secondVault),
		]);
		const corrupt = resolveProfileIdentity([{
			filename: profileIdentityFilename(createProfileIdentity(PROFILE_ID)),
			bytes: "{\"truncated\":",
		}]);
		const wrongOrigin = createOriginIdentity(OTHER_PROFILE_ID, ORIGIN_ID);

		expect(conflicting.status).toBe("conflicting");
		expect(() => planVaultIdentity(conflicting, false)).toThrow(IdentityEvidenceError);
		expect(corrupt.status).toBe("corrupt");
		expect(() => planProfileIdentity(corrupt, false)).toThrow(IdentityEvidenceError);
		expect(resolveOriginIdentity([raw(originIdentityFilename(wrongOrigin), wrongOrigin)], PROFILE_ID).status)
			.toBe("conflicting");
	});

	it("keeps vault identity stable across rename or move", () => {
		const evidence = createVaultIdentity(VAULT_ID);
		const file = raw(vaultIdentityFilename(evidence), evidence);
		const beforeMove = resolveVaultIdentity([file]);
		const afterMove = resolveVaultIdentity([file]);

		expect(beforeMove.status).toBe("valid");
		expect(afterMove).toEqual(beforeMove);
	});

	it("does not collide for equal vault display names", () => {
		const first = createVaultIdentity(VAULT_ID);
		const second = createVaultIdentity(OTHER_VAULT_ID);

		expect(first.vaultId).not.toBe(second.vaultId);
		expect(vaultIdentityFilename(first)).not.toBe(vaultIdentityFilename(second));
	});
});

function raw<T>(filename: string, body: T): { filename: string; bytes: string } {
	return { filename, bytes: encodeEvidence(body).bytes };
}

function expectIdentityFailure(action: () => unknown, code: IdentityEvidenceError["code"]): void {
	try {
		action();
		throw new Error("Expected identity planning to fail.");
	} catch (error) {
		expect(error).toBeInstanceOf(IdentityEvidenceError);
		expect((error as IdentityEvidenceError).code).toBe(code);
	}
}
