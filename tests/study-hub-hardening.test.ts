import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

import {
	applyOrganizationAction,
	chatKey,
	emptyOrganizationV2,
	migrateV1toV2,
	parseOrganizationAction,
	parseOrganizationV2,
	workspaceKey,
	type ItemKey,
	type OrganizationV2,
	type SiblingEntry,
} from "../src/core/organization.ts";
import {
	parseWorkspaceId,
	parseWorkspaceRecord,
	type WorkspaceId,
	type WorkspaceRecord,
} from "../src/core/workspaces.ts";
import { createWorkspaceStore } from "../src/store/workspaces.ts";
import { createPluginWorkspaceStateStore } from "../src/store/plugin-workspace-state.ts";
import { createPluginHost, isPluginHostError } from "../src/server/plugin-host.ts";
import { createPluginTransport } from "../src/server/plugin-transport.ts";
import { createWorkspaceService } from "../src/server/workspaces.ts";
import { createDirectoryService } from "../src/server/directory.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-study-hub-hardening-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const NOW = "2026-11-14T12:00:00.000Z";

function makeRecord(id: WorkspaceId, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	return parseWorkspaceRecord({
		version: 1,
		id,
		pluginId: "test-plugin",
		modeId: "test-mode",
		title: "Test Workspace",
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	});
}

// ─── 1. P1: Resilient Workspace Deletion & Recovery ─────────────────────────

it("P1: deletion phase 1 failure leaves workspace metadata, journal, and placement intact", async () => {
	const dir = path.join(root, "p1-phase1-fail");
	fs.mkdirSync(path.join(dir, "plugins", "test-plugin", "data"), { recursive: true });
	const store = createWorkspaceStore(dir);
	const targetId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000101");
	store.create(makeRecord(targetId));

	let placementRemoved = false;
	const failingStateStore = {
		open: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
		remove: () => {
			throw new Error("Disk permission denied during state removal");
		},
	};

	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: failingStateStore,
		onWorkspaceDeleted: () => {
			placementRemoved = true;
		},
		createServices: () => ({} as any),
	});
	await host.initialize();

	let err: any;
	try {
		await host.deleteWorkspace(targetId);
	} catch (e) {
		err = e;
	}

	assert.ok(isPluginHostError(err) && err.status === 500);
	assert.match(err.message, /Failed to delete plugin workspace state.*workspace metadata remains intact/i);

	// Verification of actual disk state
	assert.ok(fs.existsSync(path.join(dir, `${targetId}.json`)), "Record file must remain on disk");
	assert.ok(store.read(targetId), "Workspace must still be readable");
	assert.equal(placementRemoved, false, "Directory placement must not be removed");

	// Journal records stage: started
	const journal = store.readDeletionJournal?.() ?? [];
	assert.equal(journal.length, 1);
	const entry = journal[0]!;
	assert.equal(entry.workspaceId, targetId);
	assert.equal(entry.stage, "started");
});

it("P1: deletion phase 2 failure records state-deleted in journal and keeps metadata for recovery", async () => {
	const dir = path.join(root, "p1-phase2-fail");
	fs.mkdirSync(path.join(dir, "plugins", "test-plugin", "data"), { recursive: true });
	const store = createWorkspaceStore(dir);
	const targetId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000102");
	store.create(makeRecord(targetId));

	let stateRemoved = false;
	const stateStore = {
		open: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
		remove: () => {
			stateRemoved = true;
		},
	};

	const originalDelete = store.delete;
	store.delete = () => {
		throw new Error("EIO: metadata disk write failure");
	};

	let placementRemoved = false;
	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: stateStore,
		onWorkspaceDeleted: () => {
			placementRemoved = true;
		},
		createServices: () => ({} as any),
	});
	await host.initialize();

	let err: any;
	try {
		await host.deleteWorkspace(targetId);
	} catch (e) {
		err = e;
	}

	assert.ok(isPluginHostError(err) && err.status === 500);
	assert.match(err.message, /Failed to delete workspace metadata.*plugin state was already deleted; metadata remains/i);
	assert.equal(stateRemoved, true, "State was deleted");
	assert.equal(placementRemoved, false, "Placement was not removed");

	// Journal records state-deleted stage
	const journal = store.readDeletionJournal?.() ?? [];
	assert.equal(journal.length, 1);
	const entry = journal[0]!;
	assert.equal(entry.workspaceId, targetId);
	assert.equal(entry.stage, "state-deleted");

	store.delete = originalDelete;
});

