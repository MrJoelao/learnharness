import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

// Isolated data root, set before the dynamic imports (route test pattern).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-directory-route-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}\n");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { GET: getDirectory, POST: postDirectory } = await import("../app/api/directory/route.ts");
const { GET: getOrg, POST: postOrg } = await import("../app/api/chats/organization/route.ts");
const { stores } = await import("../src/server/stores.ts");
const { workspaceService } = await import("../src/server/workspaces.ts");
const { PATHS, CHAT_ORGANIZATION_FILE } = await import("../config.ts");

const jsonRequest = (url: string, body: unknown) =>
	new Request(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

const postDirectoryAction = (action: unknown) =>
	postDirectory(jsonRequest("http://localhost/api/directory", action));

const postOrgAction = (action: unknown) =>
	postOrg(jsonRequest("http://localhost/api/chats/organization", action));

const hashFile = (file: string) => {
	if (!fs.existsSync(file)) return null;
	return fs.readFileSync(file).toString("base64");
};

const chatRecordFile = (id: string) => path.join(PATHS.chats, `${id}.json`);
const workspaceRecordFile = (id: string) => path.join(PATHS.workspaces, `${id}.json`);

it("GET /api/directory returns the shared v2 contract with discriminated entries", async () => {
	const empty = await getDirectory(new Request("http://localhost/api/directory"));
	assert.equal(empty.status, 200);
	const emptyBody = await empty.json();
	assert.equal(emptyBody.organization.version, 2);
	assert.deepEqual(emptyBody.folders, []);
	assert.deepEqual(emptyBody.items, []);

	const chat = stores.chatStore.createChat("Physics");
	const workspace = workspaceService.create({ pluginId: "study-plugin", modeId: "study-mode", title: "Study" });

	const res = await getDirectory(new Request("http://localhost/api/directory"));
	const body = await res.json();
	assert.equal(body.items.length, 2);
	const chatEntry = body.items.find((item: { id: string }) => item.id === chat.id);
	const wsEntry = body.items.find((item: { id: string }) => item.id === workspace.id);
	assert.equal(chatEntry.kind, "chat");
	assert.equal(chatEntry.title, "Physics");
	assert.equal(wsEntry.kind, "workspace");
	assert.equal(wsEntry.pluginId, "study-plugin");
	assert.equal(wsEntry.modeId, "study-mode");
	// The test process never initializes the plugin host: the conservative
	// fallback keeps the workspace visible (R7).
	assert.equal(wsEntry.availability, "plugin-missing");
	// New workspaces appear in the general root, not in any folder (R6).
	assert.equal(wsEntry.folderId, null);
	assert.equal(wsEntry.archivedAt, null);
});

it("POST /api/directory supports folders, mixed placement, and returns createdFolderId", async () => {
	const created = await postDirectoryAction({ action: "create-folder", name: "Mixed", parentId: null });
	assert.equal(created.status, 200);
	const createdBody = await created.json();
	const f1 = createdBody.createdFolderId;
	assert.ok(f1);

	const wsEntry = (await (await getDirectory(new Request("http://localhost/api/directory"))).json())
		.items.find((item: { kind: string }) => item.kind === "workspace");

	const moved = await postDirectoryAction({ action: "move", kind: "workspace", id: wsEntry.id, parentId: f1, targetOrder: 0 });
	assert.equal(moved.status, 200);

	const chat = stores.chatStore.createChat("Chemistry");
	const movedChat = await postDirectoryAction({ action: "move", kind: "chat", id: chat.id, parentId: f1, targetOrder: 1 });
	assert.equal(movedChat.status, 200);

	const body = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const inFolder = body.items.filter((item: { folderId: string | null }) => item.folderId === f1);
	assert.equal(inFolder.length, 2, "chat and workspace share the folder");
	assert.deepEqual(
		inFolder.map((item: { kind: string }) => item.kind).sort(),
		["chat", "workspace"],
	);
	assert.deepEqual(inFolder.map((item: { order: number }) => item.order), [0, 1]);
});

it("GET /api/chats/organization keeps the v1 wire format with bare chat IDs (R2)", async () => {
	const res = await getOrg(new Request("http://localhost/api/chats/organization"));
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.organization.version, 1);
	for (const key of Object.keys(body.organization.placements)) {
		assert.ok(!key.includes(":"), `placement key ${key} must be a bare chat ID`);
	}
	assert.ok(body.chats.every((chat: { kind?: string }) => chat.kind !== "workspace"), "workspaces are not chats");
	assert.ok(
		body.chats.every((chat: { id: string }) => !chat.id.startsWith("workspace_")),
		"workspace entries never leak into the chats array",
	);
	// workspace placements exist on disk (v2) but are invisible on the v1 wire
	const onDisk = JSON.parse(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"));
	assert.equal(onDisk.version, 2);
	assert.ok(Object.keys(onDisk.placements).some((key) => key.startsWith("workspace:")));
});

it("chat organization mutations preserve workspace placements and records (R2/R5)", async () => {
	const directoryBefore = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const wsPlacement = directoryBefore.items.find((item: { kind: string }) => item.kind === "workspace");
	const chatHashes = directoryBefore.items
		.filter((item: { kind: string }) => item.kind === "chat")
		.map((item: { id: string }) => hashFile(chatRecordFile(item.id)));
	const wsHash = hashFile(workspaceRecordFile(wsPlacement.id));

	const res = await postOrgAction({
		action: "reorder-siblings",
		parentId: wsPlacement.folderId,
		kind: "chat",
		ids: directoryBefore.items.filter((item: { kind: string; folderId: string | null }) => item.kind === "chat" && item.folderId === wsPlacement.folderId).map((item: { id: string }) => item.id),
	});
	assert.equal(res.status, 200);

	const directoryAfter = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const wsAfter = directoryAfter.items.find((item: { kind: string }) => item.kind === "workspace");
	assert.equal(wsAfter.folderId, wsPlacement.folderId, "workspace placement survived the chat-only write");
	assert.equal(wsAfter.order, wsPlacement.order, "workspace order untouched");
	assert.deepEqual(
		directoryAfter.items.filter((item: { kind: string }) => item.kind === "chat").map((item: { id: string }) => hashFile(chatRecordFile(item.id))),
		chatHashes,
		"chat records untouched by organizational writes",
	);
	assert.equal(hashFile(workspaceRecordFile(wsPlacement.id)), wsHash, "workspace record untouched");
});

it("folder deletion through the chat endpoint refuses workspace-only folders (R3)", async () => {
	const created = await postDirectoryAction({ action: "create-folder", name: "WS only", parentId: null });
	const f2 = (await created.json()).createdFolderId;
	const wsEntry = (await (await getDirectory(new Request("http://localhost/api/directory"))).json())
		.items.find((item: { kind: string }) => item.kind === "workspace");
	const moved = await postDirectoryAction({ action: "move", kind: "workspace", id: wsEntry.id, parentId: f2 });
	assert.equal(moved.status, 200);

	const res = await postOrgAction({ action: "delete-folder", id: f2 });
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.match(body.error, /contains items/);

	// Move the workspace back into the mixed folder for the archive test below.
	const directoryNow = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const mixed = directoryNow.folders.find((folder: { name: string }) => folder.name === "Mixed");
	const movedBack = await postDirectoryAction({ action: "move", kind: "workspace", id: wsEntry.id, parentId: mixed.id });
	assert.equal(movedBack.status, 200);
});

it("archiving a mixed folder via /api/directory archives both kinds; restore recovers them", async () => {
	const directory = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const mixedFolder = directory.folders.find((folder: { name: string }) => folder.name === "Mixed");
	const archived = await postDirectoryAction({ action: "archive", kind: "folder", id: mixedFolder.id });
	assert.equal(archived.status, 200);

	const active = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	assert.ok(!active.items.some((item: { folderId: string | null }) => item.folderId === mixedFolder.id),
		"archived items leave the active view");
	assert.ok(active.items.some((item: { kind: string }) => item.kind === "chat"), "root chats stay active");
	const archivedView = await (await getDirectory(new Request("http://localhost/api/directory?archived=true"))).json();
	assert.ok(archivedView.archivedFolders.some((folder: { id: string }) => folder.id === mixedFolder.id));
	assert.deepEqual(
		archivedView.items.map((item: { kind: string }) => item.kind).sort(),
		["chat", "workspace"],
		"both kinds archived",
	);

	const restored = await postDirectoryAction({ action: "restore", kind: "folder", id: mixedFolder.id });
	assert.equal(restored.status, 200);
	const after = await (await getDirectory(new Request("http://localhost/api/directory"))).json();
	const backInFolder = after.items.filter((item: { folderId: string | null }) => item.folderId === mixedFolder.id);
	assert.equal(backInFolder.length, 2, "both kinds restored");
	assert.ok(backInFolder.every((item: { archivedAt: string | null }) => item.archivedAt === null));
	// archivedAt is optional: folders that never went through archive/restore
	// may omit the key entirely.
	assert.ok(after.folders.every((folder: { archivedAt?: string | null }) => folder.archivedAt == null));
});

it("POST /api/directory validates actions and answers 400 on unknown input", async () => {
	const res = await postDirectoryAction({ action: "teleport", id: "x" });
	assert.equal(res.status, 400);
	const body = await res.json();
	assert.match(body.error, /Unknown organization action/);

	const missing = await postDirectory(jsonRequest("http://localhost/api/directory", undefined as unknown as object));
	assert.equal(missing.status, 400);
});

it("corrupt organization data fails reads loudly without overwriting the file", async () => {
	// Valid JSON with an unknown version: the parser (not JSON.parse) must
	// produce the "invalid or newer" hard failure.
	fs.writeFileSync(CHAT_ORGANIZATION_FILE, JSON.stringify({ version: 99, folders: [], placements: {} }));
	const before = fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8");

	const res = await getDirectory(new Request("http://localhost/api/directory"));
	assert.equal(res.status, 500);
	const body = await res.json();
	assert.match(body.error, /invalid or newer/);
	assert.equal(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"), before, "GET never rewrites corrupt data");

	const post = await postDirectoryAction({ action: "create-folder", name: "F", parentId: null });
	assert.equal(post.status, 500, "mutations refuse too");
	assert.equal(fs.readFileSync(CHAT_ORGANIZATION_FILE, "utf8"), before);
});
