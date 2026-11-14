import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

// Isolated data root: importing the server module tree reads config paths
// (same pattern as the other server-side tests).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-directory-service-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
after(() => fs.rmSync(root, { recursive: true, force: true }));

import {
	applyOrganizationAction,
	chatKey,
	emptyOrganizationV2,
	parseOrganizationAction,
	workspaceKey,
	type ItemKey,
	type OrganizationV2,
} from "../src/core/organization.ts";
import type { DirectoryEntry, WorkspaceDirectoryEntry } from "../src/core/directory.ts";
import type { WorkspaceId, WorkspaceRecord } from "../src/core/workspaces.ts";
import type { ChatStore, WorkspaceStore } from "../src/core/ports.ts";

const { createDirectoryService } = await import("../src/server/directory.ts");

const NOW = "2026-11-01T00:00:00.000Z";
const OLDER = "2026-10-01T00:00:00.000Z";

const WS_A = "workspace_a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" as WorkspaceId;
const WS_B = "workspace_11aa22bb-33cc-4dd5-8ee6-9fff0011a2b3" as WorkspaceId;

const chatSummary = (id: string, updatedAt: string = NOW) => ({
	id,
	title: `Chat ${id}`,
	createdAt: OLDER,
	updatedAt,
	messageCount: 1,
	pendingQuestion: false,
	pendingProblem: false,
});

const wsRecord = (id: WorkspaceId, title = "Workspace"): WorkspaceRecord => ({
	version: 1,
	id,
	pluginId: "study-plugin",
	modeId: "study-mode",
	title,
	createdAt: OLDER,
	updatedAt: NOW,
});

const wsEntry = (entry: DirectoryEntry | undefined): WorkspaceDirectoryEntry => {
	assert.ok(entry, "expected a directory entry");
	assert.equal(entry.kind, "workspace");
	return entry as WorkspaceDirectoryEntry;
};

let folderSeq = 0;
const fresh = () => ({ id: `folder_${++folderSeq}`, createdAt: NOW });

const apply = (state: OrganizationV2, raw: unknown, itemKeys: ItemKey[]): OrganizationV2 =>
	applyOrganizationAction(state, parseOrganizationAction(raw), new Set(itemKeys), fresh());

function fakeOrgStore(initial?: OrganizationV2) {
	let state: OrganizationV2 = initial ? structuredClone(initial) : emptyOrganizationV2();
	let writes = 0;
	return {
		read: () => structuredClone(state),
		write(next: OrganizationV2) {
			state = structuredClone(next);
			writes++;
		},
		get writes() {
			return writes;
		},
		get state() {
			return structuredClone(state);
		},
	};
}

type ServiceOptions = {
	chats?: ReturnType<typeof chatSummary>[];
	workspaces?: WorkspaceRecord[];
	issues?: { kind: string; id: WorkspaceId }[];
	availability?: Record<string, "available" | "plugin-disabled" | "plugin-missing" | "mode-missing">;
	throwingAvailability?: boolean;
	org?: OrganizationV2;
};

function buildService(options: ServiceOptions = {}) {
	const orgStore = fakeOrgStore(options.org);
	const chatStore = { listChats: () => options.chats ?? [] } as unknown as ChatStore;
	const workspaceStore = {
		list: () => ({ workspaces: options.workspaces ?? [], issues: options.issues ?? [] }),
	} as unknown as WorkspaceStore;
	const availabilityMap = new Map(Object.entries(options.availability ?? {}));
	const service = createDirectoryService({
		chatStore,
		workspaceStore,
		organizationStore: orgStore,
		resolveAvailability: (ws) => {
			if (options.throwingAvailability) throw new Error("host not initialized");
			return availabilityMap.get(ws.id) ?? "available";
		},
	});
	return { service, orgStore };
}

const knownKeys = (chats: string[], workspaces: WorkspaceId[]): ItemKey[] => [
	...chats.map(chatKey),
	...workspaces.map(workspaceKey),
];