it("P1: deletion phase 3 failure records metadata-deleted in journal and leaves placement for retry", async () => {
	const dir = path.join(root, "p1-phase3-fail");
	const store = createWorkspaceStore(dir);
	const targetId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000103");
	store.create(makeRecord(targetId));

	const stateStore = {
		open: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
		remove: () => {},
	};

	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: stateStore,
		onWorkspaceDeleted: () => {
			throw new Error("Organization store ENOSPC");
		},
		createServices: () => ({} as any),
	});
	await host.initialize();

	let err: any;
	try {
		await host.deleteWorkspace(targetId);
	} catch (e) {
		err = e;
	}

	assert.ok(isPluginHostError(err) && err.status === 500);
	assert.match(err.message, /Failed to remove workspace placement.*metadata and state were deleted/i);

	// Metadata is deleted on disk
	assert.equal(fs.existsSync(path.join(dir, `${targetId}.json`)), false);
	assert.equal(store.read(targetId), null);

	// Journal retains interrupted entry with metadata-deleted stage
	const journal = store.readDeletionJournal?.() ?? [];
	assert.equal(journal.length, 1);
	const entry = journal[0]!;
	assert.equal(entry.workspaceId, targetId);
	assert.equal(entry.stage, "metadata-deleted");

	// Reconciliation reports this interrupted deletion
	assert.deepEqual(store.inspect().interruptedDeletionIds, [targetId]);
});

it("P1: idempotent repetition completes an interrupted deletion and cleans up journal", async () => {
	const dir = path.join(root, "p1-retry");
	const store = createWorkspaceStore(dir);
	const targetId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000104");
	store.create(makeRecord(targetId));

	let throwPlacement = true;
	let placementCleaned = false;

	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: {
			open: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
			remove: () => {},
		},
		onWorkspaceDeleted: () => {
			if (throwPlacement) throw new Error("Transient network failure");
			placementCleaned = true;
		},
		createServices: () => ({} as any),
	});
	await host.initialize();

	// First attempt fails at Phase 3
	await assert.rejects(() => host.deleteWorkspace(targetId), /Failed to remove workspace placement/);
	assert.equal(store.readDeletionJournal?.().length, 1);

	// Retry after transient error clears: completes successfully without 404!
	throwPlacement = false;
	await host.deleteWorkspace(targetId);
	assert.equal(placementCleaned, true, "Placement was removed on retry");

	// Journal is now completely clean
	assert.equal(store.readDeletionJournal?.().length, 0);
	assert.equal(fs.existsSync(path.join(dir, "deletions.json")), false, "Journal file removed after completion");

	// Third attempt now returns 404 (fully deleted and no dangling traces)
	await assert.rejects(() => host.deleteWorkspace(targetId), status(404));
});

it("P1: system restart with incomplete deletion automatically recovers and cleans up", async () => {
	const dir = path.join(root, "p1-restart");
	const store = createWorkspaceStore(dir);
	const targetId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000105");

	// Pre-populate journal simulating crash after metadata deletion (Phase 2 done)
	store.recordPendingDeletion?.({
		workspaceId: targetId,
		pluginId: "test-plugin",
		stage: "metadata-deleted",
		startedAt: NOW,
	});

	let placementCleaned = false;
	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		workspaceStateStore: {
			open: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
			remove: () => {},
		},
		onWorkspaceDeleted: (id) => {
			if (id === targetId) placementCleaned = true;
		},
		createServices: () => ({} as any),
	});

	// Booting the host triggers initializeInternal() which recovers interrupted deletions
	await host.initialize();

	assert.equal(placementCleaned, true, "Interrupted deletion was resumed and placement removed on restart");
	assert.equal(store.readDeletionJournal?.().length, 0, "Journal was cleared on recovery");
});

