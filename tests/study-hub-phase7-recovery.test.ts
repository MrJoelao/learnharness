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
import { createWorkspaceService } from "../src/server/workspaces.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-phase7-recovery-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const NOW = "2026-11-16T10:00:00.000Z";

function makeWsRecord(id: WorkspaceId, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	return parseWorkspaceRecord({
		version: 1,
		id,
		pluginId: "multi-mode",
		modeId: "recall-lab",
		title: "Recall Session",
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	});
}

// ─── 1. Real Restart & Workspace State Recovery ──────────────────────────────

it("restart recovery: persisted workspace metadata and plugin state survive complete store reconstruction", () => {
	const dataDir = path.join(root, "session-recovery");
	const workspacesDir = path.join(dataDir, "workspaces");
	const pluginsDir = path.join(dataDir, "plugins");
	fs.mkdirSync(workspacesDir, { recursive: true });
	fs.mkdirSync(pluginsDir, { recursive: true });

	const wsId = parseWorkspaceId("workspace_44444444-4444-4000-8000-444444444444");

	// Phase 1: Initialize first instance of store & service, create workspace and save plugin state
	{
		const store1 = createWorkspaceStore(workspacesDir);
		const service1 = createWorkspaceService({ store: store1 });
		const stateStore1 = createPluginWorkspaceStateStore(pluginsDir);

		const record = makeWsRecord(wsId, { title: "Persistent Recall Lab" });
		store1.create(record);

		const pluginDataDir = path.join(pluginsDir, "multi-mode", "data");
		const pluginState = stateStore1.open(pluginDataDir, wsId);
		pluginState.set("example", {
			createdFor: wsId,
			count: 42,
			notes: "Saved during run 1 before restart",
			history: [1, 5, 20, 42],
		});

		// Verify on-disk file writes occurred
		assert.ok(fs.existsSync(path.join(workspacesDir, `${wsId}.json`)));
		assert.ok(fs.existsSync(path.join(pluginDataDir, "workspaces", wsId, "example.json")));
	}

	// Phase 2: Simulate complete application restart (reconstruct brand-new store and service instances)
	{
		const store2 = createWorkspaceStore(workspacesDir);
		const service2 = createWorkspaceService({ store: store2 });
		const stateStore2 = createPluginWorkspaceStateStore();

		// Read back metadata
		const recoveredWs = service2.read(wsId);
		assert.ok(recoveredWs, "Workspace metadata must be recovered from disk");
		assert.equal(recoveredWs.id, wsId);
		assert.equal(recoveredWs.title, "Persistent Recall Lab");
		assert.equal(recoveredWs.pluginId, "multi-mode");
		assert.equal(recoveredWs.modeId, "recall-lab");

		// Read back plugin state
		const pluginDataDir = path.join(pluginsDir, "multi-mode", "data");
		const pluginState2 = stateStore2.open(pluginDataDir, wsId);
		const recoveredData = pluginState2.get("example") as any;

		assert.ok(recoveredData, "Plugin state must be recovered from disk");
		assert.equal(recoveredData.createdFor, wsId);
		assert.equal(recoveredData.count, 42);
		assert.equal(recoveredData.notes, "Saved during run 1 before restart");
		assert.deepEqual(recoveredData.history, [1, 5, 20, 42]);
	}
});

// ─── 2. Multiple Instances Isolation Across Restarts ─────────────────────────

it("multiple instances: distinct IDs and storage namespaces remain isolated across restarts", () => {
	const dataDir = path.join(root, "multi-instance-isolation");
	const workspacesDir = path.join(dataDir, "workspaces");
	const pluginsDir = path.join(dataDir, "plugins");

	const idA = parseWorkspaceId("workspace_aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa");
	const idB = parseWorkspaceId("workspace_bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb");

	// Step 1: Create both instances and write distinct state
	const pluginDataDir = path.join(pluginsDir, "multi-mode", "data");
	{
		const store = createWorkspaceStore(workspacesDir);
		const stateStore = createPluginWorkspaceStateStore();

		store.create(makeWsRecord(idA, { title: "Workspace Alpha" }));
		store.create(makeWsRecord(idB, { title: "Workspace Beta" }));

		stateStore.open(pluginDataDir, idA).set("example", { instance: "A", count: 10 });
		stateStore.open(pluginDataDir, idB).set("example", { instance: "B", count: 99 });
	}

	// Step 2: Reconstruct store after restart, mutate Alpha only
	{
		const storeAfterRestart = createWorkspaceStore(workspacesDir);
		const stateStoreAfterRestart = createPluginWorkspaceStateStore();

		const list = storeAfterRestart.list();
		assert.equal(list.workspaces.length, 2);

		const stateA = stateStoreAfterRestart.open(pluginDataDir, idA);
		const stateB = stateStoreAfterRestart.open(pluginDataDir, idB);

		assert.equal((stateA.get("example") as any)?.count, 10);
		assert.equal((stateB.get("example") as any)?.count, 99);

		// Mutate Alpha only
		stateA.set("example", { instance: "A", count: 11 });
	}

	// Step 3: Verify Beta was untouched
	{
		const storeFresh = createWorkspaceStore(workspacesDir);
		const stateStoreFresh = createPluginWorkspaceStateStore();

		const stateA = stateStoreFresh.open(pluginDataDir, idA);
		const stateB = stateStoreFresh.open(pluginDataDir, idB);

		assert.equal((stateA.get("example") as any)?.count, 11);
		assert.equal((stateB.get("example") as any)?.count, 99, "Beta must retain its independent state");
	}
});