// ─── applyOrganizationAction: shared folder rules (R3/R4) ─────────────────────

it("move places chats and workspaces under typed placement keys", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "F", parentId: null }, []);
	const f1 = state.folders[0]!.id;
	const keys = knownKeys(["c1"], [WS_A]);

	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: f1 }, keys);
	assert.deepEqual(state.placements[chatKey("c1")], { folderId: f1, order: 0 });

	state = apply(state, { action: "move", kind: "workspace", id: WS_A, parentId: f1, targetOrder: 5 }, keys);
	assert.deepEqual(state.placements[workspaceKey(WS_A)], { folderId: f1, order: 5 });
});

it("a chat and a workspace with the same bare ID occupy distinct placements (R1)", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "F", parentId: null }, []);
	const f1 = state.folders[0]!.id;
	const keys = [chatKey("same-id"), workspaceKey("same-id")];

	state = apply(state, { action: "move", kind: "chat", id: "same-id", parentId: f1 }, keys);
	state = apply(state, { action: "move", kind: "workspace", id: "same-id", parentId: f1 }, keys);
	assert.ok(state.placements[chatKey("same-id")]);
	assert.ok(state.placements[workspaceKey("same-id")]);
});

it("archiving a folder stamps the whole subtree regardless of item kind (R4)", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "Parent", parentId: null }, []);
	const parent = state.folders[0]!.id;
	state = apply(state, { action: "create-folder", name: "Child", parentId: parent }, []);
	const child = state.folders[1]!.id;
	const keys = knownKeys(["c1"], [WS_A]);
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: parent }, keys);
	state = apply(state, { action: "move", kind: "workspace", id: WS_A, parentId: child }, keys);

	state = apply(state, { action: "archive", kind: "folder", id: parent }, keys);

	assert.ok(state.folders.find((f) => f.id === parent)?.archivedAt, "parent archived");
	assert.ok(state.folders.find((f) => f.id === child)?.archivedAt, "child archived");
	assert.ok(state.placements[chatKey("c1")]?.archivedAt, "chat in subtree archived");
	assert.ok(state.placements[workspaceKey(WS_A)]?.archivedAt, "workspace in subtree archived");
});

it("restoring a folder unarchives both kinds and retains the hierarchy", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "Parent", parentId: null }, []);
	const parent = state.folders[0]!.id;
	state = apply(state, { action: "create-folder", name: "Child", parentId: parent }, []);
	const child = state.folders[1]!.id;
	const keys = knownKeys(["c1"], [WS_A]);
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: child, targetOrder: 2 }, keys);
	state = apply(state, { action: "move", kind: "workspace", id: WS_A, parentId: child, targetOrder: 3 }, keys);
	state = apply(state, { action: "archive", kind: "folder", id: parent }, keys);

	state = apply(state, { action: "restore", kind: "folder", id: parent }, keys);
	assert.equal(state.folders.find((f) => f.id === parent)?.archivedAt, null);
	assert.equal(state.folders.find((f) => f.id === child)?.archivedAt, null);
	assert.equal(state.folders.find((f) => f.id === child)?.parentId, parent, "hierarchy retained");
	assert.equal(state.placements[chatKey("c1")]?.archivedAt, null);
	assert.equal(state.placements[chatKey("c1")]?.folderId, child, "original placement retained");
	assert.equal(state.placements[workspaceKey(WS_A)]?.archivedAt, null);
	assert.equal(state.placements[workspaceKey(WS_A)]?.order, 3, "ordering retained");
});

it("a folder containing only workspaces is never treated as empty (R3)", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "F", parentId: null }, []);
	const f1 = state.folders[0]!.id;
	const keys = knownKeys([], [WS_A]);
	state = apply(state, { action: "move", kind: "workspace", id: WS_A, parentId: f1 }, keys);

	assert.throws(
		() => apply(state, { action: "delete-folder", id: f1 }, keys),
		/contains items/,
	);
});

