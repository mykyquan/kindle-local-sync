import type { Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { detectDurabilityCapabilities } from "./RuntimeCapabilities";

describe("runtime durability capabilities", () => {
	it("reports one centralized supported result only when every prerequisite exists", async () => {
		const result = await detectDurabilityCapabilities(createVault(), createDependencies());

		expect(result).toMatchObject({
			supported: true,
			failures: [],
			platform: "darwin",
			canonicalRecoveryRoot: "/Users/reader/Library/Application Support/Kindle Local Sync/recovery-v1",
			userDataPath: "/Users/reader/Library/Application Support/obsidian",
		});
	});

	it("reports deterministic failures for Vault.process and required adapter operations", async () => {
		const vault = createVault() as unknown as Record<string, unknown>;
		delete vault.process;
		delete (vault.adapter as Record<string, unknown>).getFullPath;

		const result = await detectDurabilityCapabilities(vault as unknown as Vault, createDependencies());

		expect(result.supported).toBe(false);
		expect(result.failures).toEqual(["vault-adapter-unavailable", "vault-process-unavailable"]);
	});

	it("blocks when Node primitives, statfs, read-back, or user-data discovery are unavailable", async () => {
		const result = await detectDurabilityCapabilities(createVault(), {
			...createDependencies(),
			open: undefined,
			readFile: undefined,
			statfs: undefined,
			discoverUserDataPath: () => null,
		});

		expect(result.supported).toBe(false);
		expect(result.failures).toEqual([
			"exclusive-create-unavailable",
			"file-sync-unavailable",
			"node-filesystem-unavailable",
			"readback-unavailable",
			"statfs-unavailable",
			"user-data-unavailable",
		]);
	});

	it("blocks Windows when LocalAppData is missing instead of using roaming AppData", async () => {
		const result = await detectDurabilityCapabilities(createVault(), {
			...createDependencies(),
			platform: "win32",
			homeDirectory: "C:\\Users\\reader",
			environment: { APPDATA: "C:\\Users\\reader\\AppData\\Roaming" },
			discoverUserDataPath: () => "C:\\Users\\reader\\AppData\\Roaming\\obsidian",
		});

		expect(result.supported).toBe(false);
		expect(result.failures).toContain("recovery-root-unavailable");
	});
});

function createVault(): Vault {
	return {
		process: vi.fn(),
		adapter: {
			exists: vi.fn(),
			getFullPath: vi.fn(),
			list: vi.fn(),
			mkdir: vi.fn(),
			read: vi.fn(),
			remove: vi.fn(),
			write: vi.fn(),
		},
	} as unknown as Vault;
}

function createDependencies() {
	const noop = vi.fn();
	return {
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
		discoverUserDataPath: () => "/Users/reader/Library/Application Support/obsidian",
		resolveRecoveryRoot: async (selection: { rootPath: string }) => selection.rootPath,
	};
}