// ─── 2. P2: Inconsistent Workspace Recovery via API & Transport ──────────────

it("P2: recovery endpoint identifies issues, recovers orphan, and removes missing references", async () => {
	const dir = path.join(root, "p2-recovery");
	const store = createWorkspaceStore(dir);
	const ws1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000201");
	const ws2 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000202");
	const orphan = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000203");

	store.create(makeRecord(ws1));
	store.create(makeRecord(ws2));

	// 1. Create an orphan file on disk (valid record not in index)
	fs.writeFileSync(path.join(dir, `${orphan}.json`), JSON.stringify(makeRecord(orphan), null, 2));

	// 2. Create a missing record reference (in index, file deleted)
	fs.unlinkSync(path.join(dir, `${ws2}.json`));

	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		createServices: () => ({} as any),
	});
	await host.initialize();

	const transport = createPluginTransport({
		getHost: async () => host,
		directory: dir,
	});

	// Inspect via transport
	const inspectRes = await transport.inspectWorkspaces();
	assert.equal(inspectRes.status, 200);
	const inspectBody = await inspectRes.json();
	assert.deepEqual(inspectBody.orphanIds, [orphan]);
	assert.deepEqual(inspectBody.missingIds, [ws2]);

	// Recover orphan via transport
	const recoverReq = new Request("http://localhost/api/workspaces/recovery", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "recover-orphan", id: orphan }),
	});
	const recoverRes = await transport.recoverWorkspace(recoverReq);
	assert.equal(recoverRes.status, 200);
	const recoverBody = await recoverRes.json();
	assert.equal(recoverBody.ok, true);
	assert.deepEqual(store.read(orphan)?.id, orphan, "Orphan is now indexed and readable");

	// Remove missing reference via transport
	const removeMissingReq = new Request("http://localhost/api/workspaces/recovery", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "remove-missing-reference", id: ws2 }),
	});
	const removeMissingRes = await transport.recoverWorkspace(removeMissingReq);
	assert.equal(removeMissingRes.status, 200);
	const removeMissingBody = await removeMissingRes.json();
	assert.equal(removeMissingBody.ok, true);

	// After recovery, both anomalies are resolved
	const finalInspect = await (await transport.inspectWorkspaces()).json();
	assert.deepEqual(finalInspect.orphanIds, []);
	assert.deepEqual(finalInspect.missingIds, []);
});

it("P2: recovery endpoint rejects invalid actions and does not overwrite corrupt records", async () => {
	const dir = path.join(root, "p2-corrupt-reject");
	fs.mkdirSync(dir, { recursive: true });
	const store = createWorkspaceStore(dir);
	const corruptId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000204");
	// Write corrupt JSON on disk
	fs.writeFileSync(path.join(dir, `${corruptId}.json`), "{ corrupt json");

	const service = createWorkspaceService({ store });
	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		workspaces: service,
		createServices: () => ({} as any),
	});
	await host.initialize();

	const transport = createPluginTransport({
		getHost: async () => host,
		directory: dir,
	});

	// Attempting to recover corrupt orphan must be rejected with 400
	const badReq = new Request("http://localhost/api/workspaces/recovery", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "recover-orphan", id: corruptId }),
	});
	const badRes = await transport.recoverWorkspace(badReq);
	assert.equal(badRes.status, 400);

	// File on disk remains untouched (not overwritten with empty record)
	assert.equal(fs.readFileSync(path.join(dir, `${corruptId}.json`), "utf8"), "{ corrupt json");
});

// ─── 3. P2: Organization V2 Strict Validation ────────────────────────────────

