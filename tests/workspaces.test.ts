import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-workspaces-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { createWorkspaceStore } = await import("../src/store/workspaces.ts");
const { createWorkspaceService } = await import("../src/server/workspaces.ts");
const { parseWorkspaceId, parseWorkspaceRecord, resolveWorkspaceAvailability } = await import("../src/core/workspaces.ts");

const rawRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
	version: 1,
	id,
	pluginId: "sample-plugin",
	modeId: "memory-lab",
	title: "Memory lab",
	createdAt: "2026-11-13T12:00:00.000Z",
	updatedAt: "2026-11-13T12:00:00.000Z",
	...overrides,
});

const record = (id: string, overrides: Record<string, unknown> = {}) => parseWorkspaceRecord(rawRecord(id, overrides));

const id = (suffix: string) => parseWorkspaceId(`workspace_00000000-0000-4000-8000-${suffix.padStart(12, "0")}`);

it("validates workspace IDs and refuses malformed or newer host records", () => {
	assert.throws(() => parseWorkspaceId("../escape"), /Invalid workspace ID/);
	assert.throws(() => parseWorkspaceId("workspace_not-a-uuid"), /Invalid workspace ID/);
	assert.throws(() => parseWorkspaceRecord(rawRecord("workspace_00000000-0000-4000-8000-000000000001", { version: 2 })), /invalid or newer/);
	assert.throws(() => parseWorkspaceRecord(rawRecord("workspace_00000000-0000-4000-8000-000000000001", { pluginId: "../outside" })), /invalid or newer/);
	assert.throws(() => parseWorkspaceRecord(rawRecord("workspace_00000000-0000-4000-8000-000000000001", { title: "  " })), /invalid or newer/);
});

it("stores each workspace record separately and keeps only IDs in the index", () => {
	const directory = path.join(root, "layout");
	const store = createWorkspaceStore(directory);
	const first = record("workspace_00000000-0000-4000-8000-000000000001");
	const second = record("workspace_00000000-0000-4000-8000-000000000002", { title: "Paging lab" });
	store.create(first);
	store.create(second);

	const index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
	assert.deepEqual(index, { version: 1, workspaceIds: [first.id, second.id] });
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, `${first.id}.json`), "utf8")), first);
	assert.deepEqual(store.list().workspaces.map((workspace) => workspace.title), ["Memory lab", "Paging lab"]);
	assert.deepEqual(store.list().issues, []);
});

it("reports orphan and missing records without changing the index or hiding valid workspaces", () => {
	const directory = path.join(root, "inconsistent");
	fs.mkdirSync(directory, { recursive: true });
	const validId = "workspace_00000000-0000-4000-8000-000000000003";
	const missingId = "workspace_00000000-0000-4000-8000-000000000004";
	const orphanId = "workspace_00000000-0000-4000-8000-000000000005";
	const invalidId = "workspace_00000000-0000-4000-8000-000000000012";
	const missingWorkspaceId = parseWorkspaceId(missingId);
	const invalidWorkspaceId = parseWorkspaceId(invalidId);
	fs.writeFileSync(path.join(directory, "index.json"), JSON.stringify({ version: 1, workspaceIds: [validId, missingId, invalidId] }));
	fs.writeFileSync(path.join(directory, `${validId}.json`), JSON.stringify(record(validId)));
	fs.writeFileSync(path.join(directory, `${orphanId}.json`), JSON.stringify(record(orphanId)));
	const invalidBytes = JSON.stringify(rawRecord(invalidId, { version: 2 }));
	fs.writeFileSync(path.join(directory, `${invalidId}.json`), invalidBytes);
	const before = fs.readFileSync(path.join(directory, "index.json"), "utf8");
	const store = createWorkspaceStore(directory);

	const listed = store.list();
	assert.deepEqual(listed.workspaces.map((workspace) => workspace.id), [validId]);
	assert.deepEqual(listed.issues, [
		{ kind: "missing-record", id: missingWorkspaceId },
		{ kind: "invalid-record", id: invalidWorkspaceId },
	]);
	assert.deepEqual(store.inspect(), {
		orphanIds: [parseWorkspaceId(orphanId)], missingIds: [missingWorkspaceId], invalidOrphanIds: [],
		invalidRecordIds: [invalidWorkspaceId], unreadableRecordIds: [],
	});
	assert.equal(fs.readFileSync(path.join(directory, "index.json"), "utf8"), before, "reads do not reconcile the index");
	assert.equal(fs.readFileSync(path.join(directory, `${invalidId}.json`), "utf8"), invalidBytes, "newer records remain untouched");
});

it("recovers an orphan and removes a missing index reference only on explicit request", () => {
	const directory = path.join(root, "recovery");
	fs.mkdirSync(directory, { recursive: true });
	const missingId = "workspace_00000000-0000-4000-8000-000000000006";
	const orphanId = "workspace_00000000-0000-4000-8000-000000000007";
	const missingWorkspaceId = parseWorkspaceId(missingId);
	const orphanWorkspaceId = parseWorkspaceId(orphanId);
	fs.writeFileSync(path.join(directory, "index.json"), JSON.stringify({ version: 1, workspaceIds: [missingId] }));
	fs.writeFileSync(path.join(directory, `${orphanId}.json`), JSON.stringify(record(orphanId)));
	const store = createWorkspaceStore(directory);

	store.recoverOrphan(orphanWorkspaceId);
	assert.deepEqual(store.list().workspaces.map((workspace) => workspace.id), [orphanId]);
	assert.deepEqual(store.list().issues, [{ kind: "missing-record", id: missingWorkspaceId }]);
	store.removeMissingReference(missingWorkspaceId);
	assert.deepEqual(store.list().issues, []);
});