// ─── 3. Metadata Versioning and Forward Compatibility ────────────────────────

it("metadata versioning: record with newer unknown version is not overwritten and preserves data", () => {
	const dataDir = path.join(root, "version-hardening");
	const workspacesDir = path.join(dataDir, "workspaces");
	fs.mkdirSync(workspacesDir, { recursive: true });

	const store = createWorkspaceStore(workspacesDir);

	// Create valid record
	const validId = parseWorkspaceId("workspace_10000000-0000-4000-8000-000000000001");
	store.create(makeWsRecord(validId, { title: "Current V1 Workspace" }));

	// Write future record with version 99 directly
	const futureId = parseWorkspaceId("workspace_99999999-9999-4000-8000-999999999999");
	const futureRecord = {
		version: 99,
		id: futureId,
		pluginId: "multi-mode",
		modeId: "recall-lab",
		title: "Future Format Workspace",
		createdAt: NOW,
		updatedAt: NOW,
		futureProtocolCapabilities: ["quantum-memory", "ai-co-pilot-v9"],
	};
	fs.writeFileSync(path.join(workspacesDir, `${futureId}.json`), JSON.stringify(futureRecord, null, 2), "utf8");

	// Add futureId to index
	const indexPath = path.join(workspacesDir, "index.json");
	const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	index.workspaceIds.push(futureId);
	fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");

	// Store list should report issue for future record without throwing or hiding valid record
	const listing = store.list();
	assert.equal(listing.workspaces.length, 1);
	assert.equal(listing.workspaces[0]!.id, validId);
	assert.equal(listing.issues.length, 1);
	assert.equal(listing.issues[0]!.kind, "invalid-record");
	assert.equal(listing.issues[0]!.id, futureId);

	// Reading future record directly throws rather than returning invalid data
	assert.throws(
		() => store.read(futureId),
		/Could not read workspace record/i,
	);

	// Destructive write/overwrite of future record is refused
	assert.throws(
		() => store.update({ ...makeWsRecord(validId), id: futureId, title: "Malicious Overwrite" }),
		/Cannot update workspace record.*its data is invalid or newer/i,
	);

	// Original future file on disk remains completely intact
	const rawFuture = JSON.parse(fs.readFileSync(path.join(workspacesDir, `${futureId}.json`), "utf8"));
	assert.equal(rawFuture.version, 99);
	assert.deepEqual(rawFuture.futureProtocolCapabilities, ["quantum-memory", "ai-co-pilot-v9"]);
});

// ─── 4. Failure Recovery Mechanisms ──────────────────────────────────────────

it("failure recovery: orphan records and missing references are inspectable and reconcilable", () => {
	const dataDir = path.join(root, "failure-reconciliation");
	const workspacesDir = path.join(dataDir, "workspaces");
	fs.mkdirSync(workspacesDir, { recursive: true });

	const store = createWorkspaceStore(workspacesDir);

	// 1. Create a valid indexed workspace
	const validId = parseWorkspaceId("workspace_55555555-5555-4000-8000-555555555555");
	store.create(makeWsRecord(validId, { title: "Good WS" }));

	// 2. Create an orphan record on disk (simulate interrupted index write during creation)
	const orphanId = parseWorkspaceId("workspace_66666666-6666-4000-8000-666666666666");
	const orphanRecord = makeWsRecord(orphanId, { title: "Orphan WS" });
	fs.writeFileSync(path.join(workspacesDir, `${orphanId}.json`), JSON.stringify(orphanRecord), "utf8");

	// 3. Add a phantom reference to index (simulate interrupted file deletion)
	const missingId = parseWorkspaceId("workspace_77777777-7777-4000-8000-777777777777");
	const indexPath = path.join(workspacesDir, "index.json");
	const indexData = JSON.parse(fs.readFileSync(indexPath, "utf8"));
	indexData.workspaceIds.push(missingId);
	fs.writeFileSync(indexPath, JSON.stringify(indexData), "utf8");

	// Inspect issues without destructive changes
	const inspection = store.inspect();
	assert.deepEqual(inspection.orphanIds, [orphanId]);
	assert.deepEqual(inspection.missingIds, [missingId]);

	// Reconcile orphan: recover into index
	store.recoverOrphan(orphanId);
	// Reconcile missing reference: remove from index
	store.removeMissingReference(missingId);

	// Verify restored state
	const cleanedList = store.list();
	assert.equal(cleanedList.workspaces.length, 2);
	assert.ok(cleanedList.workspaces.some(w => w.id === validId));
	assert.ok(cleanedList.workspaces.some(w => w.id === orphanId));
	assert.equal(cleanedList.issues.length, 0);
});