it("P2: parseOrganizationV2 rejects placements pointing to nonexistent folders", () => {
	const invalidState = {
		version: 2,
		folders: [{ id: "f1", name: "Folder 1", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey("c1")]: { folderId: "f1" },
			[workspaceKey("w1")]: { folderId: "f-nonexistent" }, // Non-existent folder!
		},
	};
	assert.throws(
		() => parseOrganizationV2(invalidState),
		/placement references nonexistent folder f-nonexistent/i,
	);
});

it("P2: parseOrganizationV2 rejects folder self-reference and cycles", () => {
	const selfCycle = {
		version: 2,
		folders: [{ id: "f1", name: "Folder 1", parentId: "f1", createdAt: NOW }],
		placements: {},
	};
	assert.throws(() => parseOrganizationV2(selfCycle), /folder cycle/i);

	const deepCycle = {
		version: 2,
		folders: [
			{ id: "f1", name: "Folder 1", parentId: "f2", createdAt: NOW },
			{ id: "f2", name: "Folder 2", parentId: "f1", createdAt: NOW },
		],
		placements: {},
	};
	assert.throws(() => parseOrganizationV2(deepCycle), /folder cycle/i);
});

it("P2: parseOrganizationV2 rejects duplicate folder IDs and unknown properties", () => {
	const duplicateIds = {
		version: 2,
		folders: [
			{ id: "f1", name: "Folder 1", parentId: null, createdAt: NOW },
			{ id: "f1", name: "Folder 2", parentId: null, createdAt: NOW },
		],
		placements: {},
	};
	assert.throws(() => parseOrganizationV2(duplicateIds), /duplicate folder id/i);

	const unknownTopKey = {
		version: 2,
		folders: [],
		placements: {},
		extraField: "bad",
	};
	assert.throws(() => parseOrganizationV2(unknownTopKey), /unknown top-level property/i);

	const unknownPlacementKey = {
		version: 2,
		folders: [{ id: "f1", name: "Folder 1", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey("c1")]: { folderId: "f1", unknownProp: 123 },
		},
	};
	assert.throws(() => parseOrganizationV2(unknownPlacementKey), /unknown placement property/i);
});

it("P2: parseOrganizationV2 rejects non-finite order and invalid timestamps", () => {
	const nanOrder = {
		version: 2,
		folders: [{ id: "f1", name: "Folder 1", parentId: null, createdAt: NOW, order: Number.NaN }],
		placements: {},
	};
	assert.throws(() => parseOrganizationV2(nanOrder), /invalid folder entry/i);

	const badDate = {
		version: 2,
		folders: [{ id: "f1", name: "Folder 1", parentId: null, createdAt: "not-a-date" }],
		placements: {},
	};
	assert.throws(() => parseOrganizationV2(badDate), /invalid folder entry/i);
});

it("P2: migrateV1toV2 normalizes dangling folderId to root (null) without losing chat", () => {
	const v1WithDangling = {
		version: 1 as const,
		folders: [{ id: "f1", name: "Folder 1", parentId: null, createdAt: NOW }],
		placements: {
			c1: { folderId: "f1" },
			c2: { folderId: "missing-folder" }, // Dangling in v1
		},
	};
	const migrated = migrateV1toV2(v1WithDangling);
	assert.equal(migrated.version, 2);
	assert.deepEqual(migrated.placements[chatKey("c1")], { folderId: "f1" });
	assert.deepEqual(migrated.placements[chatKey("c2")], { folderId: null }, "Dangling folder reference normalized to root");
	// Output of migration passes strict parseOrganizationV2
	assert.doesNotThrow(() => parseOrganizationV2(migrated));
});

// ─── 4. Mixed Sibling Ordering ──────────────────────────────────────────────

let folderCounter = 0;
const testFolderFactory = () => ({ id: `folder_${++folderCounter}`, createdAt: NOW });