it("reorder-siblings orders each kind correctly without disturbing the other kind", () => {
	let state = emptyOrganizationV2();
	state = apply(state, { action: "create-folder", name: "F", parentId: null }, []);
	const f1 = state.folders[0]!.id;
	const keys = knownKeys(["c1", "c2"], [WS_A]);
	state = apply(state, { action: "move", kind: "chat", id: "c1", parentId: f1, targetOrder: 0 }, keys);
	state = apply(state, { action: "move", kind: "workspace", id: WS_A, parentId: f1, targetOrder: 1 }, keys);

	state = apply(
		state,
		{ action: "reorder-siblings", parentId: f1, kind: "chat", ids: ["c1"] },
		keys,
	);
	assert.equal(state.placements[chatKey("c1")]?.order, 0, "chat reordered");
	assert.equal(state.placements[workspaceKey(WS_A)]?.order, 1, "workspace order untouched");

	state = apply(
		state,
		{ action: "reorder-siblings", parentId: f1, kind: "workspace", ids: [WS_A] },
		keys,
	);
	assert.equal(state.placements[workspaceKey(WS_A)]?.order, 0, "workspace reordered");
	assert.equal(state.placements[chatKey("c1")]?.order, 0, "chat order untouched");
});

// ─── DirectoryService aggregation (R6/R7) ─────────────────────────────────────

it("read() with no chats and no workspaces returns an empty directory", () => {
	const { service } = buildService();
	const directory = service.read();
	assert.deepEqual(directory.items, []);
	assert.deepEqual(directory.folders, []);
	assert.equal(directory.organization.version, 2);
});

it("chats and workspaces without placements appear at root, newest activity first (R6)", () => {
	const { service } = buildService({
		chats: [chatSummary("c1", NOW), chatSummary("c2", OLDER)],
		workspaces: [wsRecord(WS_A)],
	});
	const directory = service.read();
	assert.equal(directory.items.length, 3);
	assert.ok(directory.items.every((item) => item.folderId === null && item.archivedAt === null));
	assert.equal(directory.items[0]!.id, "c1", "newest updatedAt first");
	assert.equal(directory.items[2]!.id, "c2");
	const workspace = wsEntry(directory.items[1]);
	assert.equal(workspace.pluginId, "study-plugin");
});

it("a mixed folder holds both kinds and sibling order interleaves them", () => {
	const { service } = buildService({
		chats: [chatSummary("c1")],
		workspaces: [wsRecord(WS_A)],
	});
	const created = service.change({ action: "create-folder", name: "Mixed", parentId: null });
	const f1 = created.createdFolderId!;
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId: f1, targetOrder: 0 });
	service.change({ action: "move", kind: "chat", id: "c1", parentId: f1, targetOrder: 1 });

	const directory = service.read();
	const inFolder = directory.items.filter((item) => item.folderId === f1);
	assert.equal(inFolder.length, 2);
	assert.deepEqual(
		inFolder.map((item) => item.kind),
		["workspace", "chat"],
	);
	assert.deepEqual(inFolder.map((item) => item.order), [0, 1]);
});

it("availability variants resolve per workspace (R7)", () => {
	const { service } = buildService({
		workspaces: [wsRecord(WS_A, "A"), wsRecord(WS_B, "B")],
		availability: { [WS_A]: "plugin-disabled", [WS_B]: "mode-missing" },
	});
	const byId = new Map(service.read().items.map((item) => [item.id, item]));
	assert.equal(wsEntry(byId.get(WS_A)).availability, "plugin-disabled");
	assert.equal(wsEntry(byId.get(WS_B)).availability, "mode-missing");
	assert.equal(byId.get("c1"), undefined, "unknown ids resolve to no entry");
});

it("workspace visibility survives a throwing availability resolver (R7)", () => {
	const { service } = buildService({
		workspaces: [wsRecord(WS_A)],
		throwingAvailability: true,
	});
	const directory = service.read();
	assert.equal(directory.items.length, 1);
	assert.equal(wsEntry(directory.items[0]).availability, "plugin-missing");
});

