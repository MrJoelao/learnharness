import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

import {
	parseWorkspaceId,
	parseWorkspaceRecord,
	resolveWorkspaceAvailability,
	type WorkspaceId,
	type WorkspaceRecord,
	type WorkspacePluginSnapshot,
} from "../src/core/workspaces.ts";
import { createWorkspaceStore } from "../src/store/workspaces.ts";
import { createPluginWorkspaceStateStore } from "../src/store/plugin-workspace-state.ts";
import { createPluginHost } from "../src/server/plugin-host.ts";
import { createWorkspaceService } from "../src/server/workspaces.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phase7-lifecycle-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function createTestEnvironment(testName: string) {
	const dir = path.join(root, testName);
	const pluginsDir = path.join(dir, "plugins");
	const workspacesDir = path.join(dir, "workspaces");
	fs.mkdirSync(pluginsDir, { recursive: true });
	fs.mkdirSync(workspacesDir, { recursive: true });

	const store = createWorkspaceStore(workspacesDir);
	const service = createWorkspaceService({ store });
	const stateStore = createPluginWorkspaceStateStore();

	const host = createPluginHost({
		directory: pluginsDir,
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: stateStore,
		createServices: () => ({} as any),
	});

	return { dir, pluginsDir, workspacesDir, store, service, stateStore, host };
}

function getHostPluginSnapshot(host: any): WorkspacePluginSnapshot[] {
	const plugins = host.list();
	const modes = host.modes();
	return plugins.map((p: any) => ({
		id: p.id,
		enabled: p.enabled && p.status === "active",
		modeIds: modes.filter((m: any) => m.pluginId === p.id).map((m: any) => m.id),
	}));
}

// ─── 1. Plugin Disable & Re-Enable Full Lifecycle ────────────────────────────

it("lifecycle: plugin disable hides modes, preserves workspaces and state, and re-enable restores availability", async () => {
	const env = createTestEnvironment("disable-enable-flow");

	// Install multi-mode plugin with manifest in dist/
	const pluginDist = path.join(env.pluginsDir, "sample-plugin", "dist");
	fs.mkdirSync(pluginDist, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDist, "manifest.json"),
		JSON.stringify({
			apiVersion: 1,
			id: "sample-plugin",
			name: "Sample Multi-Mode Plugin",
			version: "1.0.0",
			minAppVersion: "0.7.0",
			backend: "backend.cjs",
		}),
	);

	// Backend registering two modes
	fs.writeFileSync(
		path.join(pluginDist, "backend.cjs"),
		`exports.activate = ctx => {
			ctx.registerMode({
				id: "mode-alpha",
				name: "Mode Alpha",
				description: "First Mode",
				category: "Practice",
				icon: "Brain",
				initializeWorkspace({ workspace, storage }) {
					storage.set("state", { instance: workspace.id, val: 100 });
				},
			});
			ctx.registerMode({
				id: "mode-beta",
				name: "Mode Beta",
				description: "Second Mode",
				category: "Visual",
				icon: "Network",
				initializeWorkspace({ workspace, storage }) {
					storage.set("state", { instance: workspace.id, val: 200 });
				},
			});
		};`,
	);

	await env.host.initialize();
	await env.host.setEnabled("sample-plugin", true);

	// 1. Verify modes appear in catalog
	const activeModes = env.host.modes();
	assert.equal(activeModes.length, 2);
	assert.ok(activeModes.some(m => m.id === "mode-alpha"));
	assert.ok(activeModes.some(m => m.id === "mode-beta"));

	// 2. Create two workspaces and save distinct data in each
	const ws1 = await env.host.createWorkspace({
		pluginId: "sample-plugin",
		modeId: "mode-alpha",
		title: "Alpha Instance",
	});
	const ws2 = await env.host.createWorkspace({
		pluginId: "sample-plugin",
		modeId: "mode-beta",
		title: "Beta Instance",
	});

	const pluginDataDir = path.join(env.pluginsDir, "sample-plugin", "data");
	const state1 = env.stateStore.open(pluginDataDir, ws1.id);
	const state2 = env.stateStore.open(pluginDataDir, ws2.id);

	state1.set("state", { instance: ws1.id, val: 101, custom: "State 1" });
	state2.set("state", { instance: ws2.id, val: 202, custom: "State 2" });

	// 3. Disable the plugin
	await env.host.setEnabled("sample-plugin", false);

	// 4. Verify modes disappear from catalog
	assert.equal(env.host.modes().length, 0, "Catalog must have 0 active modes when plugin is disabled");

	// 5. Verify workspaces remain in the directory and are not deleted
	const directory = env.service.list();
	assert.equal(directory.workspaces.length, 2, "Workspaces must not be deleted from directory");
	assert.ok(directory.workspaces.some(w => w.id === ws1.id));
	assert.ok(directory.workspaces.some(w => w.id === ws2.id));

	// 6. Verify data on disk is preserved
	assert.ok(fs.existsSync(path.join(env.workspacesDir, `${ws1.id}.json`)));
	assert.ok(fs.existsSync(path.join(env.workspacesDir, `${ws2.id}.json`)));
	assert.ok(fs.existsSync(path.join(pluginDataDir, "workspaces", ws1.id, "state.json")));
	assert.ok(fs.existsSync(path.join(pluginDataDir, "workspaces", ws2.id, "state.json")));

	// 7. Verify availability resolution shows 'plugin-disabled'
	const snapshotDisabled = getHostPluginSnapshot(env.host);
	assert.equal(resolveWorkspaceAvailability(ws1, snapshotDisabled), "plugin-disabled");
	assert.equal(resolveWorkspaceAvailability(ws2, snapshotDisabled), "plugin-disabled");

	// 8. Re-enable plugin
	await env.host.setEnabled("sample-plugin", true);

	// 9. Modes are registered again
	assert.equal(env.host.modes().length, 2);

	// 10. Workspaces are once again available
	const snapshotEnabled = getHostPluginSnapshot(env.host);
	assert.equal(resolveWorkspaceAvailability(ws1, snapshotEnabled), "available");
	assert.equal(resolveWorkspaceAvailability(ws2, snapshotEnabled), "available");

	// 11. State is read back intact with original data
	const restoredState1 = env.stateStore.open(pluginDataDir, ws1.id).get("state") as any;
	const restoredState2 = env.stateStore.open(pluginDataDir, ws2.id).get("state") as any;

	assert.equal(restoredState1?.val, 101);
	assert.equal(restoredState1?.custom, "State 1");
	assert.equal(restoredState2?.val, 202);
	assert.equal(restoredState2?.custom, "State 2");

	await env.host.dispose();
});