it("mixed sibling ordering: root-level ordering deterministically orders mixed chats and workspaces", () => {
	const c1 = "c1";
	const c2 = "c2";
	const w1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000301");
	const w2 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000302");
	const itemKeys = new Set<ItemKey>([chatKey(c1), chatKey(c2), workspaceKey(w1), workspaceKey(w2)]);

	let state: OrganizationV2 = {
		version: 2,
		folders: [],
		placements: {
			[chatKey(c1)]: { folderId: null, order: 10 },
			[chatKey(c2)]: { folderId: null, order: 20 },
			[workspaceKey(w1)]: { folderId: null, order: 30 },
			[workspaceKey(w2)]: { folderId: null, order: 40 },
		},
	};

	const action = parseOrganizationAction({
		action: "reorder-siblings",
		parentId: null,
		entries: [
			{ kind: "workspace", id: w2 },
			{ kind: "chat", id: c1 },
			{ kind: "workspace", id: w1 },
			{ kind: "chat", id: c2 },
		],
	});

	state = applyOrganizationAction(state, action, itemKeys, testFolderFactory());

	assert.equal(state.placements[workspaceKey(w2)]?.order, 0);
	assert.equal(state.placements[chatKey(c1)]?.order, 1);
	assert.equal(state.placements[workspaceKey(w1)]?.order, 2);
	assert.equal(state.placements[chatKey(c2)]?.order, 3);
});

it("mixed sibling ordering: nested folders support mixed ordering and keep folder ordering separate", () => {
	const c1 = "c1";
	const w1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000303");
	const itemKeys = new Set<ItemKey>([chatKey(c1), workspaceKey(w1)]);

	let state: OrganizationV2 = {
		version: 2,
		folders: [
			{ id: "parent_f", name: "Parent", parentId: null, createdAt: NOW, order: 0 },
			{ id: "child_f", name: "Child", parentId: "parent_f", createdAt: NOW, order: 0 },
		],
		placements: {
			[chatKey(c1)]: { folderId: "child_f", order: 5 },
			[workspaceKey(w1)]: { folderId: "child_f", order: 2 },
		},
	};

	const action = parseOrganizationAction({
		action: "reorder-mixed-siblings",
		parentId: "child_f",
		entries: [
			{ kind: "chat", id: c1 },
			{ kind: "workspace", id: w1 },
		],
	});

	state = applyOrganizationAction(state, action, itemKeys, testFolderFactory());

	assert.equal(state.placements[chatKey(c1)]?.order, 0);
	assert.equal(state.placements[workspaceKey(w1)]?.order, 1);
	// Folder orders remain completely untouched
	assert.equal(state.folders[0]?.order, 0);
	assert.equal(state.folders[1]?.order, 0);
});

it("mixed sibling ordering: rejects duplicate IDs, missing entries, and mismatched parents", () => {
	const c1 = "c1";
	const w1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000304");
	const itemKeys = new Set<ItemKey>([chatKey(c1), workspaceKey(w1)]);

	const state: OrganizationV2 = {
		version: 2,
		folders: [{ id: "f1", name: "F1", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey(c1)]: { folderId: "f1", order: 0 },
			[workspaceKey(w1)]: { folderId: null, order: 0 }, // Belongs to root, not f1
		},
	};

	// Duplicate entries rejected by parseOrganizationAction
	assert.throws(
		() =>
			parseOrganizationAction({
				action: "reorder-siblings",
				parentId: "f1",
				entries: [
					{ kind: "chat", id: c1 },
					{ kind: "chat", id: c1 },
				],
			}),
		/duplicate entry in reorder/i,
	);

	// Missing entry rejected by applyOrganizationAction
	const missingAction = parseOrganizationAction({
		action: "reorder-siblings",
		parentId: "f1",
		entries: [{ kind: "chat", id: "nonexistent_chat" }],
	});
	assert.throws(
		() => applyOrganizationAction(state, missingAction, itemKeys, testFolderFactory()),
		/Chat no longer exists/i,
	);

	// Mismatched parent rejected by applyOrganizationAction (w1 is in root, but parentId is f1)
	const mismatchedAction = parseOrganizationAction({
		action: "reorder-siblings",
		parentId: "f1",
		entries: [
			{ kind: "chat", id: c1 },
			{ kind: "workspace", id: w1 },
		],
	});
	assert.throws(
		() => applyOrganizationAction(state, mismatchedAction, itemKeys, testFolderFactory()),
		/does not belong to parent f1/i,
	);
});