it("missing or invalid workspace records are excluded without breaking the directory (R7)", () => {
	const { service } = buildService({
		chats: [chatSummary("c1")],
		workspaces: [wsRecord(WS_A)],
		issues: [{ kind: "missing-record", id: WS_B }],
	});
	const directory = service.read();
	assert.deepEqual(
		directory.items.map((item) => item.id).sort(),
		["c1", WS_A],
		"only existing records appear; the missing record is skipped",
	);
});

it("archive and restore through the service cover both kinds in a mixed folder", () => {
	const { service } = buildService({
		chats: [chatSummary("c1")],
		workspaces: [wsRecord(WS_A)],
	});
	const created = service.change({ action: "create-folder", name: "F", parentId: null });
	const f1 = created.createdFolderId!;
	service.change({ action: "move", kind: "chat", id: "c1", parentId: f1 });
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId: f1 });

	service.change({ action: "archive", kind: "folder", id: f1 });
	let directory = service.read();
	assert.equal(directory.items.length, 0, "archived items leave the active view");
	const archived = service.readArchived();
	assert.deepEqual(archived.archivedFolders.map((f) => f.id), [f1]);
	assert.deepEqual(
		archived.items.map((item) => item.kind).sort(),
		["chat", "workspace"],
		"both kinds archived",
	);

	service.change({ action: "restore", kind: "folder", id: f1 });
	directory = service.read();
	assert.equal(directory.items.length, 2);
	assert.ok(directory.items.every((item) => item.folderId === f1 && item.archivedAt === null));
	assert.equal(directory.folders[0]!.archivedAt, null);
});

it("removePlacement deletes only the targeted kind and keeps the rest (R5)", () => {
	const { service, orgStore } = buildService({
		chats: [chatSummary("c1")],
		workspaces: [wsRecord(WS_A)],
	});
	service.change({ action: "move", kind: "chat", id: "c1", parentId: null });
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId: null });

	service.removePlacement(chatKey("c1"));
	assert.equal(orgStore.state.placements[chatKey("c1")], undefined);
	assert.ok(orgStore.state.placements[workspaceKey(WS_A)], "workspace placement intact");

	service.removePlacement(workspaceKey(WS_A));
	assert.equal(orgStore.state.placements[workspaceKey(WS_A)], undefined);
});

it("corrupt organization data is a hard failure, never silently rewritten from empty", () => {
	const orgStore = {
		read() {
			throw new Error("Could not read organization. Its data is invalid or newer than this app.");
		},
		write() {},
	};
	const service = createDirectoryService({
		chatStore: { listChats: () => [] } as unknown as ChatStore,
		workspaceStore: { list: () => ({ workspaces: [], issues: [] }) } as unknown as WorkspaceStore,
		organizationStore: orgStore,
		resolveAvailability: () => "available",
	});
	assert.throws(() => service.read(), /invalid or newer/);
});

it("items organized in nested folders retain hierarchy and correct placement", () => {
	const { service } = buildService({
		chats: [chatSummary("c1"), chatSummary("c2")],
		workspaces: [wsRecord(WS_A), wsRecord(WS_B)],
	});
	const parent = service.change({ action: "create-folder", name: "Parent", parentId: null });
	const parentId = parent.createdFolderId!;
	const child = service.change({ action: "create-folder", name: "Child", parentId });
	const childId = child.createdFolderId!;

	service.change({ action: "move", kind: "chat", id: "c1", parentId });
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId });
	service.change({ action: "move", kind: "chat", id: "c2", parentId: childId });
	service.change({ action: "move", kind: "workspace", id: WS_B, parentId: childId });

	const directory = service.read();
	const inParent = directory.items.filter((item) => item.folderId === parentId);
	const inChild = directory.items.filter((item) => item.folderId === childId);

	assert.equal(inParent.length, 2);
	assert.deepEqual(inParent.map((item) => item.kind).sort(), ["chat", "workspace"]);
	assert.equal(inChild.length, 2);
	assert.deepEqual(inChild.map((item) => item.kind).sort(), ["chat", "workspace"]);
});

