import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

import {
	parseWorkspaceId,
	parseWorkspaceRecord,
	type WorkspaceId,
	type WorkspaceRecord,
} from "../src/core/workspaces.ts";
import { createWorkspaceStore } from "../src/store/workspaces.ts";
import { createPluginWorkspaceStateStore } from "../src/store/plugin-workspace-state.ts";
import { createPluginHost } from "../src/server/plugin-host.ts";
import { createWorkspaceService } from "../src/server/workspaces.ts";
import {
	createDirectoryService,
	configureDirectoryAvailabilityResolver,
} from "../src/server/directory.ts";
import { recoverPluginTaskRecords, createPluginTaskRecordStore } from "../src/store/plugin-task-records.ts";
import { subscribe, type ServerEvent } from "../src/core/events.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-study-hub-avail-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function setupFixture(name: string) {
	const dir = path.join(root, name);
	const pluginsDir = path.join(dir, "plugins");
	const pluginDataDir = path.join(dir, "plugin-data");
	const workspacesDir = path.join(dir, "workspaces");
	const orgDir = path.join(dir, "org");

	fs.mkdirSync(pluginsDir, { recursive: true });
	fs.mkdirSync(pluginDataDir, { recursive: true });
	fs.mkdirSync(workspacesDir, { recursive: true });
	fs.mkdirSync(orgDir, { recursive: true });

	const workspaceStore = createWorkspaceStore(workspacesDir);
	const workspaceService = createWorkspaceService({ store: workspaceStore });
	const workspaceStateStore = createPluginWorkspaceStateStore();

	let orgState = {
		version: 2 as const,
		folders: [],
		placements: {},
	};
	const orgStore = {
		read: () => structuredClone(orgState),
		write: (next: any) => {
			orgState = structuredClone(next);
		},
	};
	const chatStore = {
		listChats: () => [],
	} as any;

	return {
		dir,
		pluginsDir,
		pluginDataDir,
		workspacesDir,
		workspaceStore,
		workspaceService,
		workspaceStateStore,
		orgStore,
		chatStore,
	};
}

function writePlugin(
	pluginsDir: string,
	id: string,
	modeId: string,
	options: { modeName?: string; backendCode?: string } = {},
) {
	const pluginDist = path.join(pluginsDir, id, "dist");
	fs.mkdirSync(pluginDist, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDist, "manifest.json"),
		JSON.stringify({
			apiVersion: 1,
			id,
			name: options.modeName ?? "Test Mode",
			version: "1.0.0",
			minAppVersion: "0.7.0",
			backend: "backend.cjs",
		}),
	);

	const code =
		options.backendCode ??
		`exports.activate = ctx => ctx.registerMode({
			id: "${modeId}",
			name: "${options.modeName ?? "Test Mode"}",
			description: "Test description",
			category: "Practice",
			initializeWorkspace({ storage }) {
				storage.set("state", { initialized: true });
			}
		});`;

	fs.writeFileSync(path.join(pluginDist, "backend.cjs"), code);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Plugin installato, abilitato e mode registrato → workspace available
// ─────────────────────────────────────────────────────────────────────────────