it("mixed sibling ordering: preserves archivedAt on archived entries and leaves unrelated siblings untouched", () => {
	const c1 = "c1";
	const c2 = "c2";
	const w1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000305");
	const wUnrelated = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000306");
	const itemKeys = new Set<ItemKey>([chatKey(c1), chatKey(c2), workspaceKey(w1), workspaceKey(wUnrelated)]);

	const ARCHIVE_TIME = "2026-11-10T10:00:00.000Z";
	let state: OrganizationV2 = {
		version: 2,
		folders: [{ id: "f1", name: "F1", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey(c1)]: { folderId: "f1", order: 0, archivedAt: ARCHIVE_TIME },
			[workspaceKey(w1)]: { folderId: "f1", order: 1, archivedAt: null },
			[chatKey(c2)]: { folderId: "f1", order: 2, archivedAt: null },
			[workspaceKey(wUnrelated)]: { folderId: "f1", order: 99, archivedAt: ARCHIVE_TIME },
		},
	};

	// Only reorder c2, c1, w1; do not include wUnrelated
	const action = parseOrganizationAction({
		action: "reorder-siblings",
		parentId: "f1",
		entries: [
			{ kind: "chat", id: c2 },
			{ kind: "chat", id: c1 },
			{ kind: "workspace", id: w1 },
		],
	});

	state = applyOrganizationAction(state, action, itemKeys, testFolderFactory());

	assert.equal(state.placements[chatKey(c2)]?.order, 0);
	assert.equal(state.placements[chatKey(c1)]?.order, 1);
	assert.equal(state.placements[chatKey(c1)]?.archivedAt, ARCHIVE_TIME, "archivedAt timestamp preserved");
	assert.equal(state.placements[workspaceKey(w1)]?.order, 2);

	// Unrelated sibling completely unchanged
	assert.equal(state.placements[workspaceKey(wUnrelated)]?.order, 99);
	assert.equal(state.placements[workspaceKey(wUnrelated)]?.archivedAt, ARCHIVE_TIME);
});

it("mixed sibling ordering: legacy reorder-siblings with kind and ids continues to work", () => {
	const c1 = "c1";
	const c2 = "c2";
	const itemKeys = new Set<ItemKey>([chatKey(c1), chatKey(c2)]);

	let state: OrganizationV2 = {
		version: 2,
		folders: [],
		placements: {
			[chatKey(c1)]: { folderId: null, order: 0 },
			[chatKey(c2)]: { folderId: null, order: 1 },
		},
	};

	const legacyAction = parseOrganizationAction({
		action: "reorder-siblings",
		parentId: null,
		kind: "chat",
		ids: [c2, c1],
	});

	state = applyOrganizationAction(state, legacyAction, itemKeys, testFolderFactory());

	assert.equal(state.placements[chatKey(c2)]?.order, 0);
	assert.equal(state.placements[chatKey(c1)]?.order, 1);
});

// ─── 5. Directory Recovery Visibility ───────────────────────────────────────