it("leaves a valid orphan recoverable when the atomic index write fails after record creation", (t) => {
	const directory = path.join(root, "partial-create");
	const store = createWorkspaceStore(directory);
	const existingId = "workspace_00000000-0000-4000-8000-000000000013";
	const nextId = "workspace_00000000-0000-4000-8000-000000000008";
	const recordPath = path.join(directory, `${nextId}.json`);
	const indexPath = path.join(directory, "index.json");
	store.create(record(existingId));
	const previousIndex = fs.readFileSync(indexPath, "utf8");
	const originalRename = fs.renameSync.bind(fs);
	t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
		if (typeof to === "string" && to === indexPath) throw Object.assign(new Error("fixture write failure"), { code: "EIO" });
		return originalRename(from, to);
	});

	assert.throws(() => store.create(record(nextId)), { code: "EIO" });
	assert.equal(fs.existsSync(recordPath), true);
	assert.equal(fs.readFileSync(indexPath, "utf8"), previousIndex);
	assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes(".tmp-")), []);
	assert.deepEqual(store.list().workspaces.map((workspace) => workspace.id), [existingId]);
	assert.deepEqual(store.inspect().orphanIds, [parseWorkspaceId(nextId)]);
});

it("refuses to overwrite a newer index or record", () => {
	const directory = path.join(root, "future-version");
	fs.mkdirSync(directory, { recursive: true });
	const indexPath = path.join(directory, "index.json");
	const newerIndex = JSON.stringify({ version: 2, workspaceIds: [] });
	fs.writeFileSync(indexPath, newerIndex);
	const store = createWorkspaceStore(directory);
	assert.throws(() => store.create(record("workspace_00000000-0000-4000-8000-000000000009")), /invalid or newer/);
	assert.equal(fs.readFileSync(indexPath, "utf8"), newerIndex);

	fs.writeFileSync(indexPath, JSON.stringify({ version: 1, workspaceIds: ["workspace_00000000-0000-4000-8000-000000000009"] }));
	const workspacePath = path.join(directory, "workspace_00000000-0000-4000-8000-000000000009.json");
	const newerRecord = JSON.stringify(rawRecord("workspace_00000000-0000-4000-8000-000000000009", { version: 3 }));
	fs.writeFileSync(workspacePath, newerRecord);
	assert.throws(() => store.update(record("workspace_00000000-0000-4000-8000-000000000009", { title: "Overwrite" })), /invalid or newer/);
	assert.equal(fs.readFileSync(workspacePath, "utf8"), newerRecord);
});

it("keeps workspace identity immutable during metadata updates", () => {
	const directory = path.join(root, "identity");
	const store = createWorkspaceStore(directory);
	const current = record("workspace_00000000-0000-4000-8000-000000000011");
	store.create(current);
	assert.throws(() => store.update({ ...current, pluginId: "other-plugin" }), /identity is immutable/);
	assert.deepEqual(store.read(current.id), current);
});

it("creates distinct workspace IDs and renames host metadata without changing identity", () => {
	let sequence = 10;
	const directory = path.join(root, "service");
	const service = createWorkspaceService({
		store: createWorkspaceStore(directory),
		now: () => "2026-11-13T13:00:00.000Z",
		createId: () => id(String(sequence++)),
	});
	const first = service.create({ pluginId: "sample-plugin", modeId: "memory-lab", title: "Memory lab" });
	const second = service.create({ pluginId: "sample-plugin", modeId: "memory-lab", title: "Memory lab" });
	const renamed = service.rename(first.id, "Custom title");

	assert.notEqual(first.id, second.id);
	assert.equal(renamed.id, first.id);
	assert.equal(renamed.title, "Custom title");
	assert.equal(renamed.updatedAt, "2026-11-13T13:00:00.000Z");
	assert.equal(service.read(first.id)?.title, "Custom title");
	assert.equal(service.read(second.id)?.title, "Memory lab");
	service.delete(first.id);
	assert.equal(service.read(first.id), null);
	assert.deepEqual(service.list().workspaces.map((workspace) => workspace.id), [second.id]);
});

it("resolves workspace availability from a host-supplied plugin and mode snapshot", () => {
	const workspace = parseWorkspaceRecord(record("workspace_00000000-0000-4000-8000-000000000010"));
	assert.equal(resolveWorkspaceAvailability(workspace, []), "plugin-missing");
	assert.equal(resolveWorkspaceAvailability(workspace, [{ id: "sample-plugin", enabled: false, modeIds: [] }]), "plugin-disabled");
	assert.equal(resolveWorkspaceAvailability(workspace, [{ id: "sample-plugin", enabled: true, modeIds: [] }]), "mode-missing");
	assert.equal(resolveWorkspaceAvailability(workspace, [{ id: "sample-plugin", enabled: true, modeIds: ["memory-lab"] }]), "available");
});

it("calls onDelete callback when a workspace is deleted", () => {
	let deletedId: string | undefined;
	const service = createWorkspaceService({
		store: createWorkspaceStore(path.join(root, "on-delete")),
		onDelete: (id) => { deletedId = id; },
	});
	const ws = service.create({ pluginId: "sample", modeId: "mode", title: "Test" });
	service.delete(ws.id);
	assert.equal(deletedId, ws.id);
});