it("1. installed, enabled plugin with registered mode resolves workspace as available", async () => {
	const f = setupFixture("case-1");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab", { modeName: "Concurrency Lab" });

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();
	await host.setEnabled("concurrency-lab", true);

	const ws = await host.createWorkspace({
		pluginId: "concurrency-lab",
		modeId: "concurrency-lab",
		title: "My Concurrency Lab",
	});

	assert.equal(host.workspaceAvailability(ws), "available");

	// Wire directory service through configureDirectoryAvailabilityResolver
	configureDirectoryAvailabilityResolver((record) => host.workspaceAvailability(record));

	const directory = createDirectoryService({
		chatStore: f.chatStore,
		workspaceStore: f.workspaceStore,
		organizationStore: f.orgStore,
		resolveAvailability: (record) => host.workspaceAvailability(record),
	});

	const dir = directory.read();
	const wsEntry = dir.items.find((item) => item.id === ws.id);
	assert.ok(wsEntry && wsEntry.kind === "workspace");
	assert.equal(wsEntry.availability, "available");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Plugin realmente assente → workspace plugin-missing
// ─────────────────────────────────────────────────────────────────────────────

it("2. absent plugin resolves workspace as plugin-missing", async () => {
	const f = setupFixture("case-2");

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();

	const orphanWs = parseWorkspaceRecord({
		version: 1,
		id: parseWorkspaceId("workspace_11111111-1111-4000-8000-111111111111"),
		pluginId: "missing-plugin",
		modeId: "any-mode",
		title: "Orphan",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	assert.equal(host.workspaceAvailability(orphanWs), "plugin-missing");

	const directory = createDirectoryService({
		chatStore: f.chatStore,
		workspaceStore: { list: () => ({ workspaces: [orphanWs], issues: [] }) } as any,
		organizationStore: f.orgStore,
		resolveAvailability: (record) => host.workspaceAvailability(record),
	});

	const dir = directory.read();
	const wsEntry = dir.items.find((item) => item.id === orphanWs.id);
	assert.ok(wsEntry && wsEntry.kind === "workspace");
	assert.equal(wsEntry.availability, "plugin-missing");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Plugin installato ma disabilitato → workspace plugin-disabled
// ─────────────────────────────────────────────────────────────────────────────

it("3. installed but disabled plugin resolves workspace as plugin-disabled", async () => {
	const f = setupFixture("case-3");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab");

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();
	await host.setEnabled("concurrency-lab", true);

	const ws = await host.createWorkspace({
		pluginId: "concurrency-lab",
		modeId: "concurrency-lab",
	});

	assert.equal(host.workspaceAvailability(ws), "available");

	// Disable plugin
	await host.setEnabled("concurrency-lab", false);

	assert.equal(host.workspaceAvailability(ws), "plugin-disabled");

	const directory = createDirectoryService({
		chatStore: f.chatStore,
		workspaceStore: f.workspaceStore,
		organizationStore: f.orgStore,
		resolveAvailability: (record) => host.workspaceAvailability(record),
	});

	const dir = directory.read();
	const wsEntry = dir.items.find((item) => item.id === ws.id);
	assert.ok(wsEntry && wsEntry.kind === "workspace");
	assert.equal(wsEntry.availability, "plugin-disabled");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Plugin presente ma mode non più registrato → workspace mode-missing
// ─────────────────────────────────────────────────────────────────────────────

it("4. installed plugin whose mode is no longer registered resolves as mode-missing", async () => {
	const f = setupFixture("case-4");
	// Backend registers mode A then removes it
	writePlugin(f.pluginsDir, "concurrency-lab", "mode-a", {
		backendCode: `
			let unreg;
			exports.activate = ctx => {
				unreg = ctx.registerMode({
					id: "mode-a",
					name: "Mode A",
					description: "Test",
					category: "Practice",
					initializeWorkspace() {}
				});
				ctx.handle("unregister-mode-a", () => {
					unreg();
					return { ok: true };
				});
			};
		`,
	});

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();
	await host.setEnabled("concurrency-lab", true);

	const ws = await host.createWorkspace({
		pluginId: "concurrency-lab",
		modeId: "mode-a",
	});
	assert.equal(host.workspaceAvailability(ws), "available");

	// Unregister mode-a
	await host.call("concurrency-lab", "unregister-mode-a", {});

	assert.equal(host.workspaceAvailability(ws), "mode-missing");

	const directory = createDirectoryService({
		chatStore: f.chatStore,
		workspaceStore: f.workspaceStore,
		organizationStore: f.orgStore,
		resolveAvailability: (record) => host.workspaceAvailability(record),
	});

	const dir = directory.read();
	const wsEntry = dir.items.find((item) => item.id === ws.id);
	assert.ok(wsEntry && wsEntry.kind === "workspace");
	assert.equal(wsEntry.availability, "mode-missing");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Plugin con ID valido e task storico malformato → recovery sicuro e non bloccato
// ─────────────────────────────────────────────────────────────────────────────

it("5. plugin with valid ID and malformed historic task has safe recovery and is not blocked", async () => {
	const f = setupFixture("case-5");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab");

	// Set up corrupt task record in concurrency-lab's data tasks directory
	const tasksDir = path.join(f.pluginDataDir, "concurrency-lab", "tasks");
	fs.mkdirSync(tasksDir, { recursive: true });
	fs.writeFileSync(path.join(tasksDir, "corrupted-task.json"), "{ invalid json");

	// Also simulate an invalid directory name in plugins (e.g. temporary unpack folder)
	const invalidFolder = path.join(f.pluginsDir, "concurrency-lab-0.1.1-dist");
	fs.mkdirSync(invalidFolder, { recursive: true });

	// Bootstrap task recovery sweep
	const recoveryErrors = recoverPluginTaskRecords(f.pluginsDir);
	assert.ok(recoveryErrors["concurrency-lab-0.1.1-dist"], "Diagnostic error recorded for invalid folder name");
	assert.match(recoveryErrors["concurrency-lab-0.1.1-dist"]!, /Invalid plugin id/);

	// Start plugin host with installation errors passed in
	const installationErrors: Record<string, string> = {};
	for (const [id, error] of Object.entries(recoveryErrors)) {
		installationErrors[id] = `Task recovery failed: ${error}`;
	}

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		installationErrors,
		createServices: () => ({} as any),
	});

	await host.initialize();

	// concurrency-lab was NOT blocked by the invalid folder or task recovery!
	const pkg = host.list().find((p) => p.id === "concurrency-lab");
	assert.ok(pkg, "concurrency-lab package found");
	assert.notEqual(pkg.status, "error", "concurrency-lab must not be blocked with status: error");

	// Enable and verify mode is available
	await host.setEnabled("concurrency-lab", true);
	assert.equal(host.list().find((p) => p.id === "concurrency-lab")?.status, "active");
	assert.ok(host.modes().some((m) => m.id === "concurrency-lab"), "concurrency-lab mode registered successfully");

	// Workspace can be created and is available
	const ws = await host.createWorkspace({
		pluginId: "concurrency-lab",
		modeId: "concurrency-lab",
	});
	assert.equal(host.workspaceAvailability(ws), "available");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Creazione di un workspace → pluginId persistito identico al plugin proprietario
// ─────────────────────────────────────────────────────────────────────────────

it("6. workspace creation persists pluginId identical to the owning plugin ID", async () => {
	const f = setupFixture("case-6");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab", { modeName: "Concurrency Lab" });

	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		createServices: () => ({} as any),
	});

	await host.initialize();
	await host.setEnabled("concurrency-lab", true);

	const ws = await host.createWorkspace({
		pluginId: "concurrency-lab",
		modeId: "concurrency-lab",
		title: "Thread Scheduling Workspace",
	});

	// Check returned record
	assert.equal(ws.pluginId, "concurrency-lab");
	assert.equal(ws.modeId, "concurrency-lab");
	assert.equal(ws.title, "Thread Scheduling Workspace");

	// Check persistent record on disk
	const onDisk = f.workspaceStore.read(ws.id);
	assert.ok(onDisk, "Workspace record exists on disk");
	assert.equal(onDisk.pluginId, "concurrency-lab", "Persistent pluginId matches exactly");
	assert.equal(onDisk.modeId, "concurrency-lab", "Persistent modeId matches exactly");

	// Check plugin workspace state namespace
	const state = f.workspaceStateStore.open(path.join(f.pluginDataDir, "concurrency-lab"), ws.id);
	assert.deepEqual(state.get("state"), { initialized: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Riavvio dell'app → workspace continua a essere risolto correttamente
// ─────────────────────────────────────────────────────────────────────────────

it("7. app restart retains workspace and continues resolving availability correctly", async () => {
	const f = setupFixture("case-7");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab");

	let wsId: WorkspaceId;

	// Initial session: create workspace
	{
		const host1 = createPluginHost({
			directory: f.pluginsDir,
			appVersion: "0.7.0",
			workspaces: f.workspaceService,
			workspaceStateStore: f.workspaceStateStore,
			createServices: () => ({} as any),
		});

		await host1.initialize();
		await host1.setEnabled("concurrency-lab", true);

		const ws1 = await host1.createWorkspace({
			pluginId: "concurrency-lab",
			modeId: "concurrency-lab",
			title: "Restart Persistence Test",
		});
		wsId = ws1.id;
		assert.equal(host1.workspaceAvailability(ws1), "available");
	}

	// Simulated App Restart: reconstruct all services and host from disk
	{
		const newWorkspaceStore = createWorkspaceStore(f.workspacesDir);
		const newWorkspaceService = createWorkspaceService({ store: newWorkspaceStore });
		const newStateStore = createPluginWorkspaceStateStore();

		const host2 = createPluginHost({
			directory: f.pluginsDir,
			appVersion: "0.7.0",
			workspaces: newWorkspaceService,
			workspaceStateStore: newStateStore,
			createServices: () => ({} as any),
		});

		await host2.initialize();

		// Check workspace record on disk
		const wsRecord = newWorkspaceStore.read(wsId);
		assert.ok(wsRecord, "Workspace record persisted across restart");
		assert.equal(wsRecord.pluginId, "concurrency-lab");

		// Availability resolves as available because enabled state is persisted
		assert.equal(host2.workspaceAvailability(wsRecord), "available");

		// Configure directory availability resolver
		configureDirectoryAvailabilityResolver((record) => host2.workspaceAvailability(record));

		const directory = createDirectoryService({
			chatStore: f.chatStore,
			workspaceStore: newWorkspaceStore,
			organizationStore: f.orgStore,
			resolveAvailability: (record) => host2.workspaceAvailability(record),
		});

		const dir = directory.read();
		const entry = dir.items.find((item) => item.id === wsId);
		assert.ok(entry && entry.kind === "workspace");
		assert.equal(entry.availability, "available", "Workspace in directory is available after restart");
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Event invalidation: setEnabled and refresh emit workspaces-changed
// ─────────────────────────────────────────────────────────────────────────────

it("event invalidation: host.setEnabled and host.refresh trigger onWorkspaceChanged", async () => {
	const f = setupFixture("case-events");
	writePlugin(f.pluginsDir, "concurrency-lab", "concurrency-lab");

	let workspaceChangedCount = 0;
	const host = createPluginHost({
		directory: f.pluginsDir,
		appVersion: "0.7.0",
		workspaces: f.workspaceService,
		workspaceStateStore: f.workspaceStateStore,
		onWorkspaceChanged: () => {
			workspaceChangedCount++;
		},
		createServices: () => ({} as any),
	});

	await host.initialize();
	const initialCount = workspaceChangedCount;

	await host.setEnabled("concurrency-lab", true);
	assert.equal(workspaceChangedCount, initialCount + 1, "setEnabled(true) triggered onWorkspaceChanged");

	await host.setEnabled("concurrency-lab", false);
	assert.equal(workspaceChangedCount, initialCount + 2, "setEnabled(false) triggered onWorkspaceChanged");

	await host.refresh();
	assert.equal(workspaceChangedCount, initialCount + 3, "refresh triggered onWorkspaceChanged");
});