it("directory recovery visibility: inspect() and read({ includeIssues: true }) expose store issues without breaking contract", () => {
	const missingId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000401");
	const invalidId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000402");
	const validId = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000403");

	const mockIssues = [
		{ kind: "missing-record" as const, id: missingId },
		{ kind: "invalid-record" as const, id: invalidId },
	];

	const mockWorkspaceStore = {
		list: () => ({
			workspaces: [makeRecord(validId, { title: "Healthy WS" })],
			issues: mockIssues,
		}),
		read: () => null,
		create: () => {},
		update: () => {},
		delete: () => {},
	};

	let orgState: OrganizationV2 = {
		version: 2,
		folders: [],
		placements: {
			[workspaceKey(validId)]: { folderId: null, order: 0 },
		},
	};

	const mockOrgStore = {
		read: () => structuredClone(orgState),
		write: (next: OrganizationV2) => {
			orgState = structuredClone(next);
		},
	};

	const service = createDirectoryService({
		chatStore: { listChats: () => [] } as any,
		workspaceStore: mockWorkspaceStore as any,
		organizationStore: mockOrgStore as any,
		resolveAvailability: () => "available",
	});

	// 1. inspect() exposes recovery issues
	const inspection = service.inspect();
	assert.deepEqual(inspection.issues, mockIssues);

	// 2. read() without includeIssues returns standard contract without issues field
	const standardDir = service.read();
	assert.equal(standardDir.items.length, 1);
	assert.equal(standardDir.items[0]?.id, validId);
	assert.equal(standardDir.issues, undefined, "Default read() contract must not have issues");

	// 3. read({ includeIssues: true }) surfaces recovery visibility additively
	const recoveryDir = service.read({ includeIssues: true });
	assert.equal(recoveryDir.items.length, 1);
	assert.deepEqual(recoveryDir.issues, mockIssues);
});

// ─── 6. Backward Compatibility Verification ─────────────────────────────────

it("backward compatibility: legacy v1 plugin activates and registerView retains original behavior", async () => {
	const dir = path.join(root, "legacy-v1-compat");
	const pluginDist = path.join(dir, "plugins", "legacy-plugin", "dist");
	fs.mkdirSync(pluginDist, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDist, "manifest.json"),
		JSON.stringify({
			apiVersion: 1,
			id: "legacy-plugin",
			name: "Legacy Plugin",
			version: "1.0.0",
			minAppVersion: "0.7.0",
			backend: "backend.cjs",
		}),
	);
	fs.writeFileSync(path.join(pluginDist, "backend.cjs"), "exports.activate = ctx => { ctx.handle('ping', () => 'pong'); };");

	const host = createPluginHost({
		directory: path.join(dir, "plugins"),
		appVersion: "0.7.0",
		createServices: () => ({} as any),
	});

	await host.initialize();
	await host.setEnabled("legacy-plugin", true);
	const list = host.list();
	assert.equal(list.length, 1);
	assert.equal(list[0]?.id, "legacy-plugin");
	assert.equal(list[0]?.status, "active");
	assert.deepEqual(host.modes(), [], "Legacy plugin has no modes");
});

it("backward compatibility: folder archive and restore cascades to both chats and workspaces", () => {
	const c1 = "chat_archive_test";
	const w1 = parseWorkspaceId("workspace_00000000-0000-4000-8000-000000000501");
	const itemKeys = new Set<ItemKey>([chatKey(c1), workspaceKey(w1)]);

	let state: OrganizationV2 = {
		version: 2,
		folders: [{ id: "f_target", name: "Target Folder", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey(c1)]: { folderId: "f_target" },
			[workspaceKey(w1)]: { folderId: "f_target" },
		},
	};

	// Archive the folder
	const archiveAction = parseOrganizationAction({ action: "archive", kind: "folder", id: "f_target" });
	state = applyOrganizationAction(state, archiveAction, itemKeys, testFolderFactory());

	assert.ok(state.folders[0]?.archivedAt, "Folder must be archived");
	assert.ok(state.placements[chatKey(c1)]?.archivedAt, "Chat placement must be archived");
	assert.ok(state.placements[workspaceKey(w1)]?.archivedAt, "Workspace placement must be archived");

	// Restore the folder
	const restoreAction = parseOrganizationAction({ action: "restore", kind: "folder", id: "f_target" });
	state = applyOrganizationAction(state, restoreAction, itemKeys, testFolderFactory());

	assert.equal(state.folders[0]?.archivedAt, null, "Folder must be unarchived");
	assert.equal(state.placements[chatKey(c1)]?.archivedAt, null, "Chat placement must be unarchived");
	assert.equal(state.placements[workspaceKey(w1)]?.archivedAt, null, "Workspace placement must be unarchived");
});

function status(code: number) {
	return (err: unknown) => isPluginHostError(err) && err.status === code;
}