// ─── 2. Missing / Uninstalled Plugin Preservation ────────────────────────────

it("lifecycle: uninstalled/missing plugin retains workspace metadata and plugin data as recoverable", () => {
	const env = createTestEnvironment("missing-plugin-test");

	const missingId = parseWorkspaceId("workspace_98765432-1234-4000-8000-123456789abc");
	const record = parseWorkspaceRecord({
		version: 1,
		id: missingId,
		pluginId: "nonexistent-plugin",
		modeId: "special-mode",
		title: "Orphaned Workspace",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	env.store.create(record);

	// Save plugin data in the expected directory
	const pluginDataDir = path.join(env.pluginsDir, "nonexistent-plugin", "data");
	env.stateStore.open(pluginDataDir, missingId).set("saved-progress", { score: 95 });

	// Availability resolution with empty snapshots
	const availability = resolveWorkspaceAvailability(record, []);
	assert.equal(availability, "plugin-missing");

	// Verify workspace is NOT deleted or automatically remapped to another mode
	const listed = env.service.list().workspaces;
	assert.equal(listed.length, 1);
	assert.equal(listed[0]!.id, missingId);
	assert.equal(listed[0]!.pluginId, "nonexistent-plugin");
	assert.equal(listed[0]!.modeId, "special-mode");

	// Data is intact
	assert.equal((env.stateStore.open(pluginDataDir, missingId).get("saved-progress") as any)?.score, 95);
});

// ─── 3. Async Lifecycle Safety ───────────────────────────────────────────────

it("lifecycle: stale async mode registration and repeated cleanup do not corrupt host state", async () => {
	const env = createTestEnvironment("async-safety-test");

	let unregisterFn: (() => void) | null = null;

	const pluginDist = path.join(env.pluginsDir, "async-plugin", "dist");
	fs.mkdirSync(pluginDist, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDist, "manifest.json"),
		JSON.stringify({
			apiVersion: 1,
			id: "async-plugin",
			name: "Async Plugin",
			version: "1.0.0",
			minAppVersion: "0.7.0",
			backend: "backend.cjs",
		}),
	);

	fs.writeFileSync(
		path.join(pluginDist, "backend.cjs"),
		`exports.activate = ctx => {
			globalThis.__asyncPluginContext = ctx;
		};`,
	);

	await env.host.initialize();
	await env.host.setEnabled("async-plugin", true);

	const capturedCtx = (globalThis as any).__asyncPluginContext;
	assert.ok(capturedCtx, "Backend activation must provide context");

	// Normal registration
	unregisterFn = capturedCtx.registerMode({
		id: "sync-mode",
		name: "Sync Mode",
		description: "Synchronous registration",
		category: "Practice",
		initializeWorkspace() {},
	});
	assert.equal(env.host.modes().length, 1);

	// Disable plugin (revokes lifecycle scope)
	await env.host.setEnabled("async-plugin", false);
	assert.equal(env.host.modes().length, 0);

	// Late async attempt to register a mode after revocation must fail or be rejected
	assert.throws(
		() => {
			capturedCtx.registerMode({
				id: "ghost-mode",
				name: "Ghost Mode",
				description: "Stale async attempt",
				category: "Practice",
				initializeWorkspace() {},
			});
		},
		/revoked|inactive|disabled|not active|stale|error/i,
	);

	// Catalog must remain clean (0 modes)
	assert.equal(env.host.modes().length, 0, "No ghost mode may appear");

	// Repeated call to unregisterFn must be a safe idempotent no-op
	assert.doesNotThrow(() => {
		if (unregisterFn) {
			unregisterFn();
			unregisterFn();
		}
	});

	delete (globalThis as any).__asyncPluginContext;
	await env.host.dispose();
});
