import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "../__mocks__/obsidian";
import { CurrentClippingIdentityIndex } from "./sync/HighlightIdentity";

const mocks = vi.hoisted(() => ({
	inspectFoundation: vi.fn(),
	writeBookNotesToVault: vi.fn(),
	cleanupIgnoredBlocks: vi.fn(),
}));

vi.mock("./durability/Foundation", () => ({
	inspectDurabilityFoundation: mocks.inspectFoundation,
}));

vi.mock("./sync/VaultWriter", async () => {
	const actual = await vi.importActual<typeof import("./sync/VaultWriter")>("./sync/VaultWriter");
	return { ...actual, writeBookNotesToVault: mocks.writeBookNotesToVault };
});

vi.mock("./sync/IgnoredHighlightCleanup", () => ({
	removeIgnoredHighlightBlocksFromExistingNotes: mocks.cleanupIgnoredBlocks,
}));

let KindleLocalSyncPlugin: typeof import("./main").default;
let DurabilityWriteBlockedError: typeof import("./main").DurabilityWriteBlockedError;

beforeAll(async () => {
	const main = await import("./main");
	KindleLocalSyncPlugin = main.default;
	DurabilityWriteBlockedError = main.DurabilityWriteBlockedError;
});

beforeEach(() => {
	vi.clearAllMocks();
	Notice.messages.length = 0;
	mocks.inspectFoundation.mockResolvedValue(blockedFoundation());
	mocks.writeBookNotesToVault.mockResolvedValue(emptyWriteSummary());
	mocks.cleanupIgnoredBlocks.mockResolvedValue(emptyCleanupSummary());
});

describe("production durability gating", () => {
	it("blocks a direct write before onload with zero note and data writes", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);

		await expect(plugin.saveSettings()).rejects.toBeInstanceOf(DurabilityWriteBlockedError);

		expectDataWriteCount(plugin).toBe(0);
		expectNoWrites(vault);
		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
		expect(mocks.cleanupIgnoredBlocks).not.toHaveBeenCalled();
	});

	it("blocks a direct write while onload evidence inspection is pending", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		const inspection = deferred<ReturnType<typeof safeFoundation>>();
		mocks.inspectFoundation.mockReturnValueOnce(inspection.promise);

		const loading = plugin.onload();
		await expect(plugin.saveSettings()).rejects.toBeInstanceOf(DurabilityWriteBlockedError);
		expectDataWriteCount(plugin).toBe(0);
		expectNoWrites(vault);

		inspection.resolve(safeFoundation());
		await loading;
	});

	it("keeps status and settings surfaces available after failed initialization", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		mocks.inspectFoundation.mockRejectedValueOnce(new Error("inspection failed"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await plugin.onload();
		await expect(plugin.saveSettings()).rejects.toBeInstanceOf(DurabilityWriteBlockedError);

		const state = pluginState(plugin);
		expect(state.commands.map((command) => command.id)).toEqual(["show-recovery-status"]);
		expect(state.ribbonIcons).toEqual([]);
		expect(state.settingTabs).toHaveLength(1);
		expectDataWriteCount(plugin).toBe(0);
		expectNoWrites(vault);
		consoleError.mockRestore();
	});

	it("preserves the existing commands and ribbon on safe no-evidence startup", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		mocks.inspectFoundation.mockResolvedValue(safeFoundation());

		await plugin.onload();

		const state = pluginState(plugin);
		expect(state.commands.map((command) => command.id)).toEqual([
			"sync-local-kindle-highlights",
			"show-ignored-highlights",
		]);
		expect(state.ribbonIcons).toHaveLength(1);
		expect(state.settingTabs).toHaveLength(1);
		expect(Notice.messages).toEqual([]);
		expectNoWrites(vault);
	});

	it("rechecks a queued settings mutation and writes no data after evidence becomes unsafe", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		mocks.inspectFoundation.mockResolvedValue(safeFoundation());
		await plugin.onload();
		const firstSave = deferred<void>();
		const originalSaveData = plugin.saveData.bind(plugin);
		const saveData = vi.spyOn(plugin, "saveData").mockImplementationOnce(async (data) => {
			await originalSaveData(data);
			await firstSave.promise;
		});

		const firstRequest = plugin.saveSettings();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		const secondRequest = plugin.saveSettings();
		await vi.waitFor(() => expect(mocks.inspectFoundation).toHaveBeenCalledTimes(6));
		mocks.inspectFoundation.mockResolvedValue(blockedFoundation());
		firstSave.resolve();

		await firstRequest;
		await expect(secondRequest).rejects.toBeInstanceOf(DurabilityWriteBlockedError);
		expect(saveData).toHaveBeenCalledTimes(1);
		expectNoWrites(vault);
	});

	it("rechecks immediately before the note writer", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		mocks.inspectFoundation.mockResolvedValue(safeFoundation());
		await plugin.onload();
		mocks.inspectFoundation
			.mockResolvedValueOnce(safeFoundation())
			.mockResolvedValueOnce(blockedFoundation());

		await expect(plugin.importHighlights([], new CurrentClippingIdentityIndex([]), false))
			.rejects.toBeInstanceOf(DurabilityWriteBlockedError);

		expect(mocks.writeBookNotesToVault).not.toHaveBeenCalled();
		expectDataWriteCount(plugin).toBe(0);
		expectNoWrites(vault);
	});

	it("rechecks immediately before existing-note cleanup", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);
		mocks.inspectFoundation.mockResolvedValue(safeFoundation());
		await plugin.onload();
		mocks.inspectFoundation.mockResolvedValue(blockedFoundation());

		await expect((plugin as unknown as {
			cleanupIgnoredHighlightBlocks(targets: unknown[]): Promise<unknown>;
		}).cleanupIgnoredHighlightBlocks([])).rejects.toBeInstanceOf(DurabilityWriteBlockedError);

		expect(mocks.cleanupIgnoredBlocks).not.toHaveBeenCalled();
		expectDataWriteCount(plugin).toBe(0);
		expectNoWrites(vault);
	});

	it("registers only read-only status/settings surfaces when capabilities fail", async () => {
		const vault = createWriteTrackingVault();
		const plugin = createPlugin(vault);

		await plugin.onload();

		const state = pluginState(plugin);
		expect(state.commands.map((command) => command.id)).toEqual(["show-recovery-status"]);
		expect(state.ribbonIcons).toEqual([]);
		expect(state.settingTabs).toHaveLength(1);
		expect(Notice.messages).toEqual([blockedFoundation().message]);
		expectNoWrites(vault);
	});
});

