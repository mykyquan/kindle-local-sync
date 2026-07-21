import { lstat, mkdir, open, readFile, readdir, realpath, statfs } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, normalize, win32 } from "path";
import process from "process";
import type { Vault } from "obsidian";
import {
	RecoveryRootSelection,
	RecoveryStorageError,
	resolveUsableRecoveryRoot,
	selectRecoveryRoot,
} from "./RecoveryStorage";

export type DurabilityCapabilityFailure =
	| "vault-process-unavailable"
	| "vault-adapter-unavailable"
	| "node-filesystem-unavailable"
	| "exclusive-create-unavailable"
	| "file-sync-unavailable"
	| "readback-unavailable"
	| "statfs-unavailable"
	| "recovery-root-unavailable"
	| "user-data-unavailable";

export interface DurabilityCapabilityResult {
	supported: boolean;
	failures: DurabilityCapabilityFailure[];
	platform: string;
	recoveryRootSelection?: RecoveryRootSelection;
	canonicalRecoveryRoot?: string;
	userDataPath?: string;
}

interface ElectronWindow {
	electron?: {
		remote?: {
			app?: {
				getPath?: (name: string) => string;
			};
		};
	};
}

export interface CapabilityDependencies {
	platform: string;
	homeDirectory: string;
	environment: Readonly<Record<string, string | undefined>>;
	open: unknown;
	readFile: unknown;
	readdir: unknown;
	lstat: unknown;
	realpath: unknown;
	mkdir: unknown;
	statfs: unknown;
	discoverUserDataPath: () => string | null;
	resolveRecoveryRoot: (selection: RecoveryRootSelection) => Promise<string>;
}

const DEFAULT_DEPENDENCIES: CapabilityDependencies = {
	platform: process.platform,
	homeDirectory: homedir(),
	environment: process.env,
	open,
	readFile,
	readdir,
	lstat,
	realpath,
	mkdir,
	statfs,
	discoverUserDataPath: discoverObsidianUserDataPath,
	resolveRecoveryRoot: resolveUsableRecoveryRoot,
};

export async function detectDurabilityCapabilities(
	vault: Vault,
	overrides: Partial<CapabilityDependencies> = {}
): Promise<DurabilityCapabilityResult> {
	const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
	const failures: DurabilityCapabilityFailure[] = [];

	if (typeof vault.process !== "function") {
		failures.push("vault-process-unavailable");
	}

	const adapter = vault.adapter as unknown as Record<string, unknown> | undefined;
	const requiredAdapterMethods = ["exists", "getFullPath", "list", "mkdir", "read", "remove", "write"];
	if (!adapter || requiredAdapterMethods.some((name) => typeof adapter[name] !== "function")) {
		failures.push("vault-adapter-unavailable");
	}

	if ([dependencies.open, dependencies.readFile, dependencies.readdir, dependencies.lstat,
		dependencies.realpath, dependencies.mkdir].some((entry) => typeof entry !== "function")) {
		failures.push("node-filesystem-unavailable");
	}
	if (typeof dependencies.open !== "function") {
		failures.push("exclusive-create-unavailable", "file-sync-unavailable");
	}
	if (typeof dependencies.readFile !== "function") {
		failures.push("readback-unavailable");
	}
	if (typeof dependencies.statfs !== "function") {
		failures.push("statfs-unavailable");
	}

	let recoveryRootSelection: RecoveryRootSelection | undefined;
	let canonicalRecoveryRoot: string | undefined;
	try {
		recoveryRootSelection = selectRecoveryRoot({
			platform: dependencies.platform,
			homeDirectory: dependencies.homeDirectory,
			environment: dependencies.environment,
		});
		canonicalRecoveryRoot = await dependencies.resolveRecoveryRoot(recoveryRootSelection);
	} catch (error) {
		if (!(error instanceof RecoveryStorageError)) {
			console.error("Failed to inspect the Kindle Local Sync recovery root.", error);
		}
		failures.push("recovery-root-unavailable");
	}

	let userDataPath: string | undefined;
	try {
		const candidate = dependencies.discoverUserDataPath();
		if (candidate && isNormalizedAbsolutePath(candidate, dependencies.platform)) {
			userDataPath = candidate;
		} else {
			failures.push("user-data-unavailable");
		}
	} catch {
		failures.push("user-data-unavailable");
	}

	const uniqueFailures = [...new Set(failures)].sort();
	return {
		supported: uniqueFailures.length === 0,
		failures: uniqueFailures,
		platform: dependencies.platform,
		recoveryRootSelection,
		canonicalRecoveryRoot,
		userDataPath,
	};
}

export function createCapabilityMessage(result: DurabilityCapabilityResult): string {
	if (result.supported) {
		return "Kindle Local Sync durability capabilities are available.";
	}
	return "Kindle Local Sync needs a newer or compatible version of Obsidian before it can safely update your notes. Update Obsidian, then try again. Your notes were not changed.";
}

function discoverObsidianUserDataPath(): string | null {
	// This desktop bridge is optional; absence disables writes instead of falling back to an unsafe location.
	if (typeof window === "undefined") {
		return null;
	}
	const electronWindow = window as unknown as ElectronWindow;
	const getPath = electronWindow.electron?.remote?.app?.getPath;
	return typeof getPath === "function" ? getPath("userData") : null;
}

function isNormalizedAbsolutePath(value: string, platform: string): boolean {
	return platform === "win32"
		? win32.isAbsolute(value) && win32.normalize(value) === value
		: isAbsolute(value) && normalize(value) === value;
}