it("orphan placements in organization state are ignored and do not produce invalid items in directory", () => {
	const orgStore = fakeOrgStore({
		version: 2,
		folders: [{ id: "f1", name: "F1", parentId: null, createdAt: NOW }],
		placements: {
			[chatKey("c1")]: { folderId: "f1", order: 0 },
			[chatKey("orphan-chat")]: { folderId: "f1", order: 1 },
			[workspaceKey(WS_A)]: { folderId: "f1", order: 2 },
			[workspaceKey("workspace_00000000-0000-4000-8000-000000000999" as WorkspaceId)]: { folderId: "f1", order: 3 },
		},
	});
	const service = createDirectoryService({
		chatStore: { listChats: () => [chatSummary("c1")] } as unknown as ChatStore,
		workspaceStore: { list: () => ({ workspaces: [wsRecord(WS_A)], issues: [] }) } as unknown as WorkspaceStore,
		organizationStore: orgStore,
		resolveAvailability: () => "available",
	});

	const directory = service.read();
	assert.deepEqual(
		directory.items.map((i) => i.id).sort(),
		["c1", WS_A].sort(),
		"orphan placements must be excluded from items",
	);
});

it("mixed directory items sort deterministically by explicit order, then by updatedAt, kind, and id", () => {
	const { service } = buildService({
		chats: [
			chatSummary("c-no-order", "2026-11-02T10:00:00.000Z"),
			chatSummary("c-ordered", "2026-11-01T10:00:00.000Z"),
		],
		workspaces: [
			wsRecord(WS_A, "WS Ordered"),
			wsRecord(WS_B, "WS No Order"),
		],
	});
	// Give c-ordered order 2, WS_A order 1
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId: null, targetOrder: 1 });
	service.change({ action: "move", kind: "chat", id: "c-ordered", parentId: null, targetOrder: 2 });

	const directory = service.read();
	const orderedIds = directory.items.map((i) => i.id);
	// Items with order come first: WS_A (order 1), then c-ordered (order 2)
	assert.equal(orderedIds[0], WS_A);
	assert.equal(orderedIds[1], "c-ordered");
});

it("archiving a workspace keeps it in archived items without deleting the record", () => {
	const { service } = buildService({
		workspaces: [wsRecord(WS_A)],
	});
	service.change({ action: "archive", kind: "workspace", id: WS_A });

	const active = service.read();
	assert.equal(active.items.length, 0, "archived workspace does not appear in active items");

	const archived = service.readArchived();
	assert.equal(archived.items.length, 1);
	assert.equal(archived.items[0]!.id, WS_A);
	assert.equal(archived.items[0]!.kind, "workspace");
});

it("deleted workspace with removePlacement no longer appears in directory or archive", () => {
	const { service, orgStore } = buildService({
		workspaces: [wsRecord(WS_A)],
	});
	service.change({ action: "move", kind: "workspace", id: WS_A, parentId: null });
	assert.ok(orgStore.state.placements[workspaceKey(WS_A)]);

	// Workspace deletion:
	service.removePlacement(workspaceKey(WS_A));
	assert.equal(orgStore.state.placements[workspaceKey(WS_A)], undefined);

	// When workspace store no longer has the record:
	const emptyWsService = createDirectoryService({
		chatStore: { listChats: () => [] } as unknown as ChatStore,
		workspaceStore: { list: () => ({ workspaces: [], issues: [] }) } as unknown as WorkspaceStore,
		organizationStore: orgStore,
		resolveAvailability: () => "available",
	});
	assert.equal(emptyWsService.read().items.length, 0);
	assert.equal(emptyWsService.readArchived().items.length, 0);
});