function createPlugin(vault: ReturnType<typeof createWriteTrackingVault>): InstanceType<typeof KindleLocalSyncPlugin> {
	return new KindleLocalSyncPlugin(new App(vault) as never, {} as never);
}

function createWriteTrackingVault() {
	return {
		create: vi.fn(),
		modify: vi.fn(),
		process: vi.fn(),
		configDir: ".vault-config",
		adapter: {
			write: vi.fn(),
			remove: vi.fn(),
			mkdir: vi.fn(),
		},
	};
}

function pluginState(plugin: InstanceType<typeof KindleLocalSyncPlugin>) {
	return plugin as unknown as {
		commands: Array<{ id: string }>;
		ribbonIcons: unknown[];
		settingTabs: unknown[];
	};
}

function expectDataWriteCount(plugin: InstanceType<typeof KindleLocalSyncPlugin>) {
	return expect((plugin as unknown as { savedData: unknown }).savedData === null ? 0 : 1);
}

function expectNoWrites(vault: ReturnType<typeof createWriteTrackingVault>): void {
	expect(vault.create).not.toHaveBeenCalled();
	expect(vault.modify).not.toHaveBeenCalled();
	expect(vault.process).not.toHaveBeenCalled();
	expect(vault.adapter.write).not.toHaveBeenCalled();
	expect(vault.adapter.remove).not.toHaveBeenCalled();
	expect(vault.adapter.mkdir).not.toHaveBeenCalled();
}

function safeFoundation() {
	return {
		writeAllowed: true,
		message: "Kindle Local Sync recovery evidence is clear.",
		capabilities: { supported: true, failures: [], platform: "darwin" },
		classification: {
			kind: "no-evidence",
			status: "clear",
			issues: [],
			originInstanceIds: [],
			completedTransactionIds: [],
		},
	};
}

function blockedFoundation() {
	return {
		writeAllowed: false,
		message: "Kindle Local Sync needs a newer or compatible version of Obsidian before it can safely update your notes. Update Obsidian, then try again. Your notes were not changed.",
		capabilities: {
			supported: false,
			failures: ["vault-process-unavailable"],
			platform: "darwin",
		},
	};
}

function emptyWriteSummary() {
	return {
		books: 0,
		filesCreated: 0,
		filesUpdated: 0,
		filesUnchanged: 0,
		filesProtected: 0,
		highlightsRendered: 0,
		duplicatesSkipped: 0,
		bookOutcomes: [],
	};
}

function emptyCleanupSummary() {
	return { filesScanned: 0, filesUpdated: 0, blocksRemoved: 0, bookOutcomes: [] };
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
